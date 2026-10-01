// 위젯 재생목록 — FastAPI /api/v1/playlists 의 짝(전체 이식).
//
// 재생목록을 고치면 이를 쓰는 콘텐츠·스케줄의 버전을 올린다 — 장치가
// 하트비트에서 변경을 감지하는 연쇄의 시작점이다.

using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record PlaylistItemOut(
    int Id, int SortOrder, string WidgetKey, int DurationSec,
    JsonNode Options, string Transition, int TransitionMs);

public record PlaylistOut(
    int Id, string Name, string? Description, int OrgId, int? CreatedBy, int Version,
    DateTime CreatedAt, DateTime UpdatedAt, List<PlaylistItemOut> Items,
    string? OrgName, int UsageCount, int TotalDurationSec);

public class PlaylistItemIn
{
    public string WidgetKey { get; set; } = "";
    public int DurationSec { get; set; } = 10;
    public JsonNode? Options { get; set; }
    public string Transition { get; set; } = Transitions.Default;
    public int TransitionMs { get; set; } = Transitions.DefaultMs;
}

public class PlaylistCreateIn
{
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public int? OrgId { get; set; }
    public List<PlaylistItemIn> Items { get; set; } = [];
}

public class PlaylistUpdateIn
{
    public string? Name { get; set; }
    public string? Description { get; set; }
    public List<PlaylistItemIn>? Items { get; set; }
}

[ApiController]
[Route("api/v1/playlists")]
[Authorize]
public class PlaylistsController(
    AppDbContext db, PermissionService permissions, OrgTreeService orgTree,
    AssetService assets, NotifyService notify) : ControllerBase
{
    private Task<int> UsageCountAsync(int playlistId) =>
        db.ContentPlaylists.CountAsync(l => l.PlaylistId == playlistId);

    private async Task<PlaylistOut> ToOut(Playlist playlist)
    {
        var org = await db.Organizations.FindAsync(playlist.OrgId);
        var items = playlist.Items.OrderBy(i => i.SortOrder).Select(i => new PlaylistItemOut(
            i.Id, i.SortOrder, i.WidgetKey, i.DurationSec,
            Json.Parse(i.OptionsJson) ?? new JsonObject(), i.Transition, i.TransitionMs)).ToList();
        return new PlaylistOut(
            playlist.Id, playlist.Name, playlist.Description, playlist.OrgId,
            playlist.CreatedBy, playlist.Version, playlist.CreatedAt, playlist.UpdatedAt,
            items, org?.Name, await UsageCountAsync(playlist.Id),
            playlist.Items.Sum(i => i.DurationSec));
    }

    private async Task<bool> CanManageAsync(AppUser actor, Playlist playlist) =>
        await permissions.CanManageOrgAsync(actor, playlist.OrgId)
        || playlist.CreatedBy == actor.Id;

    /// <summary>칸 전체 교체. 받은 순서가 곧 재생 순서다. 오류 메시지는 반환.</summary>
    private string? ReplaceItems(Playlist playlist, List<PlaylistItemIn> items)
    {
        foreach (var item in items)
        {
            if (!WidgetRegistry.Keys.Contains(item.WidgetKey))
                return $"알 수 없는 위젯입니다: {item.WidgetKey}";
            if (!Transitions.FitsIn(item.Transition, item.TransitionMs, item.DurationSec))
                return "전환 시간은 표출 시간보다 길 수 없습니다.";
        }
        foreach (var old in playlist.Items.ToList())
        {
            playlist.Items.Remove(old);
            db.PlaylistItems.Remove(old);
        }
        foreach (var (item, index) in items.Select((item, index) => (item, index)))
        {
            playlist.Items.Add(new PlaylistItem
            {
                SortOrder = index,
                WidgetKey = item.WidgetKey,
                DurationSec = item.DurationSec,
                OptionsJson = Json.Write(item.Options),
                Transition = item.Transition,
                TransitionMs = item.TransitionMs,
            });
        }
        return null;
    }

    /// <summary>이 재생목록을 쓰는 콘텐츠·스케줄의 버전을 올리고 통지 대상을 모은다.</summary>
    private async Task<List<(int, string, int)>> BumpReferencingAsync(int playlistId)
    {
        var contentIds = await db.ContentPlaylists
            .Where(l => l.PlaylistId == playlistId)
            .Select(l => l.ContentId).ToListAsync();

        foreach (var content in await db.Contents.Where(c => contentIds.Contains(c.Id)).ToListAsync())
            content.Version += 1;

        // 스케줄 아이템이 재생목록을 인라인 문서로 직접 들 수도 있다 —
        // 색인이 없으므로 문서를 훑는다. 빼먹으면 그 장치는 영영 못 받는다.
        var inlineScheduleIds = (await db.ScheduleItems
                .Where(i => i.ContentId == null && i.ContentJson != "{}")
                .ToListAsync())
            .Where(i => PlaylistLinkService.ReferencedIds(Json.Parse(i.ContentJson))
                .Contains(playlistId))
            .Select(i => i.ScheduleId)
            .ToHashSet();

        if (contentIds.Count == 0 && inlineScheduleIds.Count == 0) return [];

        var scheduleIds = (await db.ScheduleItems
                .Where(i => i.ContentId != null && contentIds.Contains(i.ContentId.Value))
                .Select(i => i.ScheduleId).Distinct().ToListAsync())
            .Concat(inlineScheduleIds).Distinct().ToList();
        var targets = new List<(int, string, int)>();
        foreach (var schedule in await db.Schedules.Where(s => scheduleIds.Contains(s.Id)).ToListAsync())
        {
            schedule.Version += 1;
            var rows = await db.DeviceScheduleLinks
                .Where(l => l.ScheduleId == schedule.Id)
                .Join(db.Devices, l => l.DeviceId, d => d.Id, (l, d) => new { d.Id, d.DeviceCode })
                .ToListAsync();
            targets.AddRange(rows.Select(r => (r.Id, r.DeviceCode, schedule.Version)));
        }
        return targets;
    }

    [HttpGet("")]
    public async Task<ActionResult<PageOut<PlaylistOut>>> List(
        [FromQuery] string? q,
        [FromQuery(Name = "org_id")] int? orgId,
        [FromQuery] int page = 1, [FromQuery] int size = 24)
    {
        var actor = HttpContext.CurrentUser()!;
        var query = db.Playlists.Include(p => p.Items).AsQueryable();
        var scope = await permissions.ManagedOrgIdsAsync(actor);
        if (scope is not null) query = query.Where(p => scope.Contains(p.OrgId));
        if (!string.IsNullOrEmpty(q))
            query = query.Where(p => EF.Functions.Like(p.Name, $"%{q}%"));
        if (orgId is int org)
        {
            if (!await permissions.CanViewOrgAsync(actor, org))
                return StatusCode(403, new { detail = "해당 기관의 재생목록을 조회할 권한이 없습니다." });
            var subtree = await orgTree.DescendantIdsAsync(org);
            query = query.Where(p => subtree.Contains(p.OrgId));
        }

        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(p => p.UpdatedAt)
            .Skip((page - 1) * size).Take(Math.Clamp(size, 1, 200)).ToListAsync();
        var items = new List<PlaylistOut>();
        foreach (var row in rows) items.Add(await ToOut(row));
        return new PageOut<PlaylistOut>(items, total, page, size);
    }

    [HttpGet("{playlistId:int}")]
    public async Task<ActionResult<PlaylistOut>> Get(int playlistId)
    {
        var actor = HttpContext.CurrentUser()!;
        var playlist = await db.Playlists.Include(p => p.Items)
            .SingleOrDefaultAsync(p => p.Id == playlistId);
        if (playlist is null) return NotFound(new { detail = "재생목록을(를) 찾을 수 없습니다." });
        if (!await permissions.CanViewOrgAsync(actor, playlist.OrgId))
            return StatusCode(403, new { detail = "해당 재생목록을 조회할 권한이 없습니다." });
        return await ToOut(playlist);
    }

    [HttpPost("")]
    public async Task<ActionResult<PlaylistOut>> Create(PlaylistCreateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var orgId = payload.OrgId ?? actor.OrgId;
        if (!await permissions.CanViewOrgAsync(actor, orgId))
            return StatusCode(403, new { detail = "해당 기관에 재생목록을 만들 권한이 없습니다." });
        if (await db.Organizations.FindAsync(orgId) is null)
            return BadRequest(new { detail = "존재하지 않는 기관입니다." });

        var now = DateTime.UtcNow;
        var playlist = new Playlist
        {
            Name = payload.Name,
            Description = payload.Description,
            OrgId = orgId,
            CreatedBy = actor.Id,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        if (ReplaceItems(playlist, payload.Items) is string error)
            return BadRequest(new { detail = error });
        db.Playlists.Add(playlist);
        // 칸의 옵션이 가리키는 자산을 색인한다(이미지앨범의 사진들).
        await assets.SyncPlaylistLinksAsync(playlist);
        await db.SaveChangesAsync();
        return StatusCode(201, await ToOut(playlist));
    }

    [HttpPut("{playlistId:int}")]
    public async Task<ActionResult<PlaylistOut>> Update(int playlistId, PlaylistUpdateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var playlist = await db.Playlists.Include(p => p.Items).Include(p => p.AssetLinks)
            .SingleOrDefaultAsync(p => p.Id == playlistId);
        if (playlist is null) return NotFound(new { detail = "재생목록을(를) 찾을 수 없습니다." });
        if (!await CanManageAsync(actor, playlist))
            return StatusCode(403, new { detail = "해당 재생목록을 수정할 권한이 없습니다." });

        if (payload.Name is not null) playlist.Name = payload.Name;
        if (payload.Description is not null) playlist.Description = payload.Description;
        if (payload.Items is not null)
        {
            if (ReplaceItems(playlist, payload.Items) is string error)
                return BadRequest(new { detail = error });
            await assets.SyncPlaylistLinksAsync(playlist);
        }
        playlist.Version += 1;
        playlist.UpdatedAt = DateTime.UtcNow;

        var targets = await BumpReferencingAsync(playlist.Id);
        await db.SaveChangesAsync();

        if (targets.Count > 0)
            _ = notify.PushScheduleChangedAsync(targets);
        return await ToOut(playlist);
    }

    [HttpPost("{playlistId:int}/duplicate")]
    public async Task<ActionResult<PlaylistOut>> Duplicate(int playlistId)
    {
        var actor = HttpContext.CurrentUser()!;
        var source = await db.Playlists.Include(p => p.Items)
            .SingleOrDefaultAsync(p => p.Id == playlistId);
        if (source is null) return NotFound(new { detail = "재생목록을(를) 찾을 수 없습니다." });
        if (!await permissions.CanViewOrgAsync(actor, source.OrgId))
            return StatusCode(403, new { detail = "해당 재생목록을 복제할 권한이 없습니다." });

        var now = DateTime.UtcNow;
        var copy = new Playlist
        {
            Name = $"{source.Name} (복사본)",
            Description = source.Description,
            OrgId = source.OrgId,
            CreatedBy = actor.Id,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        foreach (var item in source.Items)
        {
            copy.Items.Add(new PlaylistItem
            {
                SortOrder = item.SortOrder,
                WidgetKey = item.WidgetKey,
                DurationSec = item.DurationSec,
                OptionsJson = item.OptionsJson,
                Transition = item.Transition,
                TransitionMs = item.TransitionMs,
            });
        }
        db.Playlists.Add(copy);
        await db.SaveChangesAsync();
        return await ToOut(copy);
    }

    [HttpDelete("{playlistId:int}")]
    public async Task<ActionResult<Message>> Delete(int playlistId)
    {
        var actor = HttpContext.CurrentUser()!;
        var playlist = await db.Playlists.SingleOrDefaultAsync(p => p.Id == playlistId);
        if (playlist is null) return NotFound(new { detail = "재생목록을(를) 찾을 수 없습니다." });
        if (!await CanManageAsync(actor, playlist))
            return StatusCode(403, new { detail = "해당 재생목록을 수정할 권한이 없습니다." });

        var used = await UsageCountAsync(playlistId);
        if (used > 0)
            return BadRequest(new { detail = $"이 재생목록을 쓰는 콘텐츠가 {used}건 있습니다. 먼저 교체하세요." });

        db.Playlists.Remove(playlist);
        await db.SaveChangesAsync();
        return new Message("재생목록이 삭제되었습니다.");
    }
}

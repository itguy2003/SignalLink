// 콘텐츠 라이브러리 — FastAPI /api/v1/contents 의 짝(전체 이식).
//
// 콘텐츠를 수정하면 이를 참조하는 모든 스케줄의 버전을 올린다 — 그래야
// 장치가 하트비트에서 변경을 감지해 다시 받아간다.

using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record ContentSummaryOut(
    int Id, string Name, string? Description, int Width, int Height,
    int OrgId, int? CreatedBy, int Version, DateTime CreatedAt, DateTime UpdatedAt,
    string? OrgName, int UsageCount, int ElementCount, string Background,
    string ShareScope, bool Shared);

public record ContentDetailOut(
    int Id, string Name, string? Description, int Width, int Height,
    int OrgId, int? CreatedBy, int Version, DateTime CreatedAt, DateTime UpdatedAt,
    string? OrgName, int UsageCount, int ElementCount, string Background,
    string ShareScope, bool Shared, JsonNode Document);

public class ContentCreateIn
{
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public int Width { get; set; } = 1920;
    public int Height { get; set; } = 1080;
    public int? OrgId { get; set; }
    public JsonNode? Document { get; set; }
    public string ShareScope { get; set; } = "없음";
}

public class ContentUpdateIn
{
    public string? Name { get; set; }
    public string? Description { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public JsonNode? Document { get; set; }
    public string? ShareScope { get; set; }
}

[ApiController]
[Route("api/v1/contents")]
[Authorize]
public class ContentsController(
    AppDbContext db, PermissionService permissions, OrgTreeService orgTree,
    AssetService assets, PlaylistLinkService playlistLinks, NotifyService notify)
    : ControllerBase
{
    public static JsonObject EmptyDocument(int width, int height) => new()
    {
        ["version"] = 1,
        ["layout"] = new JsonObject
        {
            ["width"] = width, ["height"] = height, ["background"] = "#000000",
        },
        ["elements"] = new JsonArray(),
    };

    private Task<int> UsageCountAsync(int contentId) =>
        db.ScheduleItems.CountAsync(i => i.ContentId == contentId);

    /// <summary>shared: 보는 사람의 관리 범위 밖에서 공유로 열려 온 것인지 —
    /// 브라우저가 출처 배지를 그리고 수정 진입을 막는 근거.</summary>
    private async Task<ContentSummaryOut> ToSummary(Content content, bool shared = false)
    {
        var org = await db.Organizations.FindAsync(content.OrgId);
        var document = Json.Parse(content.DocumentJson);
        var elementCount = (document?["elements"] as JsonArray)?.Count ?? 0;
        var background = document?["layout"]?["background"]?.GetValue<string?>() ?? "#000000";
        return new ContentSummaryOut(
            content.Id, content.Name, content.Description, content.Width, content.Height,
            content.OrgId, content.CreatedBy, content.Version, content.CreatedAt, content.UpdatedAt,
            org?.Name, await UsageCountAsync(content.Id), elementCount, background,
            content.ShareScope, shared);
    }

    private async Task<ContentDetailOut> ToDetail(Content content, bool shared = false)
    {
        var summary = await ToSummary(content, shared);
        return new ContentDetailOut(
            summary.Id, summary.Name, summary.Description, summary.Width, summary.Height,
            summary.OrgId, summary.CreatedBy, summary.Version, summary.CreatedAt, summary.UpdatedAt,
            summary.OrgName, summary.UsageCount, summary.ElementCount, summary.Background,
            summary.ShareScope, summary.Shared,
            Json.Parse(content.DocumentJson) ?? new JsonObject());
    }

    /// <summary>이 콘텐츠를 쓰는 스케줄의 버전을 올리고 통지 대상을 모은다.</summary>
    private async Task<List<(int, string, int)>> BumpReferencingSchedulesAsync(int contentId)
    {
        var scheduleIds = await db.ScheduleItems
            .Where(i => i.ContentId == contentId)
            .Select(i => i.ScheduleId).Distinct().ToListAsync();
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
    public async Task<ActionResult<PageOut<ContentSummaryOut>>> List(
        [FromQuery] string? q,
        [FromQuery(Name = "org_id")] int? orgId,
        [FromQuery] string? orientation,
        [FromQuery] string? share,
        [FromQuery] int page = 1, [FromQuery] int size = 24)
    {
        var actor = HttpContext.CurrentUser()!;
        var query = db.Contents.AsQueryable();
        var scope = await permissions.ManagedOrgIdsAsync(actor);

        // 공유 판정의 기준 기관은 소비하는 쪽 — org_id 필터가 있으면(스케줄
        // 편집 맥락) 그 기관, 없으면 보는 사람의 기관.
        var consumerOrg = orgId ?? actor.OrgId;
        var siblings = await ContentSharing.SiblingOrgIdsAsync(db, consumerOrg);

        HashSet<int>? baseIds = null;
        if (orgId is int org)
        {
            if (!await permissions.CanViewOrgAsync(actor, org))
                return StatusCode(403, new { detail = "해당 기관의 콘텐츠를 조회할 권한이 없습니다." });
            baseIds = await orgTree.DescendantIdsAsync(org);
        }
        else if (scope is not null)
        {
            baseIds = scope;
        }

        // share: mine = 관리 범위의 것만 | shared = 공유로 열려 온 것만 | 비면 둘 다.
        if (share == "mine")
        {
            if (baseIds is not null) query = query.Where(c => baseIds.Contains(c.OrgId));
        }
        else if (share == "shared")
        {
            query = query.Where(c =>
                c.ShareScope == "전체"
                || (c.ShareScope == "동일기관" && c.OrgId == consumerOrg)
                || (c.ShareScope == "소속기관" && siblings.Contains(c.OrgId)));
            if (baseIds is not null) query = query.Where(c => !baseIds.Contains(c.OrgId));
        }
        else if (baseIds is not null)
        {
            query = query.Where(c =>
                baseIds.Contains(c.OrgId)
                || c.ShareScope == "전체"
                || (c.ShareScope == "동일기관" && c.OrgId == consumerOrg)
                || (c.ShareScope == "소속기관" && siblings.Contains(c.OrgId)));
        }

        if (!string.IsNullOrEmpty(q))
            query = query.Where(c => EF.Functions.Like(c.Name, $"%{q}%"));
        if (orientation == "portrait") query = query.Where(c => c.Height > c.Width);
        else if (orientation == "landscape") query = query.Where(c => c.Height <= c.Width);

        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(c => c.UpdatedAt)
            .Skip((page - 1) * size).Take(Math.Clamp(size, 1, 200)).ToListAsync();
        var items = new List<ContentSummaryOut>();
        foreach (var row in rows)
            items.Add(await ToSummary(row, shared: baseIds is not null && !baseIds.Contains(row.OrgId)));
        return new PageOut<ContentSummaryOut>(items, total, page, size);
    }

    [HttpGet("{contentId:int}")]
    public async Task<ActionResult<ContentDetailOut>> Get(int contentId)
    {
        var actor = HttpContext.CurrentUser()!;
        var content = await db.Contents.FindAsync(contentId);
        if (content is null) return NotFound(new { detail = "콘텐츠을(를) 찾을 수 없습니다." });
        var own = await permissions.CanViewOrgAsync(actor, content.OrgId);
        // 관리 범위 밖이라도 공유 구분이 열어 주면 읽을 수 있다(수정·삭제는 불가).
        if (!own && !await ContentSharing.SharedWithAsync(db, content, actor.OrgId))
            return StatusCode(403, new { detail = "해당 콘텐츠를 조회할 권한이 없습니다." });
        return await ToDetail(content, shared: !own);
    }

    [HttpPost("")]
    public async Task<ActionResult<ContentDetailOut>> Create(ContentCreateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var orgId = payload.OrgId ?? actor.OrgId;
        if (!await permissions.CanViewOrgAsync(actor, orgId))
            return StatusCode(403, new { detail = "해당 기관에 콘텐츠를 만들 권한이 없습니다." });
        if (await db.Organizations.FindAsync(orgId) is null)
            return BadRequest(new { detail = "존재하지 않는 기관입니다." });
        if (!ContentSharing.Scopes.Contains(payload.ShareScope))
            return BadRequest(new { detail = ContentSharing.InvalidScopeMessage });

        var now = DateTime.UtcNow;
        var content = new Content
        {
            Name = payload.Name,
            Description = payload.Description,
            OrgId = orgId,
            CreatedBy = actor.Id,
            Width = payload.Width,
            Height = payload.Height,
            DocumentJson = Json.Write(payload.Document ?? EmptyDocument(payload.Width, payload.Height)),
            ShareScope = payload.ShareScope,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Contents.Add(content);
        // 문서가 쓰는 재생목록·자산을 색인한다 — 버전 연쇄와 삭제 보호의 근거.
        await playlistLinks.SyncLinksAsync(content);
        await assets.SyncContentLinksAsync(content);
        await db.SaveChangesAsync();
        return StatusCode(201, await ToDetail(content));
    }

    [HttpPut("{contentId:int}")]
    public async Task<ActionResult<ContentDetailOut>> Update(int contentId, ContentUpdateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var content = await db.Contents.Include(c => c.AssetLinks).Include(c => c.PlaylistLinks)
            .SingleOrDefaultAsync(c => c.Id == contentId);
        if (content is null) return NotFound(new { detail = "콘텐츠을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageOrgAsync(actor, content.OrgId) && content.CreatedBy != actor.Id)
            return StatusCode(403, new { detail = "해당 콘텐츠를 수정할 권한이 없습니다." });

        if (payload.Name is not null) content.Name = payload.Name;
        if (payload.Description is not null) content.Description = payload.Description;
        if (payload.Width is int width) content.Width = width;
        if (payload.Height is int height) content.Height = height;
        if (payload.Document is not null) content.DocumentJson = Json.Write(payload.Document);
        if (payload.ShareScope is string shareScope)
        {
            if (!ContentSharing.Scopes.Contains(shareScope))
                return BadRequest(new { detail = ContentSharing.InvalidScopeMessage });
            content.ShareScope = shareScope;
        }
        content.Version += 1;
        content.UpdatedAt = DateTime.UtcNow;

        await playlistLinks.SyncLinksAsync(content);
        await assets.SyncContentLinksAsync(content);
        // 이 콘텐츠를 쓰는 스케줄의 버전도 올려야 장치가 변경을 감지한다.
        var targets = await BumpReferencingSchedulesAsync(content.Id);
        await db.SaveChangesAsync();

        if (targets.Count > 0)
            _ = notify.PushScheduleChangedAsync(targets);
        return await ToDetail(content);
    }

    [HttpPost("{contentId:int}/duplicate")]
    public async Task<ActionResult<ContentDetailOut>> Duplicate(int contentId)
    {
        var actor = HttpContext.CurrentUser()!;
        var source = await db.Contents.FindAsync(contentId);
        if (source is null) return NotFound(new { detail = "콘텐츠을(를) 찾을 수 없습니다." });
        if (!await permissions.CanViewOrgAsync(actor, source.OrgId))
            return StatusCode(403, new { detail = "해당 콘텐츠를 복제할 권한이 없습니다." });

        var now = DateTime.UtcNow;
        // 복사본은 '없음'으로 시작한다 — 공유는 명시적인 행동이어야 한다.
        var copy = new Content
        {
            Name = $"{source.Name} (복사본)",
            Description = source.Description,
            OrgId = source.OrgId,
            CreatedBy = actor.Id,
            Width = source.Width,
            Height = source.Height,
            DocumentJson = source.DocumentJson,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Contents.Add(copy);
        await playlistLinks.SyncLinksAsync(copy);
        await db.SaveChangesAsync();
        return await ToDetail(copy);
    }

    [HttpDelete("{contentId:int}")]
    public async Task<ActionResult<Message>> Delete(int contentId)
    {
        var actor = HttpContext.CurrentUser()!;
        var content = await db.Contents.FindAsync(contentId);
        if (content is null) return NotFound(new { detail = "콘텐츠을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageOrgAsync(actor, content.OrgId) && content.CreatedBy != actor.Id)
            return StatusCode(403, new { detail = "해당 콘텐츠를 삭제할 권한이 없습니다." });

        var used = await UsageCountAsync(contentId);
        if (used > 0)
            return BadRequest(new
            {
                detail = $"이 콘텐츠를 사용하는 스케줄 아이템이 {used}건 있습니다. 먼저 배치를 해제하세요.",
            });

        db.Contents.Remove(content);
        await db.SaveChangesAsync();
        return new Message("콘텐츠가 삭제되었습니다.");
    }
}

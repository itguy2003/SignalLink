// 커뮤니티 — FastAPI /api/v1/community 의 짝.
//
// 개편(2026-10): COMMUNITY_USER 역할을 걷어내고 커뮤니티를 모든 승인
// 사용자의 공간으로 바꿨다. 게시물의 메타데이터는 제목·공지대상(기관구분)·
// 공지희망기간·연락처·메모다.
//   - 파일은 게시물에 직접 올린다(/playlists/{id}/media). 올린 파일만 칸이 된다.
//   - 게시 결과(대기중·게시·게시보류)는 커뮤니티 소유 기관의 관리자가 정하고,
//     '게시' 상태만 콘텐츠(커뮤니티 위젯)가 표출한다.
//   - 로그인 팝업(/popup): '게시' 중이고, 공지대상이 비었거나 내 기관의
//     기관구분을 포함하고, 공지희망기간 안인 글만 알린다.
//   - 전체 재생시간은 서버가 계산한다 — 칸 재생시간의 합(total_duration_sec).

using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record AssetOut(
    int Id, int OrgId, int? UploadedBy, string Kind, string Filename,
    string ContentType, long SizeBytes, string Url, string? ThumbUrl,
    string? OrgName = null, int UsageCount = 0);

public record CommunityContext(int OrgId, string OrgName, bool CanShare);

public record CommunityContextItem(int OrgId, string OrgName, bool CanShare);

public record PublishStatusUpdate(string Status);

/// <summary>게시 정책 — auto_publish 가 켜지면 등록 즉시 '게시'.</summary>
public record CommunitySettingOut(bool AutoPublish, bool CanManage);

public record CommunitySettingUpdate(bool AutoPublish);

/// <summary>칸(슬라이드) — 소속기관 공지와 같은 모양(2026-10): 콘텐츠 편집기 문서를
/// 인라인으로 갖고, 유지 시간만 따로 둔다. 이미지·동영상은 문서의 요소다.</summary>
public class CommunityPlaylistItemIn
{
    public JsonNode? Document { get; set; }
    public int DurationSec { get; set; } = 10;
}

public record CommunityPlaylistCreateIn(
    string Title, string? Memo, List<string>? TargetOrgTypes,
    string? NoticeStart, string? NoticeEnd, string? AuthorName, string? Contact,
    List<CommunityPlaylistItemIn>? Items);

public class CommunityPlaylistUpdateIn
{
    public string? Title { get; set; }
    /// <summary>빈 문자열은 '지움', null 은 '건드리지 않음'.</summary>
    public string? Memo { get; set; }
    /// <summary>공지대상(기관구분 이름들). 빈 배열은 '전체 대상'.</summary>
    public List<string>? TargetOrgTypes { get; set; }
    /// <summary>공지희망기간 "YYYY-MM-DD". 빈 문자열은 '지움'.</summary>
    public string? NoticeStart { get; set; }
    public string? NoticeEnd { get; set; }
    /// <summary>게시자 표시 이름 — 빈 문자열이면 계정 이름으로 돌아간다.</summary>
    public string? AuthorName { get; set; }
    public string? Contact { get; set; }
    public List<CommunityPlaylistItemIn>? Items { get; set; }
}

public record CommunityPlaylistOut(
    int Id, int OrgId, int? AuthorId, string? AuthorName, string? Contact,
    string Title, string? Memo, List<string> TargetOrgTypes,
    string? NoticeStart, string? NoticeEnd, string PublishStatus, int Version,
    DateTime CreatedAt, DateTime UpdatedAt,
    List<JsonObject> Items, List<JsonObject> Assets, int TotalDurationSec,
    bool CanEdit, bool CanRemove, bool CanPublish);

/// <summary>로그인 팝업 한 줄 — 대상·기간이 맞는 '게시' 중 공지의 요약.</summary>
public record CommunityNoticeOut(
    int Id, int OrgId, string OrgName, string Title, string? Memo,
    string? Contact, string? AuthorName, List<string> TargetOrgTypes,
    string? NoticeStart, string? NoticeEnd);

[ApiController]
[Route("api/v1/community")]
[Authorize]
public class CommunityController(
    AppDbContext db, PermissionService permissions, AssetService assets,
    VideoTranscodeService transcode) : ControllerBase
{
    private static readonly string[] PublishStatuses = ["대기중", "게시", "게시보류"];

    /// <summary>칸 검증 문구 — FastAPI·목 서버와 같은 말을 한다.</summary>
    private const string ItemDocumentRequired = "칸에는 콘텐츠 문서가 있어야 합니다.";
    private const string NestedCommunityWidget = "커뮤니티 게시물 안에는 커뮤니티 위젯을 넣을 수 없습니다.";

    private ActionResult Forbid403(string detail) => StatusCode(403, new { detail });

    // ---------------------------------------------------------------- 컨텍스트

    [HttpGet("context")]
    public async Task<ActionResult<CommunityContext>> Context([FromQuery(Name = "org_id")] int? orgId)
    {
        var (user, org, error) = await ResolveAsync(orgId);
        if (error is not null) return error;
        return new CommunityContext(org!.Id, org.Name, PermissionService.CanShareInCommunity(user!));
    }

    /// <summary>쓸 수 있는 커뮤니티들 — 슈퍼관리자는 전체, 나머지는 제 것 하나.</summary>
    [HttpGet("list")]
    public async Task<ActionResult<List<CommunityContextItem>>> ListCommunities()
    {
        var user = HttpContext.CurrentUser()!;
        if (!PermissionService.CanUseCommunity(user))
            return Forbid403("커뮤니티를 사용할 권한이 없습니다.");

        var canShare = PermissionService.CanShareInCommunity(user);
        if (PermissionService.IsSuperAdmin(user))
        {
            var ownerTypes = await OrgTypeSupport.NamesOfCategoryAsync(db, "기관");
            var orgs = await db.Organizations.Where(o => ownerTypes.Contains(o.OrgType))
                .OrderBy(o => o.Name).ToListAsync();
            return orgs.Select(o => new CommunityContextItem(o.Id, o.Name, canShare)).ToList();
        }

        var mine = await permissions.CommunityOrgOfAsync(user.OrgId);
        if (mine is null) return new List<CommunityContextItem>();
        var org = await db.Organizations.FindAsync(mine.Value);
        return org is null
            ? new List<CommunityContextItem>()
            : [new CommunityContextItem(org.Id, org.Name, canShare)];
    }

    // ---------------------------------------------------------------- 설정

    /// <summary>게시 정책 조회 — 등록 화면이 '즉시 게시' 안내를 띄우는 근거.</summary>
    [HttpGet("settings")]
    public async Task<ActionResult<CommunitySettingOut>> GetSettings(
        [FromQuery(Name = "org_id")] int? orgId)
    {
        var (user, org, error) = await ResolveAsync(orgId);
        if (error is not null) return error;
        var setting = await db.CommunitySettings.SingleOrDefaultAsync(s => s.OrgId == org!.Id);
        return new CommunitySettingOut(
            setting?.AutoPublish ?? false,
            await permissions.CanPublishAsync(user!, org!.Id));
    }

    /// <summary>게시 정책 설정 — 커뮤니티 소유 기관의 관리자만.
    /// 켜면 '관리자 승인 없이' 등록 즉시 게시, 끄면(기본) 승인 후 게시다.</summary>
    [HttpPut("settings")]
    public async Task<ActionResult<CommunitySettingOut>> SetSettings(
        CommunitySettingUpdate payload, [FromQuery(Name = "org_id")] int? orgId)
    {
        var (user, org, error) = await ResolveAsync(orgId);
        if (error is not null) return error;
        if (!await permissions.CanPublishAsync(user!, org!.Id))
            return Forbid403("게시 정책은 커뮤니티 소유 기관의 관리자만 설정할 수 있습니다.");

        var setting = await db.CommunitySettings.SingleOrDefaultAsync(s => s.OrgId == org.Id);
        if (setting is null)
        {
            setting = new CommunitySetting { OrgId = org.Id };
            db.CommunitySettings.Add(setting);
        }
        setting.AutoPublish = payload.AutoPublish;
        await db.SaveChangesAsync();
        return new CommunitySettingOut(setting.AutoPublish, true);
    }

    // ---------------------------------------------------------------- 재생목록

    [HttpGet("playlists")]
    public async Task<ActionResult<PageOut<CommunityPlaylistOut>>> ListPlaylists(
        [FromQuery(Name = "org_id")] int? orgId,
        [FromQuery] int page = 1, [FromQuery] int size = 20)
    {
        var (user, org, error) = await ResolveAsync(orgId);
        if (error is not null) return error;

        var query = db.CommunityPlaylists
            .Include(p => p.Author)
            .Include(p => p.AssetLinks).ThenInclude(l => l.Asset)
            .Where(p => p.OrgId == org!.Id);
        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(p => p.Id)
            .Skip((page - 1) * size).Take(size).ToListAsync();

        var items = new List<CommunityPlaylistOut>();
        foreach (var row in rows) items.Add(await ToOut(row, user!));
        return new PageOut<CommunityPlaylistOut>(items, total, page, size);
    }

    [HttpGet("playlists/{playlistId:int}")]
    public async Task<ActionResult<CommunityPlaylistOut>> GetPlaylist(int playlistId)
    {
        var user = HttpContext.CurrentUser()!;
        var playlist = await LoadAsync(playlistId);
        if (playlist is null || !await CanTouchAsync(user, playlist.OrgId))
            return NotFound(new { detail = "커뮤니티 게시물을(를) 찾을 수 없습니다." });
        return await ToOut(playlist, user);
    }

    [HttpPost("playlists")]
    public async Task<ActionResult<CommunityPlaylistOut>> CreatePlaylist(
        CommunityPlaylistCreateIn payload, [FromQuery(Name = "org_id")] int? orgId)
    {
        var (user, org, error) = await ResolveAsync(orgId);
        if (error is not null) return error;
        if (!PermissionService.CanShareInCommunity(user!))
            return Forbid403("커뮤니티에 올릴 권한이 없습니다.");
        if (string.IsNullOrWhiteSpace(payload.Title))
            return BadRequest(new { detail = "제목을 입력하세요." });

        // 게시 정책: 자동 게시가 켜진 커뮤니티는 승인 없이 곧장 '게시'다.
        var autoPublish = (await db.CommunitySettings
            .SingleOrDefaultAsync(s => s.OrgId == org!.Id))?.AutoPublish ?? false;

        var metaError = await ValidateMetaAsync(payload.TargetOrgTypes, payload.NoticeStart, payload.NoticeEnd);
        if (metaError is not null) return BadRequest(new { detail = metaError });

        var now = DateTime.UtcNow;
        var playlist = new CommunityPlaylist
        {
            OrgId = org!.Id,
            AuthorId = user!.Id,
            Title = payload.Title.Trim(),
            Memo = string.IsNullOrWhiteSpace(payload.Memo) ? null : payload.Memo.Trim(),
            TargetOrgTypesJson = ToTargetsJson(payload.TargetOrgTypes),
            NoticeStart = string.IsNullOrWhiteSpace(payload.NoticeStart) ? null : payload.NoticeStart.Trim(),
            NoticeEnd = string.IsNullOrWhiteSpace(payload.NoticeEnd) ? null : payload.NoticeEnd.Trim(),
            AuthorName = string.IsNullOrWhiteSpace(payload.AuthorName)
                ? null : payload.AuthorName.Trim(),
            Contact = string.IsNullOrWhiteSpace(payload.Contact)
                ? null : payload.Contact.Trim(),
            PublishStatus = autoPublish ? "게시" : "대기중",
            ItemsJson = "[]",
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        // 칸은 만들 때 비어 있을 수 있다 — 파일을 올리려면 먼저 id 가 필요하다.
        if (payload.Items is { Count: > 0 } initial)
        {
            var (itemsJson, itemsError) = ValidateItems(playlist, initial);
            if (itemsError is not null) return BadRequest(new { detail = itemsError });
            playlist.ItemsJson = itemsJson!;
        }
        db.CommunityPlaylists.Add(playlist);
        await db.SaveChangesAsync();
        playlist.Author = user;
        return StatusCode(201, await ToOut(playlist, user));
    }

    /// <summary>재생목록에 이미지·동영상 올리기 — 올린 파일만 칸이 될 수 있다.</summary>
    [HttpPost("playlists/{playlistId:int}/media")]
    public async Task<ActionResult<AssetOut>> UploadMedia(int playlistId, IFormFile file)
    {
        var user = HttpContext.CurrentUser()!;
        var playlist = await LoadAsync(playlistId);
        if (playlist is null || !await CanTouchAsync(user, playlist.OrgId))
            return NotFound(new { detail = "커뮤니티 게시물을(를) 찾을 수 없습니다." });
        if (!PermissionService.CanRemoveShared(user, playlist.AuthorId))
            return Forbid403("이 게시물에 파일을 올릴 권한이 없습니다.");

        var kind = AssetService.KindOf(file.ContentType);
        if (kind is null)
            return BadRequest(new { detail = $"지원하지 않는 형식입니다: {(string.IsNullOrEmpty(file.ContentType) ? "알 수 없음" : file.ContentType)}" });

        string stored;
        long size;
        var contentType = file.ContentType;
        try
        {
            (stored, size) = await assets.StoreStreamAsync(file, kind, contentType);
            if (kind == "video")
            {
                // 웹 표준(H.264/AAC MP4, faststart)으로 정규화 — 장치가 항상 그린다.
                (stored, size, contentType) = await transcode.EnsureWebVideoAsync(stored, contentType);
            }
        }
        catch (UploadRejectedException exc)
        {
            return BadRequest(new { detail = exc.Message });
        }

        var now = DateTime.UtcNow;
        var asset = new Asset
        {
            // 커뮤니티가 걸린 상위기관 소유 — 그 기관 관리자가 라이브러리에서 함께 본다.
            OrgId = playlist.OrgId,
            UploadedBy = user.Id,
            Kind = kind,
            Filename = string.IsNullOrEmpty(file.FileName) ? $"community-{kind}" : file.FileName,
            ContentType = contentType,
            SizeBytes = size,
            StoragePath = stored,
            CreatedAt = now,
            UpdatedAt = now,
        };
        assets.AttachThumbnail(asset);
        db.Assets.Add(asset);
        await db.SaveChangesAsync();

        playlist.AssetLinks.Add(new CommunityPlaylistAsset { AssetId = asset.Id, Asset = asset });
        await db.SaveChangesAsync();

        return StatusCode(201, ToAssetOut(asset));
    }

    [HttpPut("playlists/{playlistId:int}")]
    public async Task<ActionResult<CommunityPlaylistOut>> UpdatePlaylist(
        int playlistId, CommunityPlaylistUpdateIn payload)
    {
        var user = HttpContext.CurrentUser()!;
        var playlist = await LoadAsync(playlistId);
        if (playlist is null || !await CanTouchAsync(user, playlist.OrgId))
            return NotFound(new { detail = "커뮤니티 게시물을(를) 찾을 수 없습니다." });
        if (!PermissionService.CanRemoveShared(user, playlist.AuthorId))
            return Forbid403("이 게시물을 고칠 권한이 없습니다.");

        var metaError = await ValidateMetaAsync(payload.TargetOrgTypes, payload.NoticeStart, payload.NoticeEnd);
        if (metaError is not null) return BadRequest(new { detail = metaError });

        if (payload.Title is not null)
        {
            if (payload.Title.Trim().Length == 0)
                return BadRequest(new { detail = "제목을 입력하세요." });
            playlist.Title = payload.Title.Trim();
        }
        if (payload.Memo is not null)
            playlist.Memo = payload.Memo.Trim() is { Length: > 0 } text ? text : null;
        if (payload.TargetOrgTypes is not null)
            playlist.TargetOrgTypesJson = ToTargetsJson(payload.TargetOrgTypes);
        if (payload.NoticeStart is not null)
            playlist.NoticeStart = payload.NoticeStart.Trim() is { Length: > 0 } start ? start : null;
        if (payload.NoticeEnd is not null)
            playlist.NoticeEnd = payload.NoticeEnd.Trim() is { Length: > 0 } end ? end : null;
        if (payload.AuthorName is not null)
            playlist.AuthorName = payload.AuthorName.Trim() is { Length: > 0 } author ? author : null;
        if (payload.Contact is not null)
            playlist.Contact = payload.Contact.Trim() is { Length: > 0 } contact ? contact : null;
        if (payload.Items is not null)
        {
            var (itemsJson, itemsError) = ValidateItems(playlist, payload.Items);
            if (itemsError is not null) return BadRequest(new { detail = itemsError });
            playlist.ItemsJson = itemsJson!;
        }
        // 기간은 한쪽만 고칠 수 있으니 최종 값으로 순서를 본다.
        if (playlist.NoticeStart is not null && playlist.NoticeEnd is not null
            && string.CompareOrdinal(playlist.NoticeStart, playlist.NoticeEnd) > 0)
            return BadRequest(new { detail = "공지희망기간의 시작이 종료보다 늦을 수 없습니다." });
        playlist.Version += 1;  // 위젯이 변경을 감지하는 근거다.
        playlist.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return await ToOut(playlist, user);
    }

    /// <summary>게시 결과(대기중·게시·게시보류) — 작성자는 손대지 못하고
    /// 커뮤니티 소유 기관의 관리자만 바꾼다. '게시'만 위젯이 표출한다.</summary>
    [HttpPut("playlists/{playlistId:int}/status")]
    public async Task<ActionResult<CommunityPlaylistOut>> SetStatus(
        int playlistId, PublishStatusUpdate payload)
    {
        var user = HttpContext.CurrentUser()!;
        var playlist = await LoadAsync(playlistId);
        if (playlist is null || !await CanTouchAsync(user, playlist.OrgId))
            return NotFound(new { detail = "커뮤니티 게시물을(를) 찾을 수 없습니다." });
        if (!await permissions.CanPublishAsync(user, playlist.OrgId))
            return Forbid403("게시 결과는 커뮤니티 소유 기관의 관리자만 설정할 수 있습니다.");
        if (!PublishStatuses.Contains(payload.Status))
            return BadRequest(new { detail = "게시 결과는 대기중·게시·게시보류 중 하나여야 합니다." });

        playlist.PublishStatus = payload.Status;
        playlist.Version += 1;  // 게시 여부가 곧 표출 여부다 — 위젯이 감지해야 한다.
        playlist.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return await ToOut(playlist, user);
    }

    [HttpDelete("playlists/{playlistId:int}")]
    public async Task<ActionResult<Message>> DeletePlaylist(int playlistId)
    {
        var user = HttpContext.CurrentUser()!;
        var playlist = await db.CommunityPlaylists.SingleOrDefaultAsync(p => p.Id == playlistId);
        if (playlist is null || !await CanTouchAsync(user, playlist.OrgId))
            return NotFound(new { detail = "커뮤니티 게시물을(를) 찾을 수 없습니다." });
        if (!PermissionService.CanRemoveShared(user, playlist.AuthorId))
            return Forbid403("이 게시물을 지울 권한이 없습니다.");
        db.CommunityPlaylists.Remove(playlist);
        await db.SaveChangesAsync();
        return new Message("게시물을 지웠습니다.");
    }

    // ---------------------------------------------------------------- 공통

    private Task<CommunityPlaylist?> LoadAsync(int playlistId) =>
        db.CommunityPlaylists
            .Include(p => p.Author)
            .Include(p => p.AssetLinks).ThenInclude(l => l.Asset)
            .SingleOrDefaultAsync(p => p.Id == playlistId);

    /// <summary>이번 요청의 커뮤니티. FastAPI 의 _resolve_community 와 같은 규칙.</summary>
    private async Task<(AppUser? user, Organization? org, ActionResult? error)> ResolveAsync(int? orgId)
    {
        var user = HttpContext.CurrentUser()!;
        if (!PermissionService.CanUseCommunity(user))
            return (user, null, Forbid403("커뮤니티를 사용할 권한이 없습니다."));

        var mine = await permissions.CommunityOrgOfAsync(user.OrgId);
        int target;
        if (orgId is int chosen && chosen != mine)
        {
            // 고르기는 슈퍼관리자의 것이다. 남이 고르면 자기 것일 때만 통과.
            if (!PermissionService.IsSuperAdmin(user))
                return (user, null, Forbid403("해당 커뮤니티를 사용할 권한이 없습니다."));
            target = chosen;
        }
        else
        {
            if (mine is null)
                return (user, null, NotFound(new { detail = "커뮤니티을(를) 찾을 수 없습니다." }));
            target = mine.Value;
        }

        var org = await db.Organizations.FindAsync(target);
        var ownerTypes = await OrgTypeSupport.NamesOfCategoryAsync(db, "기관");
        if (org is null || !ownerTypes.Contains(org.OrgType))
            return (user, null, NotFound(new { detail = "커뮤니티을(를) 찾을 수 없습니다." }));
        return (user, org, null);
    }

    /// <summary>그 커뮤니티의 것을 손댈 자격 — 제 커뮤니티거나 관리 범위 안.</summary>
    private async Task<bool> CanTouchAsync(AppUser user, int orgId)
    {
        if (!PermissionService.CanUseCommunity(user)) return false;
        if (PermissionService.IsSuperAdmin(user)) return true;
        var mine = await permissions.CommunityOrgOfAsync(user.OrgId);
        return mine == orgId || await permissions.CanManageOrgAsync(user, orgId);
    }

    /// <summary>칸을 검사해 저장 모양으로 만든다 — 소속기관 공지와 같은 계약.
    /// 칸마다 콘텐츠 문서가 있어야 하고, 문서 안에 커뮤니티 위젯은 못 넣는다
    /// (커뮤니티 안에서 커뮤니티를 틀면 끝없이 파고든다).</summary>
    private static (string? itemsJson, string? error) ValidateItems(
        CommunityPlaylist playlist, List<CommunityPlaylistItemIn> items)
    {
        var cleaned = new JsonArray();
        foreach (var item in items)
        {
            if (item.DurationSec is < 1 or > 86400)
                return (null, "표출 시간은 1~86400초여야 합니다.");
            if (item.Document is not JsonObject document
                || document["elements"] is not JsonArray elements)
                return (null, ItemDocumentRequired);
            foreach (var element in elements)
            {
                if (element is JsonObject el
                    && el["type"]?.GetValue<string?>() == "widget"
                    && el["widget_key"]?.GetValue<string?>() == "community")
                    return (null, NestedCommunityWidget);
            }
            cleaned.Add(new JsonObject
            {
                ["document"] = document.DeepClone(),
                ["duration_sec"] = item.DurationSec,
            });
        }
        return (cleaned.ToJsonString(), null);
    }

    /// <summary>표출할 칸 — 문서를 가진 칸만. 옛 모양(파일 참조·QR)은 표출하지 않는다.</summary>
    public static List<JsonObject> ResolveItems(CommunityPlaylist playlist)
    {
        var resolved = new List<JsonObject>();
        if (Json.Parse(playlist.ItemsJson) is not JsonArray items) return resolved;
        foreach (var item in items)
        {
            if (item is JsonObject obj && obj["document"] is JsonObject)
                resolved.Add((JsonObject)obj.DeepClone());
        }
        return resolved;
    }

    /// <summary>전체 재생시간 — 실제로 재생될 칸들의 표출 시간 합.</summary>
    public static int TotalDurationSec(List<JsonObject> resolvedItems) =>
        resolvedItems.Sum(item => item["duration_sec"]?.GetValue<int?>() ?? 0);

    private async Task<CommunityPlaylistOut> ToOut(CommunityPlaylist playlist, AppUser actor)
    {
        var items = ResolveItems(playlist);
        // 올린 파일 전부(올린 순서) — 편집기의 왼쪽 재료 칸이 쓴다.
        var uploads = playlist.AssetLinks
            .Where(l => l.Asset is not null)
            .OrderBy(l => l.Id)
            .Select(l => new JsonObject
            {
                ["id"] = l.Asset.Id,
                ["kind"] = l.Asset.Kind,
                ["filename"] = l.Asset.Filename,
                ["url"] = AssetService.PublicUrl(l.Asset),
                ["thumb_url"] = AssetService.ThumbUrl(l.Asset),
            })
            .ToList();
        return new CommunityPlaylistOut(
            playlist.Id, playlist.OrgId, playlist.AuthorId,
            // 게시자가 적은 표시 이름이 먼저, 없으면 계정 이름.
            playlist.AuthorName ?? playlist.Author?.Name, playlist.Contact,
            playlist.Title, playlist.Memo, ParseTargets(playlist.TargetOrgTypesJson),
            playlist.NoticeStart, playlist.NoticeEnd, playlist.PublishStatus, playlist.Version,
            playlist.CreatedAt, playlist.UpdatedAt,
            items, uploads, TotalDurationSec(items),
            PermissionService.CanRemoveShared(actor, playlist.AuthorId),
            PermissionService.CanRemoveShared(actor, playlist.AuthorId),
            await permissions.CanPublishAsync(actor, playlist.OrgId));
    }

    // ---------------------------------------------------------------- 메타·팝업

    private static List<string> ParseTargets(string json)
    {
        try
        {
            return Json.Parse(json) is JsonArray arr
                ? arr.Select(n => n?.GetValue<string>() ?? "").Where(s => s.Length > 0).ToList()
                : [];
        }
        catch
        {
            return [];
        }
    }

    private static string ToTargetsJson(List<string>? targets)
    {
        var arr = new JsonArray();
        foreach (var name in (targets ?? []).Select(t => t.Trim()).Where(t => t.Length > 0))
            arr.Add(name);
        return arr.ToJsonString();
    }

    /// <summary>기관구분 마스터가 허용하는 공지대상 토큰.
    /// "학교" 는 구분 전체, "학교:초" 는 그 구분의 분류(세부 구분)만이다.
    /// 이름을 쪼개 해석하지 않고 허용 토큰 집합의 멤버십으로 검사한다.</summary>
    private async Task<HashSet<string>> AllowedTargetTokensAsync()
    {
        var allowed = new HashSet<string>();
        var rows = await db.OrgTypes.Select(t => new { t.Name, t.Classifications }).ToListAsync();
        foreach (var row in rows)
        {
            allowed.Add(row.Name);
            foreach (var cls in (row.Classifications ?? "").Split(','))
                if (cls.Trim().Length > 0)
                    allowed.Add($"{row.Name}:{cls.Trim()}");
        }
        return allowed;
    }

    /// <summary>공지대상은 기관구분 마스터의 이름(또는 이름:분류)만, 기간은 YYYY-MM-DD.</summary>
    private async Task<string?> ValidateMetaAsync(
        List<string>? targets, string? noticeStart, string? noticeEnd)
    {
        if (targets is { Count: > 0 })
        {
            var allowed = await AllowedTargetTokensAsync();
            foreach (var name in targets.Select(t => t.Trim()).Where(t => t.Length > 0))
                if (!allowed.Contains(name))
                    return "공지대상은 기관구분에서 골라야 합니다.";
        }
        foreach (var value in new[] { noticeStart, noticeEnd })
        {
            if (string.IsNullOrWhiteSpace(value)) continue;
            if (!DateOnly.TryParseExact(value.Trim(), "yyyy-MM-dd", out _))
                return "공지희망기간은 YYYY-MM-DD 형식이어야 합니다.";
        }
        if (!string.IsNullOrWhiteSpace(noticeStart) && !string.IsNullOrWhiteSpace(noticeEnd)
            && string.CompareOrdinal(noticeStart.Trim(), noticeEnd.Trim()) > 0)
            return "공지희망기간의 시작이 종료보다 늦을 수 없습니다.";
        return null;
    }

    /// <summary>로그인 팝업 — 내 커뮤니티의 '게시' 글 중, 공지대상이 비었거나
    /// 내 기관의 기관구분을 포함하고, 공지희망기간 안인 것만.</summary>
    [HttpGet("popup")]
    public async Task<ActionResult<List<CommunityNoticeOut>>> Popup()
    {
        var user = HttpContext.CurrentUser()!;
        var mine = await permissions.CommunityOrgOfAsync(user.OrgId);
        if (mine is null) return new List<CommunityNoticeOut>();
        var org = await db.Organizations.FindAsync(mine.Value);
        if (org is null) return new List<CommunityNoticeOut>();

        // 내 기관이 받을 수 있는 토큰: 구분 전체("학교")와 세부 구분("학교:초").
        var myOrg = await db.Organizations.FindAsync(user.OrgId);
        var myTokens = new HashSet<string>();
        if (myOrg is not null)
        {
            myTokens.Add(myOrg.OrgType);
            if (!string.IsNullOrEmpty(myOrg.SchoolLevel))
                myTokens.Add($"{myOrg.OrgType}:{myOrg.SchoolLevel}");
        }
        var today = DateTime.Now.ToString("yyyy-MM-dd");

        var rows = await db.CommunityPlaylists
            .Include(p => p.Author)
            .Where(p => p.OrgId == mine.Value && p.PublishStatus == "게시")
            .OrderByDescending(p => p.Id)
            .ToListAsync();

        var notices = new List<CommunityNoticeOut>();
        foreach (var row in rows)
        {
            var targets = ParseTargets(row.TargetOrgTypesJson);
            if (targets.Count > 0 && !targets.Any(myTokens.Contains)) continue;
            if (row.NoticeStart is not null && string.CompareOrdinal(today, row.NoticeStart) < 0) continue;
            if (row.NoticeEnd is not null && string.CompareOrdinal(today, row.NoticeEnd) > 0) continue;
            notices.Add(new CommunityNoticeOut(
                row.Id, org.Id, org.Name, row.Title, row.Memo, row.Contact,
                row.AuthorName ?? row.Author?.Name, targets,
                row.NoticeStart, row.NoticeEnd));
        }
        return notices;
    }

    private static AssetOut ToAssetOut(Asset asset) => new(
        asset.Id, asset.OrgId, asset.UploadedBy, asset.Kind, asset.Filename,
        asset.ContentType, asset.SizeBytes,
        AssetService.PublicUrl(asset), AssetService.ThumbUrl(asset));
}

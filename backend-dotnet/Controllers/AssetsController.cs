// 업로드 자산 — FastAPI /api/v1/assets 의 짝(전체 이식).
//
// 파일 내려받기는 인증을 요구하지 않는다. <img>·<video> 는 헤더를 붙일 수
// 없어서, 대신 주소에 알아맞힐 수 없는 열쇠를 넣는다. 열쇠가 틀리면
// '없다'고 답한다 — 어떤 id 가 존재하는지 드러내지 않기 위해서다.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record AssetDetailOut(
    int Id, int OrgId, int? UploadedBy, string Kind, string Filename,
    string ContentType, long SizeBytes, DateTime CreatedAt,
    string Url, string? ThumbUrl, string? OrgName, int UsageCount);

public record AssetUpdate(string Filename);

[ApiController]
[Route("api/v1/assets")]
[Authorize]
public class AssetsController(
    AppDbContext db, AssetService assets, PermissionService permissions, OrgTreeService orgTree,
    VideoTranscodeService transcode)
    : ControllerBase
{
    private async Task<AssetDetailOut> ToOut(Asset asset)
    {
        var org = await db.Organizations.FindAsync(asset.OrgId);
        return new AssetDetailOut(
            asset.Id, asset.OrgId, asset.UploadedBy, asset.Kind, asset.Filename,
            asset.ContentType, asset.SizeBytes, asset.CreatedAt,
            AssetService.PublicUrl(asset), AssetService.ThumbUrl(asset),
            org?.Name, await assets.UsageCountAsync(asset.Id));
    }

    /// <summary>자산은 기관 자원 — 기관을 관리하거나 본인이 올린 것이면 다룰 수 있다.</summary>
    private async Task<bool> CanManageAsync(AppUser actor, Asset asset) =>
        await permissions.CanManageOrgAsync(actor, asset.OrgId) || asset.UploadedBy == actor.Id;

    [HttpGet("")]
    public async Task<ActionResult<PageOut<AssetDetailOut>>> List(
        [FromQuery] string? q, [FromQuery] string? kind,
        [FromQuery(Name = "org_id")] int? orgId,
        [FromQuery] int page = 1, [FromQuery] int size = 24)
    {
        var actor = HttpContext.CurrentUser()!;
        var query = db.Assets.AsQueryable();
        var scope = await permissions.ManagedOrgIdsAsync(actor);
        if (scope is not null) query = query.Where(a => scope.Contains(a.OrgId));
        if (!string.IsNullOrEmpty(q))
            query = query.Where(a => EF.Functions.Like(a.Filename, $"%{q}%"));
        if (!string.IsNullOrEmpty(kind))
        {
            if (kind is not ("image" or "video"))
                return BadRequest(new { detail = $"알 수 없는 갈래입니다: {kind}" });
            query = query.Where(a => a.Kind == kind);
        }
        if (orgId is int org)
        {
            if (!await permissions.CanViewOrgAsync(actor, org))
                return StatusCode(403, new { detail = "해당 기관의 파일을 조회할 권한이 없습니다." });
            var subtree = await orgTree.DescendantIdsAsync(org);
            query = query.Where(a => subtree.Contains(a.OrgId));
        }

        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(a => a.CreatedAt)
            .Skip((page - 1) * size).Take(Math.Clamp(size, 1, 200)).ToListAsync();
        var items = new List<AssetDetailOut>();
        foreach (var row in rows) items.Add(await ToOut(row));
        return new PageOut<AssetDetailOut>(items, total, page, size);
    }

    [HttpPost("")]
    [RequestSizeLimit(AssetService.MaxVideoBytes + 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = AssetService.MaxVideoBytes + 1024 * 1024)]
    public async Task<ActionResult<AssetDetailOut>> Upload(
        IFormFile file, [FromQuery(Name = "org_id")] int? orgId)
    {
        var actor = HttpContext.CurrentUser()!;
        var kind = AssetService.KindOf(file.ContentType);
        if (kind is null)
            return BadRequest(new { detail = $"지원하지 않는 형식입니다: {file.ContentType}" });

        var targetOrg = orgId ?? actor.OrgId;
        if (!await permissions.CanManageOrgAsync(actor, targetOrg))
            return StatusCode(403, new { detail = "해당 기관에 파일을 올릴 권한이 없습니다." });

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
            OrgId = targetOrg,
            UploadedBy = actor.Id,
            Kind = kind,
            Filename = string.IsNullOrEmpty(file.FileName) ? "upload" : file.FileName,
            ContentType = contentType,
            SizeBytes = size,
            StoragePath = stored,
            CreatedAt = now,
            UpdatedAt = now,
        };
        assets.AttachThumbnail(asset);  // 실패하면 null — 업로드는 그대로 성공.
        db.Assets.Add(asset);
        await db.SaveChangesAsync();
        return StatusCode(201, await ToOut(asset));
    }

    [HttpGet("{assetId:int}")]
    public async Task<ActionResult<AssetDetailOut>> Get(int assetId)
    {
        var actor = HttpContext.CurrentUser()!;
        var asset = await db.Assets.FindAsync(assetId);
        if (asset is null) return NotFound(new { detail = "파일을(를) 찾을 수 없습니다." });
        if (!await permissions.CanViewOrgAsync(actor, asset.OrgId))
            return StatusCode(403, new { detail = "해당 파일을 조회할 권한이 없습니다." });
        return await ToOut(asset);
    }

    [HttpGet("{assetId:int}/{token}/file")]
    [AllowAnonymous]
    public async Task<IActionResult> Download(int assetId, string token)
    {
        var asset = await db.Assets.FindAsync(assetId);
        if (asset is null || token != asset.Token)
            return NotFound(new { detail = "파일을(를) 찾을 수 없습니다." });

        var path = assets.AbsolutePath(asset);
        if (!System.IO.File.Exists(path))
            return NotFound(new { detail = "파일을(를) 찾을 수 없습니다." });

        Response.Headers.CacheControl = "public, max-age=604800, immutable";
        return PhysicalFile(path, asset.ContentType, asset.Filename, enableRangeProcessing: true);
    }

    [HttpGet("{assetId:int}/{token}/thumb")]
    [AllowAnonymous]
    public async Task<IActionResult> Thumb(int assetId, string token)
    {
        var asset = await db.Assets.FindAsync(assetId);
        if (asset is null || token != asset.Token || asset.ThumbPath is null)
            return NotFound(new { detail = "썸네일을(를) 찾을 수 없습니다." });

        var path = Path.Combine(assets.MediaRoot,
            asset.ThumbPath.Replace('/', Path.DirectorySeparatorChar));
        if (!System.IO.File.Exists(path))
            return NotFound(new { detail = "썸네일을(를) 찾을 수 없습니다." });

        Response.Headers.CacheControl = "public, max-age=604800, immutable";
        return PhysicalFile(path, "image/jpeg");
    }

    [HttpPut("{assetId:int}")]
    public async Task<ActionResult<AssetDetailOut>> Update(int assetId, AssetUpdate payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var asset = await db.Assets.FindAsync(assetId);
        if (asset is null) return NotFound(new { detail = "파일을(를) 찾을 수 없습니다." });
        if (!await CanManageAsync(actor, asset))
            return StatusCode(403, new { detail = "해당 파일을 다룰 권한이 없습니다." });

        asset.Filename = payload.Filename.Trim();
        asset.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return await ToOut(asset);
    }

    [HttpDelete("{assetId:int}")]
    public async Task<ActionResult<Message>> Delete(int assetId)
    {
        var actor = HttpContext.CurrentUser()!;
        var asset = await db.Assets.FindAsync(assetId);
        if (asset is null) return NotFound(new { detail = "파일을(를) 찾을 수 없습니다." });
        if (!await CanManageAsync(actor, asset))
            return StatusCode(403, new { detail = "해당 파일을 다룰 권한이 없습니다." });

        // 쓰는 콘텐츠가 있으면 막는다 — 지우고 나서야 화면이 깨지면 늦다.
        var used = await assets.UsageCountAsync(asset.Id);
        if (used > 0)
            return BadRequest(new { detail = $"콘텐츠 {used}건에서 사용 중이라 삭제할 수 없습니다." });

        assets.RemoveFile(asset);
        db.Assets.Remove(asset);
        await db.SaveChangesAsync();
        return new Message("파일을 삭제했습니다.");
    }
}

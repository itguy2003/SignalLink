// Canva Connect 연동 — FastAPI /api/v1/canva 의 짝.
//
// 흐름: [연결] → authorize 주소로 팝업 → Canva 동의 → callback(비인증,
// state 로 사용자 연결) → 이후 디자인 목록/가져오기. 가져오기는 PNG 로
// 내보내 자산 라이브러리에 저장한다 — 편집기가 여느 이미지처럼 쓴다.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record CanvaStatusOut(bool Configured, bool Connected);

public record CanvaImportIn(string DesignId, int? OrgId, string? Title);

[ApiController]
[Route("api/v1/canva")]
[Authorize]
public class CanvaController(
    AppDbContext db, CanvaConnectService canva, AssetService assets,
    PermissionService permissions) : ControllerBase
{
    private const string NotConfigured =
        "Canva 연동이 설정되지 않았습니다. 서버의 CANVA_CLIENT_ID/SECRET 을 지정하세요.";

    private const string NotConnected = "Canva 계정이 연결되지 않았습니다. 먼저 연결해 주세요.";

    [HttpGet("status")]
    public async Task<ActionResult<CanvaStatusOut>> Status()
    {
        var actor = HttpContext.CurrentUser()!;
        var connected = canva.IsConfigured && await canva.AccountOfAsync(actor.Id) is not null;
        return new CanvaStatusOut(canva.IsConfigured, connected);
    }

    [HttpPost("authorize")]
    public ActionResult<object> Authorize()
    {
        var actor = HttpContext.CurrentUser()!;
        if (!canva.IsConfigured) return BadRequest(new { detail = NotConfigured });
        var url = canva.CreateAuthorizeUrl(actor.Id, canva.RedirectUri(Request));
        return new { url };
    }

    /// <summary>Canva 가 사용자를 돌려보내는 자리 — 팝업 안이라 짧은 안내만 그린다.</summary>
    [HttpGet("callback")]
    [AllowAnonymous]
    public async Task<ContentResult> Callback([FromQuery] string? code, [FromQuery] string? state)
    {
        string message;
        if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
        {
            message = "연결이 취소되었습니다. 창을 닫아 주세요.";
        }
        else if (canva.TakeState(state) is not { } pending)
        {
            message = "연결 요청이 만료되었습니다. 창을 닫고 다시 시도해 주세요.";
        }
        else
        {
            try
            {
                await canva.ExchangeCodeAsync(
                    pending.UserId, code, pending.Verifier, canva.RedirectUri(Request));
                message = "Canva 계정이 연결되었습니다. 창을 닫아 주세요.";
            }
            catch (CanvaException exc)
            {
                message = exc.Message;
            }
        }
        var html = "<!doctype html><meta charset=\"utf-8\"><body style=\"font-family:sans-serif;"
            + "display:grid;place-items:center;height:100vh;margin:0;background:#0b1120;color:#e2e8f0\">"
            + $"<div><p>{message}</p></div><script>setTimeout(() => window.close(), 1500)</script></body>";
        return Content(html, "text/html; charset=utf-8");
    }

    [HttpDelete("connection")]
    public async Task<ActionResult<Message>> Disconnect()
    {
        var actor = HttpContext.CurrentUser()!;
        await canva.DisconnectAsync(actor.Id);
        return new Message("Canva 연결을 해제했습니다.");
    }

    [HttpGet("designs")]
    public async Task<ActionResult<JsonObject>> Designs(
        [FromQuery] string? query, [FromQuery] string? continuation)
    {
        var actor = HttpContext.CurrentUser()!;
        if (!canva.IsConfigured) return BadRequest(new { detail = NotConfigured });
        var account = await canva.AccountOfAsync(actor.Id);
        if (account is null) return BadRequest(new { detail = NotConnected });
        try
        {
            return await canva.ListDesignsAsync(account, query, continuation);
        }
        catch (CanvaException exc)
        {
            return StatusCode(exc.Status, new { detail = exc.Message });
        }
    }

    /// <summary>디자인을 PNG 로 내보내 자산으로 저장한다. 여러 장이면 장마다 하나.</summary>
    [HttpPost("import")]
    public async Task<ActionResult<List<AssetDetailOut>>> Import(CanvaImportIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        if (!canva.IsConfigured) return BadRequest(new { detail = NotConfigured });
        var account = await canva.AccountOfAsync(actor.Id);
        if (account is null) return BadRequest(new { detail = NotConnected });

        var targetOrg = payload.OrgId ?? actor.OrgId;
        if (!await permissions.CanManageOrgAsync(actor, targetOrg))
            return StatusCode(403, new { detail = "해당 기관에 파일을 올릴 권한이 없습니다." });

        List<byte[]> pages;
        try
        {
            pages = await canva.ExportDesignAsync(account, payload.DesignId);
        }
        catch (CanvaException exc)
        {
            return StatusCode(exc.Status, new { detail = exc.Message });
        }

        var title = string.IsNullOrWhiteSpace(payload.Title) ? "canva" : payload.Title.Trim();
        var now = DateTime.UtcNow;
        var created = new List<Asset>();
        foreach (var (data, index) in pages.Select((data, index) => (data, index)))
        {
            var relative = AssetService.RelativeMediaPath("image", ".png");
            var path = Path.Combine(
                assets.MediaRoot, relative.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await System.IO.File.WriteAllBytesAsync(path, data);

            var asset = new Asset
            {
                OrgId = targetOrg,
                UploadedBy = actor.Id,
                Kind = "image",
                Filename = pages.Count > 1 ? $"{title}-{index + 1}.png" : $"{title}.png",
                ContentType = "image/png",
                SizeBytes = data.Length,
                StoragePath = relative,
                CreatedAt = now,
                UpdatedAt = now,
            };
            assets.AttachThumbnail(asset);
            db.Assets.Add(asset);
            created.Add(asset);
        }
        await db.SaveChangesAsync();

        var org = await db.Organizations.FindAsync(targetOrg);
        return StatusCode(201, created.Select(asset => new AssetDetailOut(
            asset.Id, asset.OrgId, asset.UploadedBy, asset.Kind, asset.Filename,
            asset.ContentType, asset.SizeBytes, asset.CreatedAt,
            AssetService.PublicUrl(asset), AssetService.ThumbUrl(asset),
            org?.Name, 0)).ToList());
    }
}

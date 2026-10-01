// 위젯 목록·데이터 — FastAPI /api/v1/widgets 의 짝(전체 이식).
//
// CMS 사용자(미리보기)와 장치(플레이어) 양쪽에서 호출된다. 장치는
// X-Device-Token 을 보내며, 이 경우 기관은 장치 소속으로 고정된다.

using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

[ApiController]
[Route("api/v1/widgets")]
public class WidgetsController(
    AppDbContext db, WidgetDataService widgetData, PermissionService permissions,
    DeviceAuthService deviceAuth) : ControllerBase
{
    [HttpGet("")]
    [Authorize]
    public ActionResult<List<JsonObject>> ListWidgets()
    {
        if (HttpContext.CurrentUser() is null)
            return Unauthorized(new { detail = "인증이 필요합니다." });
        return WidgetRegistry.ListWidgets();
    }

    [HttpGet("{key}/data")]
    [AllowAnonymous]  // 인증은 아래에서 직접 가른다 — 사용자 토큰 또는 장치 토큰.
    public async Task<ActionResult<JsonObject>> WidgetData(
        string key,
        [FromQuery(Name = "org_id")] int? orgId,
        [FromQuery] string? options)
    {
        if (!WidgetRegistry.Exists(key))
            return NotFound(new { detail = "위젯을(를) 찾을 수 없습니다." });

        JsonObject parsedOptions = [];
        if (!string.IsNullOrEmpty(options))
        {
            try
            {
                parsedOptions = JsonNode.Parse(options) as JsonObject
                    ?? throw new FormatException();
            }
            catch (Exception)
            {
                return BadRequest(new { detail = "options 는 JSON 이어야 합니다." });
            }
        }

        var (resolvedOrgId, error) = await ResolveOrgAsync(orgId);
        if (error is not null) return error;

        var data = await widgetData.FetchAsync(key, resolvedOrgId, parsedOptions);
        return new JsonObject
        {
            ["key"] = key,
            ["fetched_at"] = DateTime.UtcNow.ToString("o"),
            ["data"] = data,
        };
    }

    private async Task<(int orgId, ActionResult? error)> ResolveOrgAsync(int? orgId)
    {
        // 장치 토큰이 있으면 기관은 장치 소속으로 고정된다.
        var deviceToken = Request.Headers["X-Device-Token"].ToString();
        if (!string.IsNullOrEmpty(deviceToken))
        {
            try
            {
                var device = await deviceAuth.ResolveDeviceAsync(deviceToken);
                return (device.OrgId, null);
            }
            catch (DeviceAuthException exc)
            {
                return (0, StatusCode(403, new { detail = exc.Message }));
            }
        }

        // 아니면 CMS 사용자 토큰 — JwtBearer 인증이 성공했으면 미들웨어가 실어 뒀다.
        var user = HttpContext.CurrentUser();
        if (user is null)
            return (0, StatusCode(403, new { detail = "인증 정보가 없습니다." }));

        var target = orgId ?? user.OrgId;
        if (!await permissions.CanViewOrgAsync(user, target))
            return (0, StatusCode(403, new { detail = "해당 기관의 위젯 데이터를 조회할 권한이 없습니다." }));
        return (target, null);
    }
}

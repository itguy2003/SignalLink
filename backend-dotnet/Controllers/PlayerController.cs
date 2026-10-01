// 플레이어(장치)용 — FastAPI /api/v1/player 의 짝(전체 이식).
//
// 인증 흐름: 장치가 고유번호로 provision → 세션 토큰 발급 → 이후
// X-Device-Token 헤더. WebSocket 은 /player/ws?token= 으로 접속하고
// 이후 모든 메시지는 AES-256-GCM 봉투다.

using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record DeviceProvisionRequest(
    string DeviceCode, string? AppVersion, string? Os, int? Width, int? Height,
    string? Cpu, string? Memory, string? Storage);

public record DeviceProvisionResponse(
    int DeviceId, string DeviceCode, string Name, int OrgId, string PanelType,
    int? Width, int? Height, int ScheduleVersion, int HeartbeatIntervalSec,
    string WsUrl, string DeviceToken);

public record HeartbeatRequest(
    int? ScheduleVersion, string? AppVersion, string? Status,
    long? StorageTotalBytes, long? StorageFreeBytes);

public record HeartbeatResponse(
    DateTime ServerTime, int ScheduleVersion, bool ScheduleChanged, int HeartbeatIntervalSec);

[ApiController]
[Route("api/v1/player")]
public class PlayerController(
    AppDbContext db, DeviceAuthService deviceAuth, ScheduleCoreService scheduleCore,
    ConnectionHub hub, DeviceCrypto crypto, IConfiguration config) : ControllerBase
{
    private int HeartbeatIntervalSec =>
        int.TryParse(config["HeartbeatIntervalSec"], out var sec) ? sec : 30;

    private const long MaxScreenshotBytes = 4 * 1024 * 1024;
    private static readonly string[] AllowedScreenshotTypes =
        ["image/jpeg", "image/png", "image/webp"];

    private async Task<(Device? device, ActionResult? error)> CurrentDeviceAsync()
    {
        var token = Request.Headers["X-Device-Token"].ToString();
        if (string.IsNullOrEmpty(token))
            return (null, Unauthorized(new { detail = "장치 토큰이 없습니다." }));
        try
        {
            return (await deviceAuth.ResolveDeviceAsync(token), null);
        }
        catch (DeviceAuthException exc)
        {
            return (null, Unauthorized(new { detail = exc.Message }));
        }
    }

    [HttpPost("provision")]
    [AllowAnonymous]
    public async Task<ActionResult<DeviceProvisionResponse>> Provision(DeviceProvisionRequest payload)
    {
        Device device;
        try
        {
            device = await deviceAuth.AuthenticateByCodeAsync(payload.DeviceCode);
        }
        catch (DeviceAuthException exc)
        {
            return Unauthorized(new { detail = exc.Message });
        }

        // 장치가 보고한 하드웨어 정보로 등록 정보를 보완한다.
        if (!string.IsNullOrEmpty(payload.AppVersion)) device.AppVersion = payload.AppVersion;
        if (!string.IsNullOrEmpty(payload.Cpu)) device.Cpu = payload.Cpu;
        if (!string.IsNullOrEmpty(payload.Memory)) device.Memory = payload.Memory;
        if (!string.IsNullOrEmpty(payload.Storage)) device.Storage = payload.Storage;
        if (payload.Width is int width && width > 0) device.Width = width;
        if (payload.Height is int height && height > 0) device.Height = height;
        device.LastSeenAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var scheme = Request.Scheme == "https" ? "wss" : "ws";
        var wsUrl = $"{scheme}://{Request.Host}/api/v1/player/ws";

        return new DeviceProvisionResponse(
            device.Id, device.DeviceCode, device.Name, device.OrgId, device.PanelType,
            device.Width, device.Height,
            ScheduleCoreService.CurrentVersion(device), HeartbeatIntervalSec,
            wsUrl, deviceAuth.CreateDeviceToken(device));
    }

    [HttpGet("schedule")]
    public async Task<ActionResult<JsonObject>> GetSchedule()
    {
        var (device, error) = await CurrentDeviceAsync();
        if (error is not null) return error;

        var payload = await scheduleCore.BuildPayloadAsync(device!);
        // 장치가 실제로 받아간 버전을 기록 — 하트비트 비교의 기준이 된다.
        device!.Version = payload["version"]!.GetValue<int>();
        device.LastSeenAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return payload;
    }

    [HttpPost("heartbeat")]
    public async Task<ActionResult<HeartbeatResponse>> Heartbeat(HeartbeatRequest payload)
    {
        var (device, error) = await CurrentDeviceAsync();
        if (error is not null) return error;

        var serverVersion = ScheduleCoreService.CurrentVersion(device!);
        var reported = payload.ScheduleVersion ?? device!.Version;

        device!.LastSeenAt = DateTime.UtcNow;
        if (!string.IsNullOrEmpty(payload.AppVersion)) device.AppVersion = payload.AppVersion;
        DeviceStorage.RecordReport(device, payload.StorageTotalBytes, payload.StorageFreeBytes);
        await db.SaveChangesAsync();

        return new HeartbeatResponse(
            DateTime.UtcNow, serverVersion, reported != serverVersion, HeartbeatIntervalSec);
    }

    [HttpPost("screenshot")]
    public async Task<ActionResult<Message>> UploadScreenshot(IFormFile file)
    {
        var (device, error) = await CurrentDeviceAsync();
        if (error is not null) return error;

        if (!AllowedScreenshotTypes.Contains(file.ContentType))
            return BadRequest(new { detail = $"지원하지 않는 이미지 형식입니다: {file.ContentType}" });

        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        var data = stream.ToArray();
        if (data.Length == 0) return BadRequest(new { detail = "빈 파일입니다." });
        if (data.Length > MaxScreenshotBytes)
            return StatusCode(413, new { detail = $"캡처는 {MaxScreenshotBytes / (1024 * 1024)}MB 이하여야 합니다." });

        var now = DateTime.UtcNow;
        var shot = await db.DeviceScreenshots.SingleOrDefaultAsync(s => s.DeviceId == device!.Id);
        if (shot is null)
        {
            db.DeviceScreenshots.Add(new DeviceScreenshot
            {
                DeviceId = device!.Id,
                Image = data,
                ContentType = file.ContentType,
                CapturedAt = now,
            });
        }
        else
        {
            shot.Image = data;
            shot.ContentType = file.ContentType;
            shot.CapturedAt = now;
        }
        device!.LastSeenAt = now;  // 캡처를 올렸다는 것은 살아 있다는 뜻.
        await db.SaveChangesAsync();
        return new Message("화면 캡처를 저장했습니다.");
    }

    [HttpGet("stats")]
    public ActionResult<object> Stats() => new { online_count = hub.OnlineIds().Count };

    // ---------------------------------------------------------------- WebSocket

    private const int WsUnauthorized = 4401;
    private const int WsBadMessage = 4400;

    /// <summary>장치 제어 채널 — 핸드셰이크 이후 모든 메시지는 AES-GCM 봉투다.</summary>
    [Route("/api/v1/player/ws")]
    [HttpGet]
    [AllowAnonymous]
    public async Task DeviceChannel([FromQuery] string token)
    {
        if (!HttpContext.WebSockets.IsWebSocketRequest)
        {
            HttpContext.Response.StatusCode = 400;
            return;
        }

        Device device;
        try
        {
            device = await deviceAuth.ResolveDeviceAsync(token);
        }
        catch (DeviceAuthException)
        {
            // accept 전에는 close 코드만 전달할 수 있다.
            var reject = await HttpContext.WebSockets.AcceptWebSocketAsync();
            await reject.CloseAsync((WebSocketCloseStatus)WsUnauthorized, "장치 토큰이 유효하지 않습니다.", default);
            return;
        }

        var socket = await HttpContext.WebSockets.AcceptWebSocketAsync();
        var conn = hub.Connect(device.Id, device.DeviceCode, socket);

        await SendEncryptedAsync(socket, device.DeviceCode, new
        {
            type = "welcome",
            device_id = device.Id,
            schedule_version = ScheduleCoreService.CurrentVersion(device),
            heartbeat_interval_sec = HeartbeatIntervalSec,
            server_time = DateTime.UtcNow.ToString("o"),
        });

        var buffer = new byte[64 * 1024];
        try
        {
            while (socket.State == WebSocketState.Open)
            {
                var text = await ReceiveTextAsync(socket, buffer);
                if (text is null) break;  // 닫힘

                JsonObject message;
                try
                {
                    message = crypto.DecryptFromDevice(device.DeviceCode, text);
                }
                catch (DecryptException)
                {
                    await socket.CloseAsync((WebSocketCloseStatus)WsBadMessage, "복호화 실패", default);
                    return;
                }
                await HandleMessageAsync(socket, conn, device.Id, device.DeviceCode, message);
            }
        }
        catch (WebSocketException)
        {
            // 장치 접속 종료 — 정상 흐름이다.
        }
        finally
        {
            hub.Disconnect(device.Id, socket);
        }
    }

    private static async Task<string?> ReceiveTextAsync(WebSocket socket, byte[] buffer)
    {
        using var whole = new MemoryStream();
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, CancellationToken.None);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            whole.Write(buffer, 0, result.Count);
            if (result.EndOfMessage) break;
        }
        return Encoding.UTF8.GetString(whole.ToArray());
    }

    private async Task SendEncryptedAsync(WebSocket socket, string deviceCode, object payload)
    {
        var envelope = crypto.EncryptForDevice(deviceCode, payload);
        await socket.SendAsync(Encoding.UTF8.GetBytes(envelope),
            WebSocketMessageType.Text, endOfMessage: true, CancellationToken.None);
    }

    private async Task HandleMessageAsync(
        WebSocket socket, DeviceConnection conn, int deviceId, string deviceCode, JsonObject message)
    {
        var msgType = message["type"]?.GetValue<string?>();

        if (msgType == "heartbeat")
        {
            conn.LastHeartbeatAt = DateTime.UtcNow;
            var serverVersion = await TouchDeviceAsync(deviceId, message);
            var reported = message["schedule_version"] is JsonValue value
                && value.TryGetValue<int>(out var v) ? v : (int?)null;
            await SendEncryptedAsync(socket, deviceCode, new
            {
                type = "heartbeat_ack",
                server_time = DateTime.UtcNow.ToString("o"),
                schedule_version = serverVersion,
                // True 면 장치는 REST 로 스케줄을 다시 받는다.
                schedule_changed = reported != serverVersion,
            });
            return;
        }

        if (msgType is "status" or "ack")
        {
            conn.LastHeartbeatAt = DateTime.UtcNow;  // 재생 상태 보고 — 접속 시각만 갱신.
            return;
        }

        await SendEncryptedAsync(socket, deviceCode, new
        {
            type = "error",
            detail = $"알 수 없는 메시지 타입: {msgType}",
        });
    }

    /// <summary>하트비트 내용을 반영하고 현재 서버 스케줄 버전을 돌려준다.</summary>
    private async Task<int> TouchDeviceAsync(int deviceId, JsonObject message)
    {
        var device = await db.Devices
            .Include(d => d.ScheduleLinks).ThenInclude(l => l.Schedule)
            .SingleOrDefaultAsync(d => d.Id == deviceId);
        if (device is null) return ScheduleCoreService.DemoVersion;

        device.LastSeenAt = DateTime.UtcNow;
        if (message["app_version"]?.GetValue<string?>() is { Length: > 0 } appVersion)
            device.AppVersion = appVersion;
        DeviceStorage.RecordReport(device, AsBytes(message["storage_total_bytes"]),
            AsBytes(message["storage_free_bytes"]));
        var version = ScheduleCoreService.CurrentVersion(device);
        await db.SaveChangesAsync();
        return version;
    }

    /// <summary>형식이 어긋나도 하트비트 전체가 죽지 않아야 한다 — 저장공간은 부가 정보다.</summary>
    private static long? AsBytes(JsonNode? node)
    {
        if (node is not JsonValue value) return null;
        if (!value.TryGetValue<double>(out var number)) return null;
        return number >= 0 ? (long)number : null;
    }
}

// 장치 WebSocket 연결 관리 + 푸시 — FastAPI(ws_hub.py + notify.py)의 짝.
//
// 프로세스 로컬 레지스트리다. 서버를 여러 인스턴스로 확장하면 Redis Pub/Sub
// 등 외부 브로커로 push 를 중계해야 한다 — 그 교체 지점을 좁히기 위해
// 컨트롤러는 이 클래스의 메서드만 부른다.

using System.Net.WebSockets;
using System.Text;

namespace SignalLink.Api.Services;

public class DeviceConnection(int deviceId, string deviceCode, WebSocket socket)
{
    public int DeviceId { get; } = deviceId;
    public string DeviceCode { get; } = deviceCode;
    public WebSocket Socket { get; } = socket;
    public DateTime ConnectedAt { get; } = DateTime.UtcNow;
    public DateTime? LastHeartbeatAt { get; set; }
    /// <summary>한 소켓에 동시 전송이 겹치지 않게.</summary>
    public SemaphoreSlim SendLock { get; } = new(1, 1);
}

public class ConnectionHub
{
    private readonly Dictionary<int, DeviceConnection> _connections = [];
    private readonly object _lock = new();

    public DeviceConnection Connect(int deviceId, string deviceCode, WebSocket socket)
    {
        DeviceConnection? previous = null;
        var conn = new DeviceConnection(deviceId, deviceCode, socket);
        lock (_lock)
        {
            _connections.TryGetValue(deviceId, out previous);
            _connections[deviceId] = conn;
        }
        // 같은 장치가 재접속하면 이전 연결을 정리한다.
        if (previous is not null)
        {
            _ = previous.Socket.CloseAsync(
                (WebSocketCloseStatus)4000, "다른 세션에서 재접속", CancellationToken.None)
                .ContinueWith(_ => { });
        }
        return conn;
    }

    public void Disconnect(int deviceId, WebSocket socket)
    {
        lock (_lock)
        {
            // 재접속으로 이미 교체된 경우 지우지 않는다.
            if (_connections.TryGetValue(deviceId, out var conn) && conn.Socket == socket)
                _connections.Remove(deviceId);
        }
    }

    public bool IsOnline(int deviceId)
    {
        lock (_lock) return _connections.ContainsKey(deviceId);
    }

    public HashSet<int> OnlineIds()
    {
        lock (_lock) return _connections.Keys.ToHashSet();
    }

    /// <summary>개별 장치에 봉투 하나. 끊겨 있으면 false — 하트비트가 따라잡는다.</summary>
    public async Task<bool> PushAsync(int deviceId, string envelope)
    {
        DeviceConnection? conn;
        lock (_lock) _connections.TryGetValue(deviceId, out conn);
        if (conn is null || conn.Socket.State != WebSocketState.Open) return false;

        await conn.SendLock.WaitAsync();
        try
        {
            await conn.Socket.SendAsync(
                Encoding.UTF8.GetBytes(envelope),
                WebSocketMessageType.Text, endOfMessage: true, CancellationToken.None);
            return true;
        }
        catch
        {
            return false;  // 보내다 끊긴 소켓 — 하트비트가 따라잡는다.
        }
        finally
        {
            conn.SendLock.Release();
        }
    }

    public async Task<int> BroadcastAsync(Dictionary<int, string> envelopes)
    {
        var sent = 0;
        foreach (var (deviceId, envelope) in envelopes)
            if (await PushAsync(deviceId, envelope)) sent++;
        return sent;
    }
}

/// <summary>스케줄 변경·제어 명령 푸시 — notify.py 의 짝.</summary>
public class NotifyService(ConnectionHub hub, DeviceCrypto crypto, ILogger<NotifyService> logger)
{
    /// <summary>(device_id, device_code, version) 목록에 스케줄 변경을 통지한다.</summary>
    public async Task<int> PushScheduleChangedAsync(List<(int deviceId, string deviceCode, int version)> targets)
    {
        var envelopes = targets.ToDictionary(
            t => t.deviceId,
            t => crypto.EncryptForDevice(t.deviceCode,
                new { type = "schedule_changed", version = t.version }));
        var sent = await hub.BroadcastAsync(envelopes);
        logger.LogInformation("스케줄 변경 푸시 {Sent}/{Total}", sent, envelopes.Count);
        return sent;
    }

    /// <summary>개별 장치 제어 명령(재시작, 새로고침, 스크린샷 등).</summary>
    public Task<bool> PushCommandAsync(int deviceId, string deviceCode, string command, object? @params = null)
    {
        var envelope = crypto.EncryptForDevice(deviceCode,
            new { type = "command", command, @params = @params ?? new { } });
        return hub.PushAsync(deviceId, envelope);
    }
}

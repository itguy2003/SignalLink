// 장치 고유번호·장치 인증·저장공간 — FastAPI(device_code.py + device_auth.py +
// storage.py)의 짝.

using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SignalLink.Api.Data;

namespace SignalLink.Api.Services;

public static class DeviceCode
{
    // 혼동하기 쉬운 글자(I, O, 0, 1)는 뺐다 — 설치 기사가 손으로 옮겨 적는다.
    private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private const int MaxAttempts = 20;

    public static string FormatCode(string raw) =>
        raw.Length == 10
            ? $"{raw[..4]}-{raw[4..7]}-{raw[7..]}"
            : throw new ArgumentException("장치 고유번호 원문은 10자여야 한다");

    public static string GenerateRaw() =>
        new(Enumerable.Range(0, 10)
            .Select(_ => Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)]).ToArray());

    /// <summary>DB 에 존재하지 않는 장치 고유번호. 유일성은 UNIQUE 제약 + 재시도.</summary>
    public static async Task<string> GenerateUniqueAsync(AppDbContext db)
    {
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var code = FormatCode(GenerateRaw());
            if (!await db.Devices.AnyAsync(d => d.DeviceCode == code)) return code;
        }
        throw new InvalidOperationException("장치 고유번호 생성에 반복 실패했다");
    }
}

public class DeviceAuthException(string message) : Exception(message);

/// <summary>장치 세션 토큰 — CMS 토큰과 서명 키는 같지만 typ 으로 구분한다.</summary>
public class DeviceAuthService(AppDbContext db, IConfiguration config)
{
    private const string TokenType = "device";
    private static readonly TimeSpan Ttl = TimeSpan.FromDays(30);

    private string SecretKey => config["SecretKey"] ?? "dev-secret-key-change-me";

    public string CreateDeviceToken(Device device)
    {
        var now = DateTimeOffset.UtcNow;
        var payload = new JwtPayload
        {
            ["sub"] = device.Id.ToString(),
            ["code"] = device.DeviceCode,
            ["org"] = device.OrgId,
            ["typ"] = TokenType,
            ["iat"] = now.ToUnixTimeSeconds(),
            ["exp"] = now.Add(Ttl).ToUnixTimeSeconds(),
        };
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(SecurityKeys.Hmac(SecretKey)),
            SecurityAlgorithms.HmacSha256);
        return new JwtSecurityTokenHandler().WriteToken(
            new JwtSecurityToken(new JwtHeader(credentials), payload));
    }

    public async Task<Device> ResolveDeviceAsync(string token)
    {
        var handler = new JwtSecurityTokenHandler();
        System.Security.Claims.ClaimsPrincipal principal;
        try
        {
            principal = handler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuer = false,
                ValidateAudience = false,
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(SecurityKeys.Hmac(SecretKey)),
                ClockSkew = TimeSpan.FromSeconds(30),
                NameClaimType = "sub",
            }, out _);
        }
        catch (Exception)
        {
            throw new DeviceAuthException("장치 토큰이 유효하지 않습니다.");
        }

        if (principal.FindFirst("typ")?.Value != TokenType)
            throw new DeviceAuthException("장치 토큰이 아닙니다.");

        var sub = principal.FindFirst("sub")?.Value
            ?? principal.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (!int.TryParse(sub, out var deviceId))
            throw new DeviceAuthException("장치 토큰이 유효하지 않습니다.");

        var device = await db.Devices
            .Include(d => d.ScheduleLinks).ThenInclude(l => l.Schedule)
            .SingleOrDefaultAsync(d => d.Id == deviceId);
        if (device is null)
            throw new DeviceAuthException("등록되지 않은 장치입니다.");
        // 삭제 후 재등록되면 고유번호가 달라진다 — 토큰의 코드와 대조한다.
        if (device.DeviceCode != principal.FindFirst("code")?.Value)
            throw new DeviceAuthException("장치 고유번호가 일치하지 않습니다.");
        return device;
    }

    public async Task<Device> AuthenticateByCodeAsync(string deviceCode)
    {
        var normalized = deviceCode.Trim().ToUpperInvariant();
        var device = await db.Devices
            .Include(d => d.ScheduleLinks).ThenInclude(l => l.Schedule)
            .SingleOrDefaultAsync(d => d.DeviceCode == normalized);
        return device ?? throw new DeviceAuthException("등록되지 않은 장치 고유번호입니다.");
    }
}

/// <summary>저장공간 사용률 — 임계 기준은 여기 한 곳에만 둔다.</summary>
public static class DeviceStorage
{
    public const double WarnThreshold = 0.8;

    /// <summary>사용률(0~1). None 은 '미보고'이지 '여유'가 아니다.</summary>
    public static double? UsageRatio(long? totalBytes, long? freeBytes)
    {
        if (totalBytes is not long total || freeBytes is not long free) return null;
        if (total <= 0 || free < 0 || free > total) return null;  // 앞뒤가 안 맞는 보고는 버린다.
        return (double)(total - free) / total;
    }

    public static long? UsedBytes(long? totalBytes, long? freeBytes) =>
        UsageRatio(totalBytes, freeBytes) is null ? null : totalBytes - freeBytes;

    public static bool IsWarning(double? ratio) => ratio is >= WarnThreshold;

    /// <summary>보고를 기록한다. 반쪽만 오면 아무것도 바꾸지 않는다.</summary>
    public static void RecordReport(Device device, long? totalBytes, long? freeBytes)
    {
        if (totalBytes is null || freeBytes is null) return;
        device.StorageTotalBytes = totalBytes;
        device.StorageFreeBytes = freeBytes;
        device.StorageReportedAt = DateTime.UtcNow;
    }
}

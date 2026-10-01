// 비밀번호·JWT — FastAPI(app/core/security.py)와 **바이트 단위로 같은 규칙**.
//
// 두 백엔드가 같은 DB 의 password_hash 를 검증하고, 서로가 발급한 토큰을
// 받아들여야 한다. 규칙이 조금이라도 다르면 "한쪽에서만 로그인되는" 계정이
// 생긴다.
//
//   비밀번호: bcrypt( base64( sha256(password) ) )  — Django bcrypt_sha256 방식
//   토큰:     HS256, claims = sub(사용자 id 문자열) / roles / org / exp / iat / typ

using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace SignalLink.Api.Services;

public static class SecurityKeys
{
    /// <summary>
    /// HS256 서명 키. .NET IdentityModel 은 256비트 미만 키를 거부하지만
    /// pyjwt 는 아니다 — 개발 기본 키가 24바이트라 그대로는 못 쓴다.
    /// HMAC 은 블록 크기(64B)까지 키를 0 으로 채우므로, **0 을 덧붙여
    /// 32바이트로 늘려도 서명이 완전히 같다.** 상호운용은 그대로다.
    /// </summary>
    public static byte[] Hmac(string secret)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(secret);
        if (bytes.Length >= 32) return bytes;
        var padded = new byte[32];
        bytes.CopyTo(padded, 0);
        return padded;
    }
}

/// <summary>비밀번호 복잡도 — FastAPI(app/core/passwords.py)의 짝.
/// 배포(운영)에서만 강제: PASSWORD_COMPLEXITY on/off/auto, auto 는 PostgreSQL 일 때.</summary>
public static class PasswordRules
{
    public static bool ComplexityEnabled(IConfiguration config)
    {
        var mode = (config["PasswordComplexity"] ?? "auto").ToLowerInvariant();
        if (mode == "on") return true;
        if (mode == "off") return false;
        return (config["DatabaseUrl"] ?? "").StartsWith("postgresql");
    }

    /// <summary>규칙 위반이면 사용자에게 보여 줄 문구, 통과면 null.</summary>
    public static string? ComplexityError(IConfiguration config, string password)
    {
        if (!ComplexityEnabled(config)) return null;
        var missing = new List<string>();
        if (!password.Any(char.IsAsciiLetter)) missing.Add("영문");
        if (!password.Any(char.IsAsciiDigit)) missing.Add("숫자");
        if (!password.Any(ch => !char.IsAsciiLetterOrDigit(ch))) missing.Add("특수문자");
        return missing.Count > 0
            ? $"비밀번호는 영문·숫자·특수문자를 모두 포함해야 합니다(누락: {string.Join(", ", missing)})."
            : null;
    }

    /// <summary>환경과 무관한 기본 규칙(pydantic 스키마의 짝) — 영문+숫자.</summary>
    public static string? BasicError(string password)
    {
        if (!password.Any(char.IsAsciiLetter) || !password.Any(char.IsAsciiDigit))
            return "비밀번호는 영문과 숫자를 함께 사용해야 합니다.";
        return null;
    }
}

public static class PasswordHasher
{
    private static string Prehash(string password)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(password));
        return Convert.ToBase64String(digest);
    }

    public static bool Verify(string password, string passwordHash)
    {
        try
        {
            return BCrypt.Net.BCrypt.Verify(Prehash(password), passwordHash);
        }
        catch (Exception)
        {
            return false;
        }
    }

    public static string Hash(string password) =>
        BCrypt.Net.BCrypt.HashPassword(Prehash(password));
}

public class TokenService(IConfiguration config)
{
    private string SecretKey => config["SecretKey"] ?? "dev-secret-key-change-me";
    public int ExpireMinutes => int.TryParse(config["AccessTokenExpireMinutes"], out var m) ? m : 720;

    public string CreateAccessToken(int userId, IEnumerable<string> roles, int orgId)
    {
        var now = DateTimeOffset.UtcNow;
        // JwtPayload 를 직접 만든다 — roles 가 JSON **배열**이어야 pyjwt 쪽과
        // 같은 모양이다(Claim 여러 개로 넣으면 배열이 되긴 하지만 명시가 안전).
        var payload = new JwtPayload
        {
            ["sub"] = userId.ToString(),
            ["roles"] = roles.ToList(),
            ["org"] = orgId,
            ["exp"] = now.AddMinutes(ExpireMinutes).ToUnixTimeSeconds(),
            ["iat"] = now.ToUnixTimeSeconds(),
            ["typ"] = "access",
        };
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(SecurityKeys.Hmac(SecretKey)),
            SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(new JwtHeader(credentials), payload);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

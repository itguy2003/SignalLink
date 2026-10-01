// 비밀번호·JWT 규칙 검증.
//
// 이 모듈은 FastAPI 와 **바이트 단위로 같은** 규칙이어야 두 백엔드가 같은
// DB 의 해시를 검증하고 서로의 토큰을 받아들인다. 여기서는 그 규칙 자체
// (프리해시, HMAC 0-패딩, 클레임 모양)를 못박는다 — 산식이 바뀌면 어느
// 한쪽에서만 로그인되는 계정이 생긴다.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using SignalLink.Api.Services;

namespace SignalLink.Api.Tests;

public static class TestConfig
{
    public static IConfiguration Of(params (string Key, string Value)[] pairs) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(pairs.ToDictionary(p => p.Key, p => (string?)p.Value))
            .Build();
}

public class PasswordHasherTests
{
    [Fact]
    public void 해시한_비밀번호를_검증할_수_있다()
    {
        var hash = PasswordHasher.Hash("admin1234");
        Assert.True(PasswordHasher.Verify("admin1234", hash));
        Assert.False(PasswordHasher.Verify("admin1235", hash));
    }

    [Fact]
    public void 아주_긴_비밀번호도_프리해시_덕에_전부_반영된다()
    {
        // bcrypt 는 72바이트에서 잘리지만, sha256 프리해시를 거치므로
        // 72바이트 뒤쪽만 다른 비밀번호도 구분되어야 한다.
        var longBase = new string('a', 100);
        var hash = PasswordHasher.Hash(longBase + "X");
        Assert.True(PasswordHasher.Verify(longBase + "X", hash));
        Assert.False(PasswordHasher.Verify(longBase + "Y", hash));
    }

    [Fact]
    public void 깨진_해시는_예외_대신_거짓이다()
    {
        Assert.False(PasswordHasher.Verify("whatever", "이건 bcrypt 해시가 아니다"));
    }
}

public class SecurityKeysTests
{
    [Fact]
    public void 짧은_키는_32바이트로_0을_덧붙인다()
    {
        var padded = SecurityKeys.Hmac("abc");
        Assert.Equal(32, padded.Length);
        Assert.Equal("abc"u8.ToArray(), padded[..3]);
        Assert.All(padded[3..], b => Assert.Equal(0, b));
    }

    [Fact]
    public void 패딩해도_HMAC_서명은_원래_키와_같다()
    {
        // HMAC 은 블록 크기(64B)까지 키를 0 으로 채운다 — 그래서 0 패딩은
        // pyjwt(원래 키)와의 서명 동일성을 깨지 않는다. 상호운용의 근거.
        var message = "header.payload"u8.ToArray();
        var original = new HMACSHA256("dev-secret-key-change-me"u8.ToArray()).ComputeHash(message);
        var padded = new HMACSHA256(SecurityKeys.Hmac("dev-secret-key-change-me")).ComputeHash(message);
        Assert.Equal(original, padded);
    }

    [Fact]
    public void 긴_키는_그대로_쓴다()
    {
        var key = new string('k', 40);
        Assert.Equal(Encoding.UTF8.GetBytes(key), SecurityKeys.Hmac(key));
    }
}

public class TokenServiceTests
{
    private static JsonObject Payload(string token)
    {
        var part = token.Split('.')[1].Replace('-', '+').Replace('_', '/');
        part += new string('=', (4 - part.Length % 4) % 4);
        return JsonNode.Parse(Convert.FromBase64String(part))!.AsObject();
    }

    [Fact]
    public void 클레임_모양이_파이썬_쪽과_같다()
    {
        var tokens = new TokenService(TestConfig.Of(("SecretKey", "test-secret")));
        var payload = Payload(tokens.CreateAccessToken(7, ["MEMBER", "ORG_ADMIN"], 3));

        Assert.Equal("7", payload["sub"]!.GetValue<string>());       // 문자열 id
        Assert.Equal(3, payload["org"]!.GetValue<int>());
        Assert.Equal("access", payload["typ"]!.GetValue<string>());
        var roles = payload["roles"]!.AsArray().Select(r => r!.GetValue<string>()).ToList();
        Assert.Equal(["MEMBER", "ORG_ADMIN"], roles);                // JSON 배열
        Assert.True(payload["exp"]!.GetValue<long>() > payload["iat"]!.GetValue<long>());
    }

    [Fact]
    public void 만료는_설정한_분_뒤다()
    {
        var tokens = new TokenService(TestConfig.Of(
            ("SecretKey", "test-secret"), ("AccessTokenExpireMinutes", "60")));
        var payload = Payload(tokens.CreateAccessToken(1, ["MEMBER"], 1));
        var span = payload["exp"]!.GetValue<long>() - payload["iat"]!.GetValue<long>();
        Assert.Equal(3600, span);
    }
}

public class PasswordRulesTests
{
    [Theory]
    [InlineData("on", "", true)]
    [InlineData("off", "postgresql://x", false)]
    [InlineData("auto", "postgresql://x", true)]   // auto = 운영(PostgreSQL)일 때만
    [InlineData("auto", "", false)]                // SQLite(개발)면 끔
    public void 복잡도는_설정과_DB에_따라_켜진다(string mode, string dbUrl, bool expected)
    {
        var config = TestConfig.Of(("PasswordComplexity", mode), ("DatabaseUrl", dbUrl));
        Assert.Equal(expected, PasswordRules.ComplexityEnabled(config));
    }

    [Fact]
    public void 복잡도_위반은_빠진_종류를_알려준다()
    {
        var config = TestConfig.Of(("PasswordComplexity", "on"));
        Assert.Null(PasswordRules.ComplexityError(config, "abc123!@"));
        var reason = PasswordRules.ComplexityError(config, "abcdefg1");
        Assert.NotNull(reason);
        Assert.Contains("특수문자", reason);
    }

    [Fact]
    public void 기본_규칙은_영문과_숫자를_요구한다()
    {
        Assert.Null(PasswordRules.BasicError("abc1234"));
        Assert.NotNull(PasswordRules.BasicError("abcdefgh"));
        Assert.NotNull(PasswordRules.BasicError("12345678"));
    }
}

// 인증 통합 테스트 — 진짜 서버(임시 DB) 위에서.
//
// 부트스트랩(최상위 기관 + admin)은 요구사항이다: 최상위 기관 없이는
// 회원가입이 안 된다. 여기서는 서버를 갓 띄운 상태가 그 약속을 지키는지,
// 가입-승인 흐름과 오류 문구가 FastAPI 와 같은지를 본다.

using System.Net;
using System.Text.Json.Nodes;

namespace SignalLink.Api.Tests;

public class AuthApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task 헬스체크는_어느_백엔드인지_밝힌다()
    {
        var body = await Api.GetJsonAsync(_client, "/health");
        Assert.Equal("ok", body["status"]!.GetValue<string>());
        Assert.Equal("dotnet", body["backend"]!.GetValue<string>());
    }

    [Fact]
    public async Task 갓_띄운_서버에_최상위_기관과_admin_이_있다()
    {
        var token = await Api.LoginAsync(_client);
        var me = await Api.GetJsonAsync(_client, "/api/v1/auth/me", token);

        Assert.Equal("admin", me["user_id"]!.GetValue<string>());
        Assert.Equal("최상위 기관", me["org_name"]!.GetValue<string>());
        var roles = me["roles"]!.AsArray().Select(r => r!.GetValue<string>());
        Assert.Contains("SUPER_ADMIN", roles);
    }

    [Fact]
    public async Task 틀린_비밀번호는_계정_존재를_숨기는_문구로_거절한다()
    {
        var response = await Api.PostAsync(_client, "/api/v1/auth/login",
            new { user_id = "admin", password = "wrong-password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await Api.ReadJsonAsync(response);
        Assert.Equal("사용자ID 또는 비밀번호가 올바르지 않습니다.", body["detail"]!.GetValue<string>());
    }

    [Fact]
    public async Task 가입자는_미승인으로_시작해_로그인하지_못한다()
    {
        var register = await Api.PostAsync(_client, "/api/v1/auth/register", new
        {
            org_id = 1,
            user_id = "newcomer",
            password = "test1234",
            password_confirm = "test1234",
            name = "신규 가입자",
        });
        Assert.Equal(HttpStatusCode.Created, register.StatusCode);
        var created = await Api.ReadJsonAsync(register);
        Assert.Equal("미승인", created["status"]!.GetValue<string>());

        var login = await Api.PostAsync(_client, "/api/v1/auth/login",
            new { user_id = "newcomer", password = "test1234" });
        Assert.Equal(HttpStatusCode.Forbidden, login.StatusCode);
    }

    [Fact]
    public async Task 비밀번호_확인이_다르면_가입을_거절한다()
    {
        var response = await Api.PostAsync(_client, "/api/v1/auth/register", new
        {
            org_id = 1,
            user_id = "mismatch",
            password = "test1234",
            password_confirm = "test5678",
            name = "확인 불일치",
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task 두_백엔드는_같은_토큰을_주고받는다_클레임_검사()
    {
        // 교차 수용 자체는 서버 둘을 띄워야 하지만, 그 전제인 클레임 계약은
        // 여기서 지킬 수 있다: sub 는 문자열, roles 는 배열.
        var token = await Api.LoginAsync(_client);
        var payloadPart = token.Split('.')[1].Replace('-', '+').Replace('_', '/');
        payloadPart += new string('=', (4 - payloadPart.Length % 4) % 4);
        var payload = JsonNode.Parse(Convert.FromBase64String(payloadPart))!.AsObject();

        Assert.Equal("1", payload["sub"]!.GetValue<string>());
        Assert.Equal("access", payload["typ"]!.GetValue<string>());
        Assert.True(payload["roles"] is JsonArray);
    }

    // ------------------------------------------------- 공개 기관 목록

    private async Task<int> CreateOrgAsync(string token, object payload)
    {
        var response = await Api.PostAsync(_client, "/api/v1/organizations", payload, token);
        var body = await Api.ReadJsonAsync(response);
        return body["id"]!.GetValue<int>();
    }

    [Fact]
    public async Task 공개_기관_목록은_분류로_거를_수_있다()
    {
        var token = await Api.LoginAsync(_client);
        var office = await CreateOrgAsync(token,
            new { name = "보람교육청", parent_id = 1, org_type = "기관" });
        await CreateOrgAsync(token,
            new { name = "보람초등학교", parent_id = office, org_type = "학교", school_level = "초" });

        var body = await Api.GetJsonAsync(_client,
            "/api/v1/organizations/public?q=보람&category=기관");
        var names = body!.AsArray().Select(o => o!["name"]!.GetValue<string>()).ToList();
        Assert.Contains("보람교육청", names);
        Assert.DoesNotContain("보람초등학교", names);
    }
}

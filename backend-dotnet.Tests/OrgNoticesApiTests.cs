// 소속기관 공지 조회 범위 통합 테스트.
//
// 공지는 상위 기관이 소속기관에 내리는 것이다. 스케줄 편집기는
// GET /org-notices?for_org=<기관> 으로 "자기 것 + 상위기관이 내린 것"을
// 함께 받고, 하위 기관 사용자도 상위 공지의 상세(슬라이드)를 읽을 수 있다.

namespace SignalLink.Api.Tests;

public class OrgNoticesApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static async Task<int> CreateOrgAsync(HttpClient client, string token, string name, int parentId)
    {
        var response = await Api.PostAsync(client, "/api/v1/organizations", new
        {
            name,
            parent_id = parentId,
            org_type = "기관",
        }, token);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"기관 생성 실패: {body}");
        return body["id"]!.GetValue<int>();
    }

    private static async Task<int> CreateNoticeAsync(HttpClient client, string token, int orgId, string name)
    {
        var response = await Api.PostAsync(client, "/api/v1/org-notices",
            new { org_id = orgId, name }, token);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"공지 생성 실패: {body}");
        return body["id"]!.GetValue<int>();
    }

    /// <summary>하위 기관 구성원 계정(가입→승인)을 만들고 그 토큰을 돌려준다.</summary>
    private async Task<string> MemberTokenAsync(string adminToken, int orgId, string userId)
    {
        var register = await Api.PostAsync(_client, "/api/v1/auth/register", new
        {
            org_id = orgId,
            user_id = userId,
            password = "test1234",
            password_confirm = "test1234",
            name = userId,
        });
        var created = await Api.ReadJsonAsync(register);
        Assert.True(register.IsSuccessStatusCode, $"가입 실패: {created}");
        var approve = await Api.PostAsync(_client,
            $"/api/v1/users/{created["id"]!.GetValue<int>()}/approve", new { }, adminToken);
        Assert.True(approve.IsSuccessStatusCode, "승인 실패");
        return await Api.LoginAsync(_client, userId, "test1234");
    }

    [Fact]
    public async Task for_org_는_자기_것과_상위기관_공지를_함께_준다()
    {
        var admin = await Api.LoginAsync(_client);
        var officeId = await CreateOrgAsync(_client, admin, "포오그교육청", 1);
        var schoolId = await CreateOrgAsync(_client, admin, "포오그학교", officeId);
        await CreateNoticeAsync(_client, admin, 1, "최상위 공지");
        var officeNoticeId = await CreateNoticeAsync(_client, admin, officeId, "교육청 공지");
        await CreateNoticeAsync(_client, admin, schoolId, "학교 공지");

        var member = await MemberTokenAsync(admin, schoolId, "fororg-member");
        var rows = await Api.GetJsonAsync(_client, $"/api/v1/org-notices?for_org={schoolId}", member);

        // 자기 것 먼저, 그다음 가까운 상위 순.
        var names = rows.AsArray().Select(r => r!["name"]!.GetValue<string>()).ToList();
        Assert.Equal(["학교 공지", "교육청 공지", "최상위 공지"], names);
        Assert.Equal("포오그교육청", rows.AsArray()[1]!["org_name"]!.GetValue<string>());

        // 상위기관 공지의 상세도 하위 구성원이 읽는다 — 스케줄에 담기 위해.
        var detail = await _client.SendAsync(WithToken(
            new HttpRequestMessage(HttpMethod.Get, $"/api/v1/org-notices/{officeNoticeId}"), member));
        Assert.True(detail.IsSuccessStatusCode);

        // 관리 화면(org_id 조회)은 여전히 관리 범위를 요구한다.
        var managed = await _client.SendAsync(WithToken(
            new HttpRequestMessage(HttpMethod.Get, $"/api/v1/org-notices?org_id={officeId}"), member));
        Assert.Equal(403, (int)managed.StatusCode);
    }

    private static HttpRequestMessage WithToken(HttpRequestMessage request, string token)
    {
        request.Headers.Authorization = new("Bearer", token);
        return request;
    }
}

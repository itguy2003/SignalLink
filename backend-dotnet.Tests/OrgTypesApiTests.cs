// 기관구분 관리 통합 테스트.
//
// 약속: 기본 3종이 심어져 있고, 이름 변경은 사용 중인 기관에 연쇄되며,
// 사용 중인 구분은 삭제할 수 없다(수정만 가능). 커뮤니티 소유 판정은
// 이름이 아니라 category 를 따른다.

using System.Net;
using System.Text.Json.Nodes;

namespace SignalLink.Api.Tests;

public class OrgTypesApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<JsonArray> ListAsync(string token) =>
        (await Api.GetJsonAsync(_client, "/api/v1/org-types", token)).AsArray();

    private static JsonNode Row(JsonArray rows, string name) =>
        rows.Single(row => row!["name"]!.GetValue<string>() == name)!;

    [Fact]
    public async Task 기본_3종이_심어져_있다()
    {
        var token = await Api.LoginAsync(_client);
        var names = (await ListAsync(token)).Select(r => r!["name"]!.GetValue<string>()).ToList();
        Assert.Contains("학교", names);
        Assert.Contains("기타", names);
    }

    [Fact]
    public async Task 이름_변경은_사용_중인_기관에_연쇄된다()
    {
        var token = await Api.LoginAsync(_client);
        var create = await Api.PostAsync(_client, "/api/v1/org-types",
            new { name = "연쇄전", category = "기타" }, token);
        var typeId = (await Api.ReadJsonAsync(create))["id"]!.GetValue<int>();
        var org = await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/organizations",
            new { name = "연쇄 기관", parent_id = 1, org_type = "연쇄전" }, token));

        var renamed = await Api.PutAsync(_client, $"/api/v1/org-types/{typeId}",
            new { name = "연쇄후" }, token);
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);

        var reloaded = await Api.GetJsonAsync(_client, $"/api/v1/organizations/{org["id"]}", token);
        Assert.Equal("연쇄후", reloaded["org_type"]!.GetValue<string>());
    }

    [Fact]
    public async Task 사용_중이면_삭제는_막고_수정은_허용한다()
    {
        var token = await Api.LoginAsync(_client);
        var rows = await ListAsync(token);
        var inUse = Row(rows, "기관");  // 최상위 기관이 쓴다.
        var typeId = inUse["id"]!.GetValue<int>();

        var deleted = await _client.SendAsync(Authed(HttpMethod.Delete, $"/api/v1/org-types/{typeId}", token));
        Assert.Equal(HttpStatusCode.BadRequest, deleted.StatusCode);
        var body = await Api.ReadJsonAsync(deleted);
        Assert.Contains("삭제할 수 없습니다", body["detail"]!.GetValue<string>());

        var updated = await Api.PutAsync(_client, $"/api/v1/org-types/{typeId}",
            new { name = "상급기관" }, token);
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        // 되돌린다 — 다른 테스트가 '기관' 이름을 기대한다.
        await Api.PutAsync(_client, $"/api/v1/org-types/{typeId}", new { name = "기관" }, token);
    }

    [Fact]
    public async Task 사용하지_않는_구분은_지워진다()
    {
        var token = await Api.LoginAsync(_client);
        var created = await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/org-types",
            new { name = "임시", category = "기타" }, token));

        var deleted = await _client.SendAsync(
            Authed(HttpMethod.Delete, $"/api/v1/org-types/{created["id"]}", token));
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
    }

    [Fact]
    public async Task 모르는_기관구분으로는_기관을_만들_수_없다()
    {
        var token = await Api.LoginAsync(_client);
        var response = await Api.PostAsync(_client, "/api/v1/organizations",
            new { name = "어딘가", parent_id = 1, org_type = "우주기지" }, token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await Api.ReadJsonAsync(response);
        Assert.Contains("알 수 없는 기관구분", body["detail"]!.GetValue<string>());
    }

    private static HttpRequestMessage Authed(HttpMethod method, string path, string token)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new("Bearer", token);
        return request;
    }
}

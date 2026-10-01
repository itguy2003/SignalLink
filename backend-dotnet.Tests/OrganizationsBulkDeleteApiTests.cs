// 기관 일괄 삭제(/organizations/bulk-delete) — 학교 정보 관리의 일괄 정리.
//
// 약속: 단건 삭제와 같은 규칙(최상위 불가·권한 범위·하위기관/사용자/장치
// 보호)을 기관마다 적용하고, 건너뛴 이유를 사유별 건수로 알린다
// (FastAPI tests/test_organizations.py TestBulkDelete 거울).

using System.Text.Json.Nodes;

namespace SignalLink.Api.Tests;

public class OrganizationsBulkDeleteApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<int> CreateOrgAsync(string token, string name, int parentId, string orgType)
    {
        var response = await Api.PostAsync(_client, "/api/v1/organizations",
            new { name, parent_id = parentId, org_type = orgType }, token);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"기관 생성 실패: {body}");
        return body["id"]!.GetValue<int>();
    }

    [Fact]
    public async Task 지울_수_있는_기관만_지우고_이유를_알린다()
    {
        var token = await Api.LoginAsync(_client);
        var office = await CreateOrgAsync(token, "벌크교육청", 1, "기관");
        var school = await CreateOrgAsync(token, "벌크가초등학교", office, "학교");

        // 교육청은 하위 기관(학교)이 있어 건너뛰고, 학교만 지워진다.
        var response = await Api.PostAsync(_client, "/api/v1/organizations/bulk-delete",
            new { ids = new[] { school, office } }, token);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"일괄 삭제 실패: {body}");
        Assert.Equal(1, body["deleted"]!.GetValue<int>());
        Assert.Equal(1, body["skipped"]!.GetValue<int>());
        Assert.Contains(body["errors"]!.AsArray(),
            e => e!.GetValue<string>().Contains("하위 기관"));

        var gone = await _client.SendAsync(Authed(
            HttpMethod.Get, $"/api/v1/organizations/{school}", token));
        Assert.Equal(System.Net.HttpStatusCode.NotFound, gone.StatusCode);

        // 남은 교육청 정리 — 다른 테스트와 섞이지 않게.
        await _client.SendAsync(Authed(
            HttpMethod.Delete, $"/api/v1/organizations/{office}", token));
    }

    private static HttpRequestMessage Authed(HttpMethod method, string path, string token)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new("Bearer", token);
        return request;
    }

    [Fact]
    public async Task 스케줄과_콘텐츠가_있어도_학교는_지워진다()
    {
        // 소유 CMS 자료의 RESTRICT FK 가 삭제를 막아 500 이 나던 버그 —
        // 기관을 지울 때 스케줄·재생목록·콘텐츠·자산을 함께 지운다.
        var token = await Api.LoginAsync(_client);
        var school = await CreateOrgAsync(token, "지움가능초등학교", 1, "학교");

        var content = await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/contents",
            new { name = "삭제될 콘텐츠", org_id = school }, token));
        var schedule = await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/schedules",
            new { name = "삭제될 스케줄", kind = "시간지정", org_id = school, items = Array.Empty<object>() },
            token));

        var deleted = await _client.SendAsync(Authed(
            HttpMethod.Delete, $"/api/v1/organizations/{school}", token));
        var body = await Api.ReadJsonAsync(deleted);
        Assert.True(deleted.IsSuccessStatusCode, $"삭제 실패: {body}");

        Assert.Equal(System.Net.HttpStatusCode.NotFound, (await _client.SendAsync(Authed(
            HttpMethod.Get, $"/api/v1/contents/{content["id"]}", token))).StatusCode);
        Assert.Equal(System.Net.HttpStatusCode.NotFound, (await _client.SendAsync(Authed(
            HttpMethod.Get, $"/api/v1/schedules/{schedule["id"]}", token))).StatusCode);
    }

    [Fact]
    public async Task 조건이_없으면_거절한다()
    {
        var token = await Api.LoginAsync(_client);
        var response = await Api.PostAsync(_client, "/api/v1/organizations/bulk-delete",
            new { }, token);
        var body = await Api.ReadJsonAsync(response);
        Assert.Equal(400, (int)response.StatusCode);
        Assert.Contains("삭제할 대상", body["detail"]!.GetValue<string>());
    }
}

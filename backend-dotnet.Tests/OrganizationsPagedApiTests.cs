// 기관 페이지 목록(/organizations/paged) — 학교 정보 관리처럼 큰 목록용.
//
// 약속: category 는 기관구분 마스터의 분류로 거르고, 이름순 정렬에
// items/total/page/size 를 돌려준다 (FastAPI tests/test_organizations.py 거울).

using System.Text.Json.Nodes;

namespace SignalLink.Api.Tests;

public class OrganizationsPagedApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    /// <summary>테스트끼리(그리고 다른 테스트 파일과) 섞이지 않도록
    /// 접두사가 붙은 학교 두 곳을 심는다 — 조회는 q 로 좁힌다.</summary>
    private async Task SeedSchoolsAsync(string token, string prefix)
    {
        foreach (var (name, level) in new[] { ($"{prefix}가초등학교", "초"), ($"{prefix}나중학교", "중") })
        {
            await Api.PostAsync(_client, "/api/v1/organizations",
                new { name, parent_id = 1, org_type = "학교", school_level = level }, token);
        }
    }

    [Fact]
    public async Task 분류로_거르고_이름순으로_페이지를_나눈다()
    {
        var token = await Api.LoginAsync(_client);
        await SeedSchoolsAsync(token, "페이징");

        var first = await Api.GetJsonAsync(_client,
            "/api/v1/organizations/paged?category=학교&q=페이징&page=1&size=1", token);
        Assert.Equal(2, first["total"]!.GetValue<int>());
        Assert.Equal(1, first["page"]!.GetValue<int>());
        Assert.Equal(1, first["size"]!.GetValue<int>());
        var items = first["items"]!.AsArray();
        Assert.Single(items);
        Assert.Equal("페이징가초등학교", items[0]!["name"]!.GetValue<string>());

        var second = await Api.GetJsonAsync(_client,
            "/api/v1/organizations/paged?category=학교&q=페이징&page=2&size=1", token);
        Assert.Equal("페이징나중학교",
            second["items"]!.AsArray().Single()!["name"]!.GetValue<string>());
    }

    [Fact]
    public async Task 분류가_다르면_잡히지_않는다()
    {
        var token = await Api.LoginAsync(_client);
        await SeedSchoolsAsync(token, "페분류");

        // 심은 학교는 '학교' 분류다 — '기관' 분류 결과에 나오면 안 된다.
        var body = await Api.GetJsonAsync(_client,
            "/api/v1/organizations/paged?category=기관&q=페분류", token);
        Assert.Equal(0, body["total"]!.GetValue<int>());

        var schools = await Api.GetJsonAsync(_client,
            "/api/v1/organizations/paged?category=학교&q=페분류", token);
        Assert.Equal(2, schools["total"]!.GetValue<int>());
    }
}

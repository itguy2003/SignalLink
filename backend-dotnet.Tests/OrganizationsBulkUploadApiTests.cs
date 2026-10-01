// 기관 일괄 등록의 트리 구성·업서트 검증
// (FastAPI tests/test_organizations.py test_bulk_upload_builds_org_tree... 거울).
//
// 약속: 시도교육청명은 최상위 바로 아래(없을 때만 생성), 관할조직명은 그
// 교육청 아래(없을 때만 생성), 학교는 그 아래. 같은 학교(코드 우선, 이름
// 차선)는 다시 만들지 않고 변경한다.

using System.Text;
using System.Text.Json.Nodes;

namespace SignalLink.Api.Tests;

public class OrganizationsBulkUploadApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<JsonNode> UploadCsvAsync(string token, string csv)
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(Encoding.UTF8.GetBytes(csv));
        file.Headers.ContentType = new("text/csv");
        form.Add(file, "file", "info.csv");
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "/api/v1/organizations/bulk-upload?parent_id=1&default_org_type=학교")
        {
            Content = form,
        };
        request.Headers.Authorization = new("Bearer", token);
        var response = await _client.SendAsync(request);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"업로드 실패: {body}");
        return body;
    }

    [Fact]
    public async Task 교육청_지원청_트리를_만들고_같은_학교는_변경한다()
    {
        var token = await Api.LoginAsync(_client);
        const string header = "학교명,시도교육청명,관할조직명,주소\n";

        var first = await UploadCsvAsync(token,
            header + "돌탑초등학교,돌탑교육청,돌탑교육지원청,처음 주소\n");
        Assert.Equal(1, first["created"]!.GetValue<int>());

        var orgs = (await Api.GetJsonAsync(_client, "/api/v1/organizations?q=돌탑", token)).AsArray();
        var byName = orgs.ToDictionary(o => o!["name"]!.GetValue<string>(), o => o!);
        Assert.Equal(1, byName["돌탑교육청"]["parent_id"]!.GetValue<int>());
        Assert.Equal(byName["돌탑교육청"]["id"]!.GetValue<int>(),
            byName["돌탑교육지원청"]["parent_id"]!.GetValue<int>());
        Assert.Equal(byName["돌탑교육지원청"]["id"]!.GetValue<int>(),
            byName["돌탑초등학교"]["parent_id"]!.GetValue<int>());

        // 다시 올리면 기관 트리는 재사용하고, 같은 학교명은 변경된다.
        var second = await UploadCsvAsync(token,
            header + "돌탑초등학교,돌탑교육청,돌탑교육지원청,바뀐 주소\n");
        Assert.Equal(0, second["created"]!.GetValue<int>());
        Assert.Equal(1, second["updated"]!.GetValue<int>());

        var after = (await Api.GetJsonAsync(_client, "/api/v1/organizations?q=돌탑", token)).AsArray();
        Assert.Equal(3, after.Count); // 교육청·지원청·학교 — 중복 생성 없음
        Assert.Equal("바뀐 주소", after.Single(o => o!["name"]!.GetValue<string>() == "돌탑초등학교")!
            ["address"]!.GetValue<string>());
    }
}

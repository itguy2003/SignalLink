// 콘텐츠 공유 통합 테스트 — 목록·상세·스케줄 사용까지 한 흐름으로.
//
// 기관 트리를 API 로 만들고(교육청A ─ 학교1·학교2, 교육청B ─ 먼학교),
// 학교1의 콘텐츠에 공유 구분을 걸어 실제 사용자 계정으로 판정을 본다.
// 단위 테스트(ContentSharingTests)가 판정 함수를 보고, 여기서는 그 판정이
// 라우터의 목록 필터·403·스케줄 검증에 실제로 배선되어 있는지를 본다.

using System.Net;
using System.Text.Json.Nodes;

namespace SignalLink.Api.Tests;

/// <summary>기관 트리와 계정을 **한 번만** 만든다 — xunit 은 테스트마다 테스트
/// 클래스를 새로 만들므로, 클래스에 IAsyncLifetime 을 붙이면 초기화가 테스트
/// 수만큼 반복되어 "이미 사용 중인 사용자ID"로 깨진다.</summary>
public sealed class SharingFixture : IAsyncLifetime
{
    public ApiFactory Factory { get; } = new();
    public HttpClient Client { get; private set; } = null!;
    public string Admin { get; private set; } = "";
    public int School1 { get; private set; }
    public int School2 { get; private set; }
    public int FarSchool { get; private set; }

    public async Task InitializeAsync()
    {
        Client = Factory.CreateClient();
        Admin = await Api.LoginAsync(Client);
        var officeA = await CreateOrgAsync("교육청A", 1, "기관");
        School1 = await CreateOrgAsync("학교1", officeA, "학교");
        School2 = await CreateOrgAsync("학교2", officeA, "학교");
        var officeB = await CreateOrgAsync("교육청B", 1, "기관");
        FarSchool = await CreateOrgAsync("먼학교", officeB, "학교");

        await CreateUserAsync("member2", School2);
        await CreateUserAsync("memberfar", FarSchool);
    }

    public Task DisposeAsync()
    {
        Factory.Dispose();
        return Task.CompletedTask;
    }

    private async Task<int> CreateOrgAsync(string name, int parentId, string orgType)
    {
        var response = await Api.PostAsync(Client, "/api/v1/organizations",
            new { name, parent_id = parentId, org_type = orgType }, Admin);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"기관 생성 실패: {body}");
        return body["id"]!.GetValue<int>();
    }

    private async Task CreateUserAsync(string userId, int orgId)
    {
        var response = await Api.PostAsync(Client, "/api/v1/users",
            new { org_id = orgId, user_id = userId, password = "test1234", name = userId }, Admin);
        Assert.True(response.IsSuccessStatusCode);
    }
}

public class ContentSharingApiTests(SharingFixture fixture) : IClassFixture<SharingFixture>
{
    private HttpClient _client => fixture.Client;
    private string _admin => fixture.Admin;
    private int _school1 => fixture.School1;
    private int _school2 => fixture.School2;

    private async Task<JsonNode> CreateContentAsync(string name, int orgId, string shareScope)
    {
        var response = await Api.PostAsync(_client, "/api/v1/contents",
            new { name, org_id = orgId, share_scope = shareScope }, _admin);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"콘텐츠 생성 실패: {body}");
        return body;
    }

    [Fact]
    public async Task 소속기관_공유는_형제_학교에_보이고_다른_교육청에는_안_보인다()
    {
        var content = await CreateContentAsync("형제 공유", _school1, "소속기관");
        var id = content["id"]!.GetValue<int>();

        // 형제 학교(학교2)의 일반 사용자: 목록에 shared 표식으로 보인다.
        var neighbor = await Api.LoginAsync(_client, "member2", "test1234");
        var page = await Api.GetJsonAsync(_client, "/api/v1/contents?share=shared", neighbor);
        var row = page["items"]!.AsArray().Single(c => c!["id"]!.GetValue<int>() == id)!;
        Assert.True(row["shared"]!.GetValue<bool>());
        Assert.Equal("소속기관", row["share_scope"]!.GetValue<string>());

        // 상세(문서 포함)도 읽힌다.
        var detail = await Api.GetJsonAsync(_client, $"/api/v1/contents/{id}", neighbor);
        Assert.True(detail["shared"]!.GetValue<bool>());

        // 다른 교육청 학교: 목록에도 상세에도 없다.
        var faraway = await Api.LoginAsync(_client, "memberfar", "test1234");
        var farPage = await Api.GetJsonAsync(_client, "/api/v1/contents?share=shared", faraway);
        Assert.DoesNotContain(farPage["items"]!.AsArray(), c => c!["id"]!.GetValue<int>() == id);

        var request = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/contents/{id}");
        request.Headers.Authorization = new("Bearer", faraway);
        Assert.Equal(HttpStatusCode.Forbidden, (await _client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task 공유는_읽기만_연다_남이_고치면_403이다()
    {
        var content = await CreateContentAsync("읽기 전용", _school1, "전체");
        var neighbor = await Api.LoginAsync(_client, "member2", "test1234");

        var response = await Api.PutAsync(
            _client, $"/api/v1/contents/{content["id"]}", new { name = "가로채기" }, neighbor);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task 공유된_콘텐츠만_형제_학교의_스케줄에_붙는다()
    {
        var shared = await CreateContentAsync("공유된 것", _school1, "소속기관");
        var hidden = await CreateContentAsync("공유 안 된 것", _school1, "없음");
        var neighbor = await Api.LoginAsync(_client, "member2", "test1234");

        async Task<HttpResponseMessage> Schedule(JsonNode content) =>
            await Api.PostAsync(_client, "/api/v1/schedules", new
            {
                name = $"스케줄-{content["id"]}",
                kind = "시간지정",
                org_id = _school2,
                items = new[]
                {
                    new
                    {
                        day_of_week = 0,
                        start_time = "09:00:00",
                        end_time = "10:00:00",
                        content_id = content["id"]!.GetValue<int>(),
                    },
                },
            }, neighbor);

        Assert.Equal(HttpStatusCode.Created, (await Schedule(shared)).StatusCode);
        // 사용 권한 없음은 400 이 아니라 403 — FastAPI 와 같은 코드.
        Assert.Equal(HttpStatusCode.Forbidden, (await Schedule(hidden)).StatusCode);
    }

    [Fact]
    public async Task 모르는_공유_구분은_거절한다()
    {
        var response = await Api.PostAsync(_client, "/api/v1/contents",
            new { name = "이상한 값", org_id = _school1, share_scope = "우주" }, _admin);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await Api.ReadJsonAsync(response);
        Assert.Contains("공유 구분은", body["detail"]!.GetValue<string>());
    }

    [Fact]
    public async Task 장치_고유번호는_서버가_형식대로_만들어_준다()
    {
        var response = await Api.PostAsync(_client, "/api/v1/devices",
            new { org_id = _school1, name = "복도 DID", os = "Windows" }, _admin);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"장치 생성 실패: {body}");

        Assert.Matches("^[A-Z2-9]{4}-[A-Z2-9]{3}-[A-Z2-9]{3}$", body["device_code"]!.GetValue<string>());
    }

    [Fact]
    public async Task 커뮤니티_위젯_명세에_재생목록_고르기_옵션이_있다()
    {
        var specs = await Api.GetJsonAsync(_client, "/api/v1/widgets", _admin);
        var community = specs.AsArray().Single(w => w!["key"]!.GetValue<string>() == "community")!;
        var option = Assert.Single(community["options"]!.AsArray());

        Assert.Equal("playlist_id", option!["key"]!.GetValue<string>());
        Assert.Equal("community_playlist", option["type"]!.GetValue<string>());
    }
}

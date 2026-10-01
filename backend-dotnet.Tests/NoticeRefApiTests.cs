// 스케줄의 소속기관 공지 '참조' 통합 테스트 (FastAPI test_schedule_period.py 거울).
//
// 공지는 사본이 아니라 참조로 담긴다: 표출 시 서버가 슬라이드 전체로 펼치고,
// 공지를 고치면 참조하는 스케줄의 버전이 올라 장치가 변경을 알아챈다.
// 기간 밖 공지는 통째로 빠진다.

using System.Net.Http.Json;
using System.Text.Json.Nodes;
using SignalLink.Api.Services;

namespace SignalLink.Api.Tests;

public class NoticeRefApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<JsonNode> MakeNoticeAsync(string token, int orgId, string name, object? extra = null)
    {
        var body = new Dictionary<string, object?> { ["org_id"] = orgId, ["name"] = name };
        if (extra is Dictionary<string, object?> more)
            foreach (var (key, value) in more) body[key] = value;
        var created = await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/org-notices", body, token));
        await Api.PutAsync(_client, $"/api/v1/org-notices/{created["id"]}", new
        {
            items = new object[]
            {
                new { duration_sec = 5, document = new { version = 1, elements = new object[] { new { id = "s1" } } } },
                new { duration_sec = 7, document = new { version = 1, elements = new object[] { new { id = "s2" } } } },
            },
        }, token);
        return created;
    }

    private async Task<JsonNode> MakeRefScheduleAsync(string token, int orgId, int noticeId)
    {
        var response = await Api.PostAsync(_client, "/api/v1/schedules", new
        {
            name = "공지만",
            kind = "목록반복",
            orientation = "LANDSCAPE",
            org_id = orgId,
            items = new object[] { new { day_of_week = -1, org_notice_id = noticeId } },
        }, token);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"스케줄 생성 실패: {body}");
        return body;
    }

    private async Task<(int DeviceId, string DeviceToken)> MakeDeviceAsync(string token, int orgId, int scheduleId)
    {
        var device = await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/devices", new
        {
            org_id = orgId,
            name = "공지 장치",
            os = "Windows",
            panel_type = "LANDSCAPE",
            schedule_ids = new[] { scheduleId },
        }, token));
        var provision = await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/player/provision",
            new { device_code = device["device_code"]!.GetValue<string>() }));
        return (device["id"]!.GetValue<int>(), provision["device_token"]!.GetValue<string>());
    }

    private async Task<JsonNode> PlayerScheduleAsync(string deviceToken)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/player/schedule");
        request.Headers.Add("X-Device-Token", deviceToken);
        var response = await _client.SendAsync(request);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"스케줄 수신 실패: {body}");
        return body;
    }

    [Fact]
    public async Task 공지_참조는_표출_시_슬라이드로_펼쳐진다()
    {
        var admin = await Api.LoginAsync(_client);
        var orgId = (await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/organizations",
            new { name = "참조학교", parent_id = 1, org_type = "기관" }, admin)))["id"]!.GetValue<int>();
        // 상위기관(최상위) 공지를 하위 기관 스케줄이 참조한다.
        var notice = await MakeNoticeAsync(admin, 1, "가정통신");
        var schedule = await MakeRefScheduleAsync(admin, orgId, notice["id"]!.GetValue<int>());

        // 편집기 표시용 이름은 공지 이름이다.
        Assert.Equal(notice["id"]!.GetValue<int>(), schedule["items"]![0]!["org_notice_id"]!.GetValue<int>());
        Assert.Equal("가정통신", schedule["items"]![0]!["content_name"]!.GetValue<string>());

        var (_, deviceToken) = await MakeDeviceAsync(admin, orgId, schedule["id"]!.GetValue<int>());
        var payload = await PlayerScheduleAsync(deviceToken);
        Assert.False(payload["is_demo"]!.GetValue<bool>());
        var items = payload["items"]!.AsArray();
        Assert.Equal([5, 7], items.Select(i => i!["duration_sec"]!.GetValue<int>()));
        Assert.Equal([0, 1], items.Select(i => i!["sort_order"]!.GetValue<int>()));
        Assert.Equal("s1", items[0]!["content"]!["elements"]!.AsArray()[0]!["id"]!.GetValue<string>());
    }

    [Fact]
    public async Task 공지를_고치면_스케줄_버전이_올라_장치가_알아챈다()
    {
        var admin = await Api.LoginAsync(_client);
        var notice = await MakeNoticeAsync(admin, 1, "버전공지");
        var schedule = await MakeRefScheduleAsync(admin, 1, notice["id"]!.GetValue<int>());
        var (_, deviceToken) = await MakeDeviceAsync(admin, 1, schedule["id"]!.GetValue<int>());
        var before = await PlayerScheduleAsync(deviceToken);

        await Api.PutAsync(_client, $"/api/v1/org-notices/{notice["id"]}", new
        {
            items = new object[]
            {
                new { duration_sec = 3, document = new { version = 1, elements = new object[0] } },
            },
        }, admin);

        var heartbeat = new HttpRequestMessage(HttpMethod.Post, "/api/v1/player/heartbeat")
        {
            Content = JsonContent.Create(
                new { schedule_version = before["version"]!.GetValue<int>() },
                options: JsonDefaults.SnakeCase),
        };
        heartbeat.Headers.Add("X-Device-Token", deviceToken);
        var ack = await Api.ReadJsonAsync(await _client.SendAsync(heartbeat));
        Assert.True(ack["schedule_changed"]!.GetValue<bool>());

        var after = await PlayerScheduleAsync(deviceToken);
        Assert.Equal([3], after["items"]!.AsArray().Select(i => i!["duration_sec"]!.GetValue<int>()));
    }

    [Fact]
    public async Task 기간_밖_공지뿐이면_데모로_떨어진다()
    {
        var admin = await Api.LoginAsync(_client);
        var notice = await MakeNoticeAsync(admin, 1, "지난공지", new Dictionary<string, object?>
        {
            ["start_date"] = "2020-01-01",
            ["end_date"] = "2020-12-31",
        });
        var schedule = await MakeRefScheduleAsync(admin, 1, notice["id"]!.GetValue<int>());
        var (_, deviceToken) = await MakeDeviceAsync(admin, 1, schedule["id"]!.GetValue<int>());

        var payload = await PlayerScheduleAsync(deviceToken);
        Assert.True(payload["is_demo"]!.GetValue<bool>());
    }

    [Fact]
    public async Task 다른_가지_기관의_공지는_거부한다()
    {
        var admin = await Api.LoginAsync(_client);
        var branchA = (await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/organizations",
            new { name = "참조가지A", parent_id = 1, org_type = "기관" }, admin)))["id"]!.GetValue<int>();
        var branchB = (await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/organizations",
            new { name = "참조가지B", parent_id = 1, org_type = "기관" }, admin)))["id"]!.GetValue<int>();
        var notice = await MakeNoticeAsync(admin, branchA, "남의공지");

        var response = await Api.PostAsync(_client, "/api/v1/schedules", new
        {
            name = "남의 공지",
            kind = "목록반복",
            orientation = "LANDSCAPE",
            org_id = branchB,
            items = new object[] { new { day_of_week = -1, org_notice_id = notice["id"]!.GetValue<int>() } },
        }, admin);
        var body = await Api.ReadJsonAsync(response);
        Assert.Equal(403, (int)response.StatusCode);
        Assert.Contains("쓸 수 없는 공지", body["detail"]!.GetValue<string>());
    }
}

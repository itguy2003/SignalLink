// 플레이어 수신 경로 통합 테스트.
//
// 회귀: 장치 인증 경로는 ScheduleLinks→Schedule 까지만 Include 하기 때문에,
// BuildPayloadAsync 가 탐색 속성(schedule.Items)에 기대면 아이템이 빈 채로
// 내려간다 — 배정을 해도 플레이어가 데모/대기 화면만 보이던 버그.

using System.Net.Http.Json;
using System.Text.Json.Nodes;
using SignalLink.Api.Services;

namespace SignalLink.Api.Tests;

public class PlayerApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static JsonObject Doc(string text) => new()
    {
        ["version"] = 1,
        ["layout"] = new JsonObject { ["width"] = 1920, ["height"] = 1080, ["background"] = "#000000" },
        ["elements"] = new JsonArray
        {
            new JsonObject
            {
                ["id"] = "e1", ["type"] = "text",
                ["rect"] = new JsonObject { ["x"] = 0, ["y"] = 0, ["w"] = 400, ["h"] = 80, ["z"] = 1 },
                ["options"] = new JsonObject { ["text"] = text },
            },
        },
    };

    /// <summary>스케줄(아이템 1개) + 장치(배정 포함)를 만들고 장치 토큰을 돌려준다.</summary>
    private async Task<(string DeviceToken, int ScheduleVersionAtProvision)> ProvisionAssignedDeviceAsync()
    {
        var token = await Api.LoginAsync(_client);

        var scheduleRes = await Api.PostAsync(_client, "/api/v1/schedules", new
        {
            name = "플레이어 회귀용",
            kind = "목록반복",
            orientation = "LANDSCAPE",
            org_id = 1,
            items = new object[]
            {
                new { day_of_week = -1, sort_order = 0, duration_sec = 10, content = Doc("첫 화면") },
            },
        }, token);
        var schedule = await Api.ReadJsonAsync(scheduleRes);
        Assert.True(scheduleRes.IsSuccessStatusCode, $"스케줄 생성 실패: {schedule}");

        var deviceRes = await Api.PostAsync(_client, "/api/v1/devices", new
        {
            org_id = 1,
            name = "회귀 테스트 장치",
            os = "Windows",
            panel_type = "LANDSCAPE",
            schedule_ids = new[] { schedule["id"]!.GetValue<int>() },
        }, token);
        var device = await Api.ReadJsonAsync(deviceRes);
        Assert.True(deviceRes.IsSuccessStatusCode, $"장치 생성 실패: {device}");

        var provisionRes = await Api.PostAsync(_client, "/api/v1/player/provision", new
        {
            device_code = device["device_code"]!.GetValue<string>(),
            app_version = "test",
        });
        var provision = await Api.ReadJsonAsync(provisionRes);
        Assert.True(provisionRes.IsSuccessStatusCode, $"프로비전 실패: {provision}");
        return (provision["device_token"]!.GetValue<string>(),
            provision["schedule_version"]!.GetValue<int>());
    }

    [Fact]
    public async Task 배정된_스케줄은_아이템까지_실려_내려간다()
    {
        var (deviceToken, versionAtProvision) = await ProvisionAssignedDeviceAsync();

        // 배정이 있으니 버전은 데모(0)가 아니어야 한다.
        Assert.NotEqual(0, versionAtProvision);

        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/player/schedule");
        request.Headers.Add("X-Device-Token", deviceToken);
        var response = await _client.SendAsync(request);
        var payload = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"스케줄 수신 실패: {payload}");

        Assert.False(payload["is_demo"]!.GetValue<bool>());
        var items = payload["items"]!.AsArray();
        Assert.Single(items);
        // 인라인 문서가 그대로 실려 와야 플레이어가 그릴 수 있다.
        var text = items[0]!["content"]!["elements"]!.AsArray()[0]!["options"]!["text"]!;
        Assert.Equal("첫 화면", text.GetValue<string>());
        // 전환 규약도 정규화되어 실린다 — 플레이어가 따로 방어하지 않아도 된다.
        Assert.Equal("none", items[0]!["transition"]!.GetValue<string>());
        Assert.Equal(600, items[0]!["transition_ms"]!.GetValue<int>());
    }

    [Fact]
    public async Task 하트비트는_버전이_다르면_변경으로_알린다()
    {
        var (deviceToken, versionAtProvision) = await ProvisionAssignedDeviceAsync();

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/player/heartbeat")
        {
            Content = JsonContent.Create(new { schedule_version = 0 }, options: JsonDefaults.SnakeCase),
        };
        request.Headers.Add("X-Device-Token", deviceToken);
        var response = await _client.SendAsync(request);
        var payload = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"하트비트 실패: {payload}");

        Assert.True(payload["schedule_changed"]!.GetValue<bool>());
        Assert.Equal(versionAtProvision, payload["schedule_version"]!.GetValue<int>());
    }
}

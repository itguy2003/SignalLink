// 스케줄 저장 검증 통합 테스트.
//
// 회귀: .NET 의 방향 판정이 '가로/세로' 리터럴을 쓰는 바람에 스케줄의
// orientation(LANDSCAPE/PORTRAIT, PanelType 열거형)과 절대 일치하지 않아,
// 가로 스케줄에 가로 콘텐츠를 넣어도 "LANDSCAPE 스케줄에는 LANDSCAPE
// 콘텐츠만 넣을 수 있습니다"가 나던 버그.

using System.Text.Json.Nodes;

namespace SignalLink.Api.Tests;

public class SchedulesApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static JsonObject Doc(int width, int height) => new()
    {
        ["version"] = 1,
        ["layout"] = new JsonObject { ["width"] = width, ["height"] = height, ["background"] = "#000000" },
        ["elements"] = new JsonArray(),
    };

    private async Task<HttpResponseMessage> CreateAsync(string orientation, JsonObject doc)
    {
        var token = await Api.LoginAsync(_client);
        return await Api.PostAsync(_client, "/api/v1/schedules", new
        {
            name = "방향 검증",
            kind = "목록반복",
            orientation,
            org_id = 1,
            items = new object[] { new { day_of_week = -1, sort_order = 0, duration_sec = 10, content = doc } },
        }, token);
    }

    [Fact]
    public async Task 가로_스케줄에_가로_콘텐츠는_저장된다()
    {
        var response = await CreateAsync("LANDSCAPE", Doc(1920, 1080));
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"저장 실패: {body}");
        Assert.Equal("LANDSCAPE", body["orientation"]!.GetValue<string>());
    }

    [Fact]
    public async Task 아이템_전환_효과는_저장되고_그대로_돌아온다()
    {
        var token = await Api.LoginAsync(_client);
        var response = await Api.PostAsync(_client, "/api/v1/schedules", new
        {
            name = "전환 저장",
            kind = "목록반복",
            orientation = "LANDSCAPE",
            org_id = 1,
            items = new object[]
            {
                new
                {
                    day_of_week = -1, sort_order = 0, duration_sec = 10,
                    transition = "dissolve", transition_ms = 800, content = Doc(1920, 1080),
                },
            },
        }, token);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"저장 실패: {body}");

        var item = body["items"]!.AsArray()[0]!;
        Assert.Equal("dissolve", item["transition"]!.GetValue<string>());
        Assert.Equal(800, item["transition_ms"]!.GetValue<int>());
    }

    [Fact]
    public async Task 전환_시간이_표출_시간보다_길면_거부한다()
    {
        var token = await Api.LoginAsync(_client);
        var response = await Api.PostAsync(_client, "/api/v1/schedules", new
        {
            name = "전환 초과",
            kind = "목록반복",
            orientation = "LANDSCAPE",
            org_id = 1,
            items = new object[]
            {
                new
                {
                    day_of_week = -1, sort_order = 0, duration_sec = 3,
                    transition = "fade", transition_ms = 5000, content = Doc(1920, 1080),
                },
            },
        }, token);
        var body = await Api.ReadJsonAsync(response);
        Assert.Equal(400, (int)response.StatusCode);
        Assert.Contains("전환 시간은 표출 시간보다 길 수 없습니다", body["detail"]!.GetValue<string>());
    }

    [Fact]
    public async Task 방향이_어긋나면_한국어_이름으로_거부한다()
    {
        var response = await CreateAsync("LANDSCAPE", Doc(1080, 1920));
        var body = await Api.ReadJsonAsync(response);
        Assert.Equal(400, (int)response.StatusCode);
        var detail = body["detail"]!.GetValue<string>();
        Assert.Contains("가로형 스케줄에는 가로형 콘텐츠만", detail);
        Assert.Contains("세로형", detail);
    }
}

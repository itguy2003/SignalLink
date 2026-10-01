// Canva Connect 연동 검증 (FastAPI tests/test_canva.py 거울, 외부 호출 없음).

using Microsoft.AspNetCore.Hosting;
using SignalLink.Api.Services;

namespace SignalLink.Api.Tests;

public class CanvaApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task 설정이_없으면_상태와_안내가_그렇게_말한다()
    {
        var client = factory.CreateClient();
        var token = await Api.LoginAsync(client);

        var status = await Api.GetJsonAsync(client, "/api/v1/canva/status", token);
        Assert.False(status["configured"]!.GetValue<bool>());
        Assert.False(status["connected"]!.GetValue<bool>());

        var authorize = await Api.PostAsync(client, "/api/v1/canva/authorize", new { }, token);
        var body = await Api.ReadJsonAsync(authorize);
        Assert.Equal(400, (int)authorize.StatusCode);
        Assert.Contains("CANVA_CLIENT_ID", body["detail"]!.GetValue<string>());
    }

    [Fact]
    public async Task 인가_주소는_PKCE_와_상태를_싣는다()
    {
        using var configured = factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("CanvaClientId", "client-id-1");
            builder.UseSetting("CanvaClientSecret", "secret-1");
        });
        var client = configured.CreateClient();
        var token = await Api.LoginAsync(client);

        var response = await Api.PostAsync(client, "/api/v1/canva/authorize", new { }, token);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"authorize 실패: {body}");
        var url = body["url"]!.GetValue<string>();

        Assert.StartsWith(CanvaConnectService.AuthorizeEndpoint, url);
        Assert.Contains("client_id=client-id-1", url);
        Assert.Contains("code_challenge_method=s256", url);
        Assert.Contains("state=", url);
        Assert.Contains("canva%2Fcallback", url);

        // 미연결 상태의 디자인 조회는 연결 안내를 준다.
        var designs = await client.SendAsync(WithToken(
            new HttpRequestMessage(HttpMethod.Get, "/api/v1/canva/designs"), token));
        var designsBody = await Api.ReadJsonAsync(designs);
        Assert.Equal(400, (int)designs.StatusCode);
        Assert.Contains("연결되지 않았습니다", designsBody["detail"]!.GetValue<string>());

        // 모르는 state 콜백은 만료 안내 화면.
        var callback = await client.GetAsync("/api/v1/canva/callback?code=abc&state=unknown");
        Assert.Contains("만료", await callback.Content.ReadAsStringAsync());
    }

    private static HttpRequestMessage WithToken(HttpRequestMessage request, string token)
    {
        request.Headers.Authorization = new("Bearer", token);
        return request;
    }
}

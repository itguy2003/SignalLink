// 통합 테스트용 서버 팩토리.
//
// 진짜 Program 을 그대로 부팅하되(마이그레이션 + 부트스트랩 포함), DB 만
// 임시 SQLite 파일로 바꾼다 — 개발 DB(../backend/signallink.db)를 테스트가
// 절대 건드리면 안 된다. Program 의 .env 로더는 "설정이 이미 있으면 지지
// 않는" 규칙이라, 여기서 넣는 값이 언제나 이긴다.

using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using SignalLink.Api.Services;

namespace SignalLink.Api.Tests;

public sealed class ApiFactory : WebApplicationFactory<Program>
{
    private readonly string _dbPath = Path.Combine(
        Path.GetTempPath(), $"signallink-test-{Guid.NewGuid():N}.db");

    /// <summary>업로드 파일이 개발용 media/ 를 더럽히지 않게 임시 폴더를 준다.</summary>
    public string MediaRoot { get; } = Path.Combine(
        Path.GetTempPath(), $"signallink-media-{Guid.NewGuid():N}");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("SqlitePath", _dbPath);
        builder.UseSetting("DatabaseUrl", "");  // .env 의 운영 DB 주소를 무시한다.
        builder.UseSetting("SecretKey", "integration-test-secret-key-0123456789");
        builder.UseSetting("DeviceMasterKey", "integration-test-device-master-key");
        builder.UseSetting("PasswordComplexity", "off");
        builder.UseSetting("MediaRoot", MediaRoot);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try { File.Delete(_dbPath); } catch (IOException) { }
        try { Directory.Delete(MediaRoot, recursive: true); } catch { /* 없어도 된다 */ }
    }
}

/// <summary>스네이크케이스 JSON 으로 말하는 얇은 API 헬퍼.</summary>
public static class Api
{
    public static async Task<HttpResponseMessage> PostAsync(
        HttpClient client, string path, object body, string? token = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(body, options: JsonDefaults.SnakeCase),
        };
        if (token is not null) request.Headers.Authorization = new("Bearer", token);
        return await client.SendAsync(request);
    }

    public static async Task<HttpResponseMessage> PutAsync(
        HttpClient client, string path, object body, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = JsonContent.Create(body, options: JsonDefaults.SnakeCase),
        };
        request.Headers.Authorization = new("Bearer", token);
        return await client.SendAsync(request);
    }

    public static async Task<JsonNode> GetJsonAsync(HttpClient client, string path, string? token = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null) request.Headers.Authorization = new("Bearer", token);
        var response = await client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{path} -> {(int)response.StatusCode}: {text}");
        return JsonNode.Parse(text)!;
    }

    public static async Task<JsonNode> ReadJsonAsync(HttpResponseMessage response) =>
        JsonNode.Parse(await response.Content.ReadAsStringAsync())!;

    public static async Task<string> LoginAsync(
        HttpClient client, string userId = "admin", string password = "admin1234")
    {
        var response = await PostAsync(client, "/api/v1/auth/login", new { user_id = userId, password });
        var body = await ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"login {userId} 실패: {body}");
        return body["access_token"]!.GetValue<string>();
    }
}

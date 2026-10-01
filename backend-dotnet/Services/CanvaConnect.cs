// Canva Connect(공식 REST API) 연동 — FastAPI(app/services/canva_connect.py)의 짝.
//
// 사용자가 자기 Canva 계정을 OAuth(PKCE)로 연결하면, 서버가 토큰을 보관하고
// 디자인 목록 조회·PNG 내보내기를 대신 수행해 자산 라이브러리에 저장한다.
// 토큰·클라이언트 시크릿은 서버만 안다 — 프런트에 내리면 새어 나간다.
//
// 필요한 설정(.env): CANVA_CLIENT_ID / CANVA_CLIENT_SECRET
//   (+ 선택 CANVA_REDIRECT_URI — 비우면 <요청 호스트>/api/v1/canva/callback)
// Canva 개발자 포털에서 통합(Integration)을 만들고 위 리디렉션 URI 를
// 등록해야 한다. 사용 스코프: design:meta:read design:content:read.

using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Data;

namespace SignalLink.Api.Services;

/// <summary>사용자에게 그대로 보여 줄 문구를 담는다.</summary>
public class CanvaException(string message, int status = 502) : Exception(message)
{
    public int Status { get; } = status;
}

public class CanvaConnectService(AppDbContext db, IConfiguration config, IHttpClientFactory httpFactory)
{
    public const string AuthorizeEndpoint = "https://www.canva.com/api/oauth/authorize";
    public const string ApiBase = "https://api.canva.com/rest/v1";
    public const string Scopes = "design:meta:read design:content:read";

    /// <summary>내보내기 완료 대기 상한 — 큰 디자인도 이 안에는 끝난다.</summary>
    private const int ExportTimeoutSec = 60;

    /// <summary>한 디자인에서 받는 최대 장 수. 수백 장짜리 문서로 폭주하지 않게.</summary>
    private const int MaxPages = 10;

    private string ClientId => config["CanvaClientId"] ?? "";
    private string ClientSecret => config["CanvaClientSecret"] ?? "";

    public bool IsConfigured => ClientId.Length > 0 && ClientSecret.Length > 0;

    public string RedirectUri(HttpRequest request) =>
        config["CanvaRedirectUri"] is { Length: > 0 } fixedUri
            ? fixedUri
            : $"{request.Scheme}://{request.Host}/api/v1/canva/callback";

    // ------------------------------------------------------------ OAuth(PKCE)

    /// <summary>state → (검증값, 사용자). 콜백은 비인증이라 state 가 신원을 잇는다.</summary>
    private static readonly ConcurrentDictionary<string, (string Verifier, int UserId, DateTime ExpiresAt)>
        PendingStates = new();

    private static string RandomToken() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

    private static string CodeChallenge(string verifier) =>
        Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public string CreateAuthorizeUrl(int userId, string redirectUri)
    {
        // 지난 것 청소 — 창을 그냥 닫은 시도가 쌓이지 않게.
        foreach (var (key, value) in PendingStates)
            if (value.ExpiresAt < DateTime.UtcNow) PendingStates.TryRemove(key, out _);

        var verifier = RandomToken() + RandomToken();  // 43~128자 요건
        var state = RandomToken();
        PendingStates[state] = (verifier, userId, DateTime.UtcNow.AddMinutes(10));

        var query = new Dictionary<string, string>
        {
            ["code_challenge"] = CodeChallenge(verifier),
            ["code_challenge_method"] = "s256",
            ["scope"] = Scopes,
            ["response_type"] = "code",
            ["client_id"] = ClientId,
            ["state"] = state,
            ["redirect_uri"] = redirectUri,
        };
        var joined = string.Join("&", query.Select(p => $"{p.Key}={Uri.EscapeDataString(p.Value)}"));
        return $"{AuthorizeEndpoint}?{joined}";
    }

    public (string Verifier, int UserId)? TakeState(string state)
    {
        if (!PendingStates.TryRemove(state, out var pending)) return null;
        return pending.ExpiresAt < DateTime.UtcNow ? null : (pending.Verifier, pending.UserId);
    }

    private async Task<JsonObject> TokenRequestAsync(Dictionary<string, string> form)
    {
        var client = httpFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(30);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{ApiBase}/oauth/token")
        {
            Content = new FormUrlEncodedContent(form),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Basic", Convert.ToBase64String(Encoding.ASCII.GetBytes($"{ClientId}:{ClientSecret}")));

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request);
        }
        catch (HttpRequestException)
        {
            throw new CanvaException("Canva 에 연결할 수 없습니다.");
        }
        var body = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
            throw new CanvaException("Canva 인증에 실패했습니다. 다시 연결해 주세요.", 400);
        return JsonNode.Parse(body) as JsonObject
            ?? throw new CanvaException("Canva 응답을 읽을 수 없습니다.");
    }

    /// <summary>인가 코드를 토큰으로 바꿔 사용자 연결로 저장한다.</summary>
    public async Task ExchangeCodeAsync(int userId, string code, string verifier, string redirectUri)
    {
        var token = await TokenRequestAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["code_verifier"] = verifier,
            ["redirect_uri"] = redirectUri,
        });
        await SaveTokenAsync(userId, token);
    }

    private async Task SaveTokenAsync(int userId, JsonObject token)
    {
        var account = await db.CanvaAccounts.SingleOrDefaultAsync(a => a.UserId == userId);
        var now = DateTime.UtcNow;
        if (account is null)
        {
            account = new CanvaAccount { UserId = userId, CreatedAt = now };
            db.CanvaAccounts.Add(account);
        }
        account.AccessToken = token["access_token"]?.GetValue<string>() ?? "";
        // 회전식 — 새 refresh_token 이 오면 옛것은 못 쓴다.
        account.RefreshToken = token["refresh_token"]?.GetValue<string>() ?? account.RefreshToken;
        var expiresIn = token["expires_in"]?.GetValue<int?>() ?? 3600;
        account.ExpiresAt = now.AddSeconds(expiresIn);
        account.UpdatedAt = now;
        await db.SaveChangesAsync();
    }

    public Task<CanvaAccount?> AccountOfAsync(int userId) =>
        db.CanvaAccounts.SingleOrDefaultAsync(a => a.UserId == userId);

    public async Task DisconnectAsync(int userId)
    {
        var account = await db.CanvaAccounts.SingleOrDefaultAsync(a => a.UserId == userId);
        if (account is null) return;
        db.CanvaAccounts.Remove(account);
        await db.SaveChangesAsync();
    }

    /// <summary>유효한 접근 토큰. 만료가 가까우면 갱신해 저장한다.</summary>
    private async Task<string> AccessTokenAsync(CanvaAccount account)
    {
        if (account.ExpiresAt > DateTime.UtcNow.AddMinutes(1)) return account.AccessToken;
        var token = await TokenRequestAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = account.RefreshToken,
        });
        await SaveTokenAsync(account.UserId, token);
        return token["access_token"]?.GetValue<string>() ?? "";
    }

    // ------------------------------------------------------------ Connect API

    private async Task<JsonObject> ApiAsync(CanvaAccount account, HttpMethod method, string path, JsonObject? body = null)
    {
        var client = httpFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(30);
        using var request = new HttpRequestMessage(method, $"{ApiBase}{path}");
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer", await AccessTokenAsync(account));
        if (body is not null)
            request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request);
        }
        catch (HttpRequestException)
        {
            throw new CanvaException("Canva 에 연결할 수 없습니다.");
        }
        var text = await response.Content.ReadAsStringAsync();
        if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            throw new CanvaException("Canva 연결이 만료되었습니다. 다시 연결해 주세요.", 401);
        if (!response.IsSuccessStatusCode)
            throw new CanvaException("Canva 요청에 실패했습니다.");
        return JsonNode.Parse(text) as JsonObject
            ?? throw new CanvaException("Canva 응답을 읽을 수 없습니다.");
    }

    /// <summary>디자인 목록 — 편집기에서 고를 만큼만 추린 필드.</summary>
    public async Task<JsonObject> ListDesignsAsync(CanvaAccount account, string? query, string? continuation)
    {
        var path = "/designs?limit=30";
        if (!string.IsNullOrEmpty(query)) path += $"&query={Uri.EscapeDataString(query)}";
        if (!string.IsNullOrEmpty(continuation)) path += $"&continuation={Uri.EscapeDataString(continuation)}";
        var body = await ApiAsync(account, HttpMethod.Get, path);

        var items = new JsonArray();
        foreach (var item in (body["items"] as JsonArray ?? []).OfType<JsonObject>())
        {
            items.Add(new JsonObject
            {
                ["id"] = item["id"]?.GetValue<string>(),
                ["title"] = item["title"]?.GetValue<string?>() ?? "(제목 없음)",
                ["thumbnail_url"] = item["thumbnail"]?["url"]?.GetValue<string?>(),
                ["updated_at"] = item["updated_at"]?.GetValue<long?>(),
            });
        }
        return new JsonObject
        {
            ["items"] = items,
            ["continuation"] = body["continuation"]?.GetValue<string?>(),
        };
    }

    /// <summary>디자인을 PNG 로 내보내 장별 바이트를 돌려준다.</summary>
    public async Task<List<byte[]>> ExportDesignAsync(CanvaAccount account, string designId)
    {
        var job = await ApiAsync(account, HttpMethod.Post, "/exports", new JsonObject
        {
            ["design_id"] = designId,
            ["format"] = new JsonObject { ["type"] = "png" },
        });
        var jobId = job["job"]?["id"]?.GetValue<string>()
            ?? throw new CanvaException("내보내기 작업을 만들지 못했습니다.");

        JsonObject status = job;
        var deadline = DateTime.UtcNow.AddSeconds(ExportTimeoutSec);
        while (true)
        {
            var state = status["job"]?["status"]?.GetValue<string>();
            if (state == "success") break;
            if (state == "failed")
                throw new CanvaException("Canva 내보내기가 실패했습니다.");
            if (DateTime.UtcNow > deadline)
                throw new CanvaException("Canva 내보내기가 시간 내에 끝나지 않았습니다.");
            await Task.Delay(1000);
            status = await ApiAsync(account, HttpMethod.Get, $"/exports/{jobId}");
        }

        var urls = (status["job"]?["urls"] as JsonArray ?? [])
            .Select(u => u?.GetValue<string>())
            .Where(u => !string.IsNullOrEmpty(u))
            .Take(MaxPages)
            .ToList();
        if (urls.Count == 0) throw new CanvaException("내보낸 파일 주소가 없습니다.");

        var client = httpFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(60);
        var pages = new List<byte[]>();
        foreach (var url in urls)
        {
            var response = await client.GetAsync(url);
            if (!response.IsSuccessStatusCode)
                throw new CanvaException("내보낸 파일을 내려받지 못했습니다.");
            pages.Add(await response.Content.ReadAsByteArrayAsync());
        }
        return pages;
    }
}

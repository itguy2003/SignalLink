// 스톡 소재 검색(Pixabay) — FastAPI /api/v1/stock + services/pixabay.py 의 짝.
//
// 외부 호출을 서버가 대신한다 — API 키를 브라우저에 내려보내지 않기 위해서.
// 고른 소재는 우리 자산으로 받아 저장한다. 바깥 주소를 그대로 문서에 넣으면
// 폐쇄망 장치에서 표출되지 않고, 원본이 사라지면 화면이 깨진다.

using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record StockHit(
    string Kind, long? Id, string? Preview, string Url, int? Width, int? Height,
    int? Duration, string? Tags, string? Author, string? Page);

public record StockSearchResult(List<StockHit> Items, int Total, int Page, int PerPage);

public record StockStatus(bool Configured, string Provider = "pixabay");

public record StockSaveRequest(
    string Url, string Kind = "image", string? Filename = null,
    string? Author = null, string? Page = null, int? OrgId = null);

[ApiController]
[Route("api/v1/stock")]
[Authorize]
public class StockController(
    AppDbContext db, AssetService assets, PermissionService permissions,
    IConfiguration config, IHttpClientFactory httpFactory) : ControllerBase
{
    private const string ImageApiUrl = "https://pixabay.com/api/";
    private const string VideoApiUrl = "https://pixabay.com/api/videos/";

    private string ApiKey => config["PixabayApiKey"] ?? "";
    private double TimeoutSec =>
        double.TryParse(config["PixabayTimeoutSec"], out var sec) ? sec : 10.0;

    [HttpGet("status")]
    public ActionResult<StockStatus> Status() => new StockStatus(!string.IsNullOrEmpty(ApiKey));

    [HttpGet("search")]
    public async Task<ActionResult<StockSearchResult>> Search(
        [FromQuery] string q,
        [FromQuery] string kind = "image",
        [FromQuery] int page = 1,
        [FromQuery(Name = "per_page")] int perPage = 24,
        [FromQuery] string? orientation = null)
    {
        if (kind is not ("image" or "video"))
            return BadRequest(new { detail = "kind 는 image 또는 video 여야 합니다." });
        if (orientation is not (null or "horizontal" or "vertical"))
            return BadRequest(new { detail = "orientation 은 horizontal 또는 vertical 이어야 합니다." });
        if (string.IsNullOrEmpty(ApiKey))
            return StatusCode(503, new { detail = "Pixabay API 키가 설정되지 않았습니다. 서버의 PIXABAY_API_KEY 를 지정하세요." });

        perPage = Math.Clamp(perPage, 3, 200);
        var url = kind == "image" ? ImageApiUrl : VideoApiUrl;
        var query = $"?key={Uri.EscapeDataString(ApiKey)}&q={Uri.EscapeDataString(q)}" +
                    $"&page={page}&per_page={perPage}&safesearch=true";
        if (kind == "image")
        {
            query += "&image_type=photo";
            if (orientation is not null) query += $"&orientation={orientation}";
        }

        JsonNode? body;
        try
        {
            var client = httpFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(TimeoutSec);
            var response = await client.GetAsync(url + query);
            if ((int)response.StatusCode == 429)
                return StatusCode(502, new { detail = "검색 호출 한도를 초과했습니다. 잠시 후 다시 시도하세요." });
            if (!response.IsSuccessStatusCode)
                return StatusCode(502, new { detail = "검색에 실패했습니다." });
            body = JsonNode.Parse(await response.Content.ReadAsStringAsync());
        }
        catch (TaskCanceledException)
        {
            return StatusCode(502, new { detail = "검색이 시간 내에 응답하지 않았습니다." });
        }
        catch (HttpRequestException)
        {
            // 폐쇄망이면 외부로 나갈 수 없다 — 흔한 상황이다.
            return StatusCode(502, new { detail = "검색 서버에 연결할 수 없습니다." });
        }

        var hits = new List<StockHit>();
        foreach (var hit in body?["hits"] as JsonArray ?? [])
        {
            if (hit is not JsonObject obj) continue;
            var converted = kind == "image" ? ToImage(obj) : ToVideo(obj);
            if (converted is not null && !string.IsNullOrEmpty(converted.Url))
                hits.Add(converted);
        }
        return new StockSearchResult(
            hits, body?["totalHits"]?.GetValue<int>() ?? 0, page, perPage);
    }

    private static StockHit? ToImage(JsonObject hit) => new(
        "image",
        hit["id"]?.GetValue<long?>(),
        hit["previewURL"]?.GetValue<string?>(),
        hit["largeImageURL"]?.GetValue<string?>() ?? hit["webformatURL"]?.GetValue<string?>() ?? "",
        hit["imageWidth"]?.GetValue<int?>(),
        hit["imageHeight"]?.GetValue<int?>(),
        null,
        hit["tags"]?.GetValue<string?>(),
        hit["user"]?.GetValue<string?>(),
        hit["pageURL"]?.GetValue<string?>());

    private static StockHit? ToVideo(JsonObject hit)
    {
        // DID 는 대개 1080p — large 를 먼저 쓰고 없으면 한 단계씩 내려간다.
        JsonObject? best = null;
        var videos = hit["videos"] as JsonObject;
        foreach (var quality in new[] { "large", "medium", "small", "tiny" })
        {
            if (videos?[quality] is JsonObject candidate
                && !string.IsNullOrEmpty(candidate["url"]?.GetValue<string?>()))
            {
                best = candidate;
                break;
            }
        }
        var pictureId = hit["picture_id"]?.GetValue<string?>();
        return new StockHit(
            "video",
            hit["id"]?.GetValue<long?>(),
            pictureId is null ? null : $"https://i.vimeocdn.com/video/{pictureId}_295x166.jpg",
            best?["url"]?.GetValue<string?>() ?? "",
            best?["width"]?.GetValue<int?>(),
            best?["height"]?.GetValue<int?>(),
            hit["duration"]?.GetValue<int?>(),
            hit["tags"]?.GetValue<string?>(),
            hit["user"]?.GetValue<string?>(),
            hit["pageURL"]?.GetValue<string?>());
    }

    /// <summary>바깥 소재를 받아 우리 자산으로 저장 — 업로드와 같은 자리, 같은 모양.</summary>
    [HttpPost("save")]
    public async Task<ActionResult<AssetDetailOut>> Save(StockSaveRequest payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var targetOrg = payload.OrgId ?? actor.OrgId;
        if (!await permissions.CanManageOrgAsync(actor, targetOrg))
            return StatusCode(403, new { detail = "해당 기관에 파일을 올릴 권한이 없습니다." });

        byte[] data;
        string contentType;
        try
        {
            var client = httpFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(TimeoutSec * 6);
            var response = await client.GetAsync(payload.Url);
            if (!response.IsSuccessStatusCode)
                return StatusCode(502, new { detail = "소재를 내려받지 못했습니다." });
            data = await response.Content.ReadAsByteArrayAsync();
            contentType = response.Content.Headers.ContentType?.MediaType ?? "";
        }
        catch (TaskCanceledException)
        {
            return StatusCode(502, new { detail = "소재를 내려받는 데 시간이 너무 걸립니다." });
        }
        catch (HttpRequestException)
        {
            return StatusCode(502, new { detail = "소재를 내려받지 못했습니다." });
        }

        if (data.Length == 0) return BadRequest(new { detail = "빈 파일입니다." });

        // 제공처가 알려 준 형식을 그대로 믿지 않는다.
        var kind = AssetService.KindOf(contentType);
        if (kind is null)
            return BadRequest(new { detail = $"지원하지 않는 형식입니다: {(string.IsNullOrEmpty(contentType) ? "알 수 없음" : contentType)}" });

        var limit = AssetService.MaxBytes(kind);
        if (data.Length > limit)
            return BadRequest(new { detail = $"파일은 {limit / (1024 * 1024)}MB 이하여야 합니다." });

        var extension = Path.GetExtension(new Uri(payload.Url).AbsolutePath);
        var relative = await StoreBytesAsync(data, kind, contentType);

        var now = DateTime.UtcNow;
        var asset = new Asset
        {
            OrgId = targetOrg,
            UploadedBy = actor.Id,
            Kind = kind,
            Filename = payload.Filename ?? $"pixabay-{kind}",
            ContentType = contentType,
            SizeBytes = data.Length,
            StoragePath = relative,
            CreatedAt = now,
            UpdatedAt = now,
        };
        assets.AttachThumbnail(asset);
        db.Assets.Add(asset);
        await db.SaveChangesAsync();

        var org = await db.Organizations.FindAsync(asset.OrgId);
        return StatusCode(201, new AssetDetailOut(
            asset.Id, asset.OrgId, asset.UploadedBy, asset.Kind, asset.Filename,
            asset.ContentType, asset.SizeBytes, asset.CreatedAt,
            AssetService.PublicUrl(asset), AssetService.ThumbUrl(asset),
            org?.Name, 0));
    }

    /// <summary>바이트를 자산 저장소에 쓴다 — store_stream 의 동기판.</summary>
    private async Task<string> StoreBytesAsync(byte[] data, string kind, string contentType)
    {
        var extension = contentType switch
        {
            "image/jpeg" => ".jpg", "image/png" => ".png", "image/webp" => ".webp",
            "image/gif" => ".gif", "image/svg+xml" => ".svg",
            "video/mp4" => ".mp4", "video/webm" => ".webm", "video/ogg" => ".ogv",
            _ => ".bin",
        };
        var today = DateTime.UtcNow.ToString("yyyy/MM");
        var name = Convert.ToHexString(
            System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var relative = $"{kind}/{today}/{name}{extension}";
        var path = Path.Combine(assets.MediaRoot, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await System.IO.File.WriteAllBytesAsync(path, data);
        return relative;
    }
}

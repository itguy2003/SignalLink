// 업로드 자산 저장·색인 — FastAPI(app/services/assets.py + thumbnails.py)의 짝.
//
// 바이너리는 DB 가 아니라 파일 시스템(../backend/media — FastAPI 와 같은
// 저장소)에 둔다. 조각으로 받아 쓰고, 상한을 넘는 순간 쓰던 파일을 지우고
// 끊는다 — 10GB 를 다 받고 나서 거절하면 회선과 디스크를 그만큼 버린다.
//
// 썸네일은 없어도 되는 부가물이다. 무엇이 실패하든 업로드는 성공해야 한다.
// 이미지는 ImageSharp, 동영상은 ffmpeg(있을 때만)으로 만든다.

using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Data;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Processing;

namespace SignalLink.Api.Services;

public class UploadRejectedException(string message) : Exception(message);

public class AssetService(AppDbContext db, IConfiguration config)
{
    private static readonly Dictionary<string, string> ImageTypes = new()
    {
        ["image/jpeg"] = ".jpg",
        ["image/png"] = ".png",
        ["image/webp"] = ".webp",
        ["image/gif"] = ".gif",
        ["image/svg+xml"] = ".svg",
    };

    private static readonly Dictionary<string, string> VideoTypes = new()
    {
        ["video/mp4"] = ".mp4",
        ["video/webm"] = ".webm",
        ["video/ogg"] = ".ogv",
    };

    public const long MaxImageBytes = 200L * 1024 * 1024;
    /// <summary>동영상 상한 100MB — DID 표출용 클립 기준(파이썬 MAX_VIDEO_BYTES 의 짝).</summary>
    public const long MaxVideoBytes = 100L * 1024 * 1024;
    private const int ThumbMax = 480;

    public string MediaRoot => config["MediaRoot"] ?? Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "backend", "media"));

    /// <summary>MIME 으로 갈래를 정한다. 모르는 형식이면 null.</summary>
    public static string? KindOf(string? contentType) => contentType switch
    {
        not null when ImageTypes.ContainsKey(contentType) => "image",
        not null when VideoTypes.ContainsKey(contentType) => "video",
        // ffmpeg 변환 전제로 받는 형식 — 저장 직후 MP4 로 바뀐다(VideoTranscode).
        not null when VideoTranscodeService.TranscodeOnlyTypes.ContainsKey(contentType) => "video",
        _ => null,
    };

    public static long MaxBytes(string kind) => kind == "video" ? MaxVideoBytes : MaxImageBytes;

    public string AbsolutePath(Asset asset) =>
        Path.Combine(MediaRoot, asset.StoragePath.Replace('/', Path.DirectorySeparatorChar));

    public static string PublicUrl(Asset asset) =>
        $"/api/v1/assets/{asset.Id}/{asset.Token}/file";

    public static string? ThumbUrl(Asset asset) =>
        asset.ThumbPath is null ? null : $"/api/v1/assets/{asset.Id}/{asset.Token}/thumb";

    /// <summary>저장 경로 — 날짜로 나누고 이름은 무작위(FastAPI 와 같은 규칙).</summary>
    /// <summary>변환기가 새 파일 경로를 지을 때도 같은 규칙을 쓴다.</summary>
    public static string RelativeMediaPath(string kind, string extension) =>
        RelativePath(kind, extension);

    private static string RelativePath(string kind, string extension)
    {
        var today = DateTime.UtcNow.ToString("yyyy/MM");
        var name = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        return $"{kind}/{today}/{name}{extension}";
    }

    /// <summary>업로드 파일을 조각으로 저장한다. (상대 경로, 크기).</summary>
    public async Task<(string relative, long size)> StoreStreamAsync(
        IFormFile file, string kind, string contentType)
    {
        var limit = MaxBytes(kind);
        var extension = kind == "image"
            ? ImageTypes[contentType]
            : VideoTypes.TryGetValue(contentType, out var known)
                ? known
                : VideoTranscodeService.TranscodeOnlyTypes[contentType];
        var relative = RelativePath(kind, extension);
        var path = Path.Combine(MediaRoot, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        long size = 0;
        try
        {
            await using var output = File.Create(path);
            await using var input = file.OpenReadStream();
            var buffer = new byte[4 * 1024 * 1024];
            int read;
            while ((read = await input.ReadAsync(buffer)) > 0)
            {
                size += read;
                if (size > limit)
                    throw new UploadRejectedException($"파일은 {limit / (1024 * 1024)}MB 이하여야 합니다.");
                await output.WriteAsync(buffer.AsMemory(0, read));
            }
        }
        catch
        {
            // 반쯤 쓴 파일을 남기면 디스크에 유령이 쌓인다.
            try { File.Delete(path); } catch { /* 이미 없다 */ }
            throw;
        }

        if (size == 0)
        {
            try { File.Delete(path); } catch { /* 이미 없다 */ }
            throw new UploadRejectedException("빈 파일입니다.");
        }
        return (relative, size);
    }

    public void RemoveFile(Asset asset)
    {
        try { File.Delete(AbsolutePath(asset)); } catch { /* 이미 없어도 오류가 아니다 */ }
        if (asset.ThumbPath is not null)
        {
            var thumb = Path.Combine(MediaRoot, asset.ThumbPath.Replace('/', Path.DirectorySeparatorChar));
            try { File.Delete(thumb); } catch { /* 위와 같다 */ }
        }
    }

    // ---------------------------------------------------------------- 썸네일

    /// <summary>저장된 원본으로 썸네일을 만들어 자산에 적는다. 실패해도 조용하다.</summary>
    public void AttachThumbnail(Asset asset)
    {
        asset.ThumbPath = Generate(asset.StoragePath, asset.Kind, asset.ContentType);
    }

    private string? Generate(string storagePath, string kind, string contentType)
    {
        var thumbRelative = $"{storagePath}.thumb.jpg";
        var source = Path.Combine(MediaRoot, storagePath.Replace('/', Path.DirectorySeparatorChar));
        var target = Path.Combine(MediaRoot, thumbRelative.Replace('/', Path.DirectorySeparatorChar));
        try
        {
            if (kind == "image")
            {
                if (contentType == "image/svg+xml") return null;  // 벡터는 원본이 이미 작다.
                using var image = Image.Load(source);
                image.Mutate(x => x.Resize(new ResizeOptions
                {
                    Mode = ResizeMode.Max,
                    Size = new Size(ThumbMax, ThumbMax),
                }));
                image.Save(target, new JpegEncoder { Quality = 82 });
            }
            else if (kind == "video")
            {
                if (!ExtractFrame(source, target)) return null;
            }
            else
            {
                return null;
            }
        }
        catch
        {
            try { File.Delete(target); } catch { /* 반쯤 쓴 썸네일 정리 */ }
            return null;
        }
        return File.Exists(target) ? thumbRelative : null;
    }

    /// <summary>ffmpeg 으로 프레임 하나. 1초 지점 먼저(첫 프레임은 검은 영상이 많다).</summary>
    private static bool ExtractFrame(string source, string target)
    {
        foreach (var seek in new[] { "-ss 1 ", "" })
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "ffmpeg",
                    Arguments = $"-y -loglevel error {seek}-i \"{source}\" -frames:v 1 " +
                                $"-vf \"scale='min({ThumbMax},iw)':-2\" \"{target}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using var process = Process.Start(psi);
                if (process is null) return false;
                if (!process.WaitForExit(30_000)) { process.Kill(); continue; }
                if (process.ExitCode == 0 && File.Exists(target) && new FileInfo(target).Length > 0)
                    return true;
            }
            catch
            {
                return false;  // ffmpeg 이 없는 서버 — 썸네일만 조용히 빠진다.
            }
        }
        try { File.Delete(target); } catch { /* 정리 */ }
        return false;
    }

    // ---------------------------------------------------------------- 문서 색인

    /// <summary>문서의 src 가 우리 자산을 가리키면 그 id. 열쇠 전 형식도 읽는다.</summary>
    public static int? AssetIdFromUrl(string? src)
    {
        if (string.IsNullOrEmpty(src)) return null;
        var at = src.IndexOf("/assets/", StringComparison.Ordinal);
        if (at < 0) return null;
        var head = src[(at + "/assets/".Length)..].Split('/', 2)[0];
        return int.TryParse(head, out var id) ? id : null;
    }

    /// <summary>위젯 옵션이 가리키는 자산 id 들 — 키 이름이 아니라 값의 모양으로 판단.</summary>
    public static HashSet<int> OptionAssetIds(JsonNode? options)
    {
        var ids = new HashSet<int>();
        if (options is not JsonObject obj) return ids;
        foreach (var (_, value) in obj)
        {
            var candidates = value is JsonArray array ? array.ToList() : [value];
            foreach (var candidate in candidates)
            {
                // 앨범의 한 장은 {"src": ...} 이거나 주소 문자열이다.
                var src = candidate switch
                {
                    JsonObject item => item["src"]?.GetValue<string?>(),
                    JsonValue leaf when leaf.TryGetValue<string>(out var text) => text,
                    _ => null,
                };
                if (AssetIdFromUrl(src) is int id) ids.Add(id);
            }
        }
        return ids;
    }

    /// <summary>문서가 쓰는 자산 id — 이미지·동영상 요소의 src + 위젯 옵션 속 주소.</summary>
    public static HashSet<int> ReferencedIds(JsonNode? document)
    {
        var ids = new HashSet<int>();
        if (document?["elements"] is not JsonArray elements) return ids;
        foreach (var element in elements)
        {
            if (element is not JsonObject obj) continue;
            var type = obj["type"]?.GetValue<string?>();
            if (type is "image" or "video")
            {
                if (AssetIdFromUrl(obj["src"]?.GetValue<string?>()) is int id) ids.Add(id);
            }
            else if (type == "widget")
            {
                ids.UnionWith(OptionAssetIds(obj["options"]));
            }
        }
        return ids;
    }

    /// <summary>이 자산을 쓰는 곳의 수 — 삭제해도 되는지의 근거.</summary>
    public async Task<int> UsageCountAsync(int assetId)
    {
        var contents = await db.ContentAssets.Where(l => l.AssetId == assetId)
            .Select(l => l.ContentId).Distinct().CountAsync();
        var playlists = await db.PlaylistAssets.Where(l => l.AssetId == assetId)
            .Select(l => l.PlaylistId).Distinct().CountAsync();
        var communityPlaylists = await db.CommunityPlaylistAssets.Where(l => l.AssetId == assetId)
            .Select(l => l.PlaylistId).Distinct().CountAsync();
        return contents + playlists + communityPlaylists;
    }

    private async Task<HashSet<int>> AliveAsync(HashSet<int> wanted)
    {
        if (wanted.Count == 0) return wanted;
        // 지워진 자산을 가리키는 문서도 있다. 있는 것만 건다 — 없는 id 를
        // 걸면 FK 위반으로 저장이 통째로 실패한다.
        var alive = await db.Assets.Where(a => wanted.Contains(a.Id))
            .Select(a => a.Id).ToListAsync();
        return alive.ToHashSet();
    }

    /// <summary>콘텐츠의 자산 색인을 문서와 맞춘다. 저장은 호출자가 한다.</summary>
    public async Task SyncContentLinksAsync(Content content)
    {
        var wanted = await AliveAsync(ReferencedIds(Json.Parse(content.DocumentJson)));
        var current = content.AssetLinks.ToDictionary(l => l.AssetId);
        foreach (var id in wanted.Where(id => !current.ContainsKey(id)))
            content.AssetLinks.Add(new ContentAsset { AssetId = id });
        foreach (var (id, link) in current.Where(kv => !wanted.Contains(kv.Key)))
        {
            content.AssetLinks.Remove(link);
            db.ContentAssets.Remove(link);
        }
    }

    /// <summary>재생목록 칸의 옵션이 가리키는 자산 색인(이미지앨범의 사진들).</summary>
    public async Task SyncPlaylistLinksAsync(Playlist playlist)
    {
        var wanted = new HashSet<int>();
        foreach (var item in playlist.Items)
            wanted.UnionWith(OptionAssetIds(Json.Parse(item.OptionsJson)));
        wanted = await AliveAsync(wanted);

        var current = playlist.AssetLinks.ToDictionary(l => l.AssetId);
        foreach (var id in wanted.Where(id => !current.ContainsKey(id)))
            playlist.AssetLinks.Add(new PlaylistAsset { AssetId = id });
        foreach (var (id, link) in current.Where(kv => !wanted.Contains(kv.Key)))
        {
            playlist.AssetLinks.Remove(link);
            db.PlaylistAssets.Remove(link);
        }
    }

}

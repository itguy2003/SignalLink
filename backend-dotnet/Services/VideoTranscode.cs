// 업로드 동영상을 웹 표준으로 정규화 — FastAPI(app/services/video_transcode.py)의 짝.
//
// 브라우저(플레이어)가 <video> 로 그리는 것은 사실상 H.264+AAC MP4 하나다.
// 휴대폰·캠코더가 만드는 .mov(HEVC)·.mkv·.avi 는 올려도 장치에서 안 나온다 —
// 그래서 저장 직후 서버가 ffmpeg 으로 변환해 **항상 재생되는 파일**만 남긴다.
//
// 규칙(파리티 계약):
//   * 이미 웹 호환(H.264 + AAC/무음 + .mp4)이면 재인코딩 없이 remux 만
//     (-c copy -movflags +faststart) — 순간 시작을 보장하면서 무손실.
//   * 그 외에는 H.264(veryfast, crf 23) + AAC 128k 로 변환.
//   * ffmpeg/ffprobe 는 썸네일과 같은 관례로 PATH 에서 찾는다. 없으면
//     mp4/webm/ogv 는 원본 유지, 변환 전용 형식(.mov 등)은 거절.
//   * 변환 실패도 같은 규칙. ffmpeg 때문에 업로드 요청이 죽지는 않는다.

using System.Diagnostics;
using System.Text.Json.Nodes;

namespace SignalLink.Api.Services;

public class VideoTranscodeService(AssetService assets, ILogger<VideoTranscodeService> logger)
{
    /// <summary>서버 변환이 있어야만 받는 형식 — 브라우저가 직접 못 그린다.</summary>
    public static readonly Dictionary<string, string> TranscodeOnlyTypes = new()
    {
        ["video/quicktime"] = ".mov",
        ["video/x-msvideo"] = ".avi",
        ["video/x-matroska"] = ".mkv",
    };

    private const int TranscodeTimeoutSec = 1800;

    private const string NoFfmpegMessage =
        "이 형식은 서버 변환(ffmpeg)이 필요합니다. MP4/WebM/OGG 로 올려 주세요.";

    private const string FailedMessage =
        "동영상을 변환하지 못했습니다. 파일이 손상되지 않았는지 확인하세요.";

    private static bool ToolExists(string name)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = name,
                Arguments = "-version",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            });
            process!.WaitForExit(10_000);
            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    public static bool IsAvailable() => ToolExists("ffmpeg") && ToolExists("ffprobe");

    /// <summary>(비디오 코덱, 오디오 코덱). 못 읽으면 null — 웹 호환이 아니라고 본다.</summary>
    private static (string? Video, string? Audio)? ProbeCodecs(string path)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = "ffprobe",
                Arguments = $"-v error -show_entries stream=codec_type,codec_name -of json \"{path}\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            });
            var output = process!.StandardOutput.ReadToEnd();
            if (!process.WaitForExit(60_000) || process.ExitCode != 0) return null;
            var streams = JsonNode.Parse(output)?["streams"] as JsonArray;
            if (streams is null) return null;
            string? video = null, audio = null;
            foreach (var stream in streams.OfType<JsonObject>())
            {
                var type = stream["codec_type"]?.GetValue<string?>();
                var codec = stream["codec_name"]?.GetValue<string?>();
                if (type == "video") video ??= codec;
                if (type == "audio") audio ??= codec;
            }
            return (video, audio);
        }
        catch
        {
            return null;
        }
    }

    private bool RunFfmpeg(string source, string target, bool copy)
    {
        var codecArgs = copy
            ? "-c copy"
            // 4:2:2/10bit 소스도 있어 yuv420p 를 강제한다 — 브라우저 디코더는 4:2:0 만 본다.
            : "-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k";
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = "ffmpeg",
                Arguments = $"-y -i \"{source}\" {codecArgs} -movflags +faststart \"{target}\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            });
            var stderr = process!.StandardError.ReadToEnd();
            if (!process.WaitForExit(TranscodeTimeoutSec * 1000) || process.ExitCode != 0
                || !File.Exists(target) || new FileInfo(target).Length == 0)
            {
                logger.LogWarning("ffmpeg 변환 실패({Source}): {Tail}",
                    Path.GetFileName(source), stderr.Length > 400 ? stderr[^400..] : stderr);
                try { File.Delete(target); } catch { /* 없어도 된다 */ }
                return false;
            }
            return true;
        }
        catch
        {
            try { File.Delete(target); } catch { /* 없어도 된다 */ }
            return false;
        }
    }

    /// <summary>저장된 동영상을 웹 호환 MP4 로 바꾼다. (상대 경로, 크기, MIME).
    /// 성공하면 원본을 지우고 새 .mp4 경로를 돌려준다.</summary>
    public async Task<(string Relative, long Size, string ContentType)> EnsureWebVideoAsync(
        string relative, string contentType)
    {
        return await Task.Run(() => EnsureWebVideo(relative, contentType));
    }

    private (string, long, string) EnsureWebVideo(string relative, string contentType)
    {
        var root = assets.MediaRoot;
        var source = Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar));
        var transcodeOnly = TranscodeOnlyTypes.ContainsKey(contentType);

        if (!IsAvailable())
        {
            if (transcodeOnly)
            {
                try { File.Delete(source); } catch { /* 없어도 된다 */ }
                throw new UploadRejectedException(NoFfmpegMessage);
            }
            return (relative, new FileInfo(source).Length, contentType);
        }

        var codecs = ProbeCodecs(source);
        var webReady = codecs is { Video: "h264" } probed
            && probed.Audio is null or "aac"
            && relative.EndsWith(".mp4", StringComparison.Ordinal);

        var targetRelative = AssetService.RelativeMediaPath("video", ".mp4");
        var target = Path.Combine(root, targetRelative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);

        if (!RunFfmpeg(source, target, copy: webReady))
        {
            if (transcodeOnly)
            {
                try { File.Delete(source); } catch { /* 없어도 된다 */ }
                throw new UploadRejectedException(FailedMessage);
            }
            // 표준 형식(mp4/webm/ogv)은 기존 정책대로 관대하다 —
            // 깨진 파일이라도 업로드는 성공하고(썸네일만 빠진다) 원본을 남긴다.
            return (relative, new FileInfo(source).Length, contentType);
        }

        try { File.Delete(source); } catch { /* 없어도 된다 */ }
        return (targetRelative, new FileInfo(target).Length, "video/mp4");
    }
}

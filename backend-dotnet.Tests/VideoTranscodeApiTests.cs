// 동영상 웹 변환 통합 테스트 (FastAPI tests/test_video_transcode.py 거울).
//
// 실제 ffmpeg 으로 소형 영상을 만들어 업로드한다 — 올린 webm/mov 가
// H.264 MP4 자산으로 정규화되어 돌아와야 한다. ffmpeg 이 없는 환경에서는
// 조용히 통과시킨다(썸네일과 같은 관례: 설치는 배포 환경의 몫).

using System.Diagnostics;
using System.Net.Http.Headers;
using SignalLink.Api.Services;

namespace SignalLink.Api.Tests;

public class VideoTranscodeApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static string MakeVideo(string extension, string codecArgs)
    {
        var path = Path.Combine(Path.GetTempPath(), $"sl-clip-{Guid.NewGuid():N}{extension}");
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = "ffmpeg",
            Arguments = "-y -f lavfi -i testsrc=duration=0.4:size=64x64:rate=10 "
                + $"{codecArgs} \"{path}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        });
        process!.WaitForExit(120_000);
        Assert.Equal(0, process.ExitCode);
        return path;
    }

    private async Task<System.Text.Json.Nodes.JsonNode> UploadAsync(
        string path, string contentType)
    {
        var token = await Api.LoginAsync(_client);
        using var form = new MultipartFormDataContent();
        var bytes = new ByteArrayContent(await File.ReadAllBytesAsync(path));
        bytes.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(bytes, "file", Path.GetFileName(path));

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/assets?org_id=1")
        {
            Content = form,
        };
        request.Headers.Authorization = new("Bearer", token);
        var response = await _client.SendAsync(request);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"업로드 실패: {body}");
        return body;
    }

    [Fact]
    public async Task 올린_webm_은_웹_표준_MP4_자산이_된다()
    {
        if (!VideoTranscodeService.IsAvailable()) return;  // ffmpeg 없는 환경 — 건너뜀
        var path = MakeVideo(".webm", "-c:v libvpx");
        try
        {
            var body = await UploadAsync(path, "video/webm");
            Assert.Equal("video/mp4", body["content_type"]!.GetValue<string>());
            Assert.Equal("video", body["kind"]!.GetValue<string>());
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task 변환_전제로_mov_도_받는다()
    {
        if (!VideoTranscodeService.IsAvailable()) return;
        var path = MakeVideo(".mov", "-c:v mpeg4");
        try
        {
            var body = await UploadAsync(path, "video/quicktime");
            Assert.Equal("video/mp4", body["content_type"]!.GetValue<string>());
        }
        finally
        {
            File.Delete(path);
        }
    }
}

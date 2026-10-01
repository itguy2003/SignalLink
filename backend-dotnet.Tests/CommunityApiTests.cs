// 커뮤니티 게시물 통합 테스트 (FastAPI tests/test_community.py 거울).
//
// 2026-10 개편: 커뮤니티는 모든 승인 사용자의 공간이다(COMMUNITY_USER 폐지).
// 게시물 메타데이터는 제목·공지대상(기관구분)·공지희망기간·연락처·메모.
// 파일은 게시물에 직접 올리고 올린 파일만 칸이 된다. 전체 재생시간은 칸
// 시간의 합. '게시' 상태만 위젯이 표출하고, 팝업(/popup)도 '게시' + 대상·
// 기간이 맞는 글만 알린다.

using System.Net;
using System.Text.Json.Nodes;

namespace SignalLink.Api.Tests;

public class CommunityApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static readonly byte[] Png = [.. "\x89PNG\r\n\x1a\n"u8.ToArray(), .. new byte[64]];

    private async Task<(int officeId, int schoolId, string resident, string admin)> SetupAsync(
        string prefix)
    {
        var admin = await Api.LoginAsync(_client);
        var office = await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/organizations",
            new { name = $"{prefix}교육청", parent_id = 1, org_type = "기관" }, admin));
        var officeId = office["id"]!.GetValue<int>();
        var school = await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/organizations",
            new { name = $"{prefix}초등학교", parent_id = officeId, org_type = "학교" }, admin));

        // 2026-10 개편: 일반 회원이면 충분하다 — 커뮤니티는 모두의 공간이다.
        await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/users",
            new { org_id = officeId, user_id = $"{prefix}res", password = "test1234", name = "resident" },
            admin));
        var resident = await Api.LoginAsync(_client, $"{prefix}res", "test1234");
        return (officeId, school["id"]!.GetValue<int>(), resident, admin);
    }

    private async Task<JsonNode> CreateAsync(string token, string title, string? memo = null)
    {
        var response = await Api.PostAsync(_client, "/api/v1/community/playlists",
            new { title, memo }, token);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"게시물 등록 실패: {body}");
        return body;
    }

    private async Task<int> UploadAsync(string token, int playlistId, string name = "사진.png")
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(Png);
        file.Headers.ContentType = new("image/png");
        form.Add(file, "file", name);
        using var request = new HttpRequestMessage(
            HttpMethod.Post, $"/api/v1/community/playlists/{playlistId}/media")
        {
            Content = form,
        };
        request.Headers.Authorization = new("Bearer", token);
        var response = await _client.SendAsync(request);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"업로드 실패: {body}");
        return body["id"]!.GetValue<int>();
    }

    [Fact]
    public async Task 등록은_대기중으로_시작하고_게시자와_메모가_남는다()
    {
        var (_, _, resident, _) = await SetupAsync("커뮤가");
        var body = await CreateAsync(resident, "가을 축제 홍보", "가을 축제를 알리고 싶어요");

        Assert.Equal("가을 축제 홍보", body["title"]!.GetValue<string>());
        Assert.Equal("가을 축제를 알리고 싶어요", body["memo"]!.GetValue<string>());
        Assert.Equal("대기중", body["publish_status"]!.GetValue<string>());
        Assert.Equal("resident", body["author_name"]!.GetValue<string>());
        Assert.Equal(0, body["total_duration_sec"]!.GetValue<int>());
        Assert.True(body["can_edit"]!.GetValue<bool>());
        Assert.False(body["can_publish"]!.GetValue<bool>());  // 게시는 관리자의 몫.
    }

    /// <summary>콘텐츠 편집기 문서 — 소속기관 공지와 같은 칸 모양.</summary>
    private static object Doc(string text = "안내") => new
    {
        version = 1,
        layout = new { width = 1920, height = 1080, background = "#000000" },
        elements = new object[]
        {
            new
            {
                id = "e1", type = "text",
                rect = new { x = 0, y = 0, w = 400, h = 200, z = 1 },
                options = new { text },
            },
        },
    };

    [Fact]
    public async Task 문서_칸이_담기고_전체_재생시간은_합이다()
    {
        var (_, _, resident, _) = await SetupAsync("커뮤나");
        var playlistId = (await CreateAsync(resident, "합계 확인"))["id"]!.GetValue<int>();

        var updated = await Api.PutAsync(_client, $"/api/v1/community/playlists/{playlistId}",
            new
            {
                items = new[]
                {
                    new { document = Doc("칸 0"), duration_sec = 8 },
                    new { document = Doc("칸 1"), duration_sec = 12 },
                },
            }, resident);
        var body = await Api.ReadJsonAsync(updated);
        Assert.True(updated.IsSuccessStatusCode, $"수정 실패: {body}");

        var items = body["items"]!.AsArray();
        Assert.Equal(2, items.Count);
        Assert.Equal("칸 0", items[0]!["document"]!["elements"]![0]!["options"]!["text"]!.GetValue<string>());
        Assert.Equal(20, body["total_duration_sec"]!.GetValue<int>());
        Assert.Equal(2, body["version"]!.GetValue<int>());
    }

    [Fact]
    public async Task 칸에는_문서가_있어야_하고_커뮤니티_위젯은_넣을_수_없다()
    {
        var (_, _, resident, _) = await SetupAsync("커뮤다");
        var playlistId = (await CreateAsync(resident, "검증"))["id"]!.GetValue<int>();

        // 옛 모양(파일 참조)은 더 이상 칸이 아니다.
        var legacy = await Api.PutAsync(_client, $"/api/v1/community/playlists/{playlistId}",
            new { items = new[] { new { kind = "image", asset_id = 1, duration_sec = 10 } } }, resident);
        Assert.Equal(HttpStatusCode.BadRequest, legacy.StatusCode);
        Assert.Contains("콘텐츠 문서", (await Api.ReadJsonAsync(legacy))["detail"]!.GetValue<string>());

        // 커뮤니티 안에서 커뮤니티를 틀면 끝없이 파고든다.
        var nested = await Api.PutAsync(_client, $"/api/v1/community/playlists/{playlistId}",
            new
            {
                items = new[]
                {
                    new
                    {
                        document = new
                        {
                            version = 1,
                            layout = new { width = 1920, height = 1080 },
                            elements = new object[]
                            {
                                new { id = "w1", type = "widget", widget_key = "community", rect = new { }, options = new { } },
                            },
                        },
                        duration_sec = 10,
                    },
                },
            }, resident);
        Assert.Equal(HttpStatusCode.BadRequest, nested.StatusCode);
        Assert.Contains("커뮤니티 위젯", (await Api.ReadJsonAsync(nested))["detail"]!.GetValue<string>());
    }

    [Fact]
    public async Task 올린_파일은_편집기용_목록에_실린다()
    {
        var (_, _, resident, _) = await SetupAsync("커뮤큐");
        var playlistId = (await CreateAsync(resident, "파일 확인"))["id"]!.GetValue<int>();
        var assetId = await UploadAsync(resident, playlistId, "포스터.png");

        var body = await Api.GetJsonAsync(_client, $"/api/v1/community/playlists/{playlistId}", resident);
        var assets = body["assets"]!.AsArray();
        Assert.Single(assets);
        Assert.Equal(assetId, assets[0]!["id"]!.GetValue<int>());
        Assert.False(string.IsNullOrEmpty(assets[0]!["url"]?.GetValue<string>()));
    }

    [Fact]
    public async Task 게시_결과는_커뮤니티_소유_기관_관리자만_바꾼다()
    {
        var (_, _, resident, admin) = await SetupAsync("커뮤라");
        var playlistId = (await CreateAsync(resident, "게시 확인"))["id"]!.GetValue<int>();

        // 작성자 본인이라도 게시 결과는 손대지 못한다.
        var denied = await Api.PutAsync(_client,
            $"/api/v1/community/playlists/{playlistId}/status", new { status = "게시" }, resident);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);

        var bad = await Api.PutAsync(_client,
            $"/api/v1/community/playlists/{playlistId}/status", new { status = "몰래" }, admin);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var published = await Api.ReadJsonAsync(await Api.PutAsync(_client,
            $"/api/v1/community/playlists/{playlistId}/status", new { status = "게시" }, admin));
        Assert.Equal("게시", published["publish_status"]!.GetValue<string>());
    }

    [Fact]
    public async Task 위젯은_게시된_재생목록만_튼다()
    {
        var (_, schoolId, resident, admin) = await SetupAsync("커뮤마");
        var playlistId = (await CreateAsync(resident, "위젯 확인"))["id"]!.GetValue<int>();
        await Api.PutAsync(_client, $"/api/v1/community/playlists/{playlistId}",
            new { items = new[] { new { document = Doc("위젯"), duration_sec = 7 } } },
            resident);

        // 게시 전에는 틀 것이 없다.
        var before = await Api.GetJsonAsync(_client,
            $"/api/v1/widgets/community/data?org_id={schoolId}", admin);
        Assert.True(before["data"] is null || before["data"]!.GetValueKind() == System.Text.Json.JsonValueKind.Null);

        await Api.PutAsync(_client,
            $"/api/v1/community/playlists/{playlistId}/status", new { status = "게시" }, admin);
        var after = await Api.GetJsonAsync(_client,
            $"/api/v1/widgets/community/data?org_id={schoolId}", admin);
        var data = after["data"]!;
        Assert.True(data["active"]!.GetValue<bool>());
        Assert.Equal("위젯 확인", data["title"]!.GetValue<string>());
        Assert.Equal(7, data["total_duration_sec"]!.GetValue<int>());
        Assert.Single(data["items"]!.AsArray());
    }

    [Fact]
    public async Task 작성자_표시_이름과_연락처가_함께_실린다()
    {
        var (_, _, resident, _) = await SetupAsync("커뮤바");
        var response = await Api.PostAsync(_client, "/api/v1/community/playlists",
            new
            {
                title = "연락처 확인",
                memo = "토요일 오전, 교육청 앞마당",
                author_name = "홍길동",
                contact = "010-1234-5678",
            }, resident);
        var body = await Api.ReadJsonAsync(response);
        Assert.True(response.IsSuccessStatusCode, $"등록 실패: {body}");
        Assert.Equal("홍길동", body["author_name"]!.GetValue<string>());  // 계정 이름보다 우선.
        Assert.Equal("010-1234-5678", body["contact"]!.GetValue<string>());
        Assert.Equal("토요일 오전, 교육청 앞마당", body["memo"]!.GetValue<string>());

        // 표시 이름을 비우면 계정 이름으로 돌아간다.
        var cleared = await Api.ReadJsonAsync(await Api.PutAsync(_client,
            $"/api/v1/community/playlists/{body["id"]}",
            new { author_name = "", contact = "" }, resident));
        Assert.Equal("resident", cleared["author_name"]!.GetValue<string>());
    }

    [Fact]
    public async Task 게시_정책이_자동이면_승인_없이_곧장_게시된다()
    {
        var (officeId, _, resident, admin) = await SetupAsync("커뮤아");

        // 기본은 승인 후 게시.
        var first = await CreateAsync(resident, "승인 대기");
        Assert.Equal("대기중", first["publish_status"]!.GetValue<string>());

        // 작성자는 정책을 못 바꾼다.
        var denied = await Api.PutAsync(_client, "/api/v1/community/settings",
            new { auto_publish = true }, resident);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);

        // 슈퍼관리자는 org_id 로 그 커뮤니티의 정책을 정한다.
        var setting = await Api.ReadJsonAsync(await Api.PutAsync(_client,
            $"/api/v1/community/settings?org_id={officeId}", new { auto_publish = true }, admin));
        Assert.True(setting["auto_publish"]!.GetValue<bool>());

        var second = await CreateAsync(resident, "즉시 게시");
        Assert.Equal("게시", second["publish_status"]!.GetValue<string>());

        // 되돌리면 새 등록은 승인 대기로 돌아간다.
        await Api.PutAsync(_client, $"/api/v1/community/settings?org_id={officeId}",
            new { auto_publish = false }, admin);
        var third = await CreateAsync(resident, "다시 승인 대기");
        Assert.Equal("대기중", third["publish_status"]!.GetValue<string>());
    }

    [Fact]
    public async Task 일반_회원도_커뮤니티에_들어간다()
    {
        // 2026-10 개편: 커뮤니티는 모든 승인 사용자의 공간이다.
        var admin = await Api.LoginAsync(_client);
        var office = await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/organizations",
            new { name = "커뮤사교육청", parent_id = 1, org_type = "기관" }, admin));
        await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/users",
            new { org_id = office["id"]!.GetValue<int>(), user_id = "커뮤사멤버", password = "test1234", name = "member" },
            admin));
        var member = await Api.LoginAsync(_client, "커뮤사멤버", "test1234");

        var response = await _client.SendAsync(Authed(
            HttpMethod.Get, "/api/v1/community/playlists", member));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task 팝업은_게시_중이고_대상과_기간이_맞는_글만_알린다()
    {
        var (_, schoolId, resident, admin) = await SetupAsync("커뮤팝");
        var today = DateTime.Now.ToString("yyyy-MM-dd");
        var end = DateTime.Now.AddDays(7).ToString("yyyy-MM-dd");
        var created = await Api.ReadJsonAsync(await Api.PostAsync(_client,
            "/api/v1/community/playlists",
            new
            {
                title = "학교 대상 공지",
                memo = "팝업 확인",
                target_org_types = new[] { "학교" },
                notice_start = today,
                notice_end = end,
            }, resident));
        var playlistId = created["id"]!.GetValue<int>();

        await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/users",
            new { org_id = schoolId, user_id = "커뮤팝학생", password = "test1234", name = "pupil" }, admin));
        var pupil = await Api.LoginAsync(_client, "커뮤팝학생", "test1234");

        // 게시 전에는 비어 있다.
        var before = await Api.GetJsonAsync(_client, "/api/v1/community/popup", pupil);
        Assert.Empty(before.AsArray());

        await Api.PutAsync(_client, $"/api/v1/community/playlists/{playlistId}/status",
            new { status = "게시" }, admin);

        // 학교 소속에게는 실리고, 기관(교육청) 소속에게는 실리지 않는다.
        var shown = await Api.GetJsonAsync(_client, "/api/v1/community/popup", pupil);
        Assert.Equal("학교 대상 공지", shown.AsArray().Single()!["title"]!.GetValue<string>());
        var office = await Api.GetJsonAsync(_client, "/api/v1/community/popup", resident);
        Assert.Empty(office.AsArray());
    }

    [Fact]
    public async Task 공지대상과_기간은_서버가_지킨다()
    {
        var (_, _, resident, _) = await SetupAsync("커뮤검");

        var badTarget = await Api.PostAsync(_client, "/api/v1/community/playlists",
            new { title = "대상 오류", target_org_types = new[] { "없는구분" } }, resident);
        Assert.Equal(HttpStatusCode.BadRequest, badTarget.StatusCode);

        var badFormat = await Api.PostAsync(_client, "/api/v1/community/playlists",
            new { title = "형식 오류", notice_start = "2026/10/01" }, resident);
        Assert.Equal(HttpStatusCode.BadRequest, badFormat.StatusCode);

        var wrongOrder = await Api.PostAsync(_client, "/api/v1/community/playlists",
            new { title = "순서 오류", notice_start = "2026-10-20", notice_end = "2026-10-01" }, resident);
        Assert.Equal(HttpStatusCode.BadRequest, wrongOrder.StatusCode);
    }

    [Fact]
    public async Task 세부_구분_공지대상은_학교급까지_맞아야_실린다()
    {
        // SetupAsync 의 학교는 school_level 없이 만들어지므로 직접 만든다.
        var admin = await Api.LoginAsync(_client);
        var office = await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/organizations",
            new { name = "커뮤세교육청", parent_id = 1, org_type = "기관" }, admin));
        var officeId = office["id"]!.GetValue<int>();
        var elementary = await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/organizations",
            new { name = "커뮤세초등학교", parent_id = officeId, org_type = "학교", school_level = "초" }, admin));

        await Api.ReadJsonAsync(await Api.PostAsync(_client, "/api/v1/users",
            new { org_id = elementary["id"]!.GetValue<int>(), user_id = "커뮤세학생", password = "test1234", name = "pupil" }, admin));
        var pupil = await Api.LoginAsync(_client, "커뮤세학생", "test1234");

        async Task<int> PublishAsync(string title, string target)
        {
            var created = await Api.ReadJsonAsync(await Api.PostAsync(_client,
                $"/api/v1/community/playlists?org_id={officeId}",
                new { title, target_org_types = new[] { target } }, admin));
            var id = created["id"]!.GetValue<int>();
            await Api.PutAsync(_client, $"/api/v1/community/playlists/{id}/status",
                new { status = "게시" }, admin);
            return id;
        }

        await PublishAsync("초등 대상", "학교:초");
        await PublishAsync("고등 대상", "학교:고");

        var shown = await Api.GetJsonAsync(_client, "/api/v1/community/popup", pupil);
        var titles = shown.AsArray().Select(n => n!["title"]!.GetValue<string>()).ToList();
        Assert.Contains("초등 대상", titles);
        Assert.DoesNotContain("고등 대상", titles);

        // 분류 선택지에 없는 세부 구분은 거절한다(학교의 분류: 초,중,고).
        var denied = await Api.PostAsync(_client, $"/api/v1/community/playlists?org_id={officeId}",
            new { title = "없는 분류", target_org_types = new[] { "학교:유치원" } }, admin);
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
    }

    private static HttpRequestMessage Authed(HttpMethod method, string path, string token)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new("Bearer", token);
        return request;
    }
}

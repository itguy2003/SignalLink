// 위젯 레지스트리 — FastAPI(app/services/widgets.py)의 짝(명세 + 데이터 제공자).
//
// 위젯은 DB 에 저장되지 않고 시스템이 동적으로 제공한다. 편집기 팔레트와
// 플레이어 렌더러 선택이 모두 이 레지스트리를 기준으로 동작한다.

using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Data;

namespace SignalLink.Api.Services;

public static class WidgetRegistry
{
    /// <summary>재생목록·문서 검증이 쓰는 키 전체.</summary>
    public static readonly string[] Keys =
    [
        "dday", "newsletter", "notice", "meal", "weather", "quote", "painting",
        "timetable", "clock", "english_word", "english_idiom", "school_calendar",
        "ai_image", "album", "community",
    ];

    private static JsonObject Option(
        string key, string label, string type, JsonNode? def = null, bool required = false,
        JsonArray? choices = null, double? min = null, double? max = null) => new()
    {
        ["key"] = key,
        ["label"] = label,
        ["type"] = type,
        ["default"] = def,
        ["choices"] = choices ?? [],
        ["required"] = required,
        ["min"] = min,
        ["max"] = max,
    };

    private static JsonObject Spec(
        string key, string name, string category, string description,
        bool dataDriven, int refreshSec, (int w, int h) size, params JsonObject[] options) => new()
    {
        ["key"] = key,
        ["name"] = name,
        ["category"] = category,
        ["description"] = description,
        ["data_driven"] = dataDriven,
        ["refresh_sec"] = refreshSec,
        ["default_size"] = new JsonObject { ["w"] = size.w, ["h"] = size.h },
        ["options"] = new JsonArray(options.Select(o => (JsonNode)o).ToArray()),
    };

    private static JsonObject BoardWidget(string key, string name, string description) =>
        Spec(key, name, "기능형", description, true, 600, (700, 500),
            Option("count", "표시 건수", "number", 5),
            Option("title", "제목", "text", name),
            Option("board_id", "연결 게시판", "select"));

    /// <summary>파이썬 레지스트리와 같은 명세. 정렬(category, name)도 같다.</summary>
    public static List<JsonObject> ListWidgets()
    {
        var all = new List<JsonObject>
        {
            BoardWidget("notice", "공지사항", "기관 게시판에서 수집한 공지사항 목록"),
            BoardWidget("newsletter", "가정통신문", "기관 게시판에서 수집한 가정통신문 목록"),
            Spec("school_calendar", "학사일정", "기능형", "월별 학사일정", true, 3600, (600, 400),
                Option("month", "기준 월(비우면 이번 달)", "number")),
            Spec("meal", "급식메뉴", "기능형", "오늘의 급식 식단", true, 3600, (500, 600)),
            Spec("timetable", "시간표", "기능형", "학급 시간표", true, 3600, (600, 400),
                Option("grade", "학년", "number"),
                Option("class_no", "반", "number")),
            Spec("dday", "D-Day", "기능형", "지정한 날짜까지 남은 일수", false, 300, (400, 200),
                Option("label", "표시 문구", "text", "D-Day", required: true),
                Option("target_date", "목표 일자", "text", required: true)),
            Spec("painting", "명화", "기능형", "명화 이미지와 설명", true, 86400, (600, 400)),
            Spec("quote", "명언", "기능형", "오늘의 명언", true, 86400, (800, 250)),
            Spec("english_word", "영단어", "기능형", "오늘의 영단어", true, 86400, (600, 400)),
            Spec("english_idiom", "영숙어", "기능형", "오늘의 영숙어", true, 86400, (600, 400)),
            Spec("clock", "시계", "기능형", "현재 시각", false, 300, (400, 200),
                Option("format", "형식", "select", "HH:mm:ss", choices: new JsonArray(
                    new JsonObject { ["value"] = "HH:mm", ["label"] = "시:분" },
                    new JsonObject { ["value"] = "HH:mm:ss", ["label"] = "시:분:초" },
                    new JsonObject { ["value"] = "yyyy-MM-dd HH:mm", ["label"] = "날짜 + 시:분" }))),
            Spec("weather", "날씨", "기능형", "기관 위치 기준 현재 날씨", true, 1800, (600, 400)),
            Spec("album", "이미지앨범", "콘텐츠형", "여러 이미지를 정한 간격으로 넘겨 표출",
                false, 300, (800, 600),
                Option("images", "이미지", "image_list", new JsonArray(), required: true),
                Option("interval_sec", "넘김 간격(초)", "number", 8, min: 1, max: 3600),
                Option("transition", "전환 효과", "transition", Transitions.Default),
                Option("transition_ms", "전환 시간(ms)", "number", Transitions.DefaultMs,
                    min: Transitions.MinMs, max: Transitions.MaxMs),
                Option("fit", "채우는 방식", "select", "cover", choices: new JsonArray(
                    new JsonObject { ["value"] = "cover", ["label"] = "화면 채우기(잘릴 수 있음)" },
                    new JsonObject { ["value"] = "contain", ["label"] = "전체 보이기(여백이 생김)" }))),
            // 기본은 서버가 고른다('게시' 상태의 최신 재생목록). 편집자가
            // 상위기관 커뮤니티의 특정 재생목록을 집어 삽입할 수도 있다(playlist_id).
            Spec("community", "커뮤니티", "콘텐츠형", "커뮤니티 게시물을 순환 표출",
                true, 600, (800, 600),
                Option("playlist_id", "표시할 게시물(비우면 자동 선택)", "community_playlist")),
            Spec("ai_image", "AI 생성 이미지", "콘텐츠형", "프롬프트로 생성한 이미지",
                false, 300, (600, 400),
                Option("prompt", "프롬프트", "text", required: true)),
        };
        return all
            .OrderBy(w => w["category"]!.GetValue<string>(), StringComparer.Ordinal)
            .ThenBy(w => w["name"]!.GetValue<string>(), StringComparer.Ordinal)
            .ToList();
    }

    public static bool Exists(string key) => Keys.Contains(key);
    public static bool IsDataDriven(string key) =>
        key is "notice" or "newsletter" or "school_calendar" or "meal" or "timetable"
            or "painting" or "quote" or "english_word" or "english_idiom"
            or "weather" or "community";
}

/// <summary>위젯 데이터 제공자 — 파이썬 @data_provider 들의 짝.</summary>
public class WidgetDataService(AppDbContext db, PermissionService permissions)
{
    private static readonly (string Text, string Author)[] Quotes =
    [
        ("오늘 걷지 않으면 내일은 뛰어야 한다.", "속담"),
        ("배움에는 끝이 없다.", "속담"),
        ("천 리 길도 한 걸음부터.", "속담"),
    ];

    private static readonly (string Word, string Meaning, string Example)[] Words =
    [
        ("diligent", "부지런한", "She is a diligent student."),
        ("resilient", "회복력 있는", "Children are resilient."),
        ("curious", "호기심 많은", "He is curious about science."),
    ];

    private static readonly (string Idiom, string Meaning)[] Idioms =
    [
        ("hit the books", "공부에 열중하다"),
        ("break the ice", "어색함을 깨다"),
        ("under the weather", "몸이 좋지 않다"),
    ];

    /// <summary>날짜 기준으로 항상 같은 항목 — 장치 간 표출 일치.</summary>
    private static T PickOfDay<T>(T[] items) =>
        // 파이썬 date.toordinal() 은 1 기준, DayNumber 는 0 기준 — +1 로 맞춘다.
        items[(DateOnly.FromDateTime(DateTime.Today).DayNumber + 1) % items.Length];

    public async Task<JsonNode?> FetchAsync(string key, int orgId, JsonObject options) => key switch
    {
        "notice" => await PostsForAsync(orgId, "게시판", Count(options)),
        "newsletter" => await PostsForAsync(orgId, "게시판", Count(options)),
        "school_calendar" => await CalendarAsync(orgId, options),
        "meal" => await MealAsync(orgId),
        "timetable" => await TimetableAsync(orgId),
        "quote" => Quote(),
        "english_word" => Word(),
        "english_idiom" => Idiom(),
        "painting" => new JsonObject
        {
            // TODO: 외부 명화 API/큐레이션 DB 연동 — 파이썬 쪽과 같은 자리표시자.
            ["title"] = "별이 빛나는 밤", ["artist"] = "빈센트 반 고흐", ["src"] = null,
        },
        "community" => await CommunityAsync(orgId, options),
        "weather" => await WeatherAsync(orgId),
        _ => null,
    };

    private static int Count(JsonObject options) =>
        options["count"] is JsonValue value && value.TryGetValue<int>(out var count) ? count : 5;

    private async Task<JsonNode> PostsForAsync(int orgId, string kind, int limit)
    {
        var rows = await db.BoardPosts
            .Join(db.OrgBoards, p => p.BoardId, b => b.Id, (p, b) => new { p, b })
            .Where(x => x.b.OrgId == orgId && x.b.Kind == kind)
            // NULL 정렬 위치가 방언마다 다르므로 명시(nulls last).
            .OrderBy(x => x.p.PostedOn == null)
            .ThenByDescending(x => x.p.PostedOn)
            .ThenByDescending(x => x.p.Id)
            .Take(limit)
            .Select(x => x.p)
            .ToListAsync();
        return new JsonArray(rows.Select(p => (JsonNode)new JsonObject
        {
            ["id"] = p.Id,
            ["title"] = p.Title,
            ["author"] = p.Author,
            ["posted_on"] = p.PostedOn?.ToString("yyyy-MM-dd"),
        }).ToArray());
    }

    private async Task<JsonNode> CalendarAsync(int orgId, JsonObject options)
    {
        var month = options["month"] is JsonValue value && value.TryGetValue<int>(out var m)
            ? m : DateTime.Today.Month;
        var rows = await db.BoardPosts
            .Join(db.OrgBoards, p => p.BoardId, b => b.Id, (p, b) => new { p, b })
            .Where(x => x.b.OrgId == orgId && x.b.Kind == "일정" && x.p.Month == month)
            .OrderBy(x => x.p.Day)
            .Select(x => x.p)
            .ToListAsync();
        return new JsonArray(rows.Select(p => (JsonNode)new JsonObject
        {
            ["day"] = p.Day,
            ["title"] = p.Title,
            ["posted_on"] = p.PostedOn?.ToString("yyyy-MM-dd"),
        }).ToArray());
    }

    private async Task<JsonNode> MealAsync(int orgId)
    {
        var today = DateTime.Today;
        var rows = await db.BoardPosts
            .Join(db.OrgBoards, p => p.BoardId, b => b.Id, (p, b) => new { p, b })
            .Where(x => x.b.OrgId == orgId && x.b.Kind == "급식메뉴"
                && x.p.Year == today.Year && x.p.Month == today.Month && x.p.Day == today.Day)
            .Take(3)
            .Select(x => x.p)
            .ToListAsync();
        return new JsonArray(rows.Select(p => (JsonNode)new JsonObject
        {
            ["title"] = p.Title, ["content"] = p.Content,
        }).ToArray());
    }

    private async Task<JsonNode?> TimetableAsync(int orgId)
    {
        var post = await db.BoardPosts
            .Join(db.OrgBoards, p => p.BoardId, b => b.Id, (p, b) => new { p, b })
            .Where(x => x.b.OrgId == orgId && x.b.Kind == "시간표")
            .OrderByDescending(x => x.p.Id)
            .Select(x => x.p)
            .FirstOrDefaultAsync();
        return post is null ? null : new JsonObject
        {
            ["title"] = post.Title, ["content"] = post.Content,
        };
    }

    private static JsonNode Quote()
    {
        var (text, author) = PickOfDay(Quotes);
        return new JsonObject { ["text"] = text, ["author"] = author };
    }

    private static JsonNode Word()
    {
        var (word, meaning, example) = PickOfDay(Words);
        return new JsonObject { ["word"] = word, ["meaning"] = meaning, ["example"] = example };
    }

    private static JsonNode Idiom()
    {
        var (idiom, meaning) = PickOfDay(Idioms);
        return new JsonObject { ["idiom"] = idiom, ["meaning"] = meaning };
    }

    /// <summary>커뮤니티 위젯 — '게시' 상태의 재생목록을 순환 표출한다.
    /// 기본은 게시된 것 중 칸이 있는 가장 최근 하나. 편집자가 playlist_id 로
    /// 집었으면 그 재생목록(울타리·게시 여부는 그래도 지킨다).</summary>
    private async Task<JsonNode?> CommunityAsync(int orgId, JsonObject options)
    {
        var communityOrg = await permissions.CommunityOrgOfAsync(orgId);
        if (communityOrg is null) return null;

        static JsonObject Inactive() => new()
        {
            ["active"] = false, ["title"] = null, ["version"] = 0,
            ["items"] = new JsonArray(), ["total_duration_sec"] = 0,
        };
        static JsonObject Active(CommunityPlaylist playlist)
        {
            var items = Controllers.CommunityController.ResolveItems(playlist);
            var array = new JsonArray();
            foreach (var item in items) array.Add(item);
            return new JsonObject
            {
                ["active"] = true,
                ["title"] = playlist.Title,
                ["memo"] = playlist.Memo,
                ["version"] = playlist.Version,
                ["items"] = array,
                ["total_duration_sec"] = Controllers.CommunityController.TotalDurationSec(items),
            };
        }

        var pickedId = 0;
        if (options["playlist_id"] is JsonValue picked
            && !picked.TryGetValue(out pickedId)
            && picked.TryGetValue<string>(out var rawPicked))
        {
            _ = int.TryParse(rawPicked, out pickedId);
        }
        if (pickedId > 0)
        {
            var chosen = await db.CommunityPlaylists
                .Include(p => p.AssetLinks).ThenInclude(l => l.Asset)
                .SingleOrDefaultAsync(p => p.Id == pickedId && p.OrgId == communityOrg);
            // 지정 삽입이라도 게시 전이면 틀지 않는다 — 게시 여부가 곧 표출 여부다.
            if (chosen is null || chosen.PublishStatus != "게시") return Inactive();
            return Active(chosen);
        }

        var rows = await db.CommunityPlaylists
            .Include(p => p.AssetLinks).ThenInclude(l => l.Asset)
            .Where(p => p.OrgId == communityOrg && p.PublishStatus == "게시")
            .OrderByDescending(p => p.Id)
            .ToListAsync();
        if (rows.Count == 0) return null;

        // 칸이 하나라도 있는 최신 것 — 빈 재생목록을 틀면 검은 화면이 된다.
        var playlist = rows.FirstOrDefault(
            row => Controllers.CommunityController.ResolveItems(row).Count > 0);
        return playlist is null ? Inactive() : Active(playlist);
    }

    private async Task<JsonNode> WeatherAsync(int orgId)
    {
        // TODO: 기상청 단기예보 + 에어코리아 대기질 API 연동 — 파이썬과 같은 자리표시자.
        // 연동되면 {temp, condition, icon, high, low, dust, pm10} 로 돌려줄 것.
        var org = await db.Organizations.FindAsync(orgId);
        if (org?.Latitude is null || org.Longitude is null)
            return new JsonObject { ["available"] = false, ["reason"] = "기관 좌표가 등록되지 않았습니다." };
        return new JsonObject
        {
            ["available"] = false,
            ["reason"] = "날씨 API 미연동",
            ["lat"] = org.Latitude,
            ["lon"] = org.Longitude,
            ["fetched_at"] = DateTime.UtcNow.ToString("o"),
        };
    }
}

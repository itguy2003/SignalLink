// 스케줄 버전·플레이어 페이로드 — FastAPI(app/services/schedule_service.py +
// orientation.py + playlists.inline_into_document)의 짝.
//
// 핵심 규칙: 스케줄이 바뀌면 버전이 오르고, 장치는 하트비트에서 버전을
// 비교해 다르면 다시 받는다. 배정이 없거나 지금 유효한 것이 없으면 데모.

using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Data;

namespace SignalLink.Api.Services;

public static class Orientation
{
    // 방향 값은 시스템 전체가 PanelType 열거형(LANDSCAPE/PORTRAIT)을 쓴다 —
    // 파이썬 app/services/orientation.py·프런트 utils/orientation.js 와 동일.
    public const string Landscape = "LANDSCAPE";
    public const string Portrait = "PORTRAIT";

    public static string Label(string value) => value switch
    {
        Landscape => "가로형",
        Portrait => "세로형",
        _ => value,
    };

    /// <summary>정사각형은 가로형 — 프런트 utils/orientation.js 와 같은 기준.</summary>
    public static string OfSize(double width, double height) => height > width ? Portrait : Landscape;

    /// <summary>문서 layout 의 방향. 크기를 알 수 없으면 null(따질 수 없다는 뜻).</summary>
    public static string? OfDocument(JsonNode? document)
    {
        if (document?["layout"] is not JsonObject layout) return null;
        double? width = AsNumber(layout["width"]);
        double? height = AsNumber(layout["height"]);
        if (width is not > 0 || height is not > 0) return null;
        return OfSize(width.Value, height.Value);
    }

    private static double? AsNumber(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<double>(out var number) ? number : null;
}

public class ScheduleCoreService(AppDbContext db)
{
    /// <summary>스케줄 미배정 장치의 데모 버전 — 항상 0.</summary>
    public const int DemoVersion = 0;

    /// <summary>지금이 사용 기간 안인가. 기간이 없으면 언제나 유효.</summary>
    public static bool IsActive(Schedule schedule, DateTime nowUtc)
    {
        var start = AsUtc(schedule.StartAt);
        var end = AsUtc(schedule.EndAt);
        if (start is not null && nowUtc < start) return false;
        return end is null || nowUtc <= end;
    }

    /// <summary>SQLite 는 naive 로 온다 — 저장은 늘 UTC 이므로 UTC 를 붙인다.</summary>
    public static DateTime? AsUtc(DateTime? value) =>
        value is DateTime dt && dt.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            : value;

    /// <summary>장치가 지금 받아야 할 스케줄의 합성 버전 — 파이썬과 같은 산식.</summary>
    public static int CurrentVersion(Device device, DateTime? now = null)
    {
        var moment = now ?? DateTime.UtcNow;
        var parts = device.ScheduleLinks
            .Where(l => l.Schedule is not null)
            .Select(l => (l.Schedule.Id, l.Schedule.Version, Active: IsActive(l.Schedule, moment)))
            .OrderBy(p => p.Id).ThenBy(p => p.Version).ThenBy(p => p.Active)
            .ToList();
        if (parts.Count == 0) return DemoVersion;

        // 31비트 양수 — SQLite/PostgreSQL/모든 플레이어 스택에서 같은 값.
        long digest = 0;
        foreach (var (scheduleId, version, active) in parts)
        {
            digest = digest * 1_000_003 + scheduleId * 131L + version * 7L + (active ? 1 : 0);
            digest %= 2_147_483_647;
        }
        return digest == 0 ? 1 : (int)digest;  // 0 은 데모 전용이라 피한다.
    }

    /// <summary>문서 안의 재생목록 요소에 실제 칸 목록을 채운다(원본은 그대로).</summary>
    public async Task<JsonNode?> InlineIntoDocumentAsync(JsonNode? document)
    {
        var ids = PlaylistLinkService.ReferencedIds(document);
        if (ids.Count == 0 || document is null) return document;

        var playlists = await db.Playlists.Include(p => p.Items)
            .Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id);

        var copy = JsonNode.Parse(document.ToJsonString())!;
        if (copy["elements"] is not JsonArray elements) return copy;
        foreach (var element in elements)
        {
            if (element is not JsonObject obj || obj["type"]?.GetValue<string?>() != "playlist")
                continue;
            var options = obj["options"] as JsonObject ?? [];
            var idNode = options["playlist_id"];
            Playlist? playlist = null;
            if (idNode is JsonValue value && value.TryGetValue<int>(out var playlistId))
                playlists.TryGetValue(playlistId, out playlist);

            var items = new JsonArray();
            if (playlist is not null)
            {
                foreach (var item in playlist.Items.OrderBy(i => i.SortOrder))
                {
                    items.Add(new JsonObject
                    {
                        ["widget_key"] = item.WidgetKey,
                        ["duration_sec"] = item.DurationSec,
                        ["options"] = Json.Parse(item.OptionsJson) ?? new JsonObject(),
                        // 이름을 여기서 정규화하면 각 플레이어가 따로 방어하지 않아도 된다.
                        ["transition"] = Transitions.Normalize(item.Transition),
                        ["transition_ms"] = Transitions.NormalizeMs(item.TransitionMs),
                    });
                }
            }
            options["items"] = items;
            obj["options"] = options.Parent == obj ? options : options.DeepClone();
        }
        return copy;
    }

    /// <summary>플레이어에게 내려갈 아이템 — 라이브러리 참조·재생목록을 인라인한다.</summary>
    public async Task<JsonObject> PlayerItemAsync(ScheduleItem item)
    {
        var content = item.ContentRef is not null
            ? Json.Parse(item.ContentRef.DocumentJson)
            : Json.Parse(item.ContentJson);
        content = await InlineIntoDocumentAsync(content) ?? new JsonObject();
        return new JsonObject
        {
            ["id"] = item.Id,
            ["schedule_id"] = item.ScheduleId,
            ["day_of_week"] = item.DayOfWeek,
            ["start_time"] = item.StartTime?.ToString("HH:mm:ss"),
            ["end_time"] = item.EndTime?.ToString("HH:mm:ss"),
            ["sort_order"] = item.SortOrder,
            ["duration_sec"] = item.DurationSec,
            // 이름을 여기서 정규화하면 각 플레이어가 따로 방어하지 않아도 된다.
            ["transition"] = Transitions.Normalize(item.Transition),
            ["transition_ms"] = Transitions.NormalizeMs(item.TransitionMs),
            ["content_id"] = item.ContentId,
            ["content"] = content,
        };
    }

    /// <summary>공지 사용 기간 판정 — 분 단위 문자열 비교, 경계 포함.
    /// 기간은 **서버 로컬 시각** 기준이다(관리자가 화면에서 고른 시각 그대로).
    /// 날짜만 저장된 옛 값은 시작 00:00 / 종료 23:59 로 넓혀 읽는다.</summary>
    public static bool NoticeActiveOn(OrgNotice notice, DateTime now)
    {
        var local = now.Kind == DateTimeKind.Utc ? now.ToLocalTime() : now;
        var moment = local.ToString("yyyy-MM-ddTHH:mm");
        var start = ExpandPeriod(notice.StartDate, isEnd: false);
        var end = ExpandPeriod(notice.EndDate, isEnd: true);
        if (start is not null && string.CompareOrdinal(moment, start) < 0) return false;
        return end is null || string.CompareOrdinal(moment, end) <= 0;
    }

    private static string? ExpandPeriod(string? value, bool isEnd) =>
        string.IsNullOrEmpty(value) ? null
            : value.Length == 10 ? value + (isEnd ? "T23:59" : "T00:00")
            : value;

    /// <summary>공지 슬라이드 한 장을 플레이어 아이템으로 — 시간대·전환은 참조 아이템의 것.</summary>
    private async Task<JsonObject> NoticePlayerItemAsync(ScheduleItem item, OrgNoticeItem slide, int at)
    {
        var content = await InlineIntoDocumentAsync(Json.Parse(slide.DocumentJson)) ?? new JsonObject();
        return new JsonObject
        {
            // 한 아이템이 여러 장으로 펼쳐지므로 장마다 다른 id 가 필요하다
            // (플레이어가 장 전환 키로 쓴다).
            ["id"] = item.Id * 1000 + (at % 1000),
            ["schedule_id"] = item.ScheduleId,
            ["day_of_week"] = item.DayOfWeek,
            ["start_time"] = item.StartTime?.ToString("HH:mm:ss"),
            ["end_time"] = item.EndTime?.ToString("HH:mm:ss"),
            ["sort_order"] = item.SortOrder,
            ["duration_sec"] = slide.DurationSec,
            ["transition"] = Transitions.Normalize(item.Transition),
            ["transition_ms"] = Transitions.NormalizeMs(item.TransitionMs),
            ["content_id"] = null,
            ["content"] = content,
        };
    }

    /// <summary>기본 데모 페이로드 — 스케줄 미배정 장치가 검은 화면을 띄우지 않게.</summary>
    public static JsonObject BuildDemoPayload()
    {
        var demoContent = new JsonObject
        {
            ["version"] = 1,
            ["layout"] = new JsonObject
            {
                ["width"] = 1920, ["height"] = 1080, ["background"] = "#0b1120",
            },
            ["elements"] = new JsonArray
            {
                new JsonObject
                {
                    ["id"] = "demo-title", ["type"] = "text",
                    ["rect"] = new JsonObject { ["x"] = 160, ["y"] = 380, ["w"] = 1600, ["h"] = 160, ["z"] = 1 },
                    ["options"] = new JsonObject
                    {
                        ["text"] = "SignalLink Green", ["fontSize"] = 120,
                        ["color"] = "#ffffff", ["align"] = "center", ["bold"] = true,
                    },
                },
                new JsonObject
                {
                    ["id"] = "demo-subtitle", ["type"] = "text",
                    ["rect"] = new JsonObject { ["x"] = 160, ["y"] = 560, ["w"] = 1600, ["h"] = 90, ["z"] = 1 },
                    ["options"] = new JsonObject
                    {
                        ["text"] = "스케줄이 배정되지 않은 장치입니다.", ["fontSize"] = 48,
                        ["color"] = "#94a3b8", ["align"] = "center",
                    },
                },
                new JsonObject
                {
                    ["id"] = "demo-clock", ["type"] = "widget", ["widget_key"] = "clock",
                    ["rect"] = new JsonObject { ["x"] = 760, ["y"] = 700, ["w"] = 400, ["h"] = 120, ["z"] = 1 },
                    ["options"] = new JsonObject { ["format"] = "HH:mm:ss" },
                },
            },
        };
        return new JsonObject
        {
            ["schedule_id"] = null,
            ["name"] = "기본 데모",
            ["kind"] = "목록반복",
            ["version"] = DemoVersion,
            ["is_demo"] = true,
            ["server_time"] = DateTime.UtcNow.ToString("o"),
            ["items"] = new JsonArray
            {
                new JsonObject
                {
                    ["id"] = 0, ["schedule_id"] = 0, ["day_of_week"] = -1,
                    ["start_time"] = null, ["end_time"] = null, ["sort_order"] = 0,
                    ["duration_sec"] = 30, ["content_id"] = null, ["content"] = demoContent,
                },
            },
        };
    }

    /// <summary>장치에 내려줄 스케줄 페이로드 — 유효한 스케줄들의 아이템을 이어 붙인다.</summary>
    public async Task<JsonObject> BuildPayloadAsync(Device device, DateTime? now = null)
    {
        var moment = now ?? DateTime.UtcNow;
        var active = device.ScheduleLinks
            .Where(l => l.Schedule is not null && IsActive(l.Schedule, moment))
            .OrderBy(l => l.SortOrder)
            .Select(l => l.Schedule)
            .ToList();
        if (active.Count == 0)
        {
            // 배정이 없거나 기간 밖 — 데모. 기간이 시작되면 버전이 달라져 알아챈다.
            var demo = BuildDemoPayload();
            demo["version"] = CurrentVersion(device, moment);
            return demo;
        }

        // 장치 인증 경로는 ScheduleLinks→Schedule 까지만 Include 한다(하트비트가
        // 아이템까지 끌면 너무 무겁다). 아이템은 여기서 직접 읽는다 — 탐색
        // 속성(schedule.Items)에 기대면 로드 여부에 따라 빈 스케줄이 내려간다.
        var scheduleIds = active.Select(s => s.Id).ToList();
        var itemRows = await db.ScheduleItems
            .Include(i => i.ContentRef)
            .Where(i => scheduleIds.Contains(i.ScheduleId))
            .ToListAsync();
        var bySchedule = itemRows.ToLookup(i => i.ScheduleId);

        // 공지 참조는 여기서 슬라이드 전체로 펼친다 — 플레이어는 공지의 존재를
        // 모른다. 기간 밖 공지는 통째로 빠진다(사본이 아니라 참조인 이유).
        var noticeIds = itemRows.Where(i => i.OrgNoticeId is not null)
            .Select(i => i.OrgNoticeId!.Value).Distinct().ToList();
        var notices = noticeIds.Count == 0
            ? []
            : await db.OrgNotices.Include(n => n.Items)
                .Where(n => noticeIds.Contains(n.Id)).ToDictionaryAsync(n => n.Id);

        var items = new JsonArray();
        var order = 0;
        foreach (var schedule in active)
        {
            foreach (var item in bySchedule[schedule.Id].OrderBy(i => i.SortOrder))
            {
                if (item.OrgNoticeId is int noticeId)
                {
                    if (!notices.TryGetValue(noticeId, out var notice)
                        || !NoticeActiveOn(notice, moment)) continue;
                    var slides = notice.Items.OrderBy(x => x.SortOrder).ToList();
                    for (var at = 0; at < slides.Count; at++)
                    {
                        var slide = await NoticePlayerItemAsync(item, slides[at], at);
                        slide["sort_order"] = order++;
                        items.Add(slide);
                    }
                    continue;
                }
                var one = await PlayerItemAsync(item);
                one["sort_order"] = order++;
                items.Add(one);
            }
        }

        if (items.Count == 0)
        {
            // 아이템이 전부 기간 밖 공지였다 — 검은 화면 대신 데모.
            var demo = BuildDemoPayload();
            demo["version"] = CurrentVersion(device, moment);
            return demo;
        }

        var first = active[0];
        return new JsonObject
        {
            ["schedule_id"] = first.Id,
            ["name"] = string.Join(" + ", active.Select(s => s.Name)),
            ["kind"] = first.Kind,
            ["version"] = CurrentVersion(device, moment),
            ["is_demo"] = false,
            ["server_time"] = moment.ToString("o"),
            ["items"] = items,
        };
    }
}

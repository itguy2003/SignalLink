// 스케줄 관리 — FastAPI /api/v1/schedules 의 짝(전체 이식).
//
// 스케줄이나 아이템이 바뀌면 version 이 올라가고, 이 스케줄을 쓰는 장치들에
// 변경을 푸시한다. 푸시가 유실돼도 장치는 하트비트에서 버전 차이를 발견해
// 스스로 재수신한다.

using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record ScheduleItemOut(
    int Id, int ScheduleId, int DayOfWeek, string? StartTime, string? EndTime,
    int SortOrder, int DurationSec, string Transition, int TransitionMs,
    int? ContentId, int? OrgNoticeId, JsonNode Content, string? ContentName);

public record ScheduleOut(
    int Id, string Name, string Kind, string Orientation,
    DateTime? StartAt, DateTime? EndAt, int OrgId, int? CreatedBy, int Version,
    DateTime CreatedAt, DateTime UpdatedAt, int DeviceCount);

public record ScheduleDetailOut(
    int Id, string Name, string Kind, string Orientation,
    DateTime? StartAt, DateTime? EndAt, int OrgId, int? CreatedBy, int Version,
    DateTime CreatedAt, DateTime UpdatedAt, int DeviceCount, List<ScheduleItemOut> Items);

public class ScheduleItemIn
{
    public int DayOfWeek { get; set; } = -1;
    public string? StartTime { get; set; }
    public string? EndTime { get; set; }
    public int? SortOrder { get; set; }
    public int DurationSec { get; set; } = 10;
    /// <summary>앞 칸에서 이 칸으로 넘어올 때의 전환 — 재생목록 칸과 같은 규약.</summary>
    public string? Transition { get; set; }
    public int? TransitionMs { get; set; }
    public int? ContentId { get; set; }
    /// <summary>소속기관 공지 참조 — 표출 시 공지의 슬라이드 전체로 펼쳐진다.</summary>
    public int? OrgNoticeId { get; set; }
    public JsonNode? Content { get; set; }
}

public class ScheduleCreateIn
{
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "시간지정";
    public string Orientation { get; set; } = Services.Orientation.Landscape;
    public DateTime? StartAt { get; set; }
    public DateTime? EndAt { get; set; }
    public int? OrgId { get; set; }
    public List<ScheduleItemIn> Items { get; set; } = [];
}

public class ScheduleUpdateIn
{
    public string? Name { get; set; }
    public string? Kind { get; set; }
    public string? Orientation { get; set; }
    public List<ScheduleItemIn>? Items { get; set; }

    // start_at / end_at 은 null 이 '제한 없음'이라, 보냈는지 여부를 가른다.
    public bool StartAtSet { get; private set; }
    private DateTime? _startAt;
    public DateTime? StartAt { get => _startAt; set { _startAt = value; StartAtSet = true; } }
    public bool EndAtSet { get; private set; }
    private DateTime? _endAt;
    public DateTime? EndAt { get => _endAt; set { _endAt = value; EndAtSet = true; } }
}

[ApiController]
[Route("api/v1/schedules")]
[Authorize]
public class SchedulesController(
    AppDbContext db, PermissionService permissions, OrgTreeService orgTree,
    NotifyService notify) : ControllerBase
{
    private static readonly string[] DayNames = ["월", "화", "수", "목", "금", "토", "일"];

    private Task<int> DeviceCountAsync(int scheduleId) =>
        db.DeviceScheduleLinks.CountAsync(l => l.ScheduleId == scheduleId);

    private async Task<ScheduleOut> ToOut(Schedule schedule) => new(
        schedule.Id, schedule.Name, schedule.Kind, schedule.Orientation,
        schedule.StartAt, schedule.EndAt, schedule.OrgId, schedule.CreatedBy, schedule.Version,
        schedule.CreatedAt, schedule.UpdatedAt, await DeviceCountAsync(schedule.Id));

    private async Task<ScheduleDetailOut> ToDetail(Schedule schedule)
    {
        var summary = await ToOut(schedule);
        var items = schedule.Items.OrderBy(i => i.SortOrder).Select(i => new ScheduleItemOut(
            i.Id, i.ScheduleId, i.DayOfWeek,
            i.StartTime?.ToString("HH:mm:ss"), i.EndTime?.ToString("HH:mm:ss"),
            i.SortOrder, i.DurationSec,
            Transitions.Normalize(i.Transition), Transitions.NormalizeMs(i.TransitionMs),
            i.ContentId, i.OrgNoticeId,
            Json.Parse(i.ContentJson) ?? new JsonObject(),
            // 편집기 표시는 공지 이름이 우선 — 참조 하나가 목록 한 줄이다.
            i.NoticeRef?.Name ?? i.ContentRef?.Name)).ToList();
        return new ScheduleDetailOut(
            summary.Id, summary.Name, summary.Kind, summary.Orientation,
            summary.StartAt, summary.EndAt, summary.OrgId, summary.CreatedBy, summary.Version,
            summary.CreatedAt, summary.UpdatedAt, summary.DeviceCount, items);
    }

    private async Task<bool> CanManageAsync(AppUser actor, Schedule schedule) =>
        await permissions.CanManageOrgAsync(actor, schedule.OrgId)
        || schedule.CreatedBy == actor.Id;

    /// <summary>아이템 저장 전 검사 — 콘텐츠 존재·권한, 방향, 시간 겹침.
    /// 오류면 (상태코드, 메시지) — 권한 문제는 403, 나머지는 400(FastAPI 와 동일).</summary>
    private async Task<(int Status, string Message)?> ValidateItemsAsync(
        AppUser actor, List<ScheduleItemIn> items, string expectedOrientation, int scheduleOrgId)
    {
        var contentIds = items.Where(i => i.ContentId is not null)
            .Select(i => i.ContentId!.Value).ToHashSet();
        var found = new Dictionary<int, Content>();
        if (contentIds.Count > 0)
        {
            found = await db.Contents.Where(c => contentIds.Contains(c.Id))
                .ToDictionaryAsync(c => c.Id);
            foreach (var contentId in contentIds)
            {
                if (!found.TryGetValue(contentId, out var content))
                    return (400, $"존재하지 않는 콘텐츠입니다: {contentId}");
                // 관리 범위 밖이라도 공유 구분이 스케줄의 기관에 열려 있으면 쓸 수 있다.
                if (!await permissions.CanViewOrgAsync(actor, content.OrgId)
                    && !await ContentSharing.SharedWithAsync(db, content, scheduleOrgId))
                    return (403, $"콘텐츠 '{content.Name}' 을(를) 사용할 권한이 없습니다.");
            }
        }

        // 공지 참조 검사 — 스케줄 기관의 자기/상위기관 공지만 쓸 수 있다.
        var noticeIds = items.Where(i => i.OrgNoticeId is not null)
            .Select(i => i.OrgNoticeId!.Value).ToHashSet();
        if (noticeIds.Count > 0)
        {
            var notices = await db.OrgNotices.Where(n => noticeIds.Contains(n.Id))
                .ToDictionaryAsync(n => n.Id);
            var chain = (await orgTree.AncestorIdsAsync(scheduleOrgId, includeSelf: true)).ToHashSet();
            foreach (var noticeId in noticeIds)
            {
                if (!notices.TryGetValue(noticeId, out var notice))
                    return (400, $"존재하지 않는 공지입니다: {noticeId}");
                if (!chain.Contains(notice.OrgId))
                    return (403, $"이 기관에서 쓸 수 없는 공지입니다: '{notice.Name}'");
            }
        }

        // 전환 검사 — 표출 시간보다 긴 전환은 끝나기 전에 다음으로 넘어간다.
        foreach (var item in items)
        {
            if (!Transitions.FitsIn(item.Transition ?? Transitions.Default, item.TransitionMs ?? Transitions.DefaultMs, item.DurationSec))
                return (400, "전환 시간은 표출 시간보다 길 수 없습니다.");
        }

        // 방향 검사 — 가로 콘텐츠를 세로 화면에 태우면 검은 띠만 남는다.
        var want = Orientation.Label(expectedOrientation);
        foreach (var item in items)
        {
            if (item.ContentId is int refId)
            {
                var content = found[refId];
                var actual = Orientation.OfSize(content.Width, content.Height);
                if (actual != expectedOrientation)
                    return (400, $"{want} 스케줄에는 {want} 콘텐츠만 넣을 수 있습니다. " +
                           $"'{content.Name}' 은(는) {Orientation.Label(actual)}" +
                           $"({content.Width}×{content.Height})입니다.");
                continue;
            }
            var docOrientation = Orientation.OfDocument(item.Content);
            if (docOrientation is not null && docOrientation != expectedOrientation)
            {
                var layout = item.Content?["layout"];
                return (400, $"{want} 스케줄에는 {want} 콘텐츠만 넣을 수 있습니다. " +
                       $"{Orientation.Label(docOrientation)}" +
                       $"({layout?["width"]}×{layout?["height"]}) 콘텐츠가 들어 있습니다.");
            }
        }

        // 같은 요일에 시간대가 겹치면 그 시각에 무엇을 틀지 모호하다.
        foreach (var group in items
            .Where(i => i.StartTime is not null && i.EndTime is not null)
            .GroupBy(i => i.DayOfWeek))
        {
            var ordered = group.OrderBy(i => i.StartTime, StringComparer.Ordinal).ToList();
            for (var at = 1; at < ordered.Count; at++)
            {
                if (string.CompareOrdinal(ordered[at].StartTime, ordered[at - 1].EndTime) < 0)
                {
                    var label = group.Key is >= 0 and <= 6 ? DayNames[group.Key] : "요일 미지정";
                    return (400, $"{label}요일의 시간대가 겹칩니다: " +
                           $"{ordered[at - 1].StartTime}~{ordered[at - 1].EndTime} 과 " +
                           $"{ordered[at].StartTime}~{ordered[at].EndTime}");
                }
            }
        }
        return null;
    }

    /// <summary>아이템 전체 교체 + 버전 올리기 — schedule_service.replace_items 의 짝.</summary>
    private void ReplaceItems(Schedule schedule, List<ScheduleItemIn> items)
    {
        foreach (var old in schedule.Items.ToList())
        {
            schedule.Items.Remove(old);
            db.ScheduleItems.Remove(old);
        }
        foreach (var (raw, index) in items.Select((raw, index) => (raw, index)))
        {
            schedule.Items.Add(new ScheduleItem
            {
                DayOfWeek = raw.DayOfWeek,
                StartTime = raw.StartTime is null ? null : TimeOnly.Parse(raw.StartTime),
                EndTime = raw.EndTime is null ? null : TimeOnly.Parse(raw.EndTime),
                SortOrder = raw.SortOrder ?? index,
                DurationSec = raw.DurationSec,
                Transition = Transitions.Normalize(raw.Transition),
                TransitionMs = Transitions.NormalizeMs(raw.TransitionMs),
                // 공지 참조가 있으면 그것 하나만 정본이다 — 콘텐츠 참조·인라인은 버린다.
                OrgNoticeId = raw.OrgNoticeId,
                ContentId = raw.OrgNoticeId is not null ? null : raw.ContentId,
                ContentJson = raw.OrgNoticeId is not null || raw.ContentId is not null
                    ? "{}" : Json.Write(raw.Content),
            });
        }
        schedule.Version += 1;
    }

    private async Task<List<(int, string, int)>> NotifyTargetsAsync(Schedule schedule)
    {
        var rows = await db.DeviceScheduleLinks
            .Where(l => l.ScheduleId == schedule.Id)
            .Join(db.Devices, l => l.DeviceId, d => d.Id, (l, d) => new { d.Id, d.DeviceCode })
            .ToListAsync();
        return rows.Select(r => (r.Id, r.DeviceCode, schedule.Version)).ToList();
    }

    [HttpGet("")]
    public async Task<ActionResult<PageOut<ScheduleOut>>> List(
        [FromQuery] string? q,
        [FromQuery(Name = "org_id")] int? orgId,
        [FromQuery] int page = 1, [FromQuery] int size = 20)
    {
        var actor = HttpContext.CurrentUser()!;
        var query = db.Schedules.AsQueryable();
        var scope = await permissions.ManagedOrgIdsAsync(actor);
        if (scope is not null) query = query.Where(s => scope.Contains(s.OrgId));
        if (!string.IsNullOrEmpty(q))
            query = query.Where(s => EF.Functions.Like(s.Name, $"%{q}%"));
        if (orgId is int org)
        {
            if (!await permissions.CanViewOrgAsync(actor, org))
                return StatusCode(403, new { detail = "해당 기관의 스케줄을 조회할 권한이 없습니다." });
            var subtree = await orgTree.DescendantIdsAsync(org);
            query = query.Where(s => subtree.Contains(s.OrgId));
        }

        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(s => s.Id)
            .Skip((page - 1) * size).Take(Math.Clamp(size, 1, 200)).ToListAsync();
        var items = new List<ScheduleOut>();
        foreach (var row in rows) items.Add(await ToOut(row));
        return new PageOut<ScheduleOut>(items, total, page, size);
    }

    /// <summary>편집기가 새 아이템을 만들 때 쓰는 기본 문서.</summary>
    [HttpGet("content/blank")]
    public ActionResult<JsonObject> BlankContent(
        [FromQuery] int width = 1920, [FromQuery] int height = 1080) =>
        ContentsController.EmptyDocument(width, height);

    [HttpGet("{scheduleId:int}")]
    public async Task<ActionResult<ScheduleDetailOut>> Get(int scheduleId)
    {
        var actor = HttpContext.CurrentUser()!;
        var schedule = await LoadAsync(scheduleId);
        if (schedule is null) return NotFound(new { detail = "스케줄을(를) 찾을 수 없습니다." });
        if (!await permissions.CanViewOrgAsync(actor, schedule.OrgId))
            return StatusCode(403, new { detail = "해당 스케줄을 조회할 권한이 없습니다." });
        return await ToDetail(schedule);
    }

    private Task<Schedule?> LoadAsync(int scheduleId) =>
        db.Schedules.Include(s => s.Items).ThenInclude(i => i.ContentRef)
            .Include(s => s.Items).ThenInclude(i => i.NoticeRef)
            .SingleOrDefaultAsync(s => s.Id == scheduleId);

    [HttpPost("")]
    public async Task<ActionResult<ScheduleDetailOut>> Create(ScheduleCreateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var orgId = payload.OrgId ?? actor.OrgId;
        if (!await permissions.CanViewOrgAsync(actor, orgId))
            return StatusCode(403, new { detail = "해당 기관에 스케줄을 만들 권한이 없습니다." });
        if (payload.StartAt is not null && payload.EndAt is not null && payload.StartAt >= payload.EndAt)
            return BadRequest(new { detail = "종료일시는 시작일시보다 뒤여야 합니다." });

        var now = DateTime.UtcNow;
        var schedule = new Schedule
        {
            Name = payload.Name,
            Kind = payload.Kind,
            Orientation = payload.Orientation,
            StartAt = payload.StartAt,
            EndAt = payload.EndAt,
            OrgId = orgId,
            CreatedBy = actor.Id,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Schedules.Add(schedule);

        if (payload.Items.Count > 0)
        {
            if (await ValidateItemsAsync(actor, payload.Items, schedule.Orientation, schedule.OrgId) is (int, string) createError)
                return StatusCode(createError.Item1, new { detail = createError.Item2 });
            ReplaceItems(schedule, payload.Items);
        }
        await db.SaveChangesAsync();
        return StatusCode(201, await ToDetail((await LoadAsync(schedule.Id))!));
    }

    [HttpPut("{scheduleId:int}")]
    public async Task<ActionResult<ScheduleDetailOut>> Update(int scheduleId, ScheduleUpdateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var schedule = await LoadAsync(scheduleId);
        if (schedule is null) return NotFound(new { detail = "스케줄을(를) 찾을 수 없습니다." });
        if (!await CanManageAsync(actor, schedule))
            return StatusCode(403, new { detail = "해당 스케줄을 수정할 권한이 없습니다." });

        var newOrientation = payload.Orientation ?? schedule.Orientation;

        // 검사를 먼저 끝내고 나서 바꾼다.
        if (payload.Items is not null)
        {
            if (await ValidateItemsAsync(actor, payload.Items, newOrientation, schedule.OrgId) is (int, string) updateError)
                return StatusCode(updateError.Item1, new { detail = updateError.Item2 });
        }
        else if (newOrientation != schedule.Orientation)
        {
            // 방향만 바꾸는 경우 — 붙어 있는 콘텐츠가 새 방향과 맞아야 한다.
            var existing = schedule.Items.Select(i => new ScheduleItemIn
            {
                ContentId = i.ContentId,
                Content = Json.Parse(i.ContentJson),
            }).ToList();
            if (await ValidateItemsAsync(actor, existing, newOrientation, schedule.OrgId) is (int, string) orientError)
                return StatusCode(orientError.Item1, new { detail = orientError.Item2 });
        }

        // 한쪽만 보내오는 기간 변경 — 저장된 반대쪽과 뒤집히는 것을 잡는다.
        var start = payload.StartAtSet ? payload.StartAt : schedule.StartAt;
        var end = payload.EndAtSet ? payload.EndAt : schedule.EndAt;
        if (start is not null && end is not null
            && ScheduleCoreService.AsUtc(start) >= ScheduleCoreService.AsUtc(end))
            return BadRequest(new { detail = "종료일시는 시작일시보다 뒤여야 합니다." });

        if (payload.StartAtSet) schedule.StartAt = payload.StartAt;
        if (payload.EndAtSet) schedule.EndAt = payload.EndAt;
        if (payload.Name is not null) schedule.Name = payload.Name;
        if (payload.Kind is not null) schedule.Kind = payload.Kind;
        if (payload.Orientation is not null) schedule.Orientation = payload.Orientation;

        if (payload.Items is not null)
            ReplaceItems(schedule, payload.Items);
        else
            schedule.Version += 1;  // 메타데이터만 바뀌어도 장치가 갱신하도록.
        schedule.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        _ = notify.PushScheduleChangedAsync(await NotifyTargetsAsync(schedule));
        return await ToDetail((await LoadAsync(schedule.Id))!);
    }

    [HttpDelete("{scheduleId:int}")]
    public async Task<ActionResult<Message>> Delete(int scheduleId)
    {
        var actor = HttpContext.CurrentUser()!;
        var schedule = await db.Schedules.SingleOrDefaultAsync(s => s.Id == scheduleId);
        if (schedule is null) return NotFound(new { detail = "스케줄을(를) 찾을 수 없습니다." });
        if (!await CanManageAsync(actor, schedule))
            return StatusCode(403, new { detail = "해당 스케줄을 수정할 권한이 없습니다." });

        var count = await DeviceCountAsync(scheduleId);
        if (count > 0)
            return BadRequest(new
            {
                detail = $"이 스케줄을 사용 중인 장치가 {count}대 있습니다. 먼저 배정을 해제하세요.",
            });
        db.Schedules.Remove(schedule);
        await db.SaveChangesAsync();
        return new Message("스케줄이 삭제되었습니다.");
    }

    [HttpPost("{scheduleId:int}/duplicate")]
    public async Task<ActionResult<ScheduleDetailOut>> Duplicate(int scheduleId)
    {
        var actor = HttpContext.CurrentUser()!;
        var source = await LoadAsync(scheduleId);
        if (source is null) return NotFound(new { detail = "스케줄을(를) 찾을 수 없습니다." });
        if (!await permissions.CanViewOrgAsync(actor, source.OrgId))
            return StatusCode(403, new { detail = "해당 스케줄을 복제할 권한이 없습니다." });

        var now = DateTime.UtcNow;
        var copy = new Schedule
        {
            Name = $"{source.Name} (복사본)",
            Kind = source.Kind,
            Orientation = source.Orientation,   // 방향까지 같이 — 아이템이 그대로 유효해야 한다.
            StartAt = source.StartAt,           // 기간도 그대로 — 무기한이 되면 지난 안내가 다시 나간다.
            EndAt = source.EndAt,
            OrgId = source.OrgId,
            CreatedBy = actor.Id,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        foreach (var item in source.Items)
        {
            copy.Items.Add(new ScheduleItem
            {
                DayOfWeek = item.DayOfWeek,
                StartTime = item.StartTime,
                EndTime = item.EndTime,
                SortOrder = item.SortOrder,
                DurationSec = item.DurationSec,
                ContentId = item.ContentId,     // 콘텐츠는 라이브러리 공유 — 참조만 복사.
                ContentJson = item.ContentJson,
            });
        }
        copy.Version += 1;
        db.Schedules.Add(copy);
        await db.SaveChangesAsync();
        return await ToDetail((await LoadAsync(copy.Id))!);
    }
}

// 소속기관 공지 — FastAPI /api/v1/org-notices 의 짝.
//
// 기간이 정해진 재생목록 형태다: 슬라이드(item)마다 콘텐츠 편집기 문서를
// 인라인으로 갖고, 순서와 유지 시간으로 순환한다. 만들기 화면은 좌(편집기)/
// 우(목록) 분할이라 저장은 아이템 전체 교체로 온다.
//
// 권한: 조회는 관리 범위(can_view_org), 등록/수정/삭제는 기관 관리
// (can_manage_org). 고칠 때마다 version 이 오른다 — 표출 쪽 변경 감지용.

using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record OrgNoticeItemOut(int Id, int SortOrder, int DurationSec, JsonNode Document);

public record OrgNoticeSummaryOut(
    int Id, int OrgId, string Name, string? StartDate, string? EndDate,
    int Version, int ItemCount, DateTime CreatedAt, DateTime UpdatedAt,
    string? OrgName = null);

public record OrgNoticeDetailOut(
    int Id, int OrgId, string Name, string? StartDate, string? EndDate,
    int Version, int ItemCount, DateTime CreatedAt, DateTime UpdatedAt,
    List<OrgNoticeItemOut> Items);

public class OrgNoticeItemIn
{
    public int DurationSec { get; set; } = 10;
    public JsonNode? Document { get; set; }
}

public class OrgNoticeCreateIn
{
    public int? OrgId { get; set; }
    public string Name { get; set; } = "";
    public string? StartDate { get; set; }
    public string? EndDate { get; set; }
}

public class OrgNoticeUpdateIn
{
    public string? Name { get; set; }
    public string? StartDate { get; set; }
    public string? EndDate { get; set; }
    public List<OrgNoticeItemIn>? Items { get; set; }
}

[ApiController]
[Route("api/v1/org-notices")]
[Authorize]
public class OrgNoticesController(
    AppDbContext db, PermissionService permissions, OrgTreeService orgTree) : ControllerBase
{
    private static OrgNoticeSummaryOut ToSummary(OrgNotice notice, string? orgName = null) => new(
        notice.Id, notice.OrgId, notice.Name, notice.StartDate, notice.EndDate,
        notice.Version, notice.Items.Count, notice.CreatedAt, notice.UpdatedAt, orgName);

    private static OrgNoticeDetailOut ToDetail(OrgNotice notice) => new(
        notice.Id, notice.OrgId, notice.Name, notice.StartDate, notice.EndDate,
        notice.Version, notice.Items.Count, notice.CreatedAt, notice.UpdatedAt,
        notice.Items.OrderBy(i => i.SortOrder)
            .Select(i => new OrgNoticeItemOut(
                i.Id, i.SortOrder, i.DurationSec, Json.Parse(i.DocumentJson) ?? new JsonObject()))
            .ToList());

    /// <summary>YYYY-MM-DDTHH:MM 또는 YYYY-MM-DD(날짜만 오면 시작은 00:00,
    /// 종료는 23:59 로 넓혀 저장). 빈 문자열은 '기간 지움'으로 읽어 null.</summary>
    private static bool TryPeriod(string? raw, bool isEnd, out string? cleaned)
    {
        cleaned = null;
        if (string.IsNullOrEmpty(raw)) return true;
        if (DateOnly.TryParseExact(raw, "yyyy-MM-dd", out _))
        {
            cleaned = raw + (isEnd ? "T23:59" : "T00:00");
            return true;
        }
        if (DateTime.TryParseExact(raw, "yyyy-MM-ddTHH:mm", null,
                System.Globalization.DateTimeStyles.None, out _))
        {
            cleaned = raw;
            return true;
        }
        return false;
    }

    /// <summary>이 공지를 참조하는 스케줄의 버전을 올린다 — 장치가 하트비트에서
    /// 변경을 발견해 다시 받는다(공지가 스케줄에 '참조'로 담기는 이유).</summary>
    private async Task BumpReferencingSchedulesAsync(int noticeId)
    {
        var schedules = await db.Schedules
            .Where(s => db.ScheduleItems.Any(i => i.ScheduleId == s.Id && i.OrgNoticeId == noticeId))
            .ToListAsync();
        foreach (var schedule in schedules)
        {
            schedule.Version += 1;
            schedule.UpdatedAt = DateTime.UtcNow;
        }
    }

    private Task<OrgNotice?> LoadAsync(int noticeId) =>
        db.OrgNotices.Include(n => n.Items).SingleOrDefaultAsync(n => n.Id == noticeId);

    [HttpGet("")]
    public async Task<ActionResult<List<OrgNoticeSummaryOut>>> List(
        [FromQuery(Name = "org_id")] int? orgId,
        [FromQuery(Name = "for_org")] int? forOrg)
    {
        var actor = HttpContext.CurrentUser()!;

        // for_org: 그 기관의 표출용 — 자기 것 + 상위기관이 내린 공지까지.
        // 공지는 상위 기관이 소속기관에 내리는 것이라, 하위가 상위 것을
        // 읽는 방향은 의도된 사용이다(스케줄 편집기가 이 모드를 쓴다).
        if (forOrg is int target2)
        {
            if (!await permissions.CanViewOrgAsync(actor, target2))
                return StatusCode(403, new { detail = "해당 기관의 공지를 조회할 권한이 없습니다." });
            var chain = await orgTree.AncestorIdsAsync(target2, includeSelf: true);
            var order = chain.Select((id, at) => (id, at)).ToDictionary(x => x.id, x => x.at);
            var names = await db.Organizations.Where(o => chain.Contains(o.Id))
                .ToDictionaryAsync(o => o.Id, o => o.Name);
            var inherited = await db.OrgNotices.Include(n => n.Items)
                .Where(n => chain.Contains(n.OrgId)).ToListAsync();
            // 자기 기관 것 먼저, 그다음 가까운 상위 순 — 각 기관 안에서는 최신순.
            return inherited
                .OrderBy(n => order[n.OrgId]).ThenByDescending(n => n.UpdatedAt)
                .Select(n => ToSummary(n, names.GetValueOrDefault(n.OrgId))).ToList();
        }

        var target = orgId ?? actor.OrgId;
        if (!await permissions.CanViewOrgAsync(actor, target))
            return StatusCode(403, new { detail = "해당 기관의 공지를 조회할 권한이 없습니다." });

        var orgName = (await db.Organizations.FindAsync(target))?.Name;
        var rows = await db.OrgNotices.Include(n => n.Items)
            .Where(n => n.OrgId == target)
            .OrderByDescending(n => n.UpdatedAt).ToListAsync();
        return rows.Select(n => ToSummary(n, orgName)).ToList();
    }

    [HttpGet("{noticeId:int}")]
    public async Task<ActionResult<OrgNoticeDetailOut>> Get(int noticeId)
    {
        var actor = HttpContext.CurrentUser()!;
        var notice = await LoadAsync(noticeId);
        if (notice is null) return NotFound(new { detail = "공지을(를) 찾을 수 없습니다." });
        // 상위기관이 내린 공지는 하위 기관도 읽을 수 있어야 스케줄에 담는다.
        if (!await permissions.CanViewOrgAsync(actor, notice.OrgId)
            && !await orgTree.IsDescendantAsync(notice.OrgId, actor.OrgId))
            return StatusCode(403, new { detail = "해당 공지를 조회할 권한이 없습니다." });
        return ToDetail(notice);
    }

    [HttpPost("")]
    public async Task<ActionResult<OrgNoticeDetailOut>> Create(OrgNoticeCreateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var orgId = payload.OrgId ?? actor.OrgId;
        if (!await permissions.CanManageOrgAsync(actor, orgId))
            return StatusCode(403, new { detail = "해당 기관에 공지를 만들 권한이 없습니다." });
        var name = payload.Name.Trim();
        if (name.Length is 0 or > 200)
            return BadRequest(new { detail = "공지 이름은 1~200자여야 합니다." });
        if (!TryPeriod(payload.StartDate, false, out var start)
            || !TryPeriod(payload.EndDate, true, out var end))
            return BadRequest(new { detail = "기간은 YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM 형식이어야 합니다." });

        var now = DateTime.UtcNow;
        var notice = new OrgNotice
        {
            OrgId = orgId,
            Name = name,
            StartDate = start,
            EndDate = end,
            CreatedBy = actor.Id,
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.OrgNotices.Add(notice);
        await db.SaveChangesAsync();
        return StatusCode(201, ToDetail(notice));
    }

    [HttpPut("{noticeId:int}")]
    public async Task<ActionResult<OrgNoticeDetailOut>> Update(int noticeId, OrgNoticeUpdateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var notice = await LoadAsync(noticeId);
        if (notice is null) return NotFound(new { detail = "공지을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageOrgAsync(actor, notice.OrgId))
            return StatusCode(403, new { detail = "해당 공지를 수정할 권한이 없습니다." });

        if (payload.Name is string rawName)
        {
            var name = rawName.Trim();
            if (name.Length is 0 or > 200)
                return BadRequest(new { detail = "공지 이름은 1~200자여야 합니다." });
            notice.Name = name;
        }
        if (payload.StartDate is not null)
        {
            if (!TryPeriod(payload.StartDate, false, out var start))
                return BadRequest(new { detail = "기간은 YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM 형식이어야 합니다." });
            notice.StartDate = start;
        }
        if (payload.EndDate is not null)
        {
            if (!TryPeriod(payload.EndDate, true, out var end))
                return BadRequest(new { detail = "기간은 YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM 형식이어야 합니다." });
            notice.EndDate = end;
        }

        if (payload.Items is not null)
        {
            if (payload.Items.Count > 100)
                return BadRequest(new { detail = "슬라이드는 100장까지입니다." });
            if (payload.Items.Any(i => i.DurationSec is < 1 or > 86400))
                return BadRequest(new { detail = "유지 시간은 1~86400초여야 합니다." });

            // 아이템 전체 교체 — 편집 화면이 순서를 통째로 보낸다.
            foreach (var old in notice.Items.ToList())
            {
                notice.Items.Remove(old);
                db.OrgNoticeItems.Remove(old);
            }
            foreach (var (item, index) in payload.Items.Select((item, index) => (item, index)))
            {
                notice.Items.Add(new OrgNoticeItem
                {
                    SortOrder = index,
                    DurationSec = item.DurationSec,
                    DocumentJson = Json.Write(item.Document),
                });
            }
        }

        notice.Version += 1;
        notice.UpdatedAt = DateTime.UtcNow;
        await BumpReferencingSchedulesAsync(notice.Id);
        await db.SaveChangesAsync();
        return ToDetail(notice);
    }

    [HttpDelete("{noticeId:int}")]
    public async Task<ActionResult<Message>> Delete(int noticeId)
    {
        var actor = HttpContext.CurrentUser()!;
        var notice = await db.OrgNotices.SingleOrDefaultAsync(n => n.Id == noticeId);
        if (notice is null) return NotFound(new { detail = "공지을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageOrgAsync(actor, notice.OrgId))
            return StatusCode(403, new { detail = "해당 공지를 삭제할 권한이 없습니다." });

        await BumpReferencingSchedulesAsync(notice.Id);
        db.OrgNotices.Remove(notice);
        await db.SaveChangesAsync();
        return new Message("공지가 삭제되었습니다.");
    }
}

// 장치 관리 — FastAPI /api/v1/devices 의 짝(전체 이식).
//
//   등록/삭제: 기관관리자(자기·하위 기관), 슈퍼관리자
//   수정/스케줄 배정: 위 + 위임받은 장치관리자
//   장치 고유번호는 서버가 자동 생성하며 수정할 수 없다.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record AssignedScheduleOut(
    int Id, string Name, string Kind, string Orientation,
    DateTime? StartAt, DateTime? EndAt, bool Active);

public record DeviceOut(
    int Id, int OrgId, string DeviceCode, string Name, string Os, string FormFactor,
    string PanelType, int? Width, int? Height, string? PlaceName, string? PlaceKind,
    string DeviceKind, int? Grade, int? ClassNo, string? ClassName, string? Track,
    bool IsMaster, string? Cpu, string? Memory, string? Storage,
    int Version, DateTime? LastSeenAt, string? AppVersion,
    long? StorageTotalBytes, long? StorageFreeBytes, DateTime? StorageReportedAt,
    long? StorageUsedBytes, double? StorageUsage, bool StorageWarning,
    DateTime? ScreenshotAt, string? OrgName, List<AssignedScheduleOut> Schedules, bool Online);

public class DeviceCreateIn
{
    public int OrgId { get; set; }
    public string Name { get; set; } = "";
    public string Os { get; set; } = "";
    public string FormFactor { get; set; } = "DID";
    public string PanelType { get; set; } = Services.Orientation.Landscape;
    public int? Width { get; set; }
    public int? Height { get; set; }
    public string? PlaceName { get; set; }
    public string? PlaceKind { get; set; }
    public string DeviceKind { get; set; } = "일반";
    public int? Grade { get; set; }
    public int? ClassNo { get; set; }
    public string? ClassName { get; set; }
    public string? Track { get; set; }
    public bool IsMaster { get; set; }
    public string? Cpu { get; set; }
    public string? Memory { get; set; }
    public string? Storage { get; set; }
    public List<int> ScheduleIds { get; set; } = [];
}

public class DeviceUpdateIn
{
    public string? Name { get; set; }
    public string? Os { get; set; }
    public string? FormFactor { get; set; }
    public string? PanelType { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public string? PlaceName { get; set; }
    public string? PlaceKind { get; set; }
    public string? DeviceKind { get; set; }
    public int? Grade { get; set; }
    public int? ClassNo { get; set; }
    public string? ClassName { get; set; }
    public string? Track { get; set; }
    public bool? IsMaster { get; set; }
    public string? Cpu { get; set; }
    public string? Memory { get; set; }
    public string? Storage { get; set; }
    /// <summary>주면 배정을 통째로 교체한다. 안 주면 건드리지 않는다(빈 목록 = 전부 해제).</summary>
    public List<int>? ScheduleIds { get; set; }
}

public record ScheduleAssignIn(List<int> ScheduleIds);

public record BulkScheduleAssignIn(List<int> DeviceIds, List<int> ScheduleIds);

public record DeviceManagerAssignIn(List<int> UserIds);

[ApiController]
[Route("api/v1/devices")]
[Authorize]
public class DevicesController(
    AppDbContext db, PermissionService permissions, OrgTreeService orgTree,
    ConnectionHub hub, NotifyService notify) : ControllerBase
{
    /// <summary>지원하는 원격 제어 명령 — 플레이어가 이 문자열을 그대로 받는다.</summary>
    private static readonly Dictionary<string, string> DeviceCommands = new()
    {
        ["reload"] = "리로딩",
        ["restart"] = "리부팅",
        ["shutdown"] = "끄기",
        ["screenshot"] = "미리보기",
    };

    private async Task<DeviceOut> ToOut(Device device)
    {
        var org = await db.Organizations.FindAsync(device.OrgId);
        var now = DateTime.UtcNow;
        var schedules = device.ScheduleLinks
            .Where(l => l.Schedule is not null)
            .OrderBy(l => l.SortOrder)
            .Select(l => new AssignedScheduleOut(
                l.Schedule.Id, l.Schedule.Name, l.Schedule.Kind, l.Schedule.Orientation,
                l.Schedule.StartAt, l.Schedule.EndAt,
                ScheduleCoreService.IsActive(l.Schedule, now)))
            .ToList();
        var usage = DeviceStorage.UsageRatio(device.StorageTotalBytes, device.StorageFreeBytes);
        var screenshotAt = await db.DeviceScreenshots
            .Where(s => s.DeviceId == device.Id)
            .Select(s => (DateTime?)s.CapturedAt).SingleOrDefaultAsync();
        return new DeviceOut(
            device.Id, device.OrgId, device.DeviceCode, device.Name, device.Os,
            device.FormFactor, device.PanelType, device.Width, device.Height,
            device.PlaceName, device.PlaceKind, device.DeviceKind, device.Grade,
            device.ClassNo, device.ClassName, device.Track, device.IsMaster,
            device.Cpu, device.Memory, device.Storage,
            device.Version, device.LastSeenAt, device.AppVersion,
            device.StorageTotalBytes, device.StorageFreeBytes, device.StorageReportedAt,
            DeviceStorage.UsedBytes(device.StorageTotalBytes, device.StorageFreeBytes),
            usage, DeviceStorage.IsWarning(usage),
            screenshotAt, org?.Name, schedules, hub.IsOnline(device.Id));
    }

    private Task<Device?> LoadAsync(int deviceId) =>
        db.Devices.Include(d => d.ScheduleLinks).ThenInclude(l => l.Schedule)
            .SingleOrDefaultAsync(d => d.Id == deviceId);

    /// <summary>조회 가능한 장치로 범위를 좁힌다 — _visible_device_stmt 의 짝.</summary>
    private async Task<IQueryable<Device>> VisibleDevicesAsync(AppUser actor)
    {
        var query = db.Devices
            .Include(d => d.ScheduleLinks).ThenInclude(l => l.Schedule).AsQueryable();
        if (PermissionService.IsSuperAdmin(actor)) return query;
        if (PermissionService.IsOrgAdmin(actor))
        {
            var subtree = await orgTree.DescendantIdsAsync(actor.OrgId);
            return query.Where(d => subtree.Contains(d.OrgId));
        }
        var delegated = await permissions.DelegatedDeviceIdsAsync(actor);
        if (actor.Roles.Any(r => r.Role == Roles.HomeroomTeacher))
            return query.Where(d => d.OrgId == actor.OrgId || delegated.Contains(d.Id));
        return query.Where(d => delegated.Contains(d.Id));
    }

    [HttpGet("")]
    public async Task<ActionResult<PageOut<DeviceOut>>> List(
        [FromQuery] string? q,
        [FromQuery(Name = "org_id")] int? orgId,
        [FromQuery(Name = "schedule_id")] int? scheduleId,
        [FromQuery] bool? unassigned,
        [FromQuery] bool? online,
        [FromQuery] int page = 1, [FromQuery] int size = 20)
    {
        var actor = HttpContext.CurrentUser()!;
        var query = await VisibleDevicesAsync(actor);

        if (!string.IsNullOrEmpty(q))
            query = query.Where(d =>
                EF.Functions.Like(d.Name, $"%{q}%")
                || EF.Functions.Like(d.DeviceCode, $"%{q}%")
                || (d.PlaceName != null && EF.Functions.Like(d.PlaceName, $"%{q}%")));
        if (orgId is int org)
        {
            if (!await permissions.CanViewOrgAsync(actor, org))
                return StatusCode(403, new { detail = "해당 기관의 장치를 조회할 권한이 없습니다." });
            var subtree = await orgTree.DescendantIdsAsync(org);
            query = query.Where(d => subtree.Contains(d.OrgId));
        }
        if (scheduleId is int schedule)
            query = query.Where(d => d.ScheduleLinks.Any(l => l.ScheduleId == schedule));
        if (unassigned == true)
            query = query.Where(d => !d.ScheduleLinks.Any());

        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(d => d.Id)
            .Skip((page - 1) * size).Take(Math.Clamp(size, 1, 200)).ToListAsync();
        var items = new List<DeviceOut>();
        foreach (var row in rows) items.Add(await ToOut(row));

        // 접속 여부는 DB 가 아니라 WebSocket 허브가 갖고 있어 조회 후 거른다.
        if (online is bool wantOnline)
            items = items.Where(i => i.Online == wantOnline).ToList();

        return new PageOut<DeviceOut>(items, total, page, size);
    }

    [HttpGet("{deviceId:int}")]
    public async Task<ActionResult<DeviceOut>> Get(int deviceId)
    {
        var actor = HttpContext.CurrentUser()!;
        var device = await LoadAsync(deviceId);
        if (device is null) return NotFound(new { detail = "장치을(를) 찾을 수 없습니다." });
        if (!await permissions.CanViewDeviceAsync(actor, device))
            return StatusCode(403, new { detail = "해당 장치를 조회할 권한이 없습니다." });
        return await ToOut(device);
    }

    [HttpPost("")]
    public async Task<ActionResult<DeviceOut>> Create(DeviceCreateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        if (!await permissions.CanCreateDeviceAsync(actor, payload.OrgId))
            return StatusCode(403, new { detail = "해당 기관에 장치를 등록할 권한이 없습니다." });
        if (await db.Organizations.FindAsync(payload.OrgId) is null)
            return BadRequest(new { detail = "존재하지 않는 기관입니다." });

        var now = DateTime.UtcNow;
        var device = new Device
        {
            OrgId = payload.OrgId,
            // 장치 고유번호는 서버가 생성한다. 클라이언트 입력을 받지 않는다.
            DeviceCode = await DeviceCode.GenerateUniqueAsync(db),
            Name = payload.Name,
            Os = payload.Os,
            FormFactor = payload.FormFactor,
            PanelType = payload.PanelType,
            Width = payload.Width,
            Height = payload.Height,
            PlaceName = payload.PlaceName,
            PlaceKind = payload.PlaceKind,
            DeviceKind = payload.DeviceKind,
            Grade = payload.Grade,
            ClassNo = payload.ClassNo,
            ClassName = payload.ClassName,
            Track = payload.Track,
            IsMaster = payload.IsMaster,
            Cpu = payload.Cpu,
            Memory = payload.Memory,
            Storage = payload.Storage,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Devices.Add(device);
        if (payload.ScheduleIds.Count > 0)
        {
            if (await ReplaceSchedulesAsync(actor, device, payload.ScheduleIds) is string error)
                return ErrorFor(error);
        }
        await db.SaveChangesAsync();
        return StatusCode(201, await ToOut((await LoadAsync(device.Id))!));
    }

    [HttpPut("{deviceId:int}")]
    public async Task<ActionResult<DeviceOut>> Update(int deviceId, DeviceUpdateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var device = await LoadAsync(deviceId);
        if (device is null) return NotFound(new { detail = "장치을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageDeviceAsync(actor, device))
            return StatusCode(403, new { detail = "해당 장치를 수정할 권한이 없습니다." });

        var scheduleChanged = false;
        if (payload.ScheduleIds is not null)
        {
            var before = device.ScheduleLinks.OrderBy(l => l.SortOrder)
                .Select(l => l.ScheduleId).ToList();
            if (await ReplaceSchedulesAsync(actor, device, payload.ScheduleIds) is string error)
                return ErrorFor(error);
            scheduleChanged = !before.SequenceEqual(payload.ScheduleIds.Distinct());
        }

        if (payload.Name is not null) device.Name = payload.Name;
        if (payload.Os is not null) device.Os = payload.Os;
        if (payload.FormFactor is not null) device.FormFactor = payload.FormFactor;
        if (payload.PanelType is not null) device.PanelType = payload.PanelType;
        if (payload.Width is not null) device.Width = payload.Width;
        if (payload.Height is not null) device.Height = payload.Height;
        if (payload.PlaceName is not null) device.PlaceName = payload.PlaceName;
        if (payload.PlaceKind is not null) device.PlaceKind = payload.PlaceKind;
        if (payload.DeviceKind is not null) device.DeviceKind = payload.DeviceKind;
        if (payload.Grade is not null) device.Grade = payload.Grade;
        if (payload.ClassNo is not null) device.ClassNo = payload.ClassNo;
        if (payload.ClassName is not null) device.ClassName = payload.ClassName;
        if (payload.Track is not null) device.Track = payload.Track;
        if (payload.IsMaster is not null) device.IsMaster = payload.IsMaster.Value;
        if (payload.Cpu is not null) device.Cpu = payload.Cpu;
        if (payload.Memory is not null) device.Memory = payload.Memory;
        if (payload.Storage is not null) device.Storage = payload.Storage;
        device.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var fresh = (await LoadAsync(device.Id))!;
        if (scheduleChanged)
        {
            _ = notify.PushScheduleChangedAsync(
                [(fresh.Id, fresh.DeviceCode, ScheduleCoreService.CurrentVersion(fresh))]);
        }
        return await ToOut(fresh);
    }

    [HttpDelete("{deviceId:int}")]
    public async Task<ActionResult<Message>> Delete(int deviceId)
    {
        var actor = HttpContext.CurrentUser()!;
        var device = await db.Devices.SingleOrDefaultAsync(d => d.Id == deviceId);
        if (device is null) return NotFound(new { detail = "장치을(를) 찾을 수 없습니다." });
        if (!await permissions.CanDeleteDeviceAsync(actor, device))
            return StatusCode(403, new { detail = "해당 장치를 삭제할 권한이 없습니다." });
        db.Devices.Remove(device);
        await db.SaveChangesAsync();
        return new Message("장치가 삭제되었습니다.");
    }

    /// <summary>스케줄 배정 전체 교체. 오류면 "403:.." / "400:.." 문자열.</summary>
    private async Task<string?> ReplaceSchedulesAsync(AppUser actor, Device device, List<int> scheduleIds)
    {
        var uniqueIds = scheduleIds.Distinct().ToList();
        foreach (var scheduleId in uniqueIds)
        {
            var schedule = await db.Schedules.FindAsync(scheduleId);
            if (schedule is null) return "400:존재하지 않는 스케줄입니다.";
            if (!await permissions.CanViewOrgAsync(actor, schedule.OrgId))
                return "403:해당 스케줄을 사용할 권한이 없습니다.";
        }

        foreach (var link in device.ScheduleLinks.ToList())
        {
            device.ScheduleLinks.Remove(link);
            db.DeviceScheduleLinks.Remove(link);
        }
        foreach (var (scheduleId, index) in uniqueIds.Select((id, index) => (id, index)))
            device.ScheduleLinks.Add(new DeviceScheduleLink { ScheduleId = scheduleId, SortOrder = index });
        return null;
    }

    private ObjectResult ErrorFor(string coded)
    {
        var parts = coded.Split(':', 2);
        return StatusCode(int.Parse(parts[0]), new { detail = parts[1] });
    }

    [HttpPut("{deviceId:int}/schedules")]
    public async Task<ActionResult<DeviceOut>> AssignSchedules(int deviceId, ScheduleAssignIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var device = await LoadAsync(deviceId);
        if (device is null) return NotFound(new { detail = "장치을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageDeviceAsync(actor, device))
            return StatusCode(403, new { detail = "해당 장치의 스케줄을 변경할 권한이 없습니다." });

        if (await ReplaceSchedulesAsync(actor, device, payload.ScheduleIds) is string error)
            return ErrorFor(error);
        await db.SaveChangesAsync();

        var fresh = (await LoadAsync(device.Id))!;
        _ = notify.PushScheduleChangedAsync(
            [(fresh.Id, fresh.DeviceCode, ScheduleCoreService.CurrentVersion(fresh))]);
        return await ToOut(fresh);
    }

    [HttpPost("schedule/bulk")]
    public async Task<ActionResult<Message>> BulkAssign(BulkScheduleAssignIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var devices = await db.Devices
            .Include(d => d.ScheduleLinks).ThenInclude(l => l.Schedule)
            .Where(d => payload.DeviceIds.Contains(d.Id)).ToListAsync();
        var missing = payload.DeviceIds.Except(devices.Select(d => d.Id)).Order().ToList();
        if (missing.Count > 0)
            return BadRequest(new { detail = $"존재하지 않는 장치가 있습니다: [{string.Join(", ", missing)}]" });

        foreach (var device in devices)
        {
            if (!await permissions.CanManageDeviceAsync(actor, device))
                return StatusCode(403, new { detail = $"장치 '{device.Name}' 의 스케줄을 변경할 권한이 없습니다." });
        }
        foreach (var device in devices)
        {
            if (await ReplaceSchedulesAsync(actor, device, payload.ScheduleIds) is string error)
                return ErrorFor(error);
        }
        await db.SaveChangesAsync();

        var targets = new List<(int, string, int)>();
        foreach (var device in devices)
        {
            var fresh = (await LoadAsync(device.Id))!;
            targets.Add((fresh.Id, fresh.DeviceCode, ScheduleCoreService.CurrentVersion(fresh)));
        }
        _ = notify.PushScheduleChangedAsync(targets);
        return new Message($"{devices.Count}대의 장치에 스케줄을 배정했습니다.");
    }

    [HttpGet("{deviceId:int}/managers")]
    public async Task<ActionResult<List<UserOut>>> ListManagers(int deviceId)
    {
        var actor = HttpContext.CurrentUser()!;
        var device = await LoadAsync(deviceId);
        if (device is null) return NotFound(new { detail = "장치을(를) 찾을 수 없습니다." });
        if (!await permissions.CanViewDeviceAsync(actor, device))
            return StatusCode(403, new { detail = "해당 장치를 조회할 권한이 없습니다." });

        var users = await db.DeviceManagers.Where(m => m.DeviceId == deviceId)
            .Join(db.Users.Include(u => u.Roles), m => m.UserId, u => u.Id, (m, u) => u)
            .Include(u => u.Roles)
            .ToListAsync();
        return users.Select(u => new UserOut(
            u.Id, u.UserId, u.Name, u.OrgId, u.Phone, u.Email,
            u.Status, u.RoleNames, null, null)).ToList();
    }

    [HttpPut("{deviceId:int}/managers")]
    public async Task<ActionResult<Message>> SetManagers(int deviceId, DeviceManagerAssignIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var device = await db.Devices.Include(d => d.Managers)
            .SingleOrDefaultAsync(d => d.Id == deviceId);
        if (device is null) return NotFound(new { detail = "장치을(를) 찾을 수 없습니다." });
        // 위임 자체는 기관관리자 권한 — 위임받은 장치관리자가 재위임할 수는 없다.
        if (!await permissions.CanCreateDeviceAsync(actor, device.OrgId))
            return StatusCode(403, new { detail = "장치 관리를 위임할 권한이 없습니다." });

        var targets = await db.Users.Include(u => u.Roles)
            .Where(u => payload.UserIds.Contains(u.Id)).ToListAsync();
        if (targets.Count != payload.UserIds.Distinct().Count())
            return BadRequest(new { detail = "존재하지 않는 사용자가 포함되어 있습니다." });

        var scope = await permissions.ManagedOrgIdsAsync(actor);
        foreach (var target in targets)
        {
            if (scope is not null && !scope.Contains(target.OrgId))
                return StatusCode(403, new { detail = $"'{target.Name}' 은(는) 관리 범위 밖의 사용자입니다." });
            if (target.Roles.All(r => r.Role != Roles.DeviceManager))
                return BadRequest(new { detail = $"'{target.Name}' 에게 DEVICE_MANAGER 역할이 없습니다." });
        }

        foreach (var manager in device.Managers.ToList())
        {
            device.Managers.Remove(manager);
            db.DeviceManagers.Remove(manager);
        }
        foreach (var target in targets)
            device.Managers.Add(new DeviceManager { UserId = target.Id });
        await db.SaveChangesAsync();
        return new Message($"{targets.Count}명에게 장치 관리를 위임했습니다.");
    }

    [HttpPost("{deviceId:int}/command")]
    public async Task<ActionResult<Message>> SendCommand(int deviceId, [FromQuery] string command)
    {
        var actor = HttpContext.CurrentUser()!;
        var device = await db.Devices.SingleOrDefaultAsync(d => d.Id == deviceId);
        if (device is null) return NotFound(new { detail = "장치을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageDeviceAsync(actor, device))
            return StatusCode(403, new { detail = "해당 장치를 제어할 권한이 없습니다." });
        if (!DeviceCommands.TryGetValue(command, out var label))
            return BadRequest(new { detail = "지원하지 않는 명령입니다." });

        // 명령은 WebSocket 으로만 나간다 — 접속하지 않은 장치에 성공을 말하면 안 된다.
        var delivered = await notify.PushCommandAsync(device.Id, device.DeviceCode, command);
        if (!delivered)
            return BadRequest(new { detail = "장치가 접속되어 있지 않습니다." });
        return new Message($"'{label}' 명령을 전송했습니다.");
    }

    [HttpGet("{deviceId:int}/screenshot")]
    public async Task<IActionResult> GetScreenshot(int deviceId)
    {
        var actor = HttpContext.CurrentUser()!;
        var device = await LoadAsync(deviceId);
        if (device is null) return NotFound(new { detail = "장치을(를) 찾을 수 없습니다." });
        if (!await permissions.CanViewDeviceAsync(actor, device))
            return StatusCode(403, new { detail = "해당 장치를 조회할 권한이 없습니다." });

        var shot = await db.DeviceScreenshots.SingleOrDefaultAsync(s => s.DeviceId == deviceId);
        if (shot is null) return NotFound(new { detail = "화면 캡처을(를) 찾을 수 없습니다." });

        // 캡처는 같은 URL 로 계속 갱신된다 — 캐시가 남으면 옛 화면이 보인다.
        Response.Headers.CacheControl = "no-store";
        Response.Headers.LastModified =
            DateTime.SpecifyKind(shot.CapturedAt, DateTimeKind.Utc).ToString("R");
        return File(shot.Image, shot.ContentType);
    }
}

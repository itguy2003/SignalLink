// 장치그룹 — FastAPI /api/v1/device-groups 의 짝(전체 이식).
//
// 사용자가 개인적으로 구성하는 장치 묶음. 담을 수 있는 장치는 그 사용자가
// 조회 권한을 가진 장치뿐이다.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record DeviceGroupOut(int Id, string Name, int UserId, List<int> DeviceIds);

public record DeviceGroupCreateIn(string Name, List<int> DeviceIds);

public class DeviceGroupUpdateIn
{
    public string? Name { get; set; }
    public List<int>? DeviceIds { get; set; }
}

[ApiController]
[Route("api/v1/device-groups")]
[Authorize]
public class DeviceGroupsController(AppDbContext db, PermissionService permissions) : ControllerBase
{
    private static DeviceGroupOut ToOut(DeviceGroup group) => new(
        group.Id, group.Name, group.UserId,
        group.Members.Select(m => m.DeviceId).ToList());

    private async Task<string?> AssertDevicesVisibleAsync(AppUser actor, List<int> deviceIds)
    {
        if (deviceIds.Count == 0) return null;
        var devices = await db.Devices.Where(d => deviceIds.Contains(d.Id)).ToListAsync();
        if (devices.Count != deviceIds.Distinct().Count())
            return "400:존재하지 않는 장치가 포함되어 있습니다.";
        foreach (var device in devices)
        {
            if (!await permissions.CanViewDeviceAsync(actor, device))
                return $"403:장치 '{device.Name}' 에 접근할 권한이 없습니다.";
        }
        return null;
    }

    private ObjectResult ErrorFor(string coded)
    {
        var parts = coded.Split(':', 2);
        return StatusCode(int.Parse(parts[0]), new { detail = parts[1] });
    }

    [HttpGet("")]
    public async Task<ActionResult<List<DeviceGroupOut>>> List()
    {
        var actor = HttpContext.CurrentUser()!;
        var groups = await db.DeviceGroups.Include(g => g.Members)
            .Where(g => g.UserId == actor.Id).OrderBy(g => g.Id).ToListAsync();
        return groups.Select(ToOut).ToList();
    }

    [HttpPost("")]
    public async Task<ActionResult<DeviceGroupOut>> Create(DeviceGroupCreateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        if (await AssertDevicesVisibleAsync(actor, payload.DeviceIds) is string error)
            return ErrorFor(error);

        var now = DateTime.UtcNow;
        var group = new DeviceGroup
        {
            Name = payload.Name, UserId = actor.Id, CreatedAt = now, UpdatedAt = now,
        };
        foreach (var deviceId in payload.DeviceIds.Distinct())
            group.Members.Add(new DeviceGroupMember { DeviceId = deviceId });
        db.DeviceGroups.Add(group);
        await db.SaveChangesAsync();
        return StatusCode(201, ToOut(group));
    }

    [HttpPut("{groupId:int}")]
    public async Task<ActionResult<DeviceGroupOut>> Update(int groupId, DeviceGroupUpdateIn payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var group = await db.DeviceGroups.Include(g => g.Members)
            .SingleOrDefaultAsync(g => g.Id == groupId);
        if (group is null) return NotFound(new { detail = "장치그룹을(를) 찾을 수 없습니다." });
        if (group.UserId != actor.Id)
            return StatusCode(403, new { detail = "본인이 만든 그룹만 수정할 수 있습니다." });

        if (payload.Name is not null) group.Name = payload.Name;
        if (payload.DeviceIds is not null)
        {
            if (await AssertDevicesVisibleAsync(actor, payload.DeviceIds) is string error)
                return ErrorFor(error);
            foreach (var member in group.Members.ToList())
            {
                group.Members.Remove(member);
                db.DeviceGroupMembers.Remove(member);
            }
            foreach (var deviceId in payload.DeviceIds.Distinct())
                group.Members.Add(new DeviceGroupMember { DeviceId = deviceId });
        }
        group.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return ToOut(group);
    }

    [HttpDelete("{groupId:int}")]
    public async Task<ActionResult<Message>> Delete(int groupId)
    {
        var actor = HttpContext.CurrentUser()!;
        var group = await db.DeviceGroups.SingleOrDefaultAsync(g => g.Id == groupId);
        if (group is null) return NotFound(new { detail = "장치그룹을(를) 찾을 수 없습니다." });
        if (group.UserId != actor.Id)
            return StatusCode(403, new { detail = "본인이 만든 그룹만 삭제할 수 있습니다." });
        db.DeviceGroups.Remove(group);
        await db.SaveChangesAsync();
        return new Message("장치그룹이 삭제되었습니다.");
    }
}

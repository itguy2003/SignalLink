// 사용자 관리 — FastAPI /api/v1/users 의 짝(전체 이식).
//
// 승인 규칙: 기관관리자는 자기·하위 기관 사용자를, 슈퍼관리자는 모두를
// 승인한다. 새 계정은 언제나 MEMBER 로만 시작한다.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record UserOut(
    int Id, string UserId, string Name, int OrgId, string? Phone, string? Email,
    string Status, List<string> Roles, string? OrgName, DateTime? CreatedAt);

public record UserCreate(
    int OrgId, string UserId, string Password, string Name, string? Phone, string? Email);

/// <summary>부분 갱신 — 안 보낸 필드는 건드리지 않는다.</summary>
public class UserUpdate
{
    public string? Name { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public int? OrgId { get; set; }
    public string? Status { get; set; }
    public List<string>? RolesList { get; set; }
    // 'roles' 는 형식이 겹치니 이름을 붙여 매핑한다.
    [System.Text.Json.Serialization.JsonPropertyName("roles")]
    public List<string>? Roles { get => RolesList; set => RolesList = value; }
    public string? Password { get; set; }
}

public record LoginLogOut(
    int Id, int? UserId, string AttemptedUserId, bool Success,
    string? IpAddress, string? Reason, DateTime CreatedAt);

[ApiController]
[Route("api/v1/users")]
[Authorize]
public class UsersController(
    AppDbContext db, PermissionService permissions, OrgTreeService orgTree,
    IConfiguration config)
    : ControllerBase
{
    private async Task<UserOut> ToOut(AppUser user)
    {
        var org = await db.Organizations.FindAsync(user.OrgId);
        return new UserOut(
            user.Id, user.UserId, user.Name, user.OrgId, user.Phone, user.Email,
            user.Status, user.RoleNames, org?.Name, user.CreatedAt);
    }

    [HttpGet("")]
    public async Task<ActionResult<PageOut<UserOut>>> List(
        [FromQuery] string? q,
        [FromQuery(Name = "org_id")] int? orgId,
        [FromQuery(Name = "status")] string? statusFilter,
        [FromQuery] string? role,
        [FromQuery] int page = 1, [FromQuery] int size = 20)
    {
        var actor = HttpContext.CurrentUser()!;
        var query = db.Users.Include(u => u.Roles).AsQueryable();
        var scope = await permissions.ManagedOrgIdsAsync(actor);
        if (scope is not null) query = query.Where(u => scope.Contains(u.OrgId));

        if (!string.IsNullOrEmpty(q))
            query = query.Where(u =>
                EF.Functions.Like(u.Name, $"%{q}%") || EF.Functions.Like(u.UserId, $"%{q}%"));
        if (orgId is int org)
        {
            if (!await permissions.CanViewOrgAsync(actor, org))
                return StatusCode(403, new { detail = "해당 기관의 사용자를 조회할 권한이 없습니다." });
            var subtree = await orgTree.DescendantIdsAsync(org);
            query = query.Where(u => subtree.Contains(u.OrgId));
        }
        if (statusFilter is not null) query = query.Where(u => u.Status == statusFilter);
        if (role is not null) query = query.Where(u => u.Roles.Any(r => r.Role == role));

        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(u => u.Id)
            .Skip((page - 1) * size).Take(size).ToListAsync();
        var items = new List<UserOut>();
        foreach (var row in rows) items.Add(await ToOut(row));
        return new PageOut<UserOut>(items, total, page, size);
    }

    [HttpGet("pending-count")]
    public async Task<ActionResult<object>> PendingCount()
    {
        var actor = HttpContext.CurrentUser()!;
        var query = db.Users.Where(u => u.Status == "미승인");
        var scope = await permissions.ManagedOrgIdsAsync(actor);
        if (scope is not null) query = query.Where(u => scope.Contains(u.OrgId));
        return new { count = await query.CountAsync() };
    }

    [HttpGet("{userId:int}")]
    public async Task<ActionResult<UserOut>> Get(int userId)
    {
        var actor = HttpContext.CurrentUser()!;
        var target = await db.Users.Include(u => u.Roles).SingleOrDefaultAsync(u => u.Id == userId);
        if (target is null) return NotFound(new { detail = "사용자을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageUserAsync(actor, target))
            return StatusCode(403, new { detail = "해당 사용자를 조회할 권한이 없습니다." });
        return await ToOut(target);
    }

    [HttpPost("")]
    public async Task<ActionResult<UserOut>> Create(UserCreate payload)
    {
        var actor = HttpContext.CurrentUser()!;
        if (!await permissions.CanManageOrgAsync(actor, payload.OrgId))
            return StatusCode(403, new { detail = "해당 기관에 사용자를 등록할 권한이 없습니다." });
        if (await db.Organizations.FindAsync(payload.OrgId) is null)
            return BadRequest(new { detail = "존재하지 않는 기관입니다." });
        if (await db.Users.AnyAsync(u => u.UserId == payload.UserId))
            return BadRequest(new { detail = "이미 사용 중인 사용자ID 입니다." });
        if (PasswordRules.ComplexityError(config, payload.Password) is string reason)
            return BadRequest(new { detail = reason });

        var now = DateTime.UtcNow;
        var user = new AppUser
        {
            UserId = payload.UserId,
            PasswordHash = PasswordHasher.Hash(payload.Password),
            OrgId = payload.OrgId,
            Name = payload.Name,
            Phone = payload.Phone,
            Email = payload.Email,
            Status = "승인",  // 관리자가 직접 등록한 계정은 즉시 사용 가능하다.
            CreatedAt = now,
            UpdatedAt = now,
        };
        // 새 계정은 MEMBER 로만 시작한다. 권한은 등록 뒤 수정에서 부여한다.
        user.Roles.Add(new UserRole { Role = Roles.Member });
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return StatusCode(201, await ToOut(user));
    }

    [HttpPut("{userId:int}")]
    public async Task<ActionResult<UserOut>> Update(int userId, UserUpdate payload)
    {
        var actor = HttpContext.CurrentUser()!;
        var target = await db.Users.Include(u => u.Roles).SingleOrDefaultAsync(u => u.Id == userId);
        if (target is null) return NotFound(new { detail = "사용자을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageUserAsync(actor, target))
            return StatusCode(403, new { detail = "해당 사용자를 수정할 권한이 없습니다." });

        var isSelf = actor.Id == target.Id;

        if (payload.OrgId is int newOrg)
        {
            if (isSelf && !PermissionService.IsSuperAdmin(actor))
                return StatusCode(403, new { detail = "자신의 소속기관은 변경할 수 없습니다." });
            if (!await permissions.CanManageOrgAsync(actor, newOrg))
                return StatusCode(403, new { detail = "해당 기관으로 소속을 옮길 권한이 없습니다." });
            if (await db.Organizations.FindAsync(newOrg) is null)
                return BadRequest(new { detail = "존재하지 않는 기관입니다." });
            target.OrgId = newOrg;
        }

        if (payload.Status is not null)
        {
            if (!await permissions.CanApproveUserAsync(actor, target))
                return StatusCode(403, new { detail = "해당 사용자의 상태를 변경할 권한이 없습니다." });
            target.Status = payload.Status;
        }

        if (payload.RolesList is not null)
        {
            if (isSelf && !PermissionService.IsSuperAdmin(actor))
                return StatusCode(403, new { detail = "자신의 역할은 변경할 수 없습니다." });
            foreach (var role in payload.RolesList)
            {
                if (!PermissionService.CanGrantRole(actor, role))
                    return StatusCode(403, new { detail = $"{role} 역할을 부여할 권한이 없습니다." });
            }
            var wanted = Roles.EnsureUnique(payload.RolesList, out var invalid);
            if (wanted is null)
                return BadRequest(new { detail = $"알 수 없는 역할입니다: {invalid}" });

            // 역할 전체 교체 — 있어야 할 것을 더하고, 없어야 할 것을 지운다.
            foreach (var row in target.Roles.Where(r => !wanted.Contains(r.Role)).ToList())
            {
                target.Roles.Remove(row);
                db.UserRoles.Remove(row);
            }
            var current = target.Roles.Select(r => r.Role).ToHashSet();
            foreach (var role in wanted.Where(r => !current.Contains(r)))
                target.Roles.Add(new UserRole { Role = role });
        }

        if (!string.IsNullOrEmpty(payload.Password))
        {
            if (PasswordRules.ComplexityError(config, payload.Password) is string pwReason)
                return BadRequest(new { detail = pwReason });
            target.PasswordHash = PasswordHasher.Hash(payload.Password);
        }

        if (payload.Name is not null) target.Name = payload.Name;
        if (payload.Phone is not null) target.Phone = payload.Phone;
        if (payload.Email is not null) target.Email = payload.Email;

        target.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return await ToOut(target);
    }

    [HttpPost("{userId:int}/approve")]
    public async Task<ActionResult<UserOut>> Approve(int userId) =>
        await SetStatus(userId, "승인", "해당 사용자를 승인할 권한이 없습니다.");

    [HttpPost("{userId:int}/reject")]
    public async Task<ActionResult<UserOut>> Reject(int userId) =>
        await SetStatus(userId, "미승인", "해당 사용자의 승인을 취소할 권한이 없습니다.");

    private async Task<ActionResult<UserOut>> SetStatus(int userId, string status, string denied)
    {
        var actor = HttpContext.CurrentUser()!;
        var target = await db.Users.Include(u => u.Roles).SingleOrDefaultAsync(u => u.Id == userId);
        if (target is null) return NotFound(new { detail = "사용자을(를) 찾을 수 없습니다." });
        if (!await permissions.CanApproveUserAsync(actor, target))
            return StatusCode(403, new { detail = denied });
        target.Status = status;
        target.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return await ToOut(target);
    }

    [HttpDelete("{userId:int}")]
    public async Task<ActionResult<Message>> Delete(int userId)
    {
        var actor = HttpContext.CurrentUser()!;
        var target = await db.Users.SingleOrDefaultAsync(u => u.Id == userId);
        if (target is null) return NotFound(new { detail = "사용자을(를) 찾을 수 없습니다." });
        if (target.Id == actor.Id)
            return BadRequest(new { detail = "자기 자신은 삭제할 수 없습니다." });
        if (!await permissions.CanApproveUserAsync(actor, target))
            return StatusCode(403, new { detail = "해당 사용자를 삭제할 권한이 없습니다." });
        db.Users.Remove(target);
        await db.SaveChangesAsync();
        return new Message("사용자가 삭제되었습니다.");
    }

    [HttpGet("{userId:int}/login-logs")]
    public async Task<ActionResult<List<LoginLogOut>>> LoginLogs(int userId, [FromQuery] int limit = 50)
    {
        var actor = HttpContext.CurrentUser()!;
        var target = await db.Users.SingleOrDefaultAsync(u => u.Id == userId);
        if (target is null) return NotFound(new { detail = "사용자을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageUserAsync(actor, target))
            return StatusCode(403, new { detail = "해당 사용자의 로그인 이력을 조회할 권한이 없습니다." });

        limit = Math.Clamp(limit, 1, 500);
        var rows = await db.LoginLogs.Where(l => l.UserId == userId)
            .OrderByDescending(l => l.CreatedAt).Take(limit).ToListAsync();
        return rows.Select(l => new LoginLogOut(
            l.Id, l.UserId, l.AttemptedUserId, l.Success, l.IpAddress, l.Reason, l.CreatedAt)).ToList();
    }
}

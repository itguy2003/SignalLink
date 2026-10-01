// 인증 — FastAPI /api/v1/auth 의 짝(전체 이식).
//
// 로그인·회원가입·ID 중복검사·내 정보(조회/변경)·비밀번호 변경. 응답 모양과
// 오류 문구를 파이썬 쪽과 그대로 맞춘다. 로그인 시도는 성공/실패 모두
// login_log 에 남긴다.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record LoginRequest(string UserId, string Password);

public record MeResponse(
    int Id, string UserId, string Name, string? Phone, string? Email,
    int OrgId, string? OrgName, string Status, List<string> Roles);

public record TokenResponse(string AccessToken, string TokenType, int ExpiresIn, MeResponse User);

public record RegisterRequest(
    int OrgId, string UserId, string Password, string PasswordConfirm,
    string Name, string? Phone, string? Email);

public record ProfileUpdateRequest(string? Name, string? Phone, string? Email);

public record PasswordChangeRequest(string CurrentPassword, string NewPassword);

public record UserIdCheckResponse(string UserId, bool Available);

[ApiController]
[Route("api/v1/auth")]
public class AuthController(AppDbContext db, TokenService tokens, IConfiguration config) : ControllerBase
{
    private MeResponse ToMe(AppUser user, string? orgName) => new(
        user.Id, user.UserId, user.Name, user.Phone, user.Email,
        user.OrgId, orgName, user.Status, user.RoleNames);

    private async Task LogLoginAsync(string attemptedUserId, int? userId, bool success, string? reason = null)
    {
        db.LoginLogs.Add(new LoginLog
        {
            UserId = userId,
            AttemptedUserId = attemptedUserId,
            Success = success,
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            UserAgent = Request.Headers.UserAgent.ToString() is { Length: > 0 } ua
                ? ua[..Math.Min(300, ua.Length)] : null,
            Reason = reason,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    [HttpGet("check-user-id")]
    [AllowAnonymous]
    public async Task<ActionResult<UserIdCheckResponse>> CheckUserId([FromQuery(Name = "user_id")] string userId)
    {
        var exists = await db.Users.AnyAsync(u => u.UserId == userId);
        return new UserIdCheckResponse(userId, !exists);
    }

    [HttpPost("register")]
    [AllowAnonymous]
    public async Task<ActionResult<MeResponse>> Register(RegisterRequest payload)
    {
        if (payload.Password != payload.PasswordConfirm)
            return BadRequest(new { detail = "비밀번호가 일치하지 않습니다." });

        var org = await db.Organizations.FindAsync(payload.OrgId);
        if (org is null)
            return BadRequest(new { detail = "존재하지 않는 소속기관입니다." });
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
            Status = "미승인",  // 신규 가입자는 승인 대기로 시작한다.
            CreatedAt = now,
            UpdatedAt = now,
        };
        user.Roles.Add(new UserRole { Role = Roles.Member });  // 모두가 갖는 기본 역할.
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return StatusCode(201, ToMe(user, org.Name));
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<TokenResponse>> Login(LoginRequest payload)
    {
        var user = await db.Users.Include(u => u.Roles)
            .SingleOrDefaultAsync(u => u.UserId == payload.UserId);

        if (user is null || !PasswordHasher.Verify(payload.Password, user.PasswordHash))
        {
            await LogLoginAsync(payload.UserId, user?.Id, false, "자격 증명 불일치");
            // 계정 존재 여부를 노출하지 않기 위해 동일한 메시지를 쓴다.
            return Unauthorized(new { detail = "사용자ID 또는 비밀번호가 올바르지 않습니다." });
        }
        if (user.Status != "승인")
        {
            await LogLoginAsync(payload.UserId, user.Id, false, "승인 대기");
            return StatusCode(403, new { detail = "승인 대기 중인 계정입니다. 기관 관리자에게 문의하세요." });
        }

        await LogLoginAsync(payload.UserId, user.Id, true);

        var org = await db.Organizations.FindAsync(user.OrgId);
        var token = tokens.CreateAccessToken(user.Id, user.RoleNames, user.OrgId);
        return new TokenResponse(token, "bearer", tokens.ExpireMinutes * 60, ToMe(user, org?.Name));
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<MeResponse>> Me()
    {
        var user = HttpContext.CurrentUser();
        if (user is null) return Unauthorized(new { detail = "인증이 필요합니다." });
        var org = await db.Organizations.FindAsync(user.OrgId);
        return ToMe(user, org?.Name);
    }

    [HttpPut("me")]
    [Authorize]
    public async Task<ActionResult<MeResponse>> UpdateMe(ProfileUpdateRequest payload)
    {
        var user = HttpContext.CurrentUser();
        if (user is null) return Unauthorized(new { detail = "인증이 필요합니다." });

        // 소속과 역할은 여기서 못 바꾼다 — 그건 관리자의 일이다.
        if (payload.Name is not null) user.Name = payload.Name.Trim();
        if (payload.Phone is not null)
            user.Phone = payload.Phone.Trim() is { Length: > 0 } phone ? phone : null;
        if (payload.Email is not null) user.Email = payload.Email;
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var org = await db.Organizations.FindAsync(user.OrgId);
        return ToMe(user, org?.Name);
    }

    [HttpPost("change-password")]
    [Authorize]
    public async Task<ActionResult<Message>> ChangePassword(PasswordChangeRequest payload)
    {
        var user = HttpContext.CurrentUser();
        if (user is null) return Unauthorized(new { detail = "인증이 필요합니다." });

        if (!PasswordHasher.Verify(payload.CurrentPassword, user.PasswordHash))
            return BadRequest(new { detail = "현재 비밀번호가 올바르지 않습니다." });
        if (PasswordRules.BasicError(payload.NewPassword) is string basic)
            return StatusCode(422, new { detail = basic });
        if (PasswordRules.ComplexityError(config, payload.NewPassword) is string reason)
            return BadRequest(new { detail = reason });
        user.PasswordHash = PasswordHasher.Hash(payload.NewPassword);
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return new Message("비밀번호가 변경되었습니다.");
    }
}

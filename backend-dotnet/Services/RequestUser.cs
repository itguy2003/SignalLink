// 요청 사용자 적재 — FastAPI(app/api/deps.py)의 짝.
//
// 토큰의 sub 로 사용자를 한 번 읽어 HttpContext.Items 에 둔다(컨트롤러가
// 재조회하지 않게). 2026-10 개편: 커뮤니티 유저 역할이 사라지면서 경로
// 울타리도 함께 걷어냈다 — 커뮤니티는 모든 승인 사용자의 공간이다.

using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Data;

namespace SignalLink.Api.Services;

public class RequestUserMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, AppDbContext db)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            var sub = context.User.FindFirst("sub")?.Value;
            if (int.TryParse(sub, out var id))
            {
                var user = await db.Users.Include(u => u.Roles)
                    .SingleOrDefaultAsync(u => u.Id == id);
                if (user is not null)
                {
                    if (user.Status != "승인")
                    {
                        // 승인 취소된 계정은 토큰이 살아 있어도 막는다.
                        context.Response.StatusCode = 403;
                        await context.Response.WriteAsJsonAsync(new { detail = "승인 대기 중인 계정입니다." });
                        return;
                    }
                    context.Items["user"] = user;
                }
            }
        }
        await next(context);
    }
}

public static class RequestUserExtensions
{
    /// <summary>미들웨어가 실어 둔 현재 사용자. 인증 안 됐으면 null.</summary>
    public static AppUser? CurrentUser(this HttpContext context) =>
        context.Items.TryGetValue("user", out var user) ? user as AppUser : null;
}

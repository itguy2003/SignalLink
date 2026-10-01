// 기관구분 관리 — FastAPI /api/v1/org-types 의 짝.
//
// 조회는 로그인한 누구나(기관 등록 폼이 선택지로 쓴다), 추가/수정/삭제는
// 슈퍼관리자만. 이름을 바꾸면 그 구분을 쓰는 기관들의 org_type 문자열도
// 함께 바뀐다 — 사용 중이어도 수정은 되고, 삭제만 막는다.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record OrgTypeOut(int Id, string Name, string Category, string Classifications, int UsageCount);

public class OrgTypeCreateIn
{
    public string Name { get; set; } = "";
    public string Category { get; set; } = "기타";
    /// <summary>분류 선택지 — 쉼표로 구분한 여러 값(예: "초,중,고").</summary>
    public string Classifications { get; set; } = "";
}

public class OrgTypeUpdateIn
{
    public string? Name { get; set; }
    public string? Category { get; set; }
    public string? Classifications { get; set; }
}

[ApiController]
[Route("api/v1/org-types")]
[Authorize]
public class OrgTypesController(AppDbContext db) : ControllerBase
{
    private async Task<OrgTypeOut> ToOut(OrgTypeDef row) => new(
        row.Id, row.Name, row.Category, row.Classifications,
        await db.Organizations.CountAsync(o => o.OrgType == row.Name));

    private ObjectResult? RequireSuperAdmin()
    {
        var actor = HttpContext.CurrentUser()!;
        return PermissionService.IsSuperAdmin(actor)
            ? null
            : StatusCode(403, new { detail = "기관구분을 관리할 권한이 없습니다." });
    }

    [HttpGet("")]
    public async Task<ActionResult<List<OrgTypeOut>>> List()
    {
        var rows = await db.OrgTypes.OrderBy(t => t.Id).ToListAsync();
        var items = new List<OrgTypeOut>();
        foreach (var row in rows) items.Add(await ToOut(row));
        return items;
    }

    [HttpPost("")]
    public async Task<ActionResult<OrgTypeOut>> Create(OrgTypeCreateIn payload)
    {
        if (RequireSuperAdmin() is ObjectResult denied) return denied;
        var name = payload.Name.Trim();
        if (name.Length is 0 or > 20)
            return BadRequest(new { detail = "기관구분 이름은 1~20자여야 합니다." });
        if (!OrgTypeSupport.Categories.Contains(payload.Category))
            return BadRequest(new { detail = "category 는 기관·학교·기타 중 하나여야 합니다." });
        if (await db.OrgTypes.AnyAsync(t => t.Name == name))
            return BadRequest(new { detail = "이미 있는 기관구분 이름입니다." });

        if (OrgTypeSupport.NormalizeClassifications(payload.Classifications) is not string classifications)
            return BadRequest(new { detail = OrgTypeSupport.InvalidClassificationsMessage });

        var now = DateTime.UtcNow;
        var row = new OrgTypeDef
        {
            Name = name, Category = payload.Category, Classifications = classifications,
            CreatedAt = now, UpdatedAt = now,
        };
        db.OrgTypes.Add(row);
        await db.SaveChangesAsync();
        return StatusCode(201, await ToOut(row));
    }

    [HttpPut("{typeId:int}")]
    public async Task<ActionResult<OrgTypeOut>> Update(int typeId, OrgTypeUpdateIn payload)
    {
        if (RequireSuperAdmin() is ObjectResult denied) return denied;
        var row = await db.OrgTypes.FindAsync(typeId);
        if (row is null) return NotFound(new { detail = "기관구분을(를) 찾을 수 없습니다." });

        if (payload.Classifications is string rawClassifications)
        {
            if (OrgTypeSupport.NormalizeClassifications(rawClassifications) is not string normalized)
                return BadRequest(new { detail = OrgTypeSupport.InvalidClassificationsMessage });
            row.Classifications = normalized;
        }

        if (payload.Category is string category)
        {
            if (!OrgTypeSupport.Categories.Contains(category))
                return BadRequest(new { detail = "category 는 기관·학교·기타 중 하나여야 합니다." });
            row.Category = category;
        }

        if (payload.Name is string rawName && rawName.Trim() != row.Name)
        {
            var name = rawName.Trim();
            if (name.Length is 0 or > 20)
                return BadRequest(new { detail = "기관구분 이름은 1~20자여야 합니다." });
            if (await db.OrgTypes.AnyAsync(t => t.Name == name && t.Id != typeId))
                return BadRequest(new { detail = "이미 있는 기관구분 이름입니다." });

            // 사용 중이어도 수정은 된다 — 그 구분을 쓰는 기관들을 함께 옮긴다.
            var oldName = row.Name;
            row.Name = name;
            foreach (var org in await db.Organizations.Where(o => o.OrgType == oldName).ToListAsync())
            {
                org.OrgType = name;
                org.UpdatedAt = DateTime.UtcNow;
            }
        }

        row.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return await ToOut(row);
    }

    [HttpDelete("{typeId:int}")]
    public async Task<ActionResult<Message>> Delete(int typeId)
    {
        if (RequireSuperAdmin() is ObjectResult denied) return denied;
        var row = await db.OrgTypes.FindAsync(typeId);
        if (row is null) return NotFound(new { detail = "기관구분을(를) 찾을 수 없습니다." });

        var used = await db.Organizations.CountAsync(o => o.OrgType == row.Name);
        if (used > 0)
            return BadRequest(new
            {
                detail = $"이 기관구분을 사용하는 기관이 {used}곳 있어 삭제할 수 없습니다.",
            });

        db.OrgTypes.Remove(row);
        await db.SaveChangesAsync();
        return new Message("기관구분이 삭제되었습니다.");
    }
}

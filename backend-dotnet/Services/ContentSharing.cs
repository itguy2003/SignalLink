// 콘텐츠 공유 구분 판정 — FastAPI(services/permissions.py 의 짝).
//
// 콘텐츠의 공유 구분은 관리 범위 **밖의** 사용자에게 콘텐츠를 열어 주는
// 유일한 통로다. 값과 뜻:
//   없음     공유하지 않음(관리 범위 안에서만 보인다) — 기본
//   동일기관  같은 기관 사용자에게
//   소속기관  같은 상위기관 아래 기관들(형제 기관)에게
//   전체     시스템의 모든 사용자에게
//
// 판정 기준 기관은 언제나 "소비하는 쪽"이다 — 목록/브라우저에서는 보는
// 기관, 스케줄 검증에서는 스케줄의 기관. 수정·삭제 권한은 공유와 무관하게
// 기존 규칙(관리 범위 또는 작성자) 그대로다.

using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Data;

namespace SignalLink.Api.Services;

public static class ContentSharing
{
    public static readonly string[] Scopes = ["없음", "동일기관", "소속기관", "전체"];

    public const string InvalidScopeMessage =
        "공유 구분은 없음/동일기관/소속기관/전체 중 하나여야 합니다.";

    /// <summary>같은 상위기관 아래 기관들(자기 포함). 최상위(부모 없음)면 자기뿐이다.</summary>
    public static async Task<HashSet<int>> SiblingOrgIdsAsync(AppDbContext db, int orgId)
    {
        var org = await db.Organizations.FindAsync(orgId);
        if (org?.ParentId is not int parent) return [orgId];
        var ids = await db.Organizations
            .Where(o => o.ParentId == parent).Select(o => o.Id).ToListAsync();
        ids.Add(orgId);
        return [.. ids];
    }

    /// <summary>콘텐츠의 공유 구분이 orgId 기관에 열려 있는가(소유 범위와 무관).</summary>
    public static async Task<bool> SharedWithAsync(AppDbContext db, Content content, int orgId)
    {
        if (content.ShareScope == "전체") return true;
        if (content.ShareScope == "동일기관") return content.OrgId == orgId;
        if (content.ShareScope != "소속기관") return false;
        if (content.OrgId == orgId) return true;
        var owner = await db.Organizations.FindAsync(content.OrgId);
        var viewer = await db.Organizations.FindAsync(orgId);
        return owner?.ParentId is int parent && viewer?.ParentId == parent;
    }
}

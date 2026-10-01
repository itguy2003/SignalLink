// 기관 트리 조회 — FastAPI(app/services/org_tree.py)의 짝.
//
// 권한 판정이 트리를 따라 내려가므로("상위 기관 관리자는 하위 기관도 관리")
// "내 기관 + 모든 하위" 집합이 전 API 에서 반복된다. 기관 수가 많지 않은
// 도메인(교육청-학교 2~3단계)이라 (id, parent_id)만 읽어 메모리에서 돈다.

using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Data;

namespace SignalLink.Api.Services;

public class OrgTreeService(AppDbContext db)
{
    private async Task<(Dictionary<int, List<int>> children, Dictionary<int, int?> parentOf)> EdgesAsync()
    {
        var rows = await db.Organizations
            .Select(o => new { o.Id, o.ParentId }).ToListAsync();
        var children = new Dictionary<int, List<int>>();
        var parentOf = new Dictionary<int, int?>();
        foreach (var row in rows)
        {
            parentOf[row.Id] = row.ParentId;
            if (row.ParentId is int parent)
            {
                if (!children.TryGetValue(parent, out var list))
                    children[parent] = list = [];
                list.Add(row.Id);
            }
        }
        return (children, parentOf);
    }

    /// <summary>orgId 와 그 하위 모든 기관의 id 집합.</summary>
    public async Task<HashSet<int>> DescendantIdsAsync(int orgId, bool includeSelf = true)
    {
        var (children, _) = await EdgesAsync();
        var result = includeSelf ? new HashSet<int> { orgId } : [];
        var stack = new Stack<int>(children.TryGetValue(orgId, out var kids) ? kids : []);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            if (!result.Add(current)) continue;
            if (children.TryGetValue(current, out var more))
                foreach (var child in more) stack.Push(child);
        }
        return result;
    }

    /// <summary>조상을 가까운 순서로.</summary>
    public async Task<List<int>> AncestorIdsAsync(int orgId, bool includeSelf = false)
    {
        var (_, parentOf) = await EdgesAsync();
        var result = includeSelf ? new List<int> { orgId } : [];
        var seen = new HashSet<int> { orgId };
        var current = parentOf.TryGetValue(orgId, out var p) ? p : null;
        while (current is int id && seen.Add(id))
        {
            result.Add(id);
            current = parentOf.TryGetValue(id, out var next) ? next : null;
        }
        return result;
    }

    public async Task<bool> IsDescendantAsync(int ancestor, int node)
    {
        if (ancestor == node) return true;
        return (await AncestorIdsAsync(node)).Contains(ancestor);
    }

    /// <summary>상위 기관 변경이 순환을 만드는가.</summary>
    public async Task<bool> WouldCreateCycleAsync(int orgId, int? newParentId)
    {
        if (newParentId is not int parent) return false;
        if (parent == orgId) return true;
        return await IsDescendantAsync(orgId, parent);
    }

    public async Task<Organization?> GetRootOrgAsync() =>
        await db.Organizations.Where(o => o.ParentId == null)
            .OrderBy(o => o.Id).FirstOrDefaultAsync();
}

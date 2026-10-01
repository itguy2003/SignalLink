// 권한 규칙 — FastAPI(app/services/permissions.py)의 짝, 전체 이식.
//
// 규칙이 두 백엔드에서 다르면 "저쪽에서는 되는데 이쪽에서는 안 되는" 구멍이
// 생긴다. 함수 이름과 판정을 파이썬 쪽과 1:1 로 맞춘다.
//
//   SUPER_ADMIN        모든 기관/사용자/장치
//   ORG_ADMIN          자기 기관 + 모든 하위 기관
//   DEVICE_MANAGER     위임된 장치만
//   HOMEROOM_TEACHER   자기 기관 장치 조회 + 위임 장치 관리
//   MEMBER             기본. 본인 정보만.
//   COMMUNITY_USER     커뮤니티만. 관리 화면에는 들어오지 못한다.

using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Data;

namespace SignalLink.Api.Services;

public static class Roles
{
    public const string SuperAdmin = "SUPER_ADMIN";
    public const string OrgAdmin = "ORG_ADMIN";
    public const string DeviceManager = "DEVICE_MANAGER";
    public const string HomeroomTeacher = "HOMEROOM_TEACHER";
    public const string Member = "MEMBER";

    public static readonly string[] All =
        [SuperAdmin, OrgAdmin, DeviceManager, HomeroomTeacher, Member];

    /// <summary>중복 제거 + 유효성 검사. MEMBER 는 항상 포함된다. 잘못된 역할이면 null.</summary>
    public static List<string>? EnsureUnique(IEnumerable<string> roles, out string? invalid)
    {
        invalid = null;
        var result = new SortedSet<string>(StringComparer.Ordinal) { Member };
        foreach (var role in roles)
        {
            if (!All.Contains(role)) { invalid = role; return null; }
            result.Add(role);
        }
        return result.ToList();
    }
}

public class PermissionService(AppDbContext db, OrgTreeService orgTree)
{
    public static bool IsSuperAdmin(AppUser user) => Has(user, Roles.SuperAdmin);
    public static bool IsOrgAdmin(AppUser user) => Has(user, Roles.OrgAdmin);

    private static bool Has(AppUser user, string role) =>
        user.Roles.Any(r => r.Role == role);

    /// <summary>커뮤니티 — 모든 승인 사용자의 공간(2026-10 개편: COMMUNITY_USER
    /// 역할 제거). 게시 승인·설정만 관리자의 일로 남는다(CanPublishAsync).</summary>
    public static bool CanUseCommunity(AppUser user) => true;

    /// <summary>커뮤니티 콘텐츠·재생목록 — 관리자의 운영 화면.</summary>
    public static bool CanManageCommunity(AppUser user) =>
        IsSuperAdmin(user) || IsOrgAdmin(user);

    public static bool CanShareInCommunity(AppUser user) => CanUseCommunity(user);

    /// <summary>공유한 것을 지울 수 있는가 — 본인과 관리자만.</summary>
    public static bool CanRemoveShared(AppUser user, int? uploadedBy) =>
        IsSuperAdmin(user) || IsOrgAdmin(user)
        || (uploadedBy is not null && uploadedBy == user.Id);

    /// <summary>이 기관이 속한 커뮤니티(첫 상위 '기관' 분류)의 id. 없으면 null.
    /// 기관구분은 이름이 아니라 category 로 판정한다 — 이름은 관리자가 바꾼다.</summary>
    public async Task<int?> CommunityOrgOfAsync(int orgId)
    {
        var ownerTypes = await OrgTypeSupport.NamesOfCategoryAsync(db, "기관");
        var seen = new HashSet<int>();
        var current = await db.Organizations.FindAsync(orgId);
        while (current is not null && seen.Add(current.Id))
        {
            if (ownerTypes.Contains(current.OrgType)) return current.Id;
            current = current.ParentId is int parent
                ? await db.Organizations.FindAsync(parent)
                : null;
        }
        return null;
    }

    /// <summary>관리 가능한 기관 id 집합. null 은 '전체'(SUPER_ADMIN).</summary>
    public async Task<HashSet<int>?> ManagedOrgIdsAsync(AppUser user)
    {
        if (IsSuperAdmin(user)) return null;
        if (IsOrgAdmin(user)) return await orgTree.DescendantIdsAsync(user.OrgId);
        return [user.OrgId];
    }

    public async Task<bool> CanViewOrgAsync(AppUser user, int orgId)
    {
        var scope = await ManagedOrgIdsAsync(user);
        return scope is null || scope.Contains(orgId);
    }

    public async Task<bool> CanManageOrgAsync(AppUser user, int orgId)
    {
        if (IsSuperAdmin(user)) return true;
        if (!IsOrgAdmin(user)) return false;
        return (await orgTree.DescendantIdsAsync(user.OrgId)).Contains(orgId);
    }

    /// <summary>최상위 기관 생성은 SUPER_ADMIN 만. ORG_ADMIN 은 제 서브트리 아래만.</summary>
    public async Task<bool> CanCreateOrgAsync(AppUser user, int? parentId)
    {
        if (IsSuperAdmin(user)) return true;
        if (!IsOrgAdmin(user) || parentId is not int parent) return false;
        return (await orgTree.DescendantIdsAsync(user.OrgId)).Contains(parent);
    }

    public async Task<bool> CanApproveUserAsync(AppUser actor, AppUser target)
    {
        if (IsSuperAdmin(actor)) return true;
        if (!IsOrgAdmin(actor)) return false;
        if (actor.Id == target.Id) return false;  // 자기 자신은 승인 못 한다.
        return (await orgTree.DescendantIdsAsync(actor.OrgId)).Contains(target.OrgId);
    }

    public async Task<bool> CanManageUserAsync(AppUser actor, AppUser target)
    {
        if (actor.Id == target.Id) return true;
        return await CanApproveUserAsync(actor, target);
    }

    /// <summary>SUPER_ADMIN 역할은 SUPER_ADMIN 만 부여한다.</summary>
    public static bool CanGrantRole(AppUser actor, string role)
    {
        if (IsSuperAdmin(actor)) return true;
        if (!IsOrgAdmin(actor)) return false;
        return role != Roles.SuperAdmin;
    }

    public async Task<HashSet<int>> DelegatedDeviceIdsAsync(AppUser user) =>
        (await db.DeviceManagers.Where(m => m.UserId == user.Id)
            .Select(m => m.DeviceId).ToListAsync()).ToHashSet();

    public async Task<bool> CanViewDeviceAsync(AppUser user, Device device)
    {
        if (IsSuperAdmin(user)) return true;
        if (IsOrgAdmin(user)
            && (await orgTree.DescendantIdsAsync(user.OrgId)).Contains(device.OrgId))
            return true;
        if (device.OrgId == user.OrgId && Has(user, Roles.HomeroomTeacher)) return true;
        return (await DelegatedDeviceIdsAsync(user)).Contains(device.Id);
    }

    public async Task<bool> CanManageDeviceAsync(AppUser user, Device device)
    {
        if (IsSuperAdmin(user)) return true;
        if (IsOrgAdmin(user)
            && (await orgTree.DescendantIdsAsync(user.OrgId)).Contains(device.OrgId))
            return true;
        return (await DelegatedDeviceIdsAsync(user)).Contains(device.Id);
    }

    /// <summary>장치 등록/삭제는 기관관리자·슈퍼관리자만.</summary>
    public Task<bool> CanCreateDeviceAsync(AppUser user, int orgId) =>
        CanManageOrgAsync(user, orgId);

    public Task<bool> CanDeleteDeviceAsync(AppUser user, Device device) =>
        CanCreateDeviceAsync(user, device.OrgId);

    /// <summary>게시 결과 — 커뮤니티 소유 기관을 관리하는 관리자만.</summary>
    public async Task<bool> CanPublishAsync(AppUser user, int orgId)
    {
        if (IsSuperAdmin(user)) return true;
        return IsOrgAdmin(user) && await CanManageOrgAsync(user, orgId);
    }
}

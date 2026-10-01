// 기관 관리 — FastAPI /api/v1/organizations 의 짝(전체 이식).
//
//   최상위 기관 생성/삭제: SUPER_ADMIN
//   하위 기관 등록/수정:   SUPER_ADMIN, 또는 해당 서브트리의 ORG_ADMIN
//   조회:                  자기 기관 및 하위 기관

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Contracts;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Controllers;

public record OrganizationOut(
    int Id, string Name, string? Address, string OrgType, string? SchoolLevel,
    double? Latitude, double? Longitude, string? EduOfficeCode, string? SchoolCode,
    string? EduOfficeName, string? SidoName, string? JurisdictionName,
    string? AddressDetail, string? Phone, string? Homepage,
    int? ParentId)
{
    public static OrganizationOut From(Organization org) => new(
        org.Id, org.Name, org.Address, org.OrgType, org.SchoolLevel,
        org.Latitude, org.Longitude, org.EduOfficeCode, org.SchoolCode,
        org.EduOfficeName, org.SidoName, org.JurisdictionName,
        org.AddressDetail, org.Phone, org.Homepage, org.ParentId);
}

public record OrganizationPublic(int Id, string Name, int? ParentId);

public class OrganizationNode(Organization org)
{
    public int Id { get; } = org.Id;
    public string Name { get; } = org.Name;
    public string? Address { get; } = org.Address;
    public string OrgType { get; } = org.OrgType;
    public string? SchoolLevel { get; } = org.SchoolLevel;
    public double? Latitude { get; } = org.Latitude;
    public double? Longitude { get; } = org.Longitude;
    public string? EduOfficeCode { get; } = org.EduOfficeCode;
    public string? SchoolCode { get; } = org.SchoolCode;
    public string? EduOfficeName { get; } = org.EduOfficeName;
    public string? SidoName { get; } = org.SidoName;
    public string? JurisdictionName { get; } = org.JurisdictionName;
    public string? AddressDetail { get; } = org.AddressDetail;
    public string? Phone { get; } = org.Phone;
    public string? Homepage { get; } = org.Homepage;
    public int? ParentId { get; } = org.ParentId;
    public List<OrganizationNode> Children { get; } = [];
}

public class OrganizationCreate
{
    public string Name { get; set; } = "";
    public string? Address { get; set; }
    public string OrgType { get; set; } = "기관";
    public string? SchoolLevel { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public string? EduOfficeCode { get; set; }
    public string? SchoolCode { get; set; }
    public string? EduOfficeName { get; set; }
    public string? SidoName { get; set; }
    public string? JurisdictionName { get; set; }
    public string? AddressDetail { get; set; }
    public string? Phone { get; set; }
    public string? Homepage { get; set; }
    public int? ParentId { get; set; }
}

/// <summary>일괄 삭제 대상 — Ids 를 주면 그 기관들, 아니면 검색 조건으로 고른다.</summary>
public class OrganizationBulkDelete
{
    public List<int>? Ids { get; set; }
    public string? Q { get; set; }
    /// <summary>기관구분 분류(기관/학교/기타) — 이름이 아니라 분류로 거른다.</summary>
    public string? Category { get; set; }
    public int? ParentId { get; set; }
}

public record BulkDeleteResult(int Deleted, int Skipped, List<string> Errors);

/// <summary>부분 갱신 — 안 보낸 필드는 건드리지 않는다(파이썬 exclude_unset 의 짝).</summary>
public class OrganizationUpdate
{
    public string? Name { get; set; }
    public string? Address { get; set; }
    public string? OrgType { get; set; }
    public string? SchoolLevel { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public string? EduOfficeCode { get; set; }
    public string? SchoolCode { get; set; }
    public string? EduOfficeName { get; set; }
    public string? SidoName { get; set; }
    public string? JurisdictionName { get; set; }
    public string? AddressDetail { get; set; }
    public string? Phone { get; set; }
    public string? Homepage { get; set; }

    // JSON 에 필드가 있었는지(null 로 온 것과 안 온 것을 가른다).
    public bool ParentIdSet { get; private set; }
    private int? _parentId;
    public int? ParentId { get => _parentId; set { _parentId = value; ParentIdSet = true; } }
}

[ApiController]
[Route("api/v1/organizations")]
[Authorize]
public class OrganizationsController(
    AppDbContext db, PermissionService permissions, OrgTreeService orgTree,
    AssetService assetService) : ControllerBase
{
    /// <summary>기관이 소유한 CMS 자료를 함께 지운다 — 스케줄·재생목록·콘텐츠·자산.
    ///
    /// 이들이 RESTRICT FK 로 기관 삭제를 막아 "학교가 지워지지 않는" 문제가
    /// 됐었다. 하위 행(아이템·연결)은 DB 캐스케이드가 정리하고, 다른 기관의
    /// 스케줄이 참조하던 콘텐츠는 SET NULL 로 풀린다. 자산은 파일까지 지운다.</summary>
    private async Task PurgeOrgDataAsync(int orgId)
    {
        db.Schedules.RemoveRange(await db.Schedules.Where(s => s.OrgId == orgId).ToListAsync());
        db.Playlists.RemoveRange(await db.Playlists.Where(p => p.OrgId == orgId).ToListAsync());
        db.Contents.RemoveRange(await db.Contents.Where(c => c.OrgId == orgId).ToListAsync());
        var orgAssets = await db.Assets.Where(a => a.OrgId == orgId).ToListAsync();
        foreach (var asset in orgAssets) assetService.RemoveFile(asset);
        db.Assets.RemoveRange(orgAssets);
    }

    /// <summary>회원가입 화면용 — 인증 없이 이름과 id 만 노출한다.</summary>
    [HttpGet("public")]
    [AllowAnonymous]
    public async Task<ActionResult<List<OrganizationPublic>>> PublicList(
        [FromQuery] string? q, [FromQuery] string? category, [FromQuery] int limit = 500)
    {
        limit = Math.Clamp(limit, 1, 500);
        var query = db.Organizations.AsQueryable();
        if (!string.IsNullOrEmpty(q))
            query = query.Where(o => EF.Functions.Like(o.Name, $"%{q}%"));
        if (!string.IsNullOrEmpty(category))
        {
            // 커뮤니티 가입 화면이 '기관' 분류만 받는 데 쓴다. 이름이 아니라
            // 분류로 거른다 — 이름은 관리자가 바꾼다.
            var names = await OrgTypeSupport.NamesOfCategoryAsync(db, category);
            query = query.Where(o => names.Contains(o.OrgType));
        }
        var rows = await query.OrderBy(o => o.Name).Take(limit).ToListAsync();
        return rows.Select(o => new OrganizationPublic(o.Id, o.Name, o.ParentId)).ToList();
    }

    [HttpGet("")]
    public async Task<ActionResult<List<OrganizationOut>>> List(
        [FromQuery] string? q,
        [FromQuery(Name = "parent_id")] int? parentId,
        [FromQuery] int? limit)
    {
        var user = HttpContext.CurrentUser()!;
        var query = db.Organizations.AsQueryable();
        var scope = await permissions.ManagedOrgIdsAsync(user);
        if (scope is not null) query = query.Where(o => scope.Contains(o.Id));
        if (!string.IsNullOrEmpty(q))
            query = query.Where(o => EF.Functions.Like(o.Name, $"%{q}%"));
        if (parentId is not null) query = query.Where(o => o.ParentId == parentId);
        query = query.OrderBy(o => o.Name);
        if (limit is int cap) query = query.Take(Math.Clamp(cap, 1, 1000));
        return (await query.ToListAsync()).Select(OrganizationOut.From).ToList();
    }

    /// <summary>페이지 목록 — 학교 정보 관리처럼 수천 건이 될 수 있는 화면용.
    /// category 는 기관구분 마스터의 **분류**(기관/학교/기타)로 거른다 —
    /// 이름이 아니라 분류로 판정해야 관리자가 구분 이름을 바꿔도 계속 맞는다.</summary>
    [HttpGet("paged")]
    public async Task<ActionResult<PageOut<OrganizationOut>>> Paged(
        [FromQuery] string? q,
        [FromQuery(Name = "parent_id")] int? parentId,
        [FromQuery] string? category,
        [FromQuery] int page = 1,
        [FromQuery] int size = 20)
    {
        var user = HttpContext.CurrentUser()!;
        var query = db.Organizations.AsQueryable();
        var scope = await permissions.ManagedOrgIdsAsync(user);
        if (scope is not null) query = query.Where(o => scope.Contains(o.Id));
        if (!string.IsNullOrEmpty(q))
            query = query.Where(o => EF.Functions.Like(o.Name, $"%{q}%"));
        if (parentId is not null) query = query.Where(o => o.ParentId == parentId);
        if (!string.IsNullOrEmpty(category))
        {
            var names = await OrgTypeSupport.NamesOfCategoryAsync(db, category);
            query = query.Where(o => names.Contains(o.OrgType));
        }
        page = Math.Max(page, 1);
        size = Math.Clamp(size, 1, 200);
        var total = await query.CountAsync();
        var rows = await query.OrderBy(o => o.Name)
            .Skip((page - 1) * size).Take(size).ToListAsync();
        return new PageOut<OrganizationOut>(
            rows.Select(OrganizationOut.From).ToList(), total, page, size);
    }

    [HttpGet("tree")]
    public async Task<ActionResult<List<OrganizationNode>>> Tree()
    {
        var user = HttpContext.CurrentUser()!;
        var scope = await permissions.ManagedOrgIdsAsync(user);
        var orgs = await db.Organizations.OrderBy(o => o.Name).ToListAsync();
        if (scope is not null) orgs = orgs.Where(o => scope.Contains(o.Id)).ToList();

        var nodes = orgs.ToDictionary(o => o.Id, o => new OrganizationNode(o));
        var roots = new List<OrganizationNode>();
        foreach (var org in orgs)
        {
            var node = nodes[org.Id];
            // 상위 기관이 조회 범위 밖이면 이 노드가 트리의 뿌리가 된다.
            if (org.ParentId is int parent && nodes.TryGetValue(parent, out var parentNode))
                parentNode.Children.Add(node);
            else
                roots.Add(node);
        }
        return roots;
    }

    [HttpGet("{orgId:int}")]
    public async Task<ActionResult<OrganizationOut>> Get(int orgId)
    {
        var user = HttpContext.CurrentUser()!;
        var org = await db.Organizations.FindAsync(orgId);
        if (org is null) return NotFound(new { detail = "기관을(를) 찾을 수 없습니다." });
        if (!await permissions.CanViewOrgAsync(user, orgId))
            return StatusCode(403, new { detail = "해당 기관을 조회할 권한이 없습니다." });
        return OrganizationOut.From(org);
    }

    [HttpPost("")]
    public async Task<ActionResult<OrganizationOut>> Create(OrganizationCreate payload)
    {
        var user = HttpContext.CurrentUser()!;
        if (!await permissions.CanCreateOrgAsync(user, payload.ParentId))
            return StatusCode(403, new { detail = "기관을 등록할 권한이 없습니다." });

        if (payload.ParentId is null)
        {
            if (await orgTree.GetRootOrgAsync() is not null)
                return BadRequest(new { detail = "최상위 기관은 이미 존재합니다. 상위 기관을 지정하세요." });
        }
        else if (await db.Organizations.FindAsync(payload.ParentId) is null)
        {
            return BadRequest(new { detail = "존재하지 않는 상위 기관입니다." });
        }

        // 기관구분은 마스터(org_type 테이블)에 있어야 한다.
        if (!(await OrgTypeSupport.AllNamesAsync(db)).Contains(payload.OrgType))
            return BadRequest(new { detail = $"알 수 없는 기관구분입니다: {payload.OrgType}" });
        // 분류(school_level)는 그 구분이 정한 선택지 안에서만 고른다.
        if (payload.SchoolLevel is string level
            && !(await OrgTypeSupport.ClassificationsOfAsync(db, payload.OrgType)).Contains(level))
            return BadRequest(new { detail = $"이 기관구분에서 고를 수 없는 분류입니다: {level}" });

        var now = DateTime.UtcNow;
        var org = new Organization
        {
            Name = payload.Name,
            Address = payload.Address,
            OrgType = payload.OrgType,
            SchoolLevel = payload.SchoolLevel,
            Latitude = payload.Latitude,
            Longitude = payload.Longitude,
            EduOfficeCode = payload.EduOfficeCode,
            SchoolCode = payload.SchoolCode,
            EduOfficeName = payload.EduOfficeName,
            SidoName = payload.SidoName,
            JurisdictionName = payload.JurisdictionName,
            AddressDetail = payload.AddressDetail,
            Phone = payload.Phone,
            Homepage = payload.Homepage,
            ParentId = payload.ParentId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Organizations.Add(org);
        await db.SaveChangesAsync();
        return StatusCode(201, OrganizationOut.From(org));
    }

    [HttpPut("{orgId:int}")]
    public async Task<ActionResult<OrganizationOut>> Update(int orgId, OrganizationUpdate payload)
    {
        var user = HttpContext.CurrentUser()!;
        var org = await db.Organizations.FindAsync(orgId);
        if (org is null) return NotFound(new { detail = "기관을(를) 찾을 수 없습니다." });
        if (!await permissions.CanManageOrgAsync(user, orgId))
            return StatusCode(403, new { detail = "해당 기관을 수정할 권한이 없습니다." });

        if (payload.ParentIdSet)
        {
            var newParent = payload.ParentId;
            if (org.ParentId is null && newParent is not null)
                return BadRequest(new { detail = "최상위 기관은 하위로 이동할 수 없습니다." });
            if (newParent is int parent)
            {
                if (await db.Organizations.FindAsync(parent) is null)
                    return BadRequest(new { detail = "존재하지 않는 상위 기관입니다." });
                if (await orgTree.WouldCreateCycleAsync(orgId, parent))
                    return BadRequest(new { detail = "상위 기관 변경이 순환 구조를 만듭니다." });
                if (!await permissions.CanCreateOrgAsync(user, parent))
                    return StatusCode(403, new { detail = "지정한 상위 기관 아래로 옮길 권한이 없습니다." });
            }
            org.ParentId = newParent;
        }

        if (payload.Name is not null) org.Name = payload.Name;
        if (payload.Address is not null) org.Address = payload.Address;
        if (payload.OrgType is not null)
        {
            if (!(await OrgTypeSupport.AllNamesAsync(db)).Contains(payload.OrgType))
                return BadRequest(new { detail = $"알 수 없는 기관구분입니다: {payload.OrgType}" });
            org.OrgType = payload.OrgType;
        }
        if (payload.SchoolLevel is not null)
        {
            // 분류는 그 구분의 선택지 안에서만. 빈 문자열은 '분류 없음'으로 지운다.
            var allowedLevels = await OrgTypeSupport.ClassificationsOfAsync(db, org.OrgType);
            if (payload.SchoolLevel.Length > 0 && !allowedLevels.Contains(payload.SchoolLevel))
                return BadRequest(new { detail = $"이 기관구분에서 고를 수 없는 분류입니다: {payload.SchoolLevel}" });
            org.SchoolLevel = payload.SchoolLevel.Length > 0 ? payload.SchoolLevel : null;
        }
        if (payload.Latitude is not null) org.Latitude = payload.Latitude;
        if (payload.Longitude is not null) org.Longitude = payload.Longitude;
        if (payload.EduOfficeCode is not null) org.EduOfficeCode = payload.EduOfficeCode;
        if (payload.SchoolCode is not null) org.SchoolCode = payload.SchoolCode;
        if (payload.EduOfficeName is not null) org.EduOfficeName = payload.EduOfficeName;
        if (payload.SidoName is not null) org.SidoName = payload.SidoName;
        if (payload.JurisdictionName is not null) org.JurisdictionName = payload.JurisdictionName;
        if (payload.AddressDetail is not null) org.AddressDetail = payload.AddressDetail;
        if (payload.Phone is not null) org.Phone = payload.Phone;
        if (payload.Homepage is not null) org.Homepage = payload.Homepage;
        org.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return OrganizationOut.From(org);
    }

    /// <summary>기관 일괄 삭제 — 학교 정보 관리처럼 수천 건을 한 번에 정리하는 화면용.
    ///
    /// 단건 삭제와 같은 규칙을 기관마다 적용한다: 최상위 불가, 권한 범위 안,
    /// 하위 기관/사용자/장치가 남아 있으면 그 기관만 건너뛴다. 건너뛴 이유는
    /// 사유별 건수로 알린다 — 수천 건을 이름으로 나열하면 아무도 안 읽는다.</summary>
    [HttpPost("bulk-delete")]
    public async Task<ActionResult<BulkDeleteResult>> BulkDelete(OrganizationBulkDelete payload)
    {
        var user = HttpContext.CurrentUser()!;
        var hasFilter = !string.IsNullOrEmpty(payload.Q)
            || !string.IsNullOrEmpty(payload.Category) || payload.ParentId is not null;
        if ((payload.Ids is null || payload.Ids.Count == 0) && !hasFilter)
        {
            // 조건 없는 요청은 '전부 삭제'가 된다 — 실수를 여기서 막는다.
            return BadRequest(new { detail = "삭제할 대상을 지정하세요 (ids 또는 검색 조건)." });
        }

        var query = db.Organizations.AsQueryable();
        if (payload.Ids is { Count: > 0 } ids)
        {
            query = query.Where(o => ids.Contains(o.Id));
        }
        else
        {
            if (!string.IsNullOrEmpty(payload.Q))
                query = query.Where(o => EF.Functions.Like(o.Name, $"%{payload.Q}%"));
            if (payload.ParentId is not null)
                query = query.Where(o => o.ParentId == payload.ParentId);
            if (!string.IsNullOrEmpty(payload.Category))
            {
                var names = await OrgTypeSupport.NamesOfCategoryAsync(db, payload.Category);
                query = query.Where(o => names.Contains(o.OrgType));
            }
        }
        var candidates = await query.ToListAsync();

        var scope = await permissions.ManagedOrgIdsAsync(user);
        var candidateIds = candidates.Select(o => o.Id).ToHashSet();
        var withChildren = (await db.Organizations
            .Where(o => o.ParentId != null && candidateIds.Contains(o.ParentId.Value))
            .Select(o => o.ParentId!.Value).Distinct().ToListAsync()).ToHashSet();
        var withUsers = (await db.Users.Where(u => candidateIds.Contains(u.OrgId))
            .Select(u => u.OrgId).Distinct().ToListAsync()).ToHashSet();
        var withDevices = (await db.Devices.Where(d => candidateIds.Contains(d.OrgId))
            .Select(d => d.OrgId).Distinct().ToListAsync()).ToHashSet();

        var reasons = new Dictionary<string, int>
        {
            ["root"] = 0, ["denied"] = 0, ["children"] = 0,
            ["users"] = 0, ["devices"] = 0, ["fk"] = 0,
        };
        var eligible = new List<Organization>();
        foreach (var org in candidates)
        {
            if (org.ParentId is null) reasons["root"]++;
            else if (scope is not null && !scope.Contains(org.Id)) reasons["denied"]++;
            else if (withChildren.Contains(org.Id)) reasons["children"]++;
            else if (withUsers.Contains(org.Id)) reasons["users"]++;
            else if (withDevices.Contains(org.Id)) reasons["devices"]++;
            else eligible.Add(org);
        }

        // 소유 CMS 자료(스케줄·재생목록·콘텐츠·자산)는 함께 지우고 한 번에
        // 저장한다. 그래도 남는 FK(예상 밖의 참조)가 막으면 한 건씩 다시
        // 지워 막힌 기관만 건너뛴다.
        var deleted = 0;
        foreach (var org in eligible) await PurgeOrgDataAsync(org.Id);
        db.Organizations.RemoveRange(eligible);
        try
        {
            await db.SaveChangesAsync();
            deleted = eligible.Count;
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            foreach (var org in eligible)
            {
                try
                {
                    await PurgeOrgDataAsync(org.Id);
                    db.Organizations.Remove(org);
                    await db.SaveChangesAsync();
                    deleted++;
                }
                catch (DbUpdateException)
                {
                    reasons["fk"]++;
                    db.ChangeTracker.Clear();
                }
            }
        }

        var labels = new Dictionary<string, string>
        {
            ["root"] = "최상위 기관",
            ["denied"] = "권한이 없는 기관",
            ["children"] = "하위 기관이 있는 기관",
            ["users"] = "소속 사용자가 있는 기관",
            ["devices"] = "소속 장치가 있는 기관",
            ["fk"] = "다른 데이터가 남아 있는 기관",
        };
        var errors = reasons.Where(r => r.Value > 0)
            .Select(r => $"{labels[r.Key]} {r.Value}건은 건너뛰었습니다.").ToList();
        if (payload.Ids is { Count: > 0 } requested && candidateIds.Count < requested.Distinct().Count())
            errors.Add($"찾을 수 없는 기관 {requested.Distinct().Count() - candidateIds.Count}건.");
        return new BulkDeleteResult(deleted, candidates.Count - deleted, errors);
    }

    [HttpDelete("{orgId:int}")]
    public async Task<ActionResult<Message>> Delete(int orgId)
    {
        var user = HttpContext.CurrentUser()!;
        var org = await db.Organizations.FindAsync(orgId);
        if (org is null) return NotFound(new { detail = "기관을(를) 찾을 수 없습니다." });
        if (org.ParentId is null)
            return BadRequest(new { detail = "최상위 기관은 삭제할 수 없습니다." });
        if (!await permissions.CanManageOrgAsync(user, orgId))
            return StatusCode(403, new { detail = "해당 기관을 삭제할 권한이 없습니다." });

        // 하위/사용자/장치가 남아 있으면 FK RESTRICT 로 DB 오류가 나므로 미리 막는다.
        var childCount = await db.Organizations.CountAsync(o => o.ParentId == orgId);
        if (childCount > 0)
            return BadRequest(new { detail = $"소속기관이 {childCount}건 있어 삭제할 수 없습니다." });
        var userCount = await db.Users.CountAsync(u => u.OrgId == orgId);
        if (userCount > 0)
            return BadRequest(new { detail = $"소속 사용자가 {userCount}명 있어 삭제할 수 없습니다." });
        var deviceCount = await db.Devices.CountAsync(d => d.OrgId == orgId);
        if (deviceCount > 0)
            return BadRequest(new { detail = $"소속 장치가 {deviceCount}대 있어 삭제할 수 없습니다." });

        await PurgeOrgDataAsync(orgId);
        db.Organizations.Remove(org);
        await db.SaveChangesAsync();
        return new Message("기관이 삭제되었습니다.");
    }

    /// <summary>엑셀 일괄 등록. 헤더: 기관명, 주소, 기관타입, 학교단위, 위도, 경도, 시도교육청코드, 학교코드.</summary>
    [HttpPost("bulk-upload")]
    public async Task<ActionResult<BulkResult>> BulkUpload(
        IFormFile file,
        [FromQuery(Name = "parent_id")] int parentId,
        [FromQuery(Name = "default_org_type")] string? defaultOrgType = null,
        [FromForm(Name = "coords_file")] IFormFile? coordsFile = null)
    {
        var user = HttpContext.CurrentUser()!;
        if (!await permissions.CanCreateOrgAsync(user, parentId))
            return StatusCode(403, new { detail = "해당 상위 기관 아래에 기관을 등록할 권한이 없습니다." });
        if (await db.Organizations.FindAsync(parentId) is null)
            return BadRequest(new { detail = "존재하지 않는 상위 기관입니다." });
        var allowedTypes = await OrgTypeSupport.AllNamesAsync(db);
        if (defaultOrgType is not null && !allowedTypes.Contains(defaultOrgType))
            return BadRequest(new { detail = "default_org_type 은 기관·학교·기타 중 하나여야 합니다." });

        // 형식은 파일 이름으로 가른다 — CSV 를 zip 파서에 넣으면 알 수 없는 오류만 나온다.
        static async Task<byte[]> ReadAll(IFormFile source)
        {
            using var stream = new MemoryStream();
            await source.CopyToAsync(stream);
            return stream.ToArray();
        }
        (List<Organization> rows, List<string> errors) Parse(string name, byte[] data) =>
            name.ToLowerInvariant().EndsWith(".csv")
                ? ExcelImport.ParseOrganizationCsv(data, defaultOrgType, allowedTypes)
                : ExcelImport.ParseOrganizationWorkbook(data, defaultOrgType, allowedTypes);

        var (rows, errors) = Parse(file.FileName ?? "", await ReadAll(file));

        // 학교 정보와 좌표가 다른 파일로 오면 서버가 합친다(코드 우선, 이름 차선).
        if (coordsFile is not null)
        {
            var (extraRows, extraErrors) = Parse(coordsFile.FileName ?? "", await ReadAll(coordsFile));
            errors.AddRange(extraErrors);
            errors.AddRange(ExcelImport.MergeSupplement(rows, extraRows));
        }

        var result = new BulkResult { Errors = errors };
        var now = DateTime.UtcNow;

        // --- 기관 트리 구성: 시도교육청(최상위 바로 아래) → 교육지원청(관할조직명)
        //     → 학교. 같은 이름이 이미 있으면 만들지 않고 그 기관을 쓴다.
        var root = await db.Organizations.FirstAsync(o => o.ParentId == null);
        var canCreateUnderRoot = await permissions.CanCreateOrgAsync(user, root.Id);
        var orgByName = new Dictionary<string, Organization>();

        async Task<Organization?> FindByNameAsync(string name, int preferParent)
        {
            if (orgByName.TryGetValue(name, out var cached)) return cached;
            var matches = await db.Organizations.Where(o => o.Name == name).ToListAsync();
            var found = matches.FirstOrDefault(o => o.ParentId == preferParent)
                ?? matches.FirstOrDefault();
            if (found is not null) orgByName[name] = found;
            return found;
        }

        async Task<Organization> EnsureOrgAsync(string name, int parentOrgId, Organization row)
        {
            var org = new Organization
            {
                Name = name,
                OrgType = root.OrgType,
                ParentId = parentOrgId,
                EduOfficeCode = row.EduOfficeCode,
                EduOfficeName = row.EduOfficeName,
                SidoName = row.SidoName,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Organizations.Add(org);
            // 하위를 붙이려면 id 가 필요하다 — 교육청·지원청은 몇십 건뿐이라 바로 저장.
            await db.SaveChangesAsync();
            orgByName[name] = org;
            return org;
        }

        // 같은 파일 안의 중복(같은 학교가 두 줄)도 '변경'으로 잡히도록,
        // 이번에 만든 학교를 이름/코드로 기억해 둔다.
        var pendingByName = new Dictionary<string, Organization>();
        var pendingByCode = new Dictionary<(string, string), Organization>();

        foreach (var row in rows)
        {
            var targetParent = parentId;
            if (!string.IsNullOrEmpty(row.EduOfficeName))
            {
                var office = await FindByNameAsync(row.EduOfficeName, root.Id);
                if (office is null)
                {
                    if (!canCreateUnderRoot)
                    {
                        result.Errors.Add(
                            $"'{row.EduOfficeName}' 기관을 최상위 아래에 만들 권한이 없습니다.");
                        result.Skipped++;
                        continue;
                    }
                    office = await EnsureOrgAsync(row.EduOfficeName, root.Id, row);
                }
                targetParent = office.Id;

                if (!string.IsNullOrEmpty(row.JurisdictionName)
                    && row.JurisdictionName != row.EduOfficeName)
                {
                    var jurisdiction = await FindByNameAsync(row.JurisdictionName, office.Id)
                        ?? await EnsureOrgAsync(row.JurisdictionName, office.Id, row);
                    targetParent = jurisdiction.Id;
                }
            }

            // 같은 학교(코드 우선, 이름 차선)가 있으면 만들지 않고 **변경**한다.
            Organization? existing = null;
            if (row.SchoolCode is not null && row.EduOfficeCode is not null)
            {
                if (!pendingByCode.TryGetValue((row.EduOfficeCode, row.SchoolCode), out existing))
                    existing = await db.Organizations.FirstOrDefaultAsync(o =>
                        o.EduOfficeCode == row.EduOfficeCode && o.SchoolCode == row.SchoolCode);
            }
            if (existing is null && !pendingByName.TryGetValue(row.Name, out existing))
                existing = await db.Organizations.FirstOrDefaultAsync(o =>
                    o.Name == row.Name && o.ParentId != null);

            if (existing is not null)
            {
                ApplyRow(existing, row);
                existing.ParentId = targetParent;
                existing.UpdatedAt = now;
                result.Updated++;
            }
            else
            {
                row.ParentId = targetParent;
                row.CreatedAt = now;
                row.UpdatedAt = now;
                db.Organizations.Add(row);
                existing = row;
                result.Created++;
            }
            pendingByName[existing.Name] = existing;
            if (existing.EduOfficeCode is not null && existing.SchoolCode is not null)
                pendingByCode[(existing.EduOfficeCode, existing.SchoolCode)] = existing;
        }
        await db.SaveChangesAsync();
        return result;
    }

    /// <summary>파일 행의 값(비어 있지 않은 것만)을 기존 기관에 옮겨 적는다.</summary>
    private static void ApplyRow(Organization target, Organization row)
    {
        target.Name = row.Name;
        target.OrgType = row.OrgType;
        if (row.Address is not null) target.Address = row.Address;
        if (row.SchoolLevel is not null) target.SchoolLevel = row.SchoolLevel;
        if (row.Latitude is not null) target.Latitude = row.Latitude;
        if (row.Longitude is not null) target.Longitude = row.Longitude;
        if (row.EduOfficeCode is not null) target.EduOfficeCode = row.EduOfficeCode;
        if (row.SchoolCode is not null) target.SchoolCode = row.SchoolCode;
        if (row.EduOfficeName is not null) target.EduOfficeName = row.EduOfficeName;
        if (row.SidoName is not null) target.SidoName = row.SidoName;
        if (row.JurisdictionName is not null) target.JurisdictionName = row.JurisdictionName;
        if (row.AddressDetail is not null) target.AddressDetail = row.AddressDetail;
        if (row.Phone is not null) target.Phone = row.Phone;
        if (row.Homepage is not null) target.Homepage = row.Homepage;
    }
}

// 기관구분 마스터 지원 — FastAPI(app/services/org_types.py)의 짝.
//
// 기관구분은 이제 고정 3종이 아니라 관리자가 관리하는 데이터다. 이름은
// 표시·저장용이고(기관 org_type 문자열이 이 이름을 담는다), 시스템 동작은
// category 가 정한다:
//   기관  커뮤니티(공유 공간)의 소유자가 될 수 있다
//   학교  학교급(초/중/고)이 적용된다
//   기타  그 외
// 이름을 바꾸면 사용 중인 기관의 org_type 도 함께 바뀐다(컨트롤러가 한
// 트랜잭션으로). 사용 중인 구분은 삭제할 수 없다.

using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Data;

namespace SignalLink.Api.Services;

public static class OrgTypeSupport
{
    public static readonly string[] Categories = ["기관", "학교", "기타"];

    /// <summary>분류 문자열의 구분자 — DB 에는 이어 붙여 저장하고 화면이 쪼갠다.</summary>
    public const char ClassificationSeparator = ',';

    public const string InvalidClassificationsMessage =
        "분류는 쉼표로 구분하며 각 항목은 1~10자여야 합니다.";

    public static List<string> SplitClassifications(string? raw) =>
        (raw ?? "")
            .Split(ClassificationSeparator,
                StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Distinct().ToList();

    /// <summary>입력을 저장 형태로 정규화한다. 항목이 규칙에 어긋나면 null.</summary>
    public static string? NormalizeClassifications(string? raw)
    {
        var parts = SplitClassifications(raw);
        if (parts.Any(part => part.Length is 0 or > 10)) return null;
        var joined = string.Join(ClassificationSeparator, parts);
        return joined.Length <= 200 ? joined : null;
    }

    /// <summary>기관구분 이름으로 분류 선택지를 가져온다. 없으면 빈 목록.</summary>
    public static async Task<List<string>> ClassificationsOfAsync(AppDbContext db, string typeName) =>
        SplitClassifications(await db.OrgTypes.Where(t => t.Name == typeName)
            .Select(t => t.Classifications).FirstOrDefaultAsync());

    /// <summary>이름의 동작 분류. 마스터에 없는 이름은 '기타'로 취급한다.</summary>
    public static async Task<string> CategoryOfAsync(AppDbContext db, string typeName) =>
        await db.OrgTypes.Where(t => t.Name == typeName)
            .Select(t => t.Category).FirstOrDefaultAsync() ?? "기타";

    public static async Task<HashSet<string>> NamesOfCategoryAsync(AppDbContext db, string category) =>
        [.. await db.OrgTypes.Where(t => t.Category == category).Select(t => t.Name).ToListAsync()];

    public static async Task<HashSet<string>> AllNamesAsync(AppDbContext db) =>
        [.. await db.OrgTypes.Select(t => t.Name).ToListAsync()];
}

// 콘텐츠 공유 구분 판정 검증.
//
// 공유는 관리 범위 밖의 사용자에게 콘텐츠를 열어 주는 유일한 통로다.
// 판정이 한 칸이라도 어긋나면 남의 콘텐츠가 새거나, 열어 준 콘텐츠가
// 안 보인다. 기관 트리: 최상위(1) ─ 교육청A(2) ─ 학교1(3)·학교2(4)
//                              └ 교육청B(5) ─ 먼학교(6)

using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Tests;

public sealed class ContentSharingTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly AppDbContext _db;

    public ContentSharingTests()
    {
        _connection = new SqliteConnection("Data Source=:memory:");
        _connection.Open();
        _db = new AppDbContext(
            new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_connection).Options);
        _db.Database.EnsureCreated();

        _db.Organizations.AddRange(
            new Organization { Id = 1, Name = "최상위 기관", OrgType = "기관" },
            new Organization { Id = 2, Name = "교육청A", OrgType = "기관", ParentId = 1 },
            new Organization { Id = 3, Name = "학교1", OrgType = "학교", ParentId = 2 },
            new Organization { Id = 4, Name = "학교2", OrgType = "학교", ParentId = 2 },
            new Organization { Id = 5, Name = "교육청B", OrgType = "기관", ParentId = 1 },
            new Organization { Id = 6, Name = "먼학교", OrgType = "학교", ParentId = 5 });
        _db.SaveChanges();
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }

    private static Content ContentOf(int orgId, string scope) =>
        new() { OrgId = orgId, Name = "검증용", ShareScope = scope };

    [Theory]
    [InlineData("없음", 3, false)]   // 공유가 아니라 관리 범위의 몫이다
    [InlineData("없음", 4, false)]
    [InlineData("동일기관", 3, true)]
    [InlineData("동일기관", 4, false)]
    [InlineData("소속기관", 3, true)]   // 자기 기관은 언제나 포함
    [InlineData("소속기관", 4, true)]   // 같은 상위기관(교육청A)의 형제
    [InlineData("소속기관", 2, false)]  // 상위기관 자체는 형제가 아니다
    [InlineData("소속기관", 6, false)]  // 다른 상위기관 아래에는 닿지 않는다
    [InlineData("전체", 6, true)]
    public async Task 공유_구분_판정_행렬(string scope, int viewerOrg, bool expected)
    {
        var content = ContentOf(orgId: 3, scope);
        Assert.Equal(expected, await ContentSharing.SharedWithAsync(_db, content, viewerOrg));
    }

    [Fact]
    public async Task 형제_기관은_같은_상위기관_아래_전부다()
    {
        Assert.Equal([3, 4], (await ContentSharing.SiblingOrgIdsAsync(_db, 3)).Order());
    }

    [Fact]
    public async Task 최상위_기관의_형제는_자기뿐이다()
    {
        // parent 가 NULL 인 기관끼리 형제로 묶으면 서로 무관한 최상위
        // 트리들이 공유로 이어진다 — 그래서 자기 자신만 남긴다.
        Assert.Equal([1], (await ContentSharing.SiblingOrgIdsAsync(_db, 1)).Order());
    }

    [Fact]
    public void 알려진_공유_구분은_네_가지다()
    {
        Assert.Equal(["없음", "동일기관", "소속기관", "전체"], ContentSharing.Scopes);
    }
}

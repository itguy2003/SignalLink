// 기동 시 DB 준비 — 스키마 마이그레이션과 부트스트랩.
//
// **스키마의 주인은 이 프로젝트의 EF 마이그레이션이다.** 다만 이 시스템은
// Alembic(FastAPI)이 스키마를 관리하던 시절의 DB 를 그대로 물려받아야 한다.
// 그래서 세 갈래로 움직인다:
//
//   1. 새 DB               → EF 마이그레이션이 처음부터 만든다.
//   2. Alembic 이 만든 DB   → 초기 마이그레이션(InitialCreate)을 "이미 적용됨"
//                            으로 기록만 하고(베이스라인) 데이터는 건드리지
//                            않는다. 이후 마이그레이션부터 EF 가 적용한다.
//   3. EF 가 관리 중인 DB   → 밀린 마이그레이션만 적용한다.
//
// 부트스트랩(요구사항): 시스템은 "최상위 기관"을 항상 생성한다. 최상위 기관
// 없이는 회원가입이 안 되므로 슈퍼관리자 계정도 함께 만든다. 멱등이다.

using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using SignalLink.Api.Data;

namespace SignalLink.Api.Services;

public static class DbStartup
{
    public static void Prepare(AppDbContext db, IConfiguration config, ILogger logger)
    {
        Migrate(db, logger);
        Bootstrap(db, config, logger);
    }

    private static void Migrate(AppDbContext db, ILogger logger)
    {
        var database = db.Database;
        if (!database.GetAppliedMigrations().Any() && HasLegacySchema(db))
        {
            // Alembic 이 만들어 둔 DB — 초기 마이그레이션이 표현하는 스키마가
            // 이미 있으므로, 실행하지 않고 이력에만 기록한다.
            var baseline = database.GetMigrations().First();
            var history = db.GetService<IHistoryRepository>();
            var productVersion = typeof(DbContext).Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "10.0";
            database.ExecuteSqlRaw(history.GetCreateIfNotExistsScript());
            database.ExecuteSqlRaw(history.GetInsertScript(new HistoryRow(baseline, productVersion)));
            logger.LogInformation("기존 Alembic DB 를 EF 베이스라인으로 기록했습니다: {Baseline}", baseline);
        }
        database.Migrate();
    }

    /// <summary>마이그레이션 이력 없이 핵심 테이블만 있으면 Alembic 시절 DB 다.</summary>
    private static bool HasLegacySchema(AppDbContext db)
    {
        var sql = db.Database.IsSqlite()
            ? "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'organization'"
            : "SELECT count(*) FROM information_schema.tables WHERE table_name = 'organization'";
        var connection = db.Database.GetDbConnection();
        var wasClosed = connection.State != System.Data.ConnectionState.Open;
        if (wasClosed) connection.Open();
        try
        {
            using var command = connection.CreateCommand();
            command.CommandText = sql;
            return Convert.ToInt64(command.ExecuteScalar()) > 0;
        }
        finally
        {
            if (wasClosed) connection.Close();
        }
    }

    private static void Bootstrap(AppDbContext db, IConfiguration config, ILogger logger)
    {
        // 기관구분 기본값. 테이블이 비어 있을 때만 심는다 — 관리자가 이름을
        // 바꾼 뒤에 기본 이름을 다시 심으면 안 된다.
        if (!db.OrgTypes.Any())
        {
            var seedTime = DateTime.UtcNow;
            foreach (var name in OrgTypeSupport.Categories)
                db.OrgTypes.Add(new OrgTypeDef
                {
                    Name = name,
                    Category = name,
                    // 학교의 분류 선택지는 학교급이다 — 다른 구분은 비워 시작한다.
                    Classifications = name == "학교" ? "초,중,고" : "",
                    CreatedAt = seedTime,
                    UpdatedAt = seedTime,
                });
            db.SaveChanges();
            logger.LogInformation("기관구분 기본값(기관·학교·기타)을 심었습니다.");
        }

        var root = db.Organizations
            .Where(o => o.ParentId == null).OrderBy(o => o.Id).FirstOrDefault();
        if (root is null)
        {
            var now = DateTime.UtcNow;
            root = new Organization
            {
                Name = config["RootOrgName"] ?? "최상위 기관",
                OrgType = "기관",
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Organizations.Add(root);
            db.SaveChanges();
            logger.LogInformation("최상위 기관을 생성했습니다: {Name} (id={Id})", root.Name, root.Id);
        }

        var adminId = config["BootstrapAdminId"] ?? "admin";
        if (!db.Users.Any(u => u.UserId == adminId))
        {
            var now = DateTime.UtcNow;
            var admin = new AppUser
            {
                UserId = adminId,
                PasswordHash = PasswordHasher.Hash(config["BootstrapAdminPassword"] ?? "admin1234"),
                OrgId = root.Id,
                Name = "시스템 관리자",
                Status = "승인",
                CreatedAt = now,
                UpdatedAt = now,
            };
            admin.Roles.Add(new UserRole { Role = Roles.SuperAdmin });
            admin.Roles.Add(new UserRole { Role = Roles.Member });
            db.Users.Add(admin);
            db.SaveChanges();
            logger.LogInformation("슈퍼관리자 계정을 생성했습니다: {UserId}", adminId);
        }
    }
}

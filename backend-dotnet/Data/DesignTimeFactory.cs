// `dotnet ef` 명령용 컨텍스트 팩토리.
//
// 서버를 통째로 띄우지 않고도 마이그레이션을 만들 수 있게, 런타임과 같은
// 규칙으로 공급자를 고른다: ../backend/.env 의 DATABASE_URL 이 postgresql://
// 이면 Npgsql, 아니면 ../backend/signallink.db (SQLite). 환경변수
// DATABASE_URL 이 있으면 그것이 이긴다.

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace SignalLink.Api.Data;

public class DesignTimeFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var root = Directory.GetCurrentDirectory();
        var databaseUrl = Environment.GetEnvironmentVariable("DATABASE_URL") ?? "";
        var envPath = Path.Combine(root, "..", "backend", ".env");
        if (databaseUrl.Length == 0 && File.Exists(envPath))
        {
            foreach (var line in File.ReadAllLines(envPath))
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith("DATABASE_URL=") && trimmed.Length > "DATABASE_URL=".Length)
                    databaseUrl = trimmed["DATABASE_URL=".Length..];
            }
        }

        var options = new DbContextOptionsBuilder<AppDbContext>();
        if (databaseUrl.StartsWith("postgresql"))
        {
            options.UseNpgsql(Services.DatabaseUrls.ToNpgsql(databaseUrl));
        }
        else
        {
            var dbPath = Path.GetFullPath(Path.Combine(root, "..", "backend", "signallink.db"));
            options.UseSqlite($"Data Source={dbPath}");
        }
        return new AppDbContext(options.Options);
    }
}

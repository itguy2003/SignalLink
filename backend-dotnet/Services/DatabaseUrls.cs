// DATABASE_URL(URL 형식) → Npgsql 연결 문자열.
//
// .env 는 FastAPI(SQLAlchemy)와 공유하므로 URL 형식이다:
//   postgresql+psycopg://user:pass@host:5432/dbname
// SQLAlchemy 는 이걸 그대로 먹지만 Npgsql 은 key=value 형식만 받는다 —
// 여기서 한 번 변환한다. '+psycopg' 같은 드라이버 접미사는 파이썬 쪽
// 사정이므로 버린다.

using Npgsql;

namespace SignalLink.Api.Services;

public static class DatabaseUrls
{
    public static string ToNpgsql(string databaseUrl)
    {
        // postgresql+psycopg:// → postgresql:// (Uri 파서가 알아듣게).
        var plusAt = databaseUrl.IndexOf('+');
        var schemeEnd = databaseUrl.IndexOf("://", StringComparison.Ordinal);
        if (plusAt > 0 && schemeEnd > plusAt)
            databaseUrl = string.Concat(databaseUrl.AsSpan(0, plusAt), databaseUrl.AsSpan(schemeEnd));

        var uri = new Uri(databaseUrl);
        var userInfo = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
        };
        return builder.ConnectionString;
    }
}

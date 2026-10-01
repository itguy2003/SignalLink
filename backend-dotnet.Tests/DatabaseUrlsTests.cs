// DATABASE_URL 변환 검증 — .env 의 URL 형식(SQLAlchemy 겸용)을 Npgsql 이
// 먹는 key=value 로 바꾼다. 여기가 틀리면 운영 전환 첫 기동에서 죽는다.

using SignalLink.Api.Services;

namespace SignalLink.Api.Tests;

public class DatabaseUrlsTests
{
    [Fact]
    public void 드라이버_접미사가_붙은_SQLAlchemy_URL_을_변환한다()
    {
        var result = DatabaseUrls.ToNpgsql(
            "postgresql+psycopg://signallink:password@localhost:5432/signallink");

        Assert.Contains("Host=localhost", result);
        Assert.Contains("Port=5432", result);
        Assert.Contains("Database=signallink", result);
        Assert.Contains("Username=signallink", result);
        Assert.Contains("Password=password", result);
    }

    [Fact]
    public void 포트가_없으면_5432_다()
    {
        Assert.Contains("Port=5432", DatabaseUrls.ToNpgsql("postgresql://u:p@db.example.com/app"));
    }

    [Fact]
    public void 비밀번호의_특수문자는_URL_인코딩을_푼다()
    {
        var result = DatabaseUrls.ToNpgsql("postgresql://u:p%40ss%2Fw@host/app");
        Assert.Contains("Password=p@ss/w", result);
    }
}

// 학교/기관 일괄 등록 파서 검증.
//
// CSV 는 학교 정보 배포 파일의 흔한 형태다 — UTF-8 과 CP949(한국 엑셀
// 기본 저장) 둘 다 읽어야 하고, 좌표가 다른 파일로 오는 경우 병합 규칙
// (코드 우선·이름 차선, 본 파일 값 보존)이 지켜져야 한다.

using System.Text;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

namespace SignalLink.Api.Tests;

public class ExcelImportCsvTests
{
    private static (List<Organization> rows, List<string> errors) Parse(
        string csv, Encoding? encoding = null, string? defaultOrgType = null) =>
        ExcelImport.ParseOrganizationCsv((encoding ?? Encoding.UTF8).GetBytes(csv), defaultOrgType);

    [Fact]
    public void 헤더를_읽고_행을_기관으로_만든다()
    {
        var (rows, errors) = Parse("기관명,주소,학교단위\n가나초등학교,서울시 어딘가,초\n");
        Assert.Empty(errors);
        var row = Assert.Single(rows);
        Assert.Equal("가나초등학교", row.Name);
        Assert.Equal("서울시 어딘가", row.Address);
        Assert.Equal("초", row.SchoolLevel);
    }

    [Fact]
    public void 학교명은_기관명의_별칭이다()
    {
        // 교육부 배포 파일은 '학교명' 헤더를 쓴다.
        var (rows, errors) = Parse("학교명\n다라중학교\n");
        Assert.Empty(errors);
        Assert.Equal("다라중학교", Assert.Single(rows).Name);
    }

    [Fact]
    public void 기본_기관타입을_지정할_수_있다()
    {
        // 학교 정보 관리 화면은 기관타입 컬럼이 없는 파일을 '학교'로 넣는다.
        var (rows, _) = Parse("기관명\n마바고등학교\n", defaultOrgType: "학교");
        Assert.Equal("학교", Assert.Single(rows).OrgType);
    }

    [Fact]
    public void CP949_로_저장한_파일도_읽는다()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        var cp949 = Encoding.GetEncoding(949);
        var (rows, errors) = Parse("기관명,주소\n한글학교,부산시 어딘가\n", cp949);
        Assert.Empty(errors);
        Assert.Equal("한글학교", Assert.Single(rows).Name);
    }

    [Fact]
    public void 기관명_헤더가_없으면_전체를_거부한다()
    {
        var (rows, errors) = Parse("주소,학교단위\n어딘가,초\n");
        Assert.Empty(rows);
        Assert.Contains("'기관명' 컬럼이 없습니다", Assert.Single(errors));
    }

    [Fact]
    public void 빈_행은_건너뛰고_이름_없는_행은_오류다()
    {
        var (rows, errors) = Parse("기관명,주소\n\n,주소만 있음\n정상학교,\n");
        Assert.Equal("정상학교", Assert.Single(rows).Name);
        Assert.Single(errors);
    }

    [Fact]
    public void 나이스_표준_헤더를_읽는다()
    {
        // 학교 정보 관리의 첫 번째 파일 — 첫 줄이 헤더인 나이스 배포 형식.
        var (rows, errors) = Parse(
            "시도교육청코드,시도교육청명,행정코드,학교명,학교종류명,시도명,관할조직명,도로명주소,도로명상세주소,전화번호,홈페이지주소\n"
            + "B10,서울특별시교육청,7010001,나이스초등학교,초등학교,서울특별시,"
            + "서울특별시성동광진교육지원청,서울특별시 광진구 어딘가 1,(중곡동),02-123-4567,http://school.example.org\n",
            defaultOrgType: "학교");
        Assert.Empty(errors);
        var row = Assert.Single(rows);
        Assert.Equal("나이스초등학교", row.Name);
        Assert.Equal("B10", row.EduOfficeCode);
        Assert.Equal("서울특별시교육청", row.EduOfficeName);
        Assert.Equal("7010001", row.SchoolCode);       // 행정코드 → 학교코드
        Assert.Equal("초", row.SchoolLevel);           // 학교종류명 → 학교급
        Assert.Equal("서울특별시", row.SidoName);
        Assert.Equal("서울특별시성동광진교육지원청", row.JurisdictionName);
        Assert.Equal("서울특별시 광진구 어딘가 1", row.Address);
        Assert.Equal("(중곡동)", row.AddressDetail);
        Assert.Equal("02-123-4567", row.Phone);
        Assert.Equal("http://school.example.org", row.Homepage);
    }

    [Fact]
    public void 학교종류명은_학교급으로_바뀐다()
    {
        var (rows, errors) = Parse(
            "학교명,학교종류명\n하나,고등학교\n둘,방송통신중학교\n셋,특수학교\n",
            defaultOrgType: "학교");
        Assert.Empty(errors);
        Assert.Equal(["고", "중", "기타"], rows.Select(r => r.SchoolLevel));
    }

    [Fact]
    public void 따옴표_안의_쉼표는_값의_일부다()
    {
        var (rows, _) = Parse("기관명,주소\n사아초교,\"서울시 강남구, 테헤란로 1\"\n");
        Assert.Equal("서울시 강남구, 테헤란로 1", Assert.Single(rows).Address);
    }
}

public class MergeSupplementTests
{
    private static Organization Org(
        string? name = null, string? eduCode = null, string? schoolCode = null,
        double? lat = null, double? lng = null, string? address = null) => new()
    {
        Name = name ?? "",
        EduOfficeCode = eduCode,
        SchoolCode = schoolCode,
        Latitude = lat,
        Longitude = lng,
        Address = address,
    };

    [Fact]
    public void 코드가_같으면_이름이_달라도_짝이_된다()
    {
        var baseRows = new List<Organization> { Org("가나초등학교", "B10", "7001") };
        var extraRows = new List<Organization> { Org("가나초", "B10", "7001", lat: 37.5, lng: 127.0) };

        var errors = ExcelImport.MergeSupplement(baseRows, extraRows);

        Assert.Empty(errors);
        Assert.Equal(37.5, baseRows[0].Latitude);
        Assert.Equal(127.0, baseRows[0].Longitude);
    }

    [Fact]
    public void 코드가_없으면_이름으로_짝을_찾는다()
    {
        var baseRows = new List<Organization> { Org("다라중학교") };
        var extraRows = new List<Organization> { Org("다라중학교", lat: 35.1) };

        Assert.Empty(ExcelImport.MergeSupplement(baseRows, extraRows));
        Assert.Equal(35.1, baseRows[0].Latitude);
    }

    [Fact]
    public void 본_파일의_값은_덮지_않는다()
    {
        // 본 파일이 더 믿을 만하다 — 보조 파일은 빈 칸만 채운다.
        var baseRows = new List<Organization> { Org("마바고", address: "본 파일 주소") };
        var extraRows = new List<Organization> { Org("마바고", address: "보조 파일 주소", lat: 36.0) };

        ExcelImport.MergeSupplement(baseRows, extraRows);

        Assert.Equal("본 파일 주소", baseRows[0].Address);
        Assert.Equal(36.0, baseRows[0].Latitude);
    }

    [Fact]
    public void 보조_파일은_좌표만_채운다()
    {
        // 두 번째 파일의 몫은 위도·경도뿐이다 — 다른 칸은 비어 있어도 가져오지 않는다.
        var baseRows = new List<Organization> { Org("좌표만학교") };
        var extraRows = new List<Organization>
        {
            Org("좌표만학교", address: "보조 주소", lat: 37.0, lng: 127.0),
        };

        Assert.Empty(ExcelImport.MergeSupplement(baseRows, extraRows));

        Assert.Null(baseRows[0].Address);
        Assert.Equal(37.0, baseRows[0].Latitude);
        Assert.Equal(127.0, baseRows[0].Longitude);
    }

    [Fact]
    public void 짝_없는_보조_행은_오류로_알린다()
    {
        // 조용히 버리면 좌표가 빠진 학교를 아무도 모른다.
        var baseRows = new List<Organization> { Org("있는학교") };
        var extraRows = new List<Organization> { Org("없는학교", lat: 33.0) };

        var errors = ExcelImport.MergeSupplement(baseRows, extraRows);

        Assert.Contains("없는학교", Assert.Single(errors));
    }
}

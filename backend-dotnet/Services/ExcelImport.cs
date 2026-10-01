// 기관 엑셀·CSV 일괄 등록 파서 — FastAPI(app/services/excel_import.py)의 짝.
//
// 첫 행을 헤더로 보고 컬럼명을 매핑한다. 순서는 자유, 모르는 컬럼은 무시,
// 필수는 기관명 하나뿐이다.

using ClosedXML.Excel;
using SignalLink.Api.Data;

namespace SignalLink.Api.Services;

public static class ExcelImport
{
    private static readonly Dictionary<string, string> ColumnMap = new()
    {
        ["기관명"] = "name",
        // 위경도 자료처럼 다른 출처의 파일은 흔히 '학교명' 이라고 적는다.
        ["학교명"] = "name",
        ["주소"] = "address",
        ["기관타입"] = "org_type",
        ["학교단위"] = "school_level",
        ["위도"] = "latitude",
        ["경도"] = "longitude",
        ["시도교육청코드"] = "edu_office_code",
        ["학교코드"] = "school_code",
        // 나이스 학교기본정보 배포 파일의 표준 헤더들.
        ["시도교육청명"] = "edu_office_name",
        ["행정코드"] = "school_code",
        ["행정표준코드"] = "school_code",
        ["학교종류명"] = "school_level",
        ["학교 종류명"] = "school_level",
        ["시도명"] = "sido_name",
        ["관할조직명"] = "jurisdiction_name",
        ["도로명주소"] = "address",
        ["도로명상세주소"] = "address_detail",
        ["전화번호"] = "phone",
        ["홈페이지주소"] = "homepage",
    };

    private static readonly HashSet<string> ValidTypes = ["기관", "학교", "기타"];
    private static readonly string[] ValidLevels = ["초", "중", "고", "기타"];

    public static (List<Organization> rows, List<string> errors) ParseOrganizationWorkbook(
        byte[] content, string? defaultOrgType = null, HashSet<string>? allowedTypes = null)
    {
        XLWorkbook workbook;
        try
        {
            workbook = new XLWorkbook(new MemoryStream(content));
        }
        catch (Exception exc)
        {
            return ([], [$"엑셀 파일을 읽을 수 없습니다: {exc.Message}"]);
        }

        using (workbook)
        {
            var sheet = workbook.Worksheets.FirstOrDefault();
            if (sheet is null) return ([], ["시트를 찾을 수 없습니다."]);

            var used = sheet.RangeUsed();
            if (used is null) return ([], ["빈 파일입니다."]);

            var headerRow = used.FirstRow();
            var headerIndex = new Dictionary<int, string>();
            foreach (var cell in headerRow.Cells())
            {
                var key = cell.GetString().Trim();
                if (ColumnMap.TryGetValue(key, out var field))
                    headerIndex[cell.Address.ColumnNumber] = field;
            }
            if (!headerIndex.ContainsValue("name"))
                return ([], [$"'기관명' 컬럼이 없습니다. 필요한 헤더: {string.Join(", ", ColumnMap.Keys)}"]);

            var parsed = new List<Organization>();
            var errors = new List<string>();

            foreach (var row in used.Rows().Skip(1))
            {
                if (row.Cells().All(c => c.IsEmpty())) continue;
                var rowNumber = row.RowNumber();
                try
                {
                    var org = new Organization { OrgType = defaultOrgType ?? "기관" };
                    foreach (var (column, field) in headerIndex)
                    {
                        var cell = row.Cell(column);
                        switch (field)
                        {
                            case "name": org.Name = Str(cell) ?? ""; break;
                            case "address": org.Address = Str(cell); break;
                            case "org_type": org.OrgType = Str(cell) ?? defaultOrgType ?? "기관"; break;
                            case "school_level": org.SchoolLevel = Str(cell); break;
                            case "latitude": org.Latitude = Num(cell); break;
                            case "longitude": org.Longitude = Num(cell); break;
                            case "edu_office_code": org.EduOfficeCode = Str(cell); break;
                            case "school_code": org.SchoolCode = Str(cell); break;
                            case "edu_office_name": org.EduOfficeName = Str(cell); break;
                            case "sido_name": org.SidoName = Str(cell); break;
                            case "jurisdiction_name": org.JurisdictionName = Str(cell); break;
                            case "address_detail": org.AddressDetail = Str(cell); break;
                            case "phone": org.Phone = Str(cell); break;
                            case "homepage": org.Homepage = Str(cell); break;
                        }
                    }
                    org.SchoolLevel = NormalizeSchoolLevel(org.SchoolLevel);

                    if (string.IsNullOrEmpty(org.Name))
                        throw new FormatException("기관명이 비어 있습니다.");
                    if (!(allowedTypes ?? ValidTypes).Contains(org.OrgType))
                        throw new FormatException(
                            $"기관타입이 올바르지 않습니다: {org.OrgType} (허용: {string.Join(", ", (allowedTypes ?? ValidTypes).Order())})");
                    if (org.SchoolLevel is not null && !ValidLevels.Contains(org.SchoolLevel))
                        throw new FormatException(
                            $"학교단위가 올바르지 않습니다: {org.SchoolLevel} (허용: {string.Join(", ", ValidLevels.Order())})");

                    parsed.Add(org);
                }
                catch (FormatException exc)
                {
                    errors.Add($"{rowNumber}행: {exc.Message}");
                }
            }
            return (parsed, errors);
        }
    }

    private static string? Str(IXLCell cell)
    {
        if (cell.IsEmpty()) return null;
        var text = cell.GetString().Trim();
        return text.Length > 0 ? text : null;
    }

    private static double? Num(IXLCell cell)
    {
        if (cell.IsEmpty()) return null;
        if (cell.TryGetValue<double>(out var value)) return value;
        throw new FormatException($"숫자가 아닙니다: '{cell.GetString()}'");
    }

    // ---------------------------------------------------------------- CSV

    /// <summary>CSV 바이트를 문자열로 — utf-8(BOM 포함) 먼저, 실패하면 cp949.</summary>
    private static string DecodeCsv(byte[] content)
    {
        try
        {
            var utf8 = new System.Text.UTF8Encoding(
                encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);
            var text = utf8.GetString(content);
            return text.Length > 0 && text[0] == '﻿' ? text[1..] : text;
        }
        catch (System.Text.DecoderFallbackException)
        {
            System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
            return System.Text.Encoding.GetEncoding(949).GetString(content);
        }
    }

    /// <summary>따옴표를 아는 최소 CSV 한 줄 분해.</summary>
    private static List<string> SplitCsvLine(string line)
    {
        var cells = new List<string>();
        var current = new System.Text.StringBuilder();
        var inQuotes = false;
        for (var at = 0; at < line.Length; at++)
        {
            var ch = line[at];
            if (inQuotes)
            {
                if (ch == '"')
                {
                    if (at + 1 < line.Length && line[at + 1] == '"') { current.Append('"'); at++; }
                    else inQuotes = false;
                }
                else current.Append(ch);
            }
            else if (ch == '"') inQuotes = true;
            else if (ch == ',') { cells.Add(current.ToString()); current.Clear(); }
            else current.Append(ch);
        }
        cells.Add(current.ToString());
        return cells;
    }

    /// <summary>CSV 일괄 등록 — 헤더 규칙은 엑셀과 같다.</summary>
    public static (List<Organization> rows, List<string> errors) ParseOrganizationCsv(
        byte[] content, string? defaultOrgType = null, HashSet<string>? allowedTypes = null)
    {
        string text;
        try { text = DecodeCsv(content); }
        catch (Exception)
        {
            return ([], ["파일 인코딩을 해석할 수 없습니다. UTF-8 또는 CP949 로 저장하세요."]);
        }

        var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        if (lines.Length == 0 || lines[0].Trim().Length == 0)
            return ([], ["빈 파일입니다."]);

        var header = SplitCsvLine(lines[0]);
        var headerIndex = new Dictionary<int, string>();
        for (var at = 0; at < header.Count; at++)
        {
            var key = header[at].Trim();
            if (ColumnMap.TryGetValue(key, out var field)) headerIndex[at] = field;
        }
        if (!headerIndex.ContainsValue("name"))
            return ([], [$"'기관명' 컬럼이 없습니다. 필요한 헤더: {string.Join(", ", ColumnMap.Keys)}"]);

        var parsed = new List<Organization>();
        var errors = new List<string>();

        for (var lineNo = 1; lineNo < lines.Length; lineNo++)
        {
            var line = lines[lineNo];
            if (line.Trim().Length == 0) continue;
            var cells = SplitCsvLine(line);
            if (cells.All(c => c.Trim().Length == 0)) continue;

            try
            {
                var org = new Organization { OrgType = defaultOrgType ?? "기관" };
                foreach (var (column, field) in headerIndex)
                {
                    var raw = column < cells.Count ? cells[column].Trim() : "";
                    var value = raw.Length > 0 ? raw : null;
                    switch (field)
                    {
                        case "name": org.Name = value ?? ""; break;
                        case "address": org.Address = value; break;
                        case "org_type": org.OrgType = value ?? defaultOrgType ?? "기관"; break;
                        case "school_level": org.SchoolLevel = value; break;
                        case "latitude": org.Latitude = ParseNum(value); break;
                        case "longitude": org.Longitude = ParseNum(value); break;
                        case "edu_office_code": org.EduOfficeCode = value; break;
                        case "school_code": org.SchoolCode = value; break;
                        case "edu_office_name": org.EduOfficeName = value; break;
                        case "sido_name": org.SidoName = value; break;
                        case "jurisdiction_name": org.JurisdictionName = value; break;
                        case "address_detail": org.AddressDetail = value; break;
                        case "phone": org.Phone = value; break;
                        case "homepage": org.Homepage = value; break;
                    }
                }
                org.SchoolLevel = NormalizeSchoolLevel(org.SchoolLevel);

                if (string.IsNullOrEmpty(org.Name))
                    throw new FormatException("기관명이 비어 있습니다.");
                if (!(allowedTypes ?? ValidTypes).Contains(org.OrgType))
                    throw new FormatException(
                        $"기관타입이 올바르지 않습니다: {org.OrgType} (허용: {string.Join(", ", (allowedTypes ?? ValidTypes).Order())})");
                if (org.SchoolLevel is not null && !ValidLevels.Contains(org.SchoolLevel))
                    throw new FormatException(
                        $"학교단위가 올바르지 않습니다: {org.SchoolLevel} (허용: {string.Join(", ", ValidLevels.Order())})");

                parsed.Add(org);
            }
            catch (FormatException exc)
            {
                errors.Add($"{lineNo + 1}행: {exc.Message}");
            }
        }
        return (parsed, errors);
    }

    private static double? ParseNum(string? value)
    {
        if (value is null) return null;
        if (double.TryParse(value, out var number)) return number;
        throw new FormatException($"숫자가 아닙니다: '{value}'");
    }

    /// <summary>'학교종류명'(초등학교/중학교/고등학교/특수학교 등)을 학교급으로.
    /// 이미 학교급이거나 못 알아보는 값은 그대로 둔다 — 검증이 잡는다.</summary>
    private static string? NormalizeSchoolLevel(string? value)
    {
        if (value is null || ValidLevels.Contains(value)) return value;
        if (value.Contains("초등")) return "초";
        if (value.Contains("고등")) return "고";
        if (value.Contains('중')) return "중";
        if (value.EndsWith("학교")) return "기타";
        return value;
    }

    /// <summary>보조 파일에서 **위도·경도만** 본 파일 행에 채워 넣는다.
    /// 짝은 (시도교육청코드, 학교코드) 우선, 없으면 이름. 본 파일 값은 덮지 않는다.
    /// 짝을 못 찾은 보조 행은 오류 목록으로 — 조용히 버리면 아무도 모른다.</summary>
    public static List<string> MergeSupplement(List<Organization> baseRows, List<Organization> extraRows)
    {
        var byCode = new Dictionary<(string, string), Organization>();
        var byName = new Dictionary<string, Organization>();
        foreach (var row in baseRows)
        {
            if (!string.IsNullOrEmpty(row.EduOfficeCode) && !string.IsNullOrEmpty(row.SchoolCode))
                byCode[(row.EduOfficeCode, row.SchoolCode)] = row;
            if (!string.IsNullOrEmpty(row.Name)) byName[row.Name] = row;
        }

        var errors = new List<string>();
        foreach (var extra in extraRows)
        {
            Organization? target = null;
            if (!string.IsNullOrEmpty(extra.EduOfficeCode) && !string.IsNullOrEmpty(extra.SchoolCode))
                byCode.TryGetValue((extra.EduOfficeCode, extra.SchoolCode), out target);
            if (target is null && !string.IsNullOrEmpty(extra.Name))
                byName.TryGetValue(extra.Name, out target);
            if (target is null)
            {
                var label = !string.IsNullOrEmpty(extra.Name) ? extra.Name : extra.SchoolCode ?? "?";
                errors.Add($"보조 파일: '{label}' 과 짝이 되는 행을 본 파일에서 찾지 못했습니다.");
                continue;
            }
            // 두 번째 파일의 몫은 좌표뿐이다 — 주소·이름 등이 달라도 덮지 않는다.
            target.Latitude ??= extra.Latitude;
            target.Longitude ??= extra.Longitude;
        }
        return errors;
    }
}

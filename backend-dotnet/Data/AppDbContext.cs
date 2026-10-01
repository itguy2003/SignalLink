// SignalLink Green — .NET Core 백엔드의 EF Core 매핑 (전체 스키마).
//
// **스키마의 주인은 이 프로젝트의 EF Core 마이그레이션이다**(Migrations/).
// 예전 주인이던 FastAPI 쪽 Alembic 은 d491ad229086 에서 동결됐다. 기존 DB 는
// 기동 시 그 시점을 베이스라인으로 기록해 흡수하고(DbStartup), 새 DB 는 EF 가
// 처음부터 만든다. 스키마를 바꿀 때는 이 모델을 고치고
// `dotnet ef migrations add <이름>` 으로 마이그레이션을 만들 것.
// FastAPI(app/models/*)는 같은 DB 를 읽는 거울이므로 컬럼을 더하면 함께 고친다.
//
// 표·열 이름은 FastAPI 모델(app/models/*)의 snake_case 를 그대로 따른다.
// JSON 열(document·options·items)은 문자열로 매핑하고 JsonNode 로 읽는
// 도우미를 얹는다 — SQLAlchemy 의 JSON 타입이 실제로는 TEXT 이기 때문이다.

using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Nodes;

namespace SignalLink.Api.Data;

public static class Json
{
    public static JsonNode? Parse(string? raw) =>
        string.IsNullOrEmpty(raw) ? null : JsonNode.Parse(raw);

    public static string Write(JsonNode? node) => node?.ToJsonString() ?? "{}";
}

// ---------------------------------------------------------------- 기관·사용자

/// <summary>기관구분 마스터. 이름은 관리자가 바꿀 수 있고(사용 중인 기관의
/// org_type 문자열도 함께 갱신된다), 시스템 동작은 category 가 정한다:
/// '기관'=커뮤니티 소유 가능 / '학교'=학교급 적용 / '기타'=그 외.
/// 사용 중인 구분은 삭제할 수 없다(수정만 가능).</summary>
[Table("org_type")]
public class OrgTypeDef
{
    [Column("id")] public int Id { get; set; }
    [MaxLength(20)] [Column("name")] public string Name { get; set; } = "";
    [MaxLength(10)] [Column("category")] public string Category { get; set; } = "기타";
    /// <summary>이 구분의 기관이 고를 수 있는 분류 선택지 — 쉼표로 이어 저장
    /// (예: "초,중,고"). 기관 등록 화면이 쪼개어 드롭다운으로 보여 주고,
    /// 고른 값은 organization.school_level 에 들어간다. 비면 분류 없음.</summary>
    [MaxLength(200)] [Column("classifications")] public string Classifications { get; set; } = "";
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }
}

[Table("organization")]
public class Organization
{
    [Column("id")] public int Id { get; set; }
    [MaxLength(200)] [Column("name")] public string Name { get; set; } = "";
    [MaxLength(500)] [Column("address")] public string? Address { get; set; }
    /// <summary>'기관' | '학교' | '기타'. 커뮤니티는 '기관'에만 걸린다.</summary>
    [MaxLength(20)] [Column("org_type")] public string OrgType { get; set; } = "기관";
    [MaxLength(10)] [Column("school_level")] public string? SchoolLevel { get; set; }
    [Column("parent_id")] public int? ParentId { get; set; }
    [Column("latitude")] public double? Latitude { get; set; }
    [Column("longitude")] public double? Longitude { get; set; }
    [MaxLength(20)] [Column("edu_office_code")] public string? EduOfficeCode { get; set; }
    [MaxLength(20)] [Column("school_code")] public string? SchoolCode { get; set; }
    // 학교 정보 일괄 등록(나이스 표준 헤더)에서 수집하는 부가 정보.
    [MaxLength(40)] [Column("edu_office_name")] public string? EduOfficeName { get; set; }
    [MaxLength(20)] [Column("sido_name")] public string? SidoName { get; set; }
    [MaxLength(100)] [Column("jurisdiction_name")] public string? JurisdictionName { get; set; }
    [MaxLength(300)] [Column("address_detail")] public string? AddressDetail { get; set; }
    [MaxLength(30)] [Column("phone")] public string? Phone { get; set; }
    [MaxLength(300)] [Column("homepage")] public string? Homepage { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }
}

[Table("app_user")]
public class AppUser
{
    [Column("id")] public int Id { get; set; }
    [MaxLength(50)] [Column("user_id")] public string UserId { get; set; } = "";
    [MaxLength(255)] [Column("password_hash")] public string PasswordHash { get; set; } = "";
    [Column("org_id")] public int OrgId { get; set; }
    [MaxLength(100)] [Column("name")] public string Name { get; set; } = "";
    [MaxLength(30)] [Column("phone")] public string? Phone { get; set; }
    [MaxLength(200)] [Column("email")] public string? Email { get; set; }
    /// <summary>'승인' | '미승인'. 로그인은 승인된 계정만 된다.</summary>
    [MaxLength(10)] [Column("status")] public string Status { get; set; } = "미승인";
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    public List<UserRole> Roles { get; set; } = [];
    public List<string> RoleNames => Roles.Select(r => r.Role).OrderBy(r => r, StringComparer.Ordinal).ToList();
}

[Table("user_role")]
public class UserRole
{
    [Column("id")] public int Id { get; set; }
    [Column("user_id")] public int UserId { get; set; }
    [MaxLength(30)] [Column("role")] public string Role { get; set; } = "MEMBER";
}

[Table("login_log")]
public class LoginLog
{
    [Column("id")] public int Id { get; set; }
    [Column("user_id")] public int? UserId { get; set; }
    [MaxLength(50)] [Column("attempted_user_id")] public string AttemptedUserId { get; set; } = "";
    [Column("success")] public bool Success { get; set; }
    [MaxLength(64)] [Column("ip_address")] public string? IpAddress { get; set; }
    [MaxLength(300)] [Column("user_agent")] public string? UserAgent { get; set; }
    [MaxLength(100)] [Column("reason")] public string? Reason { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
}

/// <summary>사용자별 Canva Connect 연결(OAuth 토큰).
///
/// 토큰은 서버만 안다 — 프런트에 내려 주면 번들·개발자 도구에서 새어 나간다.
/// refresh_token 은 회전식이라 갱신 때마다 새 값으로 바꿔 저장한다.</summary>
[Table("canva_account")]
public class CanvaAccount
{
    [Column("id")] public int Id { get; set; }
    [Column("user_id")] public int UserId { get; set; }
    [Column("access_token")] public string AccessToken { get; set; } = "";
    [Column("refresh_token")] public string RefreshToken { get; set; } = "";
    [Column("expires_at")] public DateTime ExpiresAt { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }
}

// ---------------------------------------------------------------- 자산

[Table("asset")]
public class Asset
{
    [Column("id")] public int Id { get; set; }
    [Column("org_id")] public int OrgId { get; set; }
    [Column("uploaded_by")] public int? UploadedBy { get; set; }
    [MaxLength(10)] [Column("kind")] public string Kind { get; set; } = "image";
    [MaxLength(255)] [Column("filename")] public string Filename { get; set; } = "";
    [MaxLength(100)] [Column("content_type")] public string ContentType { get; set; } = "";
    [Column("size_bytes")] public long SizeBytes { get; set; }
    [MaxLength(300)] [Column("storage_path")] public string StoragePath { get; set; } = "";
    [MaxLength(300)] [Column("thumb_path")] public string? ThumbPath { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    /// <summary>주소에 넣는 열쇠 — 저장 파일 이름(무작위)의 stem. FastAPI 와 같은 규칙.</summary>
    public string Token => Path.GetFileNameWithoutExtension(StoragePath);
}

[Table("content_asset")]
public class ContentAsset
{
    [Column("id")] public int Id { get; set; }
    [Column("content_id")] public int ContentId { get; set; }
    [Column("asset_id")] public int AssetId { get; set; }
}

[Table("playlist_asset")]
public class PlaylistAsset
{
    [Column("id")] public int Id { get; set; }
    [Column("playlist_id")] public int PlaylistId { get; set; }
    [Column("asset_id")] public int AssetId { get; set; }
}

// ---------------------------------------------------------------- 콘텐츠·재생목록

[Table("content")]
public class Content
{
    [Column("id")] public int Id { get; set; }
    [MaxLength(200)] [Column("name")] public string Name { get; set; } = "";
    [MaxLength(500)] [Column("description")] public string? Description { get; set; }
    [Column("org_id")] public int OrgId { get; set; }
    [Column("created_by")] public int? CreatedBy { get; set; }
    [Column("width")] public int Width { get; set; } = 1920;
    [Column("height")] public int Height { get; set; } = 1080;
    /// <summary>편집기 산출물(JSON). 스키마 계약은 플레이어와 공유한다.</summary>
    [Column("document")] public string DocumentJson { get; set; } = "{}";
    /// <summary>공유 구분: '없음' | '동일기관' | '소속기관'(같은 상위기관 아래 기관들) | '전체'.
    /// 관리 범위 밖의 사용자에게 콘텐츠를 열어 주는 유일한 통로다.</summary>
    [MaxLength(10)] [Column("share_scope")] public string ShareScope { get; set; } = "없음";
    [Column("version")] public int Version { get; set; } = 1;
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    public AppUser? Creator { get; set; }
    public List<ContentAsset> AssetLinks { get; set; } = [];
    public List<ContentPlaylist> PlaylistLinks { get; set; } = [];
}

[Table("playlist")]
public class Playlist
{
    [Column("id")] public int Id { get; set; }
    [MaxLength(200)] [Column("name")] public string Name { get; set; } = "";
    [MaxLength(500)] [Column("description")] public string? Description { get; set; }
    [Column("org_id")] public int OrgId { get; set; }
    [Column("created_by")] public int? CreatedBy { get; set; }
    [Column("version")] public int Version { get; set; } = 1;
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    public AppUser? Creator { get; set; }
    public List<PlaylistItem> Items { get; set; } = [];
    public List<ContentPlaylist> ContentLinks { get; set; } = [];
    public List<PlaylistAsset> AssetLinks { get; set; } = [];
}

[Table("playlist_item")]
public class PlaylistItem
{
    [Column("id")] public int Id { get; set; }
    [Column("playlist_id")] public int PlaylistId { get; set; }
    [Column("sort_order")] public int SortOrder { get; set; }
    [MaxLength(50)] [Column("widget_key")] public string WidgetKey { get; set; } = "";
    [Column("duration_sec")] public int DurationSec { get; set; } = 10;
    [Column("options")] public string OptionsJson { get; set; } = "{}";
    [MaxLength(20)] [Column("transition")] public string Transition { get; set; } = "none";
    [Column("transition_ms")] public int TransitionMs { get; set; } = 600;
}

[Table("content_playlist")]
public class ContentPlaylist
{
    [Column("id")] public int Id { get; set; }
    [Column("content_id")] public int ContentId { get; set; }
    [Column("playlist_id")] public int PlaylistId { get; set; }
}

// ---------------------------------------------------------------- 스케줄

[Table("schedule")]
public class Schedule
{
    [Column("id")] public int Id { get; set; }
    [MaxLength(200)] [Column("name")] public string Name { get; set; } = "";
    /// <summary>'시간지정' | '목록반복'</summary>
    [MaxLength(20)] [Column("kind")] public string Kind { get; set; } = "목록반복";
    [MaxLength(20)] [Column("orientation")] public string Orientation { get; set; } = "LANDSCAPE";
    [Column("start_at")] public DateTime? StartAt { get; set; }
    [Column("end_at")] public DateTime? EndAt { get; set; }
    [Column("org_id")] public int OrgId { get; set; }
    [Column("created_by")] public int? CreatedBy { get; set; }
    /// <summary>하트비트가 비교하는 버전 — 고칠 때마다 올라간다.</summary>
    [Column("version")] public int Version { get; set; } = 1;
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    public AppUser? Creator { get; set; }
    public List<ScheduleItem> Items { get; set; } = [];
    public List<DeviceScheduleLink> DeviceLinks { get; set; } = [];
}

[Table("schedule_item")]
public class ScheduleItem
{
    [Column("id")] public int Id { get; set; }
    [Column("schedule_id")] public int ScheduleId { get; set; }
    /// <summary>-1 = 목록반복(요일 무관), 0(월)~6(일)</summary>
    [Column("day_of_week")] public int DayOfWeek { get; set; } = -1;
    [Column("start_time")] public TimeOnly? StartTime { get; set; }
    [Column("end_time")] public TimeOnly? EndTime { get; set; }
    [Column("sort_order")] public int SortOrder { get; set; }
    [Column("duration_sec")] public int DurationSec { get; set; } = 10;
    /// <summary>앞 칸에서 이 칸으로 넘어올 때의 전환 효과 — 재생목록 칸과 같은 규약(Transitions).</summary>
    [MaxLength(20)] [Column("transition")] public string Transition { get; set; } = "none";
    [Column("transition_ms")] public int TransitionMs { get; set; } = 600;
    [Column("content_id")] public int? ContentId { get; set; }
    /// <summary>소속기관 공지 참조. 설정되면 표출 시 공지의 슬라이드 전체로 펼쳐진다.</summary>
    [Column("org_notice_id")] public int? OrgNoticeId { get; set; }
    [Column("content")] public string ContentJson { get; set; } = "{}";

    public Content? ContentRef { get; set; }
    public OrgNotice? NoticeRef { get; set; }
}

// ---------------------------------------------------------------- 장치

[Table("device")]
public class Device
{
    [Column("id")] public int Id { get; set; }
    [Column("org_id")] public int OrgId { get; set; }
    /// <summary>서버가 만든 고유번호. XXXX-XXX-XXX (대문자+숫자 10자리).</summary>
    [MaxLength(12)] [Column("device_code")] public string DeviceCode { get; set; } = "";
    [MaxLength(200)] [Column("name")] public string Name { get; set; } = "";
    [MaxLength(20)] [Column("os")] public string Os { get; set; } = "";
    [MaxLength(20)] [Column("form_factor")] public string FormFactor { get; set; } = "";
    [MaxLength(20)] [Column("panel_type")] public string PanelType { get; set; } = "LANDSCAPE";
    [Column("width")] public int? Width { get; set; }
    [Column("height")] public int? Height { get; set; }
    [MaxLength(200)] [Column("place_name")] public string? PlaceName { get; set; }
    [MaxLength(20)] [Column("place_kind")] public string? PlaceKind { get; set; }
    [MaxLength(20)] [Column("device_kind")] public string DeviceKind { get; set; } = "일반";
    [Column("grade")] public int? Grade { get; set; }
    [Column("class_no")] public int? ClassNo { get; set; }
    [MaxLength(100)] [Column("class_name")] public string? ClassName { get; set; }
    [MaxLength(50)] [Column("track")] public string? Track { get; set; }
    [Column("is_master")] public bool IsMaster { get; set; }
    [MaxLength(100)] [Column("cpu")] public string? Cpu { get; set; }
    [MaxLength(50)] [Column("memory")] public string? Memory { get; set; }
    [MaxLength(50)] [Column("storage")] public string? Storage { get; set; }
    [Column("storage_total_bytes")] public long? StorageTotalBytes { get; set; }
    [Column("storage_free_bytes")] public long? StorageFreeBytes { get; set; }
    [Column("storage_reported_at")] public DateTime? StorageReportedAt { get; set; }
    /// <summary>하트비트가 비교하는 버전 — 배정이 바뀔 때마다 올라간다.</summary>
    [Column("version")] public int Version { get; set; }
    [Column("last_seen_at")] public DateTime? LastSeenAt { get; set; }
    [MaxLength(50)] [Column("app_version")] public string? AppVersion { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    public List<DeviceScheduleLink> ScheduleLinks { get; set; } = [];
    public List<DeviceManager> Managers { get; set; } = [];
}

[Table("device_schedule")]
public class DeviceScheduleLink
{
    [Column("id")] public int Id { get; set; }
    [Column("device_id")] public int DeviceId { get; set; }
    [Column("schedule_id")] public int ScheduleId { get; set; }
    [Column("sort_order")] public int SortOrder { get; set; }

    public Schedule Schedule { get; set; } = null!;
}

[Table("device_screenshot")]
public class DeviceScreenshot
{
    [Column("device_id")] public int DeviceId { get; set; }
    [Column("image")] public byte[] Image { get; set; } = [];
    [MaxLength(50)] [Column("content_type")] public string ContentType { get; set; } = "image/png";
    [Column("captured_at")] public DateTime CapturedAt { get; set; }
}

[Table("device_manager")]
public class DeviceManager
{
    [Column("id")] public int Id { get; set; }
    [Column("device_id")] public int DeviceId { get; set; }
    [Column("user_id")] public int UserId { get; set; }

    public AppUser User { get; set; } = null!;
}

[Table("device_group")]
public class DeviceGroup
{
    [Column("id")] public int Id { get; set; }
    [MaxLength(200)] [Column("name")] public string Name { get; set; } = "";
    [Column("user_id")] public int UserId { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    public List<DeviceGroupMember> Members { get; set; } = [];
}

[Table("device_group_member")]
public class DeviceGroupMember
{
    [Column("id")] public int Id { get; set; }
    [Column("group_id")] public int GroupId { get; set; }
    [Column("device_id")] public int DeviceId { get; set; }
}

// ---------------------------------------------------------------- 기관 게시판(스크래핑)

[Table("org_board")]
public class OrgBoard
{
    [Column("id")] public int Id { get; set; }
    [Column("org_id")] public int OrgId { get; set; }
    /// <summary>운영자가 알아보는 이름표(예: '본관 공지'). 표시용이다.</summary>
    [MaxLength(200)] [Column("name")] public string Name { get; set; } = "";
    [MaxLength(20)] [Column("kind")] public string Kind { get; set; } = "게시판";
    [MaxLength(1000)] [Column("url")] public string Url { get; set; } = "";
    [MaxLength(50)] [Column("scrape_method")] public string? ScrapeMethod { get; set; }
    [MaxLength(10)] [Column("scrape_result")] public string? ScrapeResult { get; set; }
    [Column("scrape_count")] public int ScrapeCount { get; set; }
    [Column("last_scraped_at")] public DateTime? LastScrapedAt { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    public List<BoardPost> Posts { get; set; } = [];
}

[Table("board_post")]
public class BoardPost
{
    [Column("id")] public int Id { get; set; }
    [Column("board_id")] public int BoardId { get; set; }
    [MaxLength(500)] [Column("title")] public string Title { get; set; } = "";
    [MaxLength(100)] [Column("author")] public string? Author { get; set; }
    [Column("posted_on")] public DateOnly? PostedOn { get; set; }
    [Column("year")] public int? Year { get; set; }
    [Column("month")] public int? Month { get; set; }
    [Column("day")] public int? Day { get; set; }
    [Column("term")] public int? Term { get; set; }
    [Column("content")] public string? Content { get; set; }
}

// ------------------------------------------------------------ 소속기관 공지

/// <summary>소속기관 공지 — 상위 기관이 소속기관에 내리는, **기간이 정해진
/// 재생목록** 형태의 공지. 슬라이드(item)마다 콘텐츠 편집기 문서를 인라인으로
/// 갖고, 순서(sort_order)와 유지 시간(duration_sec)으로 순환한다.</summary>
[Table("org_notice")]
public class OrgNotice
{
    [Column("id")] public int Id { get; set; }
    [Column("org_id")] public int OrgId { get; set; }
    [MaxLength(200)] [Column("name")] public string Name { get; set; } = "";
    /// <summary>사용기간(YYYY-MM-DDTHH:MM, 서버 로컬 시각). 비면 늘 유효.
    /// 날짜만 저장된 옛 값은 판정 시 시작 00:00 / 종료 23:59 로 넓혀 읽는다.</summary>
    [MaxLength(16)] [Column("start_date")] public string? StartDate { get; set; }
    [MaxLength(16)] [Column("end_date")] public string? EndDate { get; set; }
    [Column("created_by")] public int? CreatedBy { get; set; }
    /// <summary>고칠 때마다 오른다 — 표출 쪽이 변경을 감지하는 번호.</summary>
    [Column("version")] public int Version { get; set; } = 1;
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    public List<OrgNoticeItem> Items { get; set; } = [];
}

[Table("org_notice_item")]
public class OrgNoticeItem
{
    [Column("id")] public int Id { get; set; }
    [Column("notice_id")] public int NoticeId { get; set; }
    [Column("sort_order")] public int SortOrder { get; set; }
    [Column("duration_sec")] public int DurationSec { get; set; } = 10;
    /// <summary>콘텐츠 편집기 산출물(JSON) — 슬라이드가 문서를 인라인으로 갖는다.</summary>
    [Column("document")] public string DocumentJson { get; set; } = "{}";
}

// ---------------------------------------------------------------- 커뮤니티

/// <summary>커뮤니티 게시물 — 게시를 원하는 것을 재생목록 형태로 등록한다.
/// 메타데이터는 제목·공지대상(기관구분)·공지희망기간·연락처·메모(2026-10 개편).
/// 게시 결과는 커뮤니티 소유 기관의 관리자가 정하고, '게시' 상태만 위젯이
/// 표출하며 로그인 팝업도 '게시' + 대상·기간이 맞는 글만 알린다.</summary>
[Table("community_playlist")]
public class CommunityPlaylist
{
    [Column("id")] public int Id { get; set; }
    [Column("org_id")] public int OrgId { get; set; }
    [Column("author_id")] public int? AuthorId { get; set; }
    [MaxLength(200)] [Column("title")] public string Title { get; set; } = "";
    /// <summary>간단한 메모 — 게시 요청에 덧붙이는 짧은 글.</summary>
    [MaxLength(500)] [Column("memo")] public string? Memo { get; set; }
    /// <summary>공지대상 — 기관구분 이름들의 JSON 배열. 빈 배열은 '전체 대상'.</summary>
    [Column("target_org_types")] public string TargetOrgTypesJson { get; set; } = "[]";
    /// <summary>공지희망기간 — "YYYY-MM-DD". 비우면 기간 제한 없음. 문자열로
    /// 두는 이유: 두 백엔드(JSON 날짜 직렬화)와 두 DB 방언에서 모양이 같다.</summary>
    [MaxLength(10)] [Column("notice_start")] public string? NoticeStart { get; set; }
    [MaxLength(10)] [Column("notice_end")] public string? NoticeEnd { get; set; }
    /// <summary>게시자가 적는 표시 이름 — 비우면 계정 이름을 쓴다.</summary>
    [MaxLength(100)] [Column("author_name")] public string? AuthorName { get; set; }
    /// <summary>연락처 — 전화·이메일 등 자유 형식. 계정 정보와 별개로 글에 싣는다.</summary>
    [MaxLength(200)] [Column("contact")] public string? Contact { get; set; }
    /// <summary>'대기중' | '게시' | '게시보류'.</summary>
    [MaxLength(10)] [Column("publish_status")] public string PublishStatus { get; set; } = "대기중";
    /// <summary>[{kind, asset_id, duration_sec, transition?, transition_ms?}] JSON.
    /// asset_id 는 이 재생목록에 올린 파일(community_playlist_asset)만 가리킨다.</summary>
    [Column("items")] public string ItemsJson { get; set; } = "[]";
    [Column("version")] public int Version { get; set; } = 1;
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    public AppUser? Author { get; set; }
    public List<CommunityPlaylistAsset> AssetLinks { get; set; } = [];
}

/// <summary>재생목록에 올린 파일의 색인 — 항목 검증과 사용처 집계의 근거.</summary>
[Table("community_playlist_asset")]
public class CommunityPlaylistAsset
{
    [Column("id")] public int Id { get; set; }
    [Column("playlist_id")] public int PlaylistId { get; set; }
    [Column("asset_id")] public int AssetId { get; set; }

    public Asset Asset { get; set; } = null!;
}

/// <summary>커뮤니티(소유 기관)별 설정 — 게시 정책.
/// auto_publish 가 켜지면 등록 즉시 '게시', 꺼져 있으면(기본) 관리자
/// 승인 후 게시('대기중'으로 시작)다.</summary>
[Table("community_setting")]
public class CommunitySetting
{
    [Column("id")] public int Id { get; set; }
    [Column("org_id")] public int OrgId { get; set; }
    [Column("auto_publish")] public bool AutoPublish { get; set; }
}

// ---------------------------------------------------------------- 컨텍스트

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<OrgTypeDef> OrgTypes => Set<OrgTypeDef>();
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<UserRole> UserRoles => Set<UserRole>();
    public DbSet<LoginLog> LoginLogs => Set<LoginLog>();
    public DbSet<CanvaAccount> CanvaAccounts => Set<CanvaAccount>();
    public DbSet<Asset> Assets => Set<Asset>();
    public DbSet<ContentAsset> ContentAssets => Set<ContentAsset>();
    public DbSet<PlaylistAsset> PlaylistAssets => Set<PlaylistAsset>();
    public DbSet<Content> Contents => Set<Content>();
    public DbSet<Playlist> Playlists => Set<Playlist>();
    public DbSet<PlaylistItem> PlaylistItems => Set<PlaylistItem>();
    public DbSet<ContentPlaylist> ContentPlaylists => Set<ContentPlaylist>();
    public DbSet<Schedule> Schedules => Set<Schedule>();
    public DbSet<ScheduleItem> ScheduleItems => Set<ScheduleItem>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<DeviceScheduleLink> DeviceScheduleLinks => Set<DeviceScheduleLink>();
    public DbSet<DeviceScreenshot> DeviceScreenshots => Set<DeviceScreenshot>();
    public DbSet<DeviceManager> DeviceManagers => Set<DeviceManager>();
    public DbSet<DeviceGroup> DeviceGroups => Set<DeviceGroup>();
    public DbSet<DeviceGroupMember> DeviceGroupMembers => Set<DeviceGroupMember>();
    public DbSet<OrgBoard> OrgBoards => Set<OrgBoard>();
    public DbSet<OrgNotice> OrgNotices => Set<OrgNotice>();
    public DbSet<OrgNoticeItem> OrgNoticeItems => Set<OrgNoticeItem>();
    public DbSet<BoardPost> BoardPosts => Set<BoardPost>();
    public DbSet<CommunityPlaylist> CommunityPlaylists => Set<CommunityPlaylist>();
    public DbSet<CommunityPlaylistAsset> CommunityPlaylistAssets => Set<CommunityPlaylistAsset>();
    public DbSet<CommunitySetting> CommunitySettings => Set<CommunitySetting>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>()
            .HasMany(u => u.Roles).WithOne().HasForeignKey(r => r.UserId);
        modelBuilder.Entity<Asset>().Ignore(a => a.Token);

        modelBuilder.Entity<Content>(e =>
        {
            e.HasOne(c => c.Creator).WithMany().HasForeignKey(c => c.CreatedBy);
            e.HasMany(c => c.AssetLinks).WithOne().HasForeignKey(l => l.ContentId);
            e.HasMany(c => c.PlaylistLinks).WithOne().HasForeignKey(l => l.ContentId);
        });
        modelBuilder.Entity<Playlist>(e =>
        {
            e.HasOne(p => p.Creator).WithMany().HasForeignKey(p => p.CreatedBy);
            e.HasMany(p => p.Items).WithOne().HasForeignKey(i => i.PlaylistId);
            e.HasMany(p => p.ContentLinks).WithOne().HasForeignKey(l => l.PlaylistId);
            e.HasMany(p => p.AssetLinks).WithOne().HasForeignKey(l => l.PlaylistId);
        });
        modelBuilder.Entity<Schedule>(e =>
        {
            e.HasOne(s => s.Creator).WithMany().HasForeignKey(s => s.CreatedBy);
            e.HasMany(s => s.Items).WithOne().HasForeignKey(i => i.ScheduleId);
            e.HasMany(s => s.DeviceLinks).WithOne().HasForeignKey(l => l.ScheduleId);
        });
        modelBuilder.Entity<ScheduleItem>()
            .HasOne(i => i.ContentRef).WithMany().HasForeignKey(i => i.ContentId);
        // 삭제 규칙은 아래 setNull 목록이 정한다(전역 규칙이 fluent 설정을 덮는다).
        modelBuilder.Entity<ScheduleItem>()
            .HasOne(i => i.NoticeRef).WithMany().HasForeignKey(i => i.OrgNoticeId);
        modelBuilder.Entity<Device>(e =>
        {
            e.HasMany(d => d.ScheduleLinks).WithOne().HasForeignKey(l => l.DeviceId);
            e.HasMany(d => d.Managers).WithOne().HasForeignKey(m => m.DeviceId);
        });
        modelBuilder.Entity<DeviceScheduleLink>()
            .HasOne(l => l.Schedule).WithMany(s => s.DeviceLinks).HasForeignKey(l => l.ScheduleId);
        modelBuilder.Entity<DeviceScreenshot>().HasKey(s => s.DeviceId);
        modelBuilder.Entity<DeviceManager>()
            .HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId);
        modelBuilder.Entity<DeviceGroup>()
            .HasMany(g => g.Members).WithOne().HasForeignKey(m => m.GroupId);
        modelBuilder.Entity<OrgBoard>()
            .HasMany(b => b.Posts).WithOne().HasForeignKey(p => p.BoardId);
        modelBuilder.Entity<OrgNotice>()
            .HasMany(n => n.Items).WithOne().HasForeignKey(i => i.NoticeId);

        modelBuilder.Entity<CommunityPlaylist>(e =>
        {
            e.HasOne(p => p.Author).WithMany().HasForeignKey(p => p.AuthorId);
            e.HasMany(p => p.AssetLinks).WithOne().HasForeignKey(l => l.PlaylistId);
        });
        modelBuilder.Entity<CommunityPlaylistAsset>()
            .HasOne(l => l.Asset).WithMany().HasForeignKey(l => l.AssetId);

        ApplySchemaRules(modelBuilder);
    }

    // ------------------------------------------------------------ 스키마 규칙
    //
    // EF 가 스키마의 주인이 되면서 Alembic 에서 넘겨받은 살림 — 인덱스·유니크
    // 제약·FK 삭제 규칙·서버 기본값. 인덱스 이름을 Alembic 이 쓰던 그대로
    // 붙이는 이유: 베이스라인된 기존 DB 와 EF 가 새로 만든 DB 가 같은 이름을
    // 가져야, 나중 마이그레이션이 인덱스를 이름으로 지울 때 어느 쪽에서도
    // 깨지지 않는다.
    private static void ApplySchemaRules(ModelBuilder modelBuilder)
    {
        // FK 제약 — 탐색 속성이 없어 관계 설정에 안 잡히던 것들.
        modelBuilder.Entity<Organization>().HasOne<Organization>().WithMany().HasForeignKey(o => o.ParentId);
        modelBuilder.Entity<AppUser>().HasOne<Organization>().WithMany().HasForeignKey(u => u.OrgId);
        modelBuilder.Entity<LoginLog>().HasOne<AppUser>().WithMany().HasForeignKey(l => l.UserId);
        modelBuilder.Entity<Asset>().HasOne<Organization>().WithMany().HasForeignKey(a => a.OrgId);
        modelBuilder.Entity<Asset>().HasOne<AppUser>().WithMany().HasForeignKey(a => a.UploadedBy);
        modelBuilder.Entity<ContentAsset>().HasOne<Asset>().WithMany().HasForeignKey(l => l.AssetId);
        modelBuilder.Entity<PlaylistAsset>().HasOne<Asset>().WithMany().HasForeignKey(l => l.AssetId);
        modelBuilder.Entity<Content>().HasOne<Organization>().WithMany().HasForeignKey(c => c.OrgId);
        modelBuilder.Entity<Playlist>().HasOne<Organization>().WithMany().HasForeignKey(p => p.OrgId);
        modelBuilder.Entity<Schedule>().HasOne<Organization>().WithMany().HasForeignKey(s => s.OrgId);
        modelBuilder.Entity<Device>().HasOne<Organization>().WithMany().HasForeignKey(d => d.OrgId);
        modelBuilder.Entity<DeviceGroup>().HasOne<AppUser>().WithMany().HasForeignKey(g => g.UserId);
        modelBuilder.Entity<DeviceGroupMember>().HasOne<Device>().WithMany().HasForeignKey(m => m.DeviceId);
        modelBuilder.Entity<DeviceScreenshot>().HasOne<Device>().WithMany().HasForeignKey(s => s.DeviceId);
        modelBuilder.Entity<OrgBoard>().HasOne<Organization>().WithMany().HasForeignKey(b => b.OrgId);
        modelBuilder.Entity<OrgNotice>().HasOne<Organization>().WithMany().HasForeignKey(n => n.OrgId);
        modelBuilder.Entity<OrgNotice>().HasOne<AppUser>().WithMany().HasForeignKey(n => n.CreatedBy);
        modelBuilder.Entity<CanvaAccount>().HasOne<AppUser>().WithMany().HasForeignKey(a => a.UserId);
        modelBuilder.Entity<CanvaAccount>().HasIndex(a => a.UserId).IsUnique();
        modelBuilder.Entity<CommunityPlaylist>().HasOne<Organization>().WithMany().HasForeignKey(p => p.OrgId);
        modelBuilder.Entity<CommunitySetting>().HasOne<Organization>().WithMany().HasForeignKey(s => s.OrgId);

        // 삭제 규칙 — Alembic DDL 의 ON DELETE 와 같게. 아래 두 목록에 없으면
        // CASCADE 다(연결 테이블·소속 자료). 기관은 소속 자료가 남아 있으면
        // 지워지지 않아야 하므로(RESTRICT) API 가 먼저 검사하고 DB 가 최종
        // 방어선이 된다.
        var restrict = new HashSet<(string, string)>
        {
            ("Organization", "ParentId"), ("AppUser", "OrgId"), ("Asset", "OrgId"),
            ("Content", "OrgId"), ("Playlist", "OrgId"), ("Schedule", "OrgId"),
            ("Device", "OrgId"),
        };
        var setNull = new HashSet<(string, string)>
        {
            ("Asset", "UploadedBy"), ("Content", "CreatedBy"), ("Playlist", "CreatedBy"),
            ("Schedule", "CreatedBy"), ("ScheduleItem", "ContentId"),
            ("ScheduleItem", "OrgNoticeId"), ("LoginLog", "UserId"),
            ("CommunityPlaylist", "AuthorId"), ("OrgNotice", "CreatedBy"),
        };
        foreach (var fk in modelBuilder.Model.GetEntityTypes().SelectMany(t => t.GetForeignKeys()))
        {
            var key = (fk.DeclaringEntityType.ClrType.Name, fk.Properties[0].Name);
            fk.DeleteBehavior = restrict.Contains(key) ? DeleteBehavior.Restrict
                : setNull.Contains(key) ? DeleteBehavior.SetNull
                : DeleteBehavior.Cascade;
        }

        // 인덱스 — (엔티티, 속성, 이름, 유니크). 이름은 Alembic 의 것.
        var indexes = new (Type Entity, string[] Props, string Name, bool Unique)[]
        {
            (typeof(OrgTypeDef), ["Name"], "uq_org_type_name", true),
            (typeof(Organization), ["ParentId"], "ix_organization_parent_id", false),
            (typeof(Organization), ["EduOfficeCode"], "ix_organization_edu_office_code", false),
            (typeof(Organization), ["SchoolCode"], "ix_organization_school_code", false),
            (typeof(Organization), ["EduOfficeCode", "SchoolCode"], "uq_org_school_code", true),
            (typeof(AppUser), ["OrgId"], "ix_app_user_org_id", false),
            (typeof(AppUser), ["UserId"], "ix_app_user_user_id", true),
            (typeof(UserRole), ["UserId"], "ix_user_role_user_id", false),
            (typeof(UserRole), ["UserId", "Role"], "uq_user_role", true),
            (typeof(LoginLog), ["UserId"], "ix_login_log_user_id", false),
            (typeof(LoginLog), ["CreatedAt"], "ix_login_log_created_at", false),
            (typeof(Asset), ["OrgId"], "ix_asset_org_id", false),
            (typeof(Asset), ["UploadedBy"], "ix_asset_uploaded_by", false),
            (typeof(Asset), ["Kind"], "ix_asset_kind", false),
            (typeof(ContentAsset), ["ContentId"], "ix_content_asset_content_id", false),
            (typeof(ContentAsset), ["AssetId"], "ix_content_asset_asset_id", false),
            (typeof(ContentAsset), ["ContentId", "AssetId"], "uq_content_asset", true),
            (typeof(PlaylistAsset), ["PlaylistId"], "ix_playlist_asset_playlist_id", false),
            (typeof(PlaylistAsset), ["AssetId"], "ix_playlist_asset_asset_id", false),
            (typeof(PlaylistAsset), ["PlaylistId", "AssetId"], "uq_playlist_asset", true),
            (typeof(Content), ["OrgId"], "ix_content_org_id", false),
            (typeof(Content), ["CreatedBy"], "ix_content_created_by", false),
            (typeof(Content), ["Name"], "ix_content_name", false),
            (typeof(Playlist), ["OrgId"], "ix_playlist_org_id", false),
            (typeof(Playlist), ["CreatedBy"], "ix_playlist_created_by", false),
            (typeof(Playlist), ["Name"], "ix_playlist_name", false),
            (typeof(PlaylistItem), ["PlaylistId"], "ix_playlist_item_playlist_id", false),
            (typeof(ContentPlaylist), ["ContentId"], "ix_content_playlist_content_id", false),
            (typeof(ContentPlaylist), ["PlaylistId"], "ix_content_playlist_playlist_id", false),
            (typeof(ContentPlaylist), ["ContentId", "PlaylistId"], "uq_content_playlist", true),
            (typeof(Schedule), ["OrgId"], "ix_schedule_org_id", false),
            (typeof(Schedule), ["CreatedBy"], "ix_schedule_created_by", false),
            (typeof(ScheduleItem), ["ScheduleId"], "ix_schedule_item_schedule_id", false),
            (typeof(ScheduleItem), ["ContentId"], "ix_schedule_item_content_id", false),
            (typeof(Device), ["OrgId"], "ix_device_org_id", false),
            (typeof(Device), ["DeviceCode"], "ix_device_device_code", true),
            (typeof(DeviceScheduleLink), ["DeviceId"], "ix_device_schedule_device_id", false),
            (typeof(DeviceScheduleLink), ["ScheduleId"], "ix_device_schedule_schedule_id", false),
            (typeof(DeviceScheduleLink), ["DeviceId", "ScheduleId"], "uq_device_schedule", true),
            (typeof(DeviceManager), ["DeviceId"], "ix_device_manager_device_id", false),
            (typeof(DeviceManager), ["UserId"], "ix_device_manager_user_id", false),
            (typeof(DeviceManager), ["DeviceId", "UserId"], "uq_device_manager", true),
            (typeof(DeviceGroup), ["UserId"], "ix_device_group_user_id", false),
            (typeof(DeviceGroupMember), ["GroupId"], "ix_device_group_member_group_id", false),
            (typeof(DeviceGroupMember), ["DeviceId"], "ix_device_group_member_device_id", false),
            (typeof(DeviceGroupMember), ["GroupId", "DeviceId"], "uq_device_group_member", true),
            (typeof(OrgBoard), ["OrgId"], "ix_org_board_org_id", false),
            (typeof(OrgNotice), ["OrgId"], "ix_org_notice_org_id", false),
            (typeof(OrgNotice), ["CreatedBy"], "ix_org_notice_created_by", false),
            (typeof(OrgNoticeItem), ["NoticeId"], "ix_org_notice_item_notice_id", false),
            (typeof(BoardPost), ["BoardId"], "ix_board_post_board_id", false),
            (typeof(BoardPost), ["BoardId", "Year", "Month", "Day"], "ix_board_post_period", false),
            (typeof(CommunityPlaylist), ["OrgId"], "ix_community_playlist_org_id", false),
            (typeof(CommunityPlaylist), ["AuthorId"], "ix_community_playlist_author_id", false),
            (typeof(CommunityPlaylistAsset), ["PlaylistId"], "ix_community_playlist_asset_playlist_id", false),
            (typeof(CommunityPlaylistAsset), ["AssetId"], "ix_community_playlist_asset_asset_id", false),
            (typeof(CommunityPlaylistAsset), ["PlaylistId", "AssetId"], "uq_community_playlist_asset", true),
            (typeof(CommunitySetting), ["OrgId"], "uq_community_setting_org_id", true),
        };
        foreach (var (entity, props, name, unique) in indexes)
        {
            var index = modelBuilder.Entity(entity).HasIndex(props).HasDatabaseName(name);
            if (unique) index.IsUnique();
        }

        // created_at/updated_at 서버 기본값 — login_log 와 device_screenshot 은
        // Alembic 도 기본값을 두지 않았으니 그대로 둔다.
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            if (entity.ClrType == typeof(LoginLog) || entity.ClrType == typeof(DeviceScreenshot))
                continue;
            foreach (var name in new[] { "CreatedAt", "UpdatedAt" })
                entity.FindProperty(name)?.SetDefaultValueSql("CURRENT_TIMESTAMP");
        }

        // 낱개 서버 기본값 — Alembic DDL 의 server_default 와 같게.
        // (share_scope 는 EF 가 주인이 된 뒤 추가된 열이다.)
        modelBuilder.Entity<Content>().Property(c => c.ShareScope).HasDefaultValue("없음");
        modelBuilder.Entity<DeviceScheduleLink>().Property(l => l.SortOrder).HasDefaultValue(0);
        modelBuilder.Entity<PlaylistItem>().Property(i => i.Transition).HasDefaultValue("none");
        modelBuilder.Entity<PlaylistItem>().Property(i => i.TransitionMs).HasDefaultValue(600);
        modelBuilder.Entity<ScheduleItem>().Property(i => i.Transition).HasDefaultValue("none");
        modelBuilder.Entity<ScheduleItem>().Property(i => i.TransitionMs).HasDefaultValue(600);
        modelBuilder.Entity<Schedule>().Property(s => s.Orientation).HasDefaultValue("LANDSCAPE");
        modelBuilder.Entity<CommunityPlaylist>().Property(p => p.PublishStatus).HasDefaultValue("대기중");
        modelBuilder.Entity<CommunityPlaylist>().Property(p => p.ItemsJson).HasDefaultValue("[]");
    }
}

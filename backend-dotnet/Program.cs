// SignalLink Green — .NET Core 백엔드 (**기준 백엔드**).
//
// 이 프로젝트가 기준 구현이다: 스키마(EF Core 마이그레이션, Migrations/)와
// 부트스트랩(최상위 기관·admin)을 이쪽이 맡는다. FastAPI(../backend)는 같은
// DB·같은 API 계약 위의 병행 구현으로 남는다 — Alembic 은 d491ad229086 에서
// 동결됐고, 그 시절 DB 는 기동 시 베이스라인으로 흡수한다(DbStartup).
// PARITY.txt 에 라우트 이식·스키마 소유권 내역을 적어 둔다.
//
// 계약을 맞추는 세 가지:
//   1. 같은 DB      — DatabaseUrl 이 비면 ../backend/signallink.db (SQLite),
//                     postgresql:// 이면 Npgsql. 스키마는 EF 마이그레이션의 것이다.
//   2. 같은 토큰     — HS256 + 같은 비밀키. 서로 발급한 토큰을 서로 받는다.
//   3. 같은 응답 모양 — snake_case JSON. 프런트가 어느 쪽에 붙어도 같게 돈다.

using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SignalLink.Api.Data;
using SignalLink.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// FastAPI 와 **같은 .env** 를 읽는다 — 비밀키·DB 주소의 원본이 두 곳이면
// 언젠가 어긋나 "한쪽에서 발급한 토큰을 다른 쪽이 거부"하게 된다.
// .NET 쪽 환경변수·appsettings 값이 있으면 그쪽이 이긴다.
var envPath = Path.Combine(builder.Environment.ContentRootPath, "..", "backend", ".env");
if (File.Exists(envPath))
{
    var mapping = new Dictionary<string, string>
    {
        ["SECRET_KEY"] = "SecretKey",
        ["DATABASE_URL"] = "DatabaseUrl",
        ["ACCESS_TOKEN_EXPIRE_MINUTES"] = "AccessTokenExpireMinutes",
        ["DEVICE_MASTER_KEY"] = "DeviceMasterKey",
        ["PIXABAY_API_KEY"] = "PixabayApiKey",
        ["CANVA_CLIENT_ID"] = "CanvaClientId",
        ["CANVA_CLIENT_SECRET"] = "CanvaClientSecret",
        ["CANVA_REDIRECT_URI"] = "CanvaRedirectUri",
        ["PIXABAY_TIMEOUT_SEC"] = "PixabayTimeoutSec",
        ["HEARTBEAT_INTERVAL_SEC"] = "HeartbeatIntervalSec",
        ["CORS_ORIGINS"] = "CorsOrigins",
        ["PASSWORD_COMPLEXITY"] = "PasswordComplexity",
        ["BOOTSTRAP_ADMIN_ID"] = "BootstrapAdminId",
        ["BOOTSTRAP_ADMIN_PASSWORD"] = "BootstrapAdminPassword",
        ["ROOT_ORG_NAME"] = "RootOrgName",
    };
    foreach (var line in File.ReadAllLines(envPath))
    {
        var trimmed = line.Trim();
        if (trimmed.Length == 0 || trimmed.StartsWith('#') || !trimmed.Contains('=')) continue;
        var parts = trimmed.Split('=', 2);
        if (mapping.TryGetValue(parts[0], out var key)
            && parts[1].Length > 0
            && builder.Configuration[key] is null)
        {
            builder.Configuration[key] = parts[1];
        }
    }
}

// FastAPI(8015)와 나란히 — 프런트 프록시가 고르는 쪽으로 붙는다.
builder.WebHost.UseUrls(builder.Configuration["Urls"] ?? "http://127.0.0.1:8016");

// 업로드 본문 상한 — Kestrel 기본(~28.6MB)이 동영상 업로드를 연결 끊김으로
// 죽였다. 상한은 자산 규칙(이미지 200MB/동영상 100MB)이 정하므로, 전송
// 한도는 그보다 넉넉히 두고 최종 거절은 앱이 메시지와 함께 한다.
const long UploadBodyLimit = 220L * 1024 * 1024;
builder.WebHost.ConfigureKestrel(options =>
    options.Limits.MaxRequestBodySize = UploadBodyLimit);
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options =>
    options.MultipartBodyLengthLimit = UploadBodyLimit);

// ---------------------------------------------------------------- DB
var databaseUrl = builder.Configuration["DatabaseUrl"] ?? "";
builder.Services.AddDbContext<AppDbContext>(options =>
{
    // EF 10 의 기동 시 '마이그레이션 누락' 경고는 우리처럼 OnModelCreating 에서
    // 모델을 동적으로 손보는 경우 거짓 양성을 낸다. 진짜 비교는
    // `dotnet ef migrations has-pending-model-changes` 가 한다(현재: 변경 없음,
    // 탐침 마이그레이션도 빈 것으로 확인). 그래서 이 경고만 끈다.
    options.ConfigureWarnings(warnings =>
        warnings.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning));
    if (databaseUrl.StartsWith("postgresql"))
    {
        // .env 의 URL 형식을 Npgsql 이 먹는 key=value 로 변환한다.
        options.UseNpgsql(SignalLink.Api.Services.DatabaseUrls.ToNpgsql(databaseUrl));
    }
    else
    {
        // 개발 기본: FastAPI 와 같은 SQLite 파일.
        var dbPath = builder.Configuration["SqlitePath"]
            ?? Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "backend", "signallink.db"));
        options.UseSqlite($"Data Source={dbPath}");
    }
});

// ---------------------------------------------------------------- 인증
var secretKey = builder.Configuration["SecretKey"] ?? "dev-secret-key-change-me";
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // pyjwt 가 만든 토큰을 그대로 받는다 — 발급자·대상 검증은 없다
        // (파이썬 쪽도 넣지 않는다). 서명과 만료만 본다.
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(SecurityKeys.Hmac(secretKey)),
            ClockSkew = TimeSpan.FromSeconds(30),
        };
        // 'sub' 를 표준 NameIdentifier 로 바꿔치기하지 않게 둔다.
        options.MapInboundClaims = false;
    });
builder.Services.AddAuthorization();

builder.Services.AddScoped<OrgTreeService>();
builder.Services.AddScoped<PermissionService>();
builder.Services.AddScoped<AssetService>();
builder.Services.AddScoped<VideoTranscodeService>();
builder.Services.AddScoped<CanvaConnectService>();
builder.Services.AddScoped<PlaylistLinkService>();
builder.Services.AddScoped<ScheduleCoreService>();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddSingleton<DeviceCrypto>();
builder.Services.AddSingleton<ConnectionHub>();
builder.Services.AddSingleton<NotifyService>();
builder.Services.AddScoped<DeviceAuthService>();
builder.Services.AddScoped<WidgetDataService>();
builder.Services.AddHttpClient();

// FastAPI(pydantic)와 같은 snake_case JSON — 프런트가 어느 백엔드에 붙어도
// 필드 이름이 같아야 한다.
builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    options.JsonSerializerOptions.DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower;
});
builder.Services.AddOpenApi();

// 프런트 개발 서버가 프록시 없이 직접 붙는 경우 — FastAPI 와 같은 원본 목록.
var corsOrigins = (builder.Configuration["CorsOrigins"] ?? "http://localhost:5173,http://127.0.0.1:5173")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

var app = builder.Build();

// 스키마와 부트스트랩 — 스키마의 주인은 이제 EF 마이그레이션이다. 기존
// Alembic DB 는 베이스라인으로 흡수하고, 새 DB 는 처음부터 만든다.
using (var scope = app.Services.CreateScope())
{
    DbStartup.Prepare(
        scope.ServiceProvider.GetRequiredService<AppDbContext>(),
        app.Configuration,
        app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("DbStartup"));
}

// IIS 하위 앱(/api)으로 마운트되면 IIS 가 /api 를 벗겨 /v1/... 만 남는다.
// 라우트는 /api/v1/... 이므로 접두사를 되살린다 — 독립 실행(8016)에서는
// /v1 로 시작하는 요청이 없어 아무 일도 하지 않는다.
app.Use((context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/v1"))
        context.Request.Path = "/api" + context.Request.Path;
    return next(context);
});
// UseRouting 을 명시해야 위 재작성이 라우트 매칭보다 먼저 돈다 —
// 안 그러면 WebApplication 이 라우팅을 파이프라인 맨 앞에 심는다.
app.UseRouting();

app.MapOpenApi();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
// 토큰의 사용자를 한 번 읽어 싣고, 커뮤니티 울타리를 지킨다(deps.py 의 짝).
app.UseMiddleware<SignalLink.Api.Services.RequestUserMiddleware>();
app.UseWebSockets();
app.MapControllers();

// 살아 있는지 — 배포 스크립트와 프록시가 두 백엔드를 같은 방식으로 찔러 본다.
// FastAPI 는 루트 /health 를 쓰므로 둘 다 열어 둔다.
app.MapGet("/api/v1/health", () => new { status = "ok", backend = "dotnet" });
app.MapGet("/health", () => new { status = "ok", backend = "dotnet" });

app.Run();

// 통합 테스트(WebApplicationFactory<Program>)가 진입점을 참조할 수 있게 연다.
public partial class Program { }

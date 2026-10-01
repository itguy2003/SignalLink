using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalLink.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "organization",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    address = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    org_type = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    school_level = table.Column<string>(type: "TEXT", maxLength: 10, nullable: true),
                    parent_id = table.Column<int>(type: "INTEGER", nullable: true),
                    latitude = table.Column<double>(type: "REAL", nullable: true),
                    longitude = table.Column<double>(type: "REAL", nullable: true),
                    edu_office_code = table.Column<string>(type: "TEXT", maxLength: 20, nullable: true),
                    school_code = table.Column<string>(type: "TEXT", maxLength: 20, nullable: true),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_organization", x => x.id);
                    table.ForeignKey(
                        name: "FK_organization_organization_parent_id",
                        column: x => x.parent_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "app_user",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    user_id = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false),
                    password_hash = table.Column<string>(type: "TEXT", maxLength: 255, nullable: false),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    phone = table.Column<string>(type: "TEXT", maxLength: 30, nullable: true),
                    email = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    status = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_user", x => x.id);
                    table.ForeignKey(
                        name: "FK_app_user_organization_org_id",
                        column: x => x.org_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "device",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    device_code = table.Column<string>(type: "TEXT", maxLength: 12, nullable: false),
                    name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    os = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    form_factor = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    panel_type = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    width = table.Column<int>(type: "INTEGER", nullable: true),
                    height = table.Column<int>(type: "INTEGER", nullable: true),
                    place_name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    place_kind = table.Column<string>(type: "TEXT", maxLength: 20, nullable: true),
                    device_kind = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    grade = table.Column<int>(type: "INTEGER", nullable: true),
                    class_no = table.Column<int>(type: "INTEGER", nullable: true),
                    class_name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    track = table.Column<string>(type: "TEXT", maxLength: 50, nullable: true),
                    is_master = table.Column<bool>(type: "INTEGER", nullable: false),
                    cpu = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    memory = table.Column<string>(type: "TEXT", maxLength: 50, nullable: true),
                    storage = table.Column<string>(type: "TEXT", maxLength: 50, nullable: true),
                    storage_total_bytes = table.Column<long>(type: "INTEGER", nullable: true),
                    storage_free_bytes = table.Column<long>(type: "INTEGER", nullable: true),
                    storage_reported_at = table.Column<DateTime>(type: "TEXT", nullable: true),
                    version = table.Column<int>(type: "INTEGER", nullable: false),
                    last_seen_at = table.Column<DateTime>(type: "TEXT", nullable: true),
                    app_version = table.Column<string>(type: "TEXT", maxLength: 50, nullable: true),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_device", x => x.id);
                    table.ForeignKey(
                        name: "FK_device_organization_org_id",
                        column: x => x.org_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "org_board",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    kind = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    url = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: false),
                    scrape_method = table.Column<string>(type: "TEXT", maxLength: 50, nullable: true),
                    scrape_result = table.Column<string>(type: "TEXT", maxLength: 10, nullable: true),
                    scrape_count = table.Column<int>(type: "INTEGER", nullable: false),
                    last_scraped_at = table.Column<DateTime>(type: "TEXT", nullable: true),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_org_board", x => x.id);
                    table.ForeignKey(
                        name: "FK_org_board_organization_org_id",
                        column: x => x.org_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "asset",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    uploaded_by = table.Column<int>(type: "INTEGER", nullable: true),
                    kind = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    filename = table.Column<string>(type: "TEXT", maxLength: 255, nullable: false),
                    content_type = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    size_bytes = table.Column<long>(type: "INTEGER", nullable: false),
                    storage_path = table.Column<string>(type: "TEXT", maxLength: 300, nullable: false),
                    thumb_path = table.Column<string>(type: "TEXT", maxLength: 300, nullable: true),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_asset", x => x.id);
                    table.ForeignKey(
                        name: "FK_asset_app_user_uploaded_by",
                        column: x => x.uploaded_by,
                        principalTable: "app_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_asset_organization_org_id",
                        column: x => x.org_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "community_content",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    author_id = table.Column<int>(type: "INTEGER", nullable: true),
                    title = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    document = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "{}"),
                    start_date = table.Column<string>(type: "TEXT", maxLength: 10, nullable: true),
                    end_date = table.Column<string>(type: "TEXT", maxLength: 10, nullable: true),
                    audience = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false, defaultValue: "전체"),
                    version = table.Column<int>(type: "INTEGER", nullable: false),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_community_content", x => x.id);
                    table.ForeignKey(
                        name: "FK_community_content_app_user_author_id",
                        column: x => x.author_id,
                        principalTable: "app_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_community_content_organization_org_id",
                        column: x => x.org_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "community_playlist",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    author_id = table.Column<int>(type: "INTEGER", nullable: true),
                    name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    items = table.Column<string>(type: "TEXT", nullable: false),
                    version = table.Column<int>(type: "INTEGER", nullable: false),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_community_playlist", x => x.id);
                    table.ForeignKey(
                        name: "FK_community_playlist_app_user_author_id",
                        column: x => x.author_id,
                        principalTable: "app_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_community_playlist_organization_org_id",
                        column: x => x.org_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "community_post",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    author_id = table.Column<int>(type: "INTEGER", nullable: true),
                    title = table.Column<string>(type: "TEXT", maxLength: 500, nullable: false),
                    content = table.Column<string>(type: "TEXT", nullable: true),
                    contact_phone = table.Column<string>(type: "TEXT", maxLength: 30, nullable: true),
                    contact_email = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    publish_status = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false, defaultValue: "대기중"),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_community_post", x => x.id);
                    table.ForeignKey(
                        name: "FK_community_post_app_user_author_id",
                        column: x => x.author_id,
                        principalTable: "app_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_community_post_organization_org_id",
                        column: x => x.org_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "content",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    created_by = table.Column<int>(type: "INTEGER", nullable: true),
                    width = table.Column<int>(type: "INTEGER", nullable: false),
                    height = table.Column<int>(type: "INTEGER", nullable: false),
                    document = table.Column<string>(type: "TEXT", nullable: false),
                    version = table.Column<int>(type: "INTEGER", nullable: false),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_content", x => x.id);
                    table.ForeignKey(
                        name: "FK_content_app_user_created_by",
                        column: x => x.created_by,
                        principalTable: "app_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_content_organization_org_id",
                        column: x => x.org_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "device_group",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    user_id = table.Column<int>(type: "INTEGER", nullable: false),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_device_group", x => x.id);
                    table.ForeignKey(
                        name: "FK_device_group_app_user_user_id",
                        column: x => x.user_id,
                        principalTable: "app_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "login_log",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    user_id = table.Column<int>(type: "INTEGER", nullable: true),
                    attempted_user_id = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false),
                    success = table.Column<bool>(type: "INTEGER", nullable: false),
                    ip_address = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true),
                    user_agent = table.Column<string>(type: "TEXT", maxLength: 300, nullable: true),
                    reason = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_login_log", x => x.id);
                    table.ForeignKey(
                        name: "FK_login_log_app_user_user_id",
                        column: x => x.user_id,
                        principalTable: "app_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "playlist",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    created_by = table.Column<int>(type: "INTEGER", nullable: true),
                    version = table.Column<int>(type: "INTEGER", nullable: false),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_playlist", x => x.id);
                    table.ForeignKey(
                        name: "FK_playlist_app_user_created_by",
                        column: x => x.created_by,
                        principalTable: "app_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_playlist_organization_org_id",
                        column: x => x.org_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "schedule",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    kind = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    orientation = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false, defaultValue: "LANDSCAPE"),
                    start_at = table.Column<DateTime>(type: "TEXT", nullable: true),
                    end_at = table.Column<DateTime>(type: "TEXT", nullable: true),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    created_by = table.Column<int>(type: "INTEGER", nullable: true),
                    version = table.Column<int>(type: "INTEGER", nullable: false),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule", x => x.id);
                    table.ForeignKey(
                        name: "FK_schedule_app_user_created_by",
                        column: x => x.created_by,
                        principalTable: "app_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_schedule_organization_org_id",
                        column: x => x.org_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "user_role",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    user_id = table.Column<int>(type: "INTEGER", nullable: false),
                    role = table.Column<string>(type: "TEXT", maxLength: 30, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_role", x => x.id);
                    table.ForeignKey(
                        name: "FK_user_role_app_user_user_id",
                        column: x => x.user_id,
                        principalTable: "app_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "device_manager",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    device_id = table.Column<int>(type: "INTEGER", nullable: false),
                    user_id = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_device_manager", x => x.id);
                    table.ForeignKey(
                        name: "FK_device_manager_app_user_user_id",
                        column: x => x.user_id,
                        principalTable: "app_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_device_manager_device_device_id",
                        column: x => x.device_id,
                        principalTable: "device",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "device_screenshot",
                columns: table => new
                {
                    device_id = table.Column<int>(type: "INTEGER", nullable: false),
                    image = table.Column<byte[]>(type: "BLOB", nullable: false),
                    content_type = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false),
                    captured_at = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_device_screenshot", x => x.device_id);
                    table.ForeignKey(
                        name: "FK_device_screenshot_device_device_id",
                        column: x => x.device_id,
                        principalTable: "device",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "board_post",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    board_id = table.Column<int>(type: "INTEGER", nullable: false),
                    title = table.Column<string>(type: "TEXT", maxLength: 500, nullable: false),
                    author = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    posted_on = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    year = table.Column<int>(type: "INTEGER", nullable: true),
                    month = table.Column<int>(type: "INTEGER", nullable: true),
                    day = table.Column<int>(type: "INTEGER", nullable: true),
                    term = table.Column<int>(type: "INTEGER", nullable: true),
                    content = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_board_post", x => x.id);
                    table.ForeignKey(
                        name: "FK_board_post_org_board_board_id",
                        column: x => x.board_id,
                        principalTable: "org_board",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "community_content_asset",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    content_id = table.Column<int>(type: "INTEGER", nullable: false),
                    asset_id = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_community_content_asset", x => x.id);
                    table.ForeignKey(
                        name: "FK_community_content_asset_asset_asset_id",
                        column: x => x.asset_id,
                        principalTable: "asset",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_community_content_asset_community_content_content_id",
                        column: x => x.content_id,
                        principalTable: "community_content",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "community_post_asset",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    post_id = table.Column<int>(type: "INTEGER", nullable: false),
                    asset_id = table.Column<int>(type: "INTEGER", nullable: false),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_community_post_asset", x => x.id);
                    table.ForeignKey(
                        name: "FK_community_post_asset_asset_asset_id",
                        column: x => x.asset_id,
                        principalTable: "asset",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_community_post_asset_community_post_post_id",
                        column: x => x.post_id,
                        principalTable: "community_post",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "content_asset",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    content_id = table.Column<int>(type: "INTEGER", nullable: false),
                    asset_id = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_content_asset", x => x.id);
                    table.ForeignKey(
                        name: "FK_content_asset_asset_asset_id",
                        column: x => x.asset_id,
                        principalTable: "asset",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_content_asset_content_content_id",
                        column: x => x.content_id,
                        principalTable: "content",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "device_group_member",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    group_id = table.Column<int>(type: "INTEGER", nullable: false),
                    device_id = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_device_group_member", x => x.id);
                    table.ForeignKey(
                        name: "FK_device_group_member_device_device_id",
                        column: x => x.device_id,
                        principalTable: "device",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_device_group_member_device_group_group_id",
                        column: x => x.group_id,
                        principalTable: "device_group",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "content_playlist",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    content_id = table.Column<int>(type: "INTEGER", nullable: false),
                    playlist_id = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_content_playlist", x => x.id);
                    table.ForeignKey(
                        name: "FK_content_playlist_content_content_id",
                        column: x => x.content_id,
                        principalTable: "content",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_content_playlist_playlist_playlist_id",
                        column: x => x.playlist_id,
                        principalTable: "playlist",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "playlist_asset",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    playlist_id = table.Column<int>(type: "INTEGER", nullable: false),
                    asset_id = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_playlist_asset", x => x.id);
                    table.ForeignKey(
                        name: "FK_playlist_asset_asset_asset_id",
                        column: x => x.asset_id,
                        principalTable: "asset",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_playlist_asset_playlist_playlist_id",
                        column: x => x.playlist_id,
                        principalTable: "playlist",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "playlist_item",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    playlist_id = table.Column<int>(type: "INTEGER", nullable: false),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false),
                    widget_key = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false),
                    duration_sec = table.Column<int>(type: "INTEGER", nullable: false),
                    options = table.Column<string>(type: "TEXT", nullable: false),
                    transition = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false, defaultValue: "none"),
                    transition_ms = table.Column<int>(type: "INTEGER", nullable: false, defaultValue: 600)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_playlist_item", x => x.id);
                    table.ForeignKey(
                        name: "FK_playlist_item_playlist_playlist_id",
                        column: x => x.playlist_id,
                        principalTable: "playlist",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "device_schedule",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    device_id = table.Column<int>(type: "INTEGER", nullable: false),
                    schedule_id = table.Column<int>(type: "INTEGER", nullable: false),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false, defaultValue: 0)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_device_schedule", x => x.id);
                    table.ForeignKey(
                        name: "FK_device_schedule_device_device_id",
                        column: x => x.device_id,
                        principalTable: "device",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_device_schedule_schedule_schedule_id",
                        column: x => x.schedule_id,
                        principalTable: "schedule",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "schedule_item",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    schedule_id = table.Column<int>(type: "INTEGER", nullable: false),
                    day_of_week = table.Column<int>(type: "INTEGER", nullable: false),
                    start_time = table.Column<TimeOnly>(type: "TEXT", nullable: true),
                    end_time = table.Column<TimeOnly>(type: "TEXT", nullable: true),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false),
                    duration_sec = table.Column<int>(type: "INTEGER", nullable: false),
                    content_id = table.Column<int>(type: "INTEGER", nullable: true),
                    content = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_item", x => x.id);
                    table.ForeignKey(
                        name: "FK_schedule_item_content_content_id",
                        column: x => x.content_id,
                        principalTable: "content",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_schedule_item_schedule_schedule_id",
                        column: x => x.schedule_id,
                        principalTable: "schedule",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_app_user_org_id",
                table: "app_user",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_app_user_user_id",
                table: "app_user",
                column: "user_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_asset_kind",
                table: "asset",
                column: "kind");

            migrationBuilder.CreateIndex(
                name: "ix_asset_org_id",
                table: "asset",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_asset_uploaded_by",
                table: "asset",
                column: "uploaded_by");

            migrationBuilder.CreateIndex(
                name: "ix_board_post_board_id",
                table: "board_post",
                column: "board_id");

            migrationBuilder.CreateIndex(
                name: "ix_board_post_period",
                table: "board_post",
                columns: new[] { "board_id", "year", "month", "day" });

            migrationBuilder.CreateIndex(
                name: "ix_community_content_author_id",
                table: "community_content",
                column: "author_id");

            migrationBuilder.CreateIndex(
                name: "ix_community_content_org_id",
                table: "community_content",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_community_content_asset_asset_id",
                table: "community_content_asset",
                column: "asset_id");

            migrationBuilder.CreateIndex(
                name: "ix_community_content_asset_content_id",
                table: "community_content_asset",
                column: "content_id");

            migrationBuilder.CreateIndex(
                name: "uq_community_content_asset",
                table: "community_content_asset",
                columns: new[] { "content_id", "asset_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_community_playlist_author_id",
                table: "community_playlist",
                column: "author_id");

            migrationBuilder.CreateIndex(
                name: "ix_community_playlist_org_id",
                table: "community_playlist",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_community_post_author_id",
                table: "community_post",
                column: "author_id");

            migrationBuilder.CreateIndex(
                name: "ix_community_post_org_id",
                table: "community_post",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_community_post_asset_asset_id",
                table: "community_post_asset",
                column: "asset_id");

            migrationBuilder.CreateIndex(
                name: "ix_community_post_asset_post_id",
                table: "community_post_asset",
                column: "post_id");

            migrationBuilder.CreateIndex(
                name: "uq_community_post_asset",
                table: "community_post_asset",
                columns: new[] { "post_id", "asset_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_content_created_by",
                table: "content",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_content_name",
                table: "content",
                column: "name");

            migrationBuilder.CreateIndex(
                name: "ix_content_org_id",
                table: "content",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_content_asset_asset_id",
                table: "content_asset",
                column: "asset_id");

            migrationBuilder.CreateIndex(
                name: "ix_content_asset_content_id",
                table: "content_asset",
                column: "content_id");

            migrationBuilder.CreateIndex(
                name: "uq_content_asset",
                table: "content_asset",
                columns: new[] { "content_id", "asset_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_content_playlist_content_id",
                table: "content_playlist",
                column: "content_id");

            migrationBuilder.CreateIndex(
                name: "ix_content_playlist_playlist_id",
                table: "content_playlist",
                column: "playlist_id");

            migrationBuilder.CreateIndex(
                name: "uq_content_playlist",
                table: "content_playlist",
                columns: new[] { "content_id", "playlist_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_device_device_code",
                table: "device",
                column: "device_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_device_org_id",
                table: "device",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_device_group_user_id",
                table: "device_group",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_device_group_member_device_id",
                table: "device_group_member",
                column: "device_id");

            migrationBuilder.CreateIndex(
                name: "ix_device_group_member_group_id",
                table: "device_group_member",
                column: "group_id");

            migrationBuilder.CreateIndex(
                name: "uq_device_group_member",
                table: "device_group_member",
                columns: new[] { "group_id", "device_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_device_manager_device_id",
                table: "device_manager",
                column: "device_id");

            migrationBuilder.CreateIndex(
                name: "ix_device_manager_user_id",
                table: "device_manager",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "uq_device_manager",
                table: "device_manager",
                columns: new[] { "device_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_device_schedule_device_id",
                table: "device_schedule",
                column: "device_id");

            migrationBuilder.CreateIndex(
                name: "ix_device_schedule_schedule_id",
                table: "device_schedule",
                column: "schedule_id");

            migrationBuilder.CreateIndex(
                name: "uq_device_schedule",
                table: "device_schedule",
                columns: new[] { "device_id", "schedule_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_login_log_created_at",
                table: "login_log",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "ix_login_log_user_id",
                table: "login_log",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_org_board_org_id",
                table: "org_board",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_organization_edu_office_code",
                table: "organization",
                column: "edu_office_code");

            migrationBuilder.CreateIndex(
                name: "ix_organization_parent_id",
                table: "organization",
                column: "parent_id");

            migrationBuilder.CreateIndex(
                name: "ix_organization_school_code",
                table: "organization",
                column: "school_code");

            migrationBuilder.CreateIndex(
                name: "uq_org_school_code",
                table: "organization",
                columns: new[] { "edu_office_code", "school_code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_playlist_created_by",
                table: "playlist",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_playlist_name",
                table: "playlist",
                column: "name");

            migrationBuilder.CreateIndex(
                name: "ix_playlist_org_id",
                table: "playlist",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_playlist_asset_asset_id",
                table: "playlist_asset",
                column: "asset_id");

            migrationBuilder.CreateIndex(
                name: "ix_playlist_asset_playlist_id",
                table: "playlist_asset",
                column: "playlist_id");

            migrationBuilder.CreateIndex(
                name: "uq_playlist_asset",
                table: "playlist_asset",
                columns: new[] { "playlist_id", "asset_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_playlist_item_playlist_id",
                table: "playlist_item",
                column: "playlist_id");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_created_by",
                table: "schedule",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_org_id",
                table: "schedule",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_item_content_id",
                table: "schedule_item",
                column: "content_id");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_item_schedule_id",
                table: "schedule_item",
                column: "schedule_id");

            migrationBuilder.CreateIndex(
                name: "ix_user_role_user_id",
                table: "user_role",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "uq_user_role",
                table: "user_role",
                columns: new[] { "user_id", "role" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "board_post");

            migrationBuilder.DropTable(
                name: "community_content_asset");

            migrationBuilder.DropTable(
                name: "community_playlist");

            migrationBuilder.DropTable(
                name: "community_post_asset");

            migrationBuilder.DropTable(
                name: "content_asset");

            migrationBuilder.DropTable(
                name: "content_playlist");

            migrationBuilder.DropTable(
                name: "device_group_member");

            migrationBuilder.DropTable(
                name: "device_manager");

            migrationBuilder.DropTable(
                name: "device_schedule");

            migrationBuilder.DropTable(
                name: "device_screenshot");

            migrationBuilder.DropTable(
                name: "login_log");

            migrationBuilder.DropTable(
                name: "playlist_asset");

            migrationBuilder.DropTable(
                name: "playlist_item");

            migrationBuilder.DropTable(
                name: "schedule_item");

            migrationBuilder.DropTable(
                name: "user_role");

            migrationBuilder.DropTable(
                name: "org_board");

            migrationBuilder.DropTable(
                name: "community_content");

            migrationBuilder.DropTable(
                name: "community_post");

            migrationBuilder.DropTable(
                name: "device_group");

            migrationBuilder.DropTable(
                name: "device");

            migrationBuilder.DropTable(
                name: "asset");

            migrationBuilder.DropTable(
                name: "playlist");

            migrationBuilder.DropTable(
                name: "content");

            migrationBuilder.DropTable(
                name: "schedule");

            migrationBuilder.DropTable(
                name: "app_user");

            migrationBuilder.DropTable(
                name: "organization");
        }
    }
}

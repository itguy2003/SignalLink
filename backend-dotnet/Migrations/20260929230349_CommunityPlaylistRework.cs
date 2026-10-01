using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalLink.Api.Migrations
{
    /// <inheritdoc />
    public partial class CommunityPlaylistRework : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "community_content_asset");

            migrationBuilder.DropTable(
                name: "community_post_asset");

            migrationBuilder.DropTable(
                name: "community_content");

            migrationBuilder.DropTable(
                name: "community_post");

            migrationBuilder.RenameColumn(
                name: "name",
                table: "community_playlist",
                newName: "title");

            migrationBuilder.AlterColumn<string>(
                name: "items",
                table: "community_playlist",
                type: "TEXT",
                nullable: false,
                defaultValue: "[]",
                oldClrType: typeof(string),
                oldType: "TEXT");

            migrationBuilder.AddColumn<string>(
                name: "description",
                table: "community_playlist",
                type: "TEXT",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "publish_status",
                table: "community_playlist",
                type: "TEXT",
                maxLength: 10,
                nullable: false,
                defaultValue: "대기중");

            migrationBuilder.CreateTable(
                name: "community_playlist_asset",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    playlist_id = table.Column<int>(type: "INTEGER", nullable: false),
                    asset_id = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_community_playlist_asset", x => x.id);
                    table.ForeignKey(
                        name: "FK_community_playlist_asset_asset_asset_id",
                        column: x => x.asset_id,
                        principalTable: "asset",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_community_playlist_asset_community_playlist_playlist_id",
                        column: x => x.playlist_id,
                        principalTable: "community_playlist",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_community_playlist_asset_asset_id",
                table: "community_playlist_asset",
                column: "asset_id");

            migrationBuilder.CreateIndex(
                name: "ix_community_playlist_asset_playlist_id",
                table: "community_playlist_asset",
                column: "playlist_id");

            migrationBuilder.CreateIndex(
                name: "uq_community_playlist_asset",
                table: "community_playlist_asset",
                columns: new[] { "playlist_id", "asset_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "community_playlist_asset");

            migrationBuilder.DropColumn(
                name: "description",
                table: "community_playlist");

            migrationBuilder.DropColumn(
                name: "publish_status",
                table: "community_playlist");

            migrationBuilder.RenameColumn(
                name: "title",
                table: "community_playlist",
                newName: "name");

            migrationBuilder.AlterColumn<string>(
                name: "items",
                table: "community_playlist",
                type: "TEXT",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldDefaultValue: "[]");

            migrationBuilder.CreateTable(
                name: "community_content",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    author_id = table.Column<int>(type: "INTEGER", nullable: true),
                    audience = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false, defaultValue: "전체"),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    document = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "{}"),
                    end_date = table.Column<string>(type: "TEXT", maxLength: 10, nullable: true),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    publish_status = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false, defaultValue: "대기중"),
                    start_date = table.Column<string>(type: "TEXT", maxLength: 10, nullable: true),
                    title = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    version = table.Column<int>(type: "INTEGER", nullable: false)
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
                name: "community_post",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    author_id = table.Column<int>(type: "INTEGER", nullable: true),
                    contact_email = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    contact_phone = table.Column<string>(type: "TEXT", maxLength: 30, nullable: true),
                    content = table.Column<string>(type: "TEXT", nullable: true),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    publish_status = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false, defaultValue: "대기중"),
                    title = table.Column<string>(type: "TEXT", maxLength: 500, nullable: false),
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
                name: "community_content_asset",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    asset_id = table.Column<int>(type: "INTEGER", nullable: false),
                    content_id = table.Column<int>(type: "INTEGER", nullable: false)
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
                    asset_id = table.Column<int>(type: "INTEGER", nullable: false),
                    post_id = table.Column<int>(type: "INTEGER", nullable: false),
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
        }
    }
}

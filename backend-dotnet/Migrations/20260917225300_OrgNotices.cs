using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalLink.Api.Migrations
{
    /// <inheritdoc />
    public partial class OrgNotices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "org_notice",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    start_date = table.Column<string>(type: "TEXT", maxLength: 10, nullable: true),
                    end_date = table.Column<string>(type: "TEXT", maxLength: 10, nullable: true),
                    created_by = table.Column<int>(type: "INTEGER", nullable: true),
                    version = table.Column<int>(type: "INTEGER", nullable: false),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTime>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_org_notice", x => x.id);
                    table.ForeignKey(
                        name: "FK_org_notice_app_user_created_by",
                        column: x => x.created_by,
                        principalTable: "app_user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_org_notice_organization_org_id",
                        column: x => x.org_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "org_notice_item",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    notice_id = table.Column<int>(type: "INTEGER", nullable: false),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false),
                    duration_sec = table.Column<int>(type: "INTEGER", nullable: false),
                    document = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_org_notice_item", x => x.id);
                    table.ForeignKey(
                        name: "FK_org_notice_item_org_notice_notice_id",
                        column: x => x.notice_id,
                        principalTable: "org_notice",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_org_notice_created_by",
                table: "org_notice",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_org_notice_org_id",
                table: "org_notice",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_org_notice_item_notice_id",
                table: "org_notice_item",
                column: "notice_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "org_notice_item");

            migrationBuilder.DropTable(
                name: "org_notice");
        }
    }
}

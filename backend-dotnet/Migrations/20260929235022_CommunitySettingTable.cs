using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalLink.Api.Migrations
{
    /// <inheritdoc />
    public partial class CommunitySettingTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "community_setting",
                columns: table => new
                {
                    id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    org_id = table.Column<int>(type: "INTEGER", nullable: false),
                    auto_publish = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_community_setting", x => x.id);
                    table.ForeignKey(
                        name: "FK_community_setting_organization_org_id",
                        column: x => x.org_id,
                        principalTable: "organization",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "uq_community_setting_org_id",
                table: "community_setting",
                column: "org_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "community_setting");
        }
    }
}

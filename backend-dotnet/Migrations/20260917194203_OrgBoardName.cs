using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalLink.Api.Migrations
{
    /// <inheritdoc />
    public partial class OrgBoardName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "name",
                table: "org_board",
                type: "TEXT",
                maxLength: 200,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "name",
                table: "org_board");
        }
    }
}

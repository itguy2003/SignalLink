using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalLink.Api.Migrations
{
    /// <inheritdoc />
    public partial class ContentShareScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "share_scope",
                table: "content",
                type: "TEXT",
                maxLength: 10,
                nullable: false,
                defaultValue: "없음");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "share_scope",
                table: "content");
        }
    }
}

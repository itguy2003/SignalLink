using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalLink.Api.Migrations
{
    /// <inheritdoc />
    public partial class CommunityContentPublishStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "publish_status",
                table: "community_content",
                type: "TEXT",
                maxLength: 10,
                nullable: false,
                defaultValue: "대기중");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "publish_status",
                table: "community_content");
        }
    }
}

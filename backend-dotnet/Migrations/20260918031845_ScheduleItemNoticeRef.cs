using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalLink.Api.Migrations
{
    /// <inheritdoc />
    public partial class ScheduleItemNoticeRef : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "org_notice_id",
                table: "schedule_item",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_schedule_item_org_notice_id",
                table: "schedule_item",
                column: "org_notice_id");

            migrationBuilder.AddForeignKey(
                name: "FK_schedule_item_org_notice_org_notice_id",
                table: "schedule_item",
                column: "org_notice_id",
                principalTable: "org_notice",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_schedule_item_org_notice_org_notice_id",
                table: "schedule_item");

            migrationBuilder.DropIndex(
                name: "IX_schedule_item_org_notice_id",
                table: "schedule_item");

            migrationBuilder.DropColumn(
                name: "org_notice_id",
                table: "schedule_item");
        }
    }
}

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalLink.Api.Migrations
{
    /// <inheritdoc />
    public partial class ScheduleItemTransitions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "transition",
                table: "schedule_item",
                type: "TEXT",
                maxLength: 20,
                nullable: false,
                defaultValue: "none");

            migrationBuilder.AddColumn<int>(
                name: "transition_ms",
                table: "schedule_item",
                type: "INTEGER",
                nullable: false,
                defaultValue: 600);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "transition",
                table: "schedule_item");

            migrationBuilder.DropColumn(
                name: "transition_ms",
                table: "schedule_item");
        }
    }
}

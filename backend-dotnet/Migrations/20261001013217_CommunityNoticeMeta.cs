using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalLink.Api.Migrations
{
    /// <inheritdoc />
    public partial class CommunityNoticeMeta : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "description",
                table: "community_playlist");

            migrationBuilder.AddColumn<string>(
                name: "memo",
                table: "community_playlist",
                type: "TEXT",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "notice_end",
                table: "community_playlist",
                type: "TEXT",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "notice_start",
                table: "community_playlist",
                type: "TEXT",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "target_org_types",
                table: "community_playlist",
                type: "TEXT",
                nullable: false,
                defaultValue: "[]");

            // 2026-10 개편: COMMUNITY_USER 역할 폐지 — 남아 있는 역할 행을 걷어낸다.
            // (사용자 계정 자체는 남는다. MEMBER 로 커뮤니티를 계속 쓸 수 있다.)
            migrationBuilder.Sql("DELETE FROM user_role WHERE role = 'COMMUNITY_USER';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "memo",
                table: "community_playlist");

            migrationBuilder.DropColumn(
                name: "notice_end",
                table: "community_playlist");

            migrationBuilder.DropColumn(
                name: "notice_start",
                table: "community_playlist");

            migrationBuilder.DropColumn(
                name: "target_org_types",
                table: "community_playlist");

            migrationBuilder.AddColumn<string>(
                name: "description",
                table: "community_playlist",
                type: "TEXT",
                maxLength: 2000,
                nullable: true);
        }
    }
}

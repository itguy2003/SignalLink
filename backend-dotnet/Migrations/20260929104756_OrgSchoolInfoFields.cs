using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalLink.Api.Migrations
{
    /// <inheritdoc />
    public partial class OrgSchoolInfoFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "address_detail",
                table: "organization",
                type: "TEXT",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "edu_office_name",
                table: "organization",
                type: "TEXT",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "homepage",
                table: "organization",
                type: "TEXT",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "jurisdiction_name",
                table: "organization",
                type: "TEXT",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "phone",
                table: "organization",
                type: "TEXT",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "sido_name",
                table: "organization",
                type: "TEXT",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "address_detail",
                table: "organization");

            migrationBuilder.DropColumn(
                name: "edu_office_name",
                table: "organization");

            migrationBuilder.DropColumn(
                name: "homepage",
                table: "organization");

            migrationBuilder.DropColumn(
                name: "jurisdiction_name",
                table: "organization");

            migrationBuilder.DropColumn(
                name: "phone",
                table: "organization");

            migrationBuilder.DropColumn(
                name: "sido_name",
                table: "organization");
        }
    }
}

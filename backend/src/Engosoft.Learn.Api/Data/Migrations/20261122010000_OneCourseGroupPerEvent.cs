using Engosoft.Learn.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Engosoft.Learn.Api.Data.Migrations
{
    /// <summary>
    /// At most one course group per Odoo event. During a deploy two server instances briefly run side by side, and both
    /// could create the same missing group. The index is created only when no duplicates exist yet, so this migration
    /// can never stop the app from starting; Program.cs logs any duplicates it finds. It is deliberately not part of the
    /// EF model (a plain CreateIndex would fail on existing duplicates), so later migrations leave it alone.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261122010000_OneCourseGroupPerEvent")]
    public partial class OneCourseGroupPerEvent : Migration
    {
        public const string IndexName = "IX_Rooms_OneCourseGroupPerEvent";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($"""
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM "Rooms" WHERE "Kind" = 'Course' GROUP BY "OdooEventId" HAVING COUNT(*) > 1
                  ) THEN
                    CREATE UNIQUE INDEX IF NOT EXISTS "{IndexName}" ON "Rooms" ("OdooEventId") WHERE "Kind" = 'Course';
                  END IF;
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($"""DROP INDEX IF EXISTS "{IndexName}";""");
        }
    }
}

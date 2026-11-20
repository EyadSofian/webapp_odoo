using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Engosoft.Learn.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class Assessments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Assessments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    OdooEventId = table.Column<int>(type: "integer", nullable: false),
                    OdooTrackId = table.Column<int>(type: "integer", nullable: true),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Instructions = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AiGenerated = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedByPartnerId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PublishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DueAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    TimeLimitMinutes = table.Column<int>(type: "integer", nullable: true),
                    MaxAttempts = table.Column<int>(type: "integer", nullable: false),
                    PassPercent = table.Column<int>(type: "integer", nullable: false),
                    RevealAnswers = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Assessments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "QuizAttempts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AssessmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartnerId = table.Column<int>(type: "integer", nullable: false),
                    PartnerName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    SubmittedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Score = table.Column<int>(type: "integer", nullable: false),
                    MaxScore = table.Column<int>(type: "integer", nullable: false),
                    Percent = table.Column<double>(type: "double precision", nullable: false),
                    Passed = table.Column<bool>(type: "boolean", nullable: false),
                    Answers = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_QuizAttempts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TaskSubmissions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AssessmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartnerId = table.Column<int>(type: "integer", nullable: false),
                    PartnerName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Text = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: true),
                    SubmittedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Late = table.Column<bool>(type: "boolean", nullable: false),
                    Grade = table.Column<double>(type: "double precision", nullable: true),
                    Feedback = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    GradedBy = table.Column<int>(type: "integer", nullable: true),
                    GradedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TaskSubmissions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Questions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AssessmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Text = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    Explanation = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Points = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Questions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Questions_Assessments_AssessmentId",
                        column: x => x.AssessmentId,
                        principalTable: "Assessments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SubmissionFiles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SubmissionId = table.Column<Guid>(type: "uuid", nullable: false),
                    FileName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    StoragePath = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SubmissionFiles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SubmissionFiles_TaskSubmissions_SubmissionId",
                        column: x => x.SubmissionId,
                        principalTable: "TaskSubmissions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Options",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    QuestionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Text = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    IsCorrect = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Options", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Options_Questions_QuestionId",
                        column: x => x.QuestionId,
                        principalTable: "Questions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Assessments_OdooEventId_Status",
                table: "Assessments",
                columns: new[] { "OdooEventId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Options_QuestionId",
                table: "Options",
                column: "QuestionId");

            migrationBuilder.CreateIndex(
                name: "IX_Questions_AssessmentId",
                table: "Questions",
                column: "AssessmentId");

            migrationBuilder.CreateIndex(
                name: "IX_QuizAttempts_AssessmentId_PartnerId",
                table: "QuizAttempts",
                columns: new[] { "AssessmentId", "PartnerId" });

            migrationBuilder.CreateIndex(
                name: "IX_SubmissionFiles_SubmissionId",
                table: "SubmissionFiles",
                column: "SubmissionId");

            migrationBuilder.CreateIndex(
                name: "IX_TaskSubmissions_AssessmentId_PartnerId",
                table: "TaskSubmissions",
                columns: new[] { "AssessmentId", "PartnerId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Options");

            migrationBuilder.DropTable(
                name: "QuizAttempts");

            migrationBuilder.DropTable(
                name: "SubmissionFiles");

            migrationBuilder.DropTable(
                name: "Questions");

            migrationBuilder.DropTable(
                name: "TaskSubmissions");

            migrationBuilder.DropTable(
                name: "Assessments");
        }
    }
}

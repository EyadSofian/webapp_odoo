using Engosoft.Learn.Api.Common;
using Microsoft.AspNetCore.Mvc;

namespace Engosoft.Learn.Api.Assessments;

public static class AssessmentsModule
{
    public static IServiceCollection AddAssessmentsModule(this IServiceCollection services)
    {
        services.AddOptions<OpenAiOptions>().BindConfiguration(OpenAiOptions.Section);
        services.AddHttpClient("openai", (sp, c) =>
        {
            var o = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<OpenAiOptions>>().Value;
            c.BaseAddress = new Uri(o.BaseUrl);
            c.Timeout = TimeSpan.FromSeconds(o.TimeoutSeconds);
        });
        services.AddHttpClient("files", c => c.Timeout = TimeSpan.FromSeconds(60));
        services.AddScoped<QuizGenerator>();
        services.AddScoped<AssessmentService>();
        return services;
    }

    public static void MapAssessmentEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api").WithTags("Assessments").RequireAuthorization().RequireRateLimiting("api");

        api.MapGet("/live-courses/{eventId:int}/assessments", async (int eventId, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.ListAsync(u, eventId, ct)).ToHttp());
        api.MapPost("/live-courses/{eventId:int}/assessments", async (int eventId, UpsertAssessmentRequest body, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.CreateAsync(u, eventId, body, ct)).ToHttp());
        api.MapPost("/sessions/{trackId:int}/assessments/ai", async (int trackId, GenerateRequest body, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.GenerateAsync(u, trackId, body, ct)).ToHttp()).RequireRateLimiting("ai");

        api.MapGet("/assessments/pending", (AssessmentService s, CurrentUser u, CancellationToken ct) => s.PendingAsync(u, ct));

        var a = api.MapGroup("/assessments");
        a.MapGet("/{id:guid}", async (Guid id, AssessmentService s, CurrentUser u, CancellationToken ct) => (await s.GetAsync(u, id, ct)).ToHttp());
        a.MapPut("/{id:guid}", async (Guid id, UpsertAssessmentRequest body, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.UpdateAsync(u, id, body, ct)).ToHttp());
        a.MapDelete("/{id:guid}", async (Guid id, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.DeleteAsync(u, id, ct)).ToHttp(_ => Results.NoContent()));
        a.MapPost("/{id:guid}/publish", async (Guid id, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.SetStatusAsync(u, id, AssessmentStatus.Published, ct)).ToHttp());
        a.MapPost("/{id:guid}/close", async (Guid id, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.SetStatusAsync(u, id, AssessmentStatus.Closed, ct)).ToHttp());
        a.MapPost("/{id:guid}/attempts", async (Guid id, SubmitQuizRequest body, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.SubmitQuizAsync(u, id, body, ct)).ToHttp());
        a.MapGet("/{id:guid}/results", async (Guid id, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.ResultsAsync(u, id, ct)).ToHttp());
        a.MapPost("/{id:guid}/submission", async (Guid id, [FromForm] string? text, IFormFileCollection files, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.SubmitTaskAsync(u, id, text, files, ct)).ToHttp()).DisableAntiforgery();
        a.MapGet("/{id:guid}/submissions", async (Guid id, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.SubmissionsAsync(u, id, ct)).ToHttp());
        a.MapPost("/submissions/{submissionId:guid}/grade", async (Guid submissionId, GradeRequest body, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.GradeAsync(u, submissionId, body, ct)).ToHttp());
        a.MapGet("/files/{fileId:guid}", async (Guid fileId, AssessmentService s, CurrentUser u, CancellationToken ct) =>
            (await s.GetFileAsync(u, fileId, ct)).ToHttp(f => Results.File(File.OpenRead(f.StoragePath), "application/octet-stream", f.FileName)));
    }
}

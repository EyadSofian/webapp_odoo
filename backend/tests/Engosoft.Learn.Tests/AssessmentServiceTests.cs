using System.Text.Json;
using Engosoft.Learn.Api.Assessments;
using Engosoft.Learn.Api.Chat;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Learning;
using Engosoft.Learn.Api.Notifications;
using Engosoft.Learn.Api.Odoo;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;

namespace Engosoft.Learn.Tests;

/// <summary>Runs the assessment service against a real (SQLite) database; Odoo is never reached for course-team members.</summary>
public sealed class AssessmentServiceTests : IAsyncLifetime
{
    private readonly SqliteConnection _conn = new("DataSource=:memory:");
    private ServiceProvider _sp = null!;
    private static readonly CurrentUser Instructor = new(10, 500, "Eng. Test", UserKind.Instructor);
    private static readonly CurrentUser Student = new(11, 600, "Learner", UserKind.Student);
    private const int EventId = 1586;

    public async Task InitializeAsync()
    {
        await _conn.OpenAsync();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddMemoryCache();
        services.AddHttpClient();
        services.AddSignalR();
        services.AddOptions();
        services.AddDbContext<AppDbContext>(o => o.UseSqlite(_conn));
        services.AddSingleton<IOdooClient, UnreachableOdoo>();
        services.AddSingleton<IWebHostEnvironment, TestEnv>();
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<BackgroundJobQueue>();
        services.AddSingleton<BunnySigner>();
        services.AddScoped<LearningService>();
        services.AddScoped<QuizGenerator>();
        services.AddScoped<NotificationService>();
        services.AddScoped<AssessmentService>();
        _sp = services.BuildServiceProvider();

        await using var scope = _sp.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.EnsureCreatedAsync();
        var room = new ChatRoom { Kind = RoomKind.Course, OdooEventId = EventId, Title = "Course", CreatedAt = DateTime.UtcNow };
        room.Members.Add(new RoomMember { RoomId = room.Id, PartnerId = Instructor.PartnerId, DisplayName = Instructor.Name, Role = MemberRole.Instructor, JoinedAt = DateTime.UtcNow });
        room.Members.Add(new RoomMember { RoomId = room.Id, PartnerId = Student.PartnerId, DisplayName = Student.Name, Role = MemberRole.Student, JoinedAt = DateTime.UtcNow });
        db.Rooms.Add(room);
        await db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        await _sp.DisposeAsync();
        await _conn.DisposeAsync();
    }

    private static UpsertAssessmentRequest Request(params string[] questions) => new("quiz", "Quiz", null, null, null, null, 2, 60, true,
        questions.Select(q => new QuestionInput(q, "why", 1, [new("right", true), new("wrong", false), new("also wrong", false)])).ToList());

    private async Task<T> With<T>(Func<AssessmentService, Task<T>> run)
    {
        await using var scope = _sp.CreateAsyncScope();
        return await run(scope.ServiceProvider.GetRequiredService<AssessmentService>());
    }

    [Fact]
    public async Task Instructor_can_replace_questions_then_publish_and_learner_takes_it_without_seeing_answers()
    {
        var created = await With(s => s.CreateAsync(Instructor, EventId, Request("Q1"), default));
        Assert.True(created.IsSuccess);
        var id = created.Value!.Card.Id;

        var updated = await With(s => s.UpdateAsync(Instructor, id, Request("A", "B", "C"), default));
        Assert.True(updated.IsSuccess, updated.Error?.Message);
        Assert.Equal(["A", "B", "C"], updated.Value!.Questions.Select(q => q.Text));

        // Drafts are invisible to learners.
        Assert.Equal(ErrorKind.NotFound, (await With(s => s.GetAsync(Student, id, default))).Error!.Kind);

        Assert.True((await With(s => s.SetStatusAsync(Instructor, id, AssessmentStatus.Published, default))).IsSuccess);
        var seen = await With(s => s.GetAsync(Student, id, default));
        Assert.True(seen.IsSuccess);
        Assert.All(seen.Value!.Questions.SelectMany(q => q.Options), o => Assert.Null(o.IsCorrect));
        Assert.All(seen.Value.Questions, q => Assert.Null(q.Explanation));

        var staffView = (await With(s => s.GetAsync(Instructor, id, default))).Value!;
        var answers = staffView.Questions.ToDictionary(q => q.Id, q => q.Options.First(o => o.IsCorrect == true).Id);
        var result = await With(s => s.SubmitQuizAsync(Student, id, new SubmitQuizRequest(answers), default));
        Assert.True(result.IsSuccess);
        Assert.Equal(100, result.Value!.Percent);
        Assert.Equal(1, result.Value.AttemptsLeft);

        // Questions are frozen once someone has answered.
        Assert.Equal("has_attempts", (await With(s => s.UpdateAsync(Instructor, id, Request("X"), default))).Error!.Code);
    }

    [Fact]
    public async Task Learners_cannot_create_or_grade()
    {
        Assert.Equal(ErrorKind.Forbidden, (await With(s => s.CreateAsync(Student, EventId, Request("Q"), default))).Error!.Kind);
    }

    private sealed class UnreachableOdoo : IOdooClient
    {
        public Task<JsonElement> ExecuteAsync(string model, string method, object?[] args, object? kwargs = null, CancellationToken ct = default) =>
            throw new InvalidOperationException($"Odoo should not be called here ({model}.{method}).");
        public Task<int?> AuthenticateAsync(string login, string password, CancellationToken ct = default) => throw new InvalidOperationException();
    }

    private sealed class TestEnv : IWebHostEnvironment
    {
        public string WebRootPath { get; set; } = Path.GetTempPath();
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "tests";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = Path.GetTempPath();
        public string EnvironmentName { get; set; } = "Testing";
    }
}

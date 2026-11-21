using Engosoft.Learn.Api.Chat;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Learning;
using Engosoft.Learn.Api.Notifications;
using Engosoft.Learn.Api.Odoo;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using static Engosoft.Learn.Api.Odoo.OdooClientExtensions;

namespace Engosoft.Learn.Api.Assessments;

// ---------------------------------------------------------------- DTOs

public sealed record MyQuizStatus(int AttemptsUsed, double? BestPercent, bool Passed);
public sealed record MyTaskStatus(DateTime? SubmittedAt, double? Grade, string? Feedback);
public sealed record StaffStats(int Attempts, double? AveragePercent, int Submissions, int Ungraded);

public sealed record AssessmentCard(Guid Id, string Kind, string Title, int EventId, int? TrackId, string Status, bool AiGenerated,
    DateTime? PublishedAt, DateTime? DueAt, int QuestionCount, int MaxAttempts, int PassPercent,
    MyQuizStatus? Mine, MyTaskStatus? MyTask, StaffStats? Stats);

public sealed record OptionDto(Guid Id, string Text, bool? IsCorrect);
public sealed record QuestionDto(Guid Id, string Text, int Points, string? Explanation, IReadOnlyList<OptionDto> Options);
public sealed record AttemptDto(Guid Id, DateTime SubmittedAt, int Score, int MaxScore, double Percent, bool Passed);
public sealed record FileDto(Guid Id, string Name, string ContentType, long Size);
public sealed record SubmissionDto(Guid Id, int PartnerId, string PartnerName, string? Text, DateTime SubmittedAt, bool Late,
    double? Grade, string? Feedback, IReadOnlyList<FileDto> Files);

public sealed record AssessmentDetail(AssessmentCard Card, string? Instructions, bool RevealAnswers, int? TimeLimitMinutes, bool IsStaff,
    IReadOnlyList<QuestionDto> Questions, IReadOnlyList<AttemptDto> MyAttempts, SubmissionDto? MySubmission);

public sealed record QuestionResult(Guid QuestionId, Guid? Chosen, Guid[]? Correct, bool IsCorrect, string? Explanation);
public sealed record AttemptResult(Guid AttemptId, int Score, int MaxScore, double Percent, bool Passed, int AttemptsLeft, IReadOnlyList<QuestionResult> Review);

public sealed record OptionInput(string Text, bool IsCorrect);
public sealed record QuestionInput(string Text, string? Explanation, int Points, List<OptionInput> Options);
public sealed record UpsertAssessmentRequest(string Kind, string Title, string? Instructions, int? TrackId, DateTime? DueAt,
    int? TimeLimitMinutes, int MaxAttempts, int PassPercent, bool RevealAnswers, List<QuestionInput>? Questions);
public sealed record GenerateRequest(int Count = 8, string Difficulty = "medium");
public sealed record SubmitQuizRequest(Dictionary<Guid, Guid> Answers);
public sealed record GradeRequest(double Grade, string? Feedback);

public sealed class AssessmentService(
    AppDbContext db,
    LearningService learning,
    IOdooClient odoo,
    QuizGenerator generator,
    NotificationService notifications,
    IOptions<ChatOptions> chatOptions,
    IWebHostEnvironment env,
    TimeProvider clock)
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    /// <summary>"staff" for the instructor and coordinators of the course, "student" for a learner with a valid seat, else null.</summary>
    private async Task<string?> RoleAsync(CurrentUser user, int eventId, CancellationToken ct)
    {
        var roomRole = await db.Members
            .Where(m => m.PartnerId == user.PartnerId && m.RemovedAt == null && m.Room!.Kind == RoomKind.Course && m.Room.OdooEventId == eventId)
            .Select(m => (MemberRole?)m.Role).FirstOrDefaultAsync(ct);
        // Group membership is already synced from Odoo (valid seats only), so it answers without another Odoo call.
        if (roomRole is { } r) return r == MemberRole.Student ? "student" : "staff";
        var mine = await learning.GetMyEventsAsync(user, ct);
        if (!mine.TryGetValue(eventId, out var access)) return null;
        if (access.Role == "instructor") return "staff";
        return access.Expired ? null : "student";
    }

    private async Task<Result<(Assessment A, bool Staff)>> LoadAsync(CurrentUser user, Guid id, CancellationToken ct, bool tracking = false)
    {
        var q = db.Assessments.Include(a => a.Questions).ThenInclude(q => q.Options).AsQueryable();
        if (!tracking) q = q.AsNoTracking();
        var a = await q.SingleOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return Error.NotFound("assessment_not_found", "هذا الاختبار غير موجود.");
        var role = await RoleAsync(user, a.OdooEventId, ct);
        if (role is null || (role == "student" && a.Status == AssessmentStatus.Draft))
            return Error.NotFound("assessment_not_found", "هذا الاختبار غير موجود.");
        a.Questions = a.Questions.OrderBy(x => x.Order).ToList();
        foreach (var x in a.Questions) x.Options = x.Options.OrderBy(o => o.Order).ToList();
        return (a, role == "staff");
    }

    // ---------------------------------------------------------------- listing

    public async Task<Result<IReadOnlyList<AssessmentCard>>> ListAsync(CurrentUser user, int eventId, CancellationToken ct)
    {
        var role = await RoleAsync(user, eventId, ct);
        if (role is null) return Error.NotFound("course_not_found", "هذه الدورة ليست ضمن دوراتك.");
        var staff = role == "staff";
        var items = await db.Assessments.AsNoTracking().Include(a => a.Questions)
            .Where(a => a.OdooEventId == eventId && (staff || a.Status != AssessmentStatus.Draft))
            .OrderByDescending(a => a.PublishedAt ?? a.CreatedAt).ToListAsync(ct);
        var ids = items.Select(a => a.Id).ToList();

        var attempts = await db.QuizAttempts.AsNoTracking().Where(t => ids.Contains(t.AssessmentId)).ToListAsync(ct);
        var subs = await db.TaskSubmissions.AsNoTracking().Where(s => ids.Contains(s.AssessmentId)).ToListAsync(ct);

        return items.Select(a =>
        {
            var mineA = attempts.Where(t => t.AssessmentId == a.Id && t.PartnerId == user.PartnerId).ToList();
            var mineS = subs.FirstOrDefault(s => s.AssessmentId == a.Id && s.PartnerId == user.PartnerId);
            var allA = attempts.Where(t => t.AssessmentId == a.Id).ToList();
            var allS = subs.Where(s => s.AssessmentId == a.Id).ToList();
            return Card(a,
                a.Kind == AssessmentKind.Quiz && !staff ? new MyQuizStatus(mineA.Count, mineA.Count == 0 ? null : mineA.Max(x => x.Percent), mineA.Any(x => x.Passed)) : null,
                a.Kind == AssessmentKind.Task && !staff ? new MyTaskStatus(mineS?.SubmittedAt, mineS?.Grade, mineS?.Feedback) : null,
                staff ? new StaffStats(allA.Count, allA.Count == 0 ? null : Math.Round(allA.Average(x => x.Percent), 1), allS.Count, allS.Count(s => s.Grade is null)) : null);
        }).ToList();
    }

    /// <summary>Published quizzes and tasks the learner has not done yet, across their running courses.</summary>
    public async Task<IReadOnlyList<AssessmentCard>> PendingAsync(CurrentUser user, CancellationToken ct)
    {
        if (user.Kind != UserKind.Student) return [];
        var mine = await learning.GetMyEventsAsync(user, ct);
        var events = mine.Values.Where(e => !e.Expired).Select(e => e.EventId).ToList();
        var open = await db.Assessments.AsNoTracking().Include(a => a.Questions)
            .Where(a => events.Contains(a.OdooEventId) && a.Status == AssessmentStatus.Published && (a.DueAt == null || a.DueAt > Now))
            .ToListAsync(ct);
        var ids = open.Select(a => a.Id).ToList();
        var attempted = await db.QuizAttempts.Where(t => ids.Contains(t.AssessmentId) && t.PartnerId == user.PartnerId).Select(t => t.AssessmentId).ToListAsync(ct);
        var submitted = await db.TaskSubmissions.Where(t => ids.Contains(t.AssessmentId) && t.PartnerId == user.PartnerId).Select(t => t.AssessmentId).ToListAsync(ct);
        return open.Where(a => !attempted.Contains(a.Id) && !submitted.Contains(a.Id))
            .OrderBy(a => a.DueAt ?? DateTime.MaxValue).ThenByDescending(a => a.PublishedAt)
            .Select(a => Card(a, null, null, null)).Take(10).ToList();
    }

    private static AssessmentCard Card(Assessment a, MyQuizStatus? mine, MyTaskStatus? task, StaffStats? stats) =>
        new(a.Id, a.Kind.ToString().ToLowerInvariant(), a.Title, a.OdooEventId, a.OdooTrackId, a.Status.ToString().ToLowerInvariant(), a.AiGenerated,
            a.PublishedAt, a.DueAt, a.Questions.Count, a.MaxAttempts, a.PassPercent, mine, task, stats);

    public async Task<Result<AssessmentDetail>> GetAsync(CurrentUser user, Guid id, CancellationToken ct)
    {
        var loaded = await LoadAsync(user, id, ct);
        if (!loaded.IsSuccess) return loaded.Error!;
        var (a, staff) = loaded.Value;
        var mine = await db.QuizAttempts.AsNoTracking().Where(t => t.AssessmentId == id && t.PartnerId == user.PartnerId)
            .OrderBy(t => t.SubmittedAt).ToListAsync(ct);
        var sub = await db.TaskSubmissions.AsNoTracking().Include(s => s.Files)
            .SingleOrDefaultAsync(s => s.AssessmentId == id && s.PartnerId == user.PartnerId, ct);

        // Learners never receive which option is right before they submit.
        var questions = a.Questions.Select(q => new QuestionDto(q.Id, q.Text, q.Points, staff ? q.Explanation : null,
            q.Options.Select(o => new OptionDto(o.Id, o.Text, staff ? o.IsCorrect : null)).ToList())).ToList();

        return new AssessmentDetail(
            Card(a, a.Kind == AssessmentKind.Quiz && !staff ? new MyQuizStatus(mine.Count, mine.Count == 0 ? null : mine.Max(x => x.Percent), mine.Any(x => x.Passed)) : null,
                a.Kind == AssessmentKind.Task && !staff ? new MyTaskStatus(sub?.SubmittedAt, sub?.Grade, sub?.Feedback) : null, null),
            a.Instructions, a.RevealAnswers, a.TimeLimitMinutes, staff, questions,
            mine.Select(t => new AttemptDto(t.Id, t.SubmittedAt, t.Score, t.MaxScore, t.Percent, t.Passed)).ToList(),
            sub is null ? null : ToDto(sub));
    }

    private static SubmissionDto ToDto(TaskSubmission s) =>
        new(s.Id, s.PartnerId, s.PartnerName, s.Text, s.SubmittedAt, s.Late, s.Grade, s.Feedback,
            s.Files.Select(f => new FileDto(f.Id, f.FileName, f.ContentType, f.Size)).ToList());

    // ---------------------------------------------------------------- taking

    public async Task<Result<AttemptResult>> SubmitQuizAsync(CurrentUser user, Guid id, SubmitQuizRequest req, CancellationToken ct)
    {
        var loaded = await LoadAsync(user, id, ct);
        if (!loaded.IsSuccess) return loaded.Error!;
        var (a, staff) = loaded.Value;
        if (staff) return Error.Validation("staff_attempt", "يطّلع فريق الدورة على الإجابات ولا يجيب عن الاختبار.");
        var used = await db.QuizAttempts.CountAsync(t => t.AssessmentId == id && t.PartnerId == user.PartnerId, ct);
        if (AssessmentRules.CanAttempt(a, used, Now) is { } denied) return denied;

        var answers = (req.Answers ?? []).Where(kv => a.Questions.Any(q => q.Id == kv.Key && q.Options.Any(o => o.Id == kv.Value)))
            .ToDictionary(kv => kv.Key, kv => kv.Value);
        var grade = AssessmentRules.GradeQuiz(a, answers);
        var attempt = new QuizAttempt
        {
            AssessmentId = id, PartnerId = user.PartnerId, PartnerName = user.Name, SubmittedAt = Now,
            Score = grade.Score, MaxScore = grade.MaxScore, Percent = grade.Percent, Passed = grade.Passed,
            Answers = string.Join(',', answers.Select(kv => $"{kv.Key:N}:{kv.Value:N}")),
        };
        db.QuizAttempts.Add(attempt);
        await db.SaveChangesAsync(ct);

        var left = a.MaxAttempts - used - 1;
        // Right answers are revealed when the quiz allows it, and in any case once no attempts are left.
        var reveal = a.RevealAnswers || left <= 0;
        var review = grade.Questions.Select(g => new QuestionResult(g.QuestionId, g.Chosen, reveal ? g.Correct : null, g.IsCorrect,
            reveal ? a.Questions.First(q => q.Id == g.QuestionId).Explanation : null)).ToList();
        return new AttemptResult(attempt.Id, grade.Score, grade.MaxScore, grade.Percent, grade.Passed, Math.Max(0, left), review);
    }

    public async Task<Result<SubmissionDto>> SubmitTaskAsync(CurrentUser user, Guid id, string? text, IFormFileCollection files, CancellationToken ct)
    {
        var loaded = await LoadAsync(user, id, ct);
        if (!loaded.IsSuccess) return loaded.Error!;
        var (a, staff) = loaded.Value;
        if (staff) return Error.Validation("staff_submit", "التسليم متاح للمتدربين فقط.");
        if (AssessmentRules.CanSubmitTask(a) is { } denied) return denied;
        text = text?.Trim();
        if (string.IsNullOrEmpty(text) && files.Count == 0) return Error.Validation("empty_submission", "اكتب إجابتك أو ارفع ملفًا.");
        if (text?.Length > 8000) return Error.Validation("too_long", "الإجابة طويلة. الحد الأقصى 8000 حرف.");

        var sub = await db.TaskSubmissions.Include(s => s.Files).SingleOrDefaultAsync(s => s.AssessmentId == id && s.PartnerId == user.PartnerId, ct);
        if (sub?.Grade is not null) return Error.Blocked("already_graded", "صُحّح هذا التسليم بالفعل.");
        if (sub is null) db.TaskSubmissions.Add(sub = new TaskSubmission { AssessmentId = id, PartnerId = user.PartnerId, PartnerName = user.Name });
        sub.Text = text;
        sub.SubmittedAt = Now;
        sub.Late = a.DueAt is { } due && Now > due;

        var max = chatOptions.Value.MaxAttachmentMb * 1024L * 1024L;
        var upload = files.Take(5).ToList();
        // Check every file before writing any, so a rejected batch leaves nothing on disk.
        foreach (var f in upload)
        {
            if (f.Length == 0 || f.Length > max) return Error.Validation("file_size", $"يجب أن يكون حجم الملف أقل من {chatOptions.Value.MaxAttachmentMb} ميجابايت.");
            if (!ChatService.TryGetAllowedType(f.FileName, out _))
                return Error.Validation("file_type", "نوع الملف غير مسموح. المسموح: الصور، وPDF، وملفات أوفيس، وDWG، وZIP، والتسجيلات الصوتية.");
        }
        foreach (var f in upload)
        {
            ChatService.TryGetAllowedType(f.FileName, out var allowedType);
            var dir = Path.Combine(env.ContentRootPath, "storage", "submissions", id.ToString("N"));
            Directory.CreateDirectory(dir);
            var file = new SubmissionFile { SubmissionId = sub.Id, FileName = Path.GetFileName(f.FileName), ContentType = allowedType, Size = f.Length };
            file.StoragePath = Path.Combine(dir, file.Id.ToString("N"));
            await using (var target = File.Create(file.StoragePath)) await f.CopyToAsync(target, ct);
            sub.Files.Add(file);
        }
        await db.SaveChangesAsync(ct);
        return ToDto(sub);
    }

    public async Task<Result<SubmissionFile>> GetFileAsync(CurrentUser user, Guid fileId, CancellationToken ct)
    {
        var f = await db.SubmissionFiles.AsNoTracking().SingleOrDefaultAsync(x => x.Id == fileId, ct);
        if (f is null) return Error.NotFound();
        var sub = await db.TaskSubmissions.AsNoTracking().SingleAsync(s => s.Id == f.SubmissionId, ct);
        if (sub.PartnerId != user.PartnerId)
        {
            var a = await db.Assessments.AsNoTracking().SingleAsync(x => x.Id == sub.AssessmentId, ct);
            if (await RoleAsync(user, a.OdooEventId, ct) != "staff") return Error.NotFound();
        }
        return File.Exists(f.StoragePath) ? f : Error.NotFound();
    }

    // ---------------------------------------------------------------- course team

    public async Task<Result<IReadOnlyList<SubmissionDto>>> SubmissionsAsync(CurrentUser user, Guid id, CancellationToken ct)
    {
        var loaded = await LoadAsync(user, id, ct);
        if (!loaded.IsSuccess) return loaded.Error!;
        if (!loaded.Value.Staff) return Error.Forbidden("staff_only", "هذا متاح لفريق الدورة فقط.");
        var list = await db.TaskSubmissions.AsNoTracking().Include(s => s.Files).Where(s => s.AssessmentId == id)
            .OrderBy(s => s.Grade != null).ThenBy(s => s.SubmittedAt).ToListAsync(ct);
        return list.Select(ToDto).ToList();
    }

    public async Task<Result<IReadOnlyList<AttemptDto>>> ResultsAsync(CurrentUser user, Guid id, CancellationToken ct)
    {
        var loaded = await LoadAsync(user, id, ct);
        if (!loaded.IsSuccess) return loaded.Error!;
        if (!loaded.Value.Staff) return Error.Forbidden("staff_only", "هذا متاح لفريق الدورة فقط.");
        var rows = await db.QuizAttempts.AsNoTracking().Where(t => t.AssessmentId == id).OrderByDescending(t => t.Percent).ToListAsync(ct);
        return rows.Select(t => new AttemptDto(t.Id, t.SubmittedAt, t.Score, t.MaxScore, t.Percent, t.Passed)).ToList();
    }

    public async Task<Result<SubmissionDto>> GradeAsync(CurrentUser user, Guid submissionId, GradeRequest req, CancellationToken ct)
    {
        var sub = await db.TaskSubmissions.Include(s => s.Files).SingleOrDefaultAsync(s => s.Id == submissionId, ct);
        if (sub is null) return Error.NotFound();
        var a = await db.Assessments.AsNoTracking().SingleAsync(x => x.Id == sub.AssessmentId, ct);
        if (await RoleAsync(user, a.OdooEventId, ct) != "staff") return Error.NotFound();
        if (req.Grade is < 0 or > 100) return Error.Validation("bad_grade", "الدرجة من 0 إلى 100.");
        sub.Grade = Math.Round(req.Grade, 1);
        sub.Feedback = req.Feedback?.Trim() is { Length: > 0 } f ? (f.Length > 4000 ? f[..4000] : f) : null;
        sub.GradedBy = user.PartnerId;
        sub.GradedAt = Now;
        await db.SaveChangesAsync(ct);
        await notifications.NotifyAsync([sub.PartnerId], "task_graded", $"صُحّحت المهمة · {a.Title}", $"درجتك {sub.Grade}/100.",
            $"/assessments/{a.Id}", tag: $"task-{a.Id}", ct: ct);
        return ToDto(sub);
    }

    public async Task<Result<AssessmentDetail>> CreateAsync(CurrentUser user, int eventId, UpsertAssessmentRequest req, CancellationToken ct)
    {
        if (await RoleAsync(user, eventId, ct) != "staff") return Error.Forbidden("staff_only", "إنشاء الاختبارات متاح لفريق الدورة فقط.");
        var a = new Assessment { OdooEventId = eventId, CreatedByPartnerId = user.PartnerId, CreatedAt = Now, Status = AssessmentStatus.Draft };
        if (Apply(a, req) is { } invalid) return invalid;
        db.Assessments.Add(a);
        await db.SaveChangesAsync(ct);
        return await GetAsync(user, a.Id, ct);
    }

    public async Task<Result<AssessmentDetail>> UpdateAsync(CurrentUser user, Guid id, UpsertAssessmentRequest req, CancellationToken ct)
    {
        var loaded = await LoadAsync(user, id, ct, tracking: true);
        if (!loaded.IsSuccess) return loaded.Error!;
        var (a, staff) = loaded.Value;
        if (!staff) return Error.Forbidden("staff_only", "التعديل متاح لفريق الدورة فقط.");
        if (req.Questions is not null && await db.QuizAttempts.AnyAsync(t => t.AssessmentId == id, ct))
            return Error.Conflict("has_attempts", "أجاب متدربون عن هذا الاختبار، لذا لا يمكن تغيير أسئلته. أنشئ اختبارًا جديدًا.");
        if (req.Questions is not null)
        {
            db.Questions.RemoveRange(a.Questions);
            a.Questions = [];
        }
        if (Apply(a, req) is { } invalid) return invalid;
        // New question rows carry client-side Guid keys, so EF would treat them as existing rows: add them explicitly.
        if (req.Questions is not null) db.Questions.AddRange(a.Questions);
        await db.SaveChangesAsync(ct);
        return await GetAsync(user, id, ct);
    }

    private static Error? Apply(Assessment a, UpsertAssessmentRequest req)
    {
        if (!Enum.TryParse<AssessmentKind>(req.Kind, true, out var kind)) return Error.Validation("bad_kind", "يجب أن يكون النوع اختبارًا أو مهمة.");
        if (string.IsNullOrWhiteSpace(req.Title) || req.Title.Length > 200) return Error.Validation("bad_title", "اكتب عنوانًا (حتى 200 حرف).");
        a.Kind = kind;
        a.Title = req.Title.Trim();
        a.Instructions = string.IsNullOrWhiteSpace(req.Instructions) ? null : req.Instructions.Trim();
        a.OdooTrackId = req.TrackId;
        a.DueAt = req.DueAt?.ToUniversalTime();
        a.TimeLimitMinutes = req.TimeLimitMinutes is > 0 ? Math.Min(req.TimeLimitMinutes.Value, 600) : null;
        a.MaxAttempts = Math.Clamp(req.MaxAttempts, 1, 10);
        a.PassPercent = Math.Clamp(req.PassPercent, 0, 100);
        a.RevealAnswers = req.RevealAnswers;
        if (req.Questions is { } qs)
        {
            if (qs.Count > AssessmentRules.MaxQuestions) return Error.Validation("too_many", $"الحد الأقصى {AssessmentRules.MaxQuestions} سؤالًا.");
            a.Questions = qs.Select((q, i) => new AssessmentQuestion
            {
                AssessmentId = a.Id, Order = i, Text = q.Text.Trim(), Explanation = q.Explanation?.Trim(), Points = Math.Clamp(q.Points, 1, 10),
                Options = q.Options.Select((o, j) => new AssessmentOption { Order = j, Text = o.Text.Trim(), IsCorrect = o.IsCorrect }).ToList(),
            }).ToList();
        }
        return null;
    }

    public async Task<Result<AssessmentDetail>> GenerateAsync(CurrentUser user, int trackId, GenerateRequest req, CancellationToken ct)
    {
        var track = (await odoo.ReadAsync("event.track", [trackId], ["name", "event_id"], ct)).FirstOrDefault();
        if (track.M2O("event_id") is not { } ev) return Error.NotFound("session_not_found", "هذه المحاضرة غير موجودة.");
        if (await RoleAsync(user, ev.Id, ct) != "staff") return Error.Forbidden("staff_only", "توليد الاختبارات متاح لفريق الدورة فقط.");

        var transcript = await generator.TranscriptAsync(trackId, ct);
        if (!transcript.IsSuccess) return transcript.Error!;
        var course = LearningService.CleanTitle(ev.Name);
        var session = LearningService.CleanTitle(track.Str("name") ?? "");
        var quiz = await generator.GenerateAsync(course, session, transcript.Value!, req.Count, req.Difficulty is "easy" or "hard" ? req.Difficulty : "medium", ct);
        if (!quiz.IsSuccess) return quiz.Error!;

        var a = new Assessment
        {
            Kind = AssessmentKind.Quiz, OdooEventId = ev.Id, OdooTrackId = trackId, Title = quiz.Value!.Title, Status = AssessmentStatus.Draft,
            AiGenerated = true, CreatedByPartnerId = user.PartnerId, CreatedAt = Now, MaxAttempts = 2, PassPercent = 60, RevealAnswers = true,
            Instructions = "اختبار قصير على المحاضرة. اختر إجابة واحدة لكل سؤال.",
        };
        a.Questions = quiz.Value.Questions.Select((q, i) => new AssessmentQuestion
        {
            AssessmentId = a.Id, Order = i, Text = q.Text, Explanation = q.Explanation,
            // The model tends to put the right answer first; shuffle so position gives nothing away.
            Options = q.Options.Select((o, j) => new AssessmentOption { Text = o, IsCorrect = j == q.CorrectIndex })
                .OrderBy(_ => Random.Shared.Next()).Select((o, j) => { o.Order = j; return o; }).ToList(),
        }).ToList();
        db.Assessments.Add(a);
        await db.SaveChangesAsync(ct);
        return await GetAsync(user, a.Id, ct);
    }

    public async Task<Result<AssessmentDetail>> SetStatusAsync(CurrentUser user, Guid id, AssessmentStatus status, CancellationToken ct)
    {
        var loaded = await LoadAsync(user, id, ct, tracking: true);
        if (!loaded.IsSuccess) return loaded.Error!;
        var (a, staff) = loaded.Value;
        if (!staff) return Error.Forbidden("staff_only", "النشر متاح لفريق الدورة فقط.");
        if (status == AssessmentStatus.Published && AssessmentRules.ValidateForPublish(a) is { } invalid) return invalid;
        var firstPublish = status == AssessmentStatus.Published && a.PublishedAt is null;
        a.Status = status;
        if (firstPublish) a.PublishedAt = Now;
        await db.SaveChangesAsync(ct);

        if (firstPublish)
        {
            var people = await LearnersOnAppAsync(a.OdooEventId, ct);
            var what = a.Kind == AssessmentKind.Quiz ? "اختبار جديد" : "مهمة جديدة";
            await notifications.NotifyAsync(people, a.Kind == AssessmentKind.Quiz ? "quiz_published" : "task_published", $"{what} · {a.Title}",
                a.DueAt is { } due ? $"آخر موعد {due:yyyy/MM/dd}." : "افتحه من التطبيق.", $"/assessments/{a.Id}", tag: $"assessment-{a.Id}", ct: ct);
        }
        return await GetAsync(user, id, ct);
    }

    public async Task<Result<bool>> DeleteAsync(CurrentUser user, Guid id, CancellationToken ct)
    {
        var loaded = await LoadAsync(user, id, ct, tracking: true);
        if (!loaded.IsSuccess) return loaded.Error!;
        if (!loaded.Value.Staff) return Error.Forbidden("staff_only", "الحذف متاح لفريق الدورة فقط.");
        if (loaded.Value.A.Status != AssessmentStatus.Draft) return Error.Conflict("published", "لا يمكن حذف عنصر منشور. أغلقه بدلًا من ذلك.");
        db.Assessments.Remove(loaded.Value.A);
        await db.SaveChangesAsync(ct);
        return true;
    }

    private async Task<List<int>> LearnersOnAppAsync(int eventId, CancellationToken ct)
    {
        var appUsers = await db.RefreshTokens.Where(t => t.ExpiresAt > Now).Select(t => t.PartnerId).Distinct().ToListAsync(ct);
        if (appUsers.Count == 0) return [];
        return (await Seats.OfPeopleAsync(odoo, [eventId], appUsers, ct))
            .Where(s => ChatPolicy.IsEligibleStudent(s.Reg.Str("state"), s.Reg.Utc("access_expiration_date"), Now))
            .Select(s => s.PartnerId).Distinct().ToList();
    }
}

namespace Engosoft.Learn.Api.Assessments;

public enum AssessmentKind { Quiz, Task }
public enum AssessmentStatus { Draft, Published, Closed }

/// <summary>A quiz or a task on a live course (optionally tied to one session). Drafts are visible to the course team only.</summary>
public sealed class Assessment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public AssessmentKind Kind { get; set; }
    public int OdooEventId { get; set; }
    public int? OdooTrackId { get; set; }
    public string Title { get; set; } = "";
    public string? Instructions { get; set; }
    public AssessmentStatus Status { get; set; }
    public bool AiGenerated { get; set; }
    public int CreatedByPartnerId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? PublishedAt { get; set; }
    public DateTime? DueAt { get; set; }
    public int? TimeLimitMinutes { get; set; }
    public int MaxAttempts { get; set; } = 2;
    public int PassPercent { get; set; } = 60;
    public bool RevealAnswers { get; set; } = true;
    public List<AssessmentQuestion> Questions { get; set; } = [];
}

public sealed class AssessmentQuestion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AssessmentId { get; set; }
    public int Order { get; set; }
    public string Text { get; set; } = "";
    public string? Explanation { get; set; }
    public int Points { get; set; } = 1;
    public List<AssessmentOption> Options { get; set; } = [];
}

public sealed class AssessmentOption
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid QuestionId { get; set; }
    public int Order { get; set; }
    public string Text { get; set; } = "";
    public bool IsCorrect { get; set; }
}

public sealed class QuizAttempt
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AssessmentId { get; set; }
    public int PartnerId { get; set; }
    public string PartnerName { get; set; } = "";
    public DateTime SubmittedAt { get; set; }
    public int Score { get; set; }
    public int MaxScore { get; set; }
    public double Percent { get; set; }
    public bool Passed { get; set; }
    /// <summary>questionId:optionId pairs, comma separated.</summary>
    public string Answers { get; set; } = "";
}

public sealed class TaskSubmission
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AssessmentId { get; set; }
    public int PartnerId { get; set; }
    public string PartnerName { get; set; } = "";
    public string? Text { get; set; }
    public DateTime SubmittedAt { get; set; }
    public bool Late { get; set; }
    public double? Grade { get; set; }
    public string? Feedback { get; set; }
    public int? GradedBy { get; set; }
    public DateTime? GradedAt { get; set; }
    public List<SubmissionFile> Files { get; set; } = [];
}

public sealed class SubmissionFile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SubmissionId { get; set; }
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Size { get; set; }
    public string StoragePath { get; set; } = "";
}

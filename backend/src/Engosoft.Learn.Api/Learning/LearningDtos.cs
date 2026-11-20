namespace Engosoft.Learn.Api.Learning;

public enum SessionStatus { Upcoming, Live, Ended, Cancelled }

public sealed record InstructorDto(int? EmployeeId, string Name);

public sealed record LiveCourseCard(
    int EventId,
    string Title,
    string? Code,
    int? CourseChannelId,
    InstructorDto? Instructor,
    string Mode,
    DateTime? Start,
    DateTime? End,
    int SessionsTotal,
    int SessionsAttended,
    double AttendancePercent,
    DateTime? AccessUntil,
    bool Expired,
    SessionSummary? NextSession,
    string Role);

public sealed record SessionSummary(int Id, int EventId, string EventTitle, string Title, int Number, DateTime? Start, DateTime? End,
    SessionStatus Status, bool CanJoin, bool HasRecording, int DocumentCount);

public sealed record LiveCourseDetail(LiveCourseCard Course, string TimeZone, string[] WeekDays, IReadOnlyList<SessionSummary> Sessions);

public sealed record SessionDocument(int Id, string Name, string? Extension, string? Size);

/// <param name="RecordingOnWebsiteOnly">A recording exists but the app cannot sign it yet (Bunny:StreamTokenKey not set).</param>
public sealed record SessionDetail(SessionSummary Session, string? RecordingEmbedUrl, bool RecordingOnWebsiteOnly, string WebsiteUrl, IReadOnlyList<SessionDocument> Documents);

public sealed record JoinLink(string Url);

public sealed record RecordedCourseCard(int ChannelId, string Title, string? Summary, double Completion, string Status,
    int LessonsTotal, double TotalHours, DateTime? AccessUntil, bool Expired, bool FromLiveCourse, int? NextLessonId);

public sealed record LessonItem(int Id, string Title, string Type, double Minutes, bool Completed, bool IsPreview);

public sealed record LessonSection(int? Id, string Title, IReadOnlyList<LessonItem> Lessons);

public sealed record RecordedCourseDetail(RecordedCourseCard Course, string? Description, IReadOnlyList<LessonSection> Sections);

public sealed record LessonDetail(int Id, int ChannelId, string Title, string Type, double Minutes, bool Completed,
    string? VideoEmbedUrl, string? Html, string? DocumentUrl, bool HasFile, string? WebsiteUrl, int? PreviousLessonId, int? NextLessonId);

public sealed record CertificateDto(int Id, string Title, string Type, string? Number, DateTime? IssuedAt, double? Score);

public sealed record HomeDto(
    string Name,
    SessionSummary? NextSession,
    IReadOnlyList<SessionSummary> Upcoming,
    IReadOnlyList<LiveCourseCard> LiveCourses,
    IReadOnlyList<RecordedCourseCard> ContinueLearning,
    int CertificateCount,
    int UnreadNotifications,
    int UnreadMessages,
    string WebsiteUrl);

public sealed record ProfileDto(int PartnerId, string Name, string? NameAr, string? Email, string? Phone, string Kind, string WebsiteUrl);

public sealed record LessonQuizAnswer(int Id, string Text);
public sealed record LessonQuizQuestion(int Id, string Text, IReadOnlyList<LessonQuizAnswer> Answers);
public sealed record LessonQuiz(int SlideId, int ChannelId, string Title, bool Completed, int Attempts, IReadOnlyList<LessonQuizQuestion> Questions);
public sealed record LessonQuizSubmit(Dictionary<int, int> Answers);
public sealed record LessonQuizQuestionResult(int QuestionId, int? Chosen, bool IsCorrect, string? Comment);
public sealed record LessonQuizResult(bool Completed, int Correct, int Total, int Attempts, IReadOnlyList<LessonQuizQuestionResult> Questions);

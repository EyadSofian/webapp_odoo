using System.Text;
using System.Text.RegularExpressions;
using Engosoft.Learn.Api.Common;

namespace Engosoft.Learn.Api.Assessments;

public sealed record GradedQuestion(Guid QuestionId, Guid? Chosen, Guid[] Correct, bool IsCorrect, int Points);
public sealed record Grade(int Score, int MaxScore, double Percent, bool Passed, IReadOnlyList<GradedQuestion> Questions);

/// <summary>Assessment rules without I/O: grading, attempt limits and transcript cleanup.</summary>
public static partial class AssessmentRules
{
    public const int MaxQuestions = 40;

    public static Grade GradeQuiz(Assessment a, IReadOnlyDictionary<Guid, Guid> answers)
    {
        var graded = new List<GradedQuestion>();
        int score = 0, max = 0;
        foreach (var q in a.Questions.OrderBy(q => q.Order))
        {
            var correct = q.Options.Where(o => o.IsCorrect).Select(o => o.Id).ToArray();
            answers.TryGetValue(q.Id, out var chosen);
            var ok = chosen != Guid.Empty && correct.Contains(chosen);
            max += q.Points;
            if (ok) score += q.Points;
            graded.Add(new GradedQuestion(q.Id, chosen == Guid.Empty ? null : chosen, correct, ok, q.Points));
        }
        var pct = max == 0 ? 0 : Math.Round(100.0 * score / max, 1);
        return new Grade(score, max, pct, pct >= a.PassPercent, graded);
    }

    public static Error? CanAttempt(Assessment a, int attemptsSoFar, DateTime now)
    {
        if (a.Kind != AssessmentKind.Quiz) return Error.Validation("not_a_quiz", "ده تاسك مش اختبار.");
        if (a.Status != AssessmentStatus.Published) return Error.Blocked("not_open", "الاختبار ده مش متاح دلوقتي.");
        if (a.DueAt is { } due && now > due) return Error.Blocked("past_due", "ميعاد الاختبار خلص.");
        if (attemptsSoFar >= a.MaxAttempts) return Error.Blocked("no_attempts_left", $"استخدمت كل المحاولات ({a.MaxAttempts}).");
        return null;
    }

    public static Error? CanSubmitTask(Assessment a)
    {
        if (a.Kind != AssessmentKind.Task) return Error.Validation("not_a_task", "ده اختبار مش تاسك.");
        if (a.Status != AssessmentStatus.Published) return Error.Blocked("not_open", "التاسك ده مش متاح دلوقتي.");
        return null;
    }

    /// <summary>A quiz can be published only when every question has text, at least two options and exactly one right answer.</summary>
    public static Error? ValidateForPublish(Assessment a)
    {
        if (string.IsNullOrWhiteSpace(a.Title)) return Error.Validation("no_title", "اكتب عنوان.");
        if (a.Kind == AssessmentKind.Task) return null;
        if (a.Questions.Count == 0) return Error.Validation("no_questions", "ضيف سؤال واحد على الأقل.");
        foreach (var (q, i) in a.Questions.OrderBy(q => q.Order).Select((q, i) => (q, i + 1)))
        {
            if (string.IsNullOrWhiteSpace(q.Text)) return Error.Validation("empty_question", $"السؤال {i} فاضي.");
            if (q.Options.Count(o => !string.IsNullOrWhiteSpace(o.Text)) < 2) return Error.Validation("few_options", $"السؤال {i} محتاج اختيارين على الأقل.");
            if (q.Options.Count(o => o.IsCorrect) != 1) return Error.Validation("one_correct", $"السؤال {i} لازم يكون ليه إجابة صحيحة واحدة.");
        }
        return null;
    }

    [GeneratedRegex(@"^\d+$")] private static partial Regex CueIndex();
    [GeneratedRegex(@"-->")] private static partial Regex Timing();
    [GeneratedRegex(@"<[^>]+>")] private static partial Regex Tags();

    /// <summary>Turns a Zoom WebVTT caption file into plain text, merging consecutive lines of the same speaker.</summary>
    public static string VttToText(string vtt, int maxChars = 60_000)
    {
        var sb = new StringBuilder();
        string? lastSpeaker = null;
        foreach (var raw in vtt.Replace("\r", "").Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line == "WEBVTT" || line.StartsWith("NOTE") || CueIndex().IsMatch(line) || Timing().IsMatch(line)) continue;
            line = Tags().Replace(line, "");
            string? speaker = null;
            var colon = line.IndexOf(':');
            if (colon is > 0 and < 40) { speaker = line[..colon].Trim(); line = line[(colon + 1)..].Trim(); }
            if (line.Length == 0) continue;
            if (speaker is not null && speaker != lastSpeaker)
            {
                sb.Append('\n').Append(speaker).Append(": ");
                lastSpeaker = speaker;
            }
            else sb.Append(' ');
            sb.Append(line);
            if (sb.Length > maxChars) break;
        }
        var text = sb.ToString().Trim();
        return text.Length > maxChars ? text[..maxChars] : text;
    }
}

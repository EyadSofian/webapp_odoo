using Engosoft.Learn.Api.Assessments;

namespace Engosoft.Learn.Tests;

public class AssessmentRulesTests
{
    private static readonly DateTime Now = new(2026, 11, 21, 12, 0, 0, DateTimeKind.Utc);

    private static Assessment Quiz(int questions = 2, int pass = 60, int attempts = 2)
    {
        var a = new Assessment { Kind = AssessmentKind.Quiz, Status = AssessmentStatus.Published, Title = "Quiz", PassPercent = pass, MaxAttempts = attempts };
        for (var i = 0; i < questions; i++)
        {
            var q = new AssessmentQuestion { Order = i, Text = $"Q{i}", Points = 1 };
            q.Options = [new() { Text = "right", IsCorrect = true }, new() { Text = "wrong" }, new() { Text = "wrong 2" }];
            a.Questions.Add(q);
        }
        return a;
    }

    [Fact]
    public void Grades_by_points_and_pass_mark()
    {
        var a = Quiz(questions: 4, pass: 75);
        var answers = a.Questions.Take(3).ToDictionary(q => q.Id, q => q.Options[0].Id);
        var g = AssessmentRules.GradeQuiz(a, answers);
        Assert.Equal(3, g.Score);
        Assert.Equal(4, g.MaxScore);
        Assert.Equal(75, g.Percent);
        Assert.True(g.Passed);
        Assert.Null(g.Questions[3].Chosen);
        Assert.False(g.Questions[3].IsCorrect);
    }

    [Fact]
    public void Wrong_answers_score_zero()
    {
        var a = Quiz();
        var g = AssessmentRules.GradeQuiz(a, a.Questions.ToDictionary(q => q.Id, q => q.Options[1].Id));
        Assert.Equal(0, g.Score);
        Assert.False(g.Passed);
    }

    [Fact]
    public void Attempts_are_limited_and_drafts_are_closed()
    {
        var a = Quiz(attempts: 2);
        Assert.Null(AssessmentRules.CanAttempt(a, 1, Now));
        Assert.Equal("no_attempts_left", AssessmentRules.CanAttempt(a, 2, Now)!.Code);
        a.Status = AssessmentStatus.Draft;
        Assert.Equal("not_open", AssessmentRules.CanAttempt(a, 0, Now)!.Code);
        a.Status = AssessmentStatus.Published;
        a.DueAt = Now.AddMinutes(-1);
        Assert.Equal("past_due", AssessmentRules.CanAttempt(a, 0, Now)!.Code);
    }

    [Fact]
    public void Publishing_requires_exactly_one_right_answer_per_question()
    {
        var a = Quiz();
        Assert.Null(AssessmentRules.ValidateForPublish(a));
        a.Questions[1].Options[1].IsCorrect = true;
        Assert.Equal("one_correct", AssessmentRules.ValidateForPublish(a)!.Code);
        a.Questions.Clear();
        Assert.Equal("no_questions", AssessmentRules.ValidateForPublish(a)!.Code);
    }

    [Fact]
    public void Zoom_captions_become_plain_text_grouped_by_speaker()
    {
        const string vtt = """
            WEBVTT

            1
            00:00:01.000 --> 00:00:04.000
            Eng. Islam: Today we size the main <i>cable</i>.

            2
            00:00:04.500 --> 00:00:07.000
            Eng. Islam: Start from the load in kW.

            3
            00:00:08.000 --> 00:00:09.000
            Ahmed: Which table do we use?
            """;
        var text = AssessmentRules.VttToText(vtt);
        Assert.Equal("Eng. Islam: Today we size the main cable. Start from the load in kW.\nAhmed: Which table do we use?", text);
    }
}

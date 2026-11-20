using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Odoo;
using Microsoft.Extensions.Options;
using static Engosoft.Learn.Api.Odoo.OdooClientExtensions;

namespace Engosoft.Learn.Api.Assessments;

public sealed class OpenAiOptions
{
    public const string Section = "OpenAI";
    /// <summary>From user secrets or the environment. Never committed.</summary>
    public string ApiKey { get; set; } = "";
    public string BaseUrl { get; set; } = "https://api.openai.com/v1/";
    public string QuizModel { get; set; } = "gpt-5.4-mini";
    public int TimeoutSeconds { get; set; } = 180;
}

public sealed record GeneratedQuestion(string Text, string[] Options, int CorrectIndex, string Explanation);
public sealed record GeneratedQuiz(string Title, IReadOnlyList<GeneratedQuestion> Questions);

/// <summary>
/// Drafts multiple-choice questions from what was actually said in a session (its Zoom transcript).
/// The result is always a draft: an instructor reviews and publishes it, the model never does.
/// </summary>
public sealed class QuizGenerator(
    IHttpClientFactory httpFactory,
    IOdooClient odoo,
    IOptions<OpenAiOptions> options,
    ILogger<QuizGenerator> log)
{
    public bool Configured => !string.IsNullOrEmpty(options.Value.ApiKey);

    public async Task<Result<string>> TranscriptAsync(int trackId, CancellationToken ct)
    {
        var docs = await odoo.SearchReadAsync("event.track.document",
            D(("track_id", "=", trackId), ("source", "=", "zoom_caption")), ["id"], order: "id desc", limit: 1, ct: ct);
        if (docs.Count == 0)
            return Error.Blocked("no_transcript", "لا يتوفر نص (Transcript) لهذه المحاضرة من Zoom بعد. اكتب الأسئلة بنفسك أو انتظر حتى تتم معالجة التسجيل.");
        var url = (await odoo.ReadAsync("event.track.document", [docs[0].Id()], ["bunny_signed_url"], ct)).FirstOrDefault().Str("bunny_signed_url");
        if (string.IsNullOrEmpty(url)) return Error.Blocked("no_transcript", "ملف النص غير متاح حاليًا.");
        var vtt = await httpFactory.CreateClient("files").GetStringAsync(url, ct);
        var text = AssessmentRules.VttToText(vtt);
        return text.Length < 400
            ? Error.Blocked("short_transcript", "نص المحاضرة قصير جدًا ولا يكفي لإعداد اختبار.")
            : text;
    }

    public async Task<Result<GeneratedQuiz>> GenerateAsync(string courseTitle, string sessionTitle, string transcript, int count, string difficulty, CancellationToken ct)
    {
        if (!Configured) return Error.Blocked("ai_not_configured", "مفتاح الذكاء الاصطناعي غير مضبوط على الخادم.");
        count = Math.Clamp(count, 3, 20);

        var schema = new JsonObject
        {
            ["type"] = "object",
            ["additionalProperties"] = false,
            ["required"] = new JsonArray("title", "questions"),
            ["properties"] = new JsonObject
            {
                ["title"] = new JsonObject { ["type"] = "string" },
                ["questions"] = new JsonObject
                {
                    ["type"] = "array",
                    ["items"] = new JsonObject
                    {
                        ["type"] = "object",
                        ["additionalProperties"] = false,
                        ["required"] = new JsonArray("text", "options", "correctIndex", "explanation"),
                        ["properties"] = new JsonObject
                        {
                            ["text"] = new JsonObject { ["type"] = "string" },
                            ["options"] = new JsonObject { ["type"] = "array", ["items"] = new JsonObject { ["type"] = "string" } },
                            ["correctIndex"] = new JsonObject { ["type"] = "integer" },
                            ["explanation"] = new JsonObject { ["type"] = "string" },
                        },
                    },
                },
            },
        };

        var system = """
            You write assessment questions for Engosoft, an engineering training company (MEP, BIM, electrical, interior design, project management).
            Write questions that check understanding of the technical content of ONE recorded session, using only what the transcript says.
            Rules:
            - Exactly four options per question, exactly one correct. Wrong options must be plausible to a learner who did not follow the session.
            - Cover the most important ideas; mix recall, understanding and application (a short scenario or calculation the session supports).
            - Never ask about logistics: attendance, links, breaks, homework deadlines, the instructor's jokes or names of learners.
            - Write in clear Modern Standard Arabic. Keep technical terms in English where engineers use them (e.g. "Duct", "BIM", "Revit").
            - The explanation says in one or two sentences why the right answer is right, based on the session.
            - Do not number questions and do not label options with letters.
            """;
        var user = $"""
            Course: {courseTitle}
            Session: {sessionTitle}
            Number of questions: {count}
            Difficulty: {difficulty}
            Title: a short Arabic title for this quiz.

            Transcript (speaker: text):
            {transcript}
            """;

        var body = new JsonObject
        {
            ["model"] = options.Value.QuizModel,
            ["messages"] = new JsonArray(
                new JsonObject { ["role"] = "system", ["content"] = system },
                new JsonObject { ["role"] = "user", ["content"] = user }),
            ["response_format"] = new JsonObject
            {
                ["type"] = "json_schema",
                ["json_schema"] = new JsonObject { ["name"] = "session_quiz", ["strict"] = true, ["schema"] = schema },
            },
        };

        var http = httpFactory.CreateClient("openai");
        using var req = new HttpRequestMessage(HttpMethod.Post, "chat/completions") { Content = JsonContent.Create(body) };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.Value.ApiKey);
        using var res = await http.SendAsync(req, ct);
        var raw = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            log.LogWarning("OpenAI quiz generation failed with {Status}: {Body}", (int)res.StatusCode, raw.Length > 500 ? raw[..500] : raw);
            return Error.Upstream("خدمة الذكاء الاصطناعي غير متاحة حاليًا. أعد المحاولة بعد قليل.");
        }

        try
        {
            using var doc = JsonDocument.Parse(raw);
            var content = doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "{}";
            using var quiz = JsonDocument.Parse(content);
            var title = quiz.RootElement.GetProperty("title").GetString() ?? sessionTitle;
            var questions = new List<GeneratedQuestion>();
            foreach (var q in quiz.RootElement.GetProperty("questions").EnumerateArray())
            {
                var opts = q.GetProperty("options").EnumerateArray().Select(o => o.GetString() ?? "").Where(o => o.Length > 0).ToArray();
                var correct = q.GetProperty("correctIndex").GetInt32();
                if (opts.Length < 2 || correct < 0 || correct >= opts.Length) continue; // drop malformed items rather than publish them
                questions.Add(new GeneratedQuestion(q.GetProperty("text").GetString() ?? "", opts, correct, q.GetProperty("explanation").GetString() ?? ""));
            }
            return questions.Count == 0
                ? Error.Upstream("لم يُنتج الذكاء الاصطناعي أسئلة صالحة. أعد المحاولة.")
                : new GeneratedQuiz(title, questions);
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            log.LogWarning(ex, "OpenAI returned an unexpected quiz payload");
            return Error.Upstream("أعاد الذكاء الاصطناعي ردًا غير مفهوم. أعد المحاولة.");
        }
    }
}

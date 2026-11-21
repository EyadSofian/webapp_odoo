using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Engosoft.Learn.Api.Chat;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Learning;
using Engosoft.Learn.Api.Odoo;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using static Engosoft.Learn.Api.Odoo.OdooClientExtensions;

namespace Engosoft.Learn.Api.Notifications;

public sealed record PushSubscribeRequest(string Endpoint, PushKeys Keys);
public sealed record PushKeys(string P256dh, string Auth);
public sealed record PushUnsubscribeRequest(string Endpoint);
public sealed record MarkNotificationsRead(long? UpToId);
public sealed record PreferencesDto(bool QuietHoursEnabled, int QuietFromMinute, int QuietToMinute, string TimeZone);

public sealed class WebhookOptions
{
    public const string Section = "Webhooks";
    /// <summary>Shared secret in the webhook URL. Odoo automation rules cannot add headers, so it travels in the path.</summary>
    public string Secret { get; set; } = "";
}

public static class NotificationsModule
{
    public static IServiceCollection AddNotificationsModule(this IServiceCollection services)
    {
        services.AddOptions<PushOptions>().BindConfiguration(PushOptions.Section);
        services.AddOptions<WebhookOptions>().BindConfiguration(WebhookOptions.Section);
        services.AddSingleton<VapidKeys>();
        services.AddScoped<NotificationService>();
        services.AddScoped<PushSender>();
        services.AddHttpClient("webpush", c => c.Timeout = TimeSpan.FromSeconds(20));
        services.AddHostedService<ReminderWorker>();
        return services;
    }

    public static void MapNotificationEndpoints(this WebApplication app)
    {
        app.MapGet("/api/push/public-key", async (VapidKeys keys, CancellationToken ct) =>
            Results.Ok(new { publicKey = (await keys.GetAsync(ct)).PublicKey })).WithTags("Notifications").AllowAnonymous();

        var g = app.MapGroup("/api").WithTags("Notifications").RequireAuthorization().RequireRateLimiting("api");

        g.MapPost("/push/subscriptions", async (PushSubscribeRequest body, AppDbContext db, CurrentUser u, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            if (!Uri.TryCreate(body.Endpoint, UriKind.Absolute, out var uri) || uri.Scheme != "https" || body.Keys is null
                || string.IsNullOrEmpty(body.Keys.P256dh) || string.IsNullOrEmpty(body.Keys.Auth) || body.Endpoint.Length > 1000)
                return Error.Validation("bad_subscription", "الاشتراك في الإشعارات غير صالح.").ToProblem();
            var existing = await db.PushSubscriptions.SingleOrDefaultAsync(s => s.Endpoint == body.Endpoint, ct);
            if (existing is null)
                db.PushSubscriptions.Add(existing = new Data.PushSubscription { Endpoint = body.Endpoint, CreatedAt = clock.GetUtcNow().UtcDateTime });
            existing.PartnerId = u.PartnerId; // a shared device follows whoever signed in last
            existing.P256dh = body.Keys.P256dh;
            existing.Auth = body.Keys.Auth;
            existing.Failures = 0;
            existing.UserAgent = http.Request.Headers.UserAgent.ToString() is { Length: > 500 } ua ? ua[..500] : http.Request.Headers.UserAgent.ToString();
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        g.MapPost("/push/unsubscribe", async (PushUnsubscribeRequest body, AppDbContext db, CurrentUser u, CancellationToken ct) =>
        {
            await db.PushSubscriptions.Where(s => s.Endpoint == body.Endpoint && s.PartnerId == u.PartnerId).ExecuteDeleteAsync(ct);
            return Results.NoContent();
        });

        g.MapPost("/push/test", (NotificationService n, CurrentUser u) =>
        {
            n.PushOnly([u.PartnerId], new PushMessage("الإشعارات مفعّلة ✓", "سيصلك تنبيه قبل كل محاضرة، وعندما يرد عليك المحاضر.", "/", "test", Urgent: true));
            return Results.Accepted();
        });

        g.MapGet("/notifications", async (long? before, int? limit, NotificationService n, CurrentUser u, CancellationToken ct) =>
            Results.Ok((await n.ListAsync(u.PartnerId, before, limit ?? 30, ct))
                .Select(x => new { x.Id, x.Kind, x.Title, x.Body, x.Url, x.CreatedAt, read = x.ReadAt != null })));

        g.MapPost("/notifications/read", async (MarkNotificationsRead body, NotificationService n, CurrentUser u, CancellationToken ct) =>
        {
            await n.MarkReadAsync(u.PartnerId, body.UpToId, ct);
            return Results.NoContent();
        });

        g.MapGet("/preferences", async (AppDbContext db, CurrentUser u, CancellationToken ct) =>
        {
            var p = await db.Preferences.FindAsync([u.PartnerId], ct) ?? new UserPreference { PartnerId = u.PartnerId };
            return Results.Ok(new PreferencesDto(p.QuietHoursEnabled, p.QuietFromMinute, p.QuietToMinute, p.TimeZone));
        });

        g.MapPut("/preferences", async (PreferencesDto body, AppDbContext db, CurrentUser u, TimeProvider clock, CancellationToken ct) =>
        {
            try { TimeZoneInfo.FindSystemTimeZoneById(body.TimeZone); }
            catch { return Error.Validation("bad_timezone", "المنطقة الزمنية غير صحيحة.").ToProblem(); }
            var p = await db.Preferences.FindAsync([u.PartnerId], ct);
            if (p is null) db.Preferences.Add(p = new UserPreference { PartnerId = u.PartnerId });
            p.QuietHoursEnabled = body.QuietHoursEnabled;
            p.QuietFromMinute = Math.Clamp(body.QuietFromMinute, 0, 1439);
            p.QuietToMinute = Math.Clamp(body.QuietToMinute, 0, 1439);
            p.TimeZone = body.TimeZone;
            p.UpdatedAt = clock.GetUtcNow().UtcDateTime;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        MapWebhooks(app);
    }

    /// <summary>
    /// Odoo automation rules ("Send Webhook Notification") call these. Each rule posts the record's id;
    /// we re-read the record from Odoo instead of trusting the payload.
    /// </summary>
    private static void MapWebhooks(WebApplication app)
    {
        app.MapPost("/api/webhooks/odoo/{secret}/{kind}", async (string secret, string kind, HttpRequest request,
            IOptions<WebhookOptions> options, BackgroundJobQueue jobs, ILogger<WebhookOptions> log) =>
        {
            var expected = options.Value.Secret;
            if (string.IsNullOrEmpty(expected) || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(expected)))
                return Results.NotFound();

            int? id = null;
            try
            {
                using var doc = await JsonDocument.ParseAsync(request.Body);
                if (doc.RootElement.ValueKind == JsonValueKind.Object)
                {
                    if (doc.RootElement.TryGetProperty("_id", out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var a)) id = a;
                    else if (doc.RootElement.TryGetProperty("id", out var v2) && v2.ValueKind == JsonValueKind.Number && v2.TryGetInt32(out var b)) id = b;
                }
            }
            catch (JsonException) { }
            if (id is null) return Results.BadRequest(new { error = "missing _id" });

            Func<IServiceProvider, CancellationToken, Task>? job = kind switch
            {
                "registration" => (sp, ct) => OnRegistrationAsync(sp, id.Value, ct),
                "session-changed" => (sp, ct) => OnSessionChangedAsync(sp, id.Value, ct),
                "recording-ready" => (sp, ct) => OnRecordingReadyAsync(sp, id.Value, ct),
                "document-added" => (sp, ct) => OnDocumentAddedAsync(sp, id.Value, ct),
                _ => null,
            };
            if (job is null) return Results.NotFound();
            log.LogInformation("Odoo webhook {Kind} for record {Id}", kind, id);
            jobs.Enqueue($"webhook:{kind}", job);
            return Results.Accepted();
        }).WithTags("Webhooks").AllowAnonymous().DisableAntiforgery();
    }

    private static async Task OnRegistrationAsync(IServiceProvider sp, int registrationId, CancellationToken ct)
    {
        var odoo = sp.GetRequiredService<IOdooClient>();
        var reg = await odoo.ReadAsync("event.registration", [registrationId], ["event_id"], ct);
        if (reg.FirstOrDefault().M2O("event_id") is { } ev)
            await sp.GetRequiredService<MembershipSync>().SyncEventAsync(ev.Id, ct);
    }

    private static async Task<(int EventId, string EventName, string TrackName, DateTime? Start, string Tz, List<int> People)?> AudienceAsync(
        IServiceProvider sp, int trackId, CancellationToken ct)
    {
        var odoo = sp.GetRequiredService<IOdooClient>();
        var db = sp.GetRequiredService<AppDbContext>();
        var now = sp.GetRequiredService<TimeProvider>().GetUtcNow().UtcDateTime;
        var track = (await odoo.ReadAsync("event.track", [trackId], ["name", "event_id", "date"], ct)).FirstOrDefault();
        if (track.M2O("event_id") is not { } ev) return null;
        var tz = (await odoo.ReadAsync("event.event", [ev.Id], ["date_tz"], ct)).FirstOrDefault().Str("date_tz") ?? "Asia/Riyadh";
        var appUsers = await db.RefreshTokens.Where(t => t.ExpiresAt > now).Select(t => t.PartnerId).Distinct().ToListAsync(ct);
        if (appUsers.Count == 0) return (ev.Id, ev.Name, track.Str("name") ?? "", track.Utc("date"), tz, []);
        var people = (await Seats.OfPeopleAsync(odoo, [ev.Id], appUsers, ct))
            .Where(s => ChatPolicy.IsEligibleStudent(s.Reg.Str("state"), s.Reg.Utc("access_expiration_date"), now))
            .Select(s => s.PartnerId).Distinct().ToList();
        return (ev.Id, LearningService.CleanTitle(ev.Name), LearningService.CleanTitle(track.Str("name") ?? ""), track.Utc("date"), tz, people);
    }

    private static async Task OnSessionChangedAsync(IServiceProvider sp, int trackId, CancellationToken ct)
    {
        if (await AudienceAsync(sp, trackId, ct) is not { } a || a.People.Count == 0) return;
        var when = a.Start is { } s ? FormatLocal(s, a.Tz) : "موعد جديد";
        await sp.GetRequiredService<NotificationService>().NotifyAsync(a.People, "session_changed",
            $"تعديل في موعد المحاضرة · {a.EventName}", $"{a.TrackName}: {when}", $"/live/{a.EventId}?session={trackId}",
            urgent: true, tag: $"session-{trackId}", ct: ct);
    }

    private static async Task OnRecordingReadyAsync(IServiceProvider sp, int trackId, CancellationToken ct)
    {
        if (await AudienceAsync(sp, trackId, ct) is not { } a || a.People.Count == 0) return;
        await sp.GetRequiredService<NotificationService>().NotifyAsync(a.People, "recording_ready",
            $"التسجيل متاح · {a.EventName}", $"{a.TrackName}. يمكنك مشاهدته الآن.", $"/sessions/{trackId}",
            tag: $"recording-{trackId}", ct: ct);
    }

    private static async Task OnDocumentAddedAsync(IServiceProvider sp, int documentId, CancellationToken ct)
    {
        var odoo = sp.GetRequiredService<IOdooClient>();
        var doc = (await odoo.ReadAsync("event.track.document", [documentId], ["track_id", "source"], ct)).FirstOrDefault();
        if (doc.Str("source") != "manual" || doc.M2O("track_id") is not { } track) return;
        if (await AudienceAsync(sp, track.Id, ct) is not { } a || a.People.Count == 0) return;
        await sp.GetRequiredService<NotificationService>().NotifyAsync(a.People, "document_added",
            $"ملف جديد · {a.EventName}", $"رفع المحاضر ملفًا في {a.TrackName}.", $"/sessions/{track.Id}",
            tag: $"docs-{track.Id}", ct: ct);
    }

    private static string FormatLocal(DateTime utc, string tzId)
    {
        TimeZoneInfo tz;
        try { tz = TimeZoneInfo.FindSystemTimeZoneById(tzId); } catch { tz = TimeZoneInfo.Utc; }
        var local = TimeZoneInfo.ConvertTimeFromUtc(utc, tz);
        var culture = new System.Globalization.CultureInfo("ar-EG");
        return local.ToString("dddd d MMMM، h:mm tt", culture);
    }
}

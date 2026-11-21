using Engosoft.Learn.Api.Chat;
using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Learning;
using Engosoft.Learn.Api.Odoo;
using Microsoft.EntityFrameworkCore;
using static Engosoft.Learn.Api.Odoo.OdooClientExtensions;

namespace Engosoft.Learn.Api.Notifications;

/// <summary>
/// Session reminders: about a day before, an hour before, and at start time ("live now").
/// Each (session, kind) is sent once. Only people who use the app get them; everyone else keeps Odoo's emails and WhatsApp.
/// </summary>
public sealed class ReminderWorker(IServiceScopeFactory scopes, TimeProvider clock, ILogger<ReminderWorker> log) : BackgroundService
{
    public static string? DueKind(double minutesToStart) => minutesToStart switch
    {
        <= 10 and > -5 => "live",
        <= 60 and > 15 => "hour",
        <= 24 * 60 and > 90 => "day",
        _ => null,
    };

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do
        {
            try { await TickAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { log.LogError(ex, "Reminder tick failed"); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task TickAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var odoo = scope.ServiceProvider.GetRequiredService<IOdooClient>();
        var notifications = scope.ServiceProvider.GetRequiredService<NotificationService>();
        var now = clock.GetUtcNow().UtcDateTime;

        // People who signed in to the app recently. Reminders are only for them.
        var appUsers = await db.RefreshTokens.Where(t => t.ExpiresAt > now).Select(t => t.PartnerId).Distinct().ToListAsync(ct);
        if (appUsers.Count == 0) return;

        var tracks = await odoo.SearchReadAsync("event.track",
            D(("date", ">=", now.AddMinutes(-5).ToOdoo()), ("date", "<=", now.AddHours(24).ToOdoo())),
            ["name", "event_id", "date", "stage_id"], order: "date asc", limit: 500, ct: ct);

        var due = new List<(int TrackId, int EventId, string EventName, string TrackName, string Kind)>();
        foreach (var t in tracks)
        {
            if (t.M2O("stage_id")?.Name is "Cancelled" or "Refused") continue;
            if (t.Utc("date") is not { } start || t.M2O("event_id") is not { } ev) continue;
            if (DueKind((start - now).TotalMinutes) is not { } kind) continue;
            due.Add((t.Id(), ev.Id, LearningService.CleanTitle(ev.Name), LearningService.CleanTitle(t.Str("name") ?? ""), kind));
        }
        if (due.Count == 0) return;

        var trackIds = due.Select(d => d.TrackId).ToArray();
        var sent = await db.SentReminders.Where(s => trackIds.Contains(s.TrackId)).Select(s => new { s.TrackId, s.Kind }).ToListAsync(ct);
        due = due.Where(d => !sent.Any(s => s.TrackId == d.TrackId && s.Kind == d.Kind)).ToList();
        if (due.Count == 0) return;

        var eventIds = due.Select(d => d.EventId).Distinct().ToArray();
        var seats = await Seats.OfPeopleAsync(odoo, eventIds, appUsers, ct);
        var byEvent = seats
            .Where(s => ChatPolicy.IsEligibleStudent(s.Reg.Str("state"), s.Reg.Utc("access_expiration_date"), now) && s.Reg.M2O("event_id") is not null)
            .GroupBy(s => s.Reg.M2O("event_id")!.Value.Id)
            .ToDictionary(g => g.Key, g => g.Select(s => s.PartnerId).Distinct().ToList());

        foreach (var d in due)
        {
            db.SentReminders.Add(new SentReminder { TrackId = d.TrackId, Kind = d.Kind, SentAt = now });
            await db.SaveChangesAsync(ct);
            if (!byEvent.TryGetValue(d.EventId, out var people) || people.Count == 0) continue;

            var (title, body, urgent) = d.Kind switch
            {
                "live" => ($"بدأت المحاضرة · {d.EventName}", $"{d.TrackName}. ادخل الآن من التطبيق.", true),
                "hour" => ($"المحاضرة بعد أقل من ساعة · {d.EventName}", $"{d.TrackName}. استعد للمحاضرة.", false),
                _ => ($"لديك محاضرة اليوم أو غدًا · {d.EventName}", $"{d.TrackName}. افتح التطبيق لمعرفة الموعد.", false),
            };
            await notifications.NotifyAsync(people, $"session_{d.Kind}", title, body, $"/live/{d.EventId}?session={d.TrackId}",
                urgent: urgent, tag: $"session-{d.TrackId}", ct: ct);
            log.LogInformation("Sent {Kind} reminder for session {Track} to {Count} people", d.Kind, d.TrackId, people.Count);
        }
    }
}

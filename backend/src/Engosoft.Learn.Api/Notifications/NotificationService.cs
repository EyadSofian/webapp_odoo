using System.Net;
using System.Text.Json;
using Engosoft.Learn.Api.Chat;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using WebPush;
using DbPushSubscription = Engosoft.Learn.Api.Data.PushSubscription;

namespace Engosoft.Learn.Api.Notifications;

public sealed class PushOptions
{
    public const string Section = "Push";
    /// <summary>VAPID contact, e.g. mailto:support@engosoft.com.</summary>
    public string Subject { get; set; } = "mailto:support@engosoft.com";
    /// <summary>Optional. When empty, a key pair is generated once and kept in the database.</summary>
    public string PublicKey { get; set; } = "";
    public string PrivateKey { get; set; } = "";
    public int TtlSeconds { get; set; } = 60 * 60 * 6;
}

public sealed record PushMessage(string Title, string Body, string Url, string? Tag = null, bool Urgent = false);

/// <summary>VAPID keys: from configuration if set, else generated once and stored, so subscriptions survive restarts.</summary>
public sealed class VapidKeys(IOptions<PushOptions> options, IServiceScopeFactory scopes)
{
    private VapidDetails? _details;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task<VapidDetails> GetAsync(CancellationToken ct)
    {
        if (_details is not null) return _details;
        await _gate.WaitAsync(ct);
        try
        {
            if (_details is not null) return _details;
            var o = options.Value;
            if (!string.IsNullOrEmpty(o.PublicKey) && !string.IsNullOrEmpty(o.PrivateKey))
                return _details = new VapidDetails(o.Subject, o.PublicKey, o.PrivateKey);

            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var pub = await db.Settings.FindAsync(["vapid_public"], ct);
            var priv = await db.Settings.FindAsync(["vapid_private"], ct);
            if (pub is null || priv is null)
            {
                var generated = VapidHelper.GenerateVapidKeys();
                db.Settings.Add(pub = new AppSetting { Key = "vapid_public", Value = generated.PublicKey });
                db.Settings.Add(priv = new AppSetting { Key = "vapid_private", Value = generated.PrivateKey });
                await db.SaveChangesAsync(ct);
            }
            return _details = new VapidDetails(o.Subject, pub.Value, priv.Value);
        }
        finally { _gate.Release(); }
    }
}

public sealed class NotificationService(
    AppDbContext db,
    IHubContext<ChatHub> hub,
    BackgroundJobQueue jobs,
    TimeProvider clock)
{
    public Task<int> UnreadCountAsync(int partnerId, CancellationToken ct) =>
        db.Notifications.CountAsync(n => n.PartnerId == partnerId && n.ReadAt == null, ct);

    public Task<List<Notification>> ListAsync(int partnerId, long? beforeId, int limit, CancellationToken ct)
    {
        var q = db.Notifications.Where(n => n.PartnerId == partnerId);
        if (beforeId is { } b) q = q.Where(n => n.Id < b);
        return q.OrderByDescending(n => n.Id).Take(Math.Clamp(limit, 1, 100)).ToListAsync(ct);
    }

    public async Task MarkReadAsync(int partnerId, long? upToId, CancellationToken ct)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var q = db.Notifications.Where(n => n.PartnerId == partnerId && n.ReadAt == null);
        if (upToId is { } id) q = q.Where(n => n.Id <= id);
        await q.ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, now), ct);
    }

    /// <summary>Saves an in-app notification for each person, tells open apps, and queues a push.</summary>
    public async Task NotifyAsync(IReadOnlyCollection<int> partnerIds, string kind, string title, string body, string url,
        bool urgent = false, string? tag = null, CancellationToken ct = default)
    {
        if (partnerIds.Count == 0) return;
        var now = clock.GetUtcNow().UtcDateTime;
        var rows = partnerIds.Distinct().Select(p => new Notification { PartnerId = p, Kind = kind, Title = title, Body = body, Url = url, CreatedAt = now }).ToList();
        db.Notifications.AddRange(rows);
        await db.SaveChangesAsync(ct);
        foreach (var n in rows)
            await hub.Clients.Group(ChatHub.UserGroup(n.PartnerId)).SendAsync("notification",
                new { n.Id, n.Kind, n.Title, n.Body, n.Url, n.CreatedAt }, ct);
        PushOnly(partnerIds, new PushMessage(title, body, url, tag ?? kind, urgent));
    }

    /// <summary>Queues a push without an inbox entry (chat messages have their own unread state).</summary>
    public void PushOnly(IReadOnlyCollection<int> partnerIds, PushMessage message)
    {
        var targets = partnerIds.Distinct().ToArray();
        if (targets.Length == 0) return;
        jobs.Enqueue("push", (sp, ct) => sp.GetRequiredService<PushSender>().SendAsync(targets, message, ct));
    }
}

/// <summary>Delivers Web Push to every device a person registered. Dead subscriptions are removed.</summary>
public sealed class PushSender(
    AppDbContext db,
    VapidKeys vapid,
    IHttpClientFactory httpFactory,
    IOptions<PushOptions> options,
    TimeProvider clock,
    ILogger<PushSender> log)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task SendAsync(int[] partnerIds, PushMessage message, CancellationToken ct)
    {
        var subs = await db.PushSubscriptions.Where(s => partnerIds.Contains(s.PartnerId)).ToListAsync(ct);
        if (subs.Count == 0) return;
        var prefs = await db.Preferences.Where(p => partnerIds.Contains(p.PartnerId)).ToDictionaryAsync(p => p.PartnerId, ct);
        var details = await vapid.GetAsync(ct);
        var client = new WebPushClient(httpFactory.CreateClient("webpush"));
        var now = clock.GetUtcNow().UtcDateTime;
        var payload = JsonSerializer.Serialize(new
        {
            title = message.Title, body = message.Body, url = message.Url, tag = message.Tag,
            renotify = message.Urgent, requireInteraction = message.Urgent,
        }, Json);

        foreach (var s in subs)
        {
            if (!message.Urgent && prefs.TryGetValue(s.PartnerId, out var p) && InQuietHours(p, now)) continue;
            try
            {
                await client.SendNotificationAsync(new WebPush.PushSubscription(s.Endpoint, s.P256dh, s.Auth), payload,
                    PushOptionsFor(details, message), ct);
                s.LastSuccessAt = now;
                s.Failures = 0;
            }
            catch (WebPushException ex) when (ex.StatusCode is HttpStatusCode.Gone or HttpStatusCode.NotFound)
            {
                db.PushSubscriptions.Remove(s);
            }
            catch (Exception ex)
            {
                s.Failures++;
                if (s.Failures >= 10) db.PushSubscriptions.Remove(s);
                log.LogWarning(ex, "Push to a device of partner {Partner} failed ({Failures})", s.PartnerId, s.Failures);
            }
        }
        await db.SaveChangesAsync(ct);
    }

    private Dictionary<string, object> PushOptionsFor(VapidDetails details, PushMessage message)
    {
        var headers = new Dictionary<string, object> { ["Urgency"] = message.Urgent ? "high" : "normal" };
        if (TopicOf(message.Tag) is { } topic) headers["Topic"] = topic;
        return new Dictionary<string, object>
        {
            ["vapidDetails"] = details,
            ["TTL"] = options.Value.TtlSeconds,
            ["headers"] = headers,
        };
    }

    /// <summary>Web Push topics replace an undelivered message with the same topic (max 32 url-safe chars).</summary>
    private static string? TopicOf(string? tag)
    {
        if (string.IsNullOrEmpty(tag)) return null;
        var clean = new string(tag.Where(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_').ToArray());
        return clean.Length == 0 ? null : clean.Length <= 32 ? clean : clean[..32];
    }

    public static bool InQuietHours(UserPreference p, DateTime utcNow)
    {
        if (!p.QuietHoursEnabled) return false;
        TimeZoneInfo tz;
        try { tz = TimeZoneInfo.FindSystemTimeZoneById(p.TimeZone); } catch { tz = TimeZoneInfo.Utc; }
        var local = TimeZoneInfo.ConvertTimeFromUtc(utcNow, tz);
        var minute = local.Hour * 60 + local.Minute;
        return p.QuietFromMinute <= p.QuietToMinute
            ? minute >= p.QuietFromMinute && minute < p.QuietToMinute
            : minute >= p.QuietFromMinute || minute < p.QuietToMinute;
    }
}

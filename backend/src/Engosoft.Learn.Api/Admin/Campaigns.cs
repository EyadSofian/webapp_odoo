using System.Text.Json;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Notifications;
using Engosoft.Learn.Api.Odoo;
using Microsoft.EntityFrameworkCore;
using static Engosoft.Learn.Api.Odoo.OdooClientExtensions;

namespace Engosoft.Learn.Api.Admin;

/// <summary>Who a campaign goes to. Kind: all | live | recorded. Roles (live only): all | learners | team.</summary>
public sealed record CampaignAudience(string Kind, int[]? EventIds, int[]? ChannelIds, string? Roles);

public sealed record CampaignRequest(string Title, string Body, string? LinkUrl, string? LinkLabel, CampaignAudience Audience, DateTime? ScheduledAt);

/// <summary>Resolves audiences and sends campaigns. Only people who use the app can receive them (inbox and push).</summary>
public sealed class CampaignService(AppDbContext db, IOdooClient odoo, NotificationService notifications, TimeProvider clock, ILogger<CampaignService> log)
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string? ValidLink(string? url)
    {
        var u = (url ?? "").Trim();
        if (u.Length == 0) return null;
        if (u.Length > 512) return "";
        if (u.StartsWith('/') && !u.StartsWith("//")) return u;
        return Uri.TryCreate(u, UriKind.Absolute, out var abs) && abs.Scheme == Uri.UriSchemeHttps ? abs.ToString() : "";
    }

    public async Task<(List<int> People, string Summary)> ResolveAsync(CampaignAudience a, CancellationToken ct)
    {
        var now = Now;
        switch (a.Kind)
        {
            case "live":
            {
                var ids = (a.EventIds ?? []).Distinct().Take(50).ToArray();
                if (ids.Length == 0) return ([], "");
                var rooms = await db.Rooms.AsNoTracking().Where(r => r.Kind == RoomKind.Course && ids.Contains(r.OdooEventId))
                    .Select(r => new { r.Id, r.Title }).ToListAsync(ct);
                var roomIds = rooms.Select(r => r.Id).ToList();
                var members = db.Members.AsNoTracking().Where(m => roomIds.Contains(m.RoomId) && m.RemovedAt == null && m.Role != MemberRole.Admin);
                if (a.Roles == "learners") members = members.Where(m => m.Role == MemberRole.Student);
                else if (a.Roles == "team") members = members.Where(m => m.Role != MemberRole.Student);
                var people = await members.Select(m => m.PartnerId).Distinct().ToListAsync(ct);
                var who = a.Roles == "learners" ? "متدربو" : a.Roles == "team" ? "فريق" : "أعضاء";
                return (people, Trim($"{who}: {string.Join("، ", rooms.Select(r => r.Title))}"));
            }
            case "recorded":
            {
                var ids = (a.ChannelIds ?? []).Distinct().Take(50).ToArray();
                if (ids.Length == 0) return ([], "");
                var appUsers = await db.RefreshTokens.AsNoTracking().Where(t => t.ExpiresAt > now).Select(t => t.PartnerId).Distinct().ToArrayAsync(ct);
                if (appUsers.Length == 0) return ([], "");
                var rows = await odoo.SearchReadAsync("slide.channel.partner",
                    D(("channel_id", "in", ids), ("partner_id", "in", appUsers)), ["partner_id"], ct: ct);
                var people = rows.Select(r => r.M2O("partner_id")?.Id ?? 0).Where(p => p > 0).Distinct().ToList();
                var names = await odoo.ReadAsync("slide.channel", ids, ["name"], ct);
                return (people, Trim($"متدربو الدورات المسجّلة: {string.Join("، ", names.Select(n => n.Str("name")))}"));
            }
            default:
            {
                var people = await db.RefreshTokens.AsNoTracking().Where(t => t.ExpiresAt > now).Select(t => t.PartnerId).Distinct().ToListAsync(ct);
                return (people, "كل مستخدمي التطبيق");
            }
        }
    }

    private static string Trim(string s) => s.Length <= 400 ? s : s[..397] + "…";

    /// <summary>Sends one campaign once. The status flip is atomic, so the scheduler and a "send now" never both send it.</summary>
    public async Task SendAsync(Guid id, CancellationToken ct)
    {
        var claimed = await db.Campaigns.Where(c => c.Id == id && c.Status == CampaignStatus.Scheduled)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.Status, CampaignStatus.Sending), ct);
        if (claimed == 0) return;
        var c = await db.Campaigns.SingleAsync(x => x.Id == id, ct);
        try
        {
            var audience = JsonSerializer.Deserialize<CampaignAudience>(c.AudienceJson, Json) ?? new CampaignAudience("all", null, null, null);
            var (people, _) = await ResolveAsync(audience, ct);
            people.Remove(c.CreatedByPartnerId);
            if (people.Count > 0)
                await notifications.NotifyAsync(people, "announcement", c.Title, c.Body, $"/go/{c.Id}", urgent: false, tag: $"campaign-{c.Id:N}", ct: ct);
            c.Recipients = people.Count;
            c.Status = CampaignStatus.Sent;
            c.SentAt = Now;
            db.Audit.Add(new ChatAudit { RoomId = Guid.Empty, ActorPartnerId = c.CreatedByPartnerId, Action = "campaign_sent", Details = Trim($"{people.Count} · {c.Title}"), At = Now });
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Campaign {Id} failed", id);
            c.Status = CampaignStatus.Failed;
            c.Error = Trim(ex.Message);
            await db.SaveChangesAsync(CancellationToken.None);
        }
    }
}

/// <summary>Sends scheduled campaigns when their time comes.</summary>
public sealed class CampaignWorker(IServiceScopeFactory scopes, TimeProvider clock, ILogger<CampaignWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var now = clock.GetUtcNow().UtcDateTime;
                var due = await db.Campaigns.Where(c => c.Status == CampaignStatus.Scheduled && c.ScheduledAt <= now).Select(c => c.Id).Take(10).ToListAsync(stoppingToken);
                var sender = scope.ServiceProvider.GetRequiredService<CampaignService>();
                foreach (var id in due) await sender.SendAsync(id, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { log.LogError(ex, "Campaign scheduler run failed"); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

public static class CampaignEndpoints
{
    public static IServiceCollection AddCampaigns(this IServiceCollection services)
    {
        services.AddScoped<CampaignService>();
        services.AddHostedService<CampaignWorker>();
        return services;
    }

    /// <summary>Admin endpoints go on the admin group (already admin-only); the open endpoint is for any signed-in recipient.</summary>
    public static void MapCampaignEndpoints(this RouteGroupBuilder admin, WebApplication app)
    {
        admin.MapGet("/campaigns", async (AppDbContext db, CancellationToken ct) =>
        {
            var rows = await db.Campaigns.AsNoTracking().OrderByDescending(c => c.CreatedAt).Take(100)
                .Select(c => new
                {
                    c.Id, c.Title, c.Body, c.LinkUrl, c.LinkLabel, c.AudienceSummary, c.Status, c.ScheduledAt, c.SentAt, c.Recipients, c.CreatedByName, c.CreatedAt, c.Error,
                    Clicks = db.CampaignClicks.Count(k => k.CampaignId == c.Id),
                })
                .ToListAsync(ct);
            return Results.Ok(rows.Select(c => new
            {
                c.Id, c.Title, c.Body, c.LinkUrl, c.LinkLabel, c.AudienceSummary, status = c.Status.ToString().ToLowerInvariant(),
                scheduledAt = DateTime.SpecifyKind(c.ScheduledAt, DateTimeKind.Utc),
                sentAt = c.SentAt is { } s ? DateTime.SpecifyKind(s, DateTimeKind.Utc) : (DateTime?)null,
                c.Recipients, c.Clicks, c.CreatedByName, c.Error,
            }));
        });

        admin.MapPost("/campaigns/preview", async (CampaignAudience body, CampaignService svc, CurrentUser me, CancellationToken ct) =>
        {
            var (people, summary) = await svc.ResolveAsync(body, ct);
            people.Remove(me.PartnerId);
            return Results.Ok(new { count = people.Count, summary });
        });

        admin.MapPost("/campaigns", async (CampaignRequest body, AppDbContext db, CampaignService svc, BackgroundJobQueue jobs, CurrentUser me, TimeProvider clock, CancellationToken ct) =>
        {
            var title = (body.Title ?? "").Trim();
            var text = (body.Body ?? "").Trim();
            if (title.Length is < 3 or > 120) return Error.Validation("bad_title", "اكتب عنوانًا من 3 إلى 120 حرفًا.").ToProblem();
            if (text.Length is < 3 or > 500) return Error.Validation("bad_body", "اكتب نص الحملة (من 3 إلى 500 حرف).").ToProblem();
            var link = CampaignService.ValidLink(body.LinkUrl);
            if (link == "") return Error.Validation("bad_link", "الرابط يجب أن يكون صفحة داخل التطبيق أو رابطًا يبدأ بـ https.").ToProblem();
            if (body.Audience is null || body.Audience.Kind is not ("all" or "live" or "recorded")) return Error.Validation("bad_audience", "اختر المستلمين.").ToProblem();

            var now = clock.GetUtcNow().UtcDateTime;
            var when = body.ScheduledAt is { } at ? DateTime.SpecifyKind(at, DateTimeKind.Utc) : now;
            if (when > now.AddDays(90)) return Error.Validation("too_far", "يمكن جدولة الحملة خلال 90 يومًا كحد أقصى.").ToProblem();
            if (when < now) when = now;

            var (people, summary) = await svc.ResolveAsync(body.Audience, ct);
            people.Remove(me.PartnerId);
            if (people.Count == 0 && when <= now.AddSeconds(30)) return Error.Blocked("no_audience", "لا يوجد مستلمون لهذه الحملة الآن.").ToProblem();

            var c = new Campaign
            {
                Title = title, Body = text, LinkUrl = link, LinkLabel = string.IsNullOrWhiteSpace(body.LinkLabel) ? null : body.LinkLabel.Trim()[..Math.Min(40, body.LinkLabel.Trim().Length)],
                AudienceJson = JsonSerializer.Serialize(body.Audience), AudienceSummary = summary, Status = CampaignStatus.Scheduled, ScheduledAt = when,
                CreatedByPartnerId = me.PartnerId, CreatedByName = me.Name, CreatedAt = now,
            };
            db.Campaigns.Add(c);
            await db.SaveChangesAsync(ct);
            if (when <= now.AddSeconds(30))
                jobs.Enqueue($"campaign:{c.Id}", (sp, jct) => sp.GetRequiredService<CampaignService>().SendAsync(c.Id, jct));
            return Results.Ok(new { c.Id, recipients = people.Count, scheduled = when > now.AddSeconds(30) });
        });

        admin.MapPost("/campaigns/{id:guid}/cancel", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var n = await db.Campaigns.Where(c => c.Id == id && c.Status == CampaignStatus.Scheduled)
                .ExecuteUpdateAsync(s => s.SetProperty(c => c.Status, CampaignStatus.Cancelled), ct);
            return n == 0 ? Error.Conflict("not_scheduled", "لا يمكن إلغاء هذه الحملة، فقد أُرسلت أو أُلغيت.").ToProblem() : Results.NoContent();
        });

        // Recorded courses to target, searched in Odoo.
        admin.MapGet("/recorded-courses", async (string? q, IOdooClient odoo, CancellationToken ct) =>
        {
            var term = (q ?? "").Trim();
            object[] domain = term.Length >= 2 ? D(("name", "ilike", term)) : [];
            var rows = await odoo.SearchReadAsync("slide.channel", domain, ["name", "members_count"], order: "members_count desc", limit: 20, ct: ct);
            return Results.Ok(rows.Select(r => new { channelId = r.Id(), name = r.Str("name"), members = r.Int("members_count") ?? 0 }));
        });

        // A recipient tapped the campaign: count it once and tell the app where to go.
        app.MapPost("/api/campaigns/{id:guid}/open", async (Guid id, AppDbContext db, CurrentUser me, TimeProvider clock, CancellationToken ct) =>
        {
            var url = $"/go/{id}";
            var recipient = await db.Notifications.AnyAsync(n => n.PartnerId == me.PartnerId && n.Url == url, ct);
            var c = await db.Campaigns.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
            if (c is null || !recipient) return Results.Ok(new { url = "/notifications" });
            if (!await db.CampaignClicks.AnyAsync(k => k.CampaignId == id && k.PartnerId == me.PartnerId, ct))
            {
                db.CampaignClicks.Add(new CampaignClick { CampaignId = id, PartnerId = me.PartnerId, At = clock.GetUtcNow().UtcDateTime });
                try { await db.SaveChangesAsync(ct); } catch (DbUpdateException) { /* tapped twice at once */ }
            }
            return Results.Ok(new { url = c.LinkUrl ?? "/notifications" });
        }).RequireAuthorization().RequireRateLimiting("api").WithTags("Campaigns");
    }
}

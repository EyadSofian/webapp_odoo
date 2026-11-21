using System.Text.Json;
using Engosoft.Learn.Api.Auth;
using Engosoft.Learn.Api.Chat;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Notifications;
using Engosoft.Learn.Api.Odoo;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using static Engosoft.Learn.Api.Odoo.OdooClientExtensions;

namespace Engosoft.Learn.Api.Admin;

/// <summary>
/// Who runs the app. Admins come from two places: Auth:AdminPartnerIds in the server configuration (fixed, cannot be
/// removed from the app) and admins added from the admin page (stored in the settings table).
/// </summary>
public sealed class AdminDirectory(AppDbContext db, IOptions<AuthOptions> auth, IMemoryCache cache)
{
    public const string SettingKey = "admin_partner_ids";
    private const string CacheKey = "admin-partner-ids";

    public int[] Fixed => auth.Value.AdminPartnerIds;

    public async Task<HashSet<int>> AddedAsync(CancellationToken ct) =>
        (await cache.GetOrCreateAsync(CacheKey, async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);
            var row = await db.Settings.AsNoTracking().SingleOrDefaultAsync(s => s.Key == SettingKey, ct);
            return Parse(row?.Value);
        }))!;

    public async Task<bool> IsAdminAsync(int partnerId, CancellationToken ct) =>
        Fixed.Contains(partnerId) || (await AddedAsync(ct)).Contains(partnerId);

    public async Task SaveAsync(HashSet<int> added, CancellationToken ct)
    {
        var row = await db.Settings.SingleOrDefaultAsync(s => s.Key == SettingKey, ct);
        if (row is null) db.Settings.Add(row = new AppSetting { Key = SettingKey });
        row.Value = string.Join(',', added.OrderBy(x => x));
        await db.SaveChangesAsync(ct);
        cache.Remove(CacheKey);
    }

    private static HashSet<int> Parse(string? value) =>
        (value ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(v => int.TryParse(v, out var i) ? i : 0).Where(i => i > 0).ToHashSet();
}

/// <summary>Chat rules an admin can change from the app. Stored in the settings table and applied to the live options.</summary>
public sealed record ChatSettingsDto(bool StudentsCanUpload, int MaxAttachmentMb, int ReadOnlyAfterDays, int BurstMessages);

public static class ChatSettingsStore
{
    private const string Key = "chat_settings";

    public static async Task ApplySavedAsync(AppDbContext db, ChatOptions live, CancellationToken ct)
    {
        var row = await db.Settings.AsNoTracking().SingleOrDefaultAsync(s => s.Key == Key, ct);
        if (row is null) return;
        try
        {
            var s = JsonSerializer.Deserialize<ChatSettingsDto>(row.Value);
            if (s is not null) Apply(live, s);
        }
        catch (JsonException) { /* keep the configured values */ }
    }

    public static ChatSettingsDto Read(ChatOptions o) => new(o.StudentsCanUpload, o.MaxAttachmentMb, o.ReadOnlyAfterDays, o.BurstMessages);

    public static async Task SaveAsync(AppDbContext db, ChatOptions live, ChatSettingsDto s, CancellationToken ct)
    {
        Apply(live, s);
        var row = await db.Settings.SingleOrDefaultAsync(x => x.Key == Key, ct);
        if (row is null) db.Settings.Add(row = new AppSetting { Key = Key });
        row.Value = JsonSerializer.Serialize(Read(live));
        await db.SaveChangesAsync(ct);
    }

    // IOptions<ChatOptions> hands every service the same instance, so changing it takes effect at once.
    private static void Apply(ChatOptions o, ChatSettingsDto s)
    {
        o.StudentsCanUpload = s.StudentsCanUpload;
        o.MaxAttachmentMb = Math.Clamp(s.MaxAttachmentMb, 1, 25); // the server accepts request bodies up to 30 MB
        o.ReadOnlyAfterDays = Math.Clamp(s.ReadOnlyAfterDays, 0, 365);
        o.BurstMessages = Math.Clamp(s.BurstMessages, 3, 30);
    }
}

public sealed record AdminAddRequest(int PartnerId);
public sealed record ResolveReportRequest(string Action);

public static class AdminModule
{
    public static IServiceCollection AddAdminModule(this IServiceCollection services)
    {
        services.AddScoped<AdminDirectory>();
        services.AddCampaigns();
        return services;
    }

    public static void MapAdminEndpoints(this WebApplication app)
    {
        var g = app.MapGroup("/api/admin").WithTags("Admin").RequireAuthorization().RequireRateLimiting("api")
            // Checked on every request against the live admin list, not only the role in the token.
            .AddEndpointFilter(async (ctx, next) =>
            {
                var http = ctx.HttpContext;
                var user = CurrentUser.From(http.User);
                var dir = http.RequestServices.GetRequiredService<AdminDirectory>();
                if (user is null || !await dir.IsAdminAsync(user.PartnerId, http.RequestAborted))
                    return Error.Forbidden("admin_only", "هذه الصفحة متاحة لإدارة التطبيق فقط.").ToProblem();
                return await next(ctx);
            });

        // ---------------------------------------------------------------- overview

        g.MapGet("/overview", async (AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            var now = clock.GetUtcNow().UtcDateTime;
            var tokens = db.RefreshTokens.AsNoTracking();
            var users = await tokens.Select(t => t.PartnerId).Distinct().CountAsync(ct);
            var active7 = await tokens.Where(t => t.CreatedAt > now.AddDays(-7)).Select(t => t.PartnerId).Distinct().CountAsync(ct);
            var rooms = await db.Rooms.CountAsync(r => r.Kind == RoomKind.Course && r.Status != RoomStatus.Archived, ct);
            var openReports = await db.Reports.CountAsync(r => r.ResolvedAt == null, ct);
            var pushDevices = await db.PushSubscriptions.CountAsync(ct);
            return Results.Ok(new { users, active7, rooms, openReports, pushDevices });
        });

        // ---------------------------------------------------------------- users and admins

        g.MapGet("/users", async (string? q, AppDbContext db, AdminDirectory dir, TimeProvider clock, CancellationToken ct) =>
        {
            var now = clock.GetUtcNow().UtcDateTime;
            var rows = await db.RefreshTokens.AsNoTracking()
                .GroupBy(t => t.PartnerId)
                .Select(x => new
                {
                    PartnerId = x.Key,
                    Name = x.OrderByDescending(t => t.CreatedAt).Select(t => t.Name).First(),
                    Kind = x.OrderByDescending(t => t.CreatedAt).Select(t => t.Kind).First(),
                    FirstSeen = x.Min(t => t.CreatedAt),
                    LastSeen = x.Max(t => t.CreatedAt),
                    Sessions = x.Count(t => t.RevokedAt == null && t.ExpiresAt > now),
                })
                .OrderByDescending(x => x.LastSeen).Take(1000).ToListAsync(ct);
            var term = (q ?? "").Trim();
            if (term.Length > 0) rows = rows.Where(r => r.Name.Contains(term, StringComparison.OrdinalIgnoreCase)).ToList();
            var devices = await db.PushSubscriptions.AsNoTracking().GroupBy(p => p.PartnerId).Select(x => new { x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
            var admins = (await dir.AddedAsync(ct)).Concat(dir.Fixed).ToHashSet();
            return Results.Ok(rows.Take(300).Select(r => new
            {
                r.PartnerId, r.Name,
                kind = admins.Contains(r.PartnerId) ? "admin" : r.Kind.ToLowerInvariant(),
                firstSeen = DateTime.SpecifyKind(r.FirstSeen, DateTimeKind.Utc),
                lastSeen = DateTime.SpecifyKind(r.LastSeen, DateTimeKind.Utc),
                r.Sessions,
                pushDevices = devices.GetValueOrDefault(r.PartnerId),
            }));
        });

        g.MapGet("/admins", async (AdminDirectory dir, IOdooClient odoo, CancellationToken ct) =>
        {
            var added = await dir.AddedAsync(ct);
            var ids = dir.Fixed.Concat(added).Distinct().ToArray();
            var names = ids.Length == 0 ? [] : (await odoo.ReadAsync("res.partner", ids, ["name", "email"], ct)).ToDictionary(p => p.Id());
            return Results.Ok(ids.Select(id => new
            {
                partnerId = id,
                name = names.TryGetValue(id, out var p) ? p.Str("name") : $"#{id}",
                email = names.TryGetValue(id, out var p2) ? p2.Str("email") : null,
                locked = dir.Fixed.Contains(id),
            }));
        });

        // Internal Odoo users who could be made admins.
        g.MapGet("/staff-search", async (string? q, IOdooClient odoo, CancellationToken ct) =>
        {
            var term = (q ?? "").Trim();
            if (term.Length < 2) return Results.Ok(Array.Empty<object>());
            object[] domain = [new object[] { "share", "=", false }, "|", new object[] { "name", "ilike", term }, new object[] { "login", "ilike", term }];
            var users = await odoo.SearchReadAsync("res.users", domain, ["name", "login", "partner_id"], limit: 10, ct: ct);
            return Results.Ok(users.Where(u => u.M2O("partner_id") is not null)
                .Select(u => new { partnerId = u.M2O("partner_id")!.Value.Id, name = u.Str("name"), login = u.Str("login") }));
        });

        g.MapPost("/admins", async (AdminAddRequest body, AdminDirectory dir, IOdooClient odoo, AppDbContext db, CurrentUser me, TimeProvider clock, CancellationToken ct) =>
        {
            var users = await odoo.SearchReadAsync("res.users", D(("partner_id", "=", body.PartnerId), ("share", "=", false)), ["id"], limit: 1, ct: ct);
            if (users.Count == 0) return Error.Validation("not_internal", "يمكن إضافة موظفي إنجوسوفت فقط (مستخدمين داخليين في Odoo).").ToProblem();
            var added = await dir.AddedAsync(ct);
            if (!added.Add(body.PartnerId) && !dir.Fixed.Contains(body.PartnerId)) return Results.NoContent();
            await dir.SaveAsync(added, ct);
            db.Audit.Add(new ChatAudit { RoomId = Guid.Empty, ActorPartnerId = me.PartnerId, Action = "admin_added", TargetPartnerId = body.PartnerId, At = clock.GetUtcNow().UtcDateTime });
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        g.MapDelete("/admins/{partnerId:int}", async (int partnerId, AdminDirectory dir, AppDbContext db, CurrentUser me, TimeProvider clock, CancellationToken ct) =>
        {
            if (dir.Fixed.Contains(partnerId)) return Error.Blocked("locked_admin", "هذا المسؤول مضاف من إعدادات الخادم، ولا يمكن إزالته من هنا.").ToProblem();
            if (partnerId == me.PartnerId) return Error.Blocked("self", "لا يمكنك إزالة نفسك من الإدارة.").ToProblem();
            var added = await dir.AddedAsync(ct);
            if (!added.Remove(partnerId)) return Results.NoContent();
            await dir.SaveAsync(added, ct);
            db.Audit.Add(new ChatAudit { RoomId = Guid.Empty, ActorPartnerId = me.PartnerId, Action = "admin_removed", TargetPartnerId = partnerId, At = clock.GetUtcNow().UtcDateTime });
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // ---------------------------------------------------------------- groups

        g.MapGet("/rooms", async (AppDbContext db, CurrentUser me, CancellationToken ct) =>
        {
            var rows = await db.Rooms.AsNoTracking().Where(r => r.Kind == RoomKind.Course)
                .Select(r => new
                {
                    r.Id, r.Title, r.Code, r.OdooEventId, r.Status, r.LastMessageAt, r.AnnouncementOnly,
                    Members = r.Members.Count(m => m.RemovedAt == null),
                    Messages = db.Messages.Count(m => m.RoomId == r.Id && m.DeletedAt == null),
                    OpenReports = db.Reports.Count(x => x.RoomId == r.Id && x.ResolvedAt == null),
                    Joined = r.Members.Any(m => m.PartnerId == me.PartnerId && m.RemovedAt == null),
                })
                .OrderByDescending(r => r.OpenReports).ThenByDescending(r => r.LastMessageAt).Take(500).ToListAsync(ct);
            return Results.Ok(rows.Select(r => new
            {
                r.Id, r.Title, r.Code, eventId = r.OdooEventId, status = r.Status.ToString().ToLowerInvariant(), r.AnnouncementOnly,
                lastMessageAt = r.LastMessageAt is { } d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : (DateTime?)null,
                r.Members, r.Messages, r.OpenReports, r.Joined,
            }));
        });

        // Enter a group as a moderator. The member sync leaves admin members alone.
        g.MapPost("/rooms/{roomId:guid}/join", async (Guid roomId, AppDbContext db, CurrentUser me, TimeProvider clock, CancellationToken ct) =>
        {
            var room = await db.Rooms.Include(r => r.Members).SingleOrDefaultAsync(r => r.Id == roomId, ct);
            if (room is null) return Error.NotFound("room_not_found", "هذه المجموعة غير موجودة.").ToProblem();
            var now = clock.GetUtcNow().UtcDateTime;
            var m = room.Members.SingleOrDefault(x => x.PartnerId == me.PartnerId);
            if (m is null) room.Members.Add(new RoomMember { RoomId = room.Id, PartnerId = me.PartnerId, DisplayName = me.Name, Role = MemberRole.Admin, JoinedAt = now, Notify = NotifyLevel.Important });
            else
            {
                if (!m.IsStaff) m.Role = MemberRole.Admin;
                m.RemovedAt = null; m.RemovedReason = null;
            }
            db.Audit.Add(new ChatAudit { RoomId = room.Id, ActorPartnerId = me.PartnerId, Action = "admin_joined", At = now });
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { roomId = room.Id });
        });

        // ---------------------------------------------------------------- reports and audit

        g.MapGet("/reports", async (bool? all, AppDbContext db, CancellationToken ct) =>
        {
            var q = db.Reports.AsNoTracking().AsQueryable();
            if (all != true) q = q.Where(r => r.ResolvedAt == null);
            var rows = await q.OrderByDescending(r => r.At).Take(200)
                .Select(r => new
                {
                    r.Id, r.RoomId, r.MessageId, r.Reason, r.At, r.ResolvedAt,
                    Room = db.Rooms.Where(x => x.Id == r.RoomId).Select(x => x.Title).FirstOrDefault(),
                    Message = db.Messages.Where(x => x.Id == r.MessageId).Select(x => new { x.Body, x.SenderName, x.SenderPartnerId, x.DeletedAt, x.CreatedAt }).FirstOrDefault(),
                    Reporter = db.Members.Where(x => x.RoomId == r.RoomId && x.PartnerId == r.ReporterPartnerId).Select(x => x.DisplayName).FirstOrDefault(),
                })
                .ToListAsync(ct);
            return Results.Ok(rows.Select(r => new
            {
                r.Id, r.RoomId, r.MessageId, r.Reason, roomTitle = r.Room, reporter = r.Reporter,
                at = DateTime.SpecifyKind(r.At, DateTimeKind.Utc),
                resolvedAt = r.ResolvedAt is { } d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : (DateTime?)null,
                message = r.Message is null ? null : new
                {
                    body = r.Message.DeletedAt is null ? r.Message.Body : "",
                    deleted = r.Message.DeletedAt is not null,
                    sender = r.Message.SenderName,
                    at = DateTime.SpecifyKind(r.Message.CreatedAt, DateTimeKind.Utc),
                },
            }));
        });

        g.MapPost("/reports/{id:guid}/resolve", async (Guid id, ResolveReportRequest body, AppDbContext db, ChatService chat, CurrentUser me, TimeProvider clock, CancellationToken ct) =>
        {
            var report = await db.Reports.SingleOrDefaultAsync(r => r.Id == id, ct);
            if (report is null) return Error.NotFound("report_not_found", "هذا البلاغ غير موجود.").ToProblem();
            if (body.Action is not ("delete" or "dismiss")) return Error.Validation("bad_action", "إجراء غير صحيح.").ToProblem();
            var now = clock.GetUtcNow().UtcDateTime;
            if (body.Action == "delete") await chat.AdminDeleteAsync(me.PartnerId, report.MessageId, ct);
            // One decision closes every report on the same message.
            await db.Reports.Where(r => r.MessageId == report.MessageId && r.ResolvedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.ResolvedAt, now), ct);
            db.Audit.Add(new ChatAudit { RoomId = report.RoomId, ActorPartnerId = me.PartnerId, Action = body.Action == "delete" ? "report_message_deleted" : "report_dismissed", Details = $"message {report.MessageId}", At = now });
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        g.MapGet("/audit", async (AppDbContext db, CancellationToken ct) =>
        {
            var rows = await db.Audit.AsNoTracking().OrderByDescending(a => a.Id).Take(150)
                .Select(a => new
                {
                    a.Id, a.Action, a.Details, a.At, a.RoomId,
                    Room = db.Rooms.Where(r => r.Id == a.RoomId).Select(r => r.Title).FirstOrDefault(),
                    Actor = a.ActorPartnerId == null ? null : db.Members.Where(m => m.PartnerId == a.ActorPartnerId).Select(m => m.DisplayName).FirstOrDefault()
                            ?? db.RefreshTokens.Where(t => t.PartnerId == a.ActorPartnerId).Select(t => t.Name).FirstOrDefault(),
                    Target = a.TargetPartnerId == null ? null : db.Members.Where(m => m.PartnerId == a.TargetPartnerId).Select(m => m.DisplayName).FirstOrDefault()
                             ?? db.RefreshTokens.Where(t => t.PartnerId == a.TargetPartnerId).Select(t => t.Name).FirstOrDefault(),
                })
                .ToListAsync(ct);
            return Results.Ok(rows.Select(a => new { a.Id, a.Action, a.Details, at = DateTime.SpecifyKind(a.At, DateTimeKind.Utc), room = a.Room, actor = a.Actor, target = a.Target }));
        });

        // ---------------------------------------------------------------- settings

        g.MapGet("/settings", (IOptions<ChatOptions> chat) => Results.Ok(ChatSettingsStore.Read(chat.Value)));

        g.MapPut("/settings", async (ChatSettingsDto body, IOptions<ChatOptions> chat, AppDbContext db, CurrentUser me, TimeProvider clock, CancellationToken ct) =>
        {
            await ChatSettingsStore.SaveAsync(db, chat.Value, body, ct);
            db.Audit.Add(new ChatAudit { RoomId = Guid.Empty, ActorPartnerId = me.PartnerId, Action = "settings_changed", Details = JsonSerializer.Serialize(ChatSettingsStore.Read(chat.Value)), At = clock.GetUtcNow().UtcDateTime });
            await db.SaveChangesAsync(ct);
            return Results.Ok(ChatSettingsStore.Read(chat.Value));
        });

        // ---------------------------------------------------------------- campaigns

        g.MapCampaignEndpoints(app);
    }
}

using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Learning;
using Engosoft.Learn.Api.Odoo;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using static Engosoft.Learn.Api.Odoo.OdooClientExtensions;

namespace Engosoft.Learn.Api.Chat;

/// <summary>
/// Keeps each course group's members equal to who Odoo says is in the course:
/// learners with a valid seat, plus the instructor and coordinators. Changes are written to the audit log.
/// </summary>
public sealed class MembershipSync(
    AppDbContext db,
    IOdooClient odoo,
    KeyedLocks locks,
    TimeProvider clock,
    IOptions<ChatOptions> options,
    IHubContext<ChatHub> hub,
    ConnectionRegistry connections,
    IServiceScopeFactory scopes,
    BackgroundJobQueue jobs,
    ILogger<MembershipSync> log)
{
    private static bool _coordinatorsUnreadable;
    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    /// <summary>
    /// Makes sure the caller's groups exist before listing them. Groups are created for courses that are running,
    /// upcoming or ended recently; long-finished courses get none. Missing groups are created now (in parallel),
    /// stale ones are refreshed in the background.
    /// </summary>
    public async Task SyncForUserAsync(CurrentUser user, LearningService learning, CancellationToken ct)
    {
        if (!options.Value.Enabled) return;
        var cutoff = Now.AddDays(-(options.Value.ReadOnlyAfterDays + 30));
        var courses = await learning.GetLiveCoursesAsync(user, ct);
        var ids = courses.Where(c => !c.Expired && (c.End is null || c.End >= cutoff)).Select(c => c.EventId).ToArray();
        if (ids.Length == 0) return;

        var rooms = await db.Rooms.Where(r => r.Kind == RoomKind.Course && ids.Contains(r.OdooEventId))
            .Select(r => new { r.OdooEventId, r.LastSyncedAt }).ToListAsync(ct);
        var threshold = Now.AddMinutes(-options.Value.ResyncAfterMinutes);
        var missing = ids.Except(rooms.Select(r => r.OdooEventId)).ToArray();
        var stale = rooms.Where(r => r.LastSyncedAt is null || r.LastSyncedAt < threshold).Select(r => r.OdooEventId).ToArray();

        if (missing.Length > 0) await SyncManyAsync(scopes, missing, 6, ct);
        if (stale.Length > 0) jobs.Enqueue("chat-resync", (sp, token) => SyncManyAsync(sp.GetRequiredService<IServiceScopeFactory>(), stale, 4, token));
    }

    public static Task SyncManyAsync(IServiceScopeFactory scopes, IEnumerable<int> eventIds, int parallel, CancellationToken ct) =>
        Parallel.ForEachAsync(eventIds, new ParallelOptions { MaxDegreeOfParallelism = parallel, CancellationToken = ct }, async (id, token) =>
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<MembershipSync>().SyncEventAsync(id, token);
        });

    public async Task SyncEventAsync(int eventId, CancellationToken ct)
    {
        using var _ = await locks.AcquireAsync($"event:{eventId}", ct);
        var now = Now;
        var evs = await odoo.ReadAsync("event.event", [eventId],
            ["name", "code", "date_begin", "date_end", "instructor_id", "course_id", "coordinator_ids"], ct);
        var room = await db.Rooms.Include(r => r.Members)
            .SingleOrDefaultAsync(r => r.Kind == RoomKind.Course && r.OdooEventId == eventId, ct);

        if (evs.Count == 0)
        {
            if (room is not null && room.Status != RoomStatus.Archived)
            {
                room.Status = RoomStatus.Archived;
                Audit(room.Id, null, "room_archived", null, "event no longer exists in Odoo");
                await db.SaveChangesAsync(ct);
            }
            return;
        }

        var ev = evs[0];
        var desired = new Dictionary<int, (string Name, MemberRole Role)>();

        var regs = await odoo.SearchReadAsync("event.registration",
            D(("event_id", "=", eventId), ("state", "in", new[] { "open", "done" })), ["partner_id", "state", "access_expiration_date"], ct: ct);
        foreach (var r in regs)
        {
            if (r.M2O("partner_id") is not { } p) continue;
            if (ChatPolicy.IsEligibleStudent(r.Str("state"), r.Utc("access_expiration_date"), now))
                desired[p.Id] = (p.Name, MemberRole.Student);
        }

        foreach (var (partnerId, name, role) in await StaffAsync(ev, ct))
            desired[partnerId] = (name, role); // staff wins over a seat the instructor may also hold

        room ??= NewRoom(eventId, now);
        room.Title = LearningService.CleanTitle(ev.Str("name") ?? "");
        room.Code = ev.Str("code");
        room.CourseChannelId = ev.M2O("course_id")?.Id;
        room.EventStart = ev.Utc("date_begin");
        room.EventEnd = ev.Utc("date_end");
        if (room.Status != RoomStatus.Archived)
            room.Status = ChatPolicy.StatusFor(room.EventEnd, now, options.Value.ReadOnlyAfterDays);
        room.LastSyncedAt = now;

        var removed = ApplyMembers(room, desired, now);

        // Private question rooms follow the course team; the learner who asked stays only while their seat is valid.
        var staff = desired.Where(d => d.Value.Role != MemberRole.Student).ToDictionary(d => d.Key, d => d.Value);
        var questions = await db.Rooms.Include(r => r.Members)
            .Where(r => r.Kind == RoomKind.Question && r.OdooEventId == eventId).ToListAsync(ct);
        foreach (var q in questions)
        {
            var want = new Dictionary<int, (string, MemberRole)>(staff);
            if (q.OwnerPartnerId is { } owner && desired.TryGetValue(owner, out var o) && o.Role == MemberRole.Student)
                want[owner] = o;
            q.Title = room.Title;
            q.Status = room.Status;
            removed.AddRange(ApplyMembers(q, want, now));
        }

        await db.SaveChangesAsync(ct);

        foreach (var (roomId, partnerId) in removed)
        {
            foreach (var conn in connections.Get(partnerId))
                await hub.Groups.RemoveFromGroupAsync(conn, ChatHub.RoomGroup(roomId), ct);
            await hub.Clients.Group(ChatHub.UserGroup(partnerId)).SendAsync("roomRemoved", new { roomId }, ct);
        }
    }

    private ChatRoom NewRoom(int eventId, DateTime now)
    {
        var room = new ChatRoom { Kind = RoomKind.Course, OdooEventId = eventId, CreatedAt = now, Status = RoomStatus.Open };
        db.Rooms.Add(room);
        Audit(room.Id, null, "room_created", null, $"event {eventId}");
        return room;
    }

    private List<(Guid RoomId, int PartnerId)> ApplyMembers(ChatRoom room, Dictionary<int, (string Name, MemberRole Role)> desired, DateTime now)
    {
        var removed = new List<(Guid, int)>();
        foreach (var m in room.Members)
        {
            if (desired.TryGetValue(m.PartnerId, out var want))
            {
                if (m.RemovedAt is not null)
                {
                    m.RemovedAt = null;
                    m.RemovedReason = null;
                    Audit(room.Id, null, "member_restored", m.PartnerId, null);
                }
                if (m.Role != want.Role)
                {
                    Audit(room.Id, null, "role_changed", m.PartnerId, $"{m.Role} -> {want.Role}");
                    m.Role = want.Role;
                }
                m.DisplayName = want.Name;
            }
            else if (m.RemovedAt is null && m.Role != MemberRole.Admin)
            {
                m.RemovedAt = now;
                m.RemovedReason = m.Role == MemberRole.Student ? "seat_ended" : "left_team";
                Audit(room.Id, null, "member_removed", m.PartnerId, m.RemovedReason);
                removed.Add((room.Id, m.PartnerId));
            }
        }

        var existing = room.Members.Select(m => m.PartnerId).ToHashSet();
        foreach (var (partnerId, (name, role)) in desired.Where(d => !existing.Contains(d.Key)))
        {
            room.Members.Add(new RoomMember
            {
                RoomId = room.Id, PartnerId = partnerId, DisplayName = name, Role = role, JoinedAt = now,
                Notify = role == MemberRole.Student ? NotifyLevel.Important : NotifyLevel.All,
            });
            Audit(room.Id, null, "member_added", partnerId, role.ToString());
        }
        return removed;
    }

    private async Task<List<(int PartnerId, string Name, MemberRole Role)>> StaffAsync(System.Text.Json.JsonElement ev, CancellationToken ct)
    {
        var staff = new List<(int, string, MemberRole)>();
        if (ev.M2O("instructor_id") is { } emp)
        {
            var e = await odoo.ReadAsync("hr.employee", [emp.Id], ["user_id", "name"], ct);
            if (e.FirstOrDefault().M2O("user_id") is { } user)
            {
                var u = await odoo.ReadAsync("res.users", [user.Id], ["partner_id"], ct);
                if (u.FirstOrDefault().M2O("partner_id") is { } p)
                    staff.Add((p.Id, emp.Name.Trim(), MemberRole.Instructor));
            }
            else
            {
                log.LogWarning("Instructor {Employee} of event {Event} has no Odoo user; they cannot join the group", emp.Name, ev.Id());
            }
        }

        var coordinatorIds = ev.Ids("coordinator_ids");
        if (coordinatorIds.Length > 0 && !_coordinatorsUnreadable)
        {
            try
            {
                var coords = await odoo.ReadAsync("hr.coordinator", coordinatorIds, ["user_id"], ct);
                var userIds = coords.Select(c => c.M2O("user_id")?.Id).OfType<int>().ToArray();
                foreach (var u in await odoo.ReadAsync("res.users", userIds, ["partner_id", "name"], ct))
                    if (u.M2O("partner_id") is { } p) staff.Add((p.Id, u.Str("name") ?? p.Name, MemberRole.Coordinator));
            }
            catch (OdooAccessException)
            {
                _coordinatorsUnreadable = true;
                log.LogWarning("The integration user cannot read hr.coordinator; coordinators are left out of course groups until it can");
            }
        }
        return staff;
    }

    private void Audit(Guid roomId, int? actor, string action, int? target, string? details) =>
        db.Audit.Add(new ChatAudit { RoomId = roomId, ActorPartnerId = actor, Action = action, TargetPartnerId = target, Details = details, At = Now });
}

/// <summary>Periodically re-syncs groups of courses that are running, about to start, or recently ended.</summary>
public sealed class MembershipSyncWorker(IServiceScopeFactory scopes, IOptions<ChatOptions> options, TimeProvider clock, ILogger<MembershipSyncWorker> log)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            if (options.Value.Enabled)
            {
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    var odoo = scope.ServiceProvider.GetRequiredService<IOdooClient>();
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    var now = clock.GetUtcNow().UtcDateTime;
                    var active = await odoo.SearchReadAsync("event.event",
                        D(("date_end", ">=", now.AddDays(-options.Value.ReadOnlyAfterDays - 1).ToOdoo()), ("date_begin", "<=", now.AddDays(7).ToOdoo())),
                        ["id"], ct: stoppingToken);
                    var ids = active.Select(e => e.Id()).ToHashSet();
                    // Also revisit groups that exist but fell out of the window, so they turn read-only.
                    var stale = await db.Rooms.Where(r => r.Kind == RoomKind.Course && r.Status == RoomStatus.Open)
                        .Select(r => r.OdooEventId).ToListAsync(stoppingToken);
                    ids.UnionWith(stale);
                    await MembershipSync.SyncManyAsync(scopes, ids, 4, stoppingToken);
                    log.LogInformation("Chat membership sync finished for {Count} courses", ids.Count);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception ex) { log.LogError(ex, "Chat membership sync failed"); }
            }
            await Task.Delay(TimeSpan.FromMinutes(Math.Max(1, options.Value.SyncIntervalMinutes)), stoppingToken);
        }
    }
}

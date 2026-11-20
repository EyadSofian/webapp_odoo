using System.Collections.Concurrent;
using System.Security.Cryptography;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Learning;
using Engosoft.Learn.Api.Notifications;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Engosoft.Learn.Api.Chat;

/// <summary>Tracks live SignalR connections per person, so a removed member can be dropped from a group at once.</summary>
public sealed class ConnectionRegistry
{
    private readonly ConcurrentDictionary<int, ConcurrentDictionary<string, byte>> _byPartner = new();

    public void Add(int partnerId, string connectionId) =>
        _byPartner.GetOrAdd(partnerId, _ => new()).TryAdd(connectionId, 0);

    public void Remove(int partnerId, string connectionId)
    {
        if (_byPartner.TryGetValue(partnerId, out var set)) set.TryRemove(connectionId, out _);
    }

    public IReadOnlyCollection<string> Get(int partnerId) =>
        _byPartner.TryGetValue(partnerId, out var set) ? set.Keys.ToList() : [];

    public bool IsOnline(int partnerId) => _byPartner.TryGetValue(partnerId, out var set) && !set.IsEmpty;
}

/// <summary>Per-person burst guard, on top of a room's slow mode.</summary>
public sealed class MessageRateGuard(IOptions<ChatOptions> options, TimeProvider clock)
{
    private readonly ConcurrentDictionary<int, Queue<DateTime>> _recent = new();

    public bool TryConsume(int partnerId)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var window = TimeSpan.FromSeconds(options.Value.BurstWindowSeconds);
        var q = _recent.GetOrAdd(partnerId, _ => new Queue<DateTime>());
        lock (q)
        {
            while (q.Count > 0 && now - q.Peek() > window) q.Dequeue();
            if (q.Count >= options.Value.BurstMessages) return false;
            q.Enqueue(now);
            return true;
        }
    }
}

public sealed class ChatService(
    AppDbContext db,
    IHubContext<ChatHub> hub,
    MembershipSync sync,
    LearningService learning,
    NotificationService notifications,
    MessageRateGuard rateGuard,
    IOptions<ChatOptions> options,
    IWebHostEnvironment env,
    TimeProvider clock)
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    private Task<RoomMember?> MemberAsync(Guid roomId, int partnerId, CancellationToken ct) =>
        db.Members.Include(m => m.Room).SingleOrDefaultAsync(m => m.RoomId == roomId && m.PartnerId == partnerId, ct);

    private async Task<Result<RoomMember>> ReadableAsync(CurrentUser user, Guid roomId, CancellationToken ct)
    {
        var m = await MemberAsync(roomId, user.PartnerId, ct);
        if (m?.Room is null) return Error.NotFound("room_not_found", "هذه المجموعة غير متاحة لك.");
        return ChatPolicy.CanRead(m, m.Room) is { } e ? e : m;
    }

    // ------------------------------------------------------------------ rooms

    public Task<int> UnreadTotalAsync(int partnerId, CancellationToken ct) =>
        db.Members.Where(m => m.PartnerId == partnerId && m.RemovedAt == null && m.Room!.Status != RoomStatus.Archived)
            .SumAsync(m => db.Messages.Count(x => x.RoomId == m.RoomId && x.Id > m.LastReadMessageId
                                                  && x.SenderPartnerId != partnerId && x.DeletedAt == null), ct);

    public async Task<IReadOnlyList<RoomListItem>> ListRoomsAsync(CurrentUser user, CancellationToken ct)
    {
        await sync.SyncForUserAsync(user, learning, ct);

        var rows = await db.Members
            .Where(m => m.PartnerId == user.PartnerId && m.RemovedAt == null && m.Room!.Status != RoomStatus.Archived)
            .Select(m => new
            {
                m.Room,
                m.Role,
                Unread = db.Messages.Count(x => x.RoomId == m.RoomId && x.Id > m.LastReadMessageId && x.SenderPartnerId != user.PartnerId && x.DeletedAt == null),
                Last = db.Messages.Where(x => x.RoomId == m.RoomId).OrderByDescending(x => x.Id).FirstOrDefault(),
                Count = db.Members.Count(o => o.RoomId == m.RoomId && o.RemovedAt == null),
                Owner = m.Room!.OwnerPartnerId == null ? null : db.Members.Where(o => o.RoomId == m.RoomId && o.PartnerId == m.Room.OwnerPartnerId).Select(o => o.DisplayName).FirstOrDefault(),
            })
            .ToListAsync(ct);

        return rows
            // A closed group with nothing in it has nothing to read: leave it out of the list.
            .Where(r => r.Room!.Status == RoomStatus.Open || r.Last is not null)
            .Select(r => new RoomListItem(r.Room!.Id, r.Room.Kind.ToString().ToLowerInvariant(),
                r.Room.Kind == RoomKind.Question && user.IsStaff && r.Owner is not null ? $"{r.Room.Title} · {r.Owner}" : r.Room.Title,
                r.Room.Code, r.Room.OdooEventId, r.Room.CourseChannelId, r.Room.Status.ToString().ToLowerInvariant(), r.Room.AnnouncementOnly,
                r.Role.ToString().ToLowerInvariant(), r.Unread, r.Last is null ? null : Preview(r.Last), r.Room.LastMessageAt ?? r.Room.CreatedAt, r.Count))
            .OrderByDescending(r => r.UnreadCount > 0)
            .ThenBy(r => r.Status != "open")
            .ThenByDescending(r => r.LastMessageAt)
            .ToList();
    }

    public async Task<Result<RoomDetail>> GetRoomAsync(CurrentUser user, Guid roomId, CancellationToken ct)
    {
        var m = await ReadableAsync(user, roomId, ct);
        if (!m.IsSuccess) return m.Error!;
        var room = m.Value!.Room!;
        var pinned = await db.Messages.Include(x => x.Reactions)
            .Where(x => x.RoomId == roomId && x.IsPinned && x.DeletedAt == null).OrderByDescending(x => x.Id).Take(5).ToListAsync(ct);
        var count = await db.Members.CountAsync(o => o.RoomId == roomId && o.RemovedAt == null, ct);
        string? askedBy = null;
        if (room.Kind == RoomKind.Question && room.OwnerPartnerId is { } owner)
            askedBy = await db.Members.Where(o => o.RoomId == roomId && o.PartnerId == owner).Select(o => o.DisplayName).FirstOrDefaultAsync(ct);
        return new RoomDetail(room.Id, room.Kind.ToString().ToLowerInvariant(), room.Title, room.Code, room.OdooEventId, room.CourseChannelId,
            room.Status.ToString().ToLowerInvariant(), room.AnnouncementOnly, room.SlowModeSeconds, m.Value.Role.ToString().ToLowerInvariant(),
            m.Value.MutedUntil, m.Value.LastReadMessageId, count, askedBy, await ToDtosAsync(pinned, ct));
    }

    public async Task<Result<IReadOnlyList<MemberDto>>> MembersAsync(CurrentUser user, Guid roomId, CancellationToken ct)
    {
        var m = await ReadableAsync(user, roomId, ct);
        if (!m.IsSuccess) return m.Error!;
        // Names and roles only. Contact details never leave Odoo through the app.
        var members = await db.Members.Where(o => o.RoomId == roomId && o.RemovedAt == null)
            .OrderBy(o => o.Role == MemberRole.Student).ThenBy(o => o.DisplayName)
            .Select(o => new MemberDto(o.PartnerId, o.DisplayName, o.Role.ToString().ToLowerInvariant(), m.Value!.IsStaff ? o.MutedUntil : null))
            .ToListAsync(ct);
        return members;
    }

    public async Task<Result<Guid>> OpenQuestionAsync(CurrentUser user, int eventId, CancellationToken ct)
    {
        await sync.SyncForUserAsync(user, learning, ct);
        var course = await db.Rooms.Include(r => r.Members)
            .SingleOrDefaultAsync(r => r.Kind == RoomKind.Course && r.OdooEventId == eventId, ct);
        var me = course?.Members.SingleOrDefault(x => x.PartnerId == user.PartnerId && x.RemovedAt == null);
        if (course is null || me is null) return Error.NotFound("course_not_found", "هذه الدورة ليست ضمن دوراتك.");
        if (me.IsStaff) return Error.Validation("staff_question", "يفتح المتدربون الأسئلة الخاصة.");
        if (course.Status != RoomStatus.Open) return Error.Blocked("room_read_only", "انتهت الدورة، وأُغلقت الأسئلة الخاصة.");

        var existing = await db.Rooms.Where(r => r.Kind == RoomKind.Question && r.OdooEventId == eventId && r.OwnerPartnerId == user.PartnerId)
            .Select(r => r.Id).FirstOrDefaultAsync(ct);
        if (existing != Guid.Empty) return existing;

        var now = Now;
        var room = new ChatRoom
        {
            Kind = RoomKind.Question, OdooEventId = eventId, OwnerPartnerId = user.PartnerId, Title = course.Title, Code = course.Code,
            CourseChannelId = course.CourseChannelId, Status = RoomStatus.Open, EventStart = course.EventStart, EventEnd = course.EventEnd,
            CreatedAt = now, LastSyncedAt = now,
        };
        room.Members.Add(new RoomMember { RoomId = room.Id, PartnerId = me.PartnerId, DisplayName = me.DisplayName, Role = MemberRole.Student, JoinedAt = now, Notify = NotifyLevel.All });
        foreach (var s in course.Members.Where(x => x.IsStaff && x.RemovedAt == null))
            room.Members.Add(new RoomMember { RoomId = room.Id, PartnerId = s.PartnerId, DisplayName = s.DisplayName, Role = s.Role, JoinedAt = now, Notify = NotifyLevel.All });
        if (room.Members.Count == 1) return Error.Blocked("no_team", "لم يُضَف فريق الدورة إلى التطبيق بعد. اطرح سؤالك في مجموعة الدورة.");
        db.Rooms.Add(room);
        db.Audit.Add(new ChatAudit { RoomId = room.Id, ActorPartnerId = user.PartnerId, Action = "question_opened", At = now });
        await db.SaveChangesAsync(ct);
        return room.Id;
    }

    // ------------------------------------------------------------------ messages

    public async Task<Result<IReadOnlyList<MessageDto>>> GetMessagesAsync(CurrentUser user, Guid roomId, long? beforeId, long? afterId, int limit, CancellationToken ct)
    {
        var m = await ReadableAsync(user, roomId, ct);
        if (!m.IsSuccess) return m.Error!;
        limit = Math.Clamp(limit, 1, 200);
        var q = db.Messages.Include(x => x.Reactions).Where(x => x.RoomId == roomId);
        List<ChatMessage> list;
        if (afterId is { } after)
            list = await q.Where(x => x.Id > after).OrderBy(x => x.Id).Take(limit).ToListAsync(ct);
        else
        {
            if (beforeId is { } before) q = q.Where(x => x.Id < before);
            list = (await q.OrderByDescending(x => x.Id).Take(limit).ToListAsync(ct)).OrderBy(x => x.Id).ToList();
        }
        return Result<IReadOnlyList<MessageDto>>.Ok(await ToDtosAsync(list, ct));
    }

    public async Task<Result<MessageDto>> SendAsync(CurrentUser user, SendMessageRequest req, CancellationToken ct)
    {
        var member = await MemberAsync(req.RoomId, user.PartnerId, ct);
        if (member?.Room is null) return Error.NotFound("room_not_found", "هذه المجموعة غير متاحة لك.");
        var room = member.Room;
        var body = (req.Body ?? "").Trim();
        var attachmentIds = (req.AttachmentIds ?? []).Distinct().Take(10).ToArray();

        var lastOwn = await db.Messages.Where(x => x.RoomId == room.Id && x.SenderPartnerId == user.PartnerId)
            .OrderByDescending(x => x.Id).Select(x => (DateTime?)x.CreatedAt).FirstOrDefaultAsync(ct);
        if (ChatPolicy.CanPost(member, room, Now, lastOwn, body.Length, attachmentIds.Length) is { } denied) return denied;
        if (!member.IsStaff && !rateGuard.TryConsume(user.PartnerId))
            return Error.Blocked("too_fast", "ترسل الرسائل بسرعة كبيرة. انتظر بضع ثوانٍ.");

        if (attachmentIds.Length > 0)
        {
            var owned = await db.Attachments.CountAsync(a => attachmentIds.Contains(a.Id) && a.RoomId == room.Id && a.UploaderPartnerId == user.PartnerId, ct);
            if (owned != attachmentIds.Length) return Error.Validation("bad_attachment", "أحد الملفات غير متاح. ارفعه مرة أخرى.");
        }

        ChatMessage? replyTarget = null;
        if (req.ReplyToId is { } replyId)
        {
            replyTarget = await db.Messages.SingleOrDefaultAsync(x => x.Id == replyId && x.RoomId == room.Id, ct);
            if (replyTarget is null) return Error.Validation("bad_reply", "الرسالة التي ترد عليها غير موجودة.");
        }

        var now = Now;
        var message = new ChatMessage
        {
            RoomId = room.Id, SenderPartnerId = user.PartnerId, SenderName = member.DisplayName, SenderRole = member.Role,
            Body = body, ReplyToId = replyTarget?.Id, AttachmentIds = attachmentIds.Length == 0 ? null : string.Join(',', attachmentIds),
            CreatedAt = now,
        };
        db.Messages.Add(message);
        room.LastMessageAt = now;
        member.LastReadMessageId = Math.Max(member.LastReadMessageId, 0);
        await db.SaveChangesAsync(ct);
        member.LastReadMessageId = message.Id;
        await db.SaveChangesAsync(ct);

        var dto = (await ToDtosAsync([message], ct))[0] with { ClientId = req.ClientId };
        await hub.Clients.Group(ChatHub.RoomGroup(room.Id)).SendAsync("message", dto, ct);
        await NotifyMembersAsync(room, message, replyTarget, ct);
        return dto;
    }

    private async Task NotifyMembersAsync(ChatRoom room, ChatMessage message, ChatMessage? replyTarget, CancellationToken ct)
    {
        var members = await db.Members.Where(x => x.RoomId == room.Id && x.RemovedAt == null).ToListAsync(ct);
        var preview = Preview(message);
        var pushTo = new List<int>();
        foreach (var r in members.Where(x => x.PartnerId != message.SenderPartnerId))
        {
            await hub.Clients.Group(ChatHub.UserGroup(r.PartnerId)).SendAsync("roomActivity", new { roomId = room.Id, lastMessage = preview }, ct);
            var mentioned = message.Body.Contains("@" + r.DisplayName, StringComparison.OrdinalIgnoreCase);
            if (ChatPolicy.ShouldPush(r, message, replyTarget?.SenderPartnerId, mentioned)) pushTo.Add(r.PartnerId);
        }
        if (pushTo.Count == 0) return;

        var who = message.SenderRole switch
        {
            MemberRole.Instructor => $"م. {message.SenderName}",
            _ => message.SenderName,
        };
        var text = message.DeletedAt is null && message.Body.Length > 0 ? message.Body : "أرسل ملفًا";
        notifications.PushOnly(pushTo, new PushMessage(
            Title: room.Kind == RoomKind.Question ? $"سؤال خاص · {room.Title}" : room.Title,
            Body: $"{who}: {Truncate(text, 140)}",
            Url: $"/chats/{room.Id}",
            Tag: $"room-{room.Id}",
            Urgent: false));
    }

    public async Task<Result<bool>> MarkReadAsync(CurrentUser user, Guid roomId, long lastId, CancellationToken ct)
    {
        var m = await ReadableAsync(user, roomId, ct);
        if (!m.IsSuccess) return m.Error!;
        if (lastId > m.Value!.LastReadMessageId)
        {
            var max = await db.Messages.Where(x => x.RoomId == roomId).MaxAsync(x => (long?)x.Id, ct) ?? 0;
            m.Value.LastReadMessageId = Math.Min(lastId, max);
            await db.SaveChangesAsync(ct);
        }
        return true;
    }

    public async Task<Result<MessageDto>> ToggleReactionAsync(CurrentUser user, long messageId, string emoji, CancellationToken ct)
    {
        if (!ChatPolicy.AllowedReactions.Contains(emoji)) return Error.Validation("bad_reaction", "هذا التفاعل غير متاح.");
        var (msg, member, error) = await MessageForAsync(user, messageId, ct);
        if (error is not null) return error;
        if (msg!.DeletedAt is not null) return Error.Conflict("deleted", "حُذفت هذه الرسالة.");
        var existing = msg.Reactions.SingleOrDefault(r => r.PartnerId == user.PartnerId && r.Emoji == emoji);
        if (existing is null) db.Reactions.Add(new MessageReaction { MessageId = msg.Id, PartnerId = user.PartnerId, Emoji = emoji, At = Now });
        else db.Reactions.Remove(existing);
        await db.SaveChangesAsync(ct);
        return await BroadcastUpdateAsync(msg.Id, ct);
    }

    public async Task<Result<MessageDto>> DeleteAsync(CurrentUser user, long messageId, CancellationToken ct)
    {
        var (msg, member, error) = await MessageForAsync(user, messageId, ct);
        if (error is not null) return error;
        if (ChatPolicy.CanDelete(member, msg!) is { } denied) return denied;
        msg!.DeletedAt = Now;
        msg.DeletedBy = user.PartnerId;
        msg.IsPinned = false;
        if (msg.SenderPartnerId != user.PartnerId)
            db.Audit.Add(new ChatAudit { RoomId = msg.RoomId, ActorPartnerId = user.PartnerId, Action = "message_deleted", TargetPartnerId = msg.SenderPartnerId, Details = $"message {msg.Id}", At = Now });
        await db.SaveChangesAsync(ct);
        return await BroadcastUpdateAsync(msg.Id, ct);
    }

    public async Task<Result<MessageDto>> SetFlagAsync(CurrentUser user, long messageId, string flag, bool value, CancellationToken ct)
    {
        var (msg, member, error) = await MessageForAsync(user, messageId, ct);
        if (error is not null) return error;
        if (ChatPolicy.CanModerate(member) is { } denied) return denied;
        if (msg!.DeletedAt is not null) return Error.Conflict("deleted", "حُذفت هذه الرسالة.");
        if (flag == "pin") msg.IsPinned = value; else msg.IsAnswer = value;
        db.Audit.Add(new ChatAudit { RoomId = msg.RoomId, ActorPartnerId = user.PartnerId, Action = value ? $"{flag}_set" : $"{flag}_cleared", Details = $"message {msg.Id}", At = Now });
        await db.SaveChangesAsync(ct);
        return await BroadcastUpdateAsync(msg.Id, ct);
    }

    public async Task<Result<bool>> ReportAsync(CurrentUser user, long messageId, string reason, CancellationToken ct)
    {
        var (msg, member, error) = await MessageForAsync(user, messageId, ct);
        if (error is not null) return error;
        if (ChatPolicy.CanReport(member, msg!) is { } denied) return denied;
        reason = Truncate((reason ?? "").Trim(), 480);
        db.Reports.Add(new MessageReport { MessageId = msg!.Id, RoomId = msg.RoomId, ReporterPartnerId = user.PartnerId, Reason = reason, At = Now });
        db.Audit.Add(new ChatAudit { RoomId = msg.RoomId, ActorPartnerId = user.PartnerId, Action = "message_reported", TargetPartnerId = msg.SenderPartnerId, Details = $"message {msg.Id}", At = Now });
        await db.SaveChangesAsync(ct);

        var staff = await db.Members.Where(x => x.RoomId == msg.RoomId && x.RemovedAt == null && x.Role != MemberRole.Student).Select(x => x.PartnerId).ToListAsync(ct);
        await notifications.NotifyAsync(staff, "chat_report", "بلاغ على رسالة", "أبلغ متدرب عن رسالة في المجموعة. يُرجى مراجعتها.", $"/chats/{msg.RoomId}", urgent: false, ct: ct);
        return true;
    }

    public async Task<Result<RoomDetail>> UpdateRoomAsync(CurrentUser user, Guid roomId, RoomSettingsRequest req, CancellationToken ct)
    {
        var member = await MemberAsync(roomId, user.PartnerId, ct);
        if (member?.Room is null) return Error.NotFound("room_not_found", "هذه المجموعة غير متاحة لك.");
        if (ChatPolicy.CanModerate(member) is { } denied) return denied;
        var room = member.Room;
        if (req.AnnouncementOnly is { } a && a != room.AnnouncementOnly)
        {
            room.AnnouncementOnly = a;
            db.Audit.Add(new ChatAudit { RoomId = roomId, ActorPartnerId = user.PartnerId, Action = a ? "announcement_on" : "announcement_off", At = Now });
        }
        if (req.SlowModeSeconds is { } s)
        {
            room.SlowModeSeconds = Math.Clamp(s, 0, 3600);
            db.Audit.Add(new ChatAudit { RoomId = roomId, ActorPartnerId = user.PartnerId, Action = "slow_mode", Details = $"{room.SlowModeSeconds}s", At = Now });
        }
        await db.SaveChangesAsync(ct);
        var detail = await GetRoomAsync(user, roomId, ct);
        await hub.Clients.Group(ChatHub.RoomGroup(roomId)).SendAsync("roomUpdated", new { roomId, room.AnnouncementOnly, room.SlowModeSeconds }, ct);
        return detail;
    }

    public async Task<Result<MemberDto>> MuteAsync(CurrentUser user, Guid roomId, MuteRequest req, CancellationToken ct)
    {
        var me = await MemberAsync(roomId, user.PartnerId, ct);
        if (ChatPolicy.CanModerate(me) is { } denied) return denied;
        var target = await db.Members.SingleOrDefaultAsync(x => x.RoomId == roomId && x.PartnerId == req.PartnerId && x.RemovedAt == null, ct);
        if (target is null) return Error.NotFound("member_not_found", "هذا العضو ليس في المجموعة.");
        if (target.IsStaff) return Error.Forbidden("cannot_mute_staff", "لا يمكن كتم أحد أعضاء فريق الدورة.");
        var minutes = Math.Clamp(req.Minutes, 0, 60 * 24 * 7);
        target.MutedUntil = minutes == 0 ? null : Now.AddMinutes(minutes);
        db.Audit.Add(new ChatAudit { RoomId = roomId, ActorPartnerId = user.PartnerId, Action = minutes == 0 ? "member_unmuted" : "member_muted", TargetPartnerId = target.PartnerId, Details = $"{minutes} min", At = Now });
        await db.SaveChangesAsync(ct);
        var dto = new MemberDto(target.PartnerId, target.DisplayName, target.Role.ToString().ToLowerInvariant(), target.MutedUntil);
        await hub.Clients.Group(ChatHub.UserGroup(target.PartnerId)).SendAsync("muted", new { roomId, until = target.MutedUntil }, ct);
        return dto;
    }

    public async Task<Result<bool>> SetNotifyAsync(CurrentUser user, Guid roomId, string level, CancellationToken ct)
    {
        if (!Enum.TryParse<NotifyLevel>(level, true, out var parsed)) return Error.Validation("bad_level", "اختيار غير صحيح.");
        var m = await ReadableAsync(user, roomId, ct);
        if (!m.IsSuccess) return m.Error!;
        m.Value!.Notify = parsed;
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ------------------------------------------------------------------ attachments

    private static readonly Dictionary<string, string> AllowedTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png", [".webp"] = "image/webp", [".gif"] = "image/gif",
        [".pdf"] = "application/pdf", [".zip"] = "application/zip", [".rar"] = "application/vnd.rar",
        [".dwg"] = "application/acad", [".dxf"] = "application/dxf",
        [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        [".pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        [".m4a"] = "audio/mp4", [".webm"] = "audio/webm", [".ogg"] = "audio/ogg", [".mp3"] = "audio/mpeg",
    };

    /// <summary>Allowed upload types, decided by extension only (the browser's content type is not trusted).</summary>
    public static bool TryGetAllowedType(string fileName, out string contentType) =>
        AllowedTypes.TryGetValue(Path.GetExtension(fileName ?? ""), out contentType!);

    public async Task<Result<AttachmentDto>> UploadAsync(CurrentUser user, Guid roomId, IFormFile file, CancellationToken ct)
    {
        var member = await MemberAsync(roomId, user.PartnerId, ct);
        if (ChatPolicy.CanUpload(member, member?.Room ?? new ChatRoom { Status = RoomStatus.Archived }, options.Value.StudentsCanUpload) is { } denied) return denied;
        var max = options.Value.MaxAttachmentMb * 1024L * 1024L;
        if (file.Length == 0 || file.Length > max) return Error.Validation("file_size", $"يجب أن يكون حجم الملف أقل من {options.Value.MaxAttachmentMb} ميجابايت.");
        var ext = Path.GetExtension(file.FileName);
        if (!AllowedTypes.TryGetValue(ext, out var contentType))
            return Error.Validation("file_type", "نوع الملف غير مسموح. المسموح: الصور، وPDF، وملفات أوفيس، وDWG، وZIP، والتسجيلات الصوتية.");

        var id = Guid.NewGuid();
        var dir = Path.Combine(StorageRoot, roomId.ToString("N"));
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, id.ToString("N"));
        string hash;
        await using (var target = File.Create(path))
        await using (var source = file.OpenReadStream())
        {
            using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[81920];
            int read;
            while ((read = await source.ReadAsync(buffer, ct)) > 0)
            {
                sha.AppendData(buffer, 0, read);
                await target.WriteAsync(buffer.AsMemory(0, read), ct);
            }
            hash = Convert.ToHexString(sha.GetHashAndReset());
        }
        if (contentType.StartsWith("image/"))
        {
            var head = new byte[16];
            await using var check = File.OpenRead(path);
            _ = await check.ReadAsync(head, ct);
            if (!Media.Sniff(head).StartsWith("image/")) { File.Delete(path); return Error.Validation("file_type", "هذه الصورة غير صالحة."); }
        }

        var name = Path.GetFileName(file.FileName);
        if (name.Length > 200) name = name[^200..];
        db.Attachments.Add(new ChatAttachment
        {
            Id = id, RoomId = roomId, UploaderPartnerId = user.PartnerId, FileName = name, ContentType = contentType,
            Size = file.Length, Sha256 = hash, StoragePath = path, At = Now,
        });
        await db.SaveChangesAsync(ct);
        return new AttachmentDto(id, name, contentType, file.Length);
    }

    public async Task<Result<ChatAttachment>> GetAttachmentAsync(CurrentUser user, Guid attachmentId, CancellationToken ct)
    {
        var a = await db.Attachments.SingleOrDefaultAsync(x => x.Id == attachmentId, ct);
        if (a is null) return Error.NotFound("file_not_found", "هذا الملف غير موجود.");
        var m = await ReadableAsync(user, a.RoomId, ct);
        if (!m.IsSuccess) return Error.NotFound("file_not_found", "هذا الملف غير موجود.");
        return File.Exists(a.StoragePath) ? a : Error.NotFound("file_not_found", "هذا الملف غير موجود.");
    }

    private string StorageRoot => Path.IsPathRooted(options.Value.StoragePath)
        ? options.Value.StoragePath
        : Path.Combine(env.ContentRootPath, options.Value.StoragePath);

    // ------------------------------------------------------------------ helpers

    private async Task<(ChatMessage? Message, RoomMember? Member, Error? Error)> MessageForAsync(CurrentUser user, long messageId, CancellationToken ct)
    {
        var msg = await db.Messages.Include(x => x.Reactions).SingleOrDefaultAsync(x => x.Id == messageId, ct);
        if (msg is null) return (null, null, Error.NotFound("message_not_found", "هذه الرسالة غير موجودة."));
        var member = await MemberAsync(msg.RoomId, user.PartnerId, ct);
        if (member?.Room is null || ChatPolicy.CanRead(member, member.Room) is not null)
            return (null, null, Error.NotFound("message_not_found", "هذه الرسالة غير موجودة."));
        return (msg, member, null);
    }

    private async Task<Result<MessageDto>> BroadcastUpdateAsync(long messageId, CancellationToken ct)
    {
        var msg = await db.Messages.Include(x => x.Reactions).AsNoTracking().SingleAsync(x => x.Id == messageId, ct);
        var dto = (await ToDtosAsync([msg], ct))[0];
        await hub.Clients.Group(ChatHub.RoomGroup(msg.RoomId)).SendAsync("messageUpdated", dto, ct);
        return dto;
    }

    internal async Task<IReadOnlyList<MessageDto>> ToDtosAsync(IReadOnlyList<ChatMessage> messages, CancellationToken ct)
    {
        if (messages.Count == 0) return [];
        var attachmentIds = messages.Where(m => m.DeletedAt is null && m.AttachmentIds is not null)
            .SelectMany(m => m.AttachmentIds!.Split(',', StringSplitOptions.RemoveEmptyEntries)).Select(Guid.Parse).Distinct().ToList();
        var attachments = attachmentIds.Count == 0
            ? new Dictionary<Guid, ChatAttachment>()
            : await db.Attachments.Where(a => attachmentIds.Contains(a.Id)).ToDictionaryAsync(a => a.Id, ct);
        var replyIds = messages.Where(m => m.ReplyToId is not null).Select(m => m.ReplyToId!.Value).Distinct().ToList();
        var replies = replyIds.Count == 0
            ? new Dictionary<long, ChatMessage>()
            : await db.Messages.Where(x => replyIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);

        return messages.Select(m =>
        {
            var deleted = m.DeletedAt is not null;
            var files = deleted || m.AttachmentIds is null
                ? []
                : m.AttachmentIds.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(Guid.Parse)
                    .Where(attachments.ContainsKey).Select(id => attachments[id])
                    .Select(a => new AttachmentDto(a.Id, a.FileName, a.ContentType, a.Size)).ToList();
            ReplyDto? reply = null;
            if (m.ReplyToId is { } rid && replies.TryGetValue(rid, out var r))
                reply = new ReplyDto(r.Id, r.SenderName, r.DeletedAt is null ? Truncate(r.Body.Length > 0 ? r.Body : "ملف", 120) : "رسالة محذوفة");
            var reactions = m.Reactions.GroupBy(x => x.Emoji).Select(g => new ReactionDto(g.Key, g.Select(x => x.PartnerId).ToArray())).ToList();
            return new MessageDto(m.Id, m.RoomId, new SenderDto(m.SenderPartnerId, m.SenderName, m.SenderRole.ToString().ToLowerInvariant()),
                deleted ? "" : m.Body, reply, files, deleted ? [] : reactions, m.IsAnswer, m.IsPinned, deleted, DateTime.SpecifyKind(m.CreatedAt, DateTimeKind.Utc));
        }).ToList();
    }

    private static MessagePreview Preview(ChatMessage m) =>
        new(m.Id, m.SenderName, m.SenderRole.ToString().ToLowerInvariant(),
            m.DeletedAt is not null ? "رسالة محذوفة" : m.Body.Length > 0 ? Truncate(m.Body, 100) : "📎 ملف",
            DateTime.SpecifyKind(m.CreatedAt, DateTimeKind.Utc));

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "…";
}

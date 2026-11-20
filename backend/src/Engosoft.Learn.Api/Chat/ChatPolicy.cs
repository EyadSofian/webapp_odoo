using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;

namespace Engosoft.Learn.Api.Chat;

public sealed class ChatOptions
{
    public const string Section = "Chat";
    public bool Enabled { get; set; } = true;
    /// <summary>Days after the last session when the group turns read-only.</summary>
    public int ReadOnlyAfterDays { get; set; } = 14;
    public int SyncIntervalMinutes { get; set; } = 15;
    public int ResyncAfterMinutes { get; set; } = 10;
    public int MaxAttachmentMb { get; set; } = 20;
    public bool StudentsCanUpload { get; set; } = true;
    public string StoragePath { get; set; } = "storage/chat";
    /// <summary>Burst guard per person on top of slow mode: at most N messages per window.</summary>
    public int BurstMessages { get; set; } = 8;
    public int BurstWindowSeconds { get; set; } = 20;
}

/// <summary>
/// Every chat rule in one place, free of I/O so it can be tested directly.
/// The rules: only enrolled people are in a group; learners never message each other privately;
/// the course team moderates.
/// </summary>
public static class ChatPolicy
{
    public const int MaxBodyLength = 4000;

    public static readonly string[] AllowedReactions = ["👍", "❤️", "😂", "😮", "🙏", "✅"];

    private static readonly Error NotMember = Error.NotFound("room_not_found", "الجروب ده مش متاح لك.");

    public static Error? CanRead(RoomMember? member, ChatRoom room)
    {
        if (member is null || !member.IsActive) return NotMember;
        if (room.Status == RoomStatus.Archived && !member.IsStaff) return NotMember;
        return null;
    }

    public static Error? CanPost(RoomMember? member, ChatRoom room, DateTime now, DateTime? lastOwnMessageAt, int bodyLength, int attachmentCount)
    {
        if (CanRead(member, room) is { } readError) return readError;
        if (room.Status != RoomStatus.Open)
            return Error.Blocked("room_read_only", "الجروب ده اتقفل للكتابة بعد انتهاء الكورس. تقدر تقرا الرسايل القديمة.");
        if (bodyLength == 0 && attachmentCount == 0)
            return Error.Validation("empty_message", "اكتب رسالة أو ارفع ملف.");
        if (bodyLength > MaxBodyLength)
            return Error.Validation("message_too_long", $"الرسالة طويلة. الحد الأقصى {MaxBodyLength} حرف.");
        if (member!.IsStaff) return null;

        if (room.AnnouncementOnly)
            return Error.Blocked("announcement_only", "الجروب ده للإعلانات بس دلوقتي. لو عندك سؤال، ابعته للمحاضر سؤال خاص.");
        if (member.MutedUntil is { } until && until > now)
            return Error.Blocked("muted", $"مش هتقدر تكتب في الجروب لحد {until:HH:mm} بتوقيت جرينتش.");
        if (room.SlowModeSeconds > 0 && lastOwnMessageAt is { } last && (now - last).TotalSeconds < room.SlowModeSeconds)
        {
            var wait = (int)Math.Ceiling(room.SlowModeSeconds - (now - last).TotalSeconds);
            return Error.Blocked("slow_mode", $"الجروب في الوضع البطيء. استنى {wait} ثانية.");
        }
        return null;
    }

    public static Error? CanUpload(RoomMember? member, ChatRoom room, bool studentsCanUpload)
    {
        if (CanRead(member, room) is { } readError) return readError;
        if (room.Status != RoomStatus.Open) return Error.Blocked("room_read_only", "الجروب ده اتقفل للكتابة.");
        if (!member!.IsStaff && !studentsCanUpload) return Error.Forbidden("upload_disabled", "رفع الملفات متاح لفريق الكورس بس.");
        return null;
    }

    public static Error? CanModerate(RoomMember? member) =>
        member is { IsActive: true, IsStaff: true } ? null : Error.Forbidden("staff_only", "الإجراء ده للمحاضر وفريق الكورس بس.");

    public static Error? CanDelete(RoomMember? member, ChatMessage message)
    {
        if (member is null || !member.IsActive) return NotMember;
        if (message.DeletedAt is not null) return Error.Conflict("already_deleted", "الرسالة دي اتمسحت قبل كده.");
        return member.IsStaff || message.SenderPartnerId == member.PartnerId
            ? null
            : Error.Forbidden("not_your_message", "تقدر تمسح رسايلك انت بس.");
    }

    public static Error? CanReport(RoomMember? member, ChatMessage message)
    {
        if (member is null || !member.IsActive) return NotMember;
        return message.SenderPartnerId == member.PartnerId ? Error.Validation("own_message", "مينفعش تبلّغ عن رسالتك.") : null;
    }

    /// <summary>Who belongs in a course group: an active seat that has not expired, or the course team.</summary>
    public static bool IsEligibleStudent(string? registrationState, DateTime? accessUntil, DateTime now) =>
        registrationState is "open" or "done" && (accessUntil is null || accessUntil > now);

    public static RoomStatus StatusFor(DateTime? eventEnd, DateTime now, int readOnlyAfterDays) =>
        eventEnd is { } end && now > end.AddDays(readOnlyAfterDays) ? RoomStatus.ReadOnly : RoomStatus.Open;

    /// <summary>Default push behaviour: the team's messages, replies to you and mentions. Not every student message.</summary>
    public static bool ShouldPush(RoomMember recipient, ChatMessage message, int? repliedToPartnerId, bool mentioned) =>
        recipient.PartnerId != message.SenderPartnerId && recipient.IsActive && recipient.Notify switch
        {
            NotifyLevel.None => false,
            NotifyLevel.All => true,
            _ => message.SenderRole != MemberRole.Student || repliedToPartnerId == recipient.PartnerId || mentioned,
        };
}

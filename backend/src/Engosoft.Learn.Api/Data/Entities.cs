namespace Engosoft.Learn.Api.Data;

// ---------- Auth ----------

public sealed class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int Uid { get; set; }
    public int PartnerId { get; set; }
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public Guid? ReplacedById { get; set; }
    public string? UserAgent { get; set; }
}

// ---------- Chat ----------

public enum RoomKind { Course, Question }
public enum RoomStatus { Open, ReadOnly, Archived }
public enum MemberRole { Student, Instructor, Assistant, Coordinator, Admin }
public enum NotifyLevel { All, Important, None }

public sealed class ChatRoom
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public RoomKind Kind { get; set; }
    public int OdooEventId { get; set; }
    /// <summary>For a private question room: the learner who asked.</summary>
    public int? OwnerPartnerId { get; set; }
    public string Title { get; set; } = "";
    public string? Code { get; set; }
    public int? CourseChannelId { get; set; }
    public bool AnnouncementOnly { get; set; }
    public int SlowModeSeconds { get; set; }
    public RoomStatus Status { get; set; }
    public DateTime? EventStart { get; set; }
    public DateTime? EventEnd { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastMessageAt { get; set; }
    public DateTime? LastSyncedAt { get; set; }
    public List<RoomMember> Members { get; set; } = [];
}

public sealed class RoomMember
{
    public Guid RoomId { get; set; }
    public int PartnerId { get; set; }
    public string DisplayName { get; set; } = "";
    public MemberRole Role { get; set; }
    public DateTime JoinedAt { get; set; }
    public DateTime? RemovedAt { get; set; }
    public string? RemovedReason { get; set; }
    public DateTime? MutedUntil { get; set; }
    public long LastReadMessageId { get; set; }
    public NotifyLevel Notify { get; set; } = NotifyLevel.Important;
    public ChatRoom? Room { get; set; }

    public bool IsActive => RemovedAt is null;
    public bool IsStaff => Role != MemberRole.Student;
}

public sealed class ChatMessage
{
    /// <summary>Global, ever-increasing id. Clients resume a room with "everything after id N".</summary>
    public long Id { get; set; }
    public Guid RoomId { get; set; }
    public int SenderPartnerId { get; set; }
    public string SenderName { get; set; } = "";
    public MemberRole SenderRole { get; set; }
    public string Body { get; set; } = "";
    public long? ReplyToId { get; set; }
    public string? AttachmentIds { get; set; }
    public bool IsAnswer { get; set; }
    public bool IsPinned { get; set; }
    public bool IsSystem { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
    public int? DeletedBy { get; set; }
    public List<MessageReaction> Reactions { get; set; } = [];
}

public sealed class MessageReaction
{
    public long MessageId { get; set; }
    public int PartnerId { get; set; }
    public string Emoji { get; set; } = "";
    public DateTime At { get; set; }
}

public sealed class MessageReport
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public long MessageId { get; set; }
    public Guid RoomId { get; set; }
    public int ReporterPartnerId { get; set; }
    public string Reason { get; set; } = "";
    public DateTime At { get; set; }
    public DateTime? ResolvedAt { get; set; }
}

public sealed class ChatAttachment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RoomId { get; set; }
    public int UploaderPartnerId { get; set; }
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Size { get; set; }
    public string Sha256 { get; set; } = "";
    public string StoragePath { get; set; } = "";
    public DateTime At { get; set; }
}

public sealed class ChatAudit
{
    public long Id { get; set; }
    public Guid RoomId { get; set; }
    public int? ActorPartnerId { get; set; }
    public string Action { get; set; } = "";
    public int? TargetPartnerId { get; set; }
    public string? Details { get; set; }
    public DateTime At { get; set; }
}

// ---------- Notifications ----------

public sealed class PushSubscription
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int PartnerId { get; set; }
    public string Endpoint { get; set; } = "";
    public string P256dh { get; set; } = "";
    public string Auth { get; set; } = "";
    public string? UserAgent { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastSuccessAt { get; set; }
    public int Failures { get; set; }
}

public sealed class Notification
{
    public long Id { get; set; }
    public int PartnerId { get; set; }
    public string Kind { get; set; } = "";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string? Url { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ReadAt { get; set; }
}

public sealed class UserPreference
{
    public int PartnerId { get; set; }
    public bool QuietHoursEnabled { get; set; }
    /// <summary>Minutes after local midnight, in the learner's own time zone.</summary>
    public int QuietFromMinute { get; set; } = 23 * 60;
    public int QuietToMinute { get; set; } = 7 * 60;
    public string TimeZone { get; set; } = "Asia/Riyadh";
    public bool PushChatAll { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class SentReminder
{
    public int TrackId { get; set; }
    public string Kind { get; set; } = "";
    public DateTime SentAt { get; set; }
}

public sealed class AppSetting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}

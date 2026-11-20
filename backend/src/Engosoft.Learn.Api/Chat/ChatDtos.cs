namespace Engosoft.Learn.Api.Chat;

public sealed record SenderDto(int PartnerId, string Name, string Role);
public sealed record ReplyDto(long Id, string SenderName, string Snippet);
public sealed record AttachmentDto(Guid Id, string Name, string ContentType, long Size);
public sealed record ReactionDto(string Emoji, int[] PartnerIds);

public sealed record MessageDto(
    long Id,
    Guid RoomId,
    SenderDto Sender,
    string Body,
    ReplyDto? ReplyTo,
    IReadOnlyList<AttachmentDto> Attachments,
    IReadOnlyList<ReactionDto> Reactions,
    bool IsAnswer,
    bool IsPinned,
    bool Deleted,
    DateTime CreatedAt,
    string? ClientId = null);

public sealed record MessagePreview(long Id, string SenderName, string SenderRole, string Text, DateTime At);

public sealed record RoomListItem(
    Guid Id,
    string Kind,
    string Title,
    string? Code,
    int EventId,
    int? CourseChannelId,
    string Status,
    bool AnnouncementOnly,
    string MyRole,
    int UnreadCount,
    MessagePreview? LastMessage,
    DateTime? LastMessageAt,
    int MemberCount);

public sealed record RoomDetail(
    Guid Id,
    string Kind,
    string Title,
    string? Code,
    int EventId,
    int? CourseChannelId,
    string Status,
    bool AnnouncementOnly,
    int SlowModeSeconds,
    string MyRole,
    DateTime? MutedUntil,
    long LastReadMessageId,
    int MemberCount,
    string? AskedBy,
    IReadOnlyList<MessageDto> Pinned);

public sealed record MemberDto(int PartnerId, string Name, string Role, DateTime? MutedUntil);

public sealed record SendMessageRequest(Guid RoomId, string? Body, long? ReplyToId, Guid[]? AttachmentIds, string? ClientId);

public sealed record RoomSettingsRequest(bool? AnnouncementOnly, int? SlowModeSeconds);

public sealed record MuteRequest(int PartnerId, int Minutes);

public sealed record ReportRequest(string Reason);

public sealed record OpenQuestionRequest(int EventId);

public sealed record MarkReadRequest(long LastMessageId);

public sealed record MemberPrefsRequest(string Notify);

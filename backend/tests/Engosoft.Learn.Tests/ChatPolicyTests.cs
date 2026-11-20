using Engosoft.Learn.Api.Chat;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;

namespace Engosoft.Learn.Tests;

public class ChatPolicyTests
{
    private static readonly DateTime Now = new(2026, 11, 21, 12, 0, 0, DateTimeKind.Utc);

    private static ChatRoom Room(RoomStatus status = RoomStatus.Open, bool announcementOnly = false, int slow = 0) =>
        new() { Status = status, AnnouncementOnly = announcementOnly, SlowModeSeconds = slow };

    private static RoomMember Member(MemberRole role = MemberRole.Student, DateTime? removed = null, DateTime? muted = null) =>
        new() { PartnerId = 10, Role = role, RemovedAt = removed, MutedUntil = muted };

    [Fact]
    public void Non_members_cannot_read_and_get_not_found_not_forbidden()
    {
        var error = ChatPolicy.CanRead(null, Room());
        Assert.Equal(ErrorKind.NotFound, error!.Kind);
    }

    [Fact]
    public void Removed_members_lose_access_immediately()
    {
        Assert.NotNull(ChatPolicy.CanRead(Member(removed: Now.AddMinutes(-1)), Room()));
        Assert.NotNull(ChatPolicy.CanPost(Member(removed: Now.AddMinutes(-1)), Room(), Now, null, 5, 0));
    }

    [Fact]
    public void Students_cannot_post_in_announcement_only_groups_but_staff_can()
    {
        var room = Room(announcementOnly: true);
        Assert.Equal("announcement_only", ChatPolicy.CanPost(Member(), room, Now, null, 5, 0)!.Code);
        Assert.Null(ChatPolicy.CanPost(Member(MemberRole.Instructor), room, Now, null, 5, 0));
        Assert.Null(ChatPolicy.CanPost(Member(MemberRole.Coordinator), room, Now, null, 5, 0));
    }

    [Fact]
    public void Muted_student_is_blocked_until_the_mute_ends()
    {
        Assert.Equal("muted", ChatPolicy.CanPost(Member(muted: Now.AddMinutes(5)), Room(), Now, null, 5, 0)!.Code);
        Assert.Null(ChatPolicy.CanPost(Member(muted: Now.AddMinutes(-1)), Room(), Now, null, 5, 0));
    }

    [Fact]
    public void Slow_mode_applies_to_students_only()
    {
        var room = Room(slow: 30);
        Assert.Equal("slow_mode", ChatPolicy.CanPost(Member(), room, Now, Now.AddSeconds(-10), 5, 0)!.Code);
        Assert.Null(ChatPolicy.CanPost(Member(), room, Now, Now.AddSeconds(-31), 5, 0));
        Assert.Null(ChatPolicy.CanPost(Member(MemberRole.Instructor), room, Now, Now.AddSeconds(-1), 5, 0));
    }

    [Fact]
    public void Read_only_groups_refuse_everyone()
    {
        Assert.Equal("room_read_only", ChatPolicy.CanPost(Member(MemberRole.Instructor), Room(RoomStatus.ReadOnly), Now, null, 5, 0)!.Code);
    }

    [Theory]
    [InlineData(0, 0, "empty_message")]
    [InlineData(4001, 0, "message_too_long")]
    public void Message_size_is_validated(int length, int attachments, string code) =>
        Assert.Equal(code, ChatPolicy.CanPost(Member(), Room(), Now, null, length, attachments)!.Code);

    [Fact]
    public void Attachment_without_text_is_allowed() =>
        Assert.Null(ChatPolicy.CanPost(Member(), Room(), Now, null, 0, 1));

    [Fact]
    public void Students_delete_only_their_own_messages_and_staff_any()
    {
        var mine = new ChatMessage { SenderPartnerId = 10 };
        var other = new ChatMessage { SenderPartnerId = 99 };
        Assert.Null(ChatPolicy.CanDelete(Member(), mine));
        Assert.Equal(ErrorKind.Forbidden, ChatPolicy.CanDelete(Member(), other)!.Kind);
        Assert.Null(ChatPolicy.CanDelete(Member(MemberRole.Instructor), other));
    }

    [Fact]
    public void Only_staff_moderate()
    {
        Assert.NotNull(ChatPolicy.CanModerate(Member()));
        Assert.Null(ChatPolicy.CanModerate(Member(MemberRole.Assistant)));
        Assert.NotNull(ChatPolicy.CanModerate(Member(MemberRole.Instructor, removed: Now)));
    }

    [Theory]
    [InlineData("open", null, true)]
    [InlineData("done", null, true)]
    [InlineData("draft", null, false)]
    [InlineData("cancel", null, false)]
    public void Eligibility_follows_the_registration_state(string state, string? until, bool expected) =>
        Assert.Equal(expected, ChatPolicy.IsEligibleStudent(state, until is null ? null : DateTime.Parse(until), Now));

    [Fact]
    public void Expired_seat_is_not_eligible()
    {
        Assert.False(ChatPolicy.IsEligibleStudent("open", Now.AddSeconds(-1), Now));
        Assert.True(ChatPolicy.IsEligibleStudent("open", Now.AddDays(1), Now));
    }

    [Fact]
    public void Group_turns_read_only_after_the_grace_period()
    {
        Assert.Equal(RoomStatus.Open, ChatPolicy.StatusFor(Now.AddDays(-13), Now, 14));
        Assert.Equal(RoomStatus.ReadOnly, ChatPolicy.StatusFor(Now.AddDays(-15), Now, 14));
        Assert.Equal(RoomStatus.Open, ChatPolicy.StatusFor(null, Now, 14));
    }

    [Fact]
    public void Push_by_default_only_for_team_messages_replies_and_mentions()
    {
        var recipient = Member();
        recipient.PartnerId = 50;
        recipient.Notify = NotifyLevel.Important;
        var fromStudent = new ChatMessage { SenderPartnerId = 60, SenderRole = MemberRole.Student };
        var fromInstructor = new ChatMessage { SenderPartnerId = 60, SenderRole = MemberRole.Instructor };

        Assert.False(ChatPolicy.ShouldPush(recipient, fromStudent, null, false));
        Assert.True(ChatPolicy.ShouldPush(recipient, fromStudent, 50, false));
        Assert.True(ChatPolicy.ShouldPush(recipient, fromStudent, null, true));
        Assert.True(ChatPolicy.ShouldPush(recipient, fromInstructor, null, false));

        recipient.Notify = NotifyLevel.None;
        Assert.False(ChatPolicy.ShouldPush(recipient, fromInstructor, null, false));
        recipient.Notify = NotifyLevel.All;
        Assert.True(ChatPolicy.ShouldPush(recipient, fromStudent, null, false));
    }

    [Fact]
    public void Nobody_is_pushed_their_own_message()
    {
        var me = Member(MemberRole.Instructor);
        me.Notify = NotifyLevel.All;
        Assert.False(ChatPolicy.ShouldPush(me, new ChatMessage { SenderPartnerId = me.PartnerId, SenderRole = MemberRole.Instructor }, null, false));
    }
}

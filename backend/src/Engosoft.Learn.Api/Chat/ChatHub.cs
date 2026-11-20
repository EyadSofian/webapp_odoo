using Engosoft.Learn.Api.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Engosoft.Learn.Api.Chat;

/// <summary>
/// Real-time chat. Hub methods do not run HTTP middleware, so the caller is read from Context.User on every call,
/// and every room action re-checks membership in the database.
/// </summary>
[Authorize]
public sealed class ChatHub(ChatService chat, ConnectionRegistry registry) : Hub
{
    public static string RoomGroup(Guid roomId) => $"room:{roomId:N}";
    public static string UserGroup(int partnerId) => $"user:{partnerId}";

    private CurrentUser Me => CurrentUser.From(Context.User) ?? throw new HubException("سجّل دخول تاني.");

    public override async Task OnConnectedAsync()
    {
        var me = Me;
        registry.Add(me.PartnerId, Context.ConnectionId);
        await Groups.AddToGroupAsync(Context.ConnectionId, UserGroup(me.PartnerId));
        await base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        if (CurrentUser.From(Context.User) is { } me) registry.Remove(me.PartnerId, Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }

    /// <summary>Subscribe to a room and get everything after the last message the client already has.</summary>
    public async Task<IReadOnlyList<MessageDto>> JoinRoom(Guid roomId, long afterId)
    {
        var result = await chat.GetMessagesAsync(Me, roomId, beforeId: null, afterId: afterId > 0 ? afterId : null, limit: afterId > 0 ? 200 : 50, Context.ConnectionAborted);
        var messages = Unwrap(result);
        await Groups.AddToGroupAsync(Context.ConnectionId, RoomGroup(roomId));
        JoinedRooms.Add(roomId);
        return messages;
    }

    public Task LeaveRoom(Guid roomId)
    {
        JoinedRooms.Remove(roomId);
        return Groups.RemoveFromGroupAsync(Context.ConnectionId, RoomGroup(roomId));
    }

    private HashSet<Guid> JoinedRooms =>
        (HashSet<Guid>)(Context.Items.TryGetValue("rooms", out var v) ? v! : Context.Items["rooms"] = new HashSet<Guid>());

    public async Task<MessageDto> SendMessage(SendMessageRequest request) =>
        Unwrap(await chat.SendAsync(Me, request, Context.ConnectionAborted));

    public async Task Typing(Guid roomId)
    {
        var me = Me;
        // Only rooms this connection joined (membership was checked then).
        if (!JoinedRooms.Contains(roomId)) return;
        await Clients.OthersInGroup(RoomGroup(roomId)).SendAsync("typing", new { roomId, partnerId = me.PartnerId, name = me.Name });
    }

    public async Task MarkRead(Guid roomId, long lastMessageId) =>
        Unwrap(await chat.MarkReadAsync(Me, roomId, lastMessageId, Context.ConnectionAborted));

    public async Task<MessageDto> React(long messageId, string emoji) =>
        Unwrap(await chat.ToggleReactionAsync(Me, messageId, emoji, Context.ConnectionAborted));

    public async Task<MessageDto> DeleteMessage(long messageId) =>
        Unwrap(await chat.DeleteAsync(Me, messageId, Context.ConnectionAborted));

    public async Task<MessageDto> Pin(long messageId, bool pinned) =>
        Unwrap(await chat.SetFlagAsync(Me, messageId, "pin", pinned, Context.ConnectionAborted));

    public async Task<MessageDto> MarkAnswer(long messageId, bool isAnswer) =>
        Unwrap(await chat.SetFlagAsync(Me, messageId, "answer", isAnswer, Context.ConnectionAborted));

    private static T Unwrap<T>(Result<T> result) =>
        result.IsSuccess ? result.Value! : throw new HubException(result.Error!.Message);
}

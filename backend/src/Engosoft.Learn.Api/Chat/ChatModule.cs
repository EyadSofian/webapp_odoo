using Engosoft.Learn.Api.Common;
using Microsoft.AspNetCore.Mvc;

namespace Engosoft.Learn.Api.Chat;

public static class ChatModule
{
    public static IServiceCollection AddChatModule(this IServiceCollection services)
    {
        services.AddOptions<ChatOptions>().BindConfiguration(ChatOptions.Section);
        services.AddSingleton<ConnectionRegistry>();
        services.AddSingleton<MessageRateGuard>();
        services.AddScoped<MembershipSync>();
        services.AddScoped<ChatService>();
        services.AddHostedService<MembershipSyncWorker>();
        services.AddSignalR(o =>
        {
            o.MaximumReceiveMessageSize = 64 * 1024;
            o.EnableDetailedErrors = false;
        });
        return services;
    }

    public static void MapChatEndpoints(this WebApplication app)
    {
        app.MapHub<ChatHub>("/hubs/chat");

        var g = app.MapGroup("/api/chats").WithTags("Chat").RequireAuthorization().RequireRateLimiting("api");

        g.MapGet("/", (ChatService chat, CurrentUser u, CancellationToken ct) => chat.ListRoomsAsync(u, ct));

        g.MapGet("/unread", async (ChatService chat, CurrentUser u, CancellationToken ct) =>
            Results.Ok(new { count = await chat.UnreadTotalAsync(u.PartnerId, ct) }));

        g.MapGet("/{roomId:guid}", async (Guid roomId, ChatService chat, CurrentUser u, CancellationToken ct) =>
            (await chat.GetRoomAsync(u, roomId, ct)).ToHttp());

        g.MapGet("/{roomId:guid}/messages", async (Guid roomId, long? before, long? after, int? limit, ChatService chat, CurrentUser u, CancellationToken ct) =>
            (await chat.GetMessagesAsync(u, roomId, before, after, limit ?? 50, ct)).ToHttp());

        g.MapPost("/{roomId:guid}/messages", async (Guid roomId, SendMessageRequest body, ChatService chat, CurrentUser u, CancellationToken ct) =>
            (await chat.SendAsync(u, body with { RoomId = roomId }, ct)).ToHttp());

        g.MapPost("/{roomId:guid}/read", async (Guid roomId, MarkReadRequest body, ChatService chat, CurrentUser u, CancellationToken ct) =>
            (await chat.MarkReadAsync(u, roomId, body.LastMessageId, ct)).ToHttp(_ => Results.NoContent()));

        g.MapGet("/{roomId:guid}/members", async (Guid roomId, ChatService chat, CurrentUser u, CancellationToken ct) =>
            (await chat.MembersAsync(u, roomId, ct)).ToHttp());

        g.MapPatch("/{roomId:guid}", async (Guid roomId, RoomSettingsRequest body, ChatService chat, CurrentUser u, CancellationToken ct) =>
            (await chat.UpdateRoomAsync(u, roomId, body, ct)).ToHttp());

        g.MapPost("/{roomId:guid}/mute", async (Guid roomId, MuteRequest body, ChatService chat, CurrentUser u, CancellationToken ct) =>
            (await chat.MuteAsync(u, roomId, body, ct)).ToHttp());

        g.MapPut("/{roomId:guid}/notifications", async (Guid roomId, MemberPrefsRequest body, ChatService chat, CurrentUser u, CancellationToken ct) =>
            (await chat.SetNotifyAsync(u, roomId, body.Notify, ct)).ToHttp(_ => Results.NoContent()));

        g.MapPost("/questions", async (OpenQuestionRequest body, ChatService chat, CurrentUser u, CancellationToken ct) =>
            (await chat.OpenQuestionAsync(u, body.EventId, ct)).ToHttp(id => Results.Ok(new { roomId = id })));

        g.MapPost("/messages/{messageId:long}/report", async (long messageId, ReportRequest body, ChatService chat, CurrentUser u, CancellationToken ct) =>
            (await chat.ReportAsync(u, messageId, body.Reason, ct)).ToHttp(_ => Results.NoContent()));

        g.MapPost("/{roomId:guid}/attachments", async (Guid roomId, IFormFile file, ChatService chat, CurrentUser u, CancellationToken ct) =>
            (await chat.UploadAsync(u, roomId, file, ct)).ToHttp())
            .DisableAntiforgery();

        g.MapGet("/attachments/{id:guid}", async (Guid id, [FromQuery] bool? download, ChatService chat, CurrentUser u, CancellationToken ct) =>
            (await chat.GetAttachmentAsync(u, id, ct)).ToHttp(a =>
                Results.File(File.OpenRead(a.StoragePath), a.ContentType, download == true || !a.ContentType.StartsWith("image/") ? a.FileName : null,
                    enableRangeProcessing: true)));
    }
}

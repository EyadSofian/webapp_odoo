using Engosoft.Learn.Api.Chat;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Notifications;
using Engosoft.Learn.Api.Odoo;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Engosoft.Learn.Api.Learning;

public static class LearningModule
{
    public static IServiceCollection AddLearningModule(this IServiceCollection services)
    {
        services.AddOptions<LearningOptions>().BindConfiguration(LearningOptions.Section);
        services.AddOptions<BunnyOptions>().BindConfiguration(BunnyOptions.Section);
        services.AddSingleton<BunnySigner>();
        services.AddScoped<LearningService>();
        return services;
    }

    public static void MapLearningEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api").RequireAuthorization().RequireRateLimiting("api");

        api.MapGet("/me", (LearningService s, CurrentUser u, CancellationToken ct) => s.GetProfileAsync(u, ct)).WithTags("Me");

        api.MapGet("/home", async (LearningService s, CurrentUser u, NotificationService notifications, ChatService chat,
            BackgroundJobQueue jobs, IMemoryCache cache, CancellationToken ct) =>
        {
            MembershipSync.QueueForUser(jobs, cache, u);
            var unreadNotifications = await notifications.UnreadCountAsync(u.PartnerId, ct);
            var unreadMessages = await chat.UnreadTotalAsync(u.PartnerId, ct);
            return Results.Ok(await s.GetHomeAsync(u, unreadNotifications, unreadMessages, ct));
        }).WithTags("Me");

        api.MapGet("/badges", async (CurrentUser u, NotificationService notifications, ChatService chat, CancellationToken ct) =>
            Results.Ok(new
            {
                messages = await chat.UnreadTotalAsync(u.PartnerId, ct),
                notifications = await notifications.UnreadCountAsync(u.PartnerId, ct),
            })).WithTags("Me");

        var live = api.MapGroup("/live-courses").WithTags("Live courses");
        live.MapGet("/", (LearningService s, CurrentUser u, CancellationToken ct) => s.GetLiveCoursesAsync(u, ct));
        live.MapGet("/{eventId:int}", async (int eventId, LearningService s, CurrentUser u, CancellationToken ct) =>
            (await s.GetLiveCourseAsync(u, eventId, ct)).ToHttp());

        var sessions = api.MapGroup("/sessions").WithTags("Live courses");
        sessions.MapGet("/{trackId:int}", async (int trackId, LearningService s, CurrentUser u, CancellationToken ct) =>
            (await s.GetSessionAsync(u, trackId, ct)).ToHttp());
        sessions.MapPost("/{trackId:int}/join", async (int trackId, LearningService s, CurrentUser u, ILogger<LearningService> log, CancellationToken ct) =>
        {
            var link = await s.GetJoinLinkAsync(u, trackId, ct);
            if (link.IsSuccess) log.LogInformation("Partner {Partner} opened the join link of session {Track}", u.PartnerId, trackId);
            return link.ToHttp();
        });

        api.MapGet("/documents/{documentId:int}", async (int documentId, LearningService s, CurrentUser u, CancellationToken ct) =>
            (await s.GetDocumentUrlAsync(u, documentId, ct)).ToHttp(url => Results.Ok(new { url }))).WithTags("Live courses");

        var courses = api.MapGroup("/courses").WithTags("Recorded courses");
        courses.MapGet("/", (LearningService s, CurrentUser u, CancellationToken ct) => s.GetRecordedCoursesAsync(u, ct));
        courses.MapGet("/{channelId:int}", async (int channelId, LearningService s, CurrentUser u, CancellationToken ct) =>
            (await s.GetRecordedCourseAsync(u, channelId, ct)).ToHttp());

        var lessons = api.MapGroup("/lessons").WithTags("Recorded courses");
        lessons.MapGet("/{slideId:int}", async (int slideId, LearningService s, CurrentUser u, CancellationToken ct) =>
            (await s.GetLessonAsync(u, slideId, ct)).ToHttp());
        lessons.MapGet("/{slideId:int}/file", async (int slideId, LearningService s, CurrentUser u, CancellationToken ct) =>
            (await s.GetLessonFileAsync(u, slideId, ct)).ToHttp(f => Results.File(f.Bytes, f.ContentType, f.FileName)));
        lessons.MapGet("/{slideId:int}/quiz", async (int slideId, LearningService s, CurrentUser u, CancellationToken ct) =>
            (await s.GetLessonQuizAsync(u, slideId, ct)).ToHttp());
        lessons.MapPost("/{slideId:int}/quiz", async (int slideId, LessonQuizSubmit body, LearningService s, CurrentUser u, CancellationToken ct) =>
            (await s.SubmitLessonQuizAsync(u, slideId, body, ct)).ToHttp());
        lessons.MapPost("/{slideId:int}/complete", async (int slideId, LearningService s, CurrentUser u, CancellationToken ct) =>
            (await s.CompleteLessonAsync(u, slideId, ct)).ToHttp(_ => Results.NoContent()));

        var certs = api.MapGroup("/certificates").WithTags("Certificates");
        certs.MapGet("/", (LearningService s, CurrentUser u, CancellationToken ct) => s.GetCertificatesAsync(u, ct));
        certs.MapGet("/{id:int}/image", async (int id, LearningService s, CurrentUser u, CancellationToken ct) =>
            (await s.GetCertificateImageAsync(u, id, ct)).ToHttp(f => Results.File(f.Bytes, f.ContentType, f.FileName)));

        // Images. Course covers are public on the website anyway; avatars only for people you share a group with.
        var media = api.MapGroup("/media").WithTags("Media");
        // Course art: the course's own image, else the image of the product it is sold as (where Engosoft keeps most artwork).
        media.MapGet("/courses/{channelId:int}/image", async (int channelId, IOdooClient odoo, IMemoryCache cache, HttpContext http, CancellationToken ct) =>
        {
            var bytes = await cache.GetOrCreateAsync($"img:channel:{channelId}", async e =>
            {
                e.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6);
                var rows = await odoo.ReadAsync("slide.channel", [channelId], ["image_512", "product_id"], ct);
                var ch = rows.FirstOrDefault();
                var b64 = ch.Str("image_512");
                if (string.IsNullOrEmpty(b64) && ch.M2O("product_id") is { } product)
                    b64 = (await odoo.ReadAsync("product.product", [product.Id], ["image_512"], ct)).FirstOrDefault().Str("image_512");
                return string.IsNullOrEmpty(b64) ? [] : Convert.FromBase64String(b64);
            });
            if (bytes is not { Length: > 0 }) return Results.NotFound();
            http.Response.Headers.CacheControl = "private, max-age=86400";
            return Results.File(bytes, Media.Sniff(bytes));
        });

        media.MapGet("/events/{eventId:int}/image", async (int eventId, IOdooClient odoo, IMemoryCache cache, HttpContext http, CancellationToken ct) =>
        {
            var bytes = await cache.GetOrCreateAsync($"img:event:{eventId}", async e =>
            {
                e.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6);
                var ev = (await odoo.ReadAsync("event.event", [eventId], ["course_id", "product_name"], ct)).FirstOrDefault();
                string? b64 = null;
                if (ev.M2O("course_id") is { } course)
                {
                    var ch = (await odoo.ReadAsync("slide.channel", [course.Id], ["image_512", "product_id"], ct)).FirstOrDefault();
                    b64 = ch.Str("image_512");
                    if (string.IsNullOrEmpty(b64) && ch.M2O("product_id") is { } p)
                        b64 = (await odoo.ReadAsync("product.product", [p.Id], ["image_512"], ct)).FirstOrDefault().Str("image_512");
                }
                if (string.IsNullOrEmpty(b64) && ev.M2O("product_name") is { } product)
                    b64 = (await odoo.ReadAsync("product.product", [product.Id], ["image_512"], ct)).FirstOrDefault().Str("image_512");
                return string.IsNullOrEmpty(b64) ? [] : Convert.FromBase64String(b64);
            });
            if (bytes is not { Length: > 0 }) return Results.NotFound();
            http.Response.Headers.CacheControl = "private, max-age=86400";
            return Results.File(bytes, Media.Sniff(bytes));
        });

        media.MapGet("/partners/{partnerId:int}/avatar", async (int partnerId, CurrentUser u, AppDbContext db, IOdooClient odoo,
            IMemoryCache cache, HttpContext http, CancellationToken ct) =>
        {
            if (partnerId != u.PartnerId)
            {
                var shares = await db.Members.Where(m => m.PartnerId == u.PartnerId && m.RemovedAt == null)
                    .AnyAsync(m => db.Members.Any(o => o.RoomId == m.RoomId && o.PartnerId == partnerId && o.RemovedAt == null), ct);
                if (!shares) return Results.NotFound();
            }
            var bytes = await cache.GetOrCreateAsync($"img:partner:{partnerId}", async e =>
            {
                e.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6);
                var rows = await odoo.ReadAsync("res.partner", [partnerId], ["avatar_128"], ct);
                var b64 = rows.FirstOrDefault().Str("avatar_128");
                return string.IsNullOrEmpty(b64) ? [] : Convert.FromBase64String(b64);
            });
            if (bytes is not { Length: > 0 }) return Results.NotFound();
            var type = Media.Sniff(bytes);
            // Odoo draws an SVG initial for people without a photo; the app draws its own, so skip those.
            if (type == "image/svg+xml") return Results.NotFound();
            http.Response.Headers.CacheControl = "private, max-age=21600";
            return Results.File(bytes, type);
        });
    }
}

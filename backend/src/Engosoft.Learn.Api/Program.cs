using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Engosoft.Learn.Api.Assessments;
using Engosoft.Learn.Api.Auth;
using Engosoft.Learn.Api.Chat;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Learning;
using Engosoft.Learn.Api.Notifications;
using Engosoft.Learn.Api.Odoo;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);
var services = builder.Services;

services.AddSingleton(TimeProvider.System);
services.AddMemoryCache();
services.AddProblemDetails();
services.AddExceptionHandler<UpstreamExceptionHandler>();
services.AddOpenApi();
services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
});

// Hosts like Railway give the database as DATABASE_URL (postgres://user:pass@host:port/db); Npgsql wants key=value.
if (string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString("Default"))
    && Environment.GetEnvironmentVariable("DATABASE_URL") is { Length: > 0 } databaseUrl)
    builder.Configuration["ConnectionStrings:Default"] = PostgresUrl.ToConnectionString(databaseUrl);

services.AddDbContext<AppDbContext>((sp, o) =>
    o.UseNpgsql(sp.GetRequiredService<IConfiguration>().GetConnectionString("Default") is { Length: > 0 } cs
                ? cs : throw new InvalidOperationException("ConnectionStrings:Default is not set.")));

services.AddOptions<OdooOptions>().BindConfiguration(OdooOptions.Section);
services.AddHttpClient<IOdooClient, OdooClient>((sp, http) =>
{
    var o = sp.GetRequiredService<IOptions<OdooOptions>>().Value;
    http.BaseAddress = new Uri(o.Url.TrimEnd('/') + "/");
    http.Timeout = TimeSpan.FromSeconds(o.TimeoutSeconds);
    http.DefaultRequestHeaders.UserAgent.ParseAdd("EngosoftLearn/1.0");
});

services.AddSingleton<BackgroundJobQueue>();
services.AddSingleton<KeyedLocks>();
services.AddHostedService<BackgroundJobWorker>();
services.AddCurrentUser();

services.AddAuthModule();
services.AddLearningModule();
services.AddChatModule();
services.AddNotificationsModule();
services.AddAssessmentsModule();
services.AddSignalR().AddJsonProtocol(o =>
    o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));

services.AddCors(o => o.AddDefaultPolicy(p =>
{
    var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [];
    if (origins.Length > 0) p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
}));

services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = async (ctx, ct) =>
    {
        if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
            ctx.HttpContext.Response.Headers.RetryAfter = ((int)retry.TotalSeconds).ToString();
        await ctx.HttpContext.Response.WriteAsJsonAsync(new { title = "rate_limited", detail = "طلبات كثيرة متتالية. انتظر قليلًا ثم أعد المحاولة." }, ct);
    };
    // Sign-in: per address, to slow down password guessing.
    o.AddPolicy("login", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    // AI quiz generation costs money and minutes: a few per person per hour.
    o.AddPolicy("ai", http => RateLimitPartition.GetFixedWindowLimiter(
        http.User.FindFirst(CurrentUser.ClaimPartner)?.Value ?? "anon",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
    // API: per signed-in person.
    o.AddPolicy("api", http => RateLimitPartition.GetTokenBucketLimiter(
        http.User.FindFirst(CurrentUser.ClaimPartner)?.Value ?? http.Connection.RemoteIpAddress?.ToString() ?? "anon",
        _ => new TokenBucketRateLimiterOptions { TokenLimit = 120, TokensPerPeriod = 60, ReplenishmentPeriod = TimeSpan.FromSeconds(10), QueueLimit = 0 }));
});

services.AddHealthChecks()
    .AddCheck<DatabaseHealthCheck>("database")
    .AddCheck<OdooHealthCheck>("odoo");

services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

var app = builder.Build();

if (app.Configuration.GetValue("Database:AutoMigrate", true))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

app.UseForwardedHeaders();
app.Use((http, next) =>
{
    var h = http.Response.Headers;
    h.XContentTypeOptions = "nosniff";
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    h["X-Frame-Options"] = "SAMEORIGIN";
    h["Permissions-Policy"] = "camera=(), geolocation=(), payment=()";
    if (!app.Environment.IsDevelopment()) h.StrictTransportSecurity = "max-age=31536000; includeSubDomains";
    return next(http);
});
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseCors();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

if (app.Environment.IsDevelopment()) app.MapOpenApi();

app.MapHealthChecks("/health");
app.MapGet("/alive", () => Results.Ok(new { status = "alive" })).AllowAnonymous();

app.MapAuthEndpoints();
app.MapLearningEndpoints();
app.MapChatEndpoints();
app.MapNotificationEndpoints();
app.MapAssessmentEndpoints();

// The built web app (web/dist) can be served from wwwroot, so one deployment serves app and API.
if (Directory.Exists(Path.Combine(app.Environment.ContentRootPath, "wwwroot")))
{
    app.UseDefaultFiles();
    app.UseStaticFiles(new StaticFileOptions
    {
        // Hashed bundles never change; the page, service worker and manifest must always be fresh so updates reach people.
        OnPrepareResponse = c => c.Context.Response.Headers.CacheControl =
            c.Context.Request.Path.StartsWithSegments("/assets") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    app.MapFallbackToFile("index.html", new StaticFileOptions
    {
        OnPrepareResponse = c => c.Context.Response.Headers.CacheControl = "no-cache",
    }).AllowAnonymous();
}

app.Run();

/// <summary>Odoo being down is not our bug: answer 503 with a message the learner can act on.</summary>
internal sealed class UpstreamExceptionHandler(ILogger<UpstreamExceptionHandler> log) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception ex, CancellationToken ct)
    {
        IResult? result = ex switch
        {
            OdooException or HttpRequestException or TaskCanceledException when !ct.IsCancellationRequested => Error.Upstream().ToProblem(),
            UnauthorizedAccessException => Error.Unauthorized("session", "سجّل الدخول مرة أخرى.").ToProblem(),
            _ => null,
        };
        if (result is null) return false;
        log.LogWarning(ex, "Upstream failure on {Path}", http.Request.Path);
        await result.ExecuteAsync(http);
        return true;
    }
}

internal sealed class DatabaseHealthCheck(AppDbContext db) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default) =>
        await db.Database.CanConnectAsync(ct) ? HealthCheckResult.Healthy() : HealthCheckResult.Unhealthy("Cannot reach PostgreSQL. Start it with: docker compose up -d db");
}

internal sealed class OdooHealthCheck(IOdooClient odoo) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        try
        {
            await odoo.ExecuteAsync("res.users", "search_count", [Array.Empty<object>()], null, ct);
            return HealthCheckResult.Healthy();
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Degraded("Odoo is unreachable or the integration user is not configured (Odoo:IntegrationUid, Odoo:ApiKey).", ex);
        }
    }
}

internal static class PostgresUrl
{
    public static string ToConnectionString(string url)
    {
        var uri = new Uri(url);
        var userInfo = uri.UserInfo.Split(':', 2);
        var b = new Npgsql.NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
        };
        return b.ConnectionString;
    }
}

public partial class Program;

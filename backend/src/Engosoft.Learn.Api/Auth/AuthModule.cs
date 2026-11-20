using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Engosoft.Learn.Api.Common;
using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Odoo;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using static Engosoft.Learn.Api.Odoo.OdooClientExtensions;

namespace Engosoft.Learn.Api.Auth;

public sealed class AuthOptions
{
    public const string Section = "Auth";
    public string Issuer { get; set; } = "engosoft-learn";
    public string Audience { get; set; } = "engosoft-learn-app";
    /// <summary>HMAC key, at least 32 bytes. From user secrets or the environment, never committed.</summary>
    public string SigningKey { get; set; } = "";
    public int AccessTokenMinutes { get; set; } = 30;
    public int RefreshTokenDays { get; set; } = 30;
    /// <summary>Internal Odoo users allowed in as admins (partner ids), besides instructors.</summary>
    public int[] AdminPartnerIds { get; set; } = [];
}

public sealed class DevOptions
{
    public const string Section = "Dev";
    /// <summary>Development only: sign in as an existing Odoo partner without a password, to test with real data.</summary>
    public bool AllowImpersonation { get; set; }
}

public sealed record LoginRequest(string Email, string Password);
public sealed record RefreshRequest(string RefreshToken);
public sealed record ImpersonateRequest(int PartnerId);
public sealed record SessionUser(int PartnerId, string Name, string Kind, string? Email, string Lang);
public sealed record TokenResponse(string AccessToken, DateTime ExpiresAt, string RefreshToken, SessionUser User);

/// <summary>Decides whether an Odoo user may use the app, and as what.</summary>
public sealed class IdentityResolver(IOdooClient odoo, IOptions<AuthOptions> auth)
{
    public async Task<Result<(CurrentUser User, string? Email, string Lang)>> ResolveAsync(int uid, CancellationToken ct)
    {
        var users = await odoo.ReadAsync("res.users", [uid], ["name", "partner_id", "share", "active", "login", "lang"], ct);
        if (users.Count == 0 || !users[0].Bool("active"))
            return Error.Forbidden("inactive", "هذا الحساب غير متاح. تواصل مع الدعم الفني.");

        var u = users[0];
        var partner = u.M2O("partner_id")!.Value;
        var name = u.Str("name") ?? partner.Name;
        var lang = (u.Str("lang") ?? "ar_001").StartsWith("en") ? "en" : "ar";
        var email = u.Str("login");

        if (u.Bool("share"))
            return (new CurrentUser(uid, partner.Id, name, UserKind.Student), email, lang);

        if (auth.Value.AdminPartnerIds.Contains(partner.Id))
            return (new CurrentUser(uid, partner.Id, name, UserKind.Admin), email, lang);

        var isInstructor = await odoo.SearchCountAsync("hr.employee", D(("user_id", "=", uid), ("is_instructor", "=", true)), ct) > 0;
        if (isInstructor)
            return (new CurrentUser(uid, partner.Id, name, UserKind.Instructor), email, lang);

        // Engosoft staff who are themselves enrolled (a live seat or a recorded course) use the app as learners.
        var enrolled = await odoo.SearchCountAsync("event.registration", D(("partner_id", "=", partner.Id), ("state", "in", new[] { "open", "done" })), ct) > 0
                       || await odoo.SearchCountAsync("slide.channel.partner", D(("partner_id", "=", partner.Id)), ct) > 0;
        if (enrolled)
            return (new CurrentUser(uid, partner.Id, name, UserKind.Student), email, lang);

        return Error.Forbidden("not_allowed", "هذا التطبيق مخصص للمتدربين والمحاضرين. لا توجد دورات مسجّلة على هذا الحساب.");
    }
}

public sealed class TokenService(IOptions<AuthOptions> options, AppDbContext db, TimeProvider clock)
{
    public static SymmetricSecurityKey Key(AuthOptions o) => new(Encoding.UTF8.GetBytes(o.SigningKey));

    public async Task<TokenResponse> IssueAsync(CurrentUser user, string? email, string lang, string? userAgent, CancellationToken ct)
    {
        var o = options.Value;
        var now = clock.GetUtcNow().UtcDateTime;
        var expires = now.AddMinutes(o.AccessTokenMinutes);

        var claims = new[]
        {
            new Claim(CurrentUser.ClaimUid, user.Uid.ToString()),
            new Claim(CurrentUser.ClaimPartner, user.PartnerId.ToString()),
            new Claim(CurrentUser.ClaimName, user.Name),
            new Claim(CurrentUser.ClaimKind, user.Kind.ToString().ToLowerInvariant()),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
        };
        var access = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = o.Issuer,
            Audience = o.Audience,
            IssuedAt = now,
            NotBefore = now,
            Expires = expires,
            Subject = new ClaimsIdentity(claims),
            SigningCredentials = new SigningCredentials(Key(o), SecurityAlgorithms.HmacSha256),
        });

        var refresh = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        db.RefreshTokens.Add(new RefreshToken
        {
            Uid = user.Uid,
            PartnerId = user.PartnerId,
            Name = user.Name,
            Kind = user.Kind.ToString(),
            TokenHash = Hash(refresh),
            CreatedAt = now,
            ExpiresAt = now.AddDays(o.RefreshTokenDays),
            UserAgent = userAgent?.Length > 500 ? userAgent[..500] : userAgent,
        });
        await db.SaveChangesAsync(ct);

        return new TokenResponse(access, expires, refresh,
            new SessionUser(user.PartnerId, user.Name, user.Kind.ToString().ToLowerInvariant(), email, lang));
    }

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}

public static class AuthModule
{
    public static IServiceCollection AddAuthModule(this IServiceCollection services)
    {
        services.AddOptions<AuthOptions>().BindConfiguration(AuthOptions.Section)
            .Validate(o => Encoding.UTF8.GetByteCount(o.SigningKey) >= 32, "Auth:SigningKey must be at least 32 bytes.")
            .ValidateOnStart();
        services.AddOptions<DevOptions>().BindConfiguration(DevOptions.Section);
        services.AddScoped<IdentityResolver>();
        services.AddScoped<TokenService>();

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<IOptions<AuthOptions>>((o, auth) =>
            {
                var a = auth.Value;
                o.MapInboundClaims = false;
                o.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = a.Issuer,
                    ValidAudience = a.Audience,
                    IssuerSigningKey = TokenService.Key(a),
                    ValidateIssuerSigningKey = true,
                    ClockSkew = TimeSpan.FromSeconds(30),
                    NameClaimType = CurrentUser.ClaimName,
                };
                o.Events = new JwtBearerEvents
                {
                    // SignalR sends the token in the query string for WebSockets.
                    OnMessageReceived = c =>
                    {
                        var token = c.Request.Query["access_token"];
                        if (!string.IsNullOrEmpty(token) && c.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                            c.Token = token;
                        return Task.CompletedTask;
                    }
                };
            });
        services.AddAuthorization();
        return services;
    }

    public static void MapAuthEndpoints(this WebApplication app)
    {
        var g = app.MapGroup("/api/auth").WithTags("Auth");

        g.MapPost("/login", async (LoginRequest body, IOdooClient odoo, IdentityResolver identity, TokenService tokens,
            HttpContext http, ILogger<TokenService> log, CancellationToken ct) =>
        {
            var email = body.Email?.Trim().ToLowerInvariant() ?? "";
            if (email.Length is < 3 or > 254 || string.IsNullOrEmpty(body.Password) || body.Password.Length > 256)
                return Error.Validation("invalid_input", "اكتب البريد الإلكتروني وكلمة المرور.").ToProblem();

            int? uid;
            try { uid = await odoo.AuthenticateAsync(email, body.Password, ct); }
            catch (Exception ex) when (ex is HttpRequestException or OdooException or TaskCanceledException)
            {
                log.LogError(ex, "Odoo authentication call failed");
                return Error.Upstream().ToProblem();
            }
            if (uid is null)
                return Error.Unauthorized("bad_credentials", "البريد الإلكتروني أو كلمة المرور غير صحيحة.").ToProblem();

            var resolved = await identity.ResolveAsync(uid.Value, ct);
            if (!resolved.IsSuccess) return resolved.Error!.ToProblem();
            var (user, mail, lang) = resolved.Value;
            return Results.Ok(await tokens.IssueAsync(user, mail, lang, http.Request.Headers.UserAgent, ct));
        }).RequireRateLimiting("login").AllowAnonymous();

        g.MapPost("/refresh", async (RefreshRequest body, AppDbContext db, IdentityResolver identity, TokenService tokens,
            TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.RefreshToken))
                return Error.Unauthorized("invalid_refresh", "سجّل الدخول مرة أخرى.").ToProblem();
            var hash = TokenService.Hash(body.RefreshToken);
            var now = clock.GetUtcNow().UtcDateTime;
            var stored = await db.RefreshTokens.SingleOrDefaultAsync(t => t.TokenHash == hash, ct);
            if (stored is null || stored.ExpiresAt < now)
                return Error.Unauthorized("invalid_refresh", "سجّل الدخول مرة أخرى.").ToProblem();
            if (stored.RevokedAt is not null)
            {
                // Two tabs refreshing at the same moment: the loser gets a plain 401 and picks up the winner's tokens.
                if (stored.ReplacedById is not null && now - stored.RevokedAt.Value < TimeSpan.FromSeconds(60))
                    return Error.Unauthorized("invalid_refresh", "سجّل الدخول مرة أخرى.").ToProblem();
                // A rotated token came back later: treat it as stolen and end every session of this user.
                await db.RefreshTokens.Where(t => t.PartnerId == stored.PartnerId && t.RevokedAt == null)
                    .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
                return Error.Unauthorized("invalid_refresh", "سجّل الدخول مرة أخرى.").ToProblem();
            }

            // Re-check in Odoo on every refresh so a deactivated account loses access within one token lifetime.
            var resolved = await identity.ResolveAsync(stored.Uid, ct);
            if (!resolved.IsSuccess)
            {
                stored.RevokedAt = now;
                await db.SaveChangesAsync(ct);
                return resolved.Error!.ToProblem();
            }
            var (user, mail, lang) = resolved.Value;
            stored.RevokedAt = now;
            var issued = await tokens.IssueAsync(user, mail, lang, http.Request.Headers.UserAgent, ct);
            stored.ReplacedById = (await db.RefreshTokens.SingleAsync(t => t.TokenHash == TokenService.Hash(issued.RefreshToken), ct)).Id;
            await db.SaveChangesAsync(ct);
            return Results.Ok(issued);
        }).RequireRateLimiting("login").AllowAnonymous();

        g.MapPost("/logout", async (RefreshRequest body, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            var hash = TokenService.Hash(body.RefreshToken ?? "");
            await db.RefreshTokens.Where(t => t.TokenHash == hash && t.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, clock.GetUtcNow().UtcDateTime), ct);
            return Results.NoContent();
        }).AllowAnonymous();

        if (app.Environment.IsDevelopment())
        {
            app.MapPost("/api/dev/login-as", async (ImpersonateRequest body, IOptions<DevOptions> dev, IOdooClient odoo,
                IdentityResolver identity, TokenService tokens, HttpContext http, CancellationToken ct) =>
            {
                if (!dev.Value.AllowImpersonation) return Results.NotFound();
                var users = await odoo.SearchReadAsync("res.users", D(("partner_id", "=", body.PartnerId)), ["id"], limit: 1, ct: ct);
                if (users.Count == 0) return Error.NotFound("no_user", "لا يوجد مستخدم لهذا الشريك.").ToProblem();
                var resolved = await identity.ResolveAsync(users[0].Id(), ct);
                if (!resolved.IsSuccess) return resolved.Error!.ToProblem();
                var (user, mail, lang) = resolved.Value;
                return Results.Ok(await tokens.IssueAsync(user, mail, lang, http.Request.Headers.UserAgent, ct));
            }).WithTags("Dev").AllowAnonymous();
        }
    }
}

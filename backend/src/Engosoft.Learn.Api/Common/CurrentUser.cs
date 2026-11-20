using System.Security.Claims;

namespace Engosoft.Learn.Api.Common;

public enum UserKind { Student, Instructor, Admin }

/// <summary>The caller, taken only from the validated token. Never from route, query or body.</summary>
public sealed record CurrentUser(int Uid, int PartnerId, string Name, UserKind Kind)
{
    public const string ClaimUid = "sub";
    public const string ClaimPartner = "pid";
    public const string ClaimName = "name";
    public const string ClaimKind = "kind";

    public bool IsStaff => Kind is UserKind.Instructor or UserKind.Admin;

    public static CurrentUser? From(ClaimsPrincipal? principal)
    {
        if (principal?.Identity?.IsAuthenticated != true) return null;
        if (!int.TryParse(principal.FindFirstValue(ClaimUid), out var uid)) return null;
        if (!int.TryParse(principal.FindFirstValue(ClaimPartner), out var pid)) return null;
        if (!Enum.TryParse<UserKind>(principal.FindFirstValue(ClaimKind), true, out var kind)) return null;
        return new CurrentUser(uid, pid, principal.FindFirstValue(ClaimName) ?? "", kind);
    }
}

public static class CurrentUserExtensions
{
    /// <summary>Resolves the caller once per request; rejects authenticated tokens that lack our claims.</summary>
    public static IServiceCollection AddCurrentUser(this IServiceCollection services)
    {
        services.AddHttpContextAccessor();
        services.AddScoped(sp =>
        {
            var http = sp.GetRequiredService<IHttpContextAccessor>().HttpContext;
            return CurrentUser.From(http?.User)
                   ?? throw new UnauthorizedAccessException("Token is missing learner claims.");
        });
        return services;
    }
}

using System.Text.Json;
using Engosoft.Learn.Api.Odoo;

namespace Engosoft.Learn.Api.Learning;

/// <summary>
/// Who holds a seat on a live course. Staff sometimes add a registration in Odoo with only a name and an email and no
/// contact. Such a seat belongs to the person whose Odoo login is that email: logins are unique and a learner cannot
/// change theirs from the portal (the contact email they can change is never used for this).
/// </summary>
public static class Seats
{
    public static readonly string[] ValidStates = ["open", "done"];

    public static string? Normalize(string? email) => string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();

    /// <summary>LIKE treats _ and % as wildcards (an email like a_b@x.com would match axb@x.com): escape them.</summary>
    public static string EscapeLike(string value) => value.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    /// <summary>The caller's seats in a valid state: on their contact, or with no contact and their login as the email.</summary>
    public static object[] MineDomain(int partnerId, string? login)
    {
        var states = new object?[] { "state", "in", ValidStates };
        if (Normalize(login) is not { } email)
            return [new object?[] { "partner_id", "=", partnerId }, states];
        return
        [
            "|", new object?[] { "partner_id", "=", partnerId },
            "&", new object?[] { "partner_id", "=", false }, new object?[] { "email", "=ilike", EscapeLike(email) },
            states,
        ];
    }

    /// <summary>Exact check after Odoo's case-insensitive match: the seat's contact, or no contact and exactly this login.</summary>
    public static bool BelongsTo(JsonElement reg, int partnerId, string? login) =>
        reg.M2O("partner_id") is { } p ? p.Id == partnerId : Normalize(login) is { } l && Normalize(reg.Str("email")) == l;

    /// <summary>The person behind each registration: its contact, or the user whose login is its email. Unmatched ones are left out.</summary>
    public static async Task<List<(JsonElement Reg, int PartnerId, string Name)>> ResolveAsync(
        IOdooClient odoo, IReadOnlyCollection<JsonElement> regs, CancellationToken ct)
    {
        var byLogin = await PartnersByLoginAsync(odoo, regs.Where(r => r.M2O("partner_id") is null).Select(r => r.Str("email")), ct);
        var result = new List<(JsonElement, int, string)>(regs.Count);
        foreach (var r in regs)
        {
            if (r.M2O("partner_id") is { } p) result.Add((r, p.Id, p.Name));
            else if (Normalize(r.Str("email")) is { } e && byLogin.TryGetValue(e, out var u)) result.Add((r, u.Id, u.Name));
        }
        return result;
    }

    /// <summary>Seats in a valid state on these courses held by any of these people (by contact, or by login for contact-less seats).</summary>
    public static async Task<List<(JsonElement Reg, int PartnerId, string Name)>> OfPeopleAsync(
        IOdooClient odoo, IReadOnlyCollection<int> eventIds, IReadOnlyCollection<int> partnerIds, CancellationToken ct)
    {
        if (eventIds.Count == 0 || partnerIds.Count == 0) return [];
        object[] domain =
        [
            new object?[] { "event_id", "in", eventIds.ToArray() },
            new object?[] { "state", "in", ValidStates },
            "|", new object?[] { "partner_id", "in", partnerIds.ToArray() }, new object?[] { "partner_id", "=", false },
        ];
        var regs = await odoo.SearchReadAsync("event.registration", domain, ["event_id", "partner_id", "email", "state", "access_expiration_date"], ct: ct);
        var people = partnerIds.ToHashSet();
        return (await ResolveAsync(odoo, regs, ct)).Where(s => people.Contains(s.PartnerId)).ToList();
    }

    public static async Task<Dictionary<string, (int Id, string Name)>> PartnersByLoginAsync(
        IOdooClient odoo, IEnumerable<string?> emails, CancellationToken ct)
    {
        var wanted = emails.Select(Normalize).OfType<string>().Distinct().ToArray();
        var map = new Dictionary<string, (int Id, string Name)>();
        if (wanted.Length == 0) return map;
        var domain = new List<object>();
        for (var i = 1; i < wanted.Length; i++) domain.Add("|");
        domain.AddRange(wanted.Select(e => (object)new object?[] { "login", "=ilike", EscapeLike(e) }));
        foreach (var u in await odoo.SearchReadAsync("res.users", domain.ToArray(), ["login", "partner_id"], ct: ct))
            if (Normalize(u.Str("login")) is { } l && wanted.Contains(l) && u.M2O("partner_id") is { } p)
                map[l] = p;
        return map;
    }
}

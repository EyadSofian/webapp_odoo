using System.Text.Json;
using Engosoft.Learn.Api.Auth;
using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Learning;
using Engosoft.Learn.Api.Odoo;

namespace Engosoft.Learn.Tests;

public class SeatsTests
{
    private static JsonElement Reg(string json) => JsonDocument.Parse(json).RootElement;

    [Fact]
    public void A_seat_with_a_contact_belongs_only_to_that_contact()
    {
        var reg = Reg("""{"id":1,"partner_id":[1001,"Learner"],"email":"someone@else.com"}""");
        Assert.True(Seats.BelongsTo(reg, 1001, "learner.two@example.com"));
        Assert.False(Seats.BelongsTo(reg, 5, "someone@else.com"));
    }

    [Fact]
    public void A_seat_without_a_contact_belongs_to_the_user_whose_login_is_its_email()
    {
        // Added in Odoo's backend with a name and an email only, no contact.
        var reg = Reg("""{"id":2,"partner_id":false,"email":" Learner.One@Example.com "}""");
        Assert.True(Seats.BelongsTo(reg, 1001, "learner.one@example.com"));
        Assert.False(Seats.BelongsTo(reg, 1001, "other@example.com"));
        Assert.False(Seats.BelongsTo(reg, 1001, null));
    }

    [Fact]
    public void Like_wildcards_in_emails_are_escaped()
    {
        Assert.Equal(@"a\_b\%c@x.com", Seats.EscapeLike("a_b%c@x.com"));
    }

    [Fact]
    public void The_domain_asks_for_the_contact_or_a_contactless_seat_with_the_login()
    {
        var plain = new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
        var json = JsonSerializer.Serialize(Seats.MineDomain(7, "A_B@x.com"), plain);
        Assert.Equal("""["|",["partner_id","=",7],"&",["partner_id","=",false],["email","=ilike","a\\_b@x.com"],["state","in",["open","done"]]]""", json);
        Assert.Equal("""[["partner_id","=",7],["state","in",["open","done"]]]""", JsonSerializer.Serialize(Seats.MineDomain(7, null), plain));
    }

    [Fact]
    public async Task Contactless_seats_resolve_to_the_matching_login_and_unknown_emails_are_left_out()
    {
        var odoo = new UsersOdoo("""[{"id":2801,"login":"Learner.Two@Example.com","partner_id":[1001,"Learner"]},{"id":9,"login":"learnerxtwo@example.com","partner_id":[9,"wildcard match"]}]""");
        var regs = new[]
        {
            Reg("""{"id":1,"partner_id":[10,"Has contact"],"email":false}"""),
            Reg("""{"id":2,"partner_id":false,"email":"learner.two@example.com"}"""),
            Reg("""{"id":3,"partner_id":false,"email":"nobody@example.com"}"""),
        };
        var resolved = await Seats.ResolveAsync(odoo, regs, CancellationToken.None);
        Assert.Equal(new[] { (10, "Has contact"), (1001, "Learner") }, resolved.Select(r => (r.PartnerId, r.Name)).ToArray());
        Assert.Equal("res.users", odoo.LastModel);
    }

    private sealed class UsersOdoo(string usersJson) : IOdooClient
    {
        public string? LastModel { get; private set; }

        public Task<JsonElement> ExecuteAsync(string model, string method, object?[] args, object? kwargs = null, CancellationToken ct = default)
        {
            LastModel = model;
            return Task.FromResult(JsonDocument.Parse(usersJson).RootElement);
        }

        public Task<int?> AuthenticateAsync(string login, string password, CancellationToken ct = default) => Task.FromResult<int?>(null);
    }
}

public class RefreshRulesTests
{
    private static readonly DateTime Now = new(2026, 11, 21, 21, 30, 0, DateTimeKind.Utc);

    [Fact]
    public void A_lost_answer_is_reissued_instead_of_signing_the_person_out()
    {
        // The phone sent A, we answered with B, iOS suspended the app before it saved B. A comes back; B was never used.
        var b = new RefreshToken();
        var a = new RefreshToken { RevokedAt = Now.AddMinutes(-40), ReplacedById = b.Id };
        Assert.Equal(ReuseVerdict.Reissue, RefreshRules.OnReuse(a, b));
    }

    [Fact]
    public void A_second_copy_ends_that_sign_in_only()
    {
        var b = new RefreshToken { RevokedAt = Now.AddMinutes(-5), ReplacedById = Guid.NewGuid() };
        var a = new RefreshToken { RevokedAt = Now.AddMinutes(-40), ReplacedById = b.Id };
        Assert.Equal(ReuseVerdict.RevokeChain, RefreshRules.OnReuse(a, b));
    }

    [Fact]
    public void A_signed_out_token_is_rejected()
    {
        Assert.Equal(ReuseVerdict.Reject, RefreshRules.OnReuse(new RefreshToken { RevokedAt = Now }, null));
    }
}

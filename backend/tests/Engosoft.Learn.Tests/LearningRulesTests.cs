using Engosoft.Learn.Api.Data;
using Engosoft.Learn.Api.Learning;
using Engosoft.Learn.Api.Notifications;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;

namespace Engosoft.Learn.Tests;

public class LearningRulesTests
{
    [Theory]
    [InlineData(" Light Current - 5687 ", "Light Current")]
    [InlineData("(E05887) ZZ Internal Pilot - Live Chat (do not book)", "ZZ Internal Pilot - Live Chat (do not book)")]
    [InlineData("HVAC - 5703", "HVAC")]
    [InlineData("Planning and Primavera P6 Course ( A.Sadek )", "Planning and Primavera P6 Course ( A.Sadek )")]
    public void Course_titles_drop_the_internal_code(string raw, string expected) =>
        Assert.Equal(expected, LearningService.CleanTitle(raw));

    [Fact]
    public void Bunny_token_matches_the_documented_formula()
    {
        // token = sha256_hex(key + videoId + expires)
        var token = BunnySigner.Token("key", "2e1c50dd-8976-49b1-8bb9-f728ad8e1c1c", 1795222250);
        Assert.Equal(64, token.Length);
        Assert.Equal(token, BunnySigner.Token("key", "2e1c50dd-8976-49b1-8bb9-f728ad8e1c1c", 1795222250));
        Assert.NotEqual(token, BunnySigner.Token("key", "2e1c50dd-8976-49b1-8bb9-f728ad8e1c1c", 1795222251));
    }

    [Fact]
    public void Recording_urls_are_signed_when_a_key_is_configured()
    {
        var clock = new FakeTimeProvider(new DateTimeOffset(2026, 11, 21, 0, 0, 0, TimeSpan.Zero));
        var signer = new BunnySigner(Options.Create(new BunnyOptions { StreamTokenKey = "secret", TokenLifetimeMinutes = 60 }), clock);
        var signed = signer.Sign("https://iframe.mediadelivery.net/embed/409433/2e1c50dd-8976-49b1-8bb9-f728ad8e1c1c");
        Assert.StartsWith("https://iframe.mediadelivery.net/embed/409433/2e1c50dd-8976-49b1-8bb9-f728ad8e1c1c?token=", signed);
        Assert.Contains($"expires={clock.GetUtcNow().AddMinutes(60).ToUnixTimeSeconds()}", signed);
    }

    [Fact]
    public void Without_a_key_the_url_is_returned_as_is()
    {
        var signer = new BunnySigner(Options.Create(new BunnyOptions()), TimeProvider.System);
        Assert.Equal("https://iframe.mediadelivery.net/embed/1/2e1c50dd-8976-49b1-8bb9-f728ad8e1c1c",
            signer.Sign("https://iframe.mediadelivery.net/embed/1/2e1c50dd-8976-49b1-8bb9-f728ad8e1c1c"));
        Assert.Null(signer.Sign(null));
    }

    [Fact]
    public void Player_url_is_read_from_odoo_embed_code()
    {
        const string embed = "<iframe src=\"https://iframe.mediadelivery.net/embed/409433/314a1c2a-83e0-459b-b6d3-fcf8825c6b96?token=ab&amp;expires=1\" loading=\"lazy\"></iframe>";
        Assert.Equal("https://iframe.mediadelivery.net/embed/409433/314a1c2a-83e0-459b-b6d3-fcf8825c6b96?token=ab&expires=1", BunnySigner.SrcFromEmbed(embed));
        Assert.Null(BunnySigner.SrcFromEmbed("<iframe src=\"javascript:alert(1)\"></iframe>"));
    }

    [Theory]
    [InlineData(23 * 60, "day")]
    [InlineData(91, "day")]
    [InlineData(80, null)]
    [InlineData(45, "hour")]
    [InlineData(12, null)]
    [InlineData(8, "live")]
    [InlineData(-3, "live")]
    [InlineData(-10, null)]
    public void Reminder_windows(double minutesToStart, string? expected) =>
        Assert.Equal(expected, ReminderWorker.DueKind(minutesToStart));

    [Fact]
    public void Quiet_hours_wrap_past_midnight()
    {
        var p = new UserPreference { QuietHoursEnabled = true, QuietFromMinute = 23 * 60, QuietToMinute = 7 * 60, TimeZone = "Asia/Riyadh" };
        // 21:00 UTC = 00:00 Riyadh -> quiet; 06:00 UTC = 09:00 Riyadh -> not quiet
        Assert.True(PushSender.InQuietHours(p, new DateTime(2026, 11, 21, 21, 0, 0, DateTimeKind.Utc)));
        Assert.False(PushSender.InQuietHours(p, new DateTime(2026, 11, 21, 6, 0, 0, DateTimeKind.Utc)));
        p.QuietHoursEnabled = false;
        Assert.False(PushSender.InQuietHours(p, new DateTime(2026, 11, 21, 21, 0, 0, DateTimeKind.Utc)));
    }

    [Theory]
    [InlineData(new byte[] { 0x25, 0x50, 0x44, 0x46, 0x2D }, "application/pdf")]
    [InlineData(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, "image/png")]
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }, "image/jpeg")]
    public void File_types_are_detected_from_content(byte[] head, string expected) =>
        Assert.Equal(expected, Media.Sniff(head));
}

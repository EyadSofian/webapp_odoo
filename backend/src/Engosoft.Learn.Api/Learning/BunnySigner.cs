using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace Engosoft.Learn.Api.Learning;

public sealed class BunnyOptions
{
    public const string Section = "Bunny";
    /// <summary>Bunny Stream "Token Authentication Key" (the same one set in Odoo eLearning settings).</summary>
    public string StreamTokenKey { get; set; } = "";
    public int TokenLifetimeMinutes { get; set; } = 180;
}

/// <summary>
/// Signs Bunny Stream embed URLs: token = SHA256_hex(key + videoId + expires).
/// Odoo already signs course lessons (embed_code); live-session recordings are stored unsigned, so we sign them here.
/// </summary>
public sealed partial class BunnySigner(IOptions<BunnyOptions> options, TimeProvider clock)
{
    [GeneratedRegex(@"^https://iframe\.mediadelivery\.net/embed/(?<lib>\d+)/(?<vid>[0-9a-fA-F-]{36})", RegexOptions.CultureInvariant)]
    private static partial Regex EmbedUrl();

    public bool CanSign => !string.IsNullOrEmpty(options.Value.StreamTokenKey);

    public string? Sign(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        var m = EmbedUrl().Match(url);
        var key = options.Value.StreamTokenKey;
        if (!m.Success || string.IsNullOrEmpty(key)) return url;

        var videoId = m.Groups["vid"].Value;
        var expires = clock.GetUtcNow().AddMinutes(options.Value.TokenLifetimeMinutes).ToUnixTimeSeconds();
        var token = Token(key, videoId, expires);
        return $"https://iframe.mediadelivery.net/embed/{m.Groups["lib"].Value}/{videoId}?token={token}&expires={expires}&responsive=true";
    }

    public static string Token(string key, string videoId, long expires) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key + videoId + expires))).ToLowerInvariant();

    [GeneratedRegex("""src="(?<src>[^"]+)""", RegexOptions.CultureInvariant)]
    private static partial Regex IframeSrc();

    /// <summary>Pulls the player URL out of Odoo's embed_code iframe.</summary>
    public static string? SrcFromEmbed(string? embedCode)
    {
        if (string.IsNullOrEmpty(embedCode)) return null;
        var m = IframeSrc().Match(embedCode);
        if (!m.Success) return null;
        var src = System.Net.WebUtility.HtmlDecode(m.Groups["src"].Value);
        if (src.StartsWith("//")) src = "https:" + src;
        return src.StartsWith("https://") ? src : null;
    }
}

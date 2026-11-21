using Engosoft.Learn.Api.Admin;
using Xunit;

namespace Engosoft.Learn.Tests;

public class CampaignRulesTests
{
    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("/courses", "/courses")]
    [InlineData("/live/1627?session=5", "/live/1627?session=5")]
    [InlineData("https://engosoft.com/offers", "https://engosoft.com/offers")]
    public void Accepts_app_paths_and_https_links(string? input, string? expected) =>
        Assert.Equal(expected, CampaignService.ValidLink(input));

    [Theory]
    [InlineData("//evil.example/phish")]
    [InlineData("http://engosoft.com")]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,hi")]
    [InlineData("courses")]
    public void Rejects_anything_else(string input) =>
        Assert.Equal("", CampaignService.ValidLink(input));
}

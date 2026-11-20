using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace Engosoft.Learn.Api.Odoo;

public sealed class OdooOptions
{
    public const string Section = "Odoo";
    public string Url { get; set; } = "https://engosoft.com";
    public string Database { get; set; } = "EngoSoft";
    /// <summary>The integration user's id. In production this is a dedicated user with read rights only where needed.</summary>
    public int IntegrationUid { get; set; }
    public string ApiKey { get; set; } = "";
    public int TimeoutSeconds { get; set; } = 60;
    /// <summary>Public website, used for links that leave the app (buying, password reset).</summary>
    public string WebsiteUrl { get; set; } = "https://engosoft.com";
}

public class OdooException(string message, string? odooType = null) : Exception(message)
{
    public string? OdooType { get; } = odooType;
}

public sealed class OdooAccessException(string message, string? odooType) : OdooException(message, odooType);

public interface IOdooClient
{
    Task<JsonElement> ExecuteAsync(string model, string method, object?[] args, object? kwargs = null, CancellationToken ct = default);

    /// <summary>Checks a learner's own Odoo login. Returns the user id, or null when the credentials are wrong.</summary>
    Task<int?> AuthenticateAsync(string login, string password, CancellationToken ct = default);
}

/// <summary>JSON-RPC client for Odoo's external API. All business calls run as the integration user.</summary>
public sealed class OdooClient(HttpClient http, IOptions<OdooOptions> options, ILogger<OdooClient> log) : IOdooClient
{
    private static readonly HashSet<string> ReadMethods = ["search_read", "read", "search_count", "search", "fields_get", "read_group"];
    private int _id;

    public async Task<JsonElement> ExecuteAsync(string model, string method, object?[] args, object? kwargs = null, CancellationToken ct = default)
    {
        var o = options.Value;
        if (o.IntegrationUid <= 0 || string.IsNullOrWhiteSpace(o.ApiKey))
            throw new OdooException("Odoo integration user is not configured (Odoo:IntegrationUid / Odoo:ApiKey).");

        object?[] rpcArgs = [o.Database, o.IntegrationUid, o.ApiKey, model, method, args, kwargs ?? new Dictionary<string, object?>()];
        var retries = ReadMethods.Contains(method) ? 3 : 1;
        return await CallAsync("object", "execute_kw", rpcArgs, retries, $"{model}.{method}", ct);
    }

    public async Task<int?> AuthenticateAsync(string login, string password, CancellationToken ct = default)
    {
        var o = options.Value;
        var result = await CallAsync("common", "authenticate", [o.Database, login, password, new Dictionary<string, object?>()], 2, "common.authenticate", ct);
        return result.ValueKind == JsonValueKind.Number ? result.GetInt32() : null;
    }

    private async Task<JsonElement> CallAsync(string service, string method, object?[] args, int attempts, string label, CancellationToken ct)
    {
        var payload = new
        {
            jsonrpc = "2.0",
            method = "call",
            id = Interlocked.Increment(ref _id),
            @params = new { service, method, args }
        };

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                using var response = await http.PostAsJsonAsync("/jsonrpc", payload, OdooJson.Options, ct);
                response.EnsureSuccessStatusCode();
                using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
                if (doc.RootElement.TryGetProperty("error", out var error))
                    throw ToException(error);
                return doc.RootElement.GetProperty("result").Clone();
            }
            catch (Exception ex) when (attempt < attempts && ex is HttpRequestException or IOException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                log.LogWarning(ex, "Odoo call {Label} failed (attempt {Attempt}/{Attempts}); retrying", label, attempt, attempts);
                await Task.Delay(TimeSpan.FromMilliseconds(400 * attempt), ct);
            }
        }
    }

    private static OdooException ToException(JsonElement error)
    {
        string? type = null, message = null;
        if (error.TryGetProperty("data", out var data))
        {
            if (data.TryGetProperty("name", out var n)) type = n.GetString();
            if (data.TryGetProperty("message", out var m)) message = m.GetString();
        }
        message ??= error.TryGetProperty("message", out var top) ? top.GetString() : "Odoo error";
        return type is "odoo.exceptions.AccessError" or "odoo.exceptions.AccessDenied"
            ? new OdooAccessException(message ?? "Access denied", type)
            : new OdooException(message ?? "Odoo error", type);
    }
}

public static class OdooJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = null };
}

/// <summary>Typed helpers over execute_kw. A domain is an array of triplets: D(("field","=",value), ...).</summary>
public static class OdooClientExtensions
{
    public static object[] D(params (string Field, string Op, object? Value)[] terms) =>
        terms.Select(t => (object)new object?[] { t.Field, t.Op, t.Value }).ToArray();

    public static async Task<List<JsonElement>> SearchReadAsync(this IOdooClient odoo, string model, object[] domain,
        string[] fields, string? order = null, int? limit = null, int? offset = null, bool includeArchived = false, CancellationToken ct = default)
    {
        var kw = new Dictionary<string, object?> { ["fields"] = fields };
        if (order is not null) kw["order"] = order;
        if (limit is not null) kw["limit"] = limit;
        if (offset is not null) kw["offset"] = offset;
        if (includeArchived) kw["context"] = new Dictionary<string, object?> { ["active_test"] = false };
        var res = await odoo.ExecuteAsync(model, "search_read", [domain], kw, ct);
        return res.EnumerateArray().ToList();
    }

    public static async Task<List<JsonElement>> ReadAsync(this IOdooClient odoo, string model, IEnumerable<int> ids, string[] fields, CancellationToken ct = default)
    {
        var list = ids.Distinct().ToArray();
        if (list.Length == 0) return [];
        var res = await odoo.ExecuteAsync(model, "read", [list], new Dictionary<string, object?> { ["fields"] = fields }, ct);
        return res.EnumerateArray().ToList();
    }

    public static async Task<int> SearchCountAsync(this IOdooClient odoo, string model, object[] domain, CancellationToken ct = default) =>
        (await odoo.ExecuteAsync(model, "search_count", [domain], null, ct)).GetInt32();

    public static async Task<int> CreateAsync(this IOdooClient odoo, string model, Dictionary<string, object?> values, CancellationToken ct = default)
    {
        var res = await odoo.ExecuteAsync(model, "create", [values], null, ct);
        return res.ValueKind == JsonValueKind.Array ? res[0].GetInt32() : res.GetInt32();
    }

    public static Task WriteAsync(this IOdooClient odoo, string model, int[] ids, Dictionary<string, object?> values, CancellationToken ct = default) =>
        odoo.ExecuteAsync(model, "write", [ids, values], null, ct);
}

/// <summary>Reading Odoo values: Odoo sends false for empty fields and [id, name] pairs for many2one.</summary>
public static class OdooValue
{
    public static int Id(this JsonElement e) => e.GetProperty("id").GetInt32();

    public static string? Str(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static int? Int(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : null;

    public static double Dbl(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;

    public static bool Bool(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    public static (int Id, string Name)? M2O(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array && v.GetArrayLength() >= 2
            ? (v[0].GetInt32(), v[1].GetString() ?? "")
            : null;

    public static int[] Ids(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.Number).Select(x => x.GetInt32()).ToArray()
            : [];

    /// <summary>Odoo datetimes are naive UTC strings ("2026-11-05 14:00:00").</summary>
    public static DateTime? Utc(this JsonElement e, string name)
    {
        var s = e.Str(name);
        if (string.IsNullOrEmpty(s)) return null;
        return DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var d)
            ? DateTime.SpecifyKind(d, DateTimeKind.Utc)
            : null;
    }

    public static string ToOdoo(this DateTime utc) => utc.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss");

    public static JsonNode? Node(this JsonElement e) => JsonNode.Parse(e.GetRawText());
}

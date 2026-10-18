using System.Text.Json;
using System.Text.Json.Serialization;

namespace GaeaProbe;

/// <summary>
/// One serializer for every oracle payload. The constant pools legitimately contain NaN and
/// Infinity, and System.Text.Json refuses those by default -- which surfaced as a serialization
/// failure at the very end of a long run instead of as data. Allow the named literals so a NaN
/// constant is reported as "NaN" rather than killing the whole probe.
/// </summary>
internal static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = false,
        NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals,
        PropertyNamingPolicy = null,
    };
}

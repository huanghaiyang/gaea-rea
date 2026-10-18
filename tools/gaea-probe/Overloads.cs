using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;

namespace GaeaProbe;

/// <summary>
/// Overload resolution by coercion.
///
/// `\ue2b3` has two overloads that differ only in their second parameter: `(float[], float[], int)`
/// is the pair operation and `(float[], float, int)` is the in-place curve. Choosing by argument
/// COUNT picks the wrong one, and the wrong one throws an index error that looks like a bad test
/// instead of a bad selection. So the spec is matched by trying to coerce the arguments into each
/// candidate's parameter types and taking the one that fits.
/// </summary>
internal static class Overloads
{
    public static MethodInfo Pick(Type type, string name, JsonElement spec)
    {
        var candidates = type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic |
                                         BindingFlags.Static | BindingFlags.Instance)
            .Where(m => IlDump.Escape(m.Name) == name || m.Name == name)
            .ToArray();
        if (candidates.Length == 0)
        {
            Console.WriteLine($"  !! no method '{name}' on {IlDump.Escape(type.Name)}");
            throw new ArgumentException($"no method '{name}' on {IlDump.Escape(type.Name)}");
        }
        if (candidates.Length == 1) return candidates[0];

        var hasArgs = spec.TryGetProperty("args", out var argsEl) && argsEl.ValueKind == JsonValueKind.Array;
        var count = hasArgs ? argsEl.GetArrayLength() : -1;

        MethodInfo? best = null;
        var bestScore = -1;
        foreach (var m in candidates)
        {
            var ps = m.GetParameters();
            if (count >= 0 && ps.Length != count) continue;
            var ok = true;
            if (hasArgs)
            {
                var i = 0;
                foreach (var a in argsEl.EnumerateArray())
                {
                    if (i >= ps.Length) { ok = false; break; }
                    if (!Fits(a, ps[i].ParameterType)) { ok = false; break; }
                    i++;
                }
            }
            if (!ok) continue;
            // Prefer a candidate whose params exactly match the JSON kinds.
            var score = 1;
            // Prefer the candidate that needs no optional-argument fill-in, matching C# overload
            // resolution (used to tell (Map,float) from (Map,float,float=1)).
            if (count >= 0 && ps.Length == count) score += 5;
            var wantRet = spec.TryGetProperty("ret", out var rEl) && rEl.ValueKind == JsonValueKind.String ? rEl.GetString() : null;
            if (wantRet != null) score += (m.ReturnType.Name.Equals(wantRet, StringComparison.OrdinalIgnoreCase) ? 20 : 0);
            if (hasArgs)
            {
                var i = 0;
                foreach (var a in argsEl.EnumerateArray())
                {
                    var kind = a.ValueKind == JsonValueKind.Object && a.TryGetProperty("t", out var t) ? t.GetString() : null;
                    if (kind == "f32" && ps[i].ParameterType == typeof(float)) score++;
                    if (kind == "f32arr" && ps[i].ParameterType == typeof(float[])) score++;
                    if (kind == "i32" && ps[i].ParameterType == typeof(int)) score++;
                    if (kind == "bool" && ps[i].ParameterType == typeof(bool)) score++;
                    if (kind == "map" && (ps[i].ParameterType.Name == "Map" || ps[i].ParameterType.IsArray)) score++;
                    i++;
                }
            }
            if (score > bestScore) { bestScore = score; best = m; }
        }
        if (best == null)
        {
            Console.WriteLine($"  !! cannot match args to any overload of '{name}':");
            foreach (var m in candidates)
                Console.WriteLine("       " + Describe(m));
            throw new ArgumentException($"no matching overload for {name}");
        }
        if (candidates.Length > 1)
            Console.WriteLine($"  overload {name} -> {Describe(best)}");
        return best;
    }

    private static string Describe(MethodInfo m) =>
        m.ReturnType.Name + " " + IlDump.Escape(m.Name) + "(" +
        string.Join(", ", m.GetParameters().Select(p => p.ParameterType.Name + " " + p.Name)) + ")";

    private static bool Fits(JsonElement arg, Type p)
    {
        var kind = arg.ValueKind == JsonValueKind.Object && arg.TryGetProperty("t", out var t) ? t.GetString() : null;
        p = Nullable.GetUnderlyingType(p) ?? p;
        switch (kind)
        {
            case null: return arg.ValueKind == JsonValueKind.Null || p == typeof(object) || IsMapParam(p) || p == typeof(string);
            case "null": return true;
            case "ref": return true;
            case "f32": return p == typeof(float) || p == typeof(double) || p == typeof(object);
            case "f64": return p == typeof(double) || p == typeof(float) || p == typeof(object);
            case "i32": return p == typeof(int) || p == typeof(long) || p.IsEnum || p == typeof(object);
            case "i64": return p == typeof(long) || p == typeof(int) || p.IsEnum || p == typeof(object);
            case "bool": return p == typeof(bool) || p == typeof(object);
            case "string": return p == typeof(string) || p.IsEnum || p == typeof(object);
            case "enum": return p.IsEnum || p == typeof(object);
            case "f32arr": return p == typeof(float[]) || p == typeof(double[]) || p == typeof(object);
            case "i32arr": return p == typeof(int[]) || p == typeof(object);
            case "map": return IsMapParam(p);
            case "maps": return p.IsArray && IsMapParam(p.GetElementType()!);
            case "calls": return true;
            default: return true;
        }
    }

    private static bool IsMapParam(Type p) => p.Name == "Map" || (p.IsArray && p.GetElementType()?.Name == "Map");
}





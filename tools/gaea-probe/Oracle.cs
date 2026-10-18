using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace GaeaProbe;

internal static class Oracle
{
    private const BindingFlags Any =
        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

    internal static readonly List<Assembly> Assemblies = new();

    public static int Run(string dir, string specPath, string outPath)
    {
        Console.OutputEncoding = Encoding.UTF8;
        var asmNames = new[] { "Gaea.Nodes.dll", "Gaea.Engine.dll", "Gaea.Server.dll" };
        foreach (var name in asmNames)
        {
            var p = Path.Combine(dir, name);
            if (!File.Exists(p)) continue;
            try
            {
                Assemblies.Add(Assembly.LoadFrom(p));
                Console.WriteLine($"  loaded {name}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"  {name} load failed: {ex.GetType().Name}: {ex.Message}");
            }
        }
        if (Assemblies.Count == 0) { Console.WriteLine("  no assemblies"); return 2; }

        using var doc = JsonDocument.Parse(File.ReadAllText(specPath));
        var spec = doc.RootElement;

        var results = new Dictionary<string, object?>(StringComparer.Ordinal);
        object? last = null;

        try
        {
            if (spec.TryGetProperty("calls", out var calls) && calls.ValueKind == JsonValueKind.Array)
            {
                foreach (var c in calls.EnumerateArray())
                {
                    var nm = Str(c, "name");
                    last = Execute(c, results);
                    if (nm != null) results[nm] = last;
                    Console.WriteLine($"  call '{nm ?? "?"}' -> {Summarize(last)}");
                }
            }
            else
            {
                last = Execute(spec, results);
            }
        }
        catch (Exception ex)
        {
            var exx = ex;
            while (exx.InnerException != null) exx = exx.InnerException;
            var err = new { ok = false, error = exx.GetType().Name + ": " + exx.Message, trace = exx.StackTrace };
            WriteJson(outPath, err);
            Console.WriteLine($"  ERROR {exx.GetType().Name}: {exx.Message}");
            Console.WriteLine(exx.StackTrace);
            return 1;
        }

        var payload = new Dictionary<string, object?>
        {
            ["ok"] = true,
            ["result"] = Project(last),
            ["calls"] = results.ToDictionary(k => k.Key, k => Project(k.Value)),
        };
        WriteJson(outPath, payload);
        Console.WriteLine($"  ok -> {Summarize(last)}");
        return 0;
    }

    private static void WriteJson(string outPath, object payload)
    {
        var json = JsonSerializer.Serialize(payload, Json.Options);
        if (string.IsNullOrEmpty(outPath)) { Console.WriteLine(json); return; }
        File.WriteAllText(outPath, json);
        Console.WriteLine($"  wrote {outPath}");
    }

    // ------------------------------------------------------------------ execute
    private static object? Execute(JsonElement spec, Dictionary<string, object?> prior)
    {
        var asmHint = Str(spec, "assembly");
        var typeName = Str(spec, "type");
        var methodName = Str(spec, "method");
        if (methodName == null) throw new ArgumentException("spec needs 'method'");

        var type = ResolveType(typeName, asmHint);
        var method = Overloads.Pick(type, DecodeName(methodName), spec);

        object? target = null;
        if (!method.IsStatic)
        {
            if (spec.TryGetProperty("target", out var tgtSpec))
                target = ParseArg(tgtSpec, method.DeclaringType!, prior);
            else if (spec.TryGetProperty("new", out var nw) && nw.GetBoolean())
                target = Activator.CreateInstance(type, Any, null, Array.Empty<object>(), null);
            else
                throw new ArgumentException($"instance method {method.Name} needs 'new':true or 'target'");
        }

        var ps = method.GetParameters();
        var args = new object?[ps.Length];
        if (spec.TryGetProperty("args", out var argsEl))
        {
            var i = 0;
            foreach (var a in argsEl.EnumerateArray())
            {
                if (i >= ps.Length) break;
                args[i] = ParseArg(a, ps[i].ParameterType, prior);
                i++;
            }
            for (; i < ps.Length; i++)
            {
                if (ps[i].HasDefaultValue) args[i] = ps[i].DefaultValue;
                else throw new ArgumentException($"missing arg {i} ({ps[i].Name}) for {method.Name}");
            }
        }
        else
        {
            for (var i = 0; i < ps.Length; i++)
            {
                if (ps[i].HasDefaultValue) args[i] = ps[i].DefaultValue;
                else throw new ArgumentException($"missing arg {i} ({ps[i].Name})");
            }
        }

        try
        {
            return method.Invoke(target, args);
        }
        catch (TargetInvocationException tie) when (tie.InnerException != null)
        {
            throw tie.InnerException;
        }
    }

    private static Type ResolveType(string? name, string? asmHint)
    {
        IEnumerable<Assembly> pool = Assemblies;
        if (!string.IsNullOrEmpty(asmHint))
        {
            var a = Assemblies.FirstOrDefault(x =>
                string.Equals(x.GetName().Name, Path.GetFileNameWithoutExtension(asmHint), StringComparison.OrdinalIgnoreCase));
            if (a != null) pool = new[] { a };
        }
        if (string.IsNullOrEmpty(name)) throw new ArgumentException("spec needs 'type'");

        var wanted = DecodeName(name);
        var all = new List<Type>();
        foreach (var a in pool)
        {
            try { all.AddRange(a.GetTypes()); }
            catch (ReflectionTypeLoadException ex) { all.AddRange(ex.Types.Where(t => t != null)!); }
        }

        var hit = all.FirstOrDefault(t => t.Name == wanted)
                  ?? all.FirstOrDefault(t => t.FullName == wanted)
                  ?? all.FirstOrDefault(t => IlDump.Escape(t.Name) == name)
                  ?? all.FirstOrDefault(t => NestedEscaped(t) == name);
        if (hit == null) throw new ArgumentException($"type '{name}' not found");
        return hit;
    }

    private static string NestedEscaped(Type t)
    {
        var parts = new List<string>();
        Type? c = t;
        while (c != null) { parts.Insert(0, IlDump.Escape(c.Name)); c = c.DeclaringType; }
        return string.Join("+", parts);
    }

    /// <summary>Decode a `uXXXX`-escaped name back to the original private-use characters.</summary>
    private static string DecodeName(string s)
    {
        if (!s.StartsWith("u", StringComparison.Ordinal)) return s;
        var sb = new StringBuilder();
        var i = 0;
        var ok = true;
        while (i < s.Length)
        {
            if (s[i] == 'u' && i + 5 <= s.Length &&
                int.TryParse(s.AsSpan(i + 1, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var cp))
            {
                sb.Append((char)cp);
                i += 5;
            }
            else
            {
                ok = false;
                break;
            }
        }
        return ok && sb.Length > 0 ? sb.ToString() : s;
    }

    private static MethodInfo ResolveMethod(Type type, string name, JsonElement spec)
    {
        var wanted = DecodeName(name);
        var methods = type.GetMethods(Any).Where(m => m.Name == wanted || IlDump.Escape(m.Name) == name).ToArray();
        if (methods.Length == 0)
            methods = type.GetMethods(Any).Where(m => m.Name == name).ToArray();
        if (methods.Length == 0) throw new ArgumentException($"method '{name}' not found on {type.Name}");

        var argc = -1;
        if (spec.TryGetProperty("args", out var a) && a.ValueKind == JsonValueKind.Array) argc = a.GetArrayLength();
        if (argc >= 0)
        {
            var byCount = methods.Where(m => m.GetParameters().Length == argc).ToArray();
            if (byCount.Length > 0) return byCount[0];
        }
        return methods[0];
    }

    // --------------------------------------------------------------------- args
    private static object? ParseArg(JsonElement el, Type paramType, Dictionary<string, object?> prior)
    {
        var kind = el.ValueKind == JsonValueKind.Object ? Str(el, "t") : null;
        if (kind == null)
            return Coerce(el, paramType);

        if (kind == "ref")
        {
            var nm = Str(el, "name") ?? throw new ArgumentException("ref needs 'name'");
            if (!prior.TryGetValue(nm, out var v)) throw new ArgumentException($"ref '{nm}' not defined");
            return v;
        }
        if (kind == "null") return null;

        switch (kind)
        {
            case "f32": return (float)el.GetProperty("v").GetDouble();
            case "f64": return el.GetProperty("v").GetDouble();
            case "i32": return el.GetProperty("v").GetInt32();
            case "i64": return el.GetProperty("v").GetInt64();
            case "bool": return el.GetProperty("v").GetBoolean();
            case "string": return el.GetProperty("v").GetString();
            case "f32arr":
            {
                var vals = el.GetProperty("v").EnumerateArray().Select(x => (float)x.GetDouble()).ToArray();
                return CoerceArray(vals, paramType);
            }
            case "i32arr":
            {
                var vals = el.GetProperty("v").EnumerateArray().Select(x => x.GetInt32()).ToArray();
                return CoerceArray(vals, paramType);
            }
            case "enum":
            {
                var v = el.GetProperty("v");
                object raw = v.ValueKind == JsonValueKind.String ? v.GetString()! : v.GetInt32();
                var enumType = Nullable.GetUnderlyingType(paramType) ?? paramType;
                if (enumType.IsEnum)
                    return raw is string sname ? Enum.Parse(enumType, sname, true) : Enum.ToObject(enumType, raw);
                return Convert.ChangeType(raw, enumType, CultureInfo.InvariantCulture);
            }
            case "res":
            {
                // Resolution struct arg, built through its (int,int) or (int) constructor.
                var t = paramType;
                if (el.TryGetProperty("x", out var rx) && el.TryGetProperty("y", out var ry))
                    return Activator.CreateInstance(t, rx.GetInt32(), ry.GetInt32());
                return Activator.CreateInstance(t, el.GetProperty("v").GetInt32());
            }
            case "f2":
            {
                // Float2 struct arg (Gaea's 2-float value type), built via (float,float).
                return Activator.CreateInstance(paramType,
                    (float)el.GetProperty("x").GetDouble(),
                    (float)el.GetProperty("y").GetDouble());
            }
            case "map":
            {
                var map = BuildMap(el);
                if (paramType.IsArray)
                {
                    var elem = paramType.GetElementType()!;
                    var arr = Array.CreateInstance(elem, 1);
                    arr.SetValue(CoerceMapObject(map, elem), 0);
                    return arr;
                }
                return CoerceMapObject(map, paramType);
            }
            case "maps":
            {
                var items = el.GetProperty("items").EnumerateArray().Select(BuildMap).ToArray();
                var elem = paramType.GetElementType() ?? typeof(object);
                var arr = Array.CreateInstance(elem, items.Length);
                for (var i = 0; i < items.Length; i++) arr.SetValue(CoerceMapObject(items[i], elem), i);
                return arr;
            }
            case "calls":
            {
                var sub = el.GetProperty("calls");
                object? lastCall = null;
                foreach (var c in sub.EnumerateArray())
                {
                    lastCall = Execute(c, prior);
                    var nm = Str(c, "name");
                    if (nm != null) prior[nm] = lastCall;
                }
                return lastCall;
            }
            default:
                throw new ArgumentException($"unknown arg kind '{kind}'");
        }
    }

    private static object CoerceArray(Array vals, Type paramType)
    {
        if (!paramType.IsArray) throw new ArgumentException($"expected array parameter, got {paramType.Name}");
        var elem = paramType.GetElementType()!;
        var outArr = Array.CreateInstance(elem, vals.Length);
        for (var i = 0; i < vals.Length; i++)
            outArr.SetValue(Convert.ChangeType(vals.GetValue(i), elem, CultureInfo.InvariantCulture), i);
        return outArr;
    }

    private static object CoerceMapObject(object map, Type paramType)
    {
        if (paramType.IsInstanceOfType(map)) return map;
        throw new ArgumentException($"cannot pass Map to {paramType.Name}");
    }

    private static object? Coerce(JsonElement el, Type paramType)
    {
        var t = Nullable.GetUnderlyingType(paramType) ?? paramType;
        switch (el.ValueKind)
        {
            case JsonValueKind.Null: return null;
            case JsonValueKind.True: return true;
            case JsonValueKind.False: return false;
            case JsonValueKind.String:
                if (t == typeof(string)) return el.GetString();
                if (t.IsEnum) return Enum.Parse(t, el.GetString()!, true);
                return Convert.ChangeType(el.GetString(), t, CultureInfo.InvariantCulture);
            case JsonValueKind.Number:
                if (t == typeof(float)) return (float)el.GetDouble();
                if (t == typeof(double)) return el.GetDouble();
                return Convert.ChangeType(el.GetInt64(), t, CultureInfo.InvariantCulture);
            default:
                return JsonSerializer.Deserialize(el.GetRawText(), t);
        }
    }

    // ---------------------------------------------------------------------- map
    private static object BuildMap(JsonElement el)
    {
        var mapType = EngineTypes.Map ?? throw new InvalidOperationException("Map type not found");
        var resType = EngineTypes.Resolution ?? throw new InvalidOperationException("Resolution type not found");
        var w = el.TryGetProperty("w", out var wEl) ? wEl.GetInt32() : 64;
        var h = el.TryGetProperty("h", out var hEl) ? hEl.GetInt32() : w;
        var res = Activator.CreateInstance(resType, w, h)
                  ?? throw new InvalidOperationException("Resolution ctor failed");
        var data = new float[w * h];

        if (el.TryGetProperty("data", out var dataEl) && dataEl.ValueKind == JsonValueKind.Array)
        {
            var i = 0;
            foreach (var x in dataEl.EnumerateArray()) { if (i < data.Length) data[i++] = (float)x.GetDouble(); }
        }
        else
        {
            var gen = el.TryGetProperty("gen", out var g) ? g.GetString() ?? "const" : "const";
            var c = el.TryGetProperty("v", out var vEl) ? (float)vEl.GetDouble() : 0.5f;
            var lo = el.TryGetProperty("min", out var minEl) ? (float)minEl.GetDouble() : 0f;
            var hi = el.TryGetProperty("max", out var maxEl) ? (float)maxEl.GetDouble() : 1f;
            var seed = el.TryGetProperty("seed", out var sEl) ? sEl.GetInt64() : 12345L;
            var rng = new XorShift(seed);
            for (var y = 0; y < h; y++)
            {
                for (var x = 0; x < w; x++)
                {
                    var i = y * w + x;
                    data[i] = gen switch
                    {
                        "const" => c,
                        "zero" => 0f,
                        "one" => 1f,
                        "gradientX" => w > 1 ? (float)x / (w - 1) : 0f,
                        "gradientY" => h > 1 ? (float)y / (h - 1) : 0f,
                        "gradientXY" => (w + h > 2) ? (float)(x + y) / (w + h - 2) : 0f,
                        "radial" => Radial(x, y, w, h),
                        "sine" => 0.5f + 0.5f * (float)Math.Sin(2 * Math.PI * x / Math.Max(1, w - 1)),
                        "cosine" => 0.5f + 0.5f * (float)Math.Cos(2 * Math.PI * y / Math.Max(1, h - 1)),
                        "ramp" => (float)i / Math.Max(1, w * h - 1),
                        "random" => lo + (hi - lo) * (float)rng.Next01(),
                        "checker" => ((x / 4 + y / 4) & 1) == 0 ? lo : hi,
                        "hills" => 0.5f + 0.25f * (float)Math.Sin(2 * Math.PI * 3 * x / Math.Max(1, w - 1)) * (float)Math.Cos(2 * Math.PI * 2 * y / Math.Max(1, h - 1)),
                        _ => c,
                    };
                }
            }
        }

        var ctor = mapType.GetConstructor(new[] { resType, typeof(float[][]) });
        if (ctor == null) throw new MissingMethodException("Map(Resolution, params float[][])");

        // Multi-channel maps: colour nodes need real R/G/B planes, so `chans` passes one flat
        // array per channel, exactly the shape the Map(Resolution, params float[][]) ctor takes.
        if (el.TryGetProperty("chans", out var chansEl) && chansEl.ValueKind == JsonValueKind.Array)
        {
            var planes = chansEl.EnumerateArray()
                .Select(c => c.EnumerateArray().Select(x => (float)x.GetDouble()).ToArray())
                .ToArray();
            return ctor.Invoke(new object?[] { res, planes })!;
        }
        return ctor.Invoke(new object?[] { res, new[] { data } })!;
    }

    private static float Radial(int x, int y, int w, int h)
    {
        var cx = (w - 1) / 2.0;
        var cy = (h - 1) / 2.0;
        var d = Math.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        var max = Math.Sqrt(cx * cx + cy * cy);
        return max > 0 ? (float)(1 - d / max) : 0f;
    }

    private sealed class XorShift
    {
        private ulong _s;
        public XorShift(long seed) { _s = (ulong)seed | 1; }
        public double Next01()
        {
            _s ^= _s << 13; _s ^= _s >> 7; _s ^= _s << 17;
            return (_s >> 11) * (1.0 / 9007199254740992.0);
        }
    }

    // ------------------------------------------------------------------- output
    private static object? Project(object? v)
    {
        if (v == null) return null;
        if (EngineTypes.IsMap(v))
        {
            var (x, y) = EngineTypes.MapSize(v);
            var arr = (float[])EngineTypes.MapData(v)!;
            var chans = EngineTypes.MapChannels(v);
            return new { t = "map", w = x, h = y, data = arr, chans, stats = Stats(arr) };
        }
        if (EngineTypes.IsMapArray(v))
        {
            var list = ((Array)v).Cast<object>().Select(x => (object?)Project(x)).ToArray();
            return new { t = "maps", items = list };
        }
        switch (v)
        {
            case float[] fa: return new { t = "f32arr", data = fa, stats = Stats(fa) };
            case int[] ia: return new { t = "i32arr", data = ia };
            case double[] da: return new { t = "f64arr", data = da, stats = Stats(da.Select(x => (float)x).ToArray()) };
            case bool b: return new { t = "bool", v = b };
            case Enum e: return new { t = "enum", v = e.ToString(), i = Convert.ToInt32(e) };
            case float f: return new { t = "f32", v = f };
            case double d: return new { t = "f64", v = d };
            case string s: return new { t = "string", v = s };
            case IConvertible c: return new { t = v.GetType().Name, v = c.ToString(CultureInfo.InvariantCulture) };
            default: return new { t = v.GetType().Name, v = v.ToString() };
        }
    }

    private static object Stats(float[] a)
    {
        if (a.Length == 0) return new { n = 0 };
        var min = float.MaxValue; var max = float.MinValue; double sum = 0;
        foreach (var v in a)
        {
            if (v < min) min = v;
            if (v > max) max = v;
            sum += v;
        }
        return new { n = a.Length, min, max, mean = sum / a.Length };
    }

    private static string Summarize(object? v)
    {
        var p = Project(v);
        var s = JsonSerializer.Serialize(p, Json.Options);
        return s.Length > 240 ? s[..240] + "..." : s;
    }

    private static string? Str(JsonElement el, string name) =>
        el.ValueKind == JsonValueKind.Object && el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;
}





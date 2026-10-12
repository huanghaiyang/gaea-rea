// GaeaPoolReflect - read Eazfuscator constant pools out of a managed PE by letting
// the assembly's own pool loaders decrypt their embedded resources, then reading the
// resulting fields through reflection.
//
//   dump  <assembly> <outdir>     write every decoded manifest resource to disk
//   pools <assembly> <outdir>     write <outdir>/pools.json with every pool table
//
// A pool is recognised by shape: an obfuscated top-level type owning a nested type
// whose instance holds int[]/long[]/float[]/double[]/string[] arrays or a
// Dictionary<int,string>. Overloaded accessors in the outer type tell us which
// element type an index refers to.

using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace GaeaPoolReflect;

internal static class Program
{
    private static int Main(string[] args)
    {
        try { Console.OutputEncoding = new UTF8Encoding(false); } catch (IOException) { }
        if (args.Length < 3)
        {
            Console.Error.WriteLine("usage: GaeaPoolReflect <dump|pools> <assembly> <outdir>");
            return 2;
        }
        try
        {
            return args[0] switch
            {
                "dump" => Run(args[1], args[2], false),
                "pools" => Run(args[1], args[2], true),
                _ => 2,
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"FATAL {ex.GetType().Name}: {ex.Message}");
            return 1;
        }
    }

    private static Assembly _asm;

    private static int Run(string asmPath, string outDir, bool doPools)
    {
        asmPath = Path.GetFullPath(asmPath);
        var dir = Path.GetDirectoryName(asmPath);
        AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
        {
            var simple = new AssemblyName(e.Name).Name + ".dll";
            var p = Path.Combine(dir, simple);
            return File.Exists(p) ? Assembly.LoadFrom(p) : null;
        };
        _asm = Assembly.LoadFrom(asmPath);
        Directory.CreateDirectory(outDir);

        Type[] types;
        try { types = _asm.GetTypes(); }
        catch (ReflectionTypeLoadException ex) { types = ex.Types.Where(t => t != null).ToArray(); }

        // 1) Decode every manifest resource with the assembly's own decryptor.
        var decryptor = FindDecryptor(types);
        var decodedNames = new List<string>();
        if (decryptor != null)
        {
            Console.Error.WriteLine($"[decryptor: {decryptor.DeclaringType?.Name}.{decryptor.Name}]");
            foreach (var name in _asm.GetManifestResourceNames())
            {
                try
                {
                    using var s = _asm.GetManifestResourceStream(name);
                    if (s == null) continue;
                    var outp = (Stream)decryptor.Invoke(null, new object[] { s });
                    using var ms = new MemoryStream();
                    outp.CopyTo(ms);
                    var bytes = ms.ToArray();
                    File.WriteAllBytes(Path.Combine(outDir, $"res_{Convert.ToHexString(Encoding.UTF8.GetBytes(name))}.bin"), bytes);
                    Console.Error.WriteLine($"[resource {name}: {bytes.Length} bytes]");
                    decodedNames.Add(name);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[resource {name} failed: {ex.InnerException?.Message ?? ex.Message}]");
                }
            }
        }
        else Console.Error.WriteLine("[no decryptor found]");

        if (!doPools) return 0;

        // 2) Dump every pool table.
        var pools = new Dictionary<string, object>();
        foreach (var t in types)
        {
            if (t == null || t.IsNested || t.IsGenericTypeDefinition) continue;
            if (!IsObfuscated(t.Name)) continue;
            var nested = t.GetNestedTypes(BindingFlags.Public | BindingFlags.NonPublic);
            foreach (var nt in nested)
            {
                try
                {
                    ForceInit(t, nt);
                    var inst = Singleton(nt);
                    if (inst == null) continue;
                    var entry = DumpInstance(nt, inst);
                    if (entry == null) continue;
                    entry["accessors"] = Accessors(t);
                    entry["outer"] = t.Name;
                    pools[t.Name + "+" + nt.Name] = entry;
                }
                catch (Exception ex) { Console.Error.WriteLine($"[pool {t.Name}+{nt.Name}: {ex.Message}]"); }
            }
        }

        var json = JsonSerializer.Serialize(pools, new JsonSerializerOptions { WriteIndented = false });
        File.WriteAllText(Path.Combine(outDir, "pools.json"), json);
        Console.Error.WriteLine($"[pools: {pools.Count}]");
        return 0;
    }

    private static bool IsObfuscated(string name)
    {
        if (string.IsNullOrEmpty(name)) return false;
        foreach (var c in name) if (c < 0x20 || (c >= 0xE000 && c <= 0xF8FF)) return true;
        return false;
    }

    private static MethodInfo FindDecryptor(Type[] types)
    {
        foreach (var t in types)
        {
            if (t == null) continue;
            foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static))
            {
                var ps = m.GetParameters();
                if (m.ReturnType == typeof(Stream) && ps.Length == 1 && ps[0].ParameterType == typeof(Stream))
                    return m;
            }
        }
        return null;
    }

    /// <summary>Run the outer type's static ctor and any nested static ctor.</summary>
    private static void ForceInit(Type outer, Type nested)
    {
        // Touching any static member of the outer type runs its cctor; the nested
        // singleton's cctor is what actually loads the resource, so run that too.
        try
        {
            var probe = outer.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)
                .FirstOrDefault(m => m.GetParameters().Length == 1 && m.GetParameters()[0].ParameterType == typeof(int));
            probe?.Invoke(null, new object[] { 0 });
        }
        catch { }
        try { RuntimeHelpers.RunClassConstructor(nested.TypeHandle); } catch { }
        try { RuntimeHelpers.RunClassConstructor(outer.TypeHandle); } catch { }
    }

    private static object Singleton(Type nested)
    {
        var f = nested.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)
            .FirstOrDefault(x => x.FieldType == nested);
        if (f == null) return null;
        try { return f.GetValue(null); } catch { return null; }
    }

    private static Dictionary<string, object> DumpInstance(Type nested, object inst)
    {
        var result = new Dictionary<string, object>();
        foreach (var f in nested.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
        {
            try
            {
                var v = f.GetValue(inst);
                if (v == null) continue;
                switch (v)
                {
                    case int[] a: result["ints:" + f.Name] = a; break;
                    case long[] a: result["longs:" + f.Name] = a; break;
                    case float[] a: result["floats:" + f.Name] = a; break;
                    case double[] a: result["doubles:" + f.Name] = a; break;
                    case string[] a: result["strings:" + f.Name] = a; break;
                    case byte[] a: result["bytes:" + f.Name] = a.Length; break;
                    case Dictionary<int, string> d: result["dict:" + f.Name] = d; break;
                    case System.Collections.IDictionary d:
                        {
                            var map = new Dictionary<string, object>();
                            foreach (System.Collections.DictionaryEntry e in d) map[Convert.ToString(e.Key)] = e.Value;
                            result["map:" + f.Name] = map;
                            break;
                        }
                }
            }
            catch { }
        }
        return result.Count == 0 ? null : result;
    }

    private static List<string> Accessors(Type outer)
    {
        var list = new List<string>();
        foreach (var m in outer.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static))
        {
            var ps = m.GetParameters();
            if (ps.Length == 1 && ps[0].ParameterType == typeof(int))
                list.Add(m.ReturnType.Name);
        }
        return list;
    }
}

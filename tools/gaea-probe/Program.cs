using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;

namespace GaeaProbe;

/// <summary>
/// Load the installed Gaea assemblies and interrogate them at runtime.
///
/// THE POINT
/// The recovered source is readable in structure but every numeric constant is `\ue0003.\ue002(N)`,
/// an index into an Eazfuscator-encrypted pool. Statically that pool is opaque; at runtime its
/// static initializer decrypts it into a `float[]`. Loading the assembly and reading that array
/// converts the blocker into data, which is what makes exact replication of the remaining nodes
/// possible rather than approximate.
///
/// Everything is reached through reflection with non-public binding flags: the obfuscated members
/// are `internal` or `private`, and their names are stable identifiers even though they are not
/// meaningful words.
/// </summary>
internal static class Program
{
    private const BindingFlags Any =
        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

    private static string _dir = @"D:\Gaea 2";

    private static int Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        if (args.Length > 0) _dir = args[0];

        // Resolve sibling assemblies (Gaea.Engine, Gaea.Native, ...) from the install directory.
        AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
        {
            var name = new AssemblyName(e.Name).Name + ".dll";
            var path = Path.Combine(_dir, name);
            return File.Exists(path) ? Assembly.LoadFrom(path) : null;
        };

        var nodesPath = Path.Combine(_dir, "Gaea.Nodes.dll");
        if (!File.Exists(nodesPath))
        {
            Console.WriteLine($"  Gaea.Nodes.dll not found at {nodesPath}");
            return 2;
        }

        Console.WriteLine($"  loading {nodesPath}");
        Assembly asm;
        try
        {
            asm = Assembly.LoadFrom(nodesPath);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  load failed: {ex.GetType().Name}: {ex.Message}");
            return 1;
        }
        Console.WriteLine($"  loaded: {asm.GetName().Name} {asm.GetName().Version}");

        var cmd = args.Length > 1 ? args[1] : "all";
        try
        {
            if (cmd is "all" or "constants") DumpConstants(asm);
            if (cmd is "all" or "nodes") DumpNodes(asm);
            if (cmd is "all" or "profiles") DumpProfiles(asm);
            if (cmd is "scan") ScanAllAssemblies();
            if (cmd is "oracle")
            {
                // `oracle <spec.json> [out.json]`: run the real shipped method on controlled input
                // and emit the resulting float array. Turns "did I translate this correctly" into a
                // numeric diff instead of a reading of obfuscated names.
                var specPath = args.Length > 2 ? args[2] : "";
                var outPath = args.Length > 3 ? args[3] : "";
                return Oracle.Run(_dir, specPath, outPath);
            }
            if (cmd is "il")
            {
                // `il <assembly> <type-pattern>`: dump IL for the obfuscated helper classes.
                var target = args.Length > 2 ? args[2] : "Gaea.Engine.dll";
                var pattern = args.Length > 3 ? args[3] : "all";
                var path = Path.IsPathRooted(target) ? target : Path.Combine(_dir, target);
                var asm2 = Assembly.LoadFrom(path);
                Console.WriteLine($"  IL dump from {Path.GetFileName(path)}");
                IlDump.Dump(asm2, pattern);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  ERROR: {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine(ex.StackTrace);
            return 1;
        }
        return 0;
    }

    // --------------------------------------------------------------------- scan
    /// <summary>
    /// Find the encrypted constant pool across every Gaea assembly.
    ///
    /// The obfuscator's container is not necessarily in Gaea.Nodes.dll: shared infrastructure lives
    /// in Gaea.Engine.dll, and the recovered source was concatenated from several assemblies so the
    /// file does not say which one a given type came from. Rather than guess, every Gaea assembly is
    /// loaded and searched for a nested singleton carrying int/long/float/double arrays.
    /// </summary>
    private static void ScanAllAssemblies()
    {
        Console.WriteLine("");
        Console.WriteLine("  ---- scanning every Gaea assembly for the constant pool ----");
        var dlls = Directory.GetFiles(_dir, "Gaea*.dll")
            .OrderBy(p => new FileInfo(p).Length)
            .ToArray();
        foreach (var dll in dlls)
        {
            Assembly a;
            try { a = Assembly.LoadFrom(dll); }
            catch (Exception ex)
            {
                Console.WriteLine($"  {Path.GetFileName(dll)}: load failed ({ex.GetType().Name})");
                continue;
            }
            Type[] types;
            try { types = a.GetTypes(); }
            catch (ReflectionTypeLoadException ex) { types = ex.Types.Where(t => t != null).ToArray(); }
            catch (Exception ex)
            {
                Console.WriteLine($"  {Path.GetFileName(dll)}: types failed ({ex.GetType().Name})");
                continue;
            }

            var hits = 0;
            foreach (var t in types)
            {
                Type[] nested;
                try { nested = t.GetNestedTypes(Any); } catch { continue; }
                foreach (var n in nested)
                {
                    FieldInfo[] fs;
                    try { fs = n.GetFields(Any); } catch { continue; }
                    var numeric = fs.Where(f => f.FieldType.IsArray &&
                        (f.FieldType == typeof(float[]) || f.FieldType == typeof(int[]) ||
                         f.FieldType == typeof(long[]) || f.FieldType == typeof(double[]))).ToArray();
                    if (numeric.Length < 2) continue;
                    // A singleton instance field of the nested type itself is the giveaway.
                    var singleton = fs.FirstOrDefault(f => f.FieldType == n && f.IsStatic);
                    if (singleton == null) continue;
                    hits++;
                    Console.WriteLine($"  HIT {Path.GetFileName(dll)} :: {Escape(t.FullName)} / {Escape(n.Name)}");
                    Console.WriteLine($"      pools: {string.Join(", ", numeric.Select(f => f.FieldType.Name))}");
                    DumpOnePool(n, singleton, numeric);
                }
            }
            if (hits == 0) Console.WriteLine($"  {Path.GetFileName(dll)}: no pool");
        }
    }

    private static string Escape(string s) =>
        new string(s.Select(c => c < 32 || c > 126 ? '?' : c).ToArray());

    private static void DumpOnePool(Type nested, FieldInfo singleton, FieldInfo[] pools)
    {
        object inst;
        try { inst = singleton.GetValue(null); }
        catch (Exception ex) { Console.WriteLine($"      singleton threw: {ex.GetType().Name}: {ex.Message}"); return; }
        foreach (var f in pools)
        {
            object v;
            try { v = f.IsStatic ? f.GetValue(null) : f.GetValue(inst); }
            catch (Exception ex) { Console.WriteLine($"      {f.Name}: {ex.GetType().Name}"); continue; }
            if (v is not Array arr) { Console.WriteLine($"      {f.Name}: null"); continue; }
            var first = new List<string>();
            for (var i = 0; i < Math.Min(arr.Length, 8); i++)
                first.Add(Convert.ToString(arr.GetValue(i), System.Globalization.CultureInfo.InvariantCulture));
            Console.WriteLine($"      {f.Name}: {f.FieldType.Name}[{arr.Length}]  {string.Join(", ", first)}");

            var kind = f.FieldType == typeof(float[]) ? "float"
                     : f.FieldType == typeof(int[]) ? "int"
                     : f.FieldType == typeof(long[]) ? "long" : "double";
            // NAMESPACED BY ASSEMBLY. `Gaea.Server.dll` carries its own obfuscator pool with the
            // same field layout; writing both to `pool_float.json` silently left the LAST one on
            // disk, and reading `\ue002(161)` from Gaea.Server's pool gave 1/pi -- a plausible
            // number from the wrong table. The assembly name is part of the identity.
            var asmName = nested.Assembly.GetName().Name ?? "unknown";
            var outPath = Path.Combine(@"D:\sgames\gaea-rea\evidence",
                $"pool_{asmName}_{kind}.json");
            var all = new List<string>();
            foreach (var x in arr) all.Add(Convert.ToString(x, System.Globalization.CultureInfo.InvariantCulture));
            Directory.CreateDirectory(@"D:\sgames\gaea-rea\evidence");
            File.WriteAllText(outPath, "[" + string.Join(",", all) + "]");
            Console.WriteLine($"      wrote {outPath}");
        }
    }

    // ------------------------------------------------------------------ constants
    /// <summary>
    /// Dump the decrypted constant pools.
    ///
    /// The obfuscator stores them as parallel arrays on a singleton: `int[]`, `long[]`, `float[]`,
    /// `double[]`. Touching the singleton's static field runs its initializer, which is what
    /// performs the decryption, so the values read here are the ones the shipped code actually uses.
    /// </summary>
    private static void DumpConstants(Assembly asm)
    {
        Console.WriteLine("");
        Console.WriteLine("  ---- constant pools ----");

        // The obfuscated container class is named with private-use characters; find it by shape
        // rather than by name, because the name is not stable across builds.
        foreach (var t in asm.GetTypes())
        {
            if (!t.IsClass) continue;
            var nested = t.GetNestedTypes(Any);
            if (nested.Length == 0) continue;

            // Look for the singleton that carries the numeric arrays.
            foreach (var n in nested)
            {
                var arrays = n.GetFields(Any)
                    .Where(f => f.FieldType.IsArray &&
                                (f.FieldType == typeof(float[]) || f.FieldType == typeof(int[]) ||
                                 f.FieldType == typeof(long[]) || f.FieldType == typeof(double[])))
                    .ToArray();
                if (arrays.Length == 0) continue;

                Console.WriteLine($"  {t.Name} / {n.Name}: {arrays.Length} pool(s)");

                // Find the static singleton instance to trigger the initializer.
                var instField = n.GetFields(Any)
                    .FirstOrDefault(f => f.FieldType == n && f.IsStatic);
                object inst = null;
                if (instField != null)
                {
                    try { inst = instField.GetValue(null); }
                    catch (Exception ex) { Console.WriteLine($"    singleton failed: {ex.Message}"); }
                }

                foreach (var f in arrays)
                {
                    object val = null;
                    try
                    {
                        // Static arrays live on the type; instance arrays on the singleton.
                        val = f.IsStatic ? f.GetValue(null) : (inst != null ? f.GetValue(inst) : null);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"    {f.Name}: read failed {ex.Message}");
                        continue;
                    }
                    if (val is not Array arr)
                    {
                        Console.WriteLine($"    {f.Name}: null");
                        continue;
                    }
                    Console.WriteLine($"    {f.Name}: {f.FieldType.Name}[{arr.Length}]");
                    var line = new List<string>();
                    var count = Math.Min(arr.Length, 12);
                    for (var i = 0; i < count; i++)
                        line.Add(Convert.ToString(arr.GetValue(i), System.Globalization.CultureInfo.InvariantCulture));
                    Console.WriteLine($"      first {count}: {string.Join(", ", line)}");

                    // Persist the whole array: this is the payload the node work needs.
                    var outPath = Path.Combine(@"D:\sgames\gaea-rea\evidence",
                        $"constants_{f.FieldType.Name}_{f.Name.Replace('\ue000', 'u').Trim()}.json");
                    Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
                    var full = new List<string>();
                    foreach (var v in arr)
                        full.Add(Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture));
                    File.WriteAllText(outPath, "[" + string.Join(",", full) + "]");
                    Console.WriteLine($"      wrote {outPath}");
                }
            }
        }
    }

    // ---------------------------------------------------------------------- nodes
    /// <summary>
    /// Enumerate the node catalogue through its [Name] and [Parameter] attributes.
    ///
    /// These attributes are plaintext even where the code is obfuscated, so this is the
    /// authoritative list of what the software offers -- including every parameter's default and
    /// declared range, which the schema needs.
    /// </summary>
    private static void DumpNodes(Assembly asm)
    {
        Console.WriteLine("");
        Console.WriteLine("  ---- nodes ----");
        var rows = new List<object>();
        foreach (var t in asm.GetTypes())
        {
            if (!t.IsClass || t.IsAbstract) continue;
            if (!typeof(object).IsAssignableFrom(t)) continue;

            var nameAttr = t.GetCustomAttributes(false)
                .FirstOrDefault(a => a.GetType().Name.Contains("NameAttribute"));
            if (nameAttr == null) continue;
            var name = nameAttr.GetType().GetProperty("Name")?.GetValue(nameAttr) as string
                       ?? t.Name;

            var family = t.GetCustomAttributes(false)
                .FirstOrDefault(a => a.GetType().Name.Contains("FamilyAttribute"));
            var fam = family?.GetType().GetProperty("Family")?.GetValue(family) as string
                      ?? family?.GetType().GetProperty("Name")?.GetValue(family) as string ?? "";

            var props = new List<object>();
            foreach (var p in t.GetProperties(Any))
            {
                var pa = p.GetCustomAttributes(false)
                    .FirstOrDefault(a => a.GetType().Name.Contains("ParameterAttribute"));
                if (pa == null) continue;
                // ParameterAttribute carries (default, min, max) positionally in most builds.
                var vals = pa.GetType().GetProperties()
                    .ToDictionary(x => x.Name, x => x.GetValue(pa));
                props.Add(new
                {
                    name = p.Name,
                    type = p.PropertyType.Name,
                    attr = vals,
                });
            }

            rows.Add(new { name, family = fam, type = t.Name, parameters = props });
        }

        Console.WriteLine($"  {rows.Count} node types with a [Name] attribute");
        foreach (var r in rows.Take(8))
            Console.WriteLine($"    {JsonSerializer.Serialize(r)}");

        var outPath = @"D:\sgames\gaea-rea\evidence\nodes-runtime.json";
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        File.WriteAllText(outPath, JsonSerializer.Serialize(rows,
            new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine($"  wrote {outPath}");
    }

    // ------------------------------------------------------------------- profiles
    /// <summary>
    /// List the `Profiles` static methods. These are the shared algorithm bodies the remaining
    /// nodes delegate to, so implementing them covers many nodes at once.
    /// </summary>
    private static void DumpProfiles(Assembly asm)
    {
        Console.WriteLine("");
        Console.WriteLine("  ---- Profiles ----");
        var prof = asm.GetTypes().FirstOrDefault(t => t.Name == "Profiles");
        if (prof == null)
        {
            Console.WriteLine("  no type named Profiles");
            return;
        }
        var ms = prof.GetMethods(Any)
            .Where(m => m.IsStatic && !m.IsSpecialName)
            .OrderBy(m => m.Name)
            .ToArray();
        Console.WriteLine($"  {ms.Length} static methods");
        foreach (var m in ms)
        {
            var ps = string.Join(", ", m.GetParameters()
                .Select(p => $"{p.ParameterType.Name} {p.Name}" +
                             (p.HasDefaultValue ? $" = {p.DefaultValue}" : "")));
            Console.WriteLine($"    {m.ReturnType.Name} {m.Name}({ps})");
        }
    }
}

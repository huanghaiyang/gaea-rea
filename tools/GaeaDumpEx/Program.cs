// GaeaDumpEx - index-aware companion to GaeaDump (see csproj header).
//
//   list  <assembly> [filter]           index, ReflectionName, kind, counts
//   memb  <assembly> <filter> <index>   members of the Nth match
//   dump  <assembly> <filter> <index>   decompile the Nth match
//
// <index> is a zero-based ordinal over matches sorted by ReflectionName; use -1
// for "all matches", which is only safe when the filter is unambiguous.

using System.Reflection.Metadata;
using System.Text;
using ICSharpCode.Decompiler;
using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.Metadata;
using ICSharpCode.Decompiler.TypeSystem;

namespace GaeaDumpEx;

internal static class Program
{
    private const string RoslynDir =
        @"C:\Users\huanh\.trae-cn\extensions\muhammad-sammy.csharp-2.145.21-g154a82fd27-win32-x64\.roslyn";

    private static int Main(string[] args)
    {
        try { Console.OutputEncoding = new UTF8Encoding(false); }
        catch (IOException) { }

        if (args.Length < 2)
        {
            Console.Error.WriteLine("usage: GaeaDumpEx <list|memb|dump> <assembly> [filter] [index]");
            return 2;
        }

        string mode = args[0];
        string asmPath = Path.GetFullPath(args[1]);
        string filter = args.Length > 2 ? args[2] : null;
        int index = args.Length > 3 && int.TryParse(args[3], out var ix) ? ix : -1;

        if (!File.Exists(asmPath)) { Console.Error.WriteLine($"not found: {asmPath}"); return 2; }

        try
        {
            return mode switch
            {
                "list" => RunList(asmPath, filter),
                "memb" => RunMembers(asmPath, filter, index),
                "dump" => RunDecompile(asmPath, filter, index),
                _ => Fail($"unknown mode: {mode}"),
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"ERROR {ex.GetType().Name}: {ex.Message}");
            return 1;
        }
    }

    private static int Fail(string msg) { Console.Error.WriteLine(msg); return 2; }

    private static CSharpDecompiler MakeDecompiler(string asmPath)
    {
        var resolver = new UniversalAssemblyResolver(asmPath, false, null);
        var targetDir = Path.GetDirectoryName(asmPath);
        if (!string.IsNullOrEmpty(targetDir)) resolver.AddSearchDirectory(targetDir);
        foreach (var runtimeDir in Directory.EnumerateDirectories(
                     @"C:\Program Files\dotnet\shared\Microsoft.NETCore.App"))
            resolver.AddSearchDirectory(runtimeDir);
        resolver.AddSearchDirectory(RoslynDir);

        var settings = new DecompilerSettings
        {
            ThrowOnAssemblyResolveErrors = false,
            ShowXmlDocumentation = false,
            UsingDeclarations = true,
            RemoveDeadCode = false,
            RemoveDeadStores = false,
        };
        return new CSharpDecompiler(asmPath, resolver, settings);
    }

    private static bool Matches(string name, string filter) =>
        string.IsNullOrEmpty(filter) || name.Contains(filter, StringComparison.OrdinalIgnoreCase);

    private sealed record Entry(TypeDefinitionHandle Handle, ITypeDefinition Type);

    /// <summary>
    /// Resolve matches straight from metadata handles so that two TypeDefs sharing
    /// one namespace+name (a generic definition and its non-generic sibling) stay
    /// distinguishable. A name-keyed PEFile lookup would collapse them.
    /// </summary>
    private static List<Entry> Select(string asmPath, string filter, int index,
                                      out CSharpDecompiler dc, out PEFile pe)
    {
        pe = new PEFile(asmPath);
        dc = MakeDecompiler(asmPath);
        var module = dc.TypeSystem.MainModule;

        var all = new List<Entry>();
        foreach (var handle in pe.Metadata.TypeDefinitions)
        {
            ITypeDefinition t;
            try { t = module.GetDefinition(handle); }
            catch { continue; }
            if (t == null) continue;
            if (!Matches(t.FullName, filter)) continue;
            all.Add(new Entry(handle, t));
        }

        var ordered = all
            .OrderBy(e => e.Type.ReflectionName, StringComparer.Ordinal)
            .ThenBy(e => e.Type.Methods.Count())
            .ToList();

        if (index < 0) return ordered;
        if (index >= ordered.Count)
        {
            Console.Error.WriteLine($"index {index} out of range (0..{ordered.Count - 1})");
            return new List<Entry>();
        }
        return new List<Entry> { ordered[index] };
    }

    private static int RunList(string asmPath, string filter)
    {
        var all = Select(asmPath, filter, -1, out _, out var pe);
        int i = 0;
        foreach (var e in all)
        {
            var t = e.Type;
            Console.WriteLine($"{i++,4}  {t.ReflectionName}\tkind={t.Kind}\tmethods={t.Methods.Count()}\tfields={t.Fields.Count()}\tprops={t.Properties.Count()}\ttok=0x{System.Reflection.Metadata.Ecma335.MetadataTokens.GetToken(e.Handle):X8}");
        }
        pe.Dispose();
        Console.Error.WriteLine($"[matches: {all.Count}]");
        return 0;
    }

    private static int RunMembers(string asmPath, string filter, int index)
    {
        if (string.IsNullOrEmpty(filter)) { Console.Error.WriteLine("memb requires a type filter"); return 2; }
        var sel = Select(asmPath, filter, index, out _, out var pe);
        foreach (var e in sel)
        {
            var t = e.Type;
            Console.WriteLine($"=== [{t.ReflectionName}] {t.FullName} ({t.Kind}) ===");
            foreach (var tp in t.TypeParameters) Console.WriteLine($"  tparam {tp.Name}");
            foreach (var f in t.Fields) Console.WriteLine($"  field  {f.ReturnType.ReflectionName} {f.Name}");
            foreach (var p in t.Properties) Console.WriteLine($"  prop   {p.ReturnType.ReflectionName} {p.Name} {{ {(p.CanGet ? "get; " : "")}{(p.CanSet ? "set; " : "")}}}");
            foreach (var m in t.Methods)
            {
                var ps = string.Join(", ", m.Parameters.Select(p => $"{p.Type.ReflectionName} {p.Name}"));
                Console.WriteLine($"  method {m.ReturnType.ReflectionName} {m.Name}({ps})");
            }
            Console.WriteLine();
        }
        pe.Dispose();
        Console.Error.WriteLine($"[types emitted: {sel.Count}]");
        return 0;
    }

    private static int RunDecompile(string asmPath, string filter, int index)
    {
        if (string.IsNullOrEmpty(filter)) { Console.Error.WriteLine("dump requires a type filter"); return 2; }
        var sel = Select(asmPath, filter, index, out var dc, out var pe);
        if (sel.Count == 0) { Console.Error.WriteLine("no types selected"); pe.Dispose(); return 3; }

        int emitted = 0;
        foreach (var e in sel)
        {
            try
            {
                Console.WriteLine($"// ---------- {e.Type.ReflectionName} (metadata {e.Type.MetadataName}) ----------");
                Console.WriteLine(dc.DecompileAsString(new EntityHandle[] { e.Handle }));
                emitted++;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[skip {e.Type.ReflectionName}: {ex.GetType().Name}: {ex.Message}]");
            }
        }
        pe.Dispose();
        Console.Error.WriteLine($"[types emitted: {emitted}/{sel.Count}]");
        return emitted == 0 ? 3 : 0;
    }
}

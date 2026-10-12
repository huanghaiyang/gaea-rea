// GaeaDump - offline managed-assembly inspector for the Gaea RE effort.
//
// Why this exists: nuget.org is unreachable from this sandbox, and REA's deep
// providers (Ghidra/Hopper/IDA) are either unconfigured on this host or
// explicitly reject managed PE targets. A complete ICSharpCode.Decompiler 9.1.0
// already ships inside the local Trae C# extension, so this tool binds to it
// directly and recovers C# source for managed types.
//
// Modes:
//   lsns  <assembly> [filter]        namespaces with type counts
//   types <assembly> [filter]        types with member counts
//   memb  <assembly> <typeFilter>    members (fields, properties, methods)
//   dump  <assembly> <typeFilter>    decompile matching types to C#
//   whole <assembly>                 decompile the entire module to C#
//
// stdout carries the payload; callers redirect it to evidence files. Progress
// notes go to stderr so they never contaminate captured evidence.

using System.Text;
using ICSharpCode.Decompiler;
using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.Metadata;
using ICSharpCode.Decompiler.TypeSystem;

namespace GaeaDump;

internal static class Program
{
    /// <summary>Directory holding the reference decompiler and its dependencies.</summary>
    private const string RoslynDir =
        @"C:\Users\huanh\.trae-cn\extensions\muhammad-sammy.csharp-2.145.21-g154a82fd27-win32-x64\.roslyn";

    private static int Main(string[] args)
    {
        try
        {
            Console.OutputEncoding = new UTF8Encoding(false);
        }
        catch (IOException)
        {
            // No real console handle (redirected under a sandbox); UTF-8 default is fine.
        }

        if (args.Length < 2)
        {
            Console.Error.WriteLine("usage: GaeaDump <lsns|types|memb|dump|whole> <assembly> [filter]");
            return 2;
        }

        string mode = args[0];
        string asmPath = Path.GetFullPath(args[1]);
        string filter = args.Length > 2 ? args[2] : null;

        if (!File.Exists(asmPath))
        {
            Console.Error.WriteLine($"not found: {asmPath}");
            return 2;
        }

        try
        {
            return mode switch
            {
                "lsns" => RunNamespaces(asmPath, filter),
                "types" => RunTypes(asmPath, filter),
                "memb" => RunMembers(asmPath, filter),
                "dump" => RunDecompile(asmPath, filter),
                "whole" => RunWholeModule(asmPath),
                _ => Fail($"unknown mode: {mode}"),
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"ERROR {ex.GetType().Name}: {ex.Message}");
            return 1;
        }
    }

    private static int Fail(string msg)
    {
        Console.Error.WriteLine(msg);
        return 2;
    }

    private static CSharpDecompiler MakeDecompiler(string asmPath)
    {
        var resolver = new UniversalAssemblyResolver(asmPath, false, null);
        var targetDir = Path.GetDirectoryName(asmPath);
        if (!string.IsNullOrEmpty(targetDir))
        {
            resolver.AddSearchDirectory(targetDir);
        }
        foreach (var runtimeDir in Directory.EnumerateDirectories(
                     @"C:\Program Files\dotnet\shared\Microsoft.NETCore.App"))
        {
            resolver.AddSearchDirectory(runtimeDir);
        }
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

    /// <summary>
    /// Build the metadata-FullTypeName for a definition. Gaea's assemblies nest
    /// some types, and a nested metadata name uses '/' as the separator.
    /// </summary>
    private static FullTypeName ToFullTypeName(ITypeDefinition t)
    {
        var ns = t.Namespace ?? string.Empty;
        var segments = t.MetadataName.Split('/');
        var current = new FullTypeName(new TopLevelTypeName(ns, segments[0]));
        for (int i = 1; i < segments.Length; i++)
        {
            current = current.NestedType(segments[i], 0);
        }
        return current;
    }

    private static int RunNamespaces(string asmPath, string filter)
    {
        var dc = MakeDecompiler(asmPath);
        var types = dc.TypeSystem.MainModule.TypeDefinitions.ToList();

        var groups = types
            .Select(t => string.IsNullOrEmpty(t.Namespace) ? "<global>" : t.Namespace)
            .Where(ns => Matches(ns, filter))
            .GroupBy(ns => ns)
            .Select(g => (Ns: g.Key, Count: g.Count()))
            .OrderByDescending(x => x.Count)
            .ThenBy(x => x.Ns, StringComparer.Ordinal);

        foreach (var (ns, count) in groups)
        {
            Console.WriteLine($"{count,6}  {ns}");
        }
        Console.Error.WriteLine($"[types total: {types.Count}]");
        return 0;
    }

    private static int RunTypes(string asmPath, string filter)
    {
        var dc = MakeDecompiler(asmPath);
        var types = dc.TypeSystem.MainModule.TypeDefinitions
            .Where(t => Matches(t.FullName, filter))
            .OrderBy(t => t.FullName, StringComparer.Ordinal);

        int n = 0;
        foreach (var t in types)
        {
            Console.WriteLine(
                $"{t.FullName}\tkind={t.Kind}\tmethods={t.Methods.Count()}\tfields={t.Fields.Count()}\tprops={t.Properties.Count()}");
            n++;
        }
        Console.Error.WriteLine($"[types matched: {n}]");
        return 0;
    }

    private static int RunMembers(string asmPath, string filter)
    {
        if (string.IsNullOrEmpty(filter))
        {
            Console.Error.WriteLine("memb requires a type filter");
            return 2;
        }

        var dc = MakeDecompiler(asmPath);
        var types = dc.TypeSystem.MainModule.TypeDefinitions
            .Where(t => Matches(t.FullName, filter))
            .OrderBy(t => t.FullName, StringComparer.Ordinal)
            .ToList();

        foreach (var t in types)
        {
            Console.WriteLine($"=== {t.FullName} ({t.Kind}) ===");
            foreach (var f in t.Fields)
            {
                Console.WriteLine($"  field  {f.ReturnType.Name} {f.Name}");
            }
            foreach (var p in t.Properties)
            {
                Console.WriteLine($"  prop   {p.ReturnType.Name} {p.Name} {{ {(p.CanGet ? "get; " : "")}{(p.CanSet ? "set; " : "")}}}");
            }
            foreach (var m in t.Methods)
            {
                var ps = string.Join(", ", m.Parameters.Select(p => $"{p.Type.Name} {p.Name}"));
                Console.WriteLine($"  method {m.ReturnType.Name} {m.Name}({ps})");
            }
            Console.WriteLine();
        }
        Console.Error.WriteLine($"[types matched: {types.Count}]");
        return 0;
    }

    private static int RunWholeModule(string asmPath)
    {
        var dc = MakeDecompiler(asmPath);
        Console.WriteLine(dc.DecompileWholeModuleAsString());
        Console.Error.WriteLine("[whole module decompiled]");
        return 0;
    }

    private static int RunDecompile(string asmPath, string filter)
    {
        if (string.IsNullOrEmpty(filter))
        {
            Console.Error.WriteLine("dump requires a type filter (substring, case-insensitive)");
            return 2;
        }

        var dc = MakeDecompiler(asmPath);
        var types = dc.TypeSystem.MainModule.TypeDefinitions
            .Where(t => Matches(t.FullName, filter))
            .OrderBy(t => t.FullName, StringComparer.Ordinal)
            .ToList();

        if (types.Count == 0)
        {
            Console.Error.WriteLine($"no types matched '{filter}'");
            return 3;
        }
        if (types.Count > 80)
        {
            Console.Error.WriteLine($"filter '{filter}' matched {types.Count} types; narrow it (limit 80)");
            return 3;
        }

        using var pe = new PEFile(asmPath);
        var handles = new List<System.Reflection.Metadata.EntityHandle>();
        foreach (var t in types)
        {
            try
            {
                handles.Add(pe.GetTypeDefinition(new TopLevelTypeName(t.Namespace ?? string.Empty, t.MetadataName.Split('/')[0])));
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[skip {t.FullName}: {ex.Message}]");
            }
        }

        if (handles.Count == 0)
        {
            Console.Error.WriteLine("no type handles resolved");
            return 3;
        }

        Console.WriteLine(dc.DecompileAsString(handles));
        Console.Error.WriteLine($"[types emitted: {handles.Count}/{types.Count}]");
        return 0;
    }
}

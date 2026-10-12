// Throwaway probe: find the FullTypeName construction that resolves types in
// the global namespace, then print a short decompiled sample to confirm.
using System.Text;
using ICSharpCode.Decompiler;
using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.Metadata;
using ICSharpCode.Decompiler.TypeSystem;

Console.OutputEncoding = new UTF8Encoding(false);
var dir = @"C:\Users\huanh\.trae-cn\extensions\muhammad-sammy.csharp-2.145.21-g154a82fd27-win32-x64\.roslyn";
var target = @"D:\Gaea 2\Gaea.Engine.dll";

var resolver = new UniversalAssemblyResolver(target, false, null);
resolver.AddSearchDirectory(@"D:\Gaea 2");
resolver.AddSearchDirectory(dir);
var settings = new DecompilerSettings { ThrowOnAssemblyResolveErrors = false };
var dc = new CSharpDecompiler(target, resolver, settings);

var defs = dc.TypeSystem.MainModule.TypeDefinitions.ToList();
var first = defs.First(t => t.MetadataName == "NodeMetadata");
Console.WriteLine($"target: MetadataName='{first.MetadataName}' Name='{first.Name}' ns='{first.Namespace}' Kind={first.Kind}");

void Try(string label, Func<FullTypeName> make)
{
    try
    {
        var ftn = make();
        var s = dc.DecompileTypeAsString(ftn);
        Console.WriteLine($"[{label}] OK  reflectionName='{ftn.ReflectionName}' full='{ftn.FullName}' chars={s.Length}");
        Console.WriteLine("     first line: " + s.Split('\n').FirstOrDefault(l => l.Trim().Length > 0)?.Trim());
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[{label}] FAILED {ex.GetType().Name}: {ex.Message}");
    }
}

Try("A metadata-name as reflectionName", () => new FullTypeName("NodeMetadata"));
Try("B TopLevelTypeName(name)", () => new FullTypeName(new TopLevelTypeName("NodeMetadata")));
Try("C TopLevelTypeName(ns,name)", () => new FullTypeName(new TopLevelTypeName("", "NodeMetadata")));

// Also confirm MetadataFile.GetTypeDefinition resolves by TopLevelTypeName.
try
{
    using var mf = new PEFile(target);
    var h = mf.GetTypeDefinition(new TopLevelTypeName("NodeMetadata"));
    Console.WriteLine($"[D] MetadataFile.GetTypeDefinition -> {h}");
}
catch (Exception ex)
{
    Console.WriteLine($"[D] FAILED {ex.GetType().Name}: {ex.Message}");
}

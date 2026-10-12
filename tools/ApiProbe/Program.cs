// Throwaway probe: enumerate the real FullTypeName API and the supported path
// from an ITypeDefinition to the EntityHandle Decompile() expects.
using System.Reflection;
using System.Text;

Console.OutputEncoding = new UTF8Encoding(false);
var dir = @"C:\Users\huanh\.trae-cn\extensions\muhammad-sammy.csharp-2.145.21-g154a82fd27-win32-x64\.roslyn";
var dcAsm = Assembly.LoadFrom(Path.Combine(dir, "ICSharpCode.Decompiler.dll"));

var ftn = dcAsm.GetType("ICSharpCode.Decompiler.TypeSystem.FullTypeName");
Console.WriteLine($"### {ftn?.FullName}");
if (ftn != null)
{
    foreach (var c in ftn.GetConstructors())
        Console.WriteLine($"  C ({string.Join(", ", c.GetParameters().Select(p => $"{p.ParameterType.Name} {p.Name}"))})");
    foreach (var m in ftn.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly).Where(m => !m.IsSpecialName))
        Console.WriteLine($"  M {m.ReturnType.Name} {m.Name}({string.Join(", ", m.GetParameters().Select(p => $"{p.ParameterType.Name} {p.Name}"))})");
    foreach (var p in ftn.GetProperties())
        Console.WriteLine($"  P {p.PropertyType.Name} {p.Name}");
}

// How do we get an EntityHandle (or TypeDefinitionHandle) for a type?
var mf = dcAsm.GetType("ICSharpCode.Decompiler.Metadata.MetadataFile");
Console.WriteLine($"\n### {mf?.FullName} (type handles)");
if (mf != null)
{
    foreach (var m in mf.GetMethods().Where(m => m.Name.Contains("TypeDefinition") || m.Name.Contains("Type")))
        Console.WriteLine($"  M {m.ReturnType.Name} {m.Name}({string.Join(", ", m.GetParameters().Select(p => $"{p.ParameterType.Name} {p.Name}"))})");
}
var tdh = dcAsm.GetType("ICSharpCode.Decompiler.Metadata.TypeDefinitionHandleExtensions");
Console.WriteLine($"\n### {tdh?.FullName}");
if (tdh != null)
{
    foreach (var m in tdh.GetMethods(BindingFlags.Public | BindingFlags.Static))
        Console.WriteLine($"  M {m.ReturnType.Name} {m.Name}({string.Join(", ", m.GetParameters().Select(p => $"{p.ParameterType.Name} {p.Name}"))})");
}

// Which overloads does Decompile actually have?
var csharp = dcAsm.GetType("ICSharpCode.Decompiler.CSharp.CSharpDecompiler");
Console.WriteLine($"\n### {csharp?.FullName} Decompile* overloads");
if (csharp != null)
{
    foreach (var m in csharp.GetMethods().Where(m => m.Name.StartsWith("Decompile")))
        Console.WriteLine($"  M {m.ReturnType.Name} {m.Name}({string.Join(", ", m.GetParameters().Select(p => $"{p.ParameterType.Name} {p.Name}"))})");
}

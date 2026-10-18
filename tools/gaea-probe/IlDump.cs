// IL reader for the obfuscated helper classes.
//
// WHY
// `Profiles.Shaper` calls methods on classes whose names are obfuscated:
//     \uf4c9\uf065\uf4e7  (array, int, float, int)   -- looks like a blur
//     \uf70f\ue6c9\ue2b3  (float[], float[], int)     -- could be "apply curve" OR "multiply"
//     \uf70f\ue6c9\ue2b4  (float[], float[], int)     -- a blend, probably
// Guessing between "apply a curve" and "multiply element-wise" produces two very different
// renderers from the same signature, so the body decides rather than the name.
//
// The classes are not in the already-decompiled Gaea.Nodes source, so their IL is read here:
// the opcode that each method uses is what identifies what it does.
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Reflection.Emit;

namespace GaeaProbe;

internal static class IlDump
{
    /// <summary>The opcodes that matter for telling these helpers apart.</summary>
    private static readonly Dictionary<short, string> Names = BuildTable();

    private static Dictionary<short, string> BuildTable()
    {
        var m = new Dictionary<short, string>();
        // A focused subset: control flow, calls, arithmetic, memory access, comparison.
        m[0x00] = "nop";    m[0x02] = "ldarg.0"; m[0x03] = "ldarg.1"; m[0x04] = "ldarg.2";
        m[0x05] = "ldarg.3"; m[0x06] = "ldloc.0"; m[0x07] = "ldloc.1"; m[0x08] = "ldloc.2";
        m[0x09] = "ldloc.3"; m[0x0A] = "stloc.0"; m[0x0B] = "stloc.1"; m[0x0C] = "stloc.2";
        m[0x0D] = "stloc.3"; m[0x0E] = "ldarg.s"; m[0x11] = "ldloc.s"; m[0x13] = "stloc.s";
        m[0x14] = "ldnull"; m[0x15] = "ldc.i4.m1";
        for (var i = 0; i <= 8; i++) m[(short)(0x16 + i)] = $"ldc.i4.{i}";
        m[0x1F] = "ldc.i4.s"; m[0x20] = "ldc.i4"; m[0x21] = "ldc.i8";
        m[0x22] = "ldc.r4"; m[0x23] = "ldc.r8";
        m[0x25] = "dup"; m[0x26] = "pop";
        m[0x28] = "call"; m[0x29] = "calli"; m[0x2A] = "ret";
        m[0x2B] = "br.s"; m[0x2C] = "brfalse.s"; m[0x2D] = "brtrue.s";
        m[0x2E] = "beq.s"; m[0x2F] = "bge.s"; m[0x30] = "bgt.s"; m[0x31] = "ble.s";
        m[0x32] = "blt.s"; m[0x33] = "bne.un.s"; m[0x34] = "bge.un.s"; m[0x35] = "bgt.un.s";
        m[0x36] = "ble.un.s"; m[0x37] = "blt.un.s";
        m[0x38] = "br"; m[0x39] = "brfalse"; m[0x3A] = "brtrue";
        m[0x3B] = "beq"; m[0x3C] = "bge"; m[0x3D] = "bgt"; m[0x3E] = "ble";
        m[0x3F] = "blt"; m[0x40] = "bne.un"; m[0x45] = "switch";
        m[0x46] = "ldind.i1"; m[0x47] = "ldind.u1"; m[0x48] = "ldind.i2"; m[0x49] = "ldind.u2";
        m[0x4A] = "ldind.i4"; m[0x4B] = "ldind.u4"; m[0x4C] = "ldind.i8"; m[0x4D] = "ldind.i";
        m[0x4E] = "ldind.r4"; m[0x4F] = "ldind.r8"; m[0x50] = "ldind.ref";
        m[0x51] = "stind.ref"; m[0x52] = "stind.i1"; m[0x53] = "stind.i2"; m[0x54] = "stind.i4";
        m[0x55] = "stind.i8"; m[0x56] = "stind.r4"; m[0x57] = "stind.r8";
        m[0x58] = "add"; m[0x59] = "sub"; m[0x5A] = "mul"; m[0x5B] = "div"; m[0x5C] = "div.un";
        m[0x5D] = "rem"; m[0x5E] = "rem.un"; m[0x5F] = "and"; m[0x60] = "or"; m[0x61] = "xor";
        m[0x62] = "shl"; m[0x63] = "shr"; m[0x64] = "shr.un"; m[0x65] = "neg"; m[0x66] = "not";
        m[0x67] = "conv.i1"; m[0x68] = "conv.i2"; m[0x69] = "conv.i4"; m[0x6A] = "conv.i8";
        m[0x6B] = "conv.r4"; m[0x6C] = "conv.r8"; m[0x6D] = "conv.u4"; m[0x6E] = "conv.u8";
        m[0x6F] = "callvirt"; m[0x70] = "cpobj"; m[0x71] = "ldobj"; m[0x72] = "ldstr";
        m[0x73] = "newobj"; m[0x74] = "castclass"; m[0x75] = "isinst";
        m[0x76] = "conv.r.un"; m[0x79] = "unbox"; m[0x7A] = "throw";
        m[0x7B] = "ldfld"; m[0x7C] = "ldflda"; m[0x7D] = "stfld"; m[0x7E] = "ldsfld";
        m[0x7F] = "ldsflda"; m[0x80] = "stsfld"; m[0x81] = "stobj";
        m[0x8C] = "box"; m[0x8D] = "newarr"; m[0x8E] = "ldlen"; m[0x8F] = "ldelema";
        m[0x90] = "ldelem.i1"; m[0x91] = "ldelem.u1"; m[0x92] = "ldelem.i2"; m[0x93] = "ldelem.u2";
        m[0x94] = "ldelem.i4"; m[0x95] = "ldelem.u4"; m[0x96] = "ldelem.i8"; m[0x97] = "ldelem.i";
        m[0x98] = "ldelem.r4"; m[0x99] = "ldelem.r8"; m[0x9A] = "ldelem.ref";
        m[0x9B] = "stelem.i"; m[0x9C] = "stelem.i1"; m[0x9D] = "stelem.i2"; m[0x9E] = "stelem.i4";
        m[0x9F] = "stelem.i8"; m[0xA0] = "stelem.r4"; m[0xA1] = "stelem.r8"; m[0xA2] = "stelem.ref";
        m[0xD0] = "ldtoken"; m[0xDC] = "endfinally"; m[0xDD] = "leave"; m[0xDE] = "leave.s";
        m[0xE0] = "conv.u";
        return m;
    }

    /// <summary>Operand size in bytes for the opcodes in the focused table.</summary>
    private static int OperandSize(short op)
    {
        // Inline none
        if (op <= 0x0D || op == 0x14 || (op >= 0x15 && op <= 0x1E) || op == 0x25 || op == 0x26 ||
            op == 0x2A || (op >= 0x46 && op <= 0x6E) || op == 0x76 || op == 0x7A ||
            (op >= 0x90 && op <= 0xA2) || op == 0xDC || op == 0xE0)
            return 0;
        // Short branch / short variable / inline i1
        if (op == 0x0E || op == 0x11 || op == 0x13 || op == 0x1F ||
            (op >= 0x2B && op <= 0x37) || op == 0xDE)
            return 1;
        // Inline i4 (also the 4-byte member/string/type tokens)
        if (op == 0x20 || op == 0x22 || op == 0x28 || op == 0x29 || op == 0x38 || (op >= 0x39 && op <= 0x40)
            || op == 0x6F || op == 0x72 || op == 0x73 || op == 0x74 || op == 0x75
            || (op >= 0x79 && op <= 0x81) || op == 0x8C || op == 0x8D || op == 0x8F
            || op == 0xD0 || op == 0xDD)
            return 4;
        if (op == 0x21 || op == 0x23) return 8;
        if (op == 0x45) return 4; // switch: variable, handled by caller
        return 4;
    }

    public static void Dump(Assembly asm, string pattern)
    {
        Console.WriteLine("");
        Console.WriteLine($"  ---- IL dump: types matching '{pattern}' ----");
        var hit = false;
        foreach (var t in SafeTypes(asm))
        {
            if (!Escape(t.Name).Contains(pattern, StringComparison.OrdinalIgnoreCase) &&
                !pattern.Equals("all", StringComparison.OrdinalIgnoreCase)) continue;
            if (!t.IsClass) continue;
            hit = true;
            Console.WriteLine($"\n  class {Escape(t.FullName)}");
            foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.NonPublic |
                                           BindingFlags.Static | BindingFlags.Instance |
                                           BindingFlags.DeclaredOnly))
            {
                if (m.IsSpecialName) continue;
                var ps = string.Join(", ", Array.ConvertAll(m.GetParameters(),
                    p => $"{Short(p.ParameterType)} {p.Name}"));
                Console.WriteLine($"\n    {Short(m.ReturnType)} {Escape(m.Name)}({ps})");
                DumpBody(asm, m);
            }
        }
        if (!hit) Console.WriteLine("  (no matching type)");
    }

    private static IEnumerable<Type> SafeTypes(Assembly a)
    {
        try { return a.GetTypes(); }
        catch (ReflectionTypeLoadException ex)
        {
            return Array.FindAll(ex.Types, t => t != null);
        }
    }

    private static string Short(Type t) => t.IsArray ? Short(t.GetElementType()) + "[]" : t.Name;

    /// <summary>
    /// Printable, but IDENTITY-PRESERVING.
    ///
    /// The first version replaced every private-use character with '?', so `\uf55c\uf0ba\ue6e5` and
    /// `\uf55c\uf0ba\ue6dc` both printed as `???` and the two helper classes became indistinguishable
    /// in the dump -- which defeats the purpose. Code points are written as `uF0E5` so a name is
    /// unique, greppable, and maps straight back to the recovered source.
    /// </summary>
    internal static string Escape(string s)
    {
        if (s == null) return "";
        var sb = new System.Text.StringBuilder();
        foreach (var c in s)
        {
            if (c >= 0xE000 || c < 32 || (c > 126 && c < 0xA0))
                sb.Append('u').Append(((int)c).ToString("X4"));
            else
                sb.Append(c);
        }
        return sb.ToString();
    }

    private static void DumpBody(Assembly asm, MethodInfo m)
    {
        MethodBody body;
        try { body = m.GetMethodBody(); } catch { return; }
        if (body == null) return;
        var il = body.GetILAsByteArray();
        if (il == null || il.Length == 0) return;

        var p = 0;
        var shown = 0;
        while (p < il.Length && shown < 90)
        {
            var at = p;
            short op = il[p++];
            if (op == 0xFE) { op = (short)(0xFE00 | il[p++]); }
            var name = Names.TryGetValue(op, out var nm) ? nm : $"op0x{op:X2}";

            string operand = "";
            if (op == 0x45)
            {
                var n = BitConverter.ToInt32(il, p);
                p += 4 + n * 4;
                operand = $" [{n} targets]";
            }
            else
            {
                var size = OperandSize(op);
                if ((op == 0x28 || op == 0x6F || op == 0x73) && p + 4 <= il.Length)
                {
                    // Resolve the call target: this is what makes the dump diagnostic rather than
                    // a list of bytes.
                    var tok = BitConverter.ToInt32(il, p);
                    try
                    {
                        var tgt = asm.ManifestModule.ResolveMethod(tok);
                        operand = " -> " + Escape(tgt!.DeclaringType?.Name + "." + tgt.Name);
                        var ps = tgt is MethodBase mb ? mb.GetParameters() : null;
                        if (ps != null)
                            operand += "(" + string.Join(",", Array.ConvertAll(ps, x => Short(x.ParameterType))) + ")";
                    }
                    catch { operand = $" tok0x{tok:X8}"; }
                }
                else if (size > 0 && p + size <= il.Length && (op == 0x22 || op == 0x23))
                {
                    operand = " " + (op == 0x22
                        ? BitConverter.ToSingle(il, p).ToString("G7")
                        : BitConverter.ToDouble(il, p).ToString("G9"));
                }
                else if (size > 0 && p + size <= il.Length &&
                         (op == 0x2B || (op >= 0x2C && op <= 0x37)))
                {
                    operand = $" -> IL_{p + 1 + (sbyte)il[p]:X4}";
                }
                p += size;
            }
            Console.WriteLine($"      IL_{at:X4} {name}{operand}");
            shown++;
        }
        if (p < il.Length) Console.WriteLine($"      ... ({il.Length} bytes total)");
    }
}

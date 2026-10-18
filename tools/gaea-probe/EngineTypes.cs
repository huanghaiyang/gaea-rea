using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace GaeaProbe;

/// <summary>Lazy reflection handles for the engine types the oracle needs.</summary>
internal static class EngineTypes
{
    public static readonly Type? Map = Find("Map");
    public static readonly Type? Resolution = Find("Resolution");
    public static readonly Type? Float2 = Find("Float2");

    private static Type? Find(string simpleName)
    {
        foreach (var a in Oracle.Assemblies)
        {
            Type[] ts;
            try { ts = a.GetTypes(); }
            catch (ReflectionTypeLoadException ex) { ts = ex.Types.Where(t => t != null).ToArray()!; }
            var hit = ts.FirstOrDefault(t => t.Name == simpleName && t.IsPublic);
            if (hit != null) return hit;
        }
        return null;
    }

    public static bool IsMap(object? v) => v != null && Map != null && Map.IsInstanceOfType(v);

    public static bool IsMapArray(object? v) =>
        v is Array arr && Map != null && arr.GetType().GetElementType() == Map;

    public static object? MapData(object map) =>
        Map!.GetMethod("ToArray", Type.EmptyTypes)!.Invoke(map, null);

    public static (int w, int h) MapSize(object map)
    {
        var res = Map!.GetProperty("Resolution")!.GetValue(map)!;
        var x = (int)Resolution!.GetField("X")!.GetValue(res)!;
        var y = (int)Resolution!.GetField("Y")!.GetValue(res)!;
        return (x, y);
    }

    /// <summary>Every channel's flat array, or null when the map has one channel.</summary>
    public static float[]?[]? MapChannels(object map)
    {
        var n = (int)(Map!.GetProperty("NumberOfChannels")?.GetValue(map) ?? 1);
        if (n <= 1) return null;
        var indexer = Map.GetProperty("Item", new[] { typeof(int) })
                      ?? Map.GetProperties().FirstOrDefault(p => p.GetIndexParameters().Length == 1);
        if (indexer == null) return null;
        var dataProp = indexer.PropertyType.GetProperty("Data");
        if (dataProp == null) return null;
        var outArr = new float[]?[n];
        for (var i = 0; i < n; i++)
        {
            var ch = indexer.GetValue(map, new object[] { i });
            outArr[i] = (float[]?)dataProp.GetValue(ch);
        }
        return outArr;
    }
}

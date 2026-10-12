#!/usr/bin/env python3
"""Build docs/kernels-inventory.json.

Field order and types come from evidence/kernels/fields-ordered.json (first,
unmerged occurrence in the GaeaDump raw dump). Obfuscated parameter-struct
fields are annotated with the node-facing semantics recovered in
evidence/kernels/obfuscated-field-decoding.json.

observed  = read directly from managed metadata or demangled native symbols
inferred  = analyst interpretation, always labelled
"""
import json
import os
import re
import sys

WS = r"D:\sgames\gaea-rea"
EV = os.path.join(WS, "evidence", "kernels")
ORDERED = os.path.join(EV, "fields-ordered.json")
NSYM = os.path.join(EV, "native-symbols.json")
CALLS = os.path.join(EV, "node-callsites.json")
DECODED = os.path.join(EV, "obfuscated-field-decoding.json")
OUT = os.path.join(WS, "docs", "kernels-inventory.json")

PUA = re.compile(r"[\ue000-\uf8ff]")

KERNEL_LINKS = {
    "ParallelErosion": {
        "managedBinding": "QuadSpinner.Gaea.Engine.SyclFunctions.ParallelErosion",
        "nativeNamespaces": ["parallel_erosion", "parallel_erosion2"],
        "cppcliWrappers": ["QuadSpinner.ErosionWrapper (Gaea.CE.dll)"],
        "nodeEntryPoints": ["Erosions.PE"],
        "nodes": ["Erosion2", "EasyErosion"],
    },
    "Thermal2": {
        "managedBinding": "QuadSpinner.Gaea.Engine.SyclFunctions.Thermal2",
        "nativeNamespaces": ["thermal"],
        "cppcliWrappers": [],
        "nodeEntryPoints": ["Erosions.Thermal2", "Simulations.Thermal"],
        "nodes": ["Erosion2", "EasyErosion", "Thermal", "Thermal2"],
    },
    "ThermalShaper": {
        "managedBinding": "QuadSpinner.Gaea.Engine.SyclFunctions.ThermalShaper",
        "nativeNamespaces": ["thermal_shaper"],
        "cppcliWrappers": ["QuadSpinner.ErosionWrapperTS (Gaea.TS.dll)"],
        "nodeEntryPoints": ["ThermalShaper.Build", "Profiles.ThermalShaper"],
        "nodes": ["ThermalShaper"],
    },
    "Flow": {
        "managedBinding": "QuadSpinner.Gaea.Engine.SyclFunctions.Flow",
        "nativeNamespaces": ["flow"],
        "cppcliWrappers": [],
        "nodeEntryPoints": ["Simulations.Flow2"],
        "nodes": ["FlowMap", "FlowMapClassic", "Dusting", "SuperColor", "Scree",
                  "Shrubs", "Trees", "Texturize", "Anastomosis"],
    },
    "ColorTransport": {
        "managedBinding": "QuadSpinner.Gaea.Engine.SyclFunctions.ColorTransport",
        "nativeNamespaces": ["color_transport"],
        "cppcliWrappers": [],
        "nodeEntryPoints": ["ColorTransport.Simulation (direct)"],
        "nodes": ["Cartography", "Weathering", "SuperColor", "ColorErosion",
                  "Dusting", "Texturize"],
    },
    "MedianFilter": {
        "managedBinding": "QuadSpinner.Gaea.Engine.SyclFunctions.MedianFilter",
        "nativeNamespaces": ["median_filter"],
        "cppcliWrappers": [],
        "nodeEntryPoints": ["MedianFilter.ResolutionIndependent / Classic"],
        "nodes": ["Median"],
    },
    "Cellular3D": {
        "managedBinding": "QuadSpinner.Gaea.Engine.SyclFunctions.Cellular3D",
        "nativeNamespaces": ["Cellular3D"],
        "cppcliWrappers": [],
        "nodeEntryPoints": ["Cellular3D.Render (direct)"],
        "nodes": ["Cellular3D", "IceFloe", "Shrubs", "Trees"],
    },
    "MeshRasterizer": {
        "managedBinding": "QuadSpinner.Gaea.Engine.SyclFunctions.MeshRasterizer",
        "nativeNamespaces": ["MeshRasterizer", "mesh_rasterizer"],
        "cppcliWrappers": [],
        "nodeEntryPoints": ["MeshRasterizer.RenderMesh / RasterizePointCloud"],
        "nodes": ["Object", "Meshify", "Transform3D", "TriplanarDisplacement",
                  "MeshWarp", "TextureBaker"],
    },
    "NativeLighting": {
        "managedBinding": "QuadSpinner.Gaea.Engine.SyclFunctions.NativeLighting",
        "nativeNamespaces": ["lighting", "lighting_x", "ispc_lighting"],
        "cppcliWrappers": [],
        "nodeEntryPoints": ["SyclFunctions.Shade / SunLightIntegral"],
        "nodes": ["Sunlight", "LightX", "AO", "Occlusion", "Shade", "Normals"],
    },
    "Debris": {
        "managedBinding": "QuadSpinner.Gaea.Engine.SyclFunctions.Debris",
        "nativeNamespaces": ["Debris"],
        "cppcliWrappers": [],
        "nodeEntryPoints": ["debrisCore.Simulation"],
        "nodes": ["Debris", "Stones", "Rockscape"],
    },
    "Snow": {
        "managedBinding": None,
        "nativeNamespaces": [],
        "nativeNamespaceNote": "the C++/CLI core is compiled into Gaea.CS.dll with no separately named namespace in the shipped binaries",
        "cppcliWrappers": ["QuadSpinner.ErosionWrapperS (Gaea.CS.dll)"],
        "nodeEntryPoints": ["Simulations.Snow"],
        "nodes": ["Snow", "Snowfield", "Shrubs", "Trees"],
    },
    "Water": {
        "managedBinding": None,
        "nativeNamespaces": ["lake (Gaea.Native.dll)"],
        "cppcliWrappers": ["QuadSpinner.ErosionWrapperW (Gaea.CW.dll)"],
        "nodeEntryPoints": ["Waters.Lakes", "Waters.Sea"],
        "nodes": ["Lake", "Sea", "Rivers", "HydroFix"],
    },
    "ClassicErosion": {
        "managedBinding": None,
        "nativeNamespaces": ["parallel_erosion (CPU path in Gaea.Native.dll)"],
        "cppcliWrappers": ["QuadSpinner.ErosionWrapper (Gaea.CE.dll)"],
        "nodeEntryPoints": ["Erosions.Classic"],
        "nodes": ["Erosion", "Wizard"],
    },
    "Resampling": {
        "managedBinding": None, "nativeNamespaces": ["resampling"], "cppcliWrappers": [],
        "nodeEntryPoints": ["Engine internal (pyramid build)"], "nodes": [],
    },
    "StampInstancer": {
        "managedBinding": None, "nativeNamespaces": ["stamp_instancer"],
        "cppcliWrappers": [], "nodeEntryPoints": ["unresolved"], "nodes": [],
    },
}


def split_field(raw):
    m = re.match(r"^(?P<t>[^\s]+(?:<[^>]*>)?(?:\[\]|\*|&)?)\s*(?P<n>.*)$", raw.strip())
    if not m:
        return raw.strip(), ""
    t, n = m.group("t"), m.group("n").strip()
    if t.count("<") != t.count(">"):
        return raw.strip(), ""
    return t, n


def main():
    ordered = json.load(open(ORDERED, encoding="utf-8"))
    nsym = json.load(open(NSYM, encoding="utf-8"))
    calls = json.load(open(CALLS, encoding="utf-8"))
    decoded = json.load(open(DECODED, encoding="utf-8"))

    # struct name -> per-ordinal observed semantics
    sem = {}
    for kernel, blob in decoded["structs"].items():
        for f in blob["fields"]:
            sem[(kernel, f["ordinal"])] = f

    records = []

    def field_records(asm, tfn, kind_of_type, kernel_hint=None):
        rec = ordered[asm].get(tfn)
        if not rec:
            return None, None
        out = []
        for i, raw in enumerate(rec["fields"]):
            t, n = split_field(raw)
            obf = bool(PUA.search(n)) or not n
            fr = {"ordinal": i + 1, "name": None if obf else n, "type": t,
                  "nameIsObfuscated": obf, "evidenceClass": "observed"}
            if obf:
                fr["obfuscatedName"] = "".join("U+%04X" % ord(c) for c in n) if n else None
                key = (kernel_hint, i + 1)
                if key in sem and sem[key]["usages"]:
                    fr["observedNodeSemantics"] = sem[key]["observedSemantics"]
                    fr["semanticsEvidence"] = (
                        "evidence/kernels/obfuscated-field-decoding.json "
                        "(initializer assignments in evidence/decompiled/Gaea.Nodes.whole.cs)")
            out.append(fr)
        return out, rec["methods"]

    # ---- C++/CLI assemblies ----------------------------------------------
    for asm in ("Gaea.CE.dll", "Gaea.CS.dll", "Gaea.CW.dll", "Gaea.TS.dll"):
        for tfn, rec in sorted(ordered[asm].items()):
            if not (tfn.startswith("QuadSpinner.") or tfn in
                    ("Erosion", "LandscapeLayer", "BitMap<float>")):
                continue
            alg = tfn.split(".")[-1]
            kind = {"Class": "wrapper" if "Wrapper" in tfn else "class",
                    "Struct": "struct", "Delegate": "delegate",
                    "Enum": "enum"}.get(rec["kind"], "class")
            fields = []
            for i, raw in enumerate(rec["fields"]):
                t, n = split_field(raw)
                fields.append({"ordinal": i + 1, "name": n or None, "type": t,
                               "nameIsObfuscated": bool(PUA.search(n)) or not n,
                               "evidenceClass": "observed"})
            records.append({
                "algorithm": alg, "assembly": asm, "typeFullName": tfn, "kind": kind,
                "fields": fields,
                "methods": [{"signature": m, "evidenceClass": "observed"}
                            for m in rec["methods"]],
                "fieldCount": len(fields), "methodCount": len(rec["methods"]),
                "evidence": "assembly=%s; type=%s; tool=GaeaDump memb (metadata order "
                            "preserved)" % (asm, tfn),
                "evidenceClass": "observed",
            })
        mod = ordered[asm].get("<Module>")
        if mod:
            records.append({
                "algorithm": "<global functions>", "assembly": asm,
                "typeFullName": "<Module>", "kind": "module-globals",
                "fields": [{"ordinal": i + 1, "name": split_field(f)[1] or None,
                            "type": split_field(f)[0], "evidenceClass": "observed"}
                           for i, f in enumerate(mod["fields"])],
                "methods": [{"signature": m, "evidenceClass": "observed"}
                            for m in mod["methods"]],
                "fieldCount": len(mod["fields"]), "methodCount": len(mod["methods"]),
                "evidence": "assembly=%s; type=<Module>; tool=GaeaDump memb" % asm,
                "evidenceClass": "observed",
            })

    # ---- managed SyclFunctions / Sycl ------------------------------------
    for tfn, rec in sorted(ordered["Gaea.Engine.dll"].items()):
        if "SyclFunctions" not in tfn and not tfn.startswith(
                "QuadSpinner.Gaea.Engine.Sycl."):
            continue
        short = tfn.replace("QuadSpinner.Gaea.Engine.", "")
        kernel_hint = None
        if short.startswith("SyclFunctions.") and short.endswith(".Parameters"):
            kernel_hint = short.split(".")[1]
        if short.endswith(".Parameters"):
            kind = "parameters"
        elif rec["kind"] == "Enum":
            kind = "enum"
        elif rec["kind"] == "Struct":
            kind = "struct"
        elif short.startswith("SyclFunctions."):
            kind = "kernel-class"
        elif short.startswith("Sycl."):
            kind = "sycl-runtime"
        else:
            kind = "nested-type"
        fields, _ = field_records("Gaea.Engine.dll", tfn, kind, kernel_hint)
        alg = (short.split(".")[1] if short.startswith("SyclFunctions.")
               else short.split(".")[1])
        records.append({
            "algorithm": alg, "assembly": "Gaea.Engine.dll", "typeFullName": tfn,
            "kind": kind, "fields": fields,
            "methods": [{"signature": m, "evidenceClass": "observed"}
                        for m in rec["methods"]],
            "fieldCount": len(fields), "methodCount": len(rec["methods"]),
            "evidence": "assembly=Gaea.Engine.dll; type=%s; tool=GaeaDump memb" % tfn,
            "evidenceClass": "observed",
        })

    # ---- native kernels --------------------------------------------------
    for dll, blob in nsym["dlls"].items():
        for name, m in sorted(blob["methods"].items()):
            ns = m["namespace"]
            if ns in ("std", "Concurrency", "Assimp", "aiMaterial", "aiNode", "aiScene",
                      "boost", "hipsycl", "sycl", "exprtk", "details"):
                continue
            sigs = ["%s::%s(%s)" % (m["class"] or ns, m["method"], o["args"])
                    for o in m["overloads"]]
            records.append({
                "algorithm": ns, "assembly": dll,
                "typeFullName": "%s::%s" % (ns, m["class"]) if m["class"] else ns,
                "kind": "native-kernel-method",
                "fields": [], "fieldCount": 0,
                "methods": [{"signature": s, "evidenceClass": "observed"} for s in sigs],
                "methodCount": len(sigs),
                "evidence": "assembly=%s; demangled MSVC symbol (dbghelp "
                            "UnDecorateSymbolName); namespace=%s" % (dll, ns),
                "evidenceClass": "observed",
                "bufferElementTypes": m["bufferElementTypes"],
                "bufferDims": m["bufferDims"],
                "syclItems": m["syclItems"],
                "vectorTypes": m["vectorTypes"],
            })

    doc = {
        "schema": "gaea-kernels-inventory/1",
        "scope": "QuadSpinner Gaea 2.3.1 kernel parameter surfaces and algorithm signatures",
        "targets": {
            "cppcliWrappers": ["Gaea.CE.dll", "Gaea.CS.dll", "Gaea.CW.dll", "Gaea.TS.dll"],
            "managedBindings": ["Gaea.Engine.dll: QuadSpinner.Gaea.Engine.SyclFunctions, "
                                "QuadSpinner.Gaea.Engine.Sycl"],
            "backendLoader": "Gaea.Dv.dll: QuadSpinner.DetectDevices.SYCL",
            "nativeBackends": ["Gaea.Native.dll", "Gaea.oneAPI.dll",
                               "Gaea.AdaptiveCpp.dll", "Gaea.AdaptiveCpp.HIP.dll"],
        },
        "method": {
            "managed": "GaeaDump memb/types/lsns (System.Reflection.Metadata over the "
                       "shipped PE images); field order preserved from raw dumps",
            "native": "ASCII symbol-table extraction + dbghelp!UnDecorateSymbolName; "
                      "no disassembly, no execution",
            "obfuscatedNames": "PUA field names joined to decompiled node object "
                               "initializers (evidence/kernels/obfuscated-field-decoding.json)",
            "nodeCallSites": "evidence/decompiled/Gaea.Nodes.whole.cs",
        },
        "confidenceVocabulary": {
            "observed": "read directly from metadata or demangled symbol text",
            "inferred": "analyst interpretation, explicitly labelled",
        },
        "limitations": [
            "Gaea.Native/oneAPI/AdaptiveCpp ship no PDB and were not disassembled: only "
            "symbol names, signatures, string tables and import linkage were read. "
            "Bodies, constants, branch structure and numeric defaults remain unknown.",
            "Parameter struct ABIs: metadata order is recorded, but the native C++ struct "
            "layout was not read, so byte offsets are not asserted.",
            "Gaea.CE/CS/CW/TS.dll contain no textual reference to a backend library; the "
            "backend is chosen at runtime through function pointers resolved in "
            "Gaea.Dv.dll / Gaea.Engine.dll.",
            "Obfuscated names are replaced by 3 private-use-area code points (renaming, not "
            "an encoding). Their meaning is stated only where a decompiled node assigns a "
            "readable quantity to that exact field.",
            "The decompiled node source is partial (2 MB of Gaea.Nodes.dll): node call "
            "sites that are not in it remain unmapped.",
        ],
        "cppcliNativeApi": {
            "library": "Gaea.Native.dll",
            "evidence": "contiguous export-name block in the shipped string table; the same "
                        "names appear as string literals in Gaea.Engine.dll and are resolved "
                        "through SyclLibrary.LoadFunction(handle, functionName)",
            "exports": ["FastBlur4_Process", "FastBlur_Process", "HydrologicalCorrection",
                        "Lake_Create", "MathX_Compute", "MathX_FreeErrorMessage",
                        "MathX_Function", "MeshPort_Destroy", "MeshPort_HeightmapToMesh",
                        "MeshPort_HeightmapToMeshWithAdaptiveSubdivision", "MeshPort_Load",
                        "MeshPort_PointCloudToMesh", "MeshPort_Save",
                        "MeshPort_SavePointCloud", "MeshPort_TrianglesToMesh",
                        "ParallelErosion_Erode", "Rivers", "ShadeIspc",
                        "SunLightIntegralIspc"],
        },
        "kernels": KERNEL_LINKS,
        "nodeCallSites": [
            {"symbol": c["symbol"], "ownerType": c["ownerType"], "line": c["line"],
             "evidence": "evidence/decompiled/Gaea.Nodes.whole.cs"}
            for c in calls
        ],
        "records": records,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1)

    lines = ["records=%d" % len(records)]
    for r in records:
        lines.append("%-20s %-22s %-60s f=%-3d m=%d" % (
            r["kind"], r["assembly"], r["typeFullName"], r["fieldCount"], r["methodCount"]))
    with open(os.path.join(EV, "_inventory_summary.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print("wrote", OUT, "records:", len(records))
    return 0


if __name__ == "__main__":
    sys.exit(main())

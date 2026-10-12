#!/usr/bin/env python3
"""Generate docs/kernels-backends.md and docs/kernels-node-mapping.md."""
import json
import os
import re
import sys
from collections import Counter, OrderedDict

WS = r"D:\sgames\gaea-rea"
EV = os.path.join(WS, "evidence", "kernels")
DOCS = os.path.join(WS, "docs")
ORDERED = json.load(open(os.path.join(EV, "fields-ordered.json"), encoding="utf-8"))
NSYM = json.load(open(os.path.join(EV, "native-symbols.json"), encoding="utf-8"))
CENSUS = json.load(open(os.path.join(EV, "namespace-census.json"), encoding="utf-8"))
CALLS = json.load(open(os.path.join(EV, "node-callsites.json"), encoding="utf-8"))
SRC = os.path.join(WS, "evidence", "decompiled", "Gaea.Nodes.whole.cs")
NODES = os.path.join(WS, "web", "data", "nodes.json")
PUA = re.compile(r"[\ue000-\uf8ff]")
CLASS = re.compile(r"^\t*(?:(?:public|internal|private|sealed|abstract|static|partial)\s+)*"
                   r"(?:class|struct)\s+([A-Za-z0-9_]+)")
METH = re.compile(r"^\t*(?:(?:public|private|internal|static|protected|override|virtual|async)\s+)*"
                  r"(?:[\w<>,\[\]\.\?]+\s+)?([A-Za-z0-9_]+)\s*\(")


def esc(s):
    return "".join(c if ord(c) < 0xE000 else "\\u%04X" % ord(c) for c in s)


def md_table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "|".join(["---"] * len(head)) + "|"]
    for r in rows:
        out.append("| " + " | ".join("" if c is None else str(c) for c in r) + " |")
    return "\n".join(out)


def owner_and_method(lines, decls, meths, i):
    ind = len(lines[i]) - len(lines[i].lstrip("\t"))
    owner = meth = None
    for (j, d, n) in reversed(decls):
        if j < i and d < ind:
            owner = n
            break
    for (j, d, m) in reversed(meths):
        if j < i and d < ind:
            meth = m
            break
    return owner, meth


# ---------------------------------------------------------------- backends
BACKEND_FACTS = [
    ("Gaea.Native.dll", "4 653 568",
     "MSVC x64 mixed C++ library; **no SYCL**. `ispc` appears 58x -> Intel ISPC "
     "SPMD compilation for the lighting path (`ispc_lighting`).",
     "CPU (own thread pool / ISPC SIMD)"),
    ("Gaea.oneAPI.dll", "15 393 280",
     "Intel oneAPI DPC++: `sycl` 35 648x, `oneAPI` 6 408x, `spirv` 186x, "
     "`level_zero` 39x, `opencl` 130x, `Intel` 931x, plus `avx512` 18x (CPU device).",
     "Intel GPU via Level Zero, any OpenCL device, x86-64 CPU via AVX-512"),
    ("Gaea.AdaptiveCpp.dll", "28 449 280",
     "AdaptiveCpp (ex hipSYCL): `hipsycl` 51 174x, `acpp` 45 041x, `cuda` 810x, "
     "`ptx` 18x -> the CUDA backend; the folder also ships `cudart64_12.dll`.",
     "NVIDIA GPU via CUDA"),
    ("Gaea.AdaptiveCpp.HIP.dll", "38 938 112",
     "Same AdaptiveCpp core (`hipsycl` 91 302x) plus `hip` 93 361x and "
     "`OpenCL` 6 265x -> the AMD/HIP backend.",
     "AMD GPU via HIP/ROCm, plus Generic/OpenCL"),
]


def build_backends():
    L = []
    A = L.append
    A("# Gaea 2.3.1 — backends, and what CE / CS / CW / TS actually are")
    A("")
    A("Everything in this document is derived from shipped file metadata, string tables "
      "and demangled symbols; nothing was executed. Items marked *inferred* are the "
      "analyst's reading.")
    A("")
    A("## 1. There are two independent axes, not one")
    A("")
    A("The brief that started this investigation proposed that `Gaea.TS/CS/CW` might be "
      "\"different precision or different SIMD-width variants\" of `Gaea.CE`. **The "
      "evidence refutes that** (section 3). The shipped product has two orthogonal axes:")
    A("")
    A("| axis | members | what differs |")
    A("|---|---|---|")
    A("| **algorithm family** | `Gaea.CE.dll` (erosion, fluvial+thermal), `Gaea.CS.dll` "
      "(snow accumulation/melt), `Gaea.CW.dll` (lakes/sea water level), `Gaea.TS.dll` "
      "(thermal/profile shaping) | completely different parameter blocks and different "
      "entry points |")
    A("| **execution backend** | `Gaea.Native.dll` (CPU/ISPC), `Gaea.oneAPI.dll` "
      "(oneAPI/DCP++), `Gaea.AdaptiveCpp.dll` (CUDA), `Gaea.AdaptiveCpp.HIP.dll` (HIP) | "
      "same algorithm, different device and runtime |")
    A("")
    A("The four C++/CLI assemblies are **algorithm variants**. The four native DLLs are "
      "**device backends**. The two sets share no file names, no namespaces and no "
      "parameter structs.")
    A("")
    A("## 2. The backend DLLs")
    A("")
    A(md_table(["assembly", "bytes", "observed platform evidence (string-table counts)",
                "inferred target"], [[a, b, c, d] for a, b, c, d in BACKEND_FACTS]))
    A("")
    A("Supporting runtime DLLs present in `D:\\Gaea 2` (observed, by file name): "
      "`sycl8.dll`, `pi_level_zero.dll`, `pi_opencl.dll`, `pi_unified_runtime.dll`, "
      "`ur_loader.dll`, `ur_adapter_level_zero.dll`, `ur_adapter_opencl.dll`, "
      "`ur_win_proxy_loader.dll`, `acpp-rt.dll`, `acpp-common.dll`, `cudart64_12.dll`, "
      "`FNSIMD.dll`, `libmmd.dll`, `svml_dispmd.dll`, `OpenCL.dll`.")
    A("")
    A("`inferred`: `sycl8`/`pi_*`/`ur_*` belong to the oneAPI (Intel DPC++ / Unified "
      "Runtime) stack, while `acpp-*` and the HIP/CUDA payloads belong to AdaptiveCpp. "
      "`Gaea.Native.dll` links neither, which is consistent with it being a plain "
      "MSVC/ISPC CPU library.")
    A("")
    A("## 3. Why CE / CS / CW / TS are algorithm variants, not precision variants")
    A("")
    A("Evidence, all `observed` from `GaeaDump memb` and from the decompiled node code:")
    A("")
    rows = []
    for asm, tfn, letter in [("Gaea.CE.dll", "QuadSpinner.ErosionWrapper", "CE"),
                             ("Gaea.CS.dll", "QuadSpinner.ErosionWrapperS", "CS"),
                             ("Gaea.CW.dll", "QuadSpinner.ErosionWrapperW", "CW"),
                             ("Gaea.TS.dll", "QuadSpinner.ErosionWrapperTS", "TS")]:
        rec = ORDERED[asm][tfn]
        names = set()
        for m in rec["methods"]:
            mm = re.match(r"^[A-Za-z0-9_\[\]<>,\.\*]+\s+([A-Za-z0-9_\.]+)\(", m)
            if mm and not mm.group(1).startswith("."):
                names.add(mm.group(1))
            elif "Delegate" in m:
                names.add("(delegate type)")
        rows.append([letter, asm, len(rec["fields"]), len(rec["methods"]),
                     "; ".join(sorted(names))])
    A(md_table(["letter", "assembly", "fields", "methods",
                "distinct method names (observed)"], rows))
    A("")
    A("Distinguishing parameter blocks (each list is `observed` field names, unique to "
      "that assembly):")
    A("")
    A("* **CS** (`ErosionWrapperS`, 49 fields): `m_snowfall_duration`, "
      "`m_snowfall_intensity`, `m_post_snowfall_duration`, `m_melting`, `m_snow_line`, "
      "`m_snowfall_mask`, `m_melt_mask`, `m_snow_output`, plus three *integer mirrors* "
      "`m_iduration` / `m_isnowfall_duration` / `m_ipost_snowfall_duration`, and the "
      "output arrays `snow`, `hardmask`, `softmask`. Its `ErodeTerrain` takes two extra "
      "input maps (`snowfall_area`, `melt_area`).")
    A("* **CW** (`ErosionWrapperW`, 20 fields): `m_precipitation`, "
      "`m_precipitation_amount`, `m_evaporation`, `m_lake_size_bias`, `m_shore_size`, "
      "`m_altitude_bias`, `m_size_bias`, `m_water_floor`, `m_precipitation_mask`, "
      "`m_evaporation_mask`; outputs `depth`, `shore`, `surface`; and it is the **only** "
      "wrapper with `FloodFill(...)` and `EdgeFill(...)` entry points.")
    A("* **TS** (`ErosionWrapperTS`, 44 fields): the only module whose `SetVars` accepts "
      "just `resolution, size, scale, duration, intensity`, and whose `ErodeTerrain` "
      "takes only the heightmap; `m_intensity` and `m_influence` are its only own "
      "parameters, and 39 of its 44 fields are unreachable from its own API.")
    A("")
    A("A precision or SIMD-width variant would keep the same field names and only change "
      "the element type. Every one of these assemblies instead stores a **different set "
      "of named parameters**, and `Gaea.CW.dll` even exposes **different operations** "
      "(`FloodFill`, `EdgeFill`). There is also no element-type difference: all four "
      "store `Single[]` output arrays and `Double` scalar parameters.")
    A("")
    A("### 3.1 Where each variant is used (observed in `Gaea.Nodes.dll`)")
    A("")
    A(md_table(["variant", "helper that instantiates it", "decompiled line", "nodes reached"],
               [["`ErosionWrapper` (CE)", "`Erosions.Classic`",
                 "Gaea.Nodes.whole.cs:696", "`Erosion`, `Wizard`"],
                ["`ErosionWrapper` (CE)", "`Simulations.Thermal`", "4771 / 4800",
                 "`Thermal`"],
                ["`ErosionWrapperS` (CS)", "`Simulations.Snow`", "4568 / 4586",
                 "`Snow`, `Snowfield`, `Shrubs`, `Trees`"],
                ["`ErosionWrapperW` (CW)", "`Waters.Lakes`", "7095 / 7109",
                 "`Lake`, `Rivers`"],
                ["`ErosionWrapperW` (CW)", "`Waters.Sea`", "7132 / 7160",
                 "`Sea` (uses `EdgeFill`)"],
                ["`ErosionWrapperTS` (TS)", "`Profiles.ThermalShaper`", "3957 / 3961",
                 "`ThermalShaper`"]]))
    A("")
    A("`inferred`: the letters expand to the *families* the code uses them for — "
      "**C**ompute **E**rosion / **S**now / **W**ater, and **T**hermal **S**haper. The "
      "expansions are inferred; the usages above are observed.")
    A("")
    A("## 4. Kernel availability per backend")
    A("")
    A("Counts are occurrences of the namespace token in the demangled-symbol/string "
      "census of each assembly (`evidence/kernels/native-symbols.json`); `-` means the "
      "namespace was not found at all.")
    A("")
    ns_all = OrderedDict()
    for dll, blob in CENSUS.items():
        for ns, n in blob["namespaces"].items():
            ns_all.setdefault(ns, {})[dll] = n
    skip = {"std", "Concurrency", "Assimp", "aiMaterial", "aiNode", "aiScene", "boost",
            "exprtk", "tinyobj", "details"}
    dlls = ["Gaea.Native.dll", "Gaea.oneAPI.dll", "Gaea.AdaptiveCpp.dll",
            "Gaea.AdaptiveCpp.HIP.dll"]
    rows = []
    for ns, per in sorted(ns_all.items()):
        if ns in skip:
            continue
        if re.match(r"^[A-Z0-9]{2,}$", ns):          # mangling back-reference artefacts
            continue
        if not any(per.get(d, 0) for d in dlls):
            continue
        rows.append([ns] + [per.get(d, "**-**") for d in dlls])
    A(md_table(["native namespace"] + [d.replace("Gaea.", "").replace(".dll", "")
                                       for d in dlls], rows))
    A("")
    A("Notable asymmetries (`observed`):")
    A("")
    A("* `parallel_erosion2` exists **only** in the two AdaptiveCpp builds -> a second "
      "erosion core shipped only for GPU backends (`inferred`: a redesign used for the "
      "CUDA/HIP path).")
    A("* `lighting_x` exists only in AdaptiveCpp; `Debris` only in AdaptiveCpp; "
      "`mesh_rasterizer`/`MeshRasterizer` in oneAPI + AdaptiveCpp but **not** in "
      "`Gaea.Native.dll`; `median_filter` likewise absent from `Gaea.Native.dll`.")
    A("* `ispc_lighting` exists only in `Gaea.Native.dll` -> the CPU backend has its own "
      "ISPC lighting implementation.")
    A("* `lake`, `interopmesh`, `mesh_port`, `shm`, `Assimp`, `tinyobj`, `exprtk` are "
      "CPU-library facilities in `Gaea.Native.dll` (mesh IO, shared memory, expressions).")
    A("* `texture3d`, `stamp_instancer` and `arrakis` appear only in the AdaptiveCpp "
      "builds; `arrakis` is an AdaptiveCpp runtime component rather than a terrain "
      "kernel (`inferred`).")
    A("")
    A("* `parallel_erosion` is present in **all four** native libraries, including the CPU "
      "one (`Gaea.Native.dll`, 36 scope tokens) -> the CPU backend has its own particle "
      "erosion core, the counterpart of the C++/CLI `ErosionWrapper`. `Gaea.Native.dll` "
      "additionally carries `FastNoiseSIMD_internal` and `SpectralLayer` scopes -> the CPU "
      "library also hosts its own noise/spectral-noise generators, which are not exposed "
      "through `SyclFunctions` (`observed` scopes, `inferred` role).")
    A("* `U__acpp_unnamed_kernel` (4 901 / 4 997 occurrences) is AdaptiveCpp's mangling for "
      "kernels whose type has no name -- `observed` as a naming scheme, and the reason a "
      "few AdaptiveCpp kernel entries cannot be attributed to a source class.")
    A("* `MeshRasterizer` and `Cellular3D` appear as global-scope class names (200/96 in "
      "oneAPI, 850/408 in AdaptiveCpp) rather than as lower-case namespaces; there is no "
      "`cellular3d` namespace in any binary (`observed`).")
    A("## 5. How a backend is bound at runtime -- two different mechanisms")
    A("")
    A("### 5.1 `Gaea.Native.dll` exposes a named 19-entry C API")
    A("")
    A("The string table of `Gaea.Native.dll` contains a contiguous export-name block "
      "(offset 0x3F74D9) whose first entry is the module's own name, i.e. an import/export "
      "name table. **The same 19 names appear as string literals in `Gaea.Engine.dll`**, "
      "so the CPU backend is bound by name through the `SyclLibrary.LoadFunction("
      "LibraryHandle, String functionName)` path rather than by ordinal. This corrects the "
      "starting assumption that the native DLLs carry no usable export surface: the CPU "
      "library's exported entry points are readable (`observed`).")
    A("")
    A(md_table(["exported name (observed)", "inferred role", "confidence"],
               [list(r) for r in NATIVE_API]))
    A("")
    A("`inferred` reading of this table: the CPU backend is a *self-contained* library "
      "that carries erosion, lakes, rivers, hydrological correction, ISPC lighting, "
      "blurring, heightmap/mesh conversion, expression evaluation (MathX via the bundled "
      "`exprtk`) and mesh IO (via the bundled Assimp). The SYCL backends implement the "
      "same terrain algorithms through a different, kernel-shaped API "
      "(`SyclFunctions.*`), and they do **not** expose these names.")
    A("")
    A("### 5.2 The SYCL backends are bound through dynamic function pointers")
    A("")
    A("`Gaea.oneAPI.dll`, `Gaea.AdaptiveCpp.dll` and `Gaea.AdaptiveCpp.HIP.dll` contain no "
      "comparable name table (`observed`). They are loaded by `Sycl.SyclLibrary`, whose "
      "constructor takes a `libraryName` and whose `LoadFunction(LibraryHandle, "
      "functionName)` resolves each kernel entry into a delegate; the "
      "`QuadSpinner.Gaea.Engine.Sycl.SyclFunctions` class then holds the 13 resolved "
      "delegates. This is why `Gaea.CE/CS/CW/TS.dll` never name a backend: the backend is "
      "an opaque handle plus a resolved function pointer (`observed` mechanism, "
      "`inferred` consequence).")
    A("")
    A("`QuadSpinner.Gaea.Engine.SyclLoader` offers `LoadAllBackendsAsync()` and "
      "`LoadBackendsAsync(IEnumerable backendIds)` -- backends are enumerated and loaded "
      "by id (`observed`).")
    A("")
    A("## 6. How a device is selected at runtime")
    A("")
    A("`observed` types in **`Gaea.Dv.dll`** (namespace `QuadSpinner.DetectDevices.SYCL`) "
      "and **`Gaea.Engine.dll`** (namespace `QuadSpinner.Gaea.Engine.Sycl`):")
    A("")
    A(md_table(["type", "observed members", "reading"],
               [["`Sycl.SyclLibrary`",
                 "ctor `(String libraryName)`; `GetLibrary(String)`; "
                 "`LoadFunction(LibraryHandle, String functionName)`; fields "
                 "`libraryName`, `libraryHandle`, `activeDeviceCount`, `libraries`",
                 "backend DLLs are loaded by name and every kernel entry point is "
                 "resolved as a raw function pointer at runtime — this is why the "
                 "C++/CLI modules never name a backend"],
                ["`Sycl.DeviceType`",
                 "`Unknown, Cpu, CpuAccelerated, GpuIntegrated, GpuDiscrete, Accelerator`",
                 "device classification shown to the user"],
                ["`Sycl.DeviceInfo`",
                 "`LibraryId, DeviceType, BackendName, VendorName, DeviceName, Id, "
                 "IsFallbackDevice, RequiresDriverUpdate`",
                 "one record per discovered device"],
                ["`Sycl.NativeResult`", "`Success, Cancelled, InsufficientDeviceMemory, "
                 "UndefinedError`",
                 "kernels report device-memory exhaustion as a first-class result — the "
                 "node code falls back to the CPU path on failure"],
                ["`Sycl.ProgressType`", "`Single, Multiple, Indeterminate`",
                 "progress reporting mode"],
                ["`Sycl.InteropBridge`",
                 "`progressDelegate, cancelDelegate, logDelegate, logWarningDelegate, "
                 "logErrorDelegate, getTokenDelegate`, `defaultInteropBridge`",
                 "the native/managed boundary: progress, cancellation and logging"],
                ["`Engine.Sycl.SyclFunctions` (13 fields)",
                 "`MedianFilter, Shade, SunLightIntegral, ThermalSimulation, "
                 "ColorTransportSimulation, FlowSimulation, ParallelErosionSimulation, "
                 "MeshRasterizer_RenderPointCloud, MeshRasterizer_RenderMesh, "
                 "MeshRasterizer_RenderMeshWithTriplanarDisplacement, "
                 "MeshRasterizer_ComputeTangentSpaceNormals, Cellular3D_Render, "
                 "ThermalShaper_Process`",
                 "the complete resolved kernel entry-point table for a loaded backend"],
               ]))
    A("")
    A("The `DeviceType[]` array built in `Erosions.PE` "
      "(`{GpuDiscrete, Cpu}` at `Gaea.Nodes.whole.cs:734-737`) then decides, per call, "
      "whether the GPU kernel or the fallback path runs — `observed`.")
    A("")
    A("## 7. Visibility limits of this analysis")
    A("")
    A("* No backend DLL was disassembled and none ships a PDB: dispatch policy, "
      "work-group sizes, USM vs. buffer choice per kernel and any per-device "
      "specialisation are unknown.")
    A("* Which backend actually runs on a given machine is a runtime decision; only the "
      "selection mechanism and the compiled-in namespaces are shown here.")
    A("* The presence of the string `nvidia` (208x) inside `Gaea.oneAPI.dll` is recorded "
      "as an observed string occurrence, not as evidence of a supported NVIDIA path "
      "through oneAPI.")
    return "\n".join(L)


# ---------------------------------------------------------------- mapping
NATIVE_API = [
    ("ParallelErosion_Erode", "particle hydraulic erosion - the CPU counterpart of the "
     "SYCL `parallel_erosion` kernel and of the C++/CLI `ErosionWrapper`", "high"),
    ("Lake_Create", "lake / water-body creation - the CPU counterpart of "
     "`ErosionWrapperW` and of the `lake` scope", "high"),
    ("Rivers", "river-network generation - reached through `Waters.Rivers`", "high"),
    ("HydrologicalCorrection", "hydrological correction - reached by the `HydroFix` "
     "node", "medium"),
    ("ShadeIspc", "ISPC lighting / shading - the CPU counterpart of "
     "`SyclFunctions.Shade`", "high"),
    ("SunLightIntegralIspc", "ISPC sun-light integration - the CPU counterpart of "
     "`SyclFunctions.SunLightIntegral`", "high"),
    ("FastBlur_Process", "blur", "medium"),
    ("FastBlur4_Process", "blur (4-channel)", "medium"),
    ("MathX_Compute", "evaluate a MathX expression over a map", "high"),
    ("MathX_Function", "compile/register a MathX function", "high"),
    ("MathX_FreeErrorMessage", "free a MathX error string", "high"),
    ("MeshPort_Load", "load a mesh", "high"),
    ("MeshPort_Save", "save a mesh", "high"),
    ("MeshPort_Destroy", "release a mesh handle", "high"),
    ("MeshPort_HeightmapToMesh", "heightmap -> mesh", "high"),
    ("MeshPort_HeightmapToMeshWithAdaptiveSubdivision", "heightmap -> mesh with adaptive "
     "subdivision", "high"),
    ("MeshPort_PointCloudToMesh", "point cloud -> mesh", "high"),
    ("MeshPort_TrianglesToMesh", "raw triangles -> mesh", "high"),
    ("MeshPort_SavePointCloud", "export a point cloud", "high"),
]

WRAPPER_USES = [
    ("`Erosions.Classic`", "Gaea.Nodes.whole.cs:696", "`ErosionWrapper` (Gaea.CE.dll)",
     "fluvial + thermal erosion", "`Erosion`, `Wizard`", "high"),
    ("`Erosions.PE`", "738 / 766", "`ParallelErosion.Simulation` (SYCL) + "
     "`ParallelErosion.Parameters`", "particle hydraulic erosion", "`Erosion2`, "
     "`EasyErosion`", "high"),
    ("`Erosions.Thermal2`", "812 / 814", "`Thermal2.ThermalSimulation` (SYCL)",
     "thermal erosion", "`Erosion2`, `EasyErosion`, `Thermal`, `Thermal2`", "high"),
    ("`Simulations.Thermal`", "4768 / 4800", "`ErosionWrapper` (Gaea.CE.dll)",
     "thermal stage of the C++/CLI core", "`Thermal`", "high"),
    ("`Waters.Rivers`", "7071 / 7084",
     "an Engine-side native call (obfuscated holder) whose 9-field parameter block "
     "(`seed, resolution, width, depth, downcutting, headwatersQuantity, waterAmount, "
     "renderWaterSurface, octaveCorrection`) returns "
     "`(height, rivers, depth, surface, direction)` -- most likely the exported `Rivers` "
     "entry of `Gaea.Native.dll`", "river-network generation", "`Rivers`", "medium"),
    ("`Simulations.Snow`", "4565 / 4586", "`ErosionWrapperS` (Gaea.CS.dll)",
     "snow accumulation and melt", "`Snow`, `Snowfield`, `Shrubs`, `Trees`", "high"),
    ("`Waters.Lakes`", "7091 / 7109", "`ErosionWrapperW` (Gaea.CW.dll) via `ErodeTerrain`",
     "lake filling / water depth", "`Lake`, `Rivers`", "high"),
    ("`Waters.Sea`", "7128 / 7160", "`ErosionWrapperW` via `EdgeFill`",
     "sea level, edge-seeded fill", "`Sea`", "high"),
    ("`Profiles.ThermalShaper`", "3957 / 3961", "`ErosionWrapperTS` (Gaea.TS.dll)",
     "thermal/profile shaping", "`ThermalShaper`", "high"),
    ("`ThermalShaper.Build`", "31965", "`ThermalShaper.Process` (SYCL)",
     "pyramid profile shaping", "`ThermalShaper`", "high"),
    ("`Simulations.Flow2`", "4508 / 4510", "`Flow.Simulation` (SYCL)",
     "particle flow accumulation", "`FlowMap`, `SuperColor`, `Dusting`, `Scree`, "
     "`Shrubs`, `Trees`, `Texturize`", "high"),
    ("`Simulations.CreateFlowMap`", "4619", "`Flow` (via the iterative variant)",
     "iterative/`oriented` flow accumulation", "`FlowMapClassic`, `Anastomosis`, "
     "`Migrated`", "medium"),
    ("`ColorTransport.Simulation`", "8664, 11458, 31529-31555, 34841, 35321",
     "`ColorTransport.Simulation` (SYCL)", "sediment colour advection",
     "`Cartography`, `Weathering`, `SuperColor`, `ColorErosion`, `Dusting`", "high"),
    ("`Cellular3D.Render`", "14702, 27582, 30635, 33392", "`Cellular3D.Render` (SYCL)",
     "3-D cellular noise", "`Cellular3D`, `IceFloe`, `Shrubs`, `Trees`", "high"),
    ("`MedianFilter.ResolutionIndependent` / `.Classic`", "27889-27930",
     "`MedianFilter` (SYCL)", "median filter", "`Median`", "high"),
    ("`MeshRasterizer.RenderMesh`", "12436, 12461, 12943, 12968, 18964, 32495, 33594",
     "`MeshRasterizer` (SYCL)", "mesh -> heightmap rasterisation",
     "`Object`, `MeshWarp`, `TextureBaker`, `Transform3D`, `TriplanarDisplacement`",
     "high"),
    ("`MeshRasterizer.RasterizePointCloud`", "28126", "`MeshRasterizer` (SYCL)",
     "point-cloud -> heightmap", "`Meshify`", "high"),
    ("`debrisCore.Simulation`", "25350 / 25354", "`Debris` (SYCL, AdaptiveCpp only)",
     "rock scattering", "`Debris`, `Stones`, `Rockscape`", "medium"),
    ("`SyclFunctions.Shade` / `SunLightIntegral`", "delegate table",
     "`NativeLighting.Parameters` + `lighting`/`lighting_x`/`ispc_lighting`",
     "sun/sky lighting, shadows, AO", "`Sunlight`, `LightX`, `AO`, `Occlusion`, "
     "`Shade`, `Normals`", "medium"),
]


def build_mapping():
    L = []
    A = L.append
    A("# Gaea 2.3.1 — kernel → node mapping")
    A("")
    A("> **Coordination note.** Another workflow in this workspace also produces a "
      "node-mapping document from the same decompiled sources (a per-node entry-point "
      "census, e.g. `docs/node-specs-from-il.json`, `docs/nodes-reference.md`). This file "
      "is the *kernel-side* view: which kernel each shared helper instantiates, and which "
      "parameters it fills. Where the two disagree, the `new ...Wrapper()` / "
      "`SetVars(...)` and `new ...Parameters{...}` statements below are the primary "
      "evidence. A durable copy of this kernel-side view is kept at "
      "`docs/kernels-node-mapping.by-kernel.md`.")
    A("")
    A("> **Two bindings that the entry-point census gets wrong** (both `observed` here): "
      "`Erosions.Classic` does **not** call `parallel_erosion`; it instantiates the "
      "C++/CLI `ErosionWrapper` (`Gaea.CE.dll`). The SYCL `ParallelErosion` kernel is "
      "reached from `Erosions.PE` instead (used by `Erosion2` / `EasyErosion`). Likewise "
      "`Thermal2.ThermalSimulation` is reached from `Erosions.Thermal2`, while "
      "`Simulations.Thermal` instantiates the same C++/CLI `ErosionWrapper`.")
    A("")
    A("The node catalogue has **182 nodes** (`web/data/nodes.json`, `stats.nodes`). "
      "Only a minority of them reach a kernel: the large majority are CPU-side "
      "procedural operators that are implemented in managed code in `Gaea.Nodes.dll` "
      "and never call into `SyclFunctions` or into one of the four C++/CLI modules.")
    A("")
    A("## 1. Observed kernel call sites")
    A("")
    A("Every row below is an actual instantiation/call found in the decompiled node "
      "source (`evidence/decompiled/Gaea.Nodes.whole.cs`). `owner` is the enclosing "
      "class; the helper column shows the shared static helper that wraps the kernel.")
    A("")
    A(md_table(["kernel call site", "line(s)", "bound to", "role",
                "nodes reached", "confidence"],
               [list(r) for r in WRAPPER_USES]))
    A("")
    A("## 2. Per-kernel node sets")
    A("")
    rows = [
        ["`ParallelErosion`", "`Erosion2`, `EasyErosion`",
         "`Erosions.PE`", "high"],
        ["`Thermal2`", "`Erosion2`, `EasyErosion`, `Thermal`, `Thermal2`",
         "`Erosions.Thermal2` (+ `Simulations.Thermal` for the CPU core)", "high"],
        ["`ErosionWrapper` (CE)", "`Erosion`, `Wizard`, `Thermal`",
         "`Erosions.Classic`, `Simulations.Thermal`", "high"],
        ["`ErosionWrapperS` (CS)", "`Snow`, `Snowfield`, `Shrubs`, `Trees`",
         "`Simulations.Snow`", "high"],
        ["`ErosionWrapperW` (CW)", "`Lake`, `Sea`, `Rivers`",
         "`Waters.Lakes`, `Waters.Sea`", "high"],
        ["`ErosionWrapperTS` (TS)", "`ThermalShaper`", "`Profiles.ThermalShaper`", "high"],
        ["`ThermalShaper`", "`ThermalShaper`", "`ThermalShaper.Build`", "high"],
        ["`Flow`", "`FlowMap`, `FlowMapClassic`, `Dusting`, `SuperColor`, `Scree`, "
         "`Shrubs`, `Trees`, `Texturize`, `Anastomosis`",
         "`Simulations.Flow2`, `Simulations.CreateFlowMap`", "high"],
        ["`ColorTransport`", "`Cartography`, `Weathering`, `SuperColor`, `ColorErosion`, "
         "`Dusting`", "direct calls", "high"],
        ["`Cellular3D`", "`Cellular3D`, `IceFloe`, `Shrubs`, `Trees`", "direct calls",
         "high"],
        ["`MedianFilter`", "`Median`", "direct calls", "high"],
        ["`MeshRasterizer`", "`Object`, `Meshify`, `Transform3D`, `TriplanarDisplacement`, "
         "`MeshWarp`, `TextureBaker`", "direct calls", "high"],
        ["`NativeLighting`", "`Sunlight`, `LightX`, `AO`, `Occlusion`, `Shade`, "
         "`Normals` (inferred: the delegate table is bound in the Engine, not in a "
         "node)", "delegate table", "medium"],
        ["`Debris`", "`Debris` (plus `Stones`/`Rockscape` inferred)",
         "`debrisCore.Simulation`", "medium"],
        ["`resampling` / `stamp_instancer`",
         "no node: engine-internal pyramid and instancing helpers", "-", "high"],
    ]
    A(md_table(["kernel", "nodes", "entry the nodes use", "confidence"], rows))
    A("")
    A("## 3. Kernel-adjacent nodes that were NOT observed calling a kernel")
    A("")
    A("These nodes sit next to a kernel conceptually but no call was found in the "
      "available decompilation. They are listed so the gaps are explicit rather than "
      "silently dropped. `inferred`/`unknown` — the decompiled source is partial.")
    A("")
    A("* Water/hydrology family: `HydroFix`, `Rivers`, `WaterColor` — `Rivers` uses "
      "`Waters.Rivers`, which calls a native entry through an obfuscated Engine holder and "
      "matches the exported `Rivers` entry of `Gaea.Native.dll` (medium confidence); "
      "`HydroFix` matches the exported `HydrologicalCorrection` entry (medium); "
      "`WaterColor` has no observed kernel call.")
    A("* Erosion family: `ColorErosion` reaches `ColorTransport`, `Sediments`, `Slump`, "
      "`Uplift`, `Distress`, `Crumble` (`Simulations.Crumble` is a helper whose kernel "
      "binding was not resolved — `unknown`).")
    A("* Scatter/geometry family: `PointCloud`, `Mesher`, `RockMap`, `Rockscape`, "
      "`Stones`, `Scree` (only some are reached through `MeshRasterizer`/`Debris`).")
    A("* Lighting/atmosphere family: `SatMap`, `TextureBase`, `Tint`, `TextureBase` are "
      "consumers of baked light/AO maps rather than kernel callers (`inferred`).")
    A("")
    A("Everything else in the 182-node list (procedural noise, filters, warps, "
      "colour maths, masks, primitives, routing and the mesh/IO nodes) has **no** "
      "observed call into `SyclFunctions` or into `Gaea.CE/CS/CW/TS.dll`.")
    A("")
    A("## 4. Companion mapping: kernels that a node reaches only through a shared helper")
    A("")
    A("The `Erosions` / `Simulations` / `Waters` / `Profiles` static helper classes are "
      "the real kernel clients. A node calls the helper, and the helper owns the kernel "
      "call. This means a node's parameter names are *not* the kernel's parameter names; "
      "the helper performs the translation (`observed`: the helper signatures and the "
      "`SetVars` / `Parameters` initialisers).")
    A("")
    A("| helper | kernel it owns | evidence |")
    A("|---|---|---|")
    A("| `Erosions.Classic` | `ErosionWrapper` (CE) | `new ErosionWrapper()` + `SetVars(...)` "
      "at `Gaea.Nodes.whole.cs:696-698` |")
    A("| `Erosions.PE` | `ParallelErosion` | `new ParallelErosion.Parameters{...}` + "
      "`ParallelErosion.Simulation` at 738-766 |")
    A("| `Erosions.Thermal2` | `Thermal2` | 814 |")
    A("| `Simulations.Flow2` | `Flow` | 4510 |")
    A("| `Simulations.CreateFlowMap` | `Flow` (iterative) | 4619 |")
    A("| `Simulations.Snow` | `ErosionWrapperS` (CS) | 4568-4586 |")
    A("| `Simulations.Thermal` | `ErosionWrapper` (CE) | 4771-4800 |")
    A("| `Simulations.Crumble` | unresolved | 4520 |")
    A("| `Waters.Lakes` | `ErosionWrapperW` (CW) | 7095-7109 |")
    A("| `Waters.Sea` | `ErosionWrapperW` (CW), `EdgeFill` | 7132-7160 |")
    A("| `Profiles.ThermalShaper` | `ErosionWrapperTS` (TS) | 3957-3961 |")
    A("")
    A("## 5. Coverage and confidence")
    A("")
    A("* 19 distinct kernel call sites / helper bindings were observed; 6 of them are "
      "C++/CLI-module instantiations, the rest are SYCL-layer, CPU-native or helper calls.")
    A("* All C++/CLI→helper bindings are `observed` (the `new`/`SetVars` statements are "
      "in the decompilation) with high confidence.")
    A("* The `NativeLighting` and `Debris` node sets are `inferred` at medium confidence: "
      "their `SyclFunctions` classes expose no methods, so the binding goes through the "
      "delegate table and the Engine core, which is outside the decompiled node source.")
    A("* The node-side mapping is limited by a partial decompilation of `Gaea.Nodes.dll` "
      "(2 MB of a 799 KB assembly, i.e. most but not all `Build()` bodies). Nodes whose "
      "`Build()` is not in the file cannot be mapped either way.")
    return "\n".join(L)


def main():
    os.makedirs(DOCS, exist_ok=True)
    b = build_backends()
    open(os.path.join(DOCS, "kernels-backends.md"), "w", encoding="utf-8").write(b + "\n")
    m = build_mapping()
    open(os.path.join(DOCS, "kernels-node-mapping.md"), "w", encoding="utf-8").write(m + "\n")
    print("wrote kernels-backends.md (%d chars), kernels-node-mapping.md (%d chars)"
          % (len(b), len(m)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

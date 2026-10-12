# Gaea 2.3.1 — backends, and what CE / CS / CW / TS actually are

Everything in this document is derived from shipped file metadata, string tables and demangled symbols; nothing was executed. Items marked *inferred* are the analyst's reading.

## 1. There are two independent axes, not one

The brief that started this investigation proposed that `Gaea.TS/CS/CW` might be "different precision or different SIMD-width variants" of `Gaea.CE`. **The evidence refutes that** (section 3). The shipped product has two orthogonal axes:

| axis | members | what differs |
|---|---|---|
| **algorithm family** | `Gaea.CE.dll` (erosion, fluvial+thermal), `Gaea.CS.dll` (snow accumulation/melt), `Gaea.CW.dll` (lakes/sea water level), `Gaea.TS.dll` (thermal/profile shaping) | completely different parameter blocks and different entry points |
| **execution backend** | `Gaea.Native.dll` (CPU/ISPC), `Gaea.oneAPI.dll` (oneAPI/DCP++), `Gaea.AdaptiveCpp.dll` (CUDA), `Gaea.AdaptiveCpp.HIP.dll` (HIP) | same algorithm, different device and runtime |

The four C++/CLI assemblies are **algorithm variants**. The four native DLLs are **device backends**. The two sets share no file names, no namespaces and no parameter structs.

## 2. The backend DLLs

| assembly | bytes | observed platform evidence (string-table counts) | inferred target |
|---|---|---|---|
| Gaea.Native.dll | 4 653 568 | MSVC x64 mixed C++ library; **no SYCL**. `ispc` appears 58x -> Intel ISPC SPMD compilation for the lighting path (`ispc_lighting`). | CPU (own thread pool / ISPC SIMD) |
| Gaea.oneAPI.dll | 15 393 280 | Intel oneAPI DPC++: `sycl` 35 648x, `oneAPI` 6 408x, `spirv` 186x, `level_zero` 39x, `opencl` 130x, `Intel` 931x, plus `avx512` 18x (CPU device). | Intel GPU via Level Zero, any OpenCL device, x86-64 CPU via AVX-512 |
| Gaea.AdaptiveCpp.dll | 28 449 280 | AdaptiveCpp (ex hipSYCL): `hipsycl` 51 174x, `acpp` 45 041x, `cuda` 810x, `ptx` 18x -> the CUDA backend; the folder also ships `cudart64_12.dll`. | NVIDIA GPU via CUDA |
| Gaea.AdaptiveCpp.HIP.dll | 38 938 112 | Same AdaptiveCpp core (`hipsycl` 91 302x) plus `hip` 93 361x and `OpenCL` 6 265x -> the AMD/HIP backend. | AMD GPU via HIP/ROCm, plus Generic/OpenCL |

Supporting runtime DLLs present in `D:\Gaea 2` (observed, by file name): `sycl8.dll`, `pi_level_zero.dll`, `pi_opencl.dll`, `pi_unified_runtime.dll`, `ur_loader.dll`, `ur_adapter_level_zero.dll`, `ur_adapter_opencl.dll`, `ur_win_proxy_loader.dll`, `acpp-rt.dll`, `acpp-common.dll`, `cudart64_12.dll`, `FNSIMD.dll`, `libmmd.dll`, `svml_dispmd.dll`, `OpenCL.dll`.

`inferred`: `sycl8`/`pi_*`/`ur_*` belong to the oneAPI (Intel DPC++ / Unified Runtime) stack, while `acpp-*` and the HIP/CUDA payloads belong to AdaptiveCpp. `Gaea.Native.dll` links neither, which is consistent with it being a plain MSVC/ISPC CPU library.

## 3. Why CE / CS / CW / TS are algorithm variants, not precision variants

Evidence, all `observed` from `GaeaDump memb` and from the decompiled node code:

| letter | assembly | fields | methods | distinct method names (observed) |
|---|---|---|---|---|
| CE | Gaea.CE.dll | 45 | 13 | ErodeTerrain; ReturnFalse; SetEvent; SetVars; WriteInputData; WriteInputDataA; WriteInputDataASR; WriteInputDataSR; WriteOutputData; clamp |
| CS | Gaea.CS.dll | 49 | 7 | ErodeTerrain; ReturnFalse; SetEvent; SetVars |
| CW | Gaea.CW.dll | 20 | 6 | EdgeFill; ErodeTerrain; FloodFill; SetEvent; SetVars |
| TS | Gaea.TS.dll | 44 | 11 | ErodeTerrain; ReturnFalse; SetEvent; SetVars; WriteInputData; WriteInputDataA; WriteInputDataASR; WriteInputDataSR; WriteOutputData; clamp |

Distinguishing parameter blocks (each list is `observed` field names, unique to that assembly):

* **CS** (`ErosionWrapperS`, 49 fields): `m_snowfall_duration`, `m_snowfall_intensity`, `m_post_snowfall_duration`, `m_melting`, `m_snow_line`, `m_snowfall_mask`, `m_melt_mask`, `m_snow_output`, plus three *integer mirrors* `m_iduration` / `m_isnowfall_duration` / `m_ipost_snowfall_duration`, and the output arrays `snow`, `hardmask`, `softmask`. Its `ErodeTerrain` takes two extra input maps (`snowfall_area`, `melt_area`).
* **CW** (`ErosionWrapperW`, 20 fields): `m_precipitation`, `m_precipitation_amount`, `m_evaporation`, `m_lake_size_bias`, `m_shore_size`, `m_altitude_bias`, `m_size_bias`, `m_water_floor`, `m_precipitation_mask`, `m_evaporation_mask`; outputs `depth`, `shore`, `surface`; and it is the **only** wrapper with `FloodFill(...)` and `EdgeFill(...)` entry points.
* **TS** (`ErosionWrapperTS`, 44 fields): the only module whose `SetVars` accepts just `resolution, size, scale, duration, intensity`, and whose `ErodeTerrain` takes only the heightmap; `m_intensity` and `m_influence` are its only own parameters, and 39 of its 44 fields are unreachable from its own API.

A precision or SIMD-width variant would keep the same field names and only change the element type. Every one of these assemblies instead stores a **different set of named parameters**, and `Gaea.CW.dll` even exposes **different operations** (`FloodFill`, `EdgeFill`). There is also no element-type difference: all four store `Single[]` output arrays and `Double` scalar parameters.

### 3.1 Where each variant is used (observed in `Gaea.Nodes.dll`)

| variant | helper that instantiates it | decompiled line | nodes reached |
|---|---|---|---|
| `ErosionWrapper` (CE) | `Erosions.Classic` | Gaea.Nodes.whole.cs:696 | `Erosion`, `Wizard` |
| `ErosionWrapper` (CE) | `Simulations.Thermal` | 4771 / 4800 | `Thermal` |
| `ErosionWrapperS` (CS) | `Simulations.Snow` | 4568 / 4586 | `Snow`, `Snowfield`, `Shrubs`, `Trees` |
| `ErosionWrapperW` (CW) | `Waters.Lakes` | 7095 / 7109 | `Lake`, `Rivers` |
| `ErosionWrapperW` (CW) | `Waters.Sea` | 7132 / 7160 | `Sea` (uses `EdgeFill`) |
| `ErosionWrapperTS` (TS) | `Profiles.ThermalShaper` | 3957 / 3961 | `ThermalShaper` |

`inferred`: the letters expand to the *families* the code uses them for — **C**ompute **E**rosion / **S**now / **W**ater, and **T**hermal **S**haper. The expansions are inferred; the usages above are observed.

## 4. Kernel availability per backend

Counts are occurrences of the namespace token in the demangled-symbol/string census of each assembly (`evidence/kernels/native-symbols.json`); `-` means the namespace was not found at all.

| native namespace | Native | oneAPI | AdaptiveCpp | AdaptiveCpp.HIP |
|---|---|---|---|---|
| AEAVRapidBlur | **-** | **-** | 51 | 51 |
| Cellular3D | **-** | 96 | 408 | 408 |
| DDU_Mbstatet | 5 | 2 | 2 | 2 |
| Debris | **-** | **-** | 475 | 475 |
| FastNoiseSIMD_internal | 3 | **-** | **-** | **-** |
| HostPinnedMemoryPool | **-** | 5 | 5 | 5 |
| MeshRasterizer | **-** | 200 | 850 | 866 |
| PEAM111UInteropBridge | 4 | **-** | **-** | **-** |
| PEAM1AEAUInteropBridge | 9 | **-** | **-** | **-** |
| PEAM2PEAUSnorm16x2 | **-** | **-** | 30 | 30 |
| PEAM3PEAUSnorm16x2 | **-** | **-** | 13 | 13 |
| PEAM5PEAUSnorm16x2 | **-** | **-** | 4 | 4 |
| PEAM6PEAUSnorm16x2 | **-** | **-** | 4 | 4 |
| PEAUSnorm16x2 | **-** | **-** | 612 | 612 |
| PEAV9color_transport | **-** | **-** | 2 | 2 |
| PEAV9parallel_erosion | **-** | **-** | 2 | 2 |
| PEAV9parallel_erosion2 | **-** | **-** | 2 | 2 |
| PEAV9thermal | **-** | **-** | 2 | 2 |
| PEBUaiScene | 1 | **-** | **-** | **-** |
| PEBUaiString | 1 | **-** | **-** | **-** |
| PEBXIPEBDIIW4aiPropertyTypeInfo | 1 | **-** | **-** | **-** |
| RapidBlur | **-** | **-** | 102 | 102 |
| SpectralLayer | 6 | **-** | **-** | **-** |
| UInteropBridge | 4 | **-** | **-** | **-** |
| USnorm16x2 | **-** | **-** | 1 | 1 |
| U__acpp_unnamed_kernel | **-** | **-** | 4901 | 4997 |
| VHostPinnedMemoryPool | **-** | 1 | 1 | 1 |
| arrakis | **-** | **-** | 1138 | 1138 |
| color_transport | **-** | 130 | 585 | 585 |
| flow | **-** | 112 | 483 | 483 |
| hipsycl | **-** | **-** | 21589 | 24825 |
| interopmesh | 10 | **-** | **-** | **-** |
| ispc_lighting | 58 | **-** | **-** | **-** |
| lake | 12 | **-** | **-** | **-** |
| lighting | **-** | 148 | 673 | 697 |
| lighting_x | **-** | **-** | 1273 | 1289 |
| median_filter | **-** | 152 | 646 | 662 |
| mesh_port | 8 | **-** | **-** | **-** |
| mesh_rasterizer | **-** | 52 | 256 | 256 |
| parallel_erosion | 36 | 209 | 985 | 1033 |
| parallel_erosion2 | **-** | **-** | 888 | 920 |
| resampling | 9 | 86 | 724 | 724 |
| sbo | **-** | **-** | 2 | 2 |
| shm | 28 | **-** | **-** | **-** |
| spline | **-** | **-** | 2 | 2 |
| stamp_instancer | **-** | 41 | 131 | 131 |
| sycl | **-** | 3681 | **-** | **-** |
| texture3d | **-** | **-** | 102 | 102 |
| thermal | **-** | 120 | 724 | 724 |
| thermal_shaper | **-** | 108 | 426 | 426 |

Notable asymmetries (`observed`):

* `parallel_erosion2` exists **only** in the two AdaptiveCpp builds -> a second erosion core shipped only for GPU backends (`inferred`: a redesign used for the CUDA/HIP path).
* `lighting_x` exists only in AdaptiveCpp; `Debris` only in AdaptiveCpp; `mesh_rasterizer`/`MeshRasterizer` in oneAPI + AdaptiveCpp but **not** in `Gaea.Native.dll`; `median_filter` likewise absent from `Gaea.Native.dll`.
* `ispc_lighting` exists only in `Gaea.Native.dll` -> the CPU backend has its own ISPC lighting implementation.
* `lake`, `interopmesh`, `mesh_port`, `shm`, `Assimp`, `tinyobj`, `exprtk` are CPU-library facilities in `Gaea.Native.dll` (mesh IO, shared memory, expressions).
* `texture3d`, `stamp_instancer` and `arrakis` appear only in the AdaptiveCpp builds; `arrakis` is an AdaptiveCpp runtime component rather than a terrain kernel (`inferred`).

* `parallel_erosion` is present in **all four** native libraries, including the CPU one (`Gaea.Native.dll`, 36 scope tokens) -> the CPU backend has its own particle erosion core, the counterpart of the C++/CLI `ErosionWrapper`. `Gaea.Native.dll` additionally carries `FastNoiseSIMD_internal` and `SpectralLayer` scopes -> the CPU library also hosts its own noise/spectral-noise generators, which are not exposed through `SyclFunctions` (`observed` scopes, `inferred` role).
* `U__acpp_unnamed_kernel` (4 901 / 4 997 occurrences) is AdaptiveCpp's mangling for kernels whose type has no name -- `observed` as a naming scheme, and the reason a few AdaptiveCpp kernel entries cannot be attributed to a source class.
* `MeshRasterizer` and `Cellular3D` appear as global-scope class names (200/96 in oneAPI, 850/408 in AdaptiveCpp) rather than as lower-case namespaces; there is no `cellular3d` namespace in any binary (`observed`).
## 5. How a backend is bound at runtime -- two different mechanisms

### 5.1 `Gaea.Native.dll` exposes a named 19-entry C API

The string table of `Gaea.Native.dll` contains a contiguous export-name block (offset 0x3F74D9) whose first entry is the module's own name, i.e. an import/export name table. **The same 19 names appear as string literals in `Gaea.Engine.dll`**, so the CPU backend is bound by name through the `SyclLibrary.LoadFunction(LibraryHandle, String functionName)` path rather than by ordinal. This corrects the starting assumption that the native DLLs carry no usable export surface: the CPU library's exported entry points are readable (`observed`).

| exported name (observed) | inferred role | confidence |
|---|---|---|
| ParallelErosion_Erode | particle hydraulic erosion - the CPU counterpart of the SYCL `parallel_erosion` kernel and of the C++/CLI `ErosionWrapper` | high |
| Lake_Create | lake / water-body creation - the CPU counterpart of `ErosionWrapperW` and of the `lake` scope | high |
| Rivers | river-network generation - reached through `Waters.Rivers` | high |
| HydrologicalCorrection | hydrological correction - reached by the `HydroFix` node | medium |
| ShadeIspc | ISPC lighting / shading - the CPU counterpart of `SyclFunctions.Shade` | high |
| SunLightIntegralIspc | ISPC sun-light integration - the CPU counterpart of `SyclFunctions.SunLightIntegral` | high |
| FastBlur_Process | blur | medium |
| FastBlur4_Process | blur (4-channel) | medium |
| MathX_Compute | evaluate a MathX expression over a map | high |
| MathX_Function | compile/register a MathX function | high |
| MathX_FreeErrorMessage | free a MathX error string | high |
| MeshPort_Load | load a mesh | high |
| MeshPort_Save | save a mesh | high |
| MeshPort_Destroy | release a mesh handle | high |
| MeshPort_HeightmapToMesh | heightmap -> mesh | high |
| MeshPort_HeightmapToMeshWithAdaptiveSubdivision | heightmap -> mesh with adaptive subdivision | high |
| MeshPort_PointCloudToMesh | point cloud -> mesh | high |
| MeshPort_TrianglesToMesh | raw triangles -> mesh | high |
| MeshPort_SavePointCloud | export a point cloud | high |

`inferred` reading of this table: the CPU backend is a *self-contained* library that carries erosion, lakes, rivers, hydrological correction, ISPC lighting, blurring, heightmap/mesh conversion, expression evaluation (MathX via the bundled `exprtk`) and mesh IO (via the bundled Assimp). The SYCL backends implement the same terrain algorithms through a different, kernel-shaped API (`SyclFunctions.*`), and they do **not** expose these names.

### 5.2 The SYCL backends are bound through dynamic function pointers

`Gaea.oneAPI.dll`, `Gaea.AdaptiveCpp.dll` and `Gaea.AdaptiveCpp.HIP.dll` contain no comparable name table (`observed`). They are loaded by `Sycl.SyclLibrary`, whose constructor takes a `libraryName` and whose `LoadFunction(LibraryHandle, functionName)` resolves each kernel entry into a delegate; the `QuadSpinner.Gaea.Engine.Sycl.SyclFunctions` class then holds the 13 resolved delegates. This is why `Gaea.CE/CS/CW/TS.dll` never name a backend: the backend is an opaque handle plus a resolved function pointer (`observed` mechanism, `inferred` consequence).

`QuadSpinner.Gaea.Engine.SyclLoader` offers `LoadAllBackendsAsync()` and `LoadBackendsAsync(IEnumerable backendIds)` -- backends are enumerated and loaded by id (`observed`).

## 6. How a device is selected at runtime

`observed` types in **`Gaea.Dv.dll`** (namespace `QuadSpinner.DetectDevices.SYCL`) and **`Gaea.Engine.dll`** (namespace `QuadSpinner.Gaea.Engine.Sycl`):

| type | observed members | reading |
|---|---|---|
| `Sycl.SyclLibrary` | ctor `(String libraryName)`; `GetLibrary(String)`; `LoadFunction(LibraryHandle, String functionName)`; fields `libraryName`, `libraryHandle`, `activeDeviceCount`, `libraries` | backend DLLs are loaded by name and every kernel entry point is resolved as a raw function pointer at runtime — this is why the C++/CLI modules never name a backend |
| `Sycl.DeviceType` | `Unknown, Cpu, CpuAccelerated, GpuIntegrated, GpuDiscrete, Accelerator` | device classification shown to the user |
| `Sycl.DeviceInfo` | `LibraryId, DeviceType, BackendName, VendorName, DeviceName, Id, IsFallbackDevice, RequiresDriverUpdate` | one record per discovered device |
| `Sycl.NativeResult` | `Success, Cancelled, InsufficientDeviceMemory, UndefinedError` | kernels report device-memory exhaustion as a first-class result — the node code falls back to the CPU path on failure |
| `Sycl.ProgressType` | `Single, Multiple, Indeterminate` | progress reporting mode |
| `Sycl.InteropBridge` | `progressDelegate, cancelDelegate, logDelegate, logWarningDelegate, logErrorDelegate, getTokenDelegate`, `defaultInteropBridge` | the native/managed boundary: progress, cancellation and logging |
| `Engine.Sycl.SyclFunctions` (13 fields) | `MedianFilter, Shade, SunLightIntegral, ThermalSimulation, ColorTransportSimulation, FlowSimulation, ParallelErosionSimulation, MeshRasterizer_RenderPointCloud, MeshRasterizer_RenderMesh, MeshRasterizer_RenderMeshWithTriplanarDisplacement, MeshRasterizer_ComputeTangentSpaceNormals, Cellular3D_Render, ThermalShaper_Process` | the complete resolved kernel entry-point table for a loaded backend |

The `DeviceType[]` array built in `Erosions.PE` (`{GpuDiscrete, Cpu}` at `Gaea.Nodes.whole.cs:734-737`) then decides, per call, whether the GPU kernel or the fallback path runs — `observed`.

## 7. Visibility limits of this analysis

* No backend DLL was disassembled and none ships a PDB: dispatch policy, work-group sizes, USM vs. buffer choice per kernel and any per-device specialisation are unknown.
* Which backend actually runs on a given machine is a runtime decision; only the selection mechanism and the compiled-in namespaces are shown here.
* The presence of the string `nvidia` (208x) inside `Gaea.oneAPI.dll` is recorded as an observed string occurrence, not as evidence of a supported NVIDIA path through oneAPI.

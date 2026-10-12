# Gaea 2.3.1 — kernel → node mapping

> **Coordination note.** Another workflow in this workspace also produces a node-mapping document from the same decompiled sources (a per-node entry-point census, e.g. `docs/node-specs-from-il.json`, `docs/nodes-reference.md`). This file is the *kernel-side* view: which kernel each shared helper instantiates, and which parameters it fills. Where the two disagree, the `new ...Wrapper()` / `SetVars(...)` and `new ...Parameters{...}` statements below are the primary evidence. A durable copy of this kernel-side view is kept at `docs/kernels-node-mapping.by-kernel.md`.

> **Two bindings that the entry-point census gets wrong** (both `observed` here): `Erosions.Classic` does **not** call `parallel_erosion`; it instantiates the C++/CLI `ErosionWrapper` (`Gaea.CE.dll`). The SYCL `ParallelErosion` kernel is reached from `Erosions.PE` instead (used by `Erosion2` / `EasyErosion`). Likewise `Thermal2.ThermalSimulation` is reached from `Erosions.Thermal2`, while `Simulations.Thermal` instantiates the same C++/CLI `ErosionWrapper`.

The node catalogue has **182 nodes** (`web/data/nodes.json`, `stats.nodes`). Only a minority of them reach a kernel: the large majority are CPU-side procedural operators that are implemented in managed code in `Gaea.Nodes.dll` and never call into `SyclFunctions` or into one of the four C++/CLI modules.

## 1. Observed kernel call sites

Every row below is an actual instantiation/call found in the decompiled node source (`evidence/decompiled/Gaea.Nodes.whole.cs`). `owner` is the enclosing class; the helper column shows the shared static helper that wraps the kernel.

| kernel call site | line(s) | bound to | role | nodes reached | confidence |
|---|---|---|---|---|---|
| `Erosions.Classic` | Gaea.Nodes.whole.cs:696 | `ErosionWrapper` (Gaea.CE.dll) | fluvial + thermal erosion | `Erosion`, `Wizard` | high |
| `Erosions.PE` | 738 / 766 | `ParallelErosion.Simulation` (SYCL) + `ParallelErosion.Parameters` | particle hydraulic erosion | `Erosion2`, `EasyErosion` | high |
| `Erosions.Thermal2` | 812 / 814 | `Thermal2.ThermalSimulation` (SYCL) | thermal erosion | `Erosion2`, `EasyErosion`, `Thermal`, `Thermal2` | high |
| `Simulations.Thermal` | 4768 / 4800 | `ErosionWrapper` (Gaea.CE.dll) | thermal stage of the C++/CLI core | `Thermal` | high |
| `Waters.Rivers` | 7071 / 7084 | an Engine-side native call (obfuscated holder) whose 9-field parameter block (`seed, resolution, width, depth, downcutting, headwatersQuantity, waterAmount, renderWaterSurface, octaveCorrection`) returns `(height, rivers, depth, surface, direction)` -- most likely the exported `Rivers` entry of `Gaea.Native.dll` | river-network generation | `Rivers` | medium |
| `Simulations.Snow` | 4565 / 4586 | `ErosionWrapperS` (Gaea.CS.dll) | snow accumulation and melt | `Snow`, `Snowfield`, `Shrubs`, `Trees` | high |
| `Waters.Lakes` | 7091 / 7109 | `ErosionWrapperW` (Gaea.CW.dll) via `ErodeTerrain` | lake filling / water depth | `Lake`, `Rivers` | high |
| `Waters.Sea` | 7128 / 7160 | `ErosionWrapperW` via `EdgeFill` | sea level, edge-seeded fill | `Sea` | high |
| `Profiles.ThermalShaper` | 3957 / 3961 | `ErosionWrapperTS` (Gaea.TS.dll) | thermal/profile shaping | `ThermalShaper` | high |
| `ThermalShaper.Build` | 31965 | `ThermalShaper.Process` (SYCL) | pyramid profile shaping | `ThermalShaper` | high |
| `Simulations.Flow2` | 4508 / 4510 | `Flow.Simulation` (SYCL) | particle flow accumulation | `FlowMap`, `SuperColor`, `Dusting`, `Scree`, `Shrubs`, `Trees`, `Texturize` | high |
| `Simulations.CreateFlowMap` | 4619 | `Flow` (via the iterative variant) | iterative/`oriented` flow accumulation | `FlowMapClassic`, `Anastomosis`, `Migrated` | medium |
| `ColorTransport.Simulation` | 8664, 11458, 31529-31555, 34841, 35321 | `ColorTransport.Simulation` (SYCL) | sediment colour advection | `Cartography`, `Weathering`, `SuperColor`, `ColorErosion`, `Dusting` | high |
| `Cellular3D.Render` | 14702, 27582, 30635, 33392 | `Cellular3D.Render` (SYCL) | 3-D cellular noise | `Cellular3D`, `IceFloe`, `Shrubs`, `Trees` | high |
| `MedianFilter.ResolutionIndependent` / `.Classic` | 27889-27930 | `MedianFilter` (SYCL) | median filter | `Median` | high |
| `MeshRasterizer.RenderMesh` | 12436, 12461, 12943, 12968, 18964, 32495, 33594 | `MeshRasterizer` (SYCL) | mesh -> heightmap rasterisation | `Object`, `MeshWarp`, `TextureBaker`, `Transform3D`, `TriplanarDisplacement` | high |
| `MeshRasterizer.RasterizePointCloud` | 28126 | `MeshRasterizer` (SYCL) | point-cloud -> heightmap | `Meshify` | high |
| `debrisCore.Simulation` | 25350 / 25354 | `Debris` (SYCL, AdaptiveCpp only) | rock scattering | `Debris`, `Stones`, `Rockscape` | medium |
| `SyclFunctions.Shade` / `SunLightIntegral` | delegate table | `NativeLighting.Parameters` + `lighting`/`lighting_x`/`ispc_lighting` | sun/sky lighting, shadows, AO | `Sunlight`, `LightX`, `AO`, `Occlusion`, `Shade`, `Normals` | medium |

## 2. Per-kernel node sets

| kernel | nodes | entry the nodes use | confidence |
|---|---|---|---|
| `ParallelErosion` | `Erosion2`, `EasyErosion` | `Erosions.PE` | high |
| `Thermal2` | `Erosion2`, `EasyErosion`, `Thermal`, `Thermal2` | `Erosions.Thermal2` (+ `Simulations.Thermal` for the CPU core) | high |
| `ErosionWrapper` (CE) | `Erosion`, `Wizard`, `Thermal` | `Erosions.Classic`, `Simulations.Thermal` | high |
| `ErosionWrapperS` (CS) | `Snow`, `Snowfield`, `Shrubs`, `Trees` | `Simulations.Snow` | high |
| `ErosionWrapperW` (CW) | `Lake`, `Sea`, `Rivers` | `Waters.Lakes`, `Waters.Sea` | high |
| `ErosionWrapperTS` (TS) | `ThermalShaper` | `Profiles.ThermalShaper` | high |
| `ThermalShaper` | `ThermalShaper` | `ThermalShaper.Build` | high |
| `Flow` | `FlowMap`, `FlowMapClassic`, `Dusting`, `SuperColor`, `Scree`, `Shrubs`, `Trees`, `Texturize`, `Anastomosis` | `Simulations.Flow2`, `Simulations.CreateFlowMap` | high |
| `ColorTransport` | `Cartography`, `Weathering`, `SuperColor`, `ColorErosion`, `Dusting` | direct calls | high |
| `Cellular3D` | `Cellular3D`, `IceFloe`, `Shrubs`, `Trees` | direct calls | high |
| `MedianFilter` | `Median` | direct calls | high |
| `MeshRasterizer` | `Object`, `Meshify`, `Transform3D`, `TriplanarDisplacement`, `MeshWarp`, `TextureBaker` | direct calls | high |
| `NativeLighting` | `Sunlight`, `LightX`, `AO`, `Occlusion`, `Shade`, `Normals` (inferred: the delegate table is bound in the Engine, not in a node) | delegate table | medium |
| `Debris` | `Debris` (plus `Stones`/`Rockscape` inferred) | `debrisCore.Simulation` | medium |
| `resampling` / `stamp_instancer` | no node: engine-internal pyramid and instancing helpers | - | high |

## 3. Kernel-adjacent nodes that were NOT observed calling a kernel

These nodes sit next to a kernel conceptually but no call was found in the available decompilation. They are listed so the gaps are explicit rather than silently dropped. `inferred`/`unknown` — the decompiled source is partial.

* Water/hydrology family: `HydroFix`, `Rivers`, `WaterColor` — `Rivers` uses `Waters.Rivers`, which calls a native entry through an obfuscated Engine holder and matches the exported `Rivers` entry of `Gaea.Native.dll` (medium confidence); `HydroFix` matches the exported `HydrologicalCorrection` entry (medium); `WaterColor` has no observed kernel call.
* Erosion family: `ColorErosion` reaches `ColorTransport`, `Sediments`, `Slump`, `Uplift`, `Distress`, `Crumble` (`Simulations.Crumble` is a helper whose kernel binding was not resolved — `unknown`).
* Scatter/geometry family: `PointCloud`, `Mesher`, `RockMap`, `Rockscape`, `Stones`, `Scree` (only some are reached through `MeshRasterizer`/`Debris`).
* Lighting/atmosphere family: `SatMap`, `TextureBase`, `Tint`, `TextureBase` are consumers of baked light/AO maps rather than kernel callers (`inferred`).

Everything else in the 182-node list (procedural noise, filters, warps, colour maths, masks, primitives, routing and the mesh/IO nodes) has **no** observed call into `SyclFunctions` or into `Gaea.CE/CS/CW/TS.dll`.

## 4. Companion mapping: kernels that a node reaches only through a shared helper

The `Erosions` / `Simulations` / `Waters` / `Profiles` static helper classes are the real kernel clients. A node calls the helper, and the helper owns the kernel call. This means a node's parameter names are *not* the kernel's parameter names; the helper performs the translation (`observed`: the helper signatures and the `SetVars` / `Parameters` initialisers).

| helper | kernel it owns | evidence |
|---|---|---|
| `Erosions.Classic` | `ErosionWrapper` (CE) | `new ErosionWrapper()` + `SetVars(...)` at `Gaea.Nodes.whole.cs:696-698` |
| `Erosions.PE` | `ParallelErosion` | `new ParallelErosion.Parameters{...}` + `ParallelErosion.Simulation` at 738-766 |
| `Erosions.Thermal2` | `Thermal2` | 814 |
| `Simulations.Flow2` | `Flow` | 4510 |
| `Simulations.CreateFlowMap` | `Flow` (iterative) | 4619 |
| `Simulations.Snow` | `ErosionWrapperS` (CS) | 4568-4586 |
| `Simulations.Thermal` | `ErosionWrapper` (CE) | 4771-4800 |
| `Simulations.Crumble` | unresolved | 4520 |
| `Waters.Lakes` | `ErosionWrapperW` (CW) | 7095-7109 |
| `Waters.Sea` | `ErosionWrapperW` (CW), `EdgeFill` | 7132-7160 |
| `Profiles.ThermalShaper` | `ErosionWrapperTS` (TS) | 3957-3961 |

## 5. Coverage and confidence

* 19 distinct kernel call sites / helper bindings were observed; 6 of them are C++/CLI-module instantiations, the rest are SYCL-layer, CPU-native or helper calls.
* All C++/CLI→helper bindings are `observed` (the `new`/`SetVars` statements are in the decompilation) with high confidence.
* The `NativeLighting` and `Debris` node sets are `inferred` at medium confidence: their `SyclFunctions` classes expose no methods, so the binding goes through the delegate table and the Engine core, which is outside the decompiled node source.
* The node-side mapping is limited by a partial decompilation of `Gaea.Nodes.dll` (2 MB of a 799 KB assembly, i.e. most but not all `Build()` bodies). Nodes whose `Build()` is not in the file cannot be mapped either way.

# Gaea 2.3.1 — kernel reference: parameter surfaces and algorithm signatures

Targets: `D:\Gaea 2` (Gaea 2.3.1). This document reconstructs the parameter surface and the algorithm signature of every terrain-generation kernel that is reachable from the shipped managed and C++/CLI assemblies.

## 0. Method, evidence classes and what this document does NOT claim

| layer | what was read | how |
|---|---|---|
| C++/CLI algorithm wrappers | field list with types, method signatures | `GaeaDump memb` (`System.Reflection.Metadata`) on `Gaea.CE/CS/CW/TS.dll` |
| managed SYCL bindings | `*.Parameters` struct field lists, kernel entry methods, delegate table | `GaeaDump memb` on `Gaea.Engine.dll` |
| native kernels | demangled C++ signatures, namespaces, buffer element types, SYCL dimensionality | ASCII symbol table + `dbghelp!UnDecorateSymbolName` on `Gaea.Native/oneAPI/AdaptiveCpp*.dll` |
| node → kernel binding | object-initializer assignments from node `Build()` methods | `evidence/decompiled/Gaea.Nodes.whole.cs` |

**Evidence vocabulary.** `observed` = the token was read directly from metadata or from a demangled symbol / decompiled assignment. `inferred` = the physical meaning, tensor role or mathematical form is the analyst's interpretation of the observed parameter names and native signatures. This document never presents an inferred item as observed.

**Not claimed, and not obtainable at this layer:**

* numeric defaults, constant folding, iteration counts and loop bounds;
* the actual arithmetic inside any kernel (no kernel body, no IL for the native cores, no PDB, and the native DLLs were deliberately not disassembled);
* native struct byte offsets (managed metadata order is recorded, but the C++ struct layout was not read);
* runtime behaviour: nothing here was executed.

### 0.1 Two families of kernels

Gaea 2.3.1 exposes kernels through two independent, *overlapping* layers:

1. **C++/CLI algorithm modules** — `Gaea.CE.dll`, `Gaea.CS.dll`, `Gaea.CW.dll`, `Gaea.TS.dll`. Each is a mixed-mode assembly containing exactly one `QuadSpinner.ErosionWrapper*` class whose fields are the full parameter block and whose `SetVars(...)` method is the authoritative *active* parameter list. These are the ones the erosion/snow/water/thermal-shaper helpers call directly.
2. **Managed SYCL bindings** — `QuadSpinner.Gaea.Engine.SyclFunctions.*` in `Gaea.Engine.dll`, one class + one nested `Parameters` struct per kernel, resolved into a backend DLL (`Gaea.oneAPI.dll` / `Gaea.AdaptiveCpp*.dll` / `Gaea.Native.dll`) at runtime.

The two layers do not share a single parameter struct: `ParallelErosion.Parameters` (23 fields, SYCL layer) and `ErosionWrapper` (45 fields, C++/CLI layer) are different, differently-sized surfaces for the same algorithm family.

---

## 1. `ParallelErosion` — particle hydraulic erosion (the Erosion2/EasyErosion core)

| binding | value |
|---|---|
| managed entry | `QuadSpinner.Gaea.Engine.SyclFunctions.ParallelErosion.Simulation(Parameters, ValueTuple inMaps, out ValueTuple outMaps) -> NativeResult` *(observed)* |
| native namespaces | `parallel_erosion` (all backends), `parallel_erosion2` (AdaptiveCpp only) |
| node entry point | `Erosions.PE(...)` *(observed, `evidence/decompiled/Gaea.Nodes.whole.cs:732`)* |
| consumes | `Erosion2`, `EasyErosion` |

### 1.1 Managed parameter block (`ParallelErosion.Parameters`, 23 fields)

Field order is metadata order; names are 3-code-point private-use-area tokens (deliberate renaming, not an encoding). The *semantics* column is `observed`: it is the expression that `Erosions.PE` assigns to that exact field. Type sequence `Resolution, float×6, int, float×14, bool` is consistent with that assignment order, which is what makes the join safe.

| # | type | name / token | observed node-facing semantics |
|---|---|---|---|
| 1 | Resolution | `U+E231U+E782U+E759` | map.Resolution |
| 2 | Single | `U+E231U+E782U+E75A` | \uf55c\uf0ba\ue6d3.Terrain.Width |
| 3 | Single | `U+E231U+E782U+E75B` | \uf55c\uf0ba\ue6d3.Terrain.Height |
| 4 | Single | `U+E231U+E782U+E75C` | ErosionScale |
| 5 | Single | `U+E231U+E782U+E75D` | _(not assigned in the available decompilation)_ |
| 6 | Single | `U+E231U+E782U+E75E` | Duration |
| 7 | Single | `U+E231U+E782U+E75F` | _(not assigned in the available decompilation)_ |
| 8 | Int32 | `U+E231U+E782U+E760` | Seed |
| 9 | Single | `U+E231U+E782U+E761` | Downcutting |
| 10 | Single | `U+E231U+E782U+E762` | _(not assigned in the available decompilation)_ |
| 11 | Single | `U+E231U+E782U+E763` | Shape |
| 12 | Single | `U+E231U+E782U+E764` | ShapeSharpness |
| 13 | Single | `U+E231U+E782U+E765` | ShapeDetailScale |
| 14 | Single | `U+E231U+E782U+E766` | SuspendedLoadDischargeAmount |
| 15 | Single | `U+E231U+E782U+E767` | SuspendedLoadDischargeAngle |
| 16 | Single | `U+E231U+E782U+E768` | BedLoadDischargeAmount |
| 17 | Single | `U+E231U+E782U+E769` | BedLoadDischargeAngle |
| 18 | Single | `U+E231U+E782U+E76A` | CoarseSedimentsDischargeAmount |
| 19 | Single | `U+E231U+E782U+E76B` | CoarseSedimentsDischargeAngle |
| 20 | Single | `U+E231U+E782U+E76C` | DowncuttingType |
| 21 | Single | `U+E231U+E782U+E76D` | DepositionBoost |
| 22 | Single | `U+E231U+E782U+E76E` | ExtraDepositionBoost |
| 23 | Boolean | `U+E231U+E782U+E76F` | NoErosion |

`QuadSpinner.Gaea.Engine.SyclFunctions.ParallelErosion` declares only its constructor; the operation itself is reached through the `Sycl.SyclFunctions` delegate field `ParallelErosionSimulation` *(observed)*.

### 1.2 Native structure (`parallel_erosion::ParallelErosion`)

| namespace | class | method | parameter list (demangled) | SYCL item |
|---|---|---|---|---|
| parallel_erosion | LaplacianLevel | reconstruct_previous_level | parallel_erosion::Parameters const&,int | - |
| parallel_erosion | LaplacianLevel | reconstruct_previous_level | thermal::Parameters const& | - |
| parallel_erosion | LaplacianLevel | reconstruct_previous_level | thermal_shaper::Parameters const& | - |
| parallel_erosion | ParallelErosion | create_random_directions | unsigned int,int,sycl::queue | - |
| parallel_erosion | ParallelErosion | erode | void | - |
| parallel_erosion | ParallelErosion | erode_level | parallel_erosion::LaplacianLevel * | - |
| parallel_erosion | ParallelErosion | flow | buf<parallel_erosion::Particle,1,D> &,buf<unsigned int,1,D> &,buf<unsigned int,1,D> &,buf<unsigned int,1,D> &,sycl::range<1>,buf<float,2,D> &,buf<float,2,D> &,buf<float,2,D> & | - |
| parallel_erosion | ParallelErosion | render_flow | buf<parallel_erosion::Particle,1,D> &,buf<unsigned int,1,D> &,sycl::range<1>,buf<float,2,D> &,buf<float,2,D> &,buf<int,2,D> &,buf<int,2,D> &,buf<float,2,D> &,buf<float,2,D> & | - |

Nested native types observed by name: `parallel_erosion::Particle` (element type of a 1-D `sycl::buffer<Particle,1>`), `parallel_erosion::LaplacianLevel` (with `create_subsequent_level`, `reconstruct`, `reconstruct_previous_level`), and the `shape<0>` / `shape<10>` template instantiations of `ParallelErosion`.

### 1.3 Tensor I/O

`observed` — from the demangled signatures and the managed binding:

* input: 2-D `float` heightmap (plus optional 2-D mask) — `ValueTuple inMaps`, `Parameters.Resolution`;
* output: `ValueTuple outMaps` of five 2-D maps. `Erosions.PE` maps them to `height`, `wear`(=item2), `flow`(=item5) and `deposit`(=item3): `array2[0]=Item1 (height)`, `array2[1]=Item2`, `array2[3]=Item3`, `array2[2]=Item5` *(observed, Gaea.Nodes.whole.cs:802-807)*;
* internal particle state: 1-D buffers `buffer<Particle,1>` plus three `buffer<unsigned int,1>` (counters/indices) and a `sycl::range<1>` work size;
* flow rendering writes both 2-D `float` and 2-D `int` (accumulation) maps.

`inferred` — tensor roles: `Item2` is a wear/erosion-amount field and the `buffer<int,2>` pair in `render_flow` are a flow-direction/accumulation pair (confidence: medium for the exact pairing, high for the map count).

### 1.4 Standard mathematical form (inferred)

The native surface is a **particle (droplet) hydraulic-erosion solver on a Laplacian pyramid**: `Particle` buffers, a seed-driven `create_random_directions(unsigned, int, queue) -> buffer<vec<float,2>,1>`, an `erode()` pass, a `flow()` pass and a `render_flow()` pass, driven level by level through `LaplacianLevel`.

The canonical droplet model this signature matches (Beyer; Mei et al.): for each particle *p* with position `x ∈ R²`, velocity `v`, water `w` and sediment `s`:

```text
v  <- normalize(sample_gradient(z, x)) * v + inertia * v      # advect downslope
x  <- x + dt * v
c  = capacity(x) * w * speed * sin(slope(x))                   # carrying capacity
if s < c:  z(x) -= K_e * (c - s);  s += K_e * (c - s)          # erode  (stream power)
else:      z(x) += K_d * (s - c);  s -= K_d * (s - c)          # deposit
w  <- (1 - evaporation) * w
```

The parameter names in the managed struct line up with the **stream-power / sediment-discharge** family: `SuspendedLoadDischargeAmount|Angle`, `BedLoadDischargeAmount|Angle`, `CoarseSedimentsDischargeAmount|Angle`, `Downcutting`, `ErosionScale`, `DepositionBoost`, `ExtraDepositionBoost`, `NoErosion`, `Shape`, `ShapeSharpness`, `ShapeDetailScale`. The three *amount/angle* pairs are a size-fractionated sediment transport law (suspended / bed load / coarse), each with a slope-angle threshold — this is the "discharge vs. angle" curve of the coarse-grained Gaea erosion model. (confidence: high for the transport-law family, low for each exact mapping coefficient).

The `LaplacianLevel` pyramid (fields `LaplacianLevel::create_subsequent_level`, `reconstruct`, `reconstruct_previous_level(Parameters const&, int)`) is `observed`; interpreting it as a multi-resolution (multigrid) erosion that erodes coarse levels first and reconstructs detail is `inferred` (confidence: high).

### 1.5 Visibility limits

* `parallel_erosion::Parameters` / `erode()` bodies were not read: iteration counts, the discharge-curve functional form, the pyramid depth and the termination rule are all unknown.
* The `shape<0>` / `shape<10>` instantiations are visible as names only; which grid/vector width they dispatch on is unknown.
* 3 of 23 field meanings (ordinals 5, 7, 10) have no observed node assignment.

---

## 2. `QuadSpinner.ErosionWrapper` (`Gaea.CE.dll`) — "Classic" fluvial + thermal erosion

`observed`: `Gaea.Nodes.whole.cs:696` instantiates `new ErosionWrapper()` inside `Erosions.Classic(...)`, which is called by the `Erosion` and `Wizard` nodes. `Simulations.Thermal(...)` (line 4771/4800) uses the same wrapper, i.e. the C++/CLI module carries *both* the fluvial and the thermal stage.

### 2.1 Full field list (45 fields; every field name is readable)

| # | field | type | inferred physical meaning | confidence |
|---|---|---|---|---|
| 1 | `ev` | CppEvent | C++/CLI progress event bridge | high |
| 2 | `AbortCheck` | AbortCheckDelegate | cancellation delegate | high |
| 3 | `results` | Single[] | output: eroded heightmap | high |
| 4 | `wear` | Single[] | output: wear / total eroded volume map | high |
| 5 | `deposit` | Single[] | output: deposited sediment map | high |
| 6 | `flow` | Single[] | output: flow / water map | high |
| 7 | `erosion` | Erosion* | native core handle (`Erosion*`) | high |
| 8 | `heightmap` | Single[] | input heightmap (ref) | high |
| 9 | `mask` | Single[] | input area mask (ref) | high |
| 10 | `sediment_removal_mask` | Single[] | input sediment-removal mask (ref) | high |
| 11 | `m_resolution` | Int32 | grid edge length N (square) | high |
| 12 | `m_seed` | Int32 | RNG seed | high |
| 13 | `m_size` | Double | terrain size in metres (`TerrainScale` is passed here) | high |
| 14 | `m_scale` | Double | erosion/feature scale (`FeatureScale` is passed here) | high |
| 15 | `m_duration` | Double | simulation duration | high |
| 16 | `m_rock_softness` | Double | rock softness; scales erodibility | high |
| 17 | `m_fluvial_erosion_strength` | Double | fluvial (stream-power) coefficient K | medium |
| 18 | `m_downcutting` | Double | vertical incision rate | medium |
| 19 | `m_base_level` | Double | base level below which incision stops | medium |
| 20 | `m_retardation_of_downcutting` | Double | downcutting inhibition (`Inhibition`) | high |
| 21 | `m_enable_thermal` | Boolean | enable the thermal (mass-wasting) stage | high |
| 22 | `m_thermal_erosion_strength` | Double | thermal diffusion rate | high |
| 23 | `m_thermal_rock_angle` | Double | rock angle used by the thermal model | medium |
| 24 | `m_talus_angle` | Double | talus / angle of repose | high |
| 25 | `m_thermal_size` | Double | thermal feature scale | medium |
| 26 | `m_flow_volume` | Double | water volume / discharge scale (`Volume`) | high |
| 27 | `m_mask_by_shader` | Boolean | use the mask input at all | high |
| 28 | `m_invert_mask` | Boolean | invert the mask | high |
| 29 | `m_masking_mode` | Int32 | masking mode selector (derived from `AreaEffect`) | medium |
| 30 | `m_mask_as_thermal_erosion_strength` | Boolean | reuse the mask as thermal strength | medium |
| 31 | `m_thermal_model` | Int32 | thermal model selector | medium |
| 32 | `m_rivers_mode` | Boolean | rivers/headwater carving mode | medium |
| 33 | `m_lakes` | Double | lake amount | medium |
| 34 | `m_rivers_depth` | Double | river incision depth | medium |
| 35 | `m_rivers_width` | Double | river channel width | medium |
| 36 | `m_headwaters_density` | Double | spring/headwater density | medium |
| 37 | `m_laminar_flow` | Boolean | laminar instead of turbulent flow | medium |
| 38 | `m_randomness` | Double | RNG amplitude for particle placement | medium |
| 39 | `m_threads` | Int32 | CPU thread count (not in `SetVars`) | high |
| 40 | `m_height_range` | Double | vertical range of the terrain (`Verticality`) | high |
| 41 | `m_talus_settling` | Double | thermal settling per iteration (`Settling`) | medium |
| 42 | `m_thermal_smoothness` | Double | thermal smoothing | medium |
| 43 | `m_debris_size` | Double | debris / boulder size | medium |
| 44 | `m_thermal_detail` | Boolean | thermal detail preservation | medium |
| 45 | `m_sediment_removal` | Double | sediment removal strength (`SedimentRemoval`) | high |

### 2.2 Active parameter list — `SetVars` (observed, authoritative)

```text
Void SetVars(Int32 resolution, Int32 seed, Double size, Double scale, Double duration, Double rock_softness, Double fluvial_erosion_strength, Double downcutting, Double base_level, Double retardation_of_downcutting, Boolean enable_thermal, Double thermal_erosion_strength, Double thermal_rock_angle, Double talus_angle, Double thermal_size, Double flow_volume, Boolean mask_by_shader, Boolean invert_mask, Int32 masking_mode, Boolean mask_as_thermal_erosion_strength, Int32 thermal_model, Boolean rivers_mode, Double lakes, Double rivers_depth, Double rivers_width, Double headwaters_density, Boolean laminar_flow, Double randomness, Double thermal_smoothness, Double talus_settling, Boolean thermal_detail, Double debris_size, Double height_range)
```
```text
Void SetVars(Int32 resolution, Int32 seed, Double size, Double scale, Double duration, Double rock_softness, Double fluvial_erosion_strength, Double downcutting, Double base_level, Double retardation_of_downcutting, Boolean enable_thermal, Double thermal_erosion_strength, Double thermal_rock_angle, Double talus_angle, Double thermal_size, Double flow_volume, Boolean mask_by_shader, Boolean invert_mask, Int32 masking_mode, Boolean mask_as_thermal_erosion_strength, Int32 thermal_model, Double sediment_removal, Boolean rivers_mode, Double lakes, Double rivers_depth, Double rivers_width, Double headwaters_density, Boolean laminar_flow, Double randomness, Double thermal_smoothness, Double talus_settling, Boolean thermal_detail, Double debris_size, Double height_range)
```

Two overloads exist; they differ only by the position of `sediment_removal`, so the module supports a build without the sediment-removal stage. `ErodeTerrain` also has two overloads (`(heightmap, mask, fixed)` and `(heightmap, mask, sediment_removal_mask, fixed)`) — both `observed`.

The `Erosions.Classic` signature (`Duration, RockSoftness, Strength, Downcutting, Inhibition, BaseLevel, RealScale, FeatureScale, TerrainScale, Verticality, Debris, Volume, SedimentRemoval, AreaEffect, BiasType, Bias, ReverseBias, Seed, AggressiveMode, Deterministic, areaMask, srMask` — `observed`, line 691) maps positionally onto `SetVars` in the same order, which is what pins the meanings above.

### 2.3 Standard mathematical form (inferred)

```text
# fluvial stage: stream-power incision with sediment transport
dz/dt = -(K * A^m * S^n) * softness + deposition
downcutting ~ vertical lowering only; base_level clamps the incision floor;
retardation_of_downcutting damps dz/dt as the surface approaches base_level.
# thermal stage (enable_thermal): talus-angle mass wasting
for each cell i, for each neighbour j: if S_ij > talus_angle:
    move = k * (S_ij - talus_angle) * (z_j - z_i)
randomness jitters particle/flow placement; laminar_flow switches the
flow-accumulation to a non-turbulent (sheet) regime.
```

`rivers_mode`, `headwaters_density`, `rivers_width`, `rivers_depth` and `lakes` indicate an *explicit channel-network* generator layered on the erosion stage (`inferred`, confidence medium).

### 2.4 Visibility limits

* `Gaea.CE.dll`'s native code is a mixed-mode C++ image without PDB: the actual incision/diffusion arithmetic and its constants are not recoverable here.
* `m_threads` is a field but is not settable through `SetVars`, so the threading policy is not visible from the managed surface.
* `m_masking_mode`, `m_thermal_model` are integer selectors whose enumerations are not declared in this assembly.

---

## 3. `QuadSpinner.ErosionWrapperS` (`Gaea.CS.dll`) — snow accumulation and melt

`observed`: instantiated in `Simulations.Snow(...)` (`Gaea.Nodes.whole.cs:4568`, `SetVars` at 4567-4586), called by the `Snow`, `Snowfield`, `Shrubs` and `Trees` nodes. The letter `S` matches the snow field set; that expansion is `inferred`, the *role* is `observed`.

### 3.1 Fields (49) — shared erosion block plus the snow block

| # | field | type | inferred physical meaning | confidence |
|---|---|---|---|---|
| 1 | `latestVersion` | Int32 | current parameter version constant | medium |
| 2 | `ev` | CppEventS | C++/CLI progress event bridge | high |
| 3 | `AbortCheck` | AbortCheckDelegate | cancellation delegate | high |
| 4 | `results` | Single[] | output: eroded heightmap | high |
| 5 | `snow` | Single[] | output: snow mask/depth map | high |
| 6 | `hardmask` | Single[] | output: hard snow mask | high |
| 7 | `softmask` | Single[] | output: soft/partial snow mask | high |
| 8 | `version` | Int32 | serialisation/parameter version selector | medium |
| 9 | `erosion` | Erosion* | native core handle (`Erosion*`) | high |
| 10 | `m_resolution` | Int32 | grid edge length N (square) | high |
| 11 | `m_seed` | Int32 | RNG seed | high |
| 12 | `m_size` | Double | terrain size (`RealScale`/`Scale`) | high |
| 13 | `m_scale` | Double | scale parameter | medium |
| 14 | `m_iduration` | Int32 | integer mirror of `m_duration` (cache key / hashing) | medium |
| 15 | `m_isnowfall_duration` | Int32 | integer mirror of `m_snowfall_duration` | medium |
| 16 | `m_ipost_snowfall_duration` | Int32 | integer mirror of `m_post_snowfall_duration` | medium |
| 17 | `m_duration` | Double | total simulation duration (`Duration`) | high |
| 18 | `m_snowfall_duration` | Double | length of the snowfall phase (`Duration`) | high |
| 19 | `m_post_snowfall_duration` | Double | settle/thaw phase length (`SettleThaw`) | high |
| 20 | `m_snowfall_intensity` | Double | snowfall rate (`Intensity`) | high |
| 21 | `m_melting` | Double | melt rate (`Melt`) | high |
| 22 | `m_snow_line` | Double | altitude of the snow line (`SnowLine`) | high |
| 23 | `m_rock_softness` | Double | rock softness; scales erodibility | high |
| 24 | `m_fluvial_erosion_strength` | Double | fluvial (stream-power) coefficient K | medium |
| 25 | `m_downcutting` | Double | vertical incision rate | medium |
| 26 | `m_base_level` | Double | base level below which incision stops | medium |
| 27 | `m_enable_thermal` | Boolean | enable the thermal (mass-wasting) stage | high |
| 28 | `m_thermal_erosion_strength` | Double | thermal diffusion rate | high |
| 29 | `m_thermal_rock_angle` | Double | rock angle used by the thermal model | medium |
| 30 | `m_talus_angle` | Double | talus / angle of repose | high |
| 31 | `m_debris_size` | Double | debris size | medium |
| 32 | `m_flow_volume` | Double | water volume / discharge scale (`Volume`) | high |
| 33 | `m_mask_by_shader` | Boolean | use the mask input at all | high |
| 34 | `m_invert_mask` | Boolean | invert the mask | high |
| 35 | `m_masking_mode` | Int32 | masking mode selector (derived from `AreaEffect`) | medium |
| 36 | `m_mask_as_thermal_erosion_strength` | Boolean | reuse the mask as thermal strength | medium |
| 37 | `m_thermal_model` | Int32 | thermal model selector | medium |
| 38 | `m_rivers_mode` | Boolean | rivers/headwater carving mode | medium |
| 39 | `m_lakes` | Double | lake amount | medium |
| 40 | `m_rivers_depth` | Double | river incision depth | medium |
| 41 | `m_rivers_width` | Double | river channel width | medium |
| 42 | `m_headwaters_density` | Double | spring/headwater density | medium |
| 43 | `m_laminar_flow` | Boolean | laminar instead of turbulent flow | medium |
| 44 | `m_randomness` | Double | RNG amplitude for particle placement | medium |
| 45 | `m_threads` | Int32 | CPU thread count (not in `SetVars`) | high |
| 46 | `m_snowfall_mask` | Boolean | use a supplied snowfall-area mask | high |
| 47 | `m_melt_mask` | Boolean | use a supplied melt-area mask | high |
| 48 | `m_height_range` | Double | vertical range of the terrain (`Verticality`) | high |
| 49 | `m_snow_output` | Int32 | which snow product to return | medium |

### 3.2 Active parameter list — `SetVars` (observed)

```text
Void SetVars(Int32 resolution, Int32 seed, Double size, Double scale, Double duration, Double snowfall_duration, Double snowfall_intensity, Double post_snowfall_duration, Double melting, Double snow_line, Double rock_softness, Double fluvial_erosion_strength, Double downcutting, Double base_level, Boolean enable_thermal, Double thermal_erosion_strength, Double thermal_rock_angle, Double talus_angle, Double debris_size, Double flow_volume, Boolean mask_by_shader, Boolean invert_mask, Int32 masking_mode, Boolean mask_as_thermal_erosion_strength, Int32 thermal_model, Boolean rivers_mode, Double lakes, Double rivers_depth, Double rivers_width, Double headwaters_density, Boolean laminar_flow, Double randomness, Boolean use_snowfall_area, Boolean use_melt_area, Double height_range, Int32 snow_output)
```

`ErodeTerrain(Single[]& heightmap, Single[]& snowfall_area, Single[]& melt_area, Boolean fixed)` — **two auxiliary input maps and one snow output map**, which is the observable difference from `Gaea.CE.dll`.

### 3.3 Tensor I/O

`observed`: in = heightmap, snowfall-area mask, melt-area mask; out = `results` (height), `snow`, `hardmask`, `softmask`.

### 3.4 Standard mathematical form (inferred)

```text
# accumulation phase (snowfall_duration)
snow(x) += intensity * dt * snowfall_mask(x) * (z(x) > snow_line)
# settle / thaw phase (post_snowfall_duration)
snow(x) -= melt * dt * melt_mask(x) * temperature_proxy(z, snow_line)
# masked by hardness/softness -> hardmask / softmask outputs
```
A degree-day-style accumulation/ablation model is the standard form that matches the parameter names (`snowfall_duration/intensity`, `melting`, `snow_line`, `post_snowfall_duration`). `inferred`, confidence high for the family, low for the temperature proxy.

---

## 4. `QuadSpinner.ErosionWrapperW` (`Gaea.CW.dll`) — lakes / sea water level

`observed`: instantiated in `Waters.Lakes(...)` (line 7095) and `Waters.Sea(...)` (line 7132); the node call sites include `Lake`, `Sea`, `Rivers`. The module exposes **two additional entry points that no other wrapper has**: `FloodFill(heightmap, x, y, level, fixed)` and `EdgeFill(heightmap, level, fixed, mask)`.

### 4.1 Fields (20)

| # | field | type | inferred physical meaning | confidence |
|---|---|---|---|---|
| 1 | `ev` | CppEventW | — | — |
| 2 | `results` | Single[] | output: terrain with water bodies filled | high |
| 3 | `depth` | Single[] | output: water depth map | high |
| 4 | `shore` | Single[] | output: shoreline / shore mask | high |
| 5 | `surface` | Single[] | output: water surface level map | high |
| 6 | `m_resolution` | Int32 | grid edge length | high |
| 7 | `m_size` | Double | terrain size | high |
| 8 | `m_scale` | Double | scale | medium |
| 9 | `m_shore_size` | Double | shore band width (`ShoreSize`) | high |
| 10 | `m_precipitation` | Double | precipitation amount (`Precipitation`) | high |
| 11 | `m_precipitation_amount` | Double | precipitation volume scaling | medium |
| 12 | `m_evaporation` | Double | evaporation rate | medium |
| 13 | `m_lake_size_bias` | Double | bias towards small vs. large lakes (`SmallLakes`) | high |
| 14 | `m_threads` | Int32 | CPU thread count | high |
| 15 | `m_precipitation_mask` | Boolean | use a supplied precipitation-area mask | high |
| 16 | `m_evaporation_mask` | Boolean | use a supplied evaporation-area mask | high |
| 17 | `m_height_range` | Double | vertical range of the terrain | high |
| 18 | `m_altitude_bias` | Double | altitude bias for lake formation (`AltitudeBias`) | high |
| 19 | `m_size_bias` | Double | size bias for lake formation (`SizeBias`) | high |
| 20 | `m_water_floor` | Double | floor level of the water body (`WaterFloor`) | high |

### 4.2 Active parameter list and entry points (observed)

```text
Void .ctor()
```
```text
Void SetEvent(CppEventW e)
```
```text
Single[] ErodeTerrain(Single[]& heightmap, Single[]& precipitation_area, Boolean fixed)
```
```text
Single[] FloodFill(Single[]& heightmap, Int32 x, Int32 y, Single level, Boolean fixed)
```
```text
Single[] EdgeFill(Single[] heightmap, Single level, Boolean fixed, Single[] mask)
```
```text
Void SetVars(Int32 resolution, Double precipitation, Double water_floor, Double lake_size_bias, Double shore_size, Double altitude_bias, Double size_bias, Boolean use_precipitation_area, Double size, Double height_range)
```

### 4.3 Standard mathematical form (inferred)

```text
# 1. depression filling (priority-flood, Barnes et al.)
fill each local minimum up to its lowest spill point -> surface map
# 2. lake level / spill-over
surface(x) = max(z(x), level);  water_floor clamps the minimum level;
altitude_bias and size_bias weight which depressions become lakes;
lake_size_bias favours many small or few large basins.
# 3. outputs
depth(x) = surface(x) - z(x);  shore(x) = depth < shore_size
```
`FloodFill(x, y, level)` is the seeded variant (fill from one seed cell) and `EdgeFill(level, mask)` the boundary-seeded variant (used by the `Sea` node, which fills from the terrain edge) — `inferred`, confidence high, based on the observed names and argument lists.

---

## 5. `QuadSpinner.ErosionWrapperTS` (`Gaea.TS.dll`) — thermal / profile shaping

`observed`: instantiated in `Profiles.ThermalShaper(...)` (`Gaea.Nodes.whole.cs:3957`, `ErodeTerrain(ref heightmap)` at 3961).

**Important negative finding:** the class declares 44 fields but its `SetVars` takes only `resolution, size, scale, duration, intensity`, and `ErodeTerrain` takes only the heightmap. The other 39 fields — including an entire copy of the `ErosionWrapper` fluvial/thermal block plus `m_talus_settling`, `m_thermal_smoothness`, `m_thermal_detail`, `m_debris_size`, `m_retardation_of_downcutting`, `m_sediment_removal`, `m_influence` — are therefore *declared but not reachable* from this module's own API (`observed`: the parameter list is the whole of what `SetVars` accepts).

### 5.1 Fields — active vs. declared

| # | field | type | reachability from this module's API |
|---|---|---|---|
| 1 | `ev` | CppEventTS | active I/O field (used by `SetEvent`/`ErodeTerrain`/results) |
| 2 | `AbortCheck` | AbortCheckDelegate | active I/O field (used by `SetEvent`/`ErodeTerrain`/results) |
| 3 | `results` | Single[] | active I/O field (used by `SetEvent`/`ErodeTerrain`/results) |
| 4 | `erosion` | Erosion* | active I/O field (used by `SetEvent`/`ErodeTerrain`/results) |
| 5 | `heightmap` | Single[] | active I/O field (used by `SetEvent`/`ErodeTerrain`/results) |
| 6 | `mask` | Single[] | active I/O field (used by `SetEvent`/`ErodeTerrain`/results) |
| 7 | `sediment_removal_mask` | Single[] | active I/O field (used by `SetEvent`/`ErodeTerrain`/results) |
| 8 | `m_resolution` | Int32 | **active parameter** (`SetVars`) |
| 9 | `m_seed` | Int32 | declared, not settable through this module's API |
| 10 | `m_size` | Double | **active parameter** (`SetVars`) |
| 11 | `m_scale` | Double | **active parameter** (`SetVars`) |
| 12 | `m_duration` | Double | **active parameter** (`SetVars`) |
| 13 | `m_rock_softness` | Double | declared, not settable through this module's API |
| 14 | `m_fluvial_erosion_strength` | Double | declared, not settable through this module's API |
| 15 | `m_downcutting` | Double | declared, not settable through this module's API |
| 16 | `m_base_level` | Double | declared, not settable through this module's API |
| 17 | `m_retardation_of_downcutting` | Double | declared, not settable through this module's API |
| 18 | `m_enable_thermal` | Boolean | declared, not settable through this module's API |
| 19 | `m_thermal_erosion_strength` | Double | declared, not settable through this module's API |
| 20 | `m_thermal_rock_angle` | Double | declared, not settable through this module's API |
| 21 | `m_talus_angle` | Double | declared, not settable through this module's API |
| 22 | `m_thermal_size` | Double | declared, not settable through this module's API |
| 23 | `m_flow_volume` | Double | declared, not settable through this module's API |
| 24 | `m_mask_by_shader` | Boolean | declared, not settable through this module's API |
| 25 | `m_invert_mask` | Boolean | declared, not settable through this module's API |
| 26 | `m_masking_mode` | Int32 | declared, not settable through this module's API |
| 27 | `m_mask_as_thermal_erosion_strength` | Boolean | declared, not settable through this module's API |
| 28 | `m_thermal_model` | Int32 | declared, not settable through this module's API |
| 29 | `m_rivers_mode` | Boolean | declared, not settable through this module's API |
| 30 | `m_lakes` | Double | declared, not settable through this module's API |
| 31 | `m_rivers_depth` | Double | declared, not settable through this module's API |
| 32 | `m_rivers_width` | Double | declared, not settable through this module's API |
| 33 | `m_headwaters_density` | Double | declared, not settable through this module's API |
| 34 | `m_laminar_flow` | Boolean | declared, not settable through this module's API |
| 35 | `m_randomness` | Double | declared, not settable through this module's API |
| 36 | `m_threads` | Int32 | declared, not settable through this module's API |
| 37 | `m_height_range` | Double | declared, not settable through this module's API |
| 38 | `m_talus_settling` | Double | declared, not settable through this module's API |
| 39 | `m_thermal_smoothness` | Double | declared, not settable through this module's API |
| 40 | `m_debris_size` | Double | declared, not settable through this module's API |
| 41 | `m_thermal_detail` | Boolean | declared, not settable through this module's API |
| 42 | `m_sediment_removal` | Double | declared, not settable through this module's API |
| 43 | `m_intensity` | Double | **active parameter** (`SetVars`) |
| 44 | `m_influence` | Double | declared, not settable through this module's API |

### 5.2 Entry points (observed)

```text
Void .ctor()
```
```text
Void SetEvent(CppEventTS e)
```
```text
Single[] ErodeTerrain(Single[]& heightmap)
```
```text
Void SetVars(Int32 resolution, Double size, Double scale, Double duration, Double intensity)
```
```text
Boolean ReturnFalse()
```
```text
Void WriteOutputData(Int32 y)
```
```text
Single clamp(Single x)
```
```text
Void WriteInputData(Int32 y)
```
```text
Void WriteInputDataA(Int32 y)
```
```text
Void WriteInputDataSR(Int32 y)
```
```text
Void WriteInputDataASR(Int32 y)
```

The actual call is decisive (`observed`, `Gaea.Nodes.whole.cs:3954-3962`):

```csharp
internal static Map ThermalShaper(Map map, float Influence = 1f, float Shape = 0.25f)
{
    ErosionWrapperTS w = new ErosionWrapperTS();
    w.SetVars(map.Resolution.X, <const>, <const>, <const>, Shape);  // intensity <- Shape
    float[] heightmap = map.ToArray();
    w.ErodeTerrain(ref heightmap);
    return ClassicCombiner.Combine(map.ToArray(), w.results, Influence, ...);
}
```

So the kernel receives only `Shape` (as `intensity`) plus three compile-time constants, and `Influence` is applied **outside** the kernel by the managed `ClassicCombiner`. `m_influence` is a declared field that nothing in this path sets. The managed `ThermalShaper.Parameters` (section 7) is a different, richer surface with `Scale`, `Influence`, `Shape`, `MicrodetailPreservation`; the two are separate implementations of the thermal-shaper idea (`observed`).

### 5.3 Standard mathematical form (inferred)

```text
# profile shaping: move the surface towards a shaped target while
# preserving micro-detail
t(x)   = shape(scale * z(x))          # shaped profile target
z'(x) = z(x) + intensity * influence * (t(x) - z(x))
```
`inferred`, confidence low: the module's active surface is too small to identify the shaping function. The 39 unreachable fields suggest this module is a legacy or reduced build of the erosion core.

---

## 6. `Thermal2` — thermal erosion / mass wasting (SYCL layer)

| binding | value |
|---|---|
| managed entry | `SyclFunctions.Thermal2.ThermalSimulation(Parameters, inMaps, out outMaps) -> Boolean` *(observed)* |
| native namespace | `thermal` |
| node entry point | `Erosions.Thermal2(...)` (line 812), also reached through `Simulations.Thermal` for the CPU path |
| nodes | `Thermal`, `Thermal2`, `Erosion2`, `EasyErosion` |

### 6.1 Parameters (11 fields, names readable)

| # | field | type | inferred physical meaning | confidence |
|---|---|---|---|---|
| 1 | `Resolution` | Resolution | grid dimensions | high |
| 2 | `Duration` | Single | number of relaxation iterations / time | high |
| 3 | `Strength` | Single | diffusion rate | high |
| 4 | `Anisotropy` | Single | directional weighting of the talus transport | high |
| 5 | `TalusAngle` | Single | angle of repose threshold (`Angle`) | high |
| 6 | `ErosionScale` | Single | feature scale (`FeatureScale`) | high |
| 7 | `HeightmapSize` | Single | terrain width in world units | high |
| 8 | `HeightmapHeight` | Single | terrain height in world units | high |
| 9 | `SedimentRemoval` | Single | sediment removal strength | high |
| 10 | `UseAreaMask` | Boolean | apply an area mask | high |
| 11 | `UseSedimentRemovalMask` | Boolean | apply a sediment-removal mask | high |

`observed` node assignment (`Erosions.Thermal2`, line 814) confirms `TalusAngle <- Angle`, `ErosionScale <- FeatureScale`, `HeightmapSize <- Terrain.Width`, `HeightmapHeight <- Terrain.Height`, `UseAreaMask <- (area != null)`, `UseSedimentRemovalMask <- (sedimentRemoval != null)`.

### 6.2 Native structure (`thermal::Thermal`)

| namespace | class | method | parameter list (demangled) |
|---|---|---|---|
| thermal | Thermal | simulation | float,thermal::LaplacianLevel &,int,float |

`thermal::LaplacianLevel` also exists, and its `reconstruct_previous_level` takes a `thermal::Parameters const&` — the same pyramid structure as `parallel_erosion`.

### 6.3 Tensor I/O

`observed`: 2-D `float` buffers only (no particle buffer, unlike `parallel_erosion`); `ValueTuple inMaps` / `ValueTuple outMaps` in the managed binding, with `height`, `deposition` and `wear` named in the `Erosions.Thermal2` `out` tuple (line 812).

### 6.4 Standard mathematical form (inferred)

```text
# talus-angle (thermal) erosion, Musgrave-style with anisotropy
for each cell i:  T_i = talus_angle * anisotropy(neighbour direction)
for each neighbour j:  d = z_i - z_j
    if d > T_ij:  transfer += strength * (d - T_ij) / 2
z_i -= transfer;  neighbours += transfer/n
repeat `duration` times;  sediment_removal drains transferred material
```
`inferred`, confidence high for the family, low for the exact per-neighbour split.

---

## 7. `ThermalShaper` (SYCL layer)

| binding | value |
|---|---|
| managed entry | `SyclFunctions.ThermalShaper.Process(Parameters, inMaps, out Map) -> Boolean` *(observed)* |
| native namespace | `thermal_shaper` |
| node | `ThermalShaper.Build()` (line 31965); the C++/CLI counterpart is `ErosionWrapperTS` (section 5) via `Profiles.ThermalShaper` |

### 7.1 Parameters (7 fields — all names recovered)

| # | type | name / token | observed node assignment | inferred physical meaning | confidence |
|---|---|---|---|---|---|
| 1 | Resolution | `U+F3C2U+F291U+E076` | map.Resolution | — | — |
| 2 | Single | `U+F3C2U+F291U+E077` | \uf55c\uf0ba\ue6d3.Terrain.Width | — | — |
| 3 | Single | `U+F3C2U+F291U+E078` | \uf55c\uf0ba\ue6d3.Terrain.Height | — | — |
| 4 | Single | `U+F3C2U+F291U+E079` | Scale | — | — |
| 5 | Single | `U+F3C2U+F291U+E07A` | Influence | — | — |
| 6 | Single | `U+F3C2U+F291U+E07B` | Shape | — | — |
| 7 | Single | `U+F3C2U+F291U+E07C` | MicrodetailPreservation | — | — |

The native `thermal_shaper::ThermalShaper::process` operates on the same `LaplacianLevel` pyramid (`thermal_shaper::LaplacianLevel::reconstruct_previous_level(Parameters const&)`), so this kernel is a pyramid-shaped profile operator rather than a per-cell filter (`observed` for the pyramid, `inferred` for the consequence).

### 7.2 Tensor I/O and form

`observed`: 2-D `float` in-maps, single 2-D `float` output map. `inferred` form:

```text
t(x)   = shape_curve(scale * z(x))                     # target profile
z'(x)  = lerp(z(x), t(x), influence)
z'(x) += microdetail_preservation * (z(x) - blur(z(x)))
```

---

## 8. `Flow` — flow accumulation / flow map

| binding | value |
|---|---|
| managed entry | `SyclFunctions.Flow.Simulation(Parameters, inMaps, out Map) -> Boolean` *(observed)* |
| native namespace | `flow` |
| node entry point | `Simulations.Flow2(...)` (line 4508/4510) |
| nodes | `FlowMap`, `FlowMapClassic` (via `Simulations.CreateFlowMap`), `SuperColor`, `Dusting`, `Scree`, `Shrubs`, `Trees`, `Texturize`, `Anastomosis` |

### 8.1 Parameters (4 fields, names readable)

| # | field | type | inferred physical meaning | confidence |
|---|---|---|---|---|
| 1 | `Resolution` | Resolution | grid dimensions | high |
| 2 | `FlowLength` | Single | flow path length / integration distance | high |
| 3 | `FlowVolume` | Single | water volume per particle | high |
| 4 | `Seed` | Int32 | RNG seed for particle placement | high |

`observed` node assignment: `Resolution <- map.Resolution`, `FlowLength <- Strength` (`SuperColor`) or `FlowLength` (`Simulations.Flow2`), `FlowVolume`, `Seed`.

### 8.2 Native structure (`flow::Flow`)

| class | method | parameter list (demangled) | SYCL item | vector |
|---|---|---|---|---|
| Flow | fill_pits | buf<float,2,D> &,buf<float,2,D> &,buf<float,2,D> & | - | - |
| Flow | fill_pits | buf<float,2,D> &,buf<float,2,D> & | - | - |
| Flow | flow | buf<vec<float,2>,1,alloc<vec<float,2> >,void> &,unsigned int,unsigned int,unsigned int,unsigned int,buf<float,2,D> &,buf<float,2,D> &,buf<vec<float,2>,1,alloc<vec<float,2> >,void> & | - | float2 |
| Flow | process | void | - | - |

`flow()` takes a **1-D `buffer<vec<float,2>,1>`** (particles, i.e. positions) plus four `unsigned int` scalars, two 2-D `float` maps and another 1-D `vec<float,2>` buffer. `fill_pits` has a 2-buffer and a 3-buffer overload. There is no particle *struct* here — unlike `parallel_erosion::Particle` — so the flow particle carries position only (`observed` for the buffers, `inferred` for the interpretation).

### 8.3 Tensor I/O

`observed`: in = 2-D heightmap (+ optional 2-D precipitation map); out = single 2-D `float` flow map. Internally: particle buffer + pit-filled height + flow-accumulation map.

### 8.4 Standard mathematical form (inferred)

```text
# 1. depression filling (fill_pits) so every cell has a downslope path
# 2. particle flow routing
for each of N particles released at random cells (seed):
    follow the steepest-descent / D-infinity direction for flow_length steps
    accumulate 1/flow_volume into the visited cells
# 3. output = accumulation (optionally oriented by a guide map)
```
The two-buffer `fill_pits` overload is consistent with priority-flood `(height, filled)`; the three-buffer overload with `(height, filled, marker)` (`inferred`). `Simulations.CreateFlowMap(height, width, m_iterations, heights, rain, oriented)` — `observed` at line 4619 — shows an *iterative* variant, and its `oriented` flag matches the `FlowMap` node's `Oriented` parameter.

---

## 9. `ColorTransport` — sediment colour advection

| binding | value |
|---|---|
| managed entry | `SyclFunctions.ColorTransport.Simulation(Parameters, inMaps, out Map) -> Boolean` *(observed)* |
| native namespace | `color_transport` |
| nodes | `Cartography`, `Weathering`, `SuperColor`, `ColorErosion`, `Dusting` |

### 9.1 Parameters (8 fields, names readable)

| # | field | type | inferred physical meaning | confidence |
|---|---|---|---|---|
| 1 | `Resolution` | Resolution | grid dimensions | high |
| 2 | `TransportDistance` | Single | advection distance of the colour along the flow | high |
| 3 | `SedimentDensity` | Single | sediment concentration controlling colour pickup | high |
| 4 | `Blend` | Single | blend amount between transported and original colour | high |
| 5 | `FlowVolume` | Single | water volume used for the advection step | high |
| 6 | `ColorHold` | Single | resistance of the colour to being transported | medium |
| 7 | `LaminarFlow` | Boolean | laminar vs. turbulent advection | high |
| 8 | `Seed` | Int32 | RNG seed | high |

`observed` node assignment (`Cartography`, line 8664): `Resolution <- context.Resolution`, `LaminarFlow`, `Seed`; `Dusting` (line 35324) assigns all eight.

### 9.2 Native structure

| namespace | class | method | parameter list (demangled) | vector |
|---|---|---|---|---|
| color_transport | ColorTransport | color_transport | (44 parameters) buf<vec<float,2>,1,alloc<vec<float,2> >,void> &,unsigned int,unsigned int,float,unsigned int,buf<float,2,D> &,buf<float,2,D> &,buf<float,2,D> &,buf<float,2,D> &,buf<float,2,D> &,buf<float,2,D> &,buf<f | float2 |
| color_transport | ColorTransport | color_transport_full | (44 parameters) buf<vec<float,2>,1,alloc<vec<float,2> >,void> &,unsigned int,unsigned int,float,unsigned int,buf<float,2,D> &,buf<float,2,D> &,buf<float,2,D> &,buf<float,2,D> &,buf<float,2,D> &,buf<float,2,D> &,buf<f | float2 |
| color_transport | ColorTransport | fill_pits | (9 parameters) buf<float,2,D> &,buf<float,2,D> &,buf<float,2,D> & | - |
| color_transport | ColorTransport | fill_pits | (6 parameters) buf<float,2,D> &,buf<float,2,D> & | - |
| color_transport | ColorTransport | process | (1 parameters) void | - |
| color_transport | LaplacianLevel | LaplacianLevel | (5 parameters) buf<float,2,D> const&,sycl::queue &,color_transport::LaplacianLevel * | - |
| color_transport | LaplacianLevel | LaplacianLevel | (2 parameters) sycl::queue &,parallel_erosion::LaplacianLevel * | - |
| color_transport | LaplacianLevel | LaplacianLevel | (11 parameters) buf<float,2,D> const&,buf<float,2,D> const&,buf<float,2,D> const&,sycl::queue &,thermal::LaplacianLevel * | - |
| color_transport | LaplacianLevel | LaplacianLevel | (16 parameters) buf<float,2,D> &&,buf<float,2,D> &&,buf<float,2,D> &&,buf<float,2,D> &&,buf<float,2,D> &&,sycl::queue & | - |
| color_transport | LaplacianLevel | LaplacianLevel | (5 parameters) buf<float,2,D> const&,sycl::queue &,flow::LaplacianLevel * | - |
| color_transport | LaplacianLevel | create_subsequent_level | (1 parameters) color_transport::Parameters & | - |
| color_transport | LaplacianLevel | create_subsequent_level | (1 parameters) flow::Parameters & | - |
| color_transport | LaplacianLevel | create_subsequent_level | (1 parameters) thermal::Parameters & | - |
| color_transport | LaplacianLevel | create_subsequent_level | (1 parameters) void | - |
| color_transport | LaplacianLevel | reconstruct | (1 parameters) color_transport::Parameters const& | - |
| color_transport | LaplacianLevel | reconstruct | (1 parameters) flow::Parameters const& | - |
| color_transport | LaplacianLevel | reconstruct | (1 parameters) lighting::Parameters const& | - |

`ColorTransport::color_transport*` takes 16 parameters: a 1-D `buffer<vec<float,2>,1>` (particles), 4 scalars (`unsigned, unsigned, float, unsigned` — consistent with particle count, iterations, transport distance and seed) and **eleven 2-D `float` maps**. `ColorTransport::fill_pits` and `color_transport::LaplacianLevel` are also present. `observed`.

### 9.3 Tensor I/O and form

`observed`: in = heightmap + colour/guide maps; out = a single colour map. `inferred` form:

```text
# semi-Lagrangian advection of colour along the flow field, with sediment
# exchange (pickup where erosion is strong, deposit where it is weak)
c'(x) = lerp(c(x), c(x - v(x) * transport_distance), blend)
c'(x) *= (1 - color_hold);  pickup/deposit weighted by sediment_density
```

---

## 10. `MedianFilter`

| binding | value |
|---|---|
| managed entry | `Classic(Map heightmap, Int32 radius, Int32 iterations, Boolean smooth) -> Map` and `ResolutionIndependent(Map heightmap, Int32 strength, MedianQuality quality, Boolean smooth) -> Map` *(observed)* |
| native namespace | `median_filter` |
| backend availability | oneAPI + AdaptiveCpp only (**not** in `Gaea.Native.dll**) |
| node | `Median` (`MedianFilter.ResolutionIndependent(map, Strength, Quality, ...)`, line 27930) |

### 10.1 Parameters (4 fields) and enum

| # | field | type | inferred physical meaning | confidence |
|---|---|---|---|---|
| 1 | `Resolution` | Resolution | grid dimensions | high |
| 2 | `Radius` | Int32 | kernel radius in cells (`Classic`) | high |
| 3 | `Iterations` | Int32 | number of passes (`Classic`) | high |
| 4 | `Smooth` | Boolean | blend the median result instead of replacing | medium |

`MedianQuality` enum members *(observed)*: `Low`, `Medium`, `High`; the node's `Quality` property is annotated `[Parameter(Parameters.HorizontalList, MedianFilter.MedianQuality.Low, 0f, 1f)]`. `ResolutionIndependent` converts a 0–1 `strength` into `radius`/`iterations` via the quality tier (`inferred`, confidence high).

### 10.2 Form (inferred)

```text
for iteration in 1..iterations:
    out(x) = median{ z(y) : |x - y| <= radius }
# smooth=true -> out = lerp(z, out, k)
```

---

## 11. `Cellular3D` — 3-D cellular (Worley) noise

| binding | value |
|---|---|
| managed entry | `SyclFunctions.Cellular3D.Render(Parameters, inMaps, out outMaps) -> Boolean` *(observed)* |
| native scope | class `Cellular3D` (no lowercase namespace exists in the binaries) |
| nodes | `Cellular3D`, `IceFloe`, `Shrubs` (`BuildGrowthCells`), `Trees` (`BuildGrowthCells`) |

### 11.1 Parameters (13 fields — names recovered from node assignments)

| # | type | name / token | observed node assignment | inferred physical meaning | confidence |
|---|---|---|---|---|---|
| 1 | Resolution | `U+F1CEU+E82AU+F60F` | base.context.Resolution | — | — |
| 2 | Single | `U+F1CEU+E82AU+F610` | \ue0003.\ue002(5) / Patches.\ue05d\uedfb\ue0c7(\ue0003.\ue002(91), \ue0003.\ue002(120)); \ue0003.\ue002(5) / Size; \ue0003.\ue002(5) / Size.\uf353\uee79\ue798(); \ue0003.\ue002(94) | — | — |
| 3 | Single | `U+F1CEU+E82AU+F611` | Density; Gap; \ue0003.\ue002(5) | — | — |
| 4 | Single | `U+F1CEU+E82AU+F612` | ScaleX; \ue0003.\ue002(5) | — | — |
| 5 | Single | `U+F1CEU+E82AU+F613` | ScaleY; \ue0003.\ue002(5) | — | — |
| 6 | Single | `U+F1CEU+E82AU+F614` | ScaleZ; \ue0003.\ue002(5); \ue0003.\ue002(81) * Layers | — | — |
| 7 | Single | `U+F1CEU+E82AU+F615` | JitterX; \ue0003.\ue002(5) | — | — |
| 8 | Single | `U+F1CEU+E82AU+F616` | JitterY; \ue0003.\ue002(5) | — | — |
| 9 | Single | `U+F1CEU+E82AU+F617` | JitterZ; \ue0003.\ue002(5) | — | — |
| 10 | UInt32 | `U+F1CEU+E82AU+F618` | (uint)Seed | — | — |
| 11 | Single | `U+F1CEU+E82AU+F619` | \uf55c\uf0ba\ue6d3.Terrain.Width | — | — |
| 12 | Single | `U+F1CEU+E82AU+F61A` | \uf55c\uf0ba\ue6d3.Terrain.Height | — | — |
| 13 | Int32 | `U+F1CEU+E82AU+F61B` | \ue0003.\ue000(1) | — | — |

The names in the third column are the *node-facing* quantities: ordinal 3 is `Gap` in the `Cellular3D` node and `Density` in `IceFloe`; ordinal 6 is `ScaleZ` in `Cellular3D` and `81 * Layers` in `IceFloe`. The field is a generic kernel slot whose role is fixed by the calling node (`observed`). The type sequence `Resolution, float×8, uint, float, float, int` pins ordinals 2–9 to floats and ordinal 10 to the seed.

### 11.2 Tensor I/O and form

`observed`: in = a `ValueTuple` of input maps (a warp/coordinate pair), out = a `ValueTuple` of maps; `Render` is called with the parameter block plus `base.context.Resolution`.
`inferred` form (classic Worley/cellular noise in 3-D):

```text
p = (x*scale_x + jitter_x*r, y*scale_y + jitter_y*r, z*scale_z + jitter_z*r)
F1, F2 = two nearest feature-point distances in the scaled 3-D lattice
cell    = F1
gap     = F2 - F1                    # thin walls / crack network
```
`seed` selects the feature-point hash; `TerrainWidth/Height` only rescale world units. Confidence: high for the noise family, medium for which output slot each of `cell`/`gap` lands in.

---

## 12. `MeshRasterizer` — mesh / point-cloud to heightmap

| binding | value |
|---|---|
| managed entries | `RenderMesh(map, out warpmap, mesh)`, `RenderMesh(map, warpmap)`, `RenderMeshWithTriplanarDisplacement(...)`, `RasterizePointCloud(Parameters, Vector3[] points, out ValueTuple, Map texture)` *(observed; method names partly rendered as PUA because the decompiler could not print them)* |
| native namespaces | `mesh_rasterizer` (lower-case, free functions) and `MeshRasterizer` (class, oneAPI) |
| nodes | `Object`, `Meshify`, `Transform3D`, `TriplanarDisplacement`, `MeshWarp`, `TextureBaker` |

### 12.1 Parameters (15 fields — 14 of 15 recovered)

| # | type | name / token | observed node assignment | inferred physical meaning | confidence |
|---|---|---|---|---|---|
| 1 | Resolution | `U+F8C7U+E251U+E916` | base.context.Resolution; resolution | — | — |
| 2 | Int32 | `U+F8C7U+E251U+E917` | — | — | — |
| 3 | Single | `U+F8C7U+E251U+E918` | \uf55c\uf0ba\ue6d3.Terrain.Height / \uf55c\uf0ba\ue6d3.Terrain.Width | — | — |
| 4 | Single | `U+F8C7U+E251U+E919` | Pitch | — | — |
| 5 | Single | `U+F8C7U+E251U+E91A` | Yaw | — | — |
| 6 | Single | `U+F8C7U+E251U+E91B` | Roll | — | — |
| 7 | Single | `U+F8C7U+E251U+E91C` | Scale | — | — |
| 8 | Single | `U+F8C7U+E251U+E91D` | OffsetX | — | — |
| 9 | Single | `U+F8C7U+E251U+E91E` | OffsetY | — | — |
| 10 | Single | `U+F8C7U+E251U+E91F` | OffsetZ | — | — |
| 11 | Single | `U+F8C7U+E251U+E920` | Strength | — | — |
| 12 | Single | `U+F8C7U+E251U+E921` | Offset | — | — |
| 13 | Boolean | `U+F8C7U+E251U+E922` | Horizontal | — | — |
| 14 | Boolean | `U+F8C7U+E251U+E923` | DropToFloor | — | — |
| 15 | Boolean | `U+F8C7U+E251U+E924` | Antialiasing; flag | — | — |

The `MeshRasterizer` node assigns ordinals 1 and 3–10 and 14–15; `TriplanarDisplacement` assigns 1, 3, 11–13; `Meshify` assigns only 1. The type sequence `Resolution, int, float×10, bool×3` matches the recovered layout exactly, which is the cross-check on the join. Ordinal 13 (`Horizontal`) is the first `Boolean` in metadata order and is assigned a boolean — consistent.

### 12.2 Native structure

| namespace | class | method | parameter list (demangled) |
|---|---|---|---|
| MeshRasterizer | - | compute_tangent_space_normals | float *,float *,float *,vec<float,2> *,std::vector<vec<float,3>,std::allocator<vec<float,3> > > &,std::vector<vec<float,3>,std::allocator<vec<float,3> > > & |
| MeshRasterizer | - | process_vertices | usm_ptr<vec<float,3>,1> &,sycl::queue &,mesh_rasterizer::Parameters & |
| MeshRasterizer | - | render | float *,float *,float *,vec<float,3> * |

### 12.3 Tensor I/O and form

`observed`: input is a `Vector3[]` point cloud (or an imported mesh handle obtained from the Assimp-style loader in `Gaea.Native.dll`), plus an optional texture map; output is `(heightmap, warpmap)` — i.e. the rasteriser also returns the UV/flow warp map used by `MeshWarp` and `TextureBaker`.
`inferred` form: standard z-buffered triangle rasterisation,

```text
M = scale * rotate(pitch, yaw, roll);  p' = M*p + offset
for each triangle: rasterise with barycentric interpolation, z-buffer test
if displacement: z += strength * texture(p'.xz or p'.yz) - offset
if drop_to_floor: p'.y -= min_y(p')
```

---

## 13. `NativeLighting` — sun/sky lighting, shadows and ambient occlusion

| binding | value |
|---|---|
| managed type | `SyclFunctions.NativeLighting.Parameters` (26 fields). The class itself has no methods; the entry points are the `Sycl.SyclFunctions` delegate fields `Shade` and `SunLightIntegral` *(observed)* |
| native namespaces | `lighting` (all backends), `lighting_x` (AdaptiveCpp only), `ispc_lighting` (`Gaea.Native.dll`, ISPC) |
| nodes | `Sunlight`, `LightX`, `AO`, `Occlusion`, `Shade`, `Normals`, `SatMap`, `TextureBase` (the last two consume baked light/AO maps) *(inferred)* |

### 13.1 Parameters (26 fields, all names readable)

| # | field | type | inferred physical meaning | confidence |
|---|---|---|---|---|
| 1 | `Resolution` | Resolution | grid dimensions | high |
| 2 | `TerrainWidth` | Single | terrain width in world units | high |
| 3 | `TerrainHeight` | Single | terrain height in world units | high |
| 4 | `SunDirection` | Vector3 | sun vector | high |
| 5 | `ShadowQuality` | Int32 | shadow-map / ray quality tier | high |
| 6 | `SunAngularDiameter` | Single | angular size of the sun disc (soft shadows) | high |
| 7 | `AOModel` | LightingAmbientOcclusionModel | ambient-occlusion model selector | high |
| 8 | `RaytracedAOQuality` | Int32 | AO ray count/quality | high |
| 9 | `HybridAOQuality` | Int32 | hybrid AO quality tier | high |
| 10 | `HybridAOOctaves` | Int32 | hybrid AO octave count | high |
| 11 | `Exposure` | Single | output exposure | high |
| 12 | `SunIntensity` | Single | direct light intensity | high |
| 13 | `AmbientIntensity` | Single | ambient light intensity | high |
| 14 | `SunColor` | Vector3 | direct light colour | high |
| 15 | `AmbientColor` | Vector3 | ambient light colour | high |
| 16 | `DefaultColor` | Single | colour for unlit/invalid samples | medium |
| 17 | `DayBegin` | Int32 | start day-of-year of the sun path | high |
| 18 | `DayEnd` | Int32 | end day-of-year of the sun path | high |
| 19 | `Latitude` | Single | geographic latitude driving the sun path | high |
| 20 | `NorthDirection` | Single | map rotation of true north | high |
| 21 | `AirDensity` | Single | atmospheric density for Rayleigh scattering | medium |
| 22 | `UseDirectLighting` | Boolean | enable direct lighting | high |
| 23 | `UseAmbientLighting` | Boolean | enable ambient lighting | high |
| 24 | `UseShadows` | Boolean | enable shadows | high |
| 25 | `UseAmbientOcclusion` | Boolean | enable AO | high |
| 26 | `AoCached` | Boolean | reuse a cached AO map | high |

### 13.2 Native structure

| assembly | namespace | class | method | parameter list |
|---|---|---|---|---|
| Gaea.oneAPI.dll | lighting | LightingSYCL | compose_light | (1) void |
| Gaea.oneAPI.dll | lighting | LightingSYCL | compute_diffuse_light | (1) void |
| Gaea.oneAPI.dll | lighting | LightingSYCL | compute_hybrid_ao | (1) void |
| Gaea.oneAPI.dll | lighting | LightingSYCL | compute_normals_and_init_photonmap | (10) lighting::Parameters const&,buf<float,2,D> &,buf<int,2,D> &,buf<float,2,D> & |
| Gaea.oneAPI.dll | lighting | LightingSYCL | raytrace_shadows | (1) void |
| Gaea.oneAPI.dll | lighting | - | compute_normals_and_init_photonmap | (14) lighting::Parameters const&,buf<float,2,D> &,buf<int,2,D> &,buf<vec<float,3>,2,alloc<vec<float,3> >,void> &,sycl::queue & |
| Gaea.oneAPI.dll | lighting | - | raytrace_ao | (31) lighting::Parameters &,buf<float,2,D> &,buf<vec<float,3>,2,alloc<vec<float,3> >,void> &,buf<float,2,D> &,buf<int,2,D> &,buf<vec<float,3>,1,alloc<vec<float,3> >,void> &,buf<vec<float,2>,1,alloc<vec<flo |
| Gaea.oneAPI.dll | lighting | - | raytrace_ao_sl | (34) lighting::Parameters &,buf<float,2,D> &,buf<vec<float,3>,2,alloc<vec<float,3> >,void> &,buf<float,2,D> &,buf<int,2,D> &,buf<vec<float,3>,1,alloc<vec<float,3> >,void> &,buf<vec<float,2>,1,alloc<vec<flo |

Split of the lighting kernel into passes is `observed`: `compute_normals_and_init_photonmap`, `compute_diffuse_light`, `raytrace_shadows`, `raytrace_ao`, `raytrace_ao_sl` (single-level / sun-list variant, adds a `buffer<float,1>` of sun samples and a `float` threshold), `compute_hybrid_ao`, `compose_light`. Buffer element types are 2-D `float`, 2-D `int` and 2-D `vec<float,3>`.

### 13.3 Form (inferred)

```text
N(x)  = -normalize(gradient(z))                       # compute_normals_and_init_photonmap
L     = raytrace_shadows(N, sun_direction, sun_angular_diameter, shadow_quality)
AO    = raytrace_ao(...)  or  compute_hybrid_ao(...)  # hemisphere sampling
color = exposure * (sun_intensity*sun_color*L*max(0,N.S)
                 + ambient_intensity*ambient_color*AO)
sky   = rayleigh(air_density, day_of_year(latitude, day_begin..day_end))
```
The name `photonmap` points at an explicit photon/ray map that is later used for AO and shadows (`inferred`, confidence medium).

### 13.4 Visibility limits

* The `AOModel` enumeration and the quality-tier enumerations are not declared in `Gaea.Engine.dll` (the field types resolve to enums defined elsewhere in the Engine assembly, not in `SyclFunctions`).
* Whether `AoCached` reuses an on-disk cache cannot be decided statically here.

---

## 14. `Debris` — rock/debris scattering

| binding | value |
|---|---|
| managed type | `SyclFunctions.Debris.Parameters` (12 fields) + `SizeDistribution { Uniform, Natural }`; the class itself has no methods — the call goes through the `Engine` core (`debrisCore.Simulation(...)`) *(observed)* |
| native namespace | `Debris` (AdaptiveCpp only; absent from oneAPI and Native) |
| node | `Debris` |

### 14.1 Parameters (12 fields, all names readable)

| # | field | type | inferred physical meaning | confidence |
|---|---|---|---|---|
| 1 | `Resolution` | UInt32 | grid dimensions | high |
| 2 | `TerrainWidth` | Single | terrain width in world units | high |
| 3 | `TerrainHeight` | Single | terrain height in world units | high |
| 4 | `DebrisCount` | UInt32 | number of scattered rocks | high |
| 5 | `MaxDebrisSize` | Single | upper size bound | high |
| 6 | `MinDebrisSize` | Single | lower size bound | high |
| 7 | `FrictionCoefficient` | Single | sliding friction after a bounce | high |
| 8 | `RestitutionCoefficient` | Single | bounce elasticity | high |
| 9 | `Durability` | Single | resistance to breaking/settling | medium |
| 10 | `RenderStillRocks` | Boolean | also render rocks that never moved | high |
| 11 | `SizeDistribution` | SizeDistribution | `Uniform` or `Natural` size sampling | high |
| 12 | `Seed` | UInt32 | RNG seed | high |

### 14.2 Form (inferred)

```text
for i in 1..debris_count:
    r = sample_size(size_distribution) in [min_debris_size, max_debris_size]
    p = random position (seed);  roll downhill with friction,
    bounce with restitution;  stop when kinetic energy < durability
```
`Natural` most likely means a power-law/log-normal size sample and `Uniform` a flat one (`inferred`, confidence medium).

---

## 15. Native kernels with no managed binding in this build

These namespaces exist in the shipped native binaries but have no `SyclFunctions.*` entry in `Gaea.Engine.dll`. They are reached through other managed code paths (the Engine core calls them directly) or are internal infrastructure (`observed` for the names, `inferred` for the role).

| namespace | present in | observed methods |
|---|---|---|
| resampling | AdaptiveCpp.HIP, AdaptiveCpp, oneAPI | downsample_box, downsample_gaussian_5x5, downsample_magic, sharpen_magic, upsample_box, upsample_magic |
| arrakis | AdaptiveCpp.HIP, AdaptiveCpp | Arrakis::simulation |
| lake | Native | lake_create, search_closest, search_min |
| mesh_port | Native | heightmap_to_mesh |
| shm | Native | heightmap_to_mesh_adaptive_subdivision |

Observed signatures worth recording (`Gaea.Native.dll`):

```text
lake::lake_create(lake::Parameters, float*, float*, float*, float*, InteropBridge)
lake::search_min(Map<float>&, int, int, float, int&, int&, float&)
lake::search_closest(Map<float>&, int, int, float, int&, int&, float&, float, float)
mesh_port::heightmap_to_mesh(float*, mesh_port::Parameters, InteropBridge) -> interopmesh::Mesh*
shm::heightmap_to_mesh_adaptive_subdivision(float*, mesh_port::Parameters, InteropBridge) -> interopmesh::Mesh*
```

`lake_create` takes **four `float*` map pointers** plus the interop bridge, which matches the four CW outputs (height, depth, shore, surface); `search_min` / `search_closest` are the spill-point search primitives of a priority-flood style depression filler, which independently corroborates the section 4 form (`observed` signatures, `inferred` reading). `interopmesh::Mesh` is the CPU mesh handle type shared by the mesh ports.

Notes (`inferred`): `resampling` provides the box/`magic` downsample, sharpen and upsample used to build the multi-resolution pyramids (both `sycl::buffer` and `usm_ptr<float,2>` overloads are `observed`, so a USM path exists alongside the buffer path); `stamp_instancer` most likely instances scatter/stamp geometry; `texture3d` is a 3-D texture sampler; `arrakis` is an AdaptiveCpp runtime component, not a terrain kernel; `lake` is the CPU-side water solver that pairs with `ErosionWrapperW`; `mesh_port` / `shm` are the two CPU mesh builders behind the `MeshPort_*` exports and `interopmesh` is their shared mesh type.

`exprtk` (5 267 symbol hits), `tinyobj` and `Assimp` in `Gaea.Native.dll` are third-party libraries (expression evaluation and mesh import) — `observed` as symbols only.

---

---

## 16. The CPU C API of `Gaea.Native.dll` (19 named exports, observed)

`Gaea.Native.dll` ships a readable export-name table. The same 19 names also appear as string literals in `Gaea.Engine.dll`, i.e. they are resolved by name through `SyclLibrary.LoadFunction(...)`. This is the complete CPU-side kernel surface, and it is *not* the same set as `SyclFunctions`:

```text
FastBlur4_Process                     ParallelErosion_Erode
FastBlur_Process                      Rivers
HydrologicalCorrection                ShadeIspc
Lake_Create                           SunLightIntegralIspc
MathX_Compute                         MeshPort_Destroy
MathX_FreeErrorMessage                MeshPort_HeightmapToMesh
MathX_Function                        MeshPort_HeightmapToMeshWithAdaptiveSubdivision
                                      MeshPort_Load
                                      MeshPort_PointCloudToMesh
                                      MeshPort_Save
                                      MeshPort_SavePointCloud
                                      MeshPort_TrianglesToMesh
```

`inferred` roles: `ParallelErosion_Erode` is the CPU erosion entry (the counterpart of `parallel_erosion` and of the C++/CLI `ErosionWrapper`); `Lake_Create` is the CPU water solver (counterpart of `ErosionWrapperW` / the `lake` scope); `Rivers` backs the `Rivers` node through `Waters.Rivers`; `HydrologicalCorrection` backs `HydroFix`; `ShadeIspc` / `SunLightIntegralIspc` are the ISPC lighting pair (counterpart of `SyclFunctions.Shade` / `.SunLightIntegral`); `FastBlur*` are blurs; `MathX_*` evaluate the MathX expression language on top of the bundled `exprtk`; `MeshPort_*` convert and persist meshes and point clouds on top of the bundled Assimp.

Note the asymmetry: `HydrologicalCorrection`, `Rivers`, `Lake_Create` and the `FastBlur` pair have **no** `SyclFunctions` counterpart in this build, so those operations are CPU-only (`observed` for the export list, `inferred` for the conclusion).

## 17. Cross-layer parameter-name correspondences (observed)

These are the places where a readable node-facing parameter name and a kernel-side parameter name are joined by an actual assignment in the decompiled `Build()` code. They are the strongest available evidence for the semantics in sections 1–14.

| node / helper | kernel call | kernel-side field | assigned expression |
|---|---|---|---|
| Erosions | Thermal2.ThermalSimulation | `Resolution` | map.Resolution |
| Erosions | Thermal2.ThermalSimulation | `Duration` | Duration |
| Erosions | Thermal2.ThermalSimulation | `Strength` | Strength |
| Erosions | Thermal2.ThermalSimulation | `Anisotropy` | Anisotropy |
| Erosions | Thermal2.ThermalSimulation | `TalusAngle` | Angle |
| Erosions | Thermal2.ThermalSimulation | `ErosionScale` | FeatureScale |
| Erosions | Thermal2.ThermalSimulation | `HeightmapSize` | \uf55c\uf0ba\ue6d3.Terrain.Width |
| Erosions | Thermal2.ThermalSimulation | `HeightmapHeight` | \uf55c\uf0ba\ue6d3.Terrain.Height |
| Erosions | Thermal2.ThermalSimulation | `SedimentRemoval` | SedimentRemoval |
| Erosions | Thermal2.ThermalSimulation | `UseAreaMask` | ((!UseAreaMask) ? ((byte)\ue0003.\ue000(0) != 0) : (area !=  |
| Erosions | Thermal2.ThermalSimulation | `UseSedimentRemovalMask` | ((!UseRemovalMask) ? ((byte)\ue0003.\ue000(0) != 0) : (sedim |
| Simulations | Flow.Simulation | `Resolution` | map.Resolution |
| Simulations | Flow.Simulation | `FlowLength` | FlowLength |
| Simulations | Flow.Simulation | `FlowVolume` | FlowVolume |
| Simulations | Flow.Simulation | `Seed` | Seed |
| Cartography | ColorTransport.Simulation | `Resolution` | base.context.Resolution |
| Cartography | ColorTransport.Simulation | `TransportDistance` | \ue0003.\ue002(2) |
| Cartography | ColorTransport.Simulation | `SedimentDensity` | \ue0003.\ue002(5) |
| Cartography | ColorTransport.Simulation | `Blend` | \ue0003.\ue002(5) |
| Cartography | ColorTransport.Simulation | `FlowVolume` | \ue0003.\ue002(0) |
| Cartography | ColorTransport.Simulation | `ColorHold` | \ue0003.\ue002(2) |
| Cartography | ColorTransport.Simulation | `LaminarFlow` | ((byte)\ue0003.\ue000(0) != 0) |
| Cartography | ColorTransport.Simulation | `Seed` | \ue0003.\ue000(48) |
| Cartography | ColorTransport.Simulation | `Resolution` | base.context.Resolution |
| Cartography | ColorTransport.Simulation | `TransportDistance` | \ue0003.\ue002(2) |
| Cartography | ColorTransport.Simulation | `SedimentDensity` | \ue0003.\ue002(2) |
| Cartography | ColorTransport.Simulation | `Blend` | \ue0003.\ue002(2) |
| Cartography | ColorTransport.Simulation | `FlowVolume` | \ue0003.\ue002(0) |
| Cartography | ColorTransport.Simulation | `ColorHold` | \ue0003.\ue002(2) |
| Cartography | ColorTransport.Simulation | `LaminarFlow` | ((byte)\ue0003.\ue000(0) != 0) |
| Cartography | ColorTransport.Simulation | `Seed` | \ue0003.\ue000(48) |
| Weathering | ColorTransport.Simulation | `Resolution` | base.context.Resolution |
| Weathering | ColorTransport.Simulation | `TransportDistance` | \ue0003.\ue002(2) |
| Weathering | ColorTransport.Simulation | `SedimentDensity` | \ue0003.\ue002(102) |
| Weathering | ColorTransport.Simulation | `Blend` | \ue0003.\ue002(102) |
| Weathering | ColorTransport.Simulation | `FlowVolume` | \ue0003.\ue002(0) |
| Weathering | ColorTransport.Simulation | `ColorHold` | \ue0003.\ue002(2) |
| Weathering | ColorTransport.Simulation | `LaminarFlow` | ((byte)\ue0003.\ue000(0) != 0) |
| Weathering | ColorTransport.Simulation | `Seed` | base.Id |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf60f` | base.context.Resolution |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf610` | \ue0003.\ue002(5) / Size |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf611` | Gap |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf612` | ScaleX |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf613` | ScaleY |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf614` | ScaleZ |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf615` | JitterX |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf616` | JitterY |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf617` | JitterZ |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf618` | (uint)Seed |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf619` | \uf55c\uf0ba\ue6d3.Terrain.Width |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf61a` | \uf55c\uf0ba\ue6d3.Terrain.Height |
| Cellular3D | Cellular3D.Render | `\uf1ce\ue82a\uf61b` | \ue0003.\ue000(1) |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf60f` | base.context.Resolution |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf610` | \ue0003.\ue002(5) / Size.\uf353\uee79\ue798() |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf611` | Density |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf612` | \ue0003.\ue002(5) |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf613` | \ue0003.\ue002(5) |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf614` | \ue0003.\ue002(81) * Layers |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf615` | \ue0003.\ue002(5) |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf616` | \ue0003.\ue002(5) |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf617` | \ue0003.\ue002(5) |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf618` | (uint)Seed |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf619` | \uf55c\uf0ba\ue6d3.Terrain.Width |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf61a` | \uf55c\uf0ba\ue6d3.Terrain.Height |
| IceFloe | Cellular3D.Render | `\uf1ce\ue82a\uf61b` | \ue0003.\ue000(1) |
| Median | MedianFilter.ResolutionIndependent | `map` | MedianFilter.ResolutionIndependent(map, Strength switch |
| Median | MedianFilter.ResolutionIndependent | `MedianStrength.X1` | > \ue0003.\ue000(1) |
| Median | MedianFilter.ResolutionIndependent | `MedianStrength.X2` | > \ue0003.\ue000(3) |
| Median | MedianFilter.ResolutionIndependent | `MedianStrength.X4` | > \ue0003.\ue000(5) |
| Median | MedianFilter.ResolutionIndependent | `MedianStrength.X8` | > \ue0003.\ue000(9) |
| Median | MedianFilter.ResolutionIndependent | `_` | > \ue0003.\ue000(1) |
| Meshify | MeshRasterizer.RasterizePointCloud | `\uf8c7\ue251\ue916` | resolution |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf60f` | base.context.Resolution |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf610` | \ue0003.\ue002(94) |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf611` | \ue0003.\ue002(5) |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf612` | \ue0003.\ue002(5) |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf613` | \ue0003.\ue002(5) |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf614` | \ue0003.\ue002(5) |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf615` | \ue0003.\ue002(5) |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf616` | \ue0003.\ue002(5) |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf617` | \ue0003.\ue002(5) |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf618` | (uint)Seed |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf619` | \uf55c\uf0ba\ue6d3.Terrain.Width |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf61a` | \uf55c\uf0ba\ue6d3.Terrain.Height |
| Shrubs | Cellular3D.Render | `\uf1ce\ue82a\uf61b` | \ue0003.\ue000(1) |
| SuperColor | ColorTransport.Simulation | `Resolution` | base.context.Resolution |
| SuperColor | ColorTransport.Simulation | `TransportDistance` | \ue0003.\ue002(2) |
| SuperColor | ColorTransport.Simulation | `SedimentDensity` | \ue0003.\ue002(5) |
| SuperColor | ColorTransport.Simulation | `Blend` | \ue0003.\ue002(2) |
| SuperColor | ColorTransport.Simulation | `FlowVolume` | \ue0003.\ue002(0) |

*(Rows are deduplicated per call site; the complete set is in `docs/kernels-inventory.json` under `nodeCallSites` and in `evidence/kernels/node-callsites.json`.)*

## 18. Summary of what remains unknown

* No kernel body, constant, iteration count or numeric default was recovered for any kernel: the native DLLs were not disassembled and the C++/CLI cores are IL-less mixed-mode code.
* Native struct layouts (byte offsets, padding, alignment) are not asserted.
* 3 `ParallelErosion.Parameters` fields, 1 `MeshRasterizer.Parameters` field, and the `AOModel`/quality enumerations have no observed assignment.
* The mapping in section 16 only covers nodes present in the 2 MB partial decompilation of `Gaea.Nodes.dll`.

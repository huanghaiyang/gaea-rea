# IMPLEMENTATION-NOTES.md — how close each algorithm is to Gaea 2.0

This document exists so that this reimplementation can be audited against the
reverse-engineering evidence in [`docs/`](../docs) without reading the source. It states, per
algorithm, whether the build reproduces Gaea's operation, approximates it, substitutes a
published model for an unrecovered one, or does nothing at all.

A reviewer cross-checking against Gaea should be able to read one row and know what to trust.

---

## 1. Evidence boundary

The reverse-engineering effort recovered three kinds of fact:

| Recovered | Confidence | Where |
| --- | --- | --- |
| Parameter names, types, defaults, ranges, enum members, groups | **observed** from assembly metadata and `[Parameter]` attributes | [`docs/node-specs-from-il.json`](../docs/node-specs-from-il.json), [`docs/nodes-catalog.json`](../docs/nodes-catalog.json) |
| Native kernel names, argument lists, buffer shapes, and which node calls which kernel | **observed** from demangled SYCL symbols and decompiled call sites | [`docs/kernels-inventory.json`](../docs/kernels-inventory.json), [`docs/kernels-node-mapping.md`](../docs/kernels-node-mapping.md) |
| The arithmetic inside those kernels | **not recovered** — no disassembly was possible | [`docs/kernels-reference.md`](../docs/kernels-reference.md) states this limit |

So the **parameter surface is traceable to Gaea; the algorithms are not.** They are standard
published methods chosen to match each node's documented behaviour and recovered parameter set.

### 1.1 How the recovered numbers reach the UI

`web/data/build-catalog.mjs` consumes `docs/node-specs-from-il.json` (read-only) when it is
present and copies each parameter's recovered `default` / `minimum` / `maximum` into the catalog
as `ilDefault` / `ilMin` / `ilMax`:

* **1150 of 1192** catalog parameters match by name (the IL file's `name` or `ui_name`).
* **728 defaults** and **696 min/max pairs** are recovered.
* After validating each value against the declared type, **565 defaults and 540 ranges** reach
  the UI. The rejects are mostly parameters whose IL argument order is *not*
  `(default, min, max)` — e.g. an `Enum` or `bool` entry carrying `(Symbol, 0f, 1f)`. Those are
  discarded rather than trusted; trusting them produced nonsense such as `bool minimum = 1f`.

Every parameter in the UI carries its provenance in its tooltip, and the catalog records the
enrichment counts in its `enrichment` block, so this is auditable without re-running anything:

| Provenance | Meaning |
| --- | --- |
| `default recovered from the Gaea assembly` | came from the IL `[Parameter]` attributes |
| `hand-tuned for this implementation` | authored in `web/js/registry.js`, in **this kernel's units**. Wins over an IL value where they disagree, because a raw assembly value is meaningless when the kernel behind it is a stand-in. |
| `conservative fallback (no recovered metadata)` | type-appropriate default |

### 1.2 Structural vs. value parameters in the vendor dump

`Nodes.json` contains 1341 `Flubs` entries, which are **not** 1341 parameters:

| Kind | Count | Treatment |
| --- | --- | --- |
| Value parameters | 1192 | used as parameters |
| Section headers (no `Type`, no children) | 126 | kept as `groups`, so the panel reproduces Gaea's sectioning |
| `Command` buttons ("Add Input", "Edit Curve") | 20 | kept as `groups`; not rendered as values |
| `List` list-typed entries (curve splines, gradient data) | 3 | kept as `groups` |

The untyped 126 are provably headers rather than hidden enums: every one has an empty child
list, and their names coincide with the group headings the assembly's parameter metadata assigns
to the parameters around them (`Erosion.Downcutting`, `MultiFractal.Warp`, `Thermal.Talus`, …).

---

## 2. Fidelity labels

| Label | Meaning |
| --- | --- |
| **exact** | The operation has a standard, unambiguous definition and this build implements that definition. Any implementation reproduces it. Safe to treat as equivalent. |
| **approx** | Right family, right parameter surface; constants, ordering, profiles or blend exponents are reconstructions. Qualitatively right, numerically not Gaea's. |
| **model** | Gaea's method is not public, so a standard published model was substituted and Gaea's parameter names were mapped onto it. The *shape* of the control is preserved; the physics is not Gaea's. |
| **stub** | Interface only, no computation. |
| **passthrough** | Not implemented; copies the first connected input and says so in the UI. |

Distribution across the 56 registered algorithms: **4 exact, 27 approx, 24 model, 1 stub**.

---

## 3. What is faithful across the whole build

* **Parameter identity.** Every control is keyed by the exact Gaea parameter name
  (`Rock Softness`, `Downcutting`, `Sediment Removal`, `Base Level`), so the registry lines up
  with `data/nodes.json` and with the recovered assembly metadata.
* **Node inventory.** All 182 catalog nodes appear with their real descriptions, enum members
  and group structure.
* **Graph semantics.** Unconnected inputs are tolerated rather than invalidating a node;
  evaluation is cached per node; a node with no algorithm still renders its true parameters and
  passes through with an honest badge — matching the behaviour recovered in
  [`docs/engine-model.md`](../docs/engine-model.md).
* **Determinism.** All stochastic kernels draw from integer hashing and an xorshift PRNG seeded
  from the node's `Seed` plus a name-derived offset, so a fixed graph + seed is bit-reproducible
  (verified: two independently built copies of the same graph produce identical `Float32Array`s).

### 3.1 Erosion parameter identity

The `Erosion` kernel's parameters map onto Gaea's `ErosionWrapper` field names recovered from
`Gaea.CE.dll`:

| Gaea `ErosionWrapper` field | This build's parameter |
| --- | --- |
| `m_rock_softness` | Rock Softness |
| `m_downcutting` | Downcutting |
| `m_duration` | Duration |
| `m_base_level` | Base Level |
| `m_fluvial_erosion_strength` | Strength |
| `m_sediment_removal` | Sediment Removal |
| `m_debris_size` | Debris |
| `m_flow_volume` | Volume |
| `m_talus_angle` | Angle |
| `m_talus_settling` | Settling |
| `m_scale` | Erosion Scale |

`Enable`, `Reverse`, `Inhibition`, `Bias`/`Bias Type`, `Shape`/`Shape Sharpness` and the
suspended/bed/coarse load groups exist as parameters and are only partly honoured — see §5.7.

---

## 4. Per-node table

Generated from `js/registry.js` by `tools/gen_web_impl_table.py`:

<!-- BEGIN GENERATED TABLE -->
| Node | Kernel function | Category | Fidelity |
| --- | --- | --- | --- |
| `Adjust` | `adjust` | ADJ | approx |
| `Autolevel` | `autolevel` | ADJ | approx |
| `Blur` | `blur` | ADJ | approx |
| `Clamp` | `clampNode` | ADJ | approx |
| `Clip` | `clip` | ADJ | approx |
| `Curve` | `curve` | ADJ | approx |
| `Deflate` | `deflate` | ADJ | model |
| `Denoise` | `denoise` | ADJ | model |
| `Dilate` | `dilate` | ADJ | approx |
| `Equalize` | `equalize` | ADJ | approx |
| `Extend` | `extend` | ADJ | approx |
| `Flip` | `flip` | ADJ | approx |
| `Invert` | `invert` | ADJ | approx |
| `Recurve` | `recurve` | ADJ | approx |
| `Blend` | `maskBlend` | COMB | model |
| `Combine` | `combine` | COMB | approx |
| `Erosion` | `streamPower` | EROS | model |
| `Erosion2` | `hydraulicDroplet` | EROS | model |
| `FlowMap` | `flowMap` | EROS | model |
| `Thermal` | `thermalTalus` | EROS | model |
| `Export` | `outputNode` | IO | exact |
| `File` | `fileStub` | IO | stub |
| `Group` | `passthrough` | IO | exact |
| `Output` | `outputNode` | IO | exact |
| `AngleSelect` | `angleSelect` | MASK | model |
| `Distance` | `distanceTransform` | MASK | model |
| `Height` | `heightKey` | MASK | model |
| `HeightSelect` | `heightSelect` | MASK | model |
| `Mask` | `maskApply` | MASK | model |
| `MaskSelect` | `maskSelect` | MASK | model |
| `Occlusion` | `occlusion` | MASK | model |
| `Slope` | `slope` | MASK | model |
| `SlopeSelect` | `slopeSelect` | MASK | model |
| `Snow` | `snow` | MASK | model |
| `Cellular` | `cellular` | PRIM | approx |
| `Cellular3D` | `cellular3d` | PRIM | approx |
| `Constant` | `constant` | PRIM | exact |
| `DotNoise` | `dotNoise` | PRIM | approx |
| `MultiFractal` | `multiFractal` | PRIM | approx |
| `Perlin` | `perlinNode` | PRIM | approx |
| `Ridge` | `ridgeNode` | PRIM | approx |
| `Voronoi` | `voronoi` | PRIM | approx |
| `Canyon` | `canyon` | SHAPE | approx |
| `Cracks` | `cracks` | SHAPE | model |
| `Crater` | `crater` | SHAPE | model |
| `FractalTerraces` | `fractalTerraces` | SHAPE | model |
| `Glacier` | `glacier` | SHAPE | model |
| `Mountain` | `mountain` | SHAPE | approx |
| `Sea` | `seaLevel` | SHAPE | model |
| `Steps` | `stepsNode` | SHAPE | model |
| `DirectionalWarp` | `directionalWarp` | WARP | approx |
| `Shear` | `shear` | WARP | approx |
| `Shift` | `shift` | WARP | approx |
| `Transform` | `transformField` | WARP | approx |
| `Warp` | `warp` | WARP | approx |
<!-- END GENERATED TABLE -->

---

## 5. Per-algorithm detail

### 5.1 Primitives and noise

| Node | Verdict | Detail |
| --- | --- | --- |
| `Constant` | **exact** | Flat height or flat colour. Nothing to reconstruct. |
| `File` | **stub** | Emits a deterministic placeholder pattern derived from the requested filename so a graph containing it still evaluates, and shows a `stub` badge. No decoder: Gaea `.terrain`, 16-bit RAW and EXR are not implemented. This is the one node where doing nothing is the deliberate choice. |
| `MultiFractal` | approx | Fractal sum over Perlin gradient noise with lattice-period wrapping (so results tile seamlessly). Mapping: `Size` → lattice frequency (`Size × 4` cycles across the field); `FractalGain` → persistence (`gain = min(0.9, 0.15 + 0.75 × FractalGain)`); `Octaves` direct or derived from `Size` under `AutoOctaves`; `VariationContrast` → value gamma; `Smoothness` blends toward a coarser octave set; `VariationType` blends a secondary value-noise fractal; `Perturb` = None/Simple/Complex performs a 2–3 octave domain perturbation using `WarpStrength`/`WarpComplexity`/`WarpRoughness`/`WarpAttenuation`; `Rotation`/`Anisotropy`/`OffsetX`/`OffsetY` transform the sampling space; `Bias` shifts the result; `EdgeSmoothing` feathers the frame. **All 22 fractal flavours from the IL vocabulary** (Standard, Billow, Ridged, Swiss, Jordan, Sawtooth, Heterogeneous, Hybrid, Multi, Power, Cliff, Erosion, Erosion2, Sine, Square, Random, …) are implemented, but several are standard-variant reconstructions of flavours whose exact mix is proprietary — treat the non-basic ones as an approximation inside an approximation. |
| `Perlin` | approx | Explicit fBm with `Gain`, `Scale`, `Octaves`, axis scaling (`ScaleX`/`ScaleY` up to 100), and a `Complex` warp stage. The IL's `Clamp` is realised as the final clamp to `[0,1]`. |
| `Ridge` | approx | Ridged multifractal built from `1 - abs(noise)` raised to `Definition`, with the octave count derived from `Scale` because Gaea exposes none for this node. |
| `Cellular` | approx | 2D Worley over a 3×3 neighbourhood. Metrics Manhattan / Chebyshev / Minkowski; `MetricMorph` blends toward Euclidean; `Anisotropy` + `CoordinateAxesJitter` + `CAJClustering` deform the cell space; `Density` scales the feature count. The five `DistanceFunction` values are standard: `Hash` = per-cell identity, `DistanceInv` = 1/(1+F1²·6), `Distance2Inv` = 1/(1+F2²·6), `DistanceDiff` = (F2−F1)·1.6, `DistanceToEdge` = F1·1.35. **Those multiplicative constants are free parameters**; Gaea's are unknown. |
| `Cellular3D` | approx | The same search over a 27-cell 3D neighbourhood with independent X/Y/Z jitter and scale. `NormalizeInput` narrows the Z sweep. |
| `Voronoi` | approx | Voronoi cells with the 8 `Form` outputs. **The C/N/R/P/A/S/M/D semantics are Gaea-internal and undocumented**, so they are reconstructed from standard Voronoi quantities: C = per-cell constant, N = F1, R = F2−F1, P = 1/(1+F1²), A = F1·F2, S = sharpened F1, M = max(F1,F2), D = per-cell random mixed by `Clamp`. This is the largest interpretive leap in the noise family — **if one node disagrees with Gaea, start here.** |
| `DotNoise` | approx | Layered jittered lattices of `Dot`/`Square` footprints accumulated with `Multiplier` decay per iteration, then robustly normalised to `[0,1]`. Gaea's accumulation and `BlendMode` semantics were not recovered; this is a rebuild from the parameter surface. Note the IL's `Size` is a `Float2` whose recovered min/max are inverted (`min 0.6, max 0.0001`), so that entry is rejected and the registry range is used. |

### 5.2 Distortion

| Node | Verdict | Detail |
| --- | --- | --- |
| `Warp` | approx | Three modes implemented as their names describe: `Bitmap` (displace by the warp input's R/G channels), `VectorField` (displace along the warp input's gradient), `VectorFieldIntegral` (iterate `Iterations` times). With no warp input a procedural source is used; **`WarpSource`'s six Voronoi variants (R/P/A/S/M/D) are approximated from `F1`/`F2` rather than reproducing six distinct Voronoi forms — that mapping is guessed.** `Perturbation` adds high-frequency jitter; `EdgeBehaviour` selects clamp or mirror resampling; `Modulation` + `ModulationDirection` add a uniform drift; `ZScale` advances the procedural source's third axis, which is how a 2D warp acquires a volumetric feel. |
| `DirectionalWarp` | approx | Uniform displacement along `Direction`, scaled by the driver input's value about 0.5. The 0.5 pivot and the amplitude are choices. |
| `Shift` | approx | Wrap-around translation. Gaea's exact boundary behaviour is unknown. |
| `Shear` | approx | Slant proportional to the perpendicular axis. |
| `Transform` | approx | Scale / rotate / translate resample with clamped borders. The resampling is standard; interpreting `X`/`Y` as 1 % offsets is a choice. |

### 5.3 Adjustment and filtering

| Node | Verdict | Detail |
| --- | --- | --- |
| `Adjust` | approx | Implements all nine controls. **The order is a reconstruction**: Multiply → Shaper (gamma) → Clamp → Clip → Autolevel → Equalize → Strong (S-curve) → Invert → Drop. Gaea's order is not documented and is only observable by difference-testing the real application. Each control is individually verifiable; the composition is not. |
| `Clamp` | approx | Standard clamp to `Value`. `Normalized` autolevels first — the ordering relative to the clamp is a guess. |
| `Autolevel` | approx | Affine stretch of the **full** `min..max` window to `[0,1]`. An earlier revision used a 0.1 %–99.9 % percentile window; that was removed because on a skewed terrain histogram it cut off the lowlands and pushed results outside `[0,1]`. Whether Gaea clips is unknown; the plain reading of "use the full available range" is implemented. |
| `Equalize` | approx | 512-bin histogram equalisation blended by `Factor`. The bin count is implementation-defined and Gaea's blend law is unknown. |
| `Extend` | approx | Affine stretch of a requested value window to the full range. |
| `Clip` | approx | Hard cut against `Min`/`Max`; `AutoClip` derives the ceiling from the data. Values below `Min` become 0 rather than `Min` — a choice. |
| `Invert`, `Flip` | approx | `1 - v`, and index reversal. Both are unambiguous operations, but `Flip`'s `XY` composition order and `Invert`'s treatment of out-of-range input are unspecified. |
| `Blur` | approx | Separable gaussian, reflect-101 boundaries, kernel normalised so a constant field is preserved exactly (verified). **`Radius` is in pixels here (0..128) whereas the IL reports 0..2**, so the registry range wins; the sigma-to-radius relation (`sigma ~ r/2.5`) is a free choice. |
| `Deflate` | model | Iterative grayscale erosion (running minimum) with a 3×3 element, then a short gaussian to remove the stair-stepping, blended by `Amount`. Gaea's "pull features inward" has no published operator; this is standard morphology. |
| `Dilate` | approx | Running maximum with `Cross`/`Rectangle`/`Line`/`LineVertical` elements, `Size` × `Iterations` repetitions, optional `Invert`; `Shape` rounds the element. Standard morphology; the `Size` → kernel-radius mapping is a choice. |
| `Denoise` | model | `OnePass`/`TwoPass` = Perona–Malik edge-preserving diffusion with conductance `kappa = 0.01 + Amount*0.06` and the stability limit enforced (`lambda <= 0.24`); `Pixels` = 3×3 median replacement for pixels deviating by more than `Amount`. Gaea's filter is unspecified. |
| `Curve` / `Recurve` | approx | Monotone cubic (PCHIP / Fritsch–Carlson) interpolation through the control points, with `Absolute` and `Relative` modes. Gaea's spline basis is unknown; PCHIP is the standard monotone choice. Control points come from the node's `Curve Spline` list parameter, which is **not editable in this build** (§8). |

### 5.4 Combination, masking, routing

| Node | Verdict | Detail |
| --- | --- | --- |
| `Combine` | approx (exact per mode) | All 24 modes are the standard compositing formulas (Blend, Add, Screen, Subtract, Difference, Multiply, Divide, Divide2, Max, Min, Hypotenuse, Overlay, Power, Exclusion, Dodge, Burn, SoftLight, HardLight, PinLight, GrainMerge, GrainExtract, Reflect, Glow, Phoenix), each guarded against division by zero and non-finite results. `Blend` uses `Ratio` as a linear mix. **For every non-mixing mode, `Ratio` additionally scales the result toward input 0** — this keeps the control meaningful for arithmetic modes but is an invention; Gaea's per-mode use of `Ratio` is unknown. `Output` = None/Clamp/Extend and `Enhance` = None/Autolevel/Equalize are implemented as named. |
| `Mask` | model | Mask-modulates input 0 by input 1: `out = v + (0.5 - v)*(1 - w)`, i.e. mask 1 keeps the value and mask 0 pulls it to mid-height. **Gaea's `Mask` node is a *drawing* primitive**, so its real behaviour with a connected input is not a modulation at all. This is a conventional mask semantic substituted for an unknown one and is **the least evidence-backed node in the build**. |
| `Blend` | model | Cross-fade of two inputs by the mask on port 3. Registry-only; not a catalogued Gaea node. |
| `HeightSelect` / `SlopeSelect` / `MaskSelect` / `AngleSelect` | model | Smooth-band routing between two inputs, each with `Falloff` and `Invert`. The node names and families are real; Gaea's internal mask algebra is replaced by conventional smoothstep bands. |
| `DataSelect` | model | Cross-fade by an explicit `Index`. Registry-only; Gaea's `DataSelect` selects by data value, not by an index parameter. |

### 5.5 Terrain features

| Node | Verdict | Detail |
| --- | --- | --- |
| `Crater` | model | Classical impact profile: gaussian rim centred at `r = 1` (width from `Rim` soft/sharp), bowl floor `-(1 - r^2)^(1 + 2*Formation)` inside, ejecta falloff outside, plus deterministic surface breakup. `Style` New/Classic varies the floor/rim balance. The profile shape is standard geology; **the mapping of `Formation` and `Shape` onto it is invented.** `X`/`Y` are treated as 1 % offsets from centre, while the IL says 0..1 centred at 0.5 — a known unit divergence. |
| `Mountain` | approx | Ridged **Voronoi** crest network summed over 5–9 octaves with a radial massif envelope, matching Gaea's own description ("a modulated Voronoi pattern"). `Style`/`Bulk`/`ReduceDetails` alter the exponent, octave count and bulk factor. The real node is a hand-tuned multi-primitive stack; this is a reconstruction driven by the same controls. |
| `Canyon` | approx | Warped Voronoi edge network cut into a plateau: `Slot` sharpens the trench exponent, `Valley` raises the floor, `Surrounding` controls plateau relief, `StructualWarp`/`DetailWarp` drive two warp layers, `Style` adds strata (`sin` banding) or erosion flavouring. |
| `Glacier` | model | Downhill-biased accumulation along `Direction` with directional breakage; `Thickness`/`Height`/`Breakage`/`BreakageCount`/`FlowBreakageDepth` are applied. Several v2 controls (`Substructure*`, `DiagonalBreakage*`, `Extreme`, `Chipped`, `SecondaryBreakage`) are accepted but only partly honoured. |
| `FractalTerraces` | model | Terraces from quantising a fractal-perturbed height with a `Sharpness`-controlled smoothstep between steps and a `Tilt` ramp. Smoothstep quantisation is a standard technique, not Gaea's step profile; the `Advanced` group's controls are not honoured. |
| `Steps` | model | Hard quantisation into `Steps` bands with an optional smooth transition. The band profile (midpoint versus edge) is a choice. |
| `Sea` | model | Flattens everything below `Level` to a water surface with a shore falloff. **Gaea treats water as a separate depth/shore channel**; this build has no channel plumbing, so the effect is baked into the single height field. |
| `Snow` | model | Physical accumulation: altitude `Snowline` × slope `SlopeLimit`, minus a `Melt`/`MeltAngle` term. Gaea's `Snow` is artwork-driven with masks for aspect, drift and depth, none of which is reproduced. |
| `Cracks` | model | Fracture mask along warped Voronoi cell edges, width-thresholded. The real node's stratification and joint-set controls are not honoured. |

### 5.6 Masks

| Node | Verdict | Detail |
| --- | --- | --- |
| `Slope` | model | Central-difference gradient magnitude with a `Strength` exponent and `Scale` divisor. Gaea's slope is computed on a scaled terrain with its own units. |
| `Height` | model | Smooth height band between `Low` and `High` with `Falloff`. Parameter names differ from any single Gaea node — this is a composite of the `HeightSelect`-family controls. |
| `Occlusion` | model | Local height minus a blurred neighbourhood, normalised to `[0,1]`. Real AO uses ray or multi-directional occlusion. |
| `Distance` | model | Exact two-pass 8-neighbour chamfer distance transform from the thresholded solid region. The transform is standard; the `Threshold`/`Invert`/`Use Gradient` surface is inferred. |

### 5.7 Erosion and flow — the most important read

Gaea routes erosion through distinct native kernels, confirmed from the symbol inventory and
decompiled call sites ([`docs/kernels-node-mapping.md`](../docs/kernels-node-mapping.md)):

| Gaea node | Gaea kernel (observed) | This build |
| --- | --- | --- |
| `Erosion` | `Erosions.Classic` → C++/CLI `ErosionWrapper` (Gaea.CE.dll), fluvial + thermal | `streamPower` — stream-power incision with deposition |
| `Erosion2` | `Erosions.PE` → SYCL `ParallelErosion`, particle-based on a Laplacian pyramid | `hydraulicDroplet` — single-scale particle/droplet erosion |
| `Thermal` | `Simulations.Thermal` → `ErosionWrapper`; `Erosions.Thermal2` → SYCL `Thermal2` | `thermalTalus` — talus-angle relaxation |
| `EasyErosion` | `Erosions.PE` | resolves by alias to `Erosion2` |

Gaea's `ParallelErosion` runs particles through `flow(...)` on a `LaplacianLevel` multiscale
pyramid (`erode_level`, `reconstruct_previous_level`). This build uses a **single-scale** droplet
solver. That is the largest structural divergence in the project: **Gaea is multiscale, this
build is not.**

#### `FlowMap` — model

The physical part is **exact**: D8 receivers from the steepest-descent neighbour (diagonal
distance sqrt 2), then a descending-height sweep adding each cell's accumulation to its receiver.
Verified: on a tilted plane every one of the 1024 cells of a 32×32 field routes into the single
corner outlet, receivers are strictly downhill, and accumulation never decreases downslope.
Gaea's `FlowMap` renders a flow *colour/velocity map*; this build emits log-compressed
accumulation with `FlowLength`/`FlowVolume` as exponents. **The accumulator is right; the
presentation is a stand-in.**

#### `Erosion` — model (stream power)

`dh/dt = -K*A^m*S^n` (detachment-limited incision) with D8 upflow accumulation `A`
log-normalised, `m = 0.5`, `n = 1 + 0.6*Downcutting`,
`K = 0.02 + 0.35*Strength + 0.2*RockSoftness`. Adds: deposition with `Debris` as the coefficient
scaled by `Volume`, hillslope diffusion from `Inhibition`, a `BaseLevel` floor, optional
altitude/slope precipitation bias from `BiasType`/`Bias`, and `SedimentRemoval`. `Duration` maps
to `round(Duration*24)` iterations; `AggressiveMode` removes the per-step timestep clamp.

*Verified:* the output never gains mass (mean height is non-increasing) at any resolution.
*Not verified:* `K`, `m`, `n` and the deposition/diffusion coupling are inferred, not recovered.
Gaea's `Information` byte counters and `FeatureScale` / `RealScale` / `TerrainScale` /
`Verticality` / `AreaEffect` have no analogue and are ignored.

#### `Erosion2` — model (particle / droplet)

Hansson-style droplet erosion: particles spawn uniformly, follow the height gradient with
inertia 0.05, and either erode into a brush or deposit, governed by a sediment capacity.
Mapping: `Duration` → droplet budget (`Duration * 0.8 * N^2`); `Downcutting` → erosion rate
(`0.1 + 0.6*Downcutting`); `ErosionScale` → brush radius 1–4 cells; `SuspendedLoad` → capacity
factor (`1 + 4*SuspendedLoad`); `BedLoad` → deposit rate (`0.08 + 0.55*BedLoad`);
`CoarseSediments` → deposition footprint (point / 1 cell / 2 cells); `Shape`, `ShapeSharpness`
and `ShapeDetailScale` → valley post-shaping (gamma on the normalised field plus an unsharp
mask). `Enable`/`NoErosion` early-out. `DepositionBoost`/`ExtraDepositionBoost` multiply
deposits.

Three engineering decisions worth stating explicitly:

1. **The simulation runs in metres.** The engine's field is a normalised `0..1` height, while the
   droplet equations are written for metre-scale terrain. A constant `TERRAIN_HEIGHT_M = 800`
   converts in and out. Without it, sediment capacity and deposition are in the wrong ratio and
   the field grows without bound — observed during development as **a single cell reaching 8.9 on
   a `0..1` field**. This is the single most important numerical decision in the kernel.
2. **Stability limits are enforced rather than tuned away.** A droplet may never pick up more
   than the drop it just travelled (`capacity <= 1.5*(-dh)`); single-step deposition is bounded
   to 0.4 % of the terrain relief; a droplet that runs out of steps deposits its remaining load
   over the brush footprint rather than dumping it on its last cell. Measured mass drift on a
   cone: **-7.4 %** — the model removes net material rather than creating it.
   For reference, two intermediate revisions of this kernel produced unbounded growth because
   (a) the border sample used a different clamping rule than the interior sample at the same
   point, and (b) the percentile-based `Autolevel` could amplify a spike. Both causes were found
   by tracing per-stage field statistics, not by reading the code.
3. **The erosion brush is deliberately resolution-independent** (1–4 cells regardless of N). A
   physically-sized brush would make a 512 px build erode visibly differently from the 256 px
   preview of the same graph. The cost is that the droplet count — and therefore the channel
   density — does scale with N^2, so a higher-resolution build shows finer channels. Preview and
   build are the same *kind* of terrain, not a pixel-exact match.

`DischargeAngle` appears **three times** in the vendor dump for this node with different
meanings; it is accepted once and unused. `DirectionalPrecipitation`/`Direction`/`RainShadow`
and the `Slope`/`Altitude` windows are accepted and unused. `Reverse` is not implemented.

#### `Thermal` — model

Talus-angle relaxation: material moves downhill only where the local slope exceeds the repose
angle (derived from `Strength`), mass-conserving, with an anisotropy weight along `Angle` and a
`Settling` factor reducing the moved fraction. *Verified:* total variation is strictly reduced.
The talus-threshold formula and the `Settling` semantics are inferred.

---

## 6. Reproducing the analysis

The evidence behind every claim above is regenerable:

```powershell
pwsh -File tools/run-analysis.ps1
```

This rebuilds the offline decompiler, re-decompiles `Gaea.Nodes.dll` and `Gaea.Engine.dll`,
re-extracts node specifications, cross-checks them against the shipped catalog, and re-runs the
web integrity checks. `tools/gen_web_impl_table.py` regenerates the table in §4 from
`web/js/registry.js`, so the table cannot drift from the code.

---

## 7. What is not implemented

* **Tiling.** Gaea builds large terrains as overlapping tiles with edge blending
  (`BuildDefinition.TileResolution`, `OverlappingPixels`, `EdgeBlending`). This build evaluates
  one field at the selected resolution.
* **Persistent cache.** Gaea's parity-based cache is modelled in memory only, per session.
* **Channel plumbing.** Gaea passes several named channels between nodes (height, mask, color,
  flow, water depth, snow depth). This build carries a single scalar field plus a 4-channel
  colour path, so nodes whose output is inherently a second channel (`FlowMap`, `Snow`, `Sea`,
  `Accumulator`) either bake their result into the height field or write into the one available
  mask slot.
* **Export formats beyond PNG.** Only PNG8 and PNG16 are written; the ~13 RAW/JPEG/EXR formats in
  `Export`'s `Format` enum are not.
* **Colour-pipeline node families.** `CLUTer`, `SuperColor`, `SatMap`, `Tint`, `RGBMerge`,
  `WaterColor`, `WaveShine` and friends are catalogued but not implemented, and export is
  greyscale-only.
* **The remaining 132 catalog nodes** render their true parameters and pass through, with an
  honest badge.

## 8. Known defects

1. **`File` decodes nothing** — deliberate stub (§5.1).
2. **`Mask`'s semantics are substituted, not recovered** (§5.4) — the weakest evidence in the
   build, flagged as `model` in the UI.
3. **Curve editing is not exposed.** The `Curve Spline` / `Gradient Data` / `Synth Data` list
   parameters are not editable, so `Curve` and `Recurve` fall back to the identity spline unless
   a spline is supplied programmatically. A UI gap, not an algorithm gap.
4. **`Voronoi` `Form` mapping is interpretive** (§5.1).
5. **Duplicated parameter labels in the vendor dump** (`Perlin` has two `Type` and two
   `Octaves`; `Erosion2` has three `Discharge Angle`) are kept once, first occurrence wins. The
   second meanings are unreachable through the UI. This is a vendor flattening artefact, recorded
   here rather than silently patched over.
6. **Unit divergences between the IL and this build's kernels** exist for `Blur.Radius` (pixels
   here, normalised in the IL), `MultiFractal.Size` / `Perlin.Scale` (fractions here, other scales
   in the IL) and `Crater.X`/`Y` (1 % offsets here, 0..1 centred in the IL). The registry range
   wins in each case and the parameter tooltip reports the provenance.
7. **`Erosion2.Reverse`** and `Erosion`'s duplicated/`Information` parameters are unused.
8. **Snapshot-based undo, 60 steps**, one entry per continuous interaction.
9. **`Erosion2`'s droplet count depends on resolution**, so preview and build are not
   pixel-identical (§5.7).

## 9. Verification status — what was checked, and what could not be

Two suites, both importing the same modules the browser loads:

* `node tests/smoke.mjs` — **86 assertions, 0 failures.** Noise statistics (mean ≈ 0, bounded
  range, seed sensitivity, lattice-period wrapping, `F2 >= F1`), PRNG uniformity, field utilities
  (blur preserves the mean and softens edges, slope magnitude in range, NaN/Inf sanitisation),
  all 24 combine modes over a grid including every degenerate case, D8 correctness (receivers
  strictly downhill; a tilted plane routes all 1024 cells into the single corner outlet; a ridge
  cell accumulates only itself), erosion physics (droplet erosion lowers the mean, stream power
  never adds mass, thermal erosion strictly reduces total variation), **all 56 registered
  algorithms evaluate at three resolutions with no errors and no exploded ranges**,
  bit-identical determinism for a fixed graph + seed, and the catalog/registry cross-check.
* `node tests/app-test.mjs` — **63 assertions, 0 failures, 0 console errors, 0 warnings.** Runs
  the real `js/app.js` under `tests/dom-shim.mjs`: catalog load, 182 library entries, evaluation
  of the demo pipeline (min 0.000 / max 1.000 / mean 0.233 / sd 0.084 at 256 px), viewport
  `ImageData` construction, graph editing (add, connect, self-connect refused, cycle refused,
  delete), the parameter panel (a Radius slider writes into the graph, an enum renders as a
  `<select>`, the fidelity badge tells the truth), a catalog-only node (added, schema-rendered,
  marked not implemented, and evaluated successfully as a passthrough), undo/redo, PNG16 + PNG8
  export with signature/bit-depth/dimension checks, resolution and seed changes, and every
  toolbar button.

**Not verified: the browser itself.** This build sandbox cannot start Chromium — its mojo IPC
needs named pipes, which the sandbox denies. Chrome and Edge were tried with `--headless`,
`--headless=new`, `--dump-dom`, `--disable-crash-reporter` and `--remote-debugging-port`; every
launch self-terminates with `OpenProcess: access denied` followed by
`platform_channel.cc: Check failed: access denied`. Consequences:

* `web/js/viewport.js` was executed only under the DOM shim, whose `getContext('webgl2')`
  returns `null`. **The GLSL vertex/fragment shaders have never been compiled by a real driver,
  and the 3D terrain has never been seen.** The 2D path ran against a stub 2D context, which
  proves the code path executes and builds correctly-sized, non-empty `ImageData`, but not that
  it looks right.
* No screenshot of the UI exists. Element structure is verified; visual design is not.
* The WebGL2-unavailable fallback **is** verified, because the shim always takes that branch.

`http://127.0.0.1:8080/?selftest=1` exists so that a machine with a working browser can close
this gap in one command. Its report includes the WebGL2 status, the worker status, the 3D mesh
triangle count, a `readPixels` probe of the 3D framebuffer, and the results of running every
implemented algorithm in-page.

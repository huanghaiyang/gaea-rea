# Erosion2 parameter correspondence, node to kernel

Derived by `python tools/verify-parameter-mapping.py`, which re-reads both evidence files and
refuses to emit a mapping whose ordering is not forced. See
`docs/gaea-parameter-mapping.json` for the machine-readable form.

## Why this needed checking rather than transcribing

`ParallelErosion.Parameters` has 23 fields and **every one of them was renamed by
Eazfuscator**. Both dumps render the mangled name identically, so the fields cannot be
joined textually. The join is by order — which is only sound if the order can be
independently proven, and it can:

| Check | Result |
| --- | --- |
| Obfuscated suffixes form a contiguous run | `0x759`..`0x76f` = **23 values**, matching 23 declared fields |
| Suffixes absent from the call site | exactly `75d`, `75f`, `762` — three fields `PE()` never sets |
| Int32 count | **exactly 1**, at index 7 → lands on `Seed` |
| Boolean count | **exactly 1**, at index 22 (last) → lands on `NoErosion` |

The two type constraints are what make this a proof rather than a guess: `Seed` is the only
integer parameter and `NoErosion` the only boolean, and the type list happens to contain
exactly one of each, at positions that match. A different ordering would put a `Single`
where an `Int32` is declared.

## The full chain

```
Erosion2 node
  → Erosions.PE                        (managed, Gaea.Nodes.dll)
  → ErosionWrapper.ErodeTerrain        (C++/CLI, Gaea.CE.dll)
  → SyclFunctions.ParallelErosion.Simulation  (Gaea.Engine.dll)
  → parallel_erosion::ParallelErosion::erode  (SPIR-V, Gaea.oneAPI.dll)
  → ParallelErosion_Erode              (native export, Gaea.Native.dll @ 0x18003cfe0)
```

## Kernel parameters, in native field order

```
ErosionScale  Duration  Seed  Downcutting  Shape  ShapeSharpness  ShapeDetailScale
SuspendedLoadDischargeAmount  SuspendedLoadDischargeAngle
BedLoadDischargeAmount        BedLoadDischargeAngle
CoarseSedimentsDischargeAmount CoarseSedimentsDischargeAngle
DowncuttingType  DepositionBoost  ExtraDepositionBoost  NoErosion
```

plus `Resolution`, `TerrainWidth`, `TerrainHeight` from the map.

## The node exposes 23 parameters, the kernel takes 17

Six UI parameters never reach the kernel. They build the **masks applied before the erosion
call**, which is visible in the managed code as `AspectMaps.GetHeight`,
`AspectMaps.GetSlopeNormalized`, and the `areaMask` / `srMask` copies:

```
Enable · Directional Precipitation · Direction · Rain Shadow · Slope · Altitude · Reverse
```

`Slope` and `Altitude` are `Float2` ranges, and `Direction` runs 0–**360**, not 0–32.

## `Discharge Angle` appears three times

The catalogue holds three parameters with the identical name `Discharge Angle`, one after
each load parameter. Gaea's own `description` for all three is the same sentence
("Sets the slope at which suspended load settles."), so the description cannot distinguish
them — **only position does**:

| Catalogue index | Preceded by | Kernel field |
| --- | --- | --- |
| 6 | `Suspended Load` | `SuspendedLoadDischargeAngle` |
| 8 | `Bed Load` | `BedLoadDischargeAngle` |
| 10 | `Coarse Sediments` | `CoarseSedimentsDischargeAngle` |

**This is a structural problem for this build.** `web/js/registry.js` declares parameters as
a JavaScript object keyed by name, so three same-named entries cannot coexist; the registry
currently has **one** `Discharge Angle` where Gaea has three. The two missing angles are
therefore not merely unimplemented values — they are **unrepresentable in the current
parameter schema** and require a schema change (an array of parameter records, or unique
internal keys with a shared display label).

## Defaults: the catalogue wins, the C# defaults are only fallbacks

`PE()` declares defaults of `SuspendedLoadDischargeAngle = 24`, `BedLoadDischargeAngle = 15`,
`CoarseSedimentsDischargeAngle = 10`, and `ShapeDetailScale = 0.8`. The catalogue reports
`10`, `10`, `10` and `0.25`. Both are real; they answer different questions:

- the **C# defaults** apply only when the node does not pass an argument
- the **catalogue values** come from the node's IL metadata, i.e. what the UI actually sends

So the effective defaults are the catalogue's. A reimplementation that reads the native
signature and adopts 24/15/10 or 0.8 would be wrong.

## What was wrong in this build, and what has now been fixed

| Parameter | Gaea | was | now |
| --- | --- | --- | --- |
| `Duration` | default **10**, range **1–200** | 0.5, range 0–1 | Gaea's, with `gaeaDial` converting to the solver's dial |
| `Erosion Scale` | default **1000**, range **1–20000** | 0.5, range 0–1 | Gaea's, log-mapped onto the brush radius |
| `Shape` | 0.2 | 0.4 | 0.2 |
| `Shape Sharpness` | 0.6 | 0.4 | 0.6 |
| `Shape Detail Scale` | **0.25** | 0.5 | 0.25 |
| `Suspended Load` | **1** | 0.5 | 1 |
| `Bed Load` | **0** | 0.35 | 0 |
| `Coarse Sediments` | **0** | 0.35 | 0 |
| `Rain Shadow` | 0.8 | 0.5 | 0.8 |
| `Direction` | range 0–**360** | 0–32 | 0–360 |
| `Discharge Angle` | **three** parameters | **one** | three, with distinct keys |
| `Enable` | true | generic toggle default `false` | true |

The defaults and ranges were invented rather than measured. `Duration ∈ [0,1]` was the worst
of them: the solver multiplies `Duration` by a droplet budget, so a normalised dial happened
to work, but the UI could not express Gaea's range and no value was comparable to Gaea's.
`gaeaDial` in `kernels/erosion.js` now performs the conversion, and it is explicitly labelled
a **calibration, not Gaea's formula** — the native Duration-to-droplet mapping has not been
recovered. It is chosen so the catalogue default 10 reproduces the budget the old 0.5 dial
gave, which keeps the existing calibration meaningful instead of reinterpreting it.

### The two discarded parameters

`buildSchema` contained:

```js
if (seen.has(cp.name)) continue; // vendor dump contains duplicate labels; keep the first
```

Two real parameters were being dropped, and nothing failed. Parameters now carry a `key`
separate from their display `name`, and duplicated labels get the alias keys declared in
`PARAM_KEY_ALIASES`. All three occurrences get aliases — including the first — because once a
label is ambiguous it is not a usable key at all.

### `Enable` had no IL default, and the fallback disabled the solver

`Enable` is absent from the catalogue's IL metadata, so `mergeParam` fell back to the generic
per-type default, which for a toggle is `false`. The solver treats `Enable` as a master gate,
so Erosion2 became a **no-op** — the smoke test caught it as `mean 0.33467 -> 0.33467`. It now
has an explicit registry default of `true`, and `param-schema-test.mjs` asserts it.

## What is still not done

**The three discharge angles and `DowncuttingType` are representable but not consumed.** The
UI now matches Gaea and the kernel receives the values, but `hydraulicDropletMultiscale` does
not read them — so the algorithm still models sediment discharge without the angle that
controls *where* sediment settles. This is a remaining fidelity gap in the algorithm, not in
the parameter surface, and `Erosion2` stays labelled `model`.

Also outstanding:

- **Native byte offsets** for the 23 fields. The C# declaration order gives the sequence, but
  `Resolution` is a struct of unknown size and three fields are never set by `PE()`, so the
  native layout cannot be computed from the call site alone. `FUN_18003b720` (the
  `Parameters` constructor) has not been read.
- **`DowncuttingType`**: a kernel parameter with no UI counterpart, so it is hardcoded in the
  managed layer. Its legal values have not been read.
- The **three gap fields** (`75d`, `75f`, `762`) are never set by `PE()`. Whether they are
  dead or set by another entry point (EasyErosion?) is unknown.

## The test lesson worth keeping

`multiscale-erosion-test.mjs` compares multiscale against single-scale drainage. It did not
pin the parameters it was not testing, so when the kernel defaults changed to Gaea's real
values (`Shape` 0.4→0.2, `Sharpness` 0.4→0.6, `Detail` 0.5→0.25) the test quietly began
measuring a *different experiment* and the drainage claim appeared to fail (88→82, 23→19).

Pinning every parameter the kernel reads restored the numbers exactly (88, 23) and confirmed
the claim had never been wrong — the harness had been. A comparative test that inherits
defaults is not a controlled test.


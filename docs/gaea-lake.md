# The Lake node: `lake::lake_create`

Second node recovered to algorithm level, and the first from the **named exports** rather than
from the erosion call graph. `Lake_Create` is one of the twenty exports of `Gaea.Native.dll`.

## The chain

```
Lake node (catalogue: Type, X, Y, Water Level, Render Surface, Accuracy,
                     Precipitation, Small Lakes, Flood Control, Water Floor,
                     Shore Size, Altitude Bias)
  → Lake_Create                     (export @ 0x18003dd00, a 206-byte wrapper)
  → FUN_180057aa0                   (2,716 B, 506 instructions, cyclomatic 33 — SCALAR)
```

The wrapper allocates `width * height * 12`, installs the interop vtable from its last
argument, copies the resolution, and calls through. Nothing algorithmic.

## The parameter match is what ties node to kernel

The decompilation exposes the real source names through lambda vtables:

```
lake::search_min(Map<float>&, int, int, float, int&, int&, float&)::{lambda_1, lambda_2}
lake::lake_create(lake::Parameters, float*, float*, float*, float*, InteropBridge)::{lambda_1, lambda_2}
```

and the offsets the native code reads line up exactly with the catalogue's `Lake` fields:

| Native | Catalogue | Default | Range |
| --- | --- | --- | --- |
| `parameters[1]` | `X` | 0 | −1..1 |
| `*(int*)(parameters + 0xc)` | `Y` | 0 | −1..1 |
| `*(float*)(parameters + 2)` | **`Water Level`** | 0.01 | 0..1 |

The native guard is literally `if (0.0 < *(float*)(parameters + 2))`, matching the
catalogue's positive floor — which is why a water level of zero produces no lake at all, and
that is asserted.

## The algorithm

```
1. seed at cells (X, Y), take its height
2. local-minimum descent: up to 5 steps toward the lowest neighbour,
   raising the comparison level by 0.2 * WaterLevel each step
3. find the basin's spill level
4. lake level = spill + a fraction of WaterLevel
5. refine over 9 iterations with a 0.5 midpoint
6. flood at the resolved level -> the output
```

Constants, all read out of the image:

| Address | Value | Role |
| --- | --- | --- |
| `0x1803561e4` | **0.2** | the descent's step fraction |
| `0x180356210` | **0.5** | the bisection midpoint |
| `0x18035625c` | **0.9** | in the level bracket |
| `0x1803563cc` | **FLT_MAX** | the spill-search threshold sentinel |
| `0x18035618c` | 0.01 | |
| `0x18035617c` | 0.001 | |

`FUN_1800570c0` is not the flood — it is the flood context's constructor, and what it allocates
is informative: **`width * height` bytes** (a per-cell visited mask) and **`width * height * 12`
bytes** (a queue entry per cell, i.e. `{x, y, height}`). A 12-byte entry is exactly what a
priority flood needs and not what a BFS would.

## Why a priority flood and not BFS

A plain queue explores by distance, so water could cross a cell whose height exceeds the level
simply by reaching it early. Processing cells in **increasing height order** means the flood
always expands from the lowest frontier cell, so a rim is only crossed once the level has
genuinely risen above it. That is what makes the result a lake rather than a
distance-limited puddle, and it is asserted: a full-height barrier keeps everything behind it
dry, and a higher level always floods a superset.

## A transcription error the smoke test caught

The first version of `gaeaLakeCreate` used `FLT_MAX` as the **bisection's upper bound**,
because that is what the binary loads into `local_470` before the first flood. But
`local_470` is the flood's **threshold sentinel**, not a bound — the level handed to the flood
is `local_468[0]`, a separate `local_46c`.

The consequence was immediate and loud: the first midpoint became `(level + 3.4e38) / 2`, the
flood covered the entire grid, and the app's node smoke test reported

```
Lake: exploded range [1.7014117331926443e+38, 1.7014117331926443e+38]
```

**Two locals that are both initialised from the same constant are not therefore the same
variable.** Reading `local_470 = FLT_MAX` and `local_468[0] = local_46c` as one thing is what
produced the error, and the fix was to separate them: the sentinel drives the spill search,
the level drives the flood.

## Fidelity: `approx`

Recovered exactly: the descent (5 steps, 0.2 factor), the flood's height ordering, the
9-iteration refinement, the 0.5 midpoint, the zero-level guard, and the seed mapping from
normalised X/Y.

Inferred, and the reason the label is not `exact`: the **bisection bracket**. The binary's two
bounds are `spill + 0.18 * WaterLevel` and `spill + WaterLevel`, which do not form a bracket
in the usual sense, and the lambda vtable hides the test that updates them. This
implementation searches between the spill and the terrain maximum, which is well-posed and
bounded. The convergence test is therefore a choice, not a transcription.

## Status

`Lake` is registered in `web/js/registry.js` bound to `gaeaLake`, so it is no longer
catalog-only. Twenty-five assertions in `web/tests/gaea-lake-test.mjs` cover the constants, the
descent, the flood's level bound, connectivity, the full-height barrier, monotonicity in the
level, and the resolved level.

## Reproduce

```
ghidra_decompile     0x18003dd00   # Lake_Create wrapper
ghidra_decompile     0x180057aa0   # lake::lake_create
ghidra_function_context 0x180057aa0  # size/complexity classification
ghidra_read_memory   0x1803561e4 4 # 0.2
ghidra_read_memory   0x1803563cc 4 # FLT_MAX
```

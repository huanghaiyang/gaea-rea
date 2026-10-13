# Where this build stands against Gaea 2.3.1

Written at round 39 of a 40-round effort, replacing an earlier version of this file. It exists so
the state is legible without reading the whole session: what was recovered, what was measured,
what is known to be wrong, and why the original objective was not reached.

## Coverage

| | |
| --- | --- |
| Vendor catalogue nodes | **182** |
| Registered algorithms | **81** |
| Catalog-only, no implementation | **111** |

Fidelity labels across the 81:

| Label | Count | Meaning |
| --- | --- | --- |
| `exact` | **8** | arithmetic transcribed from a disassembly or a published formula |
| `approx` | **48** | structure and parameters recovered; curves are standard forms |
| `model` | **24** | a published algorithm fitted to Gaea's parameter names |
| `stub` | **1** | a placeholder |

**45% of the catalogue is implemented.** That is the honest headline.

## Where each node's algorithm actually lives

The most useful routing fact found, and the one that changed the approach around round 20.

| Where | How to read it | Scale |
| --- | --- | --- |
| `Gaea.Native.dll` exports | Ghidra; scalar functions are readable | **20 exports**, ~8 are node entries |
| Managed `Gaea.Nodes.whole.cs` | already decompiled, plain C# | **195 `Node` subclasses**, the bulk |
| SPIR-V in `Gaea.oneAPI.dll` | **metadata only — no bodies** | 118 kernel names and signatures |
| ImageMagick, inside the managed layer | published deterministic formulas | **5 nodes** |

**The SPIR-V finding reverses an early assumption.** `Gaea.oneAPI.dll` embeds 13 SPIR-V modules
containing kernel names and complete C++ mangled signatures for 118 kernels, and **not one
`OpFunction`** — no bodies at all. An early carve produced 76 apparent functions; that was a
`0x17171717` filler run being swallowed by an over-long carve, and the conclusion was retracted.
The modules are reflection metadata, so the device-side kernels cannot be recovered from them.

**Gaea's native code has two kinds of kernel, needing two strategies:**

* **Scalar reference kernels** — the nine erosion passes. 110 B to 1.6 KB, readable arithmetic.
  Read the BODY.
* **SIMD hot kernels** — `FastBlur`'s inner box is 23 KB, 4,600 instructions, cyclomatic 83,
  unrolled across three runtime-selected feature levels. Read the STRUCTURE: dispatch thresholds,
  iteration counts, parameter derivation, buffer pairing — not the body.

## What is recovered to algorithm level

| Node or kernel | Fidelity | Source |
| --- | --- | --- |
| Nine-pass erosion pipeline | `model` | order and 8 of 9 passes from `FUN_1801f1350` |
| **Laplacian pyramid** | **filter `exact`** | `FUN_18003ee10`, `FUN_18003f250`, `FUN_1800463b0` |
| 3×3 diagonal-weighted relaxation | `exact` | `0.7071` / `1/(4+4·0.7071)` |
| Priority-flood lake fill | `approx` | `lake::lake_create`, `lake::search_min` |
| River stepper + pit fill + smoother | `approx` | `FUN_1800430c0`, `FUN_180041600`, `FUN_1800488f0` |
| Iterated separable box blur | `approx` | `FastBlur_Process` → `FUN_180053e80` |
| Gamma / AutoGamma | `exact` | ImageMagick semantics |
| BlobRemover + 18 more ops nodes | `approx` | managed `Build()` + `[Parameter]` |

### The pyramid is the one thing recovered end to end

`web/js/kernels/pyramid.js`. Three nodes share it — erosion, hydrological correction and rivers
all build the same `0xa8`-byte `LaplacianLevel` chain, and the same twelve-assignment `.rdata`
block every one of those drivers opens with turned out to be the **upsampler's weight table**.

The 25 weights form a separable 5×5 Gaussian with `v = [0.0613596, 0.2447690, 0.3877396, ...]`,
and every one of the 25 equals `v[i]·v[j]`. **That identity is what verifies the table** — a
misread table, or the same address at the wrong operand width, fails it.

**One table serves both directions**: the full 5×5 for downsampling at stride 2, and a
parity-selected sub-window for upsampling. That is why the upsampler's tap counts are 9, 6, 6 and
4 — and the odd case reduces to a plain two-point mean, which explains the four equal taps in the
binary's `(odd, odd)` branch.

It is **only approximately normalised**: the kernel sums to `0.99999673` and the binary's own
divisor is `0.999998`. Two different numbers, neither 1, so each level shrinks by about **1.3
ppm** and a seven-level pyramid compounds that to a few ppm.

**Operand width is a trap worth naming.** `0x180356250` reads as `0.0` at 4 bytes and `0.875` at
8 — and the instruction that consumes it is `VMULSD`. The neighbouring constant at `0x18035626c`
is consumed by `VMULSS` and really is the 4-byte value. Checking the instruction's operand width
is what distinguishes them; assuming either width blindly produces a plausible constant that is
wrong.

## Known defect, unfixed

**Multiscale erosion loses about 10% of the field's dynamic range** (1.0000 → 0.8952) where
single-scale preserves it (1.0016).

### What is established

It is a **real defect, not a metric artefact**. Repeating the pyramid's own low-pass removes the
stored detail band by orders of magnitude while leaving the coarse structure erosion acted on, and
multiscale's D8 accumulation stays below single-scale's **at every blur level**:

| | raw | blur ×1 | blur ×2 | blur ×3 |
| --- | --- | --- | --- | --- |
| input | 495 | 977 | 1208 | **1576** |
| single | 310 | 1208 | 1228 | 1294 |
| multi | **228** | **806** | **1109** | **1307** |

So the band cannot be producing the measurement. Two further readings agree: multiscale shrinks
the range to 0.8952 while single-scale holds 1.0016, and **the blurred INPUT has the highest
accumulation of all three**, meaning the erosion is filling in existing drainage rather than
incising into it.

### The shape of the loss

The output range is `0.104752 .. 1.000000` against an input of `0.000000 .. 1.000000`.

**The maximum is untouched; the minimum is raised by 0.105.** The range is lost from the BOTTOM:
the coarse levels **deposit into the lowest cells** instead of carving them.

### Three hypotheses, all refuted by measurement

| Round | Hypothesis | Measurement |
| --- | --- | --- |
| 30 | the fixed deposition cap overwhelms the coarse levels' smaller relief | **refuted** — the coarsest level keeps **96.9%** of the finest level's standard deviation, so cap-to-relief grows by 1.0× not >5× |
| 32 | `applyShaping`'s unsharp mask pushes values out of range and the clamp destroys them | **refuted** — 0.8952 → 0.8917, i.e. nothing; the change was reverted |
| 33 | `metresToField`'s clamp compresses the extremes | **refuted** — **zero cells** fall outside the range, so there is nothing to clamp |

**Where it points:** the per-level droplet budget or the capacity/deposition balance. Not any
post-process.

### Reproduce

```
node tools/diagnose-multiscale.mjs   # the D8 table above
node tools/diagnose-levels.mjs       # refutes the deposition-cap hypothesis
node tools/localize-multiscale.mjs   # per-stage span/sd
node tools/measure-clamp.mjs         # zero overshoot
```

**Round 32 skipped the measurement that round 33 then ran in one call, and edited code on a guess
as a result.** The fix was reverted, but the lesson stands: a hypothesis about a numeric effect is
cheap to test and expensive to implement.

## Bugs found by their own tests

Seven, none caught by "it runs" or "the output is in range".

| Bug | The assertion that caught it |
| --- | --- |
| `Terraces` did not quantise at all — the exponent sat on the fractional part, cancelling to the identity (256 distinct values instead of 8 bands) | "should produce N bands" |
| `Curvature`'s window returned 0.5 on flat ground — a smoothstep centred on the lower bound | "a plane has zero curvature" |
| `Concave` folded the Laplacian through `Math.abs`, so both types returned the same mask | "the two Types must differ" |
| The discrete Laplacian `neighbourMean - centre` is **NEGATIVE at a peak** — the opposite of the continuous convention, so the convex branch had to be `-lap` | "a ridge is lit" |
| `Filter`'s low-pass returned `low + detail`, the identity — it did nothing at Gain 1 | "a low-pass must reduce variance" |
| `Outcrops` and `Pockmarks` **erased the terrain** wherever no mark landed: skipped cells kept `createField`'s default of 0 | "`Height: 0` should be a no-op" |
| `Aperture`'s polygon structuring element collapsed toward a disc | "the two modes must bracket every cell" |

Plus one **assertion-design** error, a different failure mode: the check that snow and rain masks
are "opposed" counted cells where one exceeded the other and demanded >60%. It returned exactly
128 of 256 — **for two monotone gradients the split falls on the median** — while the masks were
perfectly anti-correlated. The count was measuring where the crossover sat, not whether one
existed. It now uses the sign of the correlation.

**The pattern is worth stating:** every one of the seven was caught by asking what the node's own
NAME implies must hold. A no-op must be a no-op. A low-pass must reduce variance. A plane has no
curvature. **None would have been found by increasing node coverage**, and none by a smoke test.

## Parameters: 113 of 224 were wrong

An audit against the `[Parameter(default, min, max)]` attributes in the managed assembly found
**113 of 224 registry parameters disagreeing** with what the runtime actually reads:

| Node.param | Guessed | Authoritative |
| --- | --- | --- |
| `Blur.Radius` | `[4.0, 0, 128]` | **`[0.1, 0, 2]`** |
| `Canyon.Scale` | `[50, 1, 300]` | **`[0.35, 0, 1]`** |
| `Cellular.Size` | `[50, 1, 300]` | **`[0.25, 0, 1]`** |

`tools/gen-param-authority.py` generates a table from the assembly and the registry applies it,
covering **174 nodes and 988 parameters**. **483 compared defaults now come from the attribute**,
against 171 from the catalogue's IL metadata and 39 still hand-authored.

Two notes on that work:

* The audit tool itself was **measuring the wrong thing** — it scanned registry source literals,
  which the authority table deliberately overrides, so the count could never converge. It now
  reads the effective schema via `tools/dump-schema.mjs`.
* **220 attributes** still resist extraction, and the cause was a hardcoded type list in the name
  resolver: it matched `float|bool|int|...` and therefore failed on **every attribute decorating
  an enum property**. Fixing that took coverage from 702 to 988 parameters and exposed a bug where
  an authority entry without a `d` set `Enable = undefined` — and `Enable` is Erosion2's master
  gate, so the solver silently stopped running. `param-schema-test` caught it.

## Why the objective was not reached

The objective was **all 182 nodes**, at algorithm level, each with reproducible verification and a
fidelity label.

**Rounds 1–19 went into two nodes.** Erosion took about ten rounds: nine passes, a 512-byte
`Particle` struct, a fixed-point terrain commit, the parameter-to-context mapping, and two
retracted conclusions (the `Particle` stride, and a closed-form constant off by 113 float32 ulps).
Lake and the pyramid added more. **Deep recovery runs 3–5 rounds per node.**

**Rounds 34–38 did node BREADTH and averaged 5 per round**, but only because the work was
shallow: read a managed `Build()`, infer the operation from the helper's name and the parameter
attributes, write it, assert a property. Those 19 nodes are `approx`, not `exact`.

At 5 shallow nodes per round the remaining 111 would need **22 more rounds**. At deep recovery
rates it would need far more. Neither fits in 40.

**The two rates are not interchangeable, and the gap between them is the real finding.** A
catalogue of 182 nodes cannot be replicated at algorithm level by either strategy in the time
available; what is achievable is a broad `approx` surface plus a small `exact` core, and that is
what exists.

## Reproduce any of it

```
python tools/node-routing.py            # node -> managed class, params, ImageMagick calls
python tools/rank-nodes.py              # cost-ranked worklist -> docs/node-worklist.json
python tools/gen-param-authority.py     # authoritative parameter table
node   tools/dump-schema.mjs docs/effective-schema.json
python tools/param-audit.py             # effective schema vs the assembly's attributes
node   tools/diagnose-multiscale.mjs    # the range-loss evidence
python tools/validate_web.py            # reference integrity
```

Tests: `node web/tests/<name>.mjs`. The suite is focused per kernel rather than monolithic; the
ones covering recovered Gaea behaviour are prefixed `gaea-`.

## Standing constraint

**No git commits were made.** The working tree carries 75 changed files on top of `41cda04`, and
that is deliberate — the instruction was explicit and was honoured for all 39 rounds.

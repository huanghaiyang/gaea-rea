# The erosion context struct: offsets recovered from `FUN_1801f24f0`

`FUN_1801f24f0` is the erosion orchestrator. It receives one pointer — the context struct the
driver and the apply both use — and it is where the whole simulation is set up: the pyramid is
built, the level chain is walked, and the nine-pass driver is invoked once per level per
iteration. Reading it maps most of the context offsets, and answers the discharge-angle
question that had been blocking the contribution formula.

## The three discharge angles — the missing link

```c
fVar17 = tanf((param_1[0xdc] / 180.0f) * PI);   param_1[0x124] = fVar17;
fVar17 = tanf((param_1[0xe4] / 180.0f) * PI);   param_1[0x128] = fVar17;
fVar18 = tanf((param_1[0xd4] / 180.0f) * PI);   param_1[0x120] = fVar18;
```

`0x180356398` = `0x43340000` = **180.0** and `0x180356334` = `0x40490fdb` = **PI**, so this is
the plain degrees-to-radians conversion.

**`param_1[0x120]`, `[0x124]` and `[0x128]` are read by `FUN_1801f0c60` as deposition slope
thresholds.** So the chain is complete:

```
SuspendedLoadDischargeAngle ─┐
BedLoadDischargeAngle ───────┼─→ tan(deg/180·PI) ─→ [0x120]/[0x124]/[0x128] ─→ deposition gates
CoarseSedimentsDischargeAngle┘
```

This is what the previous round could not close. It also explains a real gap in this build:
`Erosion2` accepted all three angles as parameters and did nothing with them, so the UI
matched Gaea while the algorithm ignored them. They are a **physical parameter of the
deposition rule**, and a tangent is the right form — the threshold is a terrain slope, and
`tan` converts the angle at which material settles into the slope that corresponds to it.

### One implementation trap

The natural clamp for a tangent is 90 degrees, a vertical slope. **That is wrong in floating
point.** `tan(PI/2)` returns about **1.6e16**, not infinity, because PI/2 is not exactly
representable. A threshold that large is never crossed, so clamping at 90 silently *disables*
the deposition term instead of saturating it — the failure would look like "the angle
parameter has no effect", which is exactly the bug being fixed.

The implementation clamps to Gaea's **declared range, 0..45 degrees**, where the value is
well-defined and the ordering is monotone. A test asserts `threshold(90) === threshold(45)`
and that the clamped value stays below 2.

## Context offsets recovered

| Offset | Type | Role | Evidence |
| --- | --- | --- | --- |
| `0x10c` | int | level count | loop bound; `log2f`-derived, then rounded |
| `0x108` | int | current level index | set per level, decremented per iteration |
| `0x110` | int | **iteration counter** | incremented per level pass; read by `FUN_1801f0c60` |
| `0x114` | int | `log2f((0xa8·0.5) / (0xa0 / gridSize))` | pyramid depth |
| `0x118` | int | `log2f(1.0 / 0xcc)` | second depth term |
| `0x120` | float | `tan(angle at 0xd4)` | deposition threshold |
| `0x124` | float | `tan(angle at 0xdc)` | deposition threshold |
| `0x128` | float | `tan(angle at 0xe4)` | deposition threshold |
| `0xd4`,`0xdc`,`0xe4` | float | the three discharge angles, in degrees | `tanf` inputs |
| `0x68` | char | cancellation flag | breaks the level loop |
| `0x70` | ptr | head of the level chain | loop terminator |
| `0x78` | ptr | next level in the chain | walk |
| `0x48` | double | accumulated work (`w·h·droplets`) | set per level |
| `0x50` | double | `0x48 * 0x58` | progress fraction |
| `0x58` | double | denominator for that fraction | |
| `0x98` | int | grid size | `log2f` divisor |
| `0xa0`,`0xa4` | float | physical scales | `fVar22 = 0xa8/0xa0`, level scaling |
| `0xa8` | float | derived, with a saturating curve | rewritten in place |
| `0xcc` | float | divisor for the second `log2f` | |
| `0xf4` | char | a mode flag; when set, zeroes `0xbc` | |
| `0x138` | char | dispatch mode: selects one of two `parallel_for` paths | |
| `0xbc`,`0xb4`,`0xc0` | float | zeroed at setup | |
| `0x30`,`0x38` | code ptr | vtable-ish callbacks (`(*pcVar2)()`) | |

That is more than twenty offsets, which turns the contribution formula in `FUN_1801f0c60`
from "assemble from unknowns" into "assemble from named fields".

**Important caveat:** this context struct is **not** the `Parameters` struct whose field order
was established earlier. `param_1[0x48]` here is a `double` work accumulator, whereas
`Parameters` index 17 is `CoarseSedimentsDischargeAmount` at `0x48`. The two structures have
different layouts, and the copy between them has not yet been located. The offsets above are
therefore **internal context offsets**, not parameter positions, and the mapping from
`Parameters` into them is still open.

## The iteration structure

```c
iVar14 = param_1[0x10c];                    // level count
for (iVar13 = 1; iVar13 < iVar14; iVar13++) {
    param_1[0x108] = iVar13;
    level = FUN_1801efe80(alloc(0x80), prevLevel);      // build a LaplacianLevel
    ...push onto a chain...
    fVar18 = FUN_1801f0350((levelCount - iVar13) - 1);  // the parameter curve
    dVar3 = (double)(w * h * round(fVar18 * scale)) + param_1[0x48];
    param_1[0x48] = dVar3;                              // accumulated work
    param_1[0x50] = dVar3 * param_1[0x58];              // progress fraction
}

while (level != param_1[0x70]) {
    if (param_1[0x68]) break;
    FUN_1801f1350(param_1);                             // ★ the nine-pass driver
    ...dispatch a separate parallel_for...
    level = level[0x78];                                // next coarser
    param_1[0x108]--;                                   // level index down
    param_1[0x110]++;                                   // ★ iteration up
}
FUN_1801f1350(param_1);                                 // one final pass
...clamp: min(1.0, 0.001 * field[i])...
```

So the shape is **coarse-to-fine**: build the pyramid, then walk from the coarsest level down,
running the nine passes once per level, with `0x110` counting iterations. `FUN_1801f0350` — the
per-level curve recovered earlier — is called once per level with `(levelCount - index - 1)`,
i.e. with the **remaining** level count, so the curve's argument decreases as the simulation
proceeds down the pyramid.

That matches, and finally explains, why this build's hand-tuned linear taper was wrong: the
real per-level weighting is that curve, driven by remaining depth.

## Status

- **All nine passes** of the driver are read; eight of their kernels/mechanisms are implemented.
- **The discharge angles are now implemented** as slope thresholds (`gaeaDischargeThreshold`,
  `gaeaDepositionThresholds`), verified against tangents computed from the mathematical
  definition.
- The **contribution formula** in `FUN_1801f0c60` is still not transcribed: its inputs are now
  named, but several (`0xa0`, `0xa4`, `0xbc`, `0xc0`, `0xd0`, `0xd8`, `0xe0`, `0xe8`, `0xec`,
  `0xf0`) carry no assigned meaning yet beyond being scales and gains.
- The **`Parameters` → context copy** has not been located, which is what would tie the
  remaining offsets to node parameters.

`Erosion2` stays labelled `model`.

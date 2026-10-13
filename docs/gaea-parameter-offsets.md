# The Parameters struct inside the erosion context: the mapping is exact

This closes the blocking unknown of the previous round. The context struct's layout is now
fully known, because the two structures turn out to be nested.

## The discovery

`ParallelErosion_Erode` builds a 0x140-byte context on the stack and then copies the caller's
`Parameters` into it **verbatim**, 96 bytes as twelve 8-byte moves:

```c
memset(&local_178, 0, 0x140);                 // the context struct
...
local_e0  = *(undefined8 *)param_1;           // Parameters[0x00..0x07]
uStack_d8 = *(undefined8 *)(param_1 + 2);     // [0x08..0x0f]
uStack_d0 = *(undefined8 *)(param_1 + 4);
uStack_c8 = *(undefined8 *)(param_1 + 6);
local_c0  = *(undefined8 *)(param_1 + 8);
uStack_b8 = *(undefined8 *)(param_1 + 10);
uStack_b0 = *(undefined8 *)(param_1 + 0xc);
uStack_a8 = *(undefined8 *)(param_1 + 0xe);
local_a0  = *(undefined8 *)(param_1 + 0x10);
uStack_98 = *(undefined8 *)(param_1 + 0x12);
uStack_90 = *(undefined8 *)(param_1 + 0x14);
uStack_88 = *(undefined8 *)(param_1 + 0x16);  // [0x58..0x5f]
...
FUN_1801f24f0(puVar9 + 0x110);                // == &local_178, the context base
```

Twelve qwords is **96 bytes**, which is exactly the `Parameters` struct's size — the field
list established earlier is `Resolution` (8) + twenty `Single` (80) + one `Int32` (4) + one
`Boolean` (1), padded to 96.

`local_e0` sits at `local_178 + 0x98`. So:

> **`context + 0x98` is the verbatim `Parameters` struct.**

Every context offset at or above `0x98` therefore maps directly onto a named parameter, and
the rule is simply `parametersOffset = contextOffset - 0x98`.

## The complete map

| Context | −0x98 | Index | Parameter | Confirmed by |
| --- | --- | --- | --- | --- |
| `0x98` | `0x00` | 0 | `Resolution` | read as the grid extent |
| `0xa0` | `0x08` | 1 | `TerrainWidth` | `ErosionScale / TerrainWidth` is a physical scale |
| `0xa4` | `0x0C` | 2 | `TerrainHeight` | used as a divisor per level |
| `0xa8` | `0x10` | 3 | `ErosionScale` | the derived scale written back to it |
| `0xac` | `0x14` | 4 | *(never set by PE)* | |
| `0xb0` | `0x18` | 5 | `Duration` | zeroed during setup |
| `0xb4` | `0x1C` | 6 | *(never set)* | zeroed during setup |
| `0xb8` | `0x20` | 7 | `Seed` | the only `Int32` |
| `0xbc` | `0x24` | 8 | **`Downcutting`** | `NoErosion` zeroes it |
| `0xc0` | `0x28` | 9 | *(never set)* | zeroed during setup |
| `0xc4` | `0x2C` | 10 | `Shape` | |
| `0xc8` | `0x30` | 11 | `ShapeSharpness` | |
| `0xcc` | `0x34` | 12 | `ShapeDetailScale` | the `log2f(1/x)` divisor |
| `0xd0` | `0x38` | 13 | `SuspendedLoadDischargeAmount` | paired with the suspended threshold |
| `0xd4` | `0x3C` | 14 | **`SuspendedLoadDischargeAngle`** | `tanf` input |
| `0xd8` | `0x40` | 15 | `BedLoadDischargeAmount` | |
| `0xdc` | `0x44` | 16 | **`BedLoadDischargeAngle`** | `tanf` input |
| `0xe0` | `0x48` | 17 | `CoarseSedimentsDischargeAmount` | |
| `0xe4` | `0x4C` | 18 | **`CoarseSedimentsDischargeAngle`** | `tanf` input |
| `0xe8` | `0x50` | 19 | `DowncuttingType` | |
| `0xec` | `0x54` | 20 | `DepositionBoost` | |
| `0xf0` | `0x58` | 21 | `ExtraDepositionBoost` | |
| `0xf4` | `0x5C` | 22 | `NoErosion` | the only `Boolean` |

### The three checks that make this a proof, not a fit

**1. The odd-typed fields land on the odd-typed parameters.** `0xb8` is the only `Int32` in
the region and the only integer parameter is `Seed`; `0xf4` is the only `Boolean` and the only
boolean parameter is `NoErosion`. Both land correctly at their computed offsets.

**2. `NoErosion` disables `Downcutting`.** The orchestrator contains:

```c
if (*(char *)(param_1 + 0xf4) != '\0') {
    *(undefined4 *)(param_1 + 0xbc) = 0;
}
```

`0xf4` maps to `NoErosion` and `0xbc` maps to `Downcutting`. **Turning erosion off zeroes the
downcutting strength.** That is the physically sensible behaviour, and it is not something a
coincidental alignment would produce.

**3. The three angles pair with the three load amounts.** The thresholds are computed as
`tanf(angle)`, and the load amounts sit four bytes below each angle:

```
0xd0 SuspendedLoadDischargeAmount  ←→  0xd4 SuspendedLoadDischargeAngle
0xd8 BedLoadDischargeAmount        ←→  0xdc BedLoadDischargeAngle
0xe0 CoarseSedimentsDischargeAmount ←→ 0xe4 CoarseSedimentsDischargeAngle
```

and `FUN_1801f0c60` reads the thresholds as `[0x120]`, `[0x124]`, `[0x128]` — set from
`0xd4`, `0xdc`, `0xe4` — alongside `0xd0`, `0xd8`, `0xe0`. Amount and angle for each load are
used together.

### What this corrects

An earlier round recorded the context offsets as "internal, not parameter positions" and
noted a conflict: `param_1[0x48]` looked like a `double` work accumulator while `Parameters`
index 17 sits at `0x48`. **That conflict was an artefact of comparing two different base
addresses.** `0x48` in the *context* is context-only state; `0x48` in the *Parameters copy*
is `CoarseSedimentsDischargeAmount` at `context + 0xe0`. Both statements are true and they do
not conflict, because the structs are nested rather than aliased.

## Context-only state, below 0x98

| Offset | Role |
| --- | --- |
| `0x30`, `0x38` | callback pointers (`(*pcVar2)()`) — platform hooks |
| `0x48` | `double` accumulated work, `w · h · droplets` |
| `0x50` | `0x48 * 0x58`, the progress fraction |
| `0x58` | denominator for that fraction |
| `0x68` | cancellation flag |
| `0x70` | head of the `LaplacianLevel` chain |
| `0x78` | next level in the chain |
| `0x108` | current level index |
| `0x10c` | level count |
| `0x110` | **iteration counter** |
| `0x114`, `0x118` | `log2f`-derived pyramid depths |
| `0x11c`, `0x120`, `0x124`, `0x128` | per-step / threshold state, written by the orchestrator |
| `0x12c` | a per-droplet accumulation, read by the apply |
| `0x130` | the direction-table cursor |
| `0x138` | dispatch-mode flag: selects one of two `parallel_for` paths |

## Consequence

The contribution formula in `FUN_1801f0c60` can now be read with names instead of offsets. A
first pass over it:

- `0xd0` SuspendedLoadDischargeAmount gates the comparison against `0x120`
  (= `tan(SuspendedLoadDischargeAngle)`)
- `0xbc` Downcutting is an erosion strength
- `0xe8` DowncuttingType, `0xec` DepositionBoost, `0xf0` ExtraDepositionBoost are all gains in
  the same expression
- `0xc0` is one of the three fields `PE()` never sets, and the orchestrator zeroes it; a term
  in the apply is multiplied by it, so **that term contributes nothing for Erosion2** — worth
  stating because transcribing it as an active term would be wrong

`Erosion2` stays labelled `model`: the parameters are now named, but the formula they feed has
not yet been transcribed and checked.

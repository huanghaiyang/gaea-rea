# How Gaea applies erosion to the terrain: `FUN_1801f0c60`

Pass 4 (`FUN_1801f2470`) calls this once per live particle, after the droplet step has run. It
is where the height field actually changes. It is also where the most important thing about
Gaea's parallelism lives, and it is not the arithmetic.

## The mechanism

The terrain is **not** written as each droplet runs. Each droplet accumulates into three shared
per-cell buffers, and only one of them commits.

```c
// per step of the droplet's recorded path
atomicAdd_int(sumBuf[cell],   (int)(contribution * 2^24));   // fixed-point sum
atomicAdd_int(visitBuf[cell], 1);                            // contributor count
remaining = atomicAdd_int(startBuf[cell], -1);               // countdown

if (remaining == 1) {                    // this droplet was the LAST for this cell
    amount = (sumBuf[cell] * 2^-24) / visitBuf[cell];        // the AVERAGE
    if (param_1[0xf4]) amount = max(0, amount);
    heightField[cell] += amount;
    sumBuf[cell] = 0;
    visitBuf[cell] = 0;
}
```

`startBuf[cell]` was filled during seeding with the number of droplets that start at that
cell, so the first droplet to take it to **zero** — `remaining == 1` after the decrement — is
the last one to finish. That droplet commits for everyone.

### Why the constants matter

`0x1803563bc` = `0x4b800000` = **2^24** and `0x180356160` = `0x33800000` = **2^-24**. They are
**exact reciprocals**, so the round trip `float → int → float` introduces no scaling error.

The reason for integer atomics at all is **associativity**. A floating-point atomic add is not
associative, so parallel droplets accumulating into one cell would produce a result that
depends on the order the workers happened to run in — a different terrain from the same seed on
a different machine. Integer addition *is* associative, so the accumulated sum is
order-independent regardless of scheduling. Scaling into 24 bits keeps the fractional part
Gaea needs while staying inside the range where integer adds are exact in the float domain
too.

**This is testable and is tested**: three droplets contributing 0.3, 0.9 and 0.6 to one cell
produce an identical terrain in all six processing orders, and the committed value is the
**average (0.6)**, not the sum (1.8). A reimplementation that adds each droplet's contribution
directly erodes in proportion to how many droplets happened to visit, which is a different
terrain by a large factor.

### Two other things the commit does

- **The accumulators are cleared** in the same last-writer branch. Skipping the reset folds
  this iteration's material into the next one, producing a monotonically growing field.
- Two more buffers are updated: `param_10[cell] = max(0, amount + param_10[cell])` accumulates
  the positive part, and `param_9[cell] += -min(amount, 1)` the negative part. These are the
  **deposit** and **wear** maps that the node exposes as outputs — which is how the four
  output maps visible in the managed code (`results`, `wear`, `deposit`, `flow`) are produced.

## The contribution formula

The per-step contribution comes from a dense expression. Its constants are now all decoded and
its inputs all named, so the two clean sub-expressions are transcribed and tested; the rest is
listed but deliberately **not** transcribed yet.

### Transcribed and tested

**The iteration gain.** `FUN_1801f0c60` opens with

```c
zero   = (dispatchMode == 0) ? 0.3f : 0.5f;      // 0x1803561f0 : 0x180356210
fVar19 = expf(zero * -iteration);                // iteration = context + 0x110
gain   = (1 - fVar19) * DepositionBoost * 1.4f + 1;
```

A saturating ramp: exactly 1 at iteration 0, rising towards `1 + 1.4 · DepositionBoost`. So
`DepositionBoost` is not a constant offset — it is the **depth** of a ramp whose time constant
is `1/zero`, and the two mode values make the ramp reach its plateau about 1.67× faster in the
second mode. Implemented as `gaeaIterationGain`, with tests for the exact start value, the
plateau, monotonicity, and the mode ratio's decay.

**The path curvature.** The capacity term is built from two smoothed samples of the droplet's
own direction history:

```c
smooth3 = (dir[step-1] + dir[step] + dir[step+1]) / 3.0f;                       // 0x180356330
smooth5 = (dir[step-2] + dir[step-1] + dir[step] + dir[step+1] + dir[step+2]) / 5.0f;  // 0x180356344
a = smooth3 - dir[step];
b = smooth5 - dir[step];
capacity = max(zero, max(b, a));
```

The windows are plain means — 3.0 and 5.0 are the divisors, not tuned weights — and indices
**clamp at the ends** rather than wrapping, matching the binary's `if (i < 0) i = 0` guards. A
droplet's first step must not see its last.

**A finding the tests forced:** on a spike the smoothed value falls *below* the current one, so
the curvature is **negative**, and the floor is what stops that becoming a negative capacity.
The floor is not a rounding epsilon; it is what keeps the term meaningful on locally straight
or locally peaked paths. Implemented as `gaeaPathCurvature` and `gaeaCapacity`.

### Constants, all decoded

| Address | Value | Role |
| --- | --- | --- |
| `0x1803561f0` / `0x180356210` | 0.3 / 0.5 | the mode selector's two values |
| `0x180356330` / `0x180356344` | 3 / 5 | the 3- and 5-term window divisors |
| `0x1803562b0` | 1.4 | the gain's scale |
| `0x18035628c` | 1.05 | scale applied to a positive running delta |
| `0x180356240` / `0x1803562ac` | 0.8 / 1.25 | coarse-sediment branch bounds on `particle[0x128]` |
| `0x180356264` | 0.95 | multiplier on the 5-term sample and the particle accumulator |
| `0x1803561b4` | 0.05 | scales the last direction value before the loop |
| `0x1803561c4` | 0.1 | multiplier on the bed-load threshold |
| `0x1803561d4` | 0.15 | multiplier inside the `DowncuttingType` branch |
| `0x180356390` | 100 | default in the coarse-load term |
| `0x1803562a0` | 89128.9609375 | a large sentinel, also seen as `local_120` in `ParallelErosion_Erode` |
| `0x180356198` | 0.02 | the hardness-term weight |
| `0x18035625c` | 0.9 | |
| `0x1803563bc` / `0x180356160` | 2²⁴ / 2⁻²⁴ | the fixed-point pair |

### Not transcribed, and why

The remainder is a chain of nested `min`/`max` over `particle[0x118]`, `[0x11c]`, `[0x128]`,
`[0x12c]` and the smoothed samples. Its **inputs are now all named** — `Downcutting` at `0xbc`,
`DowncuttingType` at `0xe8`, `DepositionBoost` at `0xec`, `ExtraDepositionBoost` at `0xf0`,
the three load amounts at `0xd0`/`0xd8`/`0xe0` and their angle tangents at `0x120`/`0x124`/`0x128`.

**One term is provably inert.** A factor reads `context + 0xc0`, which is the never-set
parameter at index 9 that the orchestrator explicitly zeroes:

```c
*(undefined4 *)(param_1 + 0xc0) = 0;
```

so the term `particle[0x12c] * 0.02 * param_1[0xc0] * hardness[cell]` **contributes nothing for
Erosion2**. Transcribing it as an active term would be wrong, and a reimplementation that
"improved" it by supplying a default would diverge from Gaea.

I am not transcribing the rest yet because a chain of nested `min`/`max` assembled from
partially-understood intermediates is exactly the kind of transcription that *looks* correct.
The next step is to evaluate the chain numerically against a known droplet path, which pins
each branch's contribution rather than its text.

## Status

| Pass | Worker | Kernel | Status |
| --- | --- | --- | --- |
| 1 | `FUN_1801f1ed0` | particle position init | read |
| 2 | `FUN_1801f2100` | height-weighted seeding | implemented |
| 3 | `FUN_1801f23b0` | droplet step + dead-particle compaction | read |
| 3 | `FUN_1801f0440` | **the droplet physics** | direction rule implemented |
| 4 | `FUN_1801f2470` | **terrain apply** | mechanism implemented |
| 4 | `FUN_1801f0c60` | the apply itself | mechanism implemented, formula open |
| 5 | `FUN_1801f2ec0` | flow normalise | implemented |
| 6 | `FUN_1801f2f30` | flow-coupled relaxation | implemented |
| 7, 9 | `FUN_1801f3560` | accumulator flush | implemented |
| 8 | `FUN_1801f35f0` | 3×3 relaxation | implemented |

**All nine passes are now read.** What remains before `Erosion2` can be called `exact` is not
another kernel — it is the mapping from `param_1`'s context offsets to named parameters, so
the contribution formula in `FUN_1801f0c60` can be transcribed and checked rather than guessed.

That mapping is now the single blocking unknown for the whole erosion reconstruction.

## Reproduce

```
ghidra_decompile  0x1801f2470   # pass 4: call the apply
ghidra_decompile  0x1801f0c60   # the apply, with the deferred commit
ghidra_read_memory 0x180356160 8   # 2^-24, 2^-23 as float32
ghidra_read_memory 0x1803563bc 4   # 2^24
```

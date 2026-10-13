# Gaea's erosion relaxation kernel, recovered

Recovered from `Gaea.Native.dll` (Gaea 2.3.1, `x86:LE:64`, image base `0x180000000`) with
Ghidra. Nothing here was executed; every value is read from the shipped artifact.

This is the first body-level result for the priority the user named. It is written down
because the values are exact and the structure is readable, and because the previous gap
report recorded this as unrecoverable.

## How the erosion is driven — `FUN_1801f1350`

Called directly from `ParallelErosion_Erode`. It is the iteration driver, not the maths:

```c
_Thrd_hardware_concurrency();
iVar12 = (int)round(FUN_1801f0350(params[0x22]) * field);   // iteration count
params[0x20] = iVar12;
do {
    if (*(char*)(params + 0xd) != 0) break;                 // cancellation flag
    *(float*)(params + 0x11c) += 0.001f;                    // time-step accumulator
    *(int*)(params + 0x104) = iVar11;                       // current iteration

    parallel_for(...)                                       // pass 1
    // ping-pong: local_f0 <-> local_d8 swapped, local_e0 <-> local_c8 swapped
    parallel_for(...)                                       // pass 2
    if (fVar13 < *(float*)(params + 0xc4)) {                // conditional pass 3
        parallel_for(...)
        swap(params[0xc], params[0xd]);
    }
    uVar5 = (*(code*)params[1])();                          // user callback
    *(char*)(params + 0xd) = uVar5;
    iVar11++;
} while (iVar11 < iVar12);
```

Established:

- **Two ping-pong buffer pairs, swapped every iteration.** Erosion reads one buffer and
  writes the other. A single-buffer implementation cannot reproduce this.
- **Iteration count is `round(scale(param) × field)`**, stored at `params + 0x20`.
- **The work size is `(field_74 × field_e) >> 8`** — a right shift by 8, i.e. dividing by
  256, not a plain product.
- **Three parallel passes per iteration** — two unconditional, one gated on
  `fVar13 < params[0xc4]`. **This is independently corroborated** by the oneAPI SPIR-V
  metadata, which enumerates exactly three lambdas for `erode_level` and — because SYCL
  encodes the `item` dimensionality in the mangled type — shows that two are 1-D
  (`item<1, true>`) and one is 2-D (`item<2, true>`). See `gaea-spirv-kernels.md`. The two
  sources use entirely different mechanisms and agree.
- The parallel work uses **MSVC Concurrency Runtime** (`_Trace_ppl_function`,
  `FUN_1801f4xxx` chunk dispatchers). Each dispatcher's serial single-element path
  (`FUN_1801fXXXX(&ctx, 0)`) *is* the per-pixel body, which is how the kernel below was
  located.

## Particle initialisation — `FUN_1801f1ed0`

```c
uVar10 = *(int *)(params[1] + 0xb8) * 0x1b227 + pixelIndex;   // 0x1b227 = 111143, prime
uVar11 = (uVar10 != 0) ? uVar10 : 0xa2351342;                  // fallback when seed is 0
uVar11 ^= uVar11 << 13;  uVar11 ^= uVar11 >> 17;  uVar11 ^= uVar11 << 5;   // xorshift32
uVar10  = uVar11 ^ (uVar11 << 13);  ...                                     // second round
x = (float)(uVar11 * 0x2545f381) * 2.3283064e-10f * width;
y = (float)(uVar10 * 0x2545f381) * 2.3283064e-10f * height;
```

- **Seed** = `seed × 111143 + pixelIndex`, with `0xa2351342` substituted when the
  expression is zero. A per-pixel seed, not a shared one.
- **xorshift32** with the (13, 17, 5) shift triple, run twice.
- **Initial position is uniform in the grid**, via `uint → float` then `× 1/2³²` then
  `× width|height`. The `1/2³²` at `0x180356158` was read back and confirmed:
  bytes `00 00 80 2f` = `0x2f800000` = **2.3283064e-10**.
- Stride between particles is **`0x200` = 512 bytes**, not 80. An earlier round inferred
  80 bytes from `width × height × 0x50` in `ParallelErosion_Erode`; that field serves
  another buffer. **The 80-byte claim was wrong and is retracted here.**

## The relaxation kernel — `FUN_1801f35f0`

A serial single-element worker reached from pass 3. It is the first body-level kernel
recovered, and it reads as a 3×3 relaxation with a hydraulic correction.

### 1. Diagonal-weighted 3×3 average

```c
blur = ((h[y-1][x-1] + h[y-1][x+1] + h[y+1][x-1] + h[y+1][x+1]) * 0.7071f
        +  h[y-1][x]   + h[y][x-1]   + h[y][x+1]   + h[y+1][x]) * (1 / (4 + 4*0.7071));
```

**The centre cell is excluded**, which is what makes the caller's `centre - blur` usable as
a high-pass term.

`0x3f350481` = **0.707099974** = `float32(0.7071)` — a **round decimal**, not `1/√2`.
`0x3e15f641` = **0.146447197** = `float32(1 / (4 + 4*0.7071))` — the exact reciprocal of the
resulting weight sum.

The difference from the algebraic ideal is far too large to be rounding:

| | value | gap |
| --- | --- | --- |
| `K_DIAG` | 0.707099974 | vs `1/√2` = 0.707106781 → **6.8e-6**, ≈113 float32 ulps |
| `K_NORMALIZE` | 0.146447197 | vs `(2−√2)/4` = 0.146446609 → **5.9e-7**, ≈39 ulps |

An earlier version of this document claimed the closed forms `1/√2` and `(2−√2)/4`. **That
was wrong**, and it was caught by the test asserting those identities failing by 113 ulps.
The pair is nevertheless self-consistent: `4*(1 + K_DIAG)*K_NORMALIZE` = **1.0000000248**,
the residual being pure float32 rounding, and *that* identity is asserted instead.

The practical consequence: an edit that "corrects" 0.7071 to `1/sqrt(2)` would be wrong.
Gaea does not use the algebraically ideal weight here.

### 2. Drop accumulation over the eight neighbours

For each of the eight neighbours, when the centre is higher, `d = (centre − nb) / scale` is
accumulated and the running total is divided by itself at the end — i.e. the eight drops are
**normalised into a distribution**:

```c
drop = 0;
for each of 8 neighbours nb:  if (centre > nb) drop += (centre - nb) / scale;
if (minNeighbour < drop) drop = drop / drop;     // per the pcode's uv_1 = uv_1 / fVar30
```

The decompiler emits this as `auVar32._0_4_ / fVar30`, so the accumulated vector is scaled
by the reciprocal of the total.

### 3. Gradient magnitude (central differences, doubled span)

```c
gy = (h[y+1][x-1] + h[y+1][x] * 2 + h[y+1][x+1]) - (h[y-1][x-1] + centre * 2 + h[y-1][x+1]);
gx = (h[y][x+1] * 2 + h[y-1][x+1] + h[y+1][x+1]) - (h[y][x-1] * 2 + h[y-1][x-1] + h[y+1][x-1]);
grad = sqrt(gx*gx + gy*gy) ;   // then × 0.125
```

Note the "× 0.125" is applied at the call site via `DAT_1803561cc`, not inside this step.

### 4. The update

```c
K     = slope * slope * 0.9f;                       // 0x18035625c
term  = (grad * (1.0f - K) - K * drop) * slope;     // 0x180356274 = 1.0
clampA = max(0, term - scale * 0.3f);               // 0x1803561f0 = 0.3
clampB = max(0, term - scale);                      // 0x180356374 = 30.0 is clampB's weight
new    = max(drop,
             clampA * 0.7f                          // 0x180356234 = 0.7
           + clampB * 30.0f
           + (1 - slope) * 0.02f * params[0x134] * (centre - blur));   // 0x180356198 = 0.02
```

### 5. Two outputs, one of them accumulating

```c
v = new * outScale;
out1[y*stride + x]  = v;         // assigned
out2[y*stride + x] += v;         // accumulated
```

The `+=` matters: it is why Gaea's parallel passes do not simply overwrite, and it is the
same pattern the SPIR-V showed as `add_atomic`.

## Constants, with their exact 4-byte encodings

| Address | Word | Float | Role in the code |
| --- | --- | --- | --- |
| `0x180356238` | `0x3f350481` | **0.707099974** | diagonal weight (`1/√2`) |
| `0x1803561d0` | `0x3e15f641` | **0.146447197** | 3×3 normaliser (`1/(4+4/√2)`) |
| `0x1803561cc` | `0x3e000000` | 0.125 | gradient scale |
| `0x18035625c` | `0x3f666666` | **0.9** | slope² coefficient |
| `0x180356274` | `0x3f800000` | **1.0** | baseline in `(1 − K)` |
| `0x1803561f0` | `0x3e99999a` | **0.3** | clampA threshold |
| `0x180356234` | `0x3f333333` | **0.7** | clampA weight |
| `0x180356374` | `0x41f00000` | **30.0** | clampB weight |
| `0x180356198` | `0x3ca3d70a` | **0.02** | diffusion weight |
| `0x180356158` | `0x2f800000` | **2.3283064e-10** | `1/2³²`, particle-position normaliser |
| `0x18035617c` | `0x3a83126f` | **0.001** | time-step accumulator |
| `0x180356410` | `0xc97423fe` | **−1000000.0** | sentinel |
| `0x180356414` | `0xff800000` | **−Inf** | uninitialised sentinel |

## The per-level parameter curve — `FUN_1801f0350`

Called four times from the iteration driver to turn a level/iteration index into a scale.
This is the piece this build previously **invented**: `Erosion2` uses a hand-tuned linear
taper `weight = 0.35 + 0.65*(k/(L-1))`, which was a guess. Here is Gaea's actual curve.

```c
float curve(int level, ..., float thr, float rate, float expo, char flag) {
    float t = input;
    if (t < 1.0f) t = expf(t - 1.0f);                  // below 1: exponentiate first
    float r = floorf(t);                               // vroundss mode 1
    float frac = t - r;
    float u = (frac == 0.0f) ? 1.0f : frac;            // vblendvps: never zero

    float v = fmaxf(0.0f, ((float)level - (1.0f - u)) - thr);   // threshold gate
    float e = expf(-v * rate);                         // rate negated via an XOR of the sign bit
    float res = (e / rate + v) - 1.0f / rate;          // == (exp(-v*rate) - 1)/rate + v

    if (!(level > 0 || flag == 0)) u = 1.0f;
    return expf(res * logf(expo)) * u;                 // then a power scaling
}
```

Established:

- **`(exp(-v*rate) - 1)/rate + v` is a smooth exponential ramp** (a softplus-shaped curve).
  The `1/rate` terms cancel at `v = 0`, so the curve is anchored.
- **There is a hard threshold gate**: `v` is clamped at zero after subtracting `thr`, so the
  level contributes nothing until `level - (1 - frac) > thr`. The previous hand-tuned linear
  taper has no such gate.
- **`rate` is negated through an XOR of the sign bit** rather than a subtraction — a
  compiler idiom, but worth recording because it means the stored constant is positive and
  the sign comes from elsewhere.
- **`logf`/`expf` here are why `FUN_1801f24f0` imports `log2f`**, which was the first clue
  that pyramid depth and a log-scaled curve were in play.
- The interaction with `floor`/`frac` means the curve is **stepped per level**, not smooth
  across the whole range: the fractional part `u` acts as an interpolation factor and is
  forced to 1 at level ≤ 0.

What is still missing: `thr`, `rate` and `expo` are **arguments**, not literals. Mapping them
to `Duration`/`Downcutting`/`Shape`/… requires reading the four call sites in
`FUN_1801f1350` and the stores into the `params` struct, which has not been done.

## The driver's own constants, and the pass map

`ghidra_function_context` on `FUN_1801f1350` returns, in one call, every absolute data
reference inside it. Those are the values the *iteration driver* reads — a different set from
the 3×3 kernel's, taken from the same `.rdata` pool:

| Address | Bits | Value |
| --- | --- | --- |
| `0x180356210` | `0x3f000000` | 0.5 |
| `0x18035623c` | `0x3f400000` | 0.75 |
| `0x180356204` | `0x3ecccccd` | 0.4 |
| `0x180356220` | `0x3f19999a` | 0.6 |
| `0x180356320` | `0x40200000` | 2.5 |
| `0x1803562f8` | `0x40000000` | 2.0 |
| `0x180356354` | `0x41200000` | 10.0 |
| `0x180356274` | `0x3f800000` | 1.0 |
| `0x1803562a8` | `0x3f99999a` | 1.2 |
| `0x180356338` | `0x4059000000000000` | **100.0 as a double** |
| `0x18035617c` | `0x3a83126f` | 0.001 — the time-step accumulator, already seen incrementing |

The blend weights (0.5, 0.75, 0.4, 0.6) and scale factors (2.0, 2.5, 10.0, 100.0) are the
iteration/gain logic. **They are not the relaxation kernel's constants**, which are 0.7071,
0.146447, 0.125, 0.9, 0.3, 0.7, 30.0 and 0.02. Both stages read the same pool, so only the
referencing address identifies which read belongs to which stage — treating the pool as one
flat "erosion constants" set would conflate them.

The same call also gives the complete callee structure, and it is regular:

**Nine chunk dispatchers**, every one exactly 808 bytes — these are the `parallel_for`
wrappers, all shape-identical:

```
FUN_1801f4890  FUN_1801f4bc0  FUN_1801f4ef0  FUN_1801f5220  FUN_1801f5bb0
FUN_1801f5ee0  FUN_1801f6210  FUN_1801f6540  FUN_1801f6870
```

**Nine serial workers**, which is where the per-pixel arithmetic lives:

```
FUN_1801f1ed0 (546 B)   particle initialisation — xorshift32, already recovered
FUN_1801f2100 (677 B)   unrecovered
FUN_1801f23b0 (190 B)   pass 2 sub-pass A
FUN_1801f2470 (125 B)   pass 2 sub-pass B
FUN_1801f2ec0 (110 B)   pass 3 sub-pass A
FUN_1801f2f30 (1583 B)  unrecovered — the largest
FUN_1801f3560 (138 B)   pass 3 sub-pass B
FUN_1801f35f0 (1143 B)  3x3 relaxation — recovered
FUN_1801f43c0 (404 B)   unrecovered
```

plus `FUN_1801f0350` (233 B), the per-level parameter curve, already recovered.

So the remaining body-level work is bounded and enumerated: **four workers unnamed**
(`1f2100`, `1f2f30`, `1f43c0`, and the pairing of sub-passes A/B to their stages). The
dispatchers need no reading — they only slice the range.

Driver metrics from the same call: 586 instructions, 66 basic blocks, cyclomatic complexity
35, `codeMd5 cec8a15d5d4db8b4c105f43bf5195f2c`.

## Droplet seeding is weighted by height — `FUN_1801f2100` (677 bytes)

The other worker, and the finding that changed the most. Gaea does **not** seed droplets
uniformly:

```c
// stream 1 — position
uVar14 = seed * 0x1b227 + pixelIndex;      // 0x1b227 = 111143
r1     = xorshift32(uVar14);
x = (float)(r1 * 0x2545f381) * (1/2^32) * width;
y = (float)(r2 * 0x2545f381) * (1/2^32) * height;

// stream 2 — spawn test, with its OWN prime
uVar14 = seed * 0x1b253 + pixelIndex;      // 0x1b253 = 111251
r3     = xorshift32(uVar14);
if ((float)(r3 * 0x2545f381) * (1/2^32) < height[y][x]) {   // <-- accept
    n = atomic_increment(counter);
    memcpy(particles + n * 0x200, template, 0x200);
    index[n] = n;
}
```

- **Spawn probability equals the normalised height.** A droplet is placed at a uniformly
  random position and kept only when an independent random draw falls below the terrain
  height there. Seeding density therefore tracks elevation.
- **The two streams use different seed multipliers**, `111143` for position and `111251` for
  the accept test. They are not interchangeable: reusing one for both would correlate a
  droplet's start position with whether it survives, which is precisely the correlation the
  two-stream design exists to avoid.
- Both fall back to `0xa2351342` when the expression is zero, and both use the same
  xorshift32 with the (13, 17, 5) triple already seen in `FUN_1801f1ed0`.
- The particle stride is `0x200` = 512 bytes, copied in full from a stack template — the
  third independent confirmation of that stride.

### The budget trap

Rejection sampling accepts only a fraction of candidates, that fraction being the terrain's
mean normalised height. Feeding the same `droplets` count as before would silently erode with
a small fraction of the intended droplets and look like "the erosion got weaker". The
implementation therefore divides the candidate count by the mean height, keeping the
**accepted** count on target.

### Measured effect

Switching from uniform to height-weighted seeding, at the working parameters on the 128 grid:

| | peak D8 accumulation | longest flow path |
| --- | --- | --- |
| input | 83 | 22 |
| single-scale | 81 | 22 |
| multiscale, uniform seeding | 87 | 23 |
| **multiscale, height-weighted** | **90** | **26** |

Restoring Gaea's actual seeding made the model behave measurably more like Gaea: the longest
drainage path grew by three cells and the peak accumulation rose by three. This is the
largest single fidelity improvement of the reconstruction so far, and unlike the flow gate it
matched the expectation — droplets that start high run further and carve longer channels.

A two-sided isolation test pins it: the gated field's high/low erosion bias must exceed the
uniform seeder's (10.025 against 7.544, so removal is concentrated on high ground), and the
height-weighted run must drain at least as well.

## The flow-coupled pass — `FUN_1801f2f30` (1584 bytes)

The largest worker, and the one that matters most for fidelity: it is the relaxation **plus
a flow gate**. It runs in three stages.

### Stage A — flow-receiver selection

```c
cutAxial = centre - scale * 0.357736f;                    // DAT_1803561fc
cutDiag  = centre - scale * 0.357736f * 1.4142135f;       // DAT_1803562b4 = sqrt(2)

mask_k = (h_k < cut_k) ? 1.0f : 0.0f;
B4[i]  = max( B3[centre], max over k of (mask_k * B3[k]) );
```

- **The comparison direction is `<`**, i.e. the neighbour must be **below** the centre.
  Ghidra renders the instruction as `vcmpss_avx(h_k, cut, 1)` and predicate 1 is
  `_CMP_LT_OS`. Reading it as "greater than" would select uphill neighbours and invert the
  entire drainage, so this is worth stating explicitly rather than inferring from intent.
- **Two thresholds, differing by sqrt(2)**, for axial and diagonal neighbours. A diagonal
  step is longer, so it needs a larger drop to count as a direction of flow. The constant is
  `0x3fb504f3`, which is sqrt(2) exactly.
- **The cell's own `B3` value participates unconditionally**, which is what keeps a cell that
  is already a channel from being starved when every neighbour is higher.
- Buffer 4 is written; the value is a *selection* from buffer 3, never a new magnitude.

### Stage B — the same relaxation as `FUN_1801f35f0`

Identical arithmetic, including the `* DAT_1803563fc` (−1) on the blend term. This is what
caught the omitted negation in `kernels/relaxation.js`: seeing the same reference in a second
function made clear it was not an artefact of one decompilation.

### Stage C — output gated by flow

```c
out1[i]  = relaxed * scaleOut * flowWeight;    // flowWeight = Stage A's result
out2[i] += relaxed * scaleOut * flowWeight;    // the accumulating output
```

**The amount of material moved at a cell is multiplied by its Stage A flow weight.** This is
how Gaea couples erosion to drainage: a cell with no lower neighbour within the threshold has
a flow weight equal to its own `B3` value and moves material only in proportion to it, while
a cell feeding a real channel is scaled by that channel's accumulated value.

A solver that omits this stage erodes every cell independently and cannot produce
channel-forming behaviour — which is precisely why `Erosion2` stays labelled `model` even
though the relaxation arithmetic is now `exact`.

### Status: wired in

Both `gaeaFlowReceiverMax` and the gate are now connected to the solvers, not just available.
`applyFlowGate` in `kernels/erosion.js` runs after every `erodeLevel` call in
`hydraulicDropletMultiscale`, and once in the single-scale `hydraulicDroplet` so that the
pyramid comparison keeps measuring the pyramid rather than the gate.

**The `scale` argument is the largest assumption in this whole reconstruction.** In the
binary it is a height quantum in terrain units, and it sets the drop a neighbour must have to
count as a drainage direction. This solver works in metres, where relief runs to hundreds of
metres, so the binary's own scale does not transfer: passing `scale = 1` makes the cut
0.36 m, essentially every lower neighbour qualifies, the weight saturates everywhere and the
gate silently becomes an identity. The implementation therefore derives `scale` per level as
the **mean absolute per-cell drop**, making the threshold a fixed fraction of the terrain's
own roughness. That is a model choice, and it is flagged as such in the source.

Measured effect at the working parameters, on the 128 grid the comparison uses:

| | peak D8 accumulation | longest flow path |
| --- | --- | --- |
| input | 83 | 22 |
| single-scale, gated | 82 | 21 |
| multiscale, gated | **87** | **23** |
| multiscale, ungated (previous round) | 88 | 23 |

**The gate is mildly suppressive in this model rather than channel-concentrating**: it removes
a little erosion, dropping the multiscale peak by one, and the pyramid's advantage over both
the input and the single-scale solver is unchanged. That is reported as measured. The
expectation that gating would *sharpen* channels did not hold at these parameters, and it was
not tuned to make it hold.

Two tests pin the wiring rather than the outcome: the gated and ungated runs must differ, and
the gated run must erode no more than the ungated one. A gate whose threshold saturates would
pass neither.

### Constants added by this function

| Address | Bits | Value | Role |
| --- | --- | --- | --- |
| `0x1803561fc` | `0x3eb7290c` | **0.357736** | axial drop threshold scale |
| `0x1803562b4` | `0x3fb504f3` | **1.4142135** = √2 | diagonal threshold multiplier |
| `0x1803563fc` | `0xbf800000` | **−1.0** | blend term negation (both functions) |

`0.357736` has no obvious closed form. It is reported as measured, not as a guess: the
`0.7071` episode showed that a plausible-looking identity can be off by a hundred float32
ulps and still look right.

## What is NOT established, stated plainly

- **Which named parameter each constant is.** They are read from the flat `.rdata` pool, so
  the mapping from a constant to `Duration`/`Downcutting`/`Shape`/… requires reading the
  caller that stores into `params`, which has not been done.
- **Whether `FUN_1801f35f0` is thermal, hydraulic, or the shaping pass.** It is reached
  from pass 3 of the erosion driver, so it is part of erosion, but its role is inferred from
  its shape, not named.
- **The `Particle` layout.** Stride is 512 bytes; field offsets are not yet read.
- **`AdaptiveCpp.dll` and `HIP.dll` are untouched.** Nothing here may be assumed to carry
  over to them.
- `0x1803563fc` (−1.0): an earlier version of this document said it was **not referenced**
  and removed its role as speculation. **That was wrong.** The address *is* referenced by
  `FUN_1801f35f0`, at the very end of the blend expression, and looking again was forced by
  reading the sibling `FUN_1801f2f30`, which carries the same `* DAT_1803563fc`. The
  omission was also compiled into `kernels/relaxation.js`, where it was a real bug — now
  fixed and asserted.

## Reproduce

```
ghidra_open  D:\Gaea 2\Gaea.Native.dll
ghidra_decompile  0x18003cfe0     # ParallelErosion_Erode — allocator/dispatcher
ghidra_decompile  0x1801f24f0     # erosion worker, 1737 B, imports log2f + tanf
ghidra_decompile  0x1801f1350     # iteration driver, ping-pong buffers
ghidra_decompile  0x1801f1ed0     # particle init (xorshift32)
ghidra_decompile  0x1801f35f0     # 3x3 relaxation kernel
ghidra_read_memory 0x180356190 656  # the float constant pool decoded above
```

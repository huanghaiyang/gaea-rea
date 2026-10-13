# Gaea's erosion pipeline: the nine passes, in order

Recovered from the ordered `CALL` sequence inside `FUN_1801f1350`, the iteration driver that
`ParallelErosion_Erode` invokes. The order is not inferred from the code shape — it is the
literal order of the call instructions, each serial worker immediately followed by its
808-byte dispatcher.

## The sequence

| Pass | Worker | Dispatcher | What it does | Status |
| --- | --- | --- | --- | --- |
| 1 | `FUN_1801f1ed0` | `FUN_1801f4890` | particle position init: seed × 111143, xorshift32, uniform position | recovered |
| 2 | `FUN_1801f2100` | `FUN_1801f4bc0` | **spawn accept**: seed × 111251, accept when `rand < height` | recovered |
| 3 | `FUN_1801f23b0` | `FUN_1801f4ef0` | not yet read (190 B) | open |
| 4 | `FUN_1801f2470` | `FUN_1801f5220` | not yet read (125 B) | open |
| 5 | `FUN_1801f2ec0` | `FUN_1801f5bb0` | `flow = max(flow, min(1, 0.25 * raw))` | recovered |
| 6 | `FUN_1801f2f30` | `FUN_1801f5ee0` | flow-receiver select + relaxation + gate | recovered |
| 7 | `FUN_1801f3560` | `FUN_1801f6210` | `dst += src; src = 0` | recovered |
| 8 | `FUN_1801f35f0` | `FUN_1801f6540` | plain 3×3 relaxation | recovered |
| 9 | `FUN_1801f3560` | `FUN_1801f6870` | the same flush again | recovered |

Before the driver loop, four calls to `FUN_1801f0350` (the per-level parameter curve) and one
to `FUN_1801f43c0` (a `std::vector<Particle>` growth) run once.

## Why this supersedes the earlier reading

An earlier round recorded "three parallel passes per iteration — two unconditional, one
gated". That was derived from the driver's control flow, and the SPIR-V metadata's three
`erode_level` lambdas appeared to corroborate it. Both were partially right and both
under-described the pipeline: the driver executes **nine** dispatched stages per iteration,
and the three lambdas belong to one stage, not to the loop.

The discrepancy is explained by what the passes are: stages 1, 2 and 7–9 do not appear in the
SPIR-V in the same shape, because the particle-seeding stages are not device kernels in the
same sense. The SPIR-V lambda count was never evidence about the loop's arity, and reading it
that way was a mistake now corrected.

## Two objectives discovered while reading this

**`FUN_1801f2ec0` normalises into the same buffer the gate reads.** It is a `max`, so it can
only raise the flow buffer, and it saturates at 1. That ordering matters: pass 5 establishes
the flow strength, pass 6 consumes it. Normalising *after* the gate would silently halve its
input.

**`FUN_1801f3560` runs twice, and the `+=` is load-bearing.** Pass 7 flushes the accumulation
between the two relaxation stages; pass 9 flushes at the end. Its clear is what prevents
iteration *n* from folding iteration *n−1* in again, so a reimplementation that omits the
clear produces a monotonically growing field.

## Particle layout, partially pinned

`FUN_1801f43c0` is a container growth, not algorithm, but it default-constructs particles and
so reveals fields:

```c
memset(p, 0, 0x200);
*(float *)(p + 0x118) = 0xc97423fe;   // -1000000.0, the sentinel
*(uint64*)(p + 0x0f8) = 0;
*(uint64*)(p + 0x124) = 0;
*(uint32*)(p + 0x12c) = 0;
*(uint32*)(p + 0x140) = 0;
```

So `Particle` is 512 bytes (now confirmed three independent ways: the `>> 9` stride here, the
`0x200` stride in `FUN_1801f2100`, and the `+0x200` walk in the vector growth), and offsets
`0xf8`, `0x118`, `0x124`, `0x12c`, `0x140` are known. The growth policy is 1.5×.

## What is implemented versus mapped

Implemented and tested in `web/js/kernels/`:

- `gaeaBlur3x3`, `gaeaRelaxationPass` (pass 8)
- `gaeaFlowReceiverMax`, `applyFlowGate` (pass 6)
- `gaeaFlowNormalize` (pass 5)
- `gaeaFlushAccumulator` (passes 7 and 9)
- height-weighted seeding inside `erodeLevel` (pass 2)

Still open: passes 3 and 4, and the droplet transport/deposition arithmetic inside
`erodeLevel`, which remains this build's own model rather than a transcription. That is the
single largest remaining fidelity gap for `Erosion2`, and it is why the node stays labelled
`model` while five of its nine stages are now `exact`.

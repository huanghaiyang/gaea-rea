# The droplet step: `FUN_1801f0440`

This is the physics. Everything upstream — the pyramid, the seeding, the flow gate — prepares
for it, and everything downstream accumulates what it produces. It is reached from pass 3
(`FUN_1801f23b0`), which walks the live-particle list, calls this once per particle, and
compacts out the ones that died.

Nothing here was chosen. Every constant and every branch was read out of `Gaea.Native.dll`.

## Entry: cell-centred bilinear sampling

```c
uVar3 = *(uint64 *)(particle + 0x90);      // packed float2 position
x = (float)uVar3;  y = (float)(uVar3 >> 32);
iVar17 = (int)(x - 0.5);                   // DAT_180356210 = 0.5
iVar16 = (int)(y - 0.5);
```

The `- 0.5` is the cell-centre convention: a position of *n* lies at the centre of cell *n*,
so the integer part is `n - 0.5`. This is why `0.5` appears in the driver's constant set. The
test for "inside the grid" is `x < width - 1.5` and `y < height - 1.5` (`DAT_1803562c0` =
**1.5**), a margin slightly wider than the one cell bilinear sampling needs.

The height field is sampled bilinearly, and the gradient is formed from the same four corners:

```
gx = (h11 - h01) * fy + (h10 - h00) * (1 - fy)
gy = (h11 - h10) * fx + (h01 - h00) * (1 - fx)
```

## The direction rule — the most important correction

```c
mag   = sqrt(gx*gx + gy*gy);
if (mag > 0) {
    blend = (just deposited) ? 30.0 : 1.0;                 // DAT_180356374 = 30
    dirX  = 0.5 * prevDirX * blend                         // DAT_180356210 = 0.5
          + 0.25 * table[i].x                              // DAT_1803561ec = 0.25
          - gy / mag;
    dirY  = 0.5 * prevDirY * blend
          + 0.25 * table[i].y
          - gx / mag;
    m = sqrt(dirX*dirX + dirY*dirY);
    dirX /= m;  dirY /= m;
}
```

Three properties, each of which contradicts the model this build shipped before:

| | this build used | Gaea does |
| --- | --- | --- |
| downhill pull | `- grad * (1 - inertia)` | **`- grad / |grad|`** — the unit gradient |
| inertia | `prevDir * 0.05`, a fixed fraction | **`prevDir * 0.5 * (1 or 30)`** |
| jitter | a fresh random angle each step | **`0.25 *` a precomputed table entry** |

**The pull is normalised.** A raw-gradient pull lets a steep cell dominate in proportion to
its steepness; Gaea normalises first, so every cell deflects the droplet by the same amount
and only the *direction* of the deflection differs. A test asserts that scaling the gradient
by 1000× leaves the direction unchanged, which the old rule would fail.

**Inertia is all-or-nothing, and thirty times stronger right after a deposit.** There is no
fractional inertia anywhere in this function. Immediately after depositing, the previous
direction is weighted 30×, so the droplet keeps going rather than being turned by the local
slope — that is how a droplet that has started filling a hollow keeps filling it. A test
drives the two branches to *opposite* signs to show the blend changes which term dominates,
not merely its weight.

**A quarter of the direction is a table lookup.** `param_2[0x130]` is a per-particle cursor
advanced as `(cursor + 1) & mask`, indexing a table of unit vectors at `param_1 + 0x78` with
an 8-byte stride. This is the `create_random_directions` kernel visible in the SPIR-V
inventory. Because the table is precomputed and the cursor is per-particle, the jitter is
**deterministic and identical across parallel workers** — a per-step random draw could
neither reproduce it nor keep the parallel passes consistent.

*Uncertainty:* the decompiler routes the two gradient components into the two output lanes in
an order that depends on its own naming of the bilinear corners, and I could not settle which
is x and which is y. The components are otherwise symmetric, so this affects orientation
only, not magnitude. It is flagged rather than guessed.

## The transport loop

The body runs at most **11** steps (the literal `0xb`). Each step:

```c
store position  -> particle + 0x98 + step*8
store dirX      -> particle + step*4
particle[0x30 + step*4] = 0;              // per-step height delta, initialised
atomicAdd(visitBuffer[cell], 1.0f);       // param_4
atomicAdd_int(visitCount[cell], 1);       // param_7
x += dirX;  y += dirY;
particle[0x60 + step*4] = param_6[cell];  // something sampled per cell
```

Two atomics per step, against two different buffers, with `LOCK`-prefixed
compare-and-swap loops — the decompiler's rendering of `std::atomic<float>::fetch_add` and an
integer equivalent. Both buffers are shared across the parallel workers, which is why these
are atomics and not plain stores.

The **per-step height delta is recorded** into `particle + 0x30 + step*4`. This is the trace
the later passes fold into the terrain; the droplet does not write the height field itself.

## The erode/deposit decision

```c
if (hOld <= hNew) {                       // moving up: deposit
    particle[0x110]++;                    // consecutive-deposit counter
    local_114 = 1.0;
    particle[0x30 + step*4] = hNew - hOld;
    if (particle[0x110] < 5 && 2 < particle[0x10c] + step) {
        hOld = hNew;                      // keep going
    } else {
        particle[0x114] = 1;              // terminate: trapped or too early
        done = true;
    }
} else {                                  // moving down: erode
    local_114 = 0.0;                      // clears the deposit flag
    particle[0x30 + step*4] = 0;
    hOld = hNew;
}
```

- **A droplet travelling uphill has not failed — it deposits.** The counter at `+0x110` counts
  consecutive uphill steps.
- **It gives up after 5 consecutive deposits**, or if the step index is too small relative to
  a running total at `+0x10c`. Both conditions mark `+0x114 = 1`, which pass 3 reads as
  "finished" and which in turn sets `+0x115`, the dead flag.
- **A downhill step records a zero delta.** Erosion is not recorded here as a negative delta;
  it is left to a later stage. That is the opposite of a typical droplet model, where the
  erode branch is where the carve happens.
- The `local_114` value **persists across steps**: it is the "did the previous step deposit"
  flag that selects the 30× inertia, so the two subsystems are wired together.

## Particle layout, extended

| Offset | Type | Meaning |
| --- | --- | --- |
| `0x00` | float[?] | direction history, one float per step (`+ step*4`) |
| `0x30` | float[11] | per-step height delta (`+ step*4`) |
| `0x60` | float[?] | per-step value sampled from `param_6` |
| `0x90` | float2 | current position (packed x, y) |
| `0x98` | float2[?] | per-step position history (`+ step*8`) |
| `0x108` | int | steps taken this call |
| `0x10c` | int | running total of steps |
| `0x110` | int | consecutive deposits |
| `0x114` | byte | finished flag |
| `0x115` | byte | dead flag, read by pass 3 |
| `0x118` | float | a capacity-like value, sentinel-initialised to −1e6 |
| `0x11c`,`0x120`,`0x134`,`0x138`,`0x13c` | float | five fields written from the same clamped expression |
| `0x130` | uint | direction-table cursor |

The stride is 512 bytes. Fields `0x114` and `0x115` were confirmed by pass 3 reading them.

## The −1e6 sentinel is used as an "is initialised" test

`FUN_1801f43c0` default-initialises `particle[0x118]` to `0xc97423fe` = **−1000000.0**, and
this function compares against `DAT_18035640c` = `0xc97423f0`, a value **slightly below** that
sentinel. So `sentinel_bound < field` is false while the field still holds its default and
true once anything real has been written. The two constants differ only in the low bits of
the mantissa — deliberately, so that equality with the sentinel is not mistaken for a real
value.

## What is implemented versus still open

Implemented and tested (`web/tests/gaea-droplet-test.mjs`, 19 assertions):

- `gaeaDropletDirection` — the direction rule, including the 1-or-30 blend and the unit-gradient
  pull, with a test that pins each of the three corrections
- `gaeaDirectionTable` — the precomputed table, deterministic and reproducible from its seed

**Not yet wired into `erodeLevel`, and this is deliberate.** Replacing the transport loop means
replacing the capacity, deposition and termination rules together; substituting only the
direction rule would change the model in a way nothing can check. The remaining unknowns are
the five fields written at `0x11c`/`0x120`/`0x134`/`0x138`/`0x13c` from one clamped
expression, and what `param_6` holds. Until those are read, `Erosion2` stays labelled `model`.

## Reproduce

```
ghidra_decompile  0x1801f23b0   # pass 3: walk live particles, call the step, compact the dead
ghidra_decompile  0x1801f0440   # the step itself
ghidra_read_memory 0x18035640c 8   # the sentinel pair: 0xc97423f0, 0xc97423fe
ghidra_read_memory 0x1803562bc 8   # 1.45, and 1.5 = the border margin
```

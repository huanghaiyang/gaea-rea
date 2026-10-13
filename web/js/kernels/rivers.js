/**
 * rivers.js — the parts of Gaea's `Rivers` node that are exactly recoverable.
 *
 * STATUS: PARTIAL. This is not the Rivers algorithm; it is the two self-contained
 * sub-expressions the driver `FUN_1800454c0` computes before the real work starts, plus the
 * seeding rule. The algorithmic core is in `FUN_180044330` (1,533 B) and the eight unrolled
 * calls to `FUN_1800488f0` near the end of the driver, neither of which has been read.
 *
 * WHY THESE TWO ARE WORTH EXTRACTING ANYWAY
 * Both are exact, both are reusable, and one of them contradicts a form this build already
 * uses. That is more than a placeholder: it is verified behaviour.
 *
 * WHAT `Rivers` SHARES WITH THE OTHER NODES
 * `FUN_1800454c0` opens with the same twelve-assignment `.rdata` block copy that
 * `HydrologicalCorrection` performs (`_DAT_18044ea40` … `DAT_18044eaa4`), builds the same
 * `0xa8`-byte `LaplacianLevel` chain with `FUN_18003ed80` / `FUN_18003ee10`, and runs
 * `_vcomp_fork` once per level. That is now the **third** node confirmed to sit on the shared
 * Laplacian pyramid — erosion, hydrological correction, and rivers.
 */

/** `0x40800000` at `0x180356340` — the exponential ramp's rate. */
export const K_RIVERS_RAMP_RATE = 4;

/**
 * `0x40800000` at `0x180356340`, used as `1 / (expf(4) - 1)`. Kept separate because the
 * reciprocal is what the binary actually multiplies by.
 */
export const K_RIVERS_RAMP_DENOM = Math.exp(K_RIVERS_RAMP_RATE) - 1;

/** `0x3f600000` at `0x180356250` — the pyramid depth is `log2(size * 0.875)`. */
export const K_RIVERS_DEPTH_FACTOR = 0.875;

/** `0x38000000` at `0x180356170` — `1/32768`, the `rand()` normaliser (RAND_MAX is 32767). */
export const K_RAND_INV = 1 / 32768;

/** `0x3f8020c5` at `0x180356278` — the seeding rejection threshold's scale, 1.00099. */
export const K_RIVERS_SEED_THRESHOLD = 1.00099;

/**
 * The driver's parameter ramp:
 *
 *     p = (expf(p * 4.0) - 1) / (expf(4.0) - 1)
 *
 * A normalised exponential ramp on `[0, 1]`: exactly 0 at `p = 0`, exactly 1 at `p = 1`, and
 * convex in between — so it spends more of its output range near the low input end than a
 * linear map would.
 *
 * NOTE this is NOT the same curve as `FUN_1801f0350` (the erosion per-level curve), which is
 * `(exp(-v*rate) - 1)/rate + v` with an explicit threshold gate. The two are both exponential
 * ramps and neither substitutes for the other.
 *
 * @param {number} p input, expected in 0..1
 * @returns {number} the ramped value
 */
export function gaeaExpRamp(p) {
  const v = Number.isFinite(p) ? p : 0;
  return (Math.exp(v * K_RIVERS_RAMP_RATE) - 1) / K_RIVERS_RAMP_DENOM;
}

/**
 * Pyramid depth: `(int)log2(size * 0.875)`.
 *
 * The 0.875 factor is worth noting because the erosion and hydrological-correction drivers
 * derive their depth differently (from `log2f` of a ratio, not of a scaled size). Same
 * pyramid, three different depth rules — so a reimplementation that shares one depth formula
 * across all three nodes would be wrong for at least two of them.
 *
 * @param {number} size
 * @returns {number} the level count, at least 1
 */
export function gaeaRiversPyramidDepth(size) {
  const n = Number.isFinite(size) && size > 0 ? size : 1;
  return Math.max(1, Math.floor(Math.log2(n * K_RIVERS_DEPTH_FACTOR)));
}

/* ------------------------------------------ the per-seed stepper (FUN_1800430c0, native) */

/** `0x180356174` = 5e-05, in `2 * width * 5e-05 * riverScale`. */
export const K_RIVER_SCALE_QUANTUM = 5e-5;

/** `0x180356360` = 20.0 — subtracted from the sampled height, a river-level bias. */
export const K_RIVER_HEIGHT_BIAS = 20;

/** `0x1803561b0` = 0.04 — the cross-gradient steering coefficient. */
export const K_RIVER_STEER = 0.04;

/** `0x1803561e4` = 0.2 — weight on the per-step direction table. */
export const K_RIVER_TABLE_WEIGHT = 0.2;

/** `0x1803563b0` / `0x1803563ac` = 500 and 420 — the count-based termination test. */
export const K_RIVER_COUNT_HI = 500;
export const K_RIVER_COUNT_SCALE = 420;

/** The direction table has 32 entries, wrapped by `(idx + 1) & 0x1f`. */
export const RIVER_DIR_TABLE_SIZE = 32;

/**
 * The cross-gradient steering increment.
 *
 * Transcribed from the `0 <= vx*dx + vy*dy` branch of `FUN_1800430c0`:
 *
 *     step.x = (mag * vx * s + vx + vx * 0.2 * table[i].x) - gy * 0.04 * mag * vx * s
 *     step.y = (mag * vy * s + vy + vy * 0.2 * table[i].y) - gx * 0.04 * mag * vy * s
 *
 * where `s = 2 * width * 5e-05 * riverScale` and `mag` is the running maximum sample. The
 * structure is the erosion droplet's — bilinear direction sample, a precomputed jitter table,
 * a gradient term, then a renormalisation — but the accumulation target is a float2, so each
 * cell receives a WEAR and a DEPOSIT, not a single height delta.
 *
 * @param {object} o
 * @param {number} o.vx,o.vy        the normalised sampled direction
 * @param {number} o.gx,o.gy        the normalised sampled gradient
 * @param {number} o.mag            the running maximum sample
 * @param {number} o.scale          `2 * width * 5e-05 * riverScale`
 * @param {number} o.tableX,o.tableY the direction-table entry
 * @returns {{x: number, y: number}}
 */
export function gaeaRiverStep({ vx, vy, gx, gy, mag, scale, tableX, tableY }) {
  const s = Number.isFinite(scale) ? scale : 0;
  const m = Number.isFinite(mag) ? mag : 0;
  const w = K_RIVER_TABLE_WEIGHT;
  const x = (m * vx * s + vx + vx * w * tableX) - gy * K_RIVER_STEER * m * vx * s;
  const y = (m * vy * s + vy + vy * w * tableY) - gx * K_RIVER_STEER * m * vy * s;
  const len = Math.max(Math.abs(x), Math.abs(y));
  if (len === 0) return { x: 0, y: 0 };
  // The binary divides by `max(|x|,|y|)` — a Chebyshev normalisation, so the larger component
  // becomes exactly +-1. That is deliberately different from the erosion droplet, which
  // divides by the Euclidean length.
  return { x: x / len, y: y / len };
}

/**
 * Whether this step triggers the count-driven output call, and with what weight.
 *
 * The binary calls `FUN_180044bf0` when ANY of:
 *
 *     count <= 1.0                          the first visit to this cell
 *     (500 - riverScale * 420) < count      a saturation guard
 *     (dirIdx + 1) & 0x1f == 0              once per 32 steps
 *
 * and passes `min(1.0, count * 0.04 * riverScale)`. So a cell's output is driven by HOW MANY
 * seeds passed through it, saturated at 1 — a different mechanism from the erosion node's area
 * threshold, and the reason `level + 0` exists as a visit counter at all.
 *
 * @param {number} count
 * @param {number} riverScale
 * @param {number} dirIdx
 * @returns {{fire: boolean, weight: number}}
 */
export function gaeaRiverVisit(count, riverScale, dirIdx) {
  const c = Number.isFinite(count) ? count : 0;
  const rs = Number.isFinite(riverScale) ? riverScale : 0;
  const wrapped = ((Math.floor(dirIdx) + 1) & (RIVER_DIR_TABLE_SIZE - 1));
  const fire = c <= 1 || (K_RIVER_COUNT_HI - rs * K_RIVER_COUNT_SCALE) < c || wrapped === 0;
  const raw = c * K_RIVER_STEER * rs;
  return { fire, weight: Math.min(1, raw > 0 ? raw : 0) };
}

/** `scale = 2 * width * 5e-05 * riverScale`, a single expression in the binary. */
export function gaeaRiverStepScale(width, riverScale) {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const rs = Number.isFinite(riverScale) ? riverScale : 0;
  return 2 * w * K_RIVER_SCALE_QUANTUM * rs;
}

/** The loop bound: `while (2 * width >= steps)`. */
export function gaeaRiverStepLimit(width) {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  return 2 * w;
}

/* --------------------------------------- the vector-field smoother (FUN_1800488f0) */

/** `0x180356364` = 21 — the weight of a DIAGONAL neighbour. */
export const K_RIVER_W_DIAG = 21;

/** `0x180356378` = 31 — the weight of an AXIAL neighbour. */
export const K_RIVER_W_AXIAL = 31;

/** `0x180356380` = 48 — the weight of the CENTRE, before the caller's multiplier. */
export const K_RIVER_W_CENTRE = 48;

/**
 * The kernel's total weight when every neighbour and the centre are present and the caller's
 * centre multiplier is 1: `4*31 + 4*21 + 48 = 256`, a power of two.
 *
 * That the sum lands on 256 is not decoration. It means the weights are 8-bit fractions of a
 * fixed denominator — 31/256, 21/256, 48/256 — which is what makes the kernel cheap in integer
 * form and is why the numbers are unremarkable integers rather than rounder decimals.
 */
export const K_RIVER_W_TOTAL = 4 * K_RIVER_W_AXIAL + 4 * K_RIVER_W_DIAG + K_RIVER_W_CENTRE;

/**
 * A weighted 3x3 average of a float2 vector field, transcribed from `FUN_1800488f0`.
 *
 * A neighbour contributes ONLY when its mask is positive, so the field is smoothed along the
 * regions the mask marks rather than across their boundaries — the mask is what keeps a river's
 * direction from bleeding into terrain it does not flow through. The centre contributes
 * `centreWeight * 48`, which is the parameter the caller uses to trade smoothing against
 * sharpening: 1 gives the 256-total kernel, below 1 flattens toward the neighbourhood, above 1
 * preserves the cell's own value.
 *
 * The result is the accumulated vector divided by the accumulated WEIGHT, so it is a true
 * weighted mean rather than a weighted sum. When nothing contributed, the output is either the
 * input unchanged or zero, chosen by `preserveEmpty` — that branch is why the function needs a
 * flag rather than a single formula.
 *
 * The buffer swap at the end is part of the contract: the binary swaps its two pointers rather
 * than copying, so a caller that reuses the arrays sees them exchanged. This implementation
 * returns the new field instead, which is the equivalent without the aliasing.
 *
 * @param {object} o
 * @param {Float32Array} o.field   float2 per cell, length 2*size*size
 * @param {Float32Array} [o.mask]  one value per cell; a neighbour counts only when > 0
 * @param {number} o.size
 * @param {number} [o.centreWeight=1] multiplied by 48
 * @param {number} [o.emptyBlend=0] the factor applied when the cell's own mask is 0
 * @param {boolean} [o.preserveEmpty=false] keep the input where nothing contributed
 * @returns {Float32Array} the smoothed float2 field
 */
export function gaeaRiverSmooth({ field, mask, size, centreWeight = 1, emptyBlend = 0, preserveEmpty = false }) {
  const n = size * size;
  const out = new Float32Array(n * 2);
  const cw = Number.isFinite(centreWeight) ? centreWeight : 1;
  const centre = cw * K_RIVER_W_CENTRE;

  for (let y = 0; y < size; y++) {
    const yPrev = y > 0 ? y - 1 : 0;
    const yNext = y + 1 < size ? y + 1 : size - 1;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (mask && !(mask[i] > 0)) {
        // The binary's outer guard is `if (useMask || mask[i] > 0)`. A cell that fails it takes
        // the else branch, which is `param_6 ? 0 : in[i]` — the SAME preserve flag, not the
        // blend. An earlier version applied `emptyBlend` here, which silently zeroed the
        // preserve case and made the flag do nothing.
        out[i * 2] = preserveEmpty ? field[i * 2] : 0;
        out[i * 2 + 1] = preserveEmpty ? field[i * 2 + 1] : 0;
        continue;
      }
      const xPrev = x > 0 ? x - 1 : 0;
      const xNext = x + 1 < size ? x + 1 : size - 1;

      let w = 0;
      let ax = 0;
      let ay = 0;
      const add = (j, weight) => {
        if (mask && !(mask[j] > 0)) return;
        w += weight;
        ax += weight * field[j * 2];
        ay += weight * field[j * 2 + 1];
      };

      // The four diagonals use the DIAGONAL weight, the four axials the AXIAL weight, and the
      // centre its own. Axial outweighs diagonal, which is the Gaussian-like ordering.
      add(yPrev * size + xPrev, K_RIVER_W_DIAG);
      add(yPrev * size + x, K_RIVER_W_AXIAL);
      add(yPrev * size + xNext, K_RIVER_W_DIAG);
      add(y * size + xPrev, K_RIVER_W_AXIAL);
      add(i, centre);
      add(y * size + xNext, K_RIVER_W_AXIAL);
      add(yNext * size + xPrev, K_RIVER_W_DIAG);
      add(yNext * size + x, K_RIVER_W_AXIAL);
      add(yNext * size + xNext, K_RIVER_W_DIAG);

      if (!(w > 0)) {
        out[i * 2] = preserveEmpty ? field[i * 2] : 0;
        out[i * 2 + 1] = preserveEmpty ? field[i * 2 + 1] : 0;
        continue;
      }
      // The blend is 1 where the cell's own mask is set, and the caller's empty blend where it
      // is not — the cell can be smoothed at the boundary while still being attenuated.
      const ownMask = !mask || mask[i] > 0;
      const blend = ownMask ? 1 : emptyBlend;
      out[i * 2] = (ax / w) * blend;
      out[i * 2 + 1] = (ay / w) * blend;
    }
  }
  return out;
}

/* ------------------------------------------------- the pit fill (FUN_180041600, native) */

/**
 * `0x18035626c` read as a FLOAT — 0.9999899864196777.
 *
 * THE OPERAND-WIDTH TRAP, and why it is written down here
 * The same address holds `0.0` when read as a 4-byte float from its low half and `0.875` when
 * read as an 8-byte double, because the doubly-used constant at `0x180356250` shares its bytes.
 * Reading `0x18035626c` with a 4-byte `ghidra_read_memory` gives the float below and is correct
 * HERE because the instruction is `VMULSS`, but the neighbouring depth factor at `0x180356250`
 * is consumed by a `VMULSD` and only reads as 0.875 at 8 bytes. Checking the instruction's
 * operand width is what distinguishes the two; assuming either width blindly produces a
 * plausible constant that is wrong.
 */
export const K_RIVER_PIT_FILL = 0.99999;

/**
 * One pit-fill pass, transcribed from `FUN_180041600`.
 *
 *     h    = field[y][x]
 *     minN = min over the EIGHT neighbours of field
 *     if (h < minN) field[y][x] = (minN - h) * 0.99999 + h
 *
 * The centre is excluded from the neighbourhood — the binary reads all eight surrounding cells
 * and never the centre itself. The factor is just under 1, so a filled cell approaches the
 * minimum neighbour without ever reaching it; that is deliberate rather than a rounding
 * artefact, and a reimplementation using exactly 1.0 would saturate.
 *
 * `h < minN` is a STRICT test: a cell equal to its lowest neighbour is left alone, so a flat
 * region is untouched no matter how many passes run over it.
 *
 * WHAT THIS IS FOR
 * It is the river stepper's only sub-call, invoked once per step at the droplet's cell. Run
 * along a path it removes the single-cell depressions that would otherwise trap the direction
 * field, which is why it exists as a separate helper rather than an inline max.
 *
 * @param {Float32Array} field
 * @param {number} size
 * @param {number} x
 * @param {number} y
 * @returns {number} the cell's value after the pass
 */
export function gaeaFillPit(field, size, x, y) {
  const cx = x | 0;
  const cy = y | 0;
  if (cx < 0 || cy < 0 || cx >= size || cy >= size) return 0;
  const i = cy * size + cx;
  const h = field[i];
  let minN = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const v = field[ny * size + nx];
      if (v < minN) minN = v;
    }
  }
  if (!Number.isFinite(minN)) return h;
  if (h < minN) field[i] = (minN - h) * K_RIVER_PIT_FILL + h;
  return field[i];
}

/* -------------------------------------------- the seed stepper (FUN_180044330, partial) */


/**
 * `0x1803562b8` read as a DOUBLE — 0.1. The seed stepper maps a normalised position onto cell
 * coordinates as `(dim - 0.1) * position`, so the last tenth of a cell is never reached.
 * Gaea reads it as a double, not a float, which is why the byte sequence appears mid-float.
 */
export const K_RIVERS_CELL_MARGIN = 0.1;

/** The 512 the step budget quantises the grid width with. */
export const K_RIVERS_WIDTH_QUANTUM = 512;

/** `0x457a0000` at `0x1803563b8` — the river scale is stored pre-multiplied by 4000. */
export const K_RIVERS_SCALE = 4000;

/**
 * Map a normalised seed position to a cell coordinate, exactly as the stepper does.
 *
 *     x = (int)((width  - 0.1) * px)
 *     y = (int)((height - 0.1) * py)
 *
 * with the result clamped to `dim - 1`. The clamp is in the binary and is not cosmetic: a
 * position of exactly 1.0 would otherwise index one cell past the end.
 *
 * @param {number} dim
 * @param {number} pos normalised, expected in [0, 1)
 * @returns {number} a valid cell index
 */
export function gaeaSeedToCell(dim, pos) {
  const d = Number.isFinite(dim) && dim > 0 ? dim : 1;
  const p = Number.isFinite(pos) ? pos : 0;
  const v = Math.trunc((d - K_RIVERS_CELL_MARGIN) * p);
  return v < 0 ? 0 : v > d - 1 ? d - 1 : v;
}

/**
 * The step budget: how many seed-steps one level performs.
 *
 *     budget = (int)( max(1, (floor(width / 512) * RiverScale / divisor)) * seedCount )
 *
 * `floor(width / 512)` is written in the binary as `(w + (w >> 31 & 0x1ff)) >> 9`, the
 * standard signed round-toward-zero division by 512.
 *
 * The `max(1, ...)` floor guarantees every level advances at least one step per seed, so a
 * small grid still produces a river rather than nothing.
 *
 * @param {object} o
 * @param {number} o.width
 * @param {number} o.riverScale
 * @param {number} o.divisor      the context's `+ 0xbc` value
 * @param {number} o.seedCount
 * @returns {number}
 */
export function gaeaRiversStepBudget({ width, riverScale, divisor, seedCount }) {
  const w = Number.isFinite(width) && width > 0 ? Math.floor(width) : 1;
  const rs = Number.isFinite(riverScale) ? riverScale : 0;
  const dv = Number.isFinite(divisor) && divisor !== 0 ? divisor : 1;
  const sc = Number.isFinite(seedCount) && seedCount > 0 ? seedCount : 0;
  const perSeed = Math.max(1, (Math.floor(w / K_RIVERS_WIDTH_QUANTUM) * rs) / dv);
  return Math.trunc(perSeed * sc);
}

/**
 * How many post-processing passes run, as a function of the iteration index.
 *
 * The binary gates them on `param_1 + 0x22c`:
 *
 *     always        two buffer operations
 *     if (1 < it)   two more
 *     if (2 < it)   two more
 *
 * so the early iterations do less work. This is a real dependence, not a scheduling artefact:
 * a fixed pass count would over-process the early iterations.
 *
 * @param {number} iteration
 * @returns {number} 2, 4 or 6
 */
export function gaeaRiversPostPasses(iteration) {
  const it = Number.isFinite(iteration) ? iteration : 0;
  if (it > 2) return 6;
  if (it > 1) return 4;
  return 2;
}

/**
 * The seeding rule: a uniformly random position, kept only when a second random draw falls
 * below a per-cell density mask.
 *
 *     x = rand() / 32768
 *     y = rand() / 32768
 *     if (mask == null || rand() / 32768 < 1.00099 * mask[cell]) keep
 *
 * This is the same family as Erosion2's height-weighted seeding — a normalised random
 * position plus a rejection test against a per-cell field — with two differences worth
 * recording: the field is an explicit density MASK rather than the height, and the threshold
 * carries a slight over-unity scale (1.00099) so that a mask of 1 accepts rather than
 * borderline-rejects.
 *
 * Gaea uses the C runtime `srand`/`rand` here, not the xorshift32 the particle initialiser
 * uses. Reproducing Gaea's exact stream would mean reproducing the MSVC `rand` generator,
 * which is why the `rng` argument is injected rather than hard-coded.
 *
 * @param {object} o
 * @param {number} o.count      the number of candidates to draw
 * @param {number} o.size
 * @param {Float32Array} [o.mask] per-cell density, one value per cell
 * @param {() => number} o.rand   returns a value in [0, 1)
 * @returns {{x: Float32Array, y: Float32Array, count: number}} normalised positions in 0..1
 */
export function gaeaRiversSeeds({ count, size, mask, rand }) {
  const n = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  let kept = 0;
  for (let i = 0; i < n; i++) {
    const x = rand();
    const y = rand();
    if (mask) {
      const cx = Math.min(size - 1, Math.max(0, Math.floor(x * size)));
      const cy = Math.min(size - 1, Math.max(0, Math.floor(y * size)));
      const d = mask[cy * size + cx];
      if (!(rand() < K_RIVERS_SEED_THRESHOLD * (Number.isFinite(d) ? d : 0))) continue;
    }
    xs[kept] = x;
    ys[kept] = y;
    kept++;
  }
  return { x: xs.subarray(0, kept), y: ys.subarray(0, kept), count: kept };
}

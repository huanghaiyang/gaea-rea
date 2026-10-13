/**
 * relaxation.js — Gaea's 3x3 relaxation kernel, transcribed from the shipped binary.
 *
 * SOURCE OF EVERY NUMBER HERE
 * `Gaea.Native.dll` (Gaea 2.3.1), function `FUN_1801f35f0`, reached from pass 3 of the
 * erosion driver `FUN_1801f1350`, itself called by the export `ParallelErosion_Erode`.
 * The constants were read out of the image's read-only data at the addresses the
 * decompilation references, and decoded as little-endian float32. See
 * docs/gaea-erosion-kernel-recovered.md for the full evidence trail.
 *
 * WHY THE CONSTANTS ARE EXPORTED
 * The two weights are NOT the mathematical ideal, and that matters. Read back from the
 * image and checked against candidate formulas:
 *
 *   diagonal weight  0.707099974  = float32(0.7071)            <- a round DECIMAL
 *   normaliser       0.146447197  = float32(1 / (4 + 4*0.7071))
 *
 * 0.7071 is a four-decimal approximation of 1/sqrt(2) = 0.70710678, and it is off by
 * 6.8e-6 — about 113 float32 ulps, far too large to be rounding. The normaliser is then
 * the exact reciprocal of the resulting weight sum, not (2 - sqrt(2))/4, which differs in
 * the eighth decimal place. The pair is consistent: 4*(1 + K_DIAG)*K_NORMALIZE comes to
 * 1.0000000248, the residual being pure float32 rounding, and that identity is asserted in
 * tests/gaea-relaxation-test.mjs.
 *
 * So a future edit that "corrects" 0.7071 to 1/sqrt(2) would be wrong: Gaea does not use
 * the algebraically ideal value here.
 *
 * FIDELITY: `partial`
 * The arithmetic is transcribed exactly. The **parameter mapping is not**: these constants
 * live in a flat pool and the code that stores node parameters into the `params` struct has
 * not been read, so which node parameter each one belongs to is unknown. The kernel is
 * therefore offered as a building block, not as a drop-in replacement for Erosion2, and
 * `Erosion2` does not use it yet.
 */

/* ------------------------------------------------------------------ constants */

/** `0x3f350481` at `0x180356238` — weight on the four diagonal neighbours. `0.7071`, not 1/sqrt(2). */
export const K_DIAG = 0.7071;

/**
 * `0x3e15f641` at `0x1803561d0` — `1 / (4 + 4*K_DIAG)`.
 *
 * Wrapped in `Math.fround` because the image stores a float32 and the expression is
 * evaluated in float32 there. Computing it in JS doubles instead would land one ulp away
 * (0.14644719114287388 versus the stored 0.14644719660282135), so the exported constant
 * would not be the byte sequence actually present in the binary.
 */
export const K_NORMALIZE = Math.fround(1 / (4 + 4 * K_DIAG));

/** `0x3e000000` at `0x1803561cc` — gradient is scaled by this at the call site. */
export const K_GRAD_SCALE = 0.125;

/** `0x3f666666` at `0x18035625c` — slope term is `slope*slope*K_SLOPE2`. */
export const K_SLOPE2 = 0.9;

/** `0x3f800000` at `0x180356274` — the baseline in `(1 - K)`. */
export const K_ONE = 1.0;

/** `0x3e99999a` at `0x1803561f0` — threshold subtracted for the narrower clamp. */
export const K_CLAMP_A_THRESHOLD = 0.3;

/** `0x3f333333` at `0x180356234` — weight on the narrower clamp. */
export const K_CLAMP_A_WEIGHT = 0.7;

/** `0x41f00000` at `0x180356374` — weight on the wider clamp. */
export const K_CLAMP_B_WEIGHT = 30.0;

/** `0x3ca3d70a` at `0x180356198` — weight on the `(centre - blur)` diffusion term. */
export const K_DIFFUSION = 0.02;

/**
 * `0xbf800000` at `0x1803563fc` — **-1**, applied to the whole blend expression.
 *
 * The blend term is SUBTRACTED, not added. An earlier version of this file omitted it
 * because the address had not been decoded and was assumed unused; re-reading the sibling
 * function `FUN_1801f2f30` showed the same `* DAT_1803563fc` there, which forced a second
 * look. Both functions negate the term, so the omission was a real bug in this kernel.
 */
export const K_BLEND_SIGN = -1.0;

/** `0x3eb7290c` at `0x1803561fc` — neighbour threshold scale, measured rather than guessed. */
export const K_FLOW_THRESHOLD = 0.357736;

/**
 * `0x3fb504f3` at `0x1803562b4` — the diagonal neighbours' threshold is this much larger.
 * It is sqrt(2), matching the sqrt(2) implied by the 3x3 kernel's normaliser.
 */
export const K_DIAG_THRESHOLD_SCALE = 1.4142135;

/* --------------------------------------------------------------- the kernel */

/**
 * The diagonal-weighted 3x3 average, exactly as `FUN_1801f35f0` computes it.
 *
 *   blur = ((diagonals) * K_DIAG + axials) * K_NORMALIZE
 *
 * NOTE: the CENTRE CELL IS EXCLUDED. The eight neighbours are summed and the centre's own
 * value never enters. That is not an oversight — the caller uses `centre - blur` as a
 * high-pass term, which only works if the blur is the surrounding average. It also means
 * the blur of an isolated impulse is zero AT the impulse.
 *
 * @param {Float32Array} h height grid, row-major, length size*size
 * @param {number} size
 * @param {number} x
 * @param {number} y
 * @returns {number} the weighted average of the eight neighbours, clamped at the border
 */
export function gaeaBlur3x3(h, size, x, y) {
  const xm = x > 0 ? x - 1 : 0;
  const xp = x + 1 < size ? x + 1 : size - 1;
  const ym = y > 0 ? y - 1 : 0;
  const yp = y + 1 < size ? y + 1 : size - 1;
  const r0 = ym * size;
  const r1 = y * size;
  const r2 = yp * size;

  const tl = h[r0 + xm];
  const tc = h[r0 + x];
  const tr = h[r0 + xp];
  const ml = h[r1 + xm];
  const mr = h[r1 + xp];
  const bl = h[r2 + xm];
  const bc = h[r2 + x];
  const br = h[r2 + xp];

  const diagonals = tl + tr + bl + br;
  const axials = tc + ml + mr + bc;
  return (diagonals * K_DIAG + axials) * K_NORMALIZE;
}

/**
 * One relaxation pass over the whole grid.
 *
 * Transcribed from `FUN_1801f35f0`. The structure is:
 *
 *   1. blur the 3x3 neighbourhood (gaeaBlur3x3)
 *   2. accumulate the eight drops `(centre - neighbour) / scale` where the centre is
 *      higher, then divide the accumulator by the total, i.e. normalise the drops into a
 *      distribution
 *   3. take the gradient magnitude by central differences
 *   4. combine the two clamps and the diffusion correction into the new value
 *   5. write one output and ACCUMULATE the second
 *
 * The `+=` on the second output is not incidental: it is why Gaea's parallel passes cannot
 * simply overwrite each other, and it matches the `add_atomic` kernels visible in the
 * oneAPI SPIR-V.
 *
 * @param {object} o
 * @param {Float32Array} o.height  input field, metres or normalised, but consistent with `scale`
 * @param {number} o.size
 * @param {Float32Array} [o.out]   assigned output; allocated when omitted
 * @param {Float32Array} [o.accum] accumulated output; allocated when omitted
 * @param {number} [o.scale=1]     the divisor the binary takes from `params`
 * @param {number} [o.slope=1]     the `slope` value the binary reads from `params + 0x134`
 * @returns {{out: Float32Array, accum: Float32Array}}
 */
export function gaeaRelaxationPass({ height, size, out, accum, scale = 1, slope = 1 }) {
  const dst = out && out.length === size * size ? out : new Float32Array(size * size);
  const acc = accum && accum.length === size * size ? accum : new Float32Array(size * size);

  // The eight neighbours, in the order the binary visits them.
  const NX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const NY = [-1, -1, -1, 0, 0, 1, 1, 1];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const centre = height[i];

      // --- 2. drop accumulation, normalised at the end ---------------------
      // The binary keeps one packed accumulator whose lane 0 is
      //   -sum(d_k * (centre - nb_k))    with d_k = (centre - nb_k) / scale
      // and divides it by `sum(d_k)`. The 1/scale cancels, leaving
      //   normalizedDrop = -sum(q_k^2) / sum(q_k)     with q_k = centre - nb_k
      // i.e. the drop-magnitude-weighted mean drop, negated. An earlier version of this
      // function collapsed this to `drop / drop`, which is identically 1 and threw the
      // term away.
      let sumQ = 0;
      let sumQ2 = 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + NX[k];
        const ny = y + NY[k];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const q = centre - height[ny * size + nx];
        if (q > 0) { sumQ += q; sumQ2 += q * q; }
      }
      const normalizedDrop = sumQ > 0 ? -sumQ2 / sumQ : 0;

      // --- 3. gradient magnitude ------------------------------------------
      // The binary doubles each ROW's own centre for dy and each COLUMN's own centre for
      // dx, then scales by K_GRAD_SCALE inside the same expression:
      //   gy = (2*h[y+1][x] + h[y+1][xm] + h[y+1][xp]) - (h[ym][xm] + 2*h[ym][x] + h[ym][xp])
      //   gx = (2*h[y][xp] + h[ym][xp] + h[yp][xp]) - (2*h[y][xm] + h[ym][xm] + h[yp][xm])
      // Writing `centre * 2` on both sides instead would cancel and drop the middle term
      // entirely, which is what an earlier version of this function did.
      const xm = x > 0 ? x - 1 : 0;
      const xp = x + 1 < size ? x + 1 : size - 1;
      const ym = y > 0 ? y - 1 : 0;
      const yp = y + 1 < size ? y + 1 : size - 1;
      const r0 = ym * size;
      const r1 = y * size;
      const r2 = yp * size;

      const gy = (h(r2, x) * 2 + h(r2, xm) + h(r2, xp))
               - (h(r0, xm) + h(r0, x) * 2 + h(r0, xp));
      const gx = (h(r1, xp) * 2 + h(r0, xp) + h(r2, xp))
               - (h(r1, xm) * 2 + h(r0, xm) + h(r2, xm));
      const grad = Math.sqrt(gx * gx + gy * gy) * K_GRAD_SCALE;

      // --- 4. the update ---------------------------------------------------
      const blur = gaeaBlur3x3(height, size, x, y);
      const k = slope * slope * K_SLOPE2;
      const term = (grad * (K_ONE - k) - k * normalizedDrop) * slope;

      const clampA = Math.max(0, term - scale * K_CLAMP_A_THRESHOLD);
      const clampB = Math.max(0, term - scale);

      const v = Math.max(
        normalizedDrop,
        (clampA * K_CLAMP_A_WEIGHT
          + clampB * K_CLAMP_B_WEIGHT
          + (K_ONE - slope) * K_DIFFUSION * slope * (centre - blur)) * K_BLEND_SIGN,
      );

      // --- 5. assign one, accumulate the other -----------------------------
      dst[i] = v;
      acc[i] += v;
    }
  }

  return { out: dst, accum: acc };

  /** Row-major fetch through a precomputed row offset, matching the binary's indexing. */
  function h(rowOffset, col) {
    return height[rowOffset + col];
  }
}

/**
 * The flow-receiver stage from `FUN_1801f2f30` — the first half of that function.
 *
 * For each cell, take the largest value from a second buffer among the neighbours that lie
 * sufficiently BELOW it, and also consider the cell's own value unconditionally:
 *
 *     cut_axial = centre - scale * K_FLOW_THRESHOLD
 *     cut_diag  = centre - scale * K_FLOW_THRESHOLD * sqrt(2)
 *     out[i]    = max( flow[i],  max over neighbours k of ( h_k < cut_k ? flow_k : 0 ) )
 *
 * The comparison direction matters and is easy to invert. Ghidra renders the instruction as
 * `vcmpss_avx(h_k, cut, 1)`, and predicate 1 is `_CMP_LT_OS`, so the mask is set when the
 * neighbour is BELOW the cut — that is, when there is a real drop toward it. Reading it as
 * "greater than" would select uphill neighbours and invert the whole drainage.
 *
 * Diagonal neighbours get the sqrt(2)-larger threshold, matching the sqrt(2) that appears in
 * the 3x3 kernel's weighting: a diagonal step is longer, so it needs a larger drop to count.
 *
 * WHY THIS MATTERS FOR FIDELITY
 * `FUN_1801f2f30` multiplies its relaxation result by this stage's output, so the amount of
 * material moved at a cell is gated by whether a drainage path exists out of it. A solver
 * that omits this stage erodes every cell independently and cannot reproduce Gaea's
 * channel-forming behaviour, which is exactly why `Erosion2` remains labelled `model`.
 *
 * @param {object} o
 * @param {Float32Array} o.height  the height field the drop test is made against
 * @param {Float32Array} o.flow    the buffer whose masked maximum is taken
 * @param {number} o.size
 * @param {Float32Array} [o.out]
 * @param {number} [o.scale=1]
 * @returns {Float32Array} the per-cell flow weight, one value per cell
 */
export function gaeaFlowReceiverMax({ height, flow, size, out, scale = 1 }) {
  const dst = out && out.length === size * size ? out : new Float32Array(size * size);
  const axialCut = scale * K_FLOW_THRESHOLD;
  const diagCut = axialCut * K_DIAG_THRESHOLD_SCALE;

  // (dx, dy, diagonal?) in the order the binary evaluates them.
  const N = [
    [1, 1, 1], [0, 1, 0], [-1, 1, 1], [1, 0, 0],
    [-1, 0, 0], [1, -1, 1], [0, -1, 0], [-1, -1, 1],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const centre = height[i];
      let acc = 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + N[k][0];
        const ny = y + N[k][1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = ny * size + nx;
        const cut = centre - (N[k][2] ? diagCut : axialCut);
        if (height[j] < cut) {
          const f = flow[j];
          if (f > acc) acc = f;
        }
      }
      // The cell's own value participates unconditionally, which is what keeps a cell that
      // is already a channel from being starved when all its neighbours are higher.
      if (flow[i] > acc) acc = flow[i];
      dst[i] = acc;
    }
  }
  return dst;
}

/* ------------------------------- deferred last-writer apply (FUN_1801f0c60, pass 4) */

/**
 * `0x4b800000` at `0x1803563bc` = 2^24, and `0x33800000` at `0x180356160` = 2^-24. They are
 * exact reciprocals, which is the point: contributions are accumulated as integers and read
 * back with no rounding error beyond the initial conversion.
 *
 * WHY INTEGER ATOMICS AT ALL
 * Parallel droplets all want to add to the same cell. A float atomic add is not associative,
 * so the result would depend on the order the workers happened to run in — the same seed
 * could produce a different terrain on a different machine. Gaea sidesteps this by scaling
 * each contribution into a 24-bit fixed-point integer, adding those, and dividing once at the
 * end. Integer addition IS associative, so the sum is order-independent.
 */
export const K_FIXED_SCALE = 16777216;      // 2^24
export const K_FIXED_INV = 5.9604644775390625e-8;   // 2^-24, exact

/** Convert a contribution to the fixed-point integer Gaea's atomics carry. */
export function toFixed(v) {
  return Math.trunc(v * K_FIXED_SCALE);
}

/** Convert an accumulated fixed-point integer back, and average over the contributor count. */
export function fromFixed(sum, count) {
  if (!(count > 0)) return 0;
  return (sum * K_FIXED_INV) / count;
}

/**
 * The deferred apply from `FUN_1801f0c60`.
 *
 * The binary does not write the terrain as each droplet runs. Instead every droplet adds its
 * contribution to two shared buffers and decrements a third; the droplet that takes the third
 * buffer's countdown to zero is the LAST one to finish for that cell, and only it commits:
 *
 *     sumBuf[cell]  += (int)(amount * 2^24)     atomic, integer
 *     visitBuf[cell] += 1                       atomic, integer
 *     remaining      = startBuf[cell] -= 1      atomic, integer
 *     if (remaining == 1) {                     this droplet was last
 *         height[cell] += (sumBuf * 2^-24) / visitBuf;
 *         sumBuf = 0;  visitBuf = 0;            reset for the next iteration
 *     }
 *
 * Two consequences worth stating, because both are easy to lose in a reimplementation:
 *
 * 1. **The committed value is an AVERAGE** over the droplets that touched the cell, not a
 *    sum. A solver that adds each droplet's contribution directly erodes proportionally to
 *    how many droplets visited, which is a different terrain by a large factor.
 * 2. **The result does not depend on droplet order**, because the write happens only once,
 *    by whichever droplet finishes last, from an integer sum. That is what makes the parallel
 *    passes reproducible.
 *
 * @param {object} o
 * @param {Float32Array} o.height      terrain, modified in place
 * @param {number[]} o.sumFixed        accumulated fixed-point contributions per cell
 * @param {number[]} o.visitCount      droplets that have added a contribution per cell
 * @param {number[]} o.startCount      droplets that started at the cell; countdown for the
 *                                     last-writer election, decremented in place
 * @param {number} o.cell
 * @param {number} o.amount            this droplet's contribution, in terrain units
 * @returns {{committed: boolean, applied: number, wasLast: boolean}}
 */
export function gaeaDeferredApply({ height, sumFixed, visitCount, startCount, cell, amount }) {
  if (amount !== 0) {
    sumFixed[cell] += toFixed(amount);
    visitCount[cell] += 1;
  }
  const remaining = --startCount[cell];
  if (remaining !== 0) return { committed: false, applied: 0, wasLast: false };

  const applied = fromFixed(sumFixed[cell], visitCount[cell]);
  height[cell] += applied;
  // The binary clears both accumulators in the same last-writer branch. Skipping the reset
  // would fold this iteration's material into the next one.
  sumFixed[cell] = 0;
  visitCount[cell] = 0;
  return { committed: true, applied, wasLast: true };
}

/** `0x3e800000` at `0x1803561ec` — the divisor that normalises raw accumulation. */
export const K_FLOW_NORMALIZE = 0.25;

/**
 * `FUN_1801f2ec0` (110 bytes) — fold raw accumulation into the flow buffer as a lower bound.
 *
 *     flow[i] = max( flow[i], min(1, K_FLOW_NORMALIZE * raw[i]) )
 *
 * Pass 5 of the nine-pass pipeline. It is a `max`, not an assignment, so it can only raise
 * the flow buffer, which is the same buffer the flow gate reads one pass later. The
 * `min(1, ...)` saturates, so a raw accumulation above 4 contributes no more than one equal
 * to 4: the buffer holds a normalised strength, not a volume.
 *
 * @param {object} o
 * @param {Float32Array} o.raw   accumulation folded in
 * @param {Float32Array} o.flow  modified in place
 * @returns {Float32Array} `o.flow`
 */
export function gaeaFlowNormalize({ raw, flow }) {
  for (let i = 0; i < flow.length; i++) {
    const v = K_FLOW_NORMALIZE * raw[i];
    const clamped = v > K_ONE ? K_ONE : v;
    if (flow[i] < clamped) flow[i] = clamped;
  }
  return flow;
}

/**
 * `FUN_1801f3560` (138 bytes) — move one buffer into another and clear the source.
 *
 *     dst[i] += src[i];
 *     src[i]  = 0;
 *
 * Runs twice in the pipeline: pass 7, between the flow-coupled erosion and the plain
 * relaxation, and pass 9 at the end. The `+=` is what makes the destination accumulate
 * across passes, matching the accumulating output of both relaxation kernels. The clear is
 * not incidental: leaving the source populated would fold the previous iteration's
 * contribution in again on the next round.
 *
 * @param {object} o
 * @param {Float32Array} o.src  accumulated into `dst`, then zeroed
 * @param {Float32Array} o.dst  modified in place
 * @returns {{dst: Float32Array, cleared: number}} `cleared` counts the non-zero source
 *   entries that were flushed, so a test can tell a real flush from a no-op.
 */
export function gaeaFlushAccumulator({ src, dst }) {
  let touched = 0;
  for (let i = 0; i < dst.length; i++) {
    if (src[i] !== 0) touched++;
    dst[i] += src[i];
    src[i] = 0;
  }
  return { dst, cleared: touched };
}

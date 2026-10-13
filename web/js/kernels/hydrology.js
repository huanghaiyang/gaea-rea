/**
 * hydrology.js — Gaea's HydrologicalCorrection, recovered from `HydrologicalCorrection`
 * → `FUN_180044930` → `FUN_180041810`.
 *
 * WHAT IT IS
 * A deque-driven region-growing pass that, for every cell, records WHICH NEIGHBOUR IT DRAINS
 * TO. It produces a receiver tree rooted at the seed, not a flat fill. That is why each level
 * carries an 8-byte-per-cell parent array (`level + 0x58`, two ints) alongside the byte mask.
 *
 * The mask has three states, and the third is what makes it terminating:
 *
 *   0  unvisited
 *   1  queued (on the frontier)
 *   2  expanded (its window has been scanned)
 *
 * TRANSCRIBED FROM `FUN_180041810`
 *
 *   while (deque not empty) {
 *       pop {h, x, y}
 *       if (mask[y][x] >= 2) continue;
 *       mark 2
 *       minDrop = FLT_MAX                                     // 0x1803563cc
 *       for each unvisited cell in the 3x3 window:
 *           w = (same row or column) ? 1.0 : 0.707099974      // 0x180356274, 0x180356238
 *           minDrop = min(minDrop, (height - h) * w)
 *       if (0 <= minDrop)  accept every unvisited neighbour, diagonals via a two-step test
 *       else               accept axial neighbours always, diagonals only when
 *                          (height - h) <= minDrop
 *   }
 *
 * THE SHARED PRIMITIVE
 * `0x180356238` is **0.707099974**, the identical constant the erosion's 3x3 relaxation uses
 * as `K_DIAG`. So the "diagonal is sqrt(2) further away and therefore weighted less" rule is a
 * library primitive reused across nodes, not an erosion-specific detail. The value is 0.7071,
 * a four-decimal approximation, not `1/sqrt(2)` — see kernels/relaxation.js for why that
 * distinction was worth establishing.
 *
 * FIDELITY: `approx`
 * Transcribed exactly: the deque discipline, the three-state mask, the parent write, the
 * weighted-minimum computation, the axial-versus-diagonal weighting, the `minDrop < 0` branch
 * in full, and the two literals (5-state thresholds aside, the constants and the FLT_MAX
 * initialiser).
 *
 * Inferred: the diagonal acceptance test in the `minDrop >= 0` branch, which walks two
 * reference cells and compares against a height difference; the decompiler renders it as a
 * loop with two reassignments and I could not settle which cell is the reference in each pass.
 * The `minDrop < 0` branch is unambiguous and is the one that does the work whenever a
 * depression is present.
 */

import { K_DIAG } from './relaxation.js';

/** `0x7f7fffff` at `0x1803563cc` — the minimum-drop initialiser, FLT_MAX. */
export const K_HYDRO_MIN_INIT = 3.4028234663852886e38;

/**
 * The mask states. Exported because the flood's termination depends on the distinction
 * between "queued" and "expanded", and a test should be able to assert it.
 */
export const HYDRO_UNVISITED = 0;
export const HYDRO_QUEUED = 1;
export const HYDRO_EXPANDED = 2;

/**
 * One level of the hydrological correction.
 *
 * @param {object} o
 * @param {Float32Array} o.height
 * @param {number} o.size
 * @param {number} o.seedX,o.seedY
 * @param {Int32Array} [o.mask]    byte states, one per cell
 * @param {Int32Array} [o.parent]  receiver cell index per cell, -1 where unset
 * @returns {{mask: Int32Array, parent: Int32Array, processed: number}}
 */
export function gaeaHydroLevel({ height, size, seedX, seedY, mask, parent }) {
  const n = size * size;
  const ownMask = !(mask && mask.length === n);
  const m = ownMask ? new Int32Array(n) : mask;
  const ownParent = !(parent && parent.length === n);
  const par = ownParent ? new Int32Array(n).fill(-1) : parent;
  if (ownMask) m.fill(HYDRO_UNVISITED);
  if (ownParent) par.fill(-1);

  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  const qh = new Float32Array(n);
  let head = 0;
  let tail = 0;
  const push = (x, y) => {
    qx[tail] = x; qy[tail] = y; qh[tail] = height[y * size + x]; tail++;
  };

  const sx0 = Math.max(0, Math.min(size - 1, seedX | 0));
  const sy0 = Math.max(0, Math.min(size - 1, seedY | 0));
  push(sx0, sy0);
  let processed = 0;

  while (head < tail) {
    const sx = qx[head];
    const sy = qy[head];
    const seedH = qh[head];
    head++;
    const si = sy * size + sx;
    if (m[si] >= HYDRO_EXPANDED) continue;
    m[si] = HYDRO_EXPANDED;
    processed++;

    const x0 = sx > 0 ? sx - 1 : 0;
    const y0 = sy > 0 ? sy - 1 : 0;
    const x1 = sx + 1 < size ? sx + 1 : size - 1;
    const y1 = sy + 1 < size ? sy + 1 : size - 1;

    // The minimum weighted drop over the unvisited cells of the window. Axial neighbours are
    // one cell away and weigh 1; diagonals are sqrt(2) away and weigh 0.7071.
    let minDrop = K_HYDRO_MIN_INIT;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const j = y * size + x;
        if (m[j] !== HYDRO_UNVISITED) continue;
        const w = (x === sx || y === sy) ? 1 : K_DIAG;
        const drop = (height[j] - seedH) * w;
        if (drop < minDrop) minDrop = drop;
      }
    }

    const depressionPresent = minDrop < 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const j = y * size + x;
        if (m[j] !== HYDRO_UNVISITED) continue;
        const axial = (x === sx || y === sy);
        // Axial neighbours are always admitted, in both branches.
        if (!axial && depressionPresent) {
          // Only cells as low as the window minimum drain here. This is the rule that makes the
          // tree follow the steepest available descent instead of fanning out uniformly.
          if (minDrop < height[j] - seedH) continue;
        }
        // The `minDrop >= 0` branch applies a two-step reference comparison to diagonals
        // instead. It is INFERRED (see the file header), and since that branch only occurs when
        // no cell in the window lies below the seed, admitting the diagonal is the behaviour
        // that branch is for. The substitution is recorded rather than hidden.
        m[j] = HYDRO_QUEUED;
        par[j] = si;
        push(x, y);
      }
    }
  }
  return { mask: m, parent: par, processed };
}

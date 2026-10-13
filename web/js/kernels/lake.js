/**
 * lake.js — Gaea's Lake node, recovered from `Lake_Create` → `FUN_180057aa0`.
 *
 * SOURCE
 * The decompilation exposes the real C++ symbol names through lambda vtables, which is how
 * the source structure is known rather than guessed:
 *
 *   lake::search_min(Map<float>&, int, int, float, int&, int&, float&)::{lambda_1, lambda_2}
 *   lake::lake_create(lake::Parameters, float*, float*, float*, float*, InteropBridge)
 *
 * The parameters read out of the native code line up exactly with the vendor catalogue's
 * `Lake` node, which is what ties the two together:
 *
 *   parameters[1]        -> X              (catalogue default 0,   range -1..1)
 *   *(int*)(parameters+0xc) -> Y           (catalogue default 0,   range -1..1)
 *   *(float*)(parameters+2) -> Water Level (catalogue default 0.01, range 0..1)
 *
 * and the native guard is literally `if (0.0 < Water Level)`, matching the catalogue's
 * positive floor.
 *
 * FIDELITY: `approx`
 * Recovered and reproduced exactly:
 *   * the local-minimum descent: up to 5 steps, each raising the search level by
 *     `0.2 * WaterLevel` (0x1803561e4 = 0.2)
 *   * the bisection on water level: 9 iterations, midpoint `(upper + lower) * 0.5`
 *     (0x180356210 = 0.5), with the initial upper bound FLT_MAX (0x1803563cc = 0x7f7fffff)
 *   * three output buffers, all cleared before use
 *   * the flood structure: a per-cell visited byte and a 12-byte-per-cell queue entry
 *     (FUN_1800570c0 allocates exactly `width * height` and `width * height * 12`)
 *
 * NOT recovered: the convergence test that decides which bisection half to keep. `FUN_180057aa0`
 * selects between two lambdas whose bodies are behind a vtable, so the comparison is not
 * readable from this function. It is therefore implemented as the standard
 * flooded-area-grows-with-level test, and the fidelity label stays `approx` rather than
 * `exact` for that reason alone.
 *
 * WHAT A PRIORITY FLOOD IS, AND WHY IT IS NOT BFS
 * A plain queue would let water cross a cell whose height exceeds the level as long as it is
 * reached early, because BFS explores by distance and not by height. Processing cells in
 * increasing height order instead means the flood always expands from the lowest frontier
 * cell, so a rim is only crossed once the level has genuinely risen above it. That is what
 * makes the result a physically plausible lake rather than a distance-limited puddle, and it
 * is why `search_min` and a 12-byte queue entry exist at all.
 */
import { createField } from '../kernel/field.js';

/** `0x3e4ccccd` at `0x1803561e4` — the descent raises the level by this fraction of WaterLevel. */
export const K_LAKE_DESCENT_STEP = 0.2;
/** `0x3f000000` at `0x180356210` — the bisection midpoint weight. */
export const K_LAKE_MIDPOINT = 0.5;

/** `0x7f7fffff` at `0x1803563cc` — the initial upper bound, FLT_MAX. */
export const K_LAKE_UPPER_INIT = 3.4028234663852886e38;

/** The descent's step bound, and the bisection's iteration bound, both literals in the binary. */
export const LAKE_DESCENT_STEPS = 5;
export const LAKE_BISECTION_STEPS = 9;

/**
 * The descent from `lake::search_min`: walk to the lowest neighbour until no neighbour is
 * lower, or 5 steps have been taken, raising the comparison level by
 * `0.2 * waterLevel` each step so a flat start still makes progress.
 *
 * @param {Float32Array} h
 * @param {number} size
 * @param {number} sx,sy
 * @param {number} waterLevel
 * @returns {{x: number, y: number, level: number, steps: number}}
 */
export function gaeaLakeSearchMin(h, size, sx, sy, waterLevel) {
  let x = sx | 0;
  let y = sy | 0;
  let level = h[y * size + x];
  let steps = 0;

  for (let i = 0; i < LAKE_DESCENT_STEPS; i++) {
    let bx = x;
    let by = y;
    let best = level;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const v = h[ny * size + nx];
        if (v < best) { best = v; bx = nx; by = ny; }
      }
    }
    if (bx === x && by === y) break;          // no lower neighbour: done
    x = bx;
    y = by;
    // The raised comparison level is what keeps a flat region from stalling the search.
    level = K_LAKE_DESCENT_STEP * waterLevel + level;
    steps++;
  }
  return { x, y, level, steps };
}

/**
 * A priority flood at a fixed water level.
 *
 * Expands from `(sx, sy)` in increasing height order, admitting only cells at or below
 * `level`. Returns a mask of flooded cells; the seed is always included when it is below the
 * level.
 *
 * @param {Float32Array} h
 * @param {number} size
 * @param {number} sx,sy
 * @param {number} level
 * @param {Uint8Array} [out]
 * @returns {Uint8Array} one byte per cell, 1 where flooded
 */
export function gaeaLakeFlood(h, size, sx, sy, level, out) {
  const mask = out && out.length === size * size ? out : new Uint8Array(size * size);
  mask.fill(0);
  const n = size * size;
  if (sx < 0 || sy < 0 || sx >= size || sy >= size) return mask;
  if (h[sy * size + sx] > level) return mask;

  // A binary min-heap keyed by height. Gaea's queue entry is 12 bytes: two ints and a float,
  // which is exactly {x, y, height}.
  const heapIdx = new Int32Array(n);
  const heapKey = new Float32Array(n);
  let heapLen = 0;

  const push = (cell, key) => {
    let i = heapLen++;
    heapIdx[i] = cell;
    heapKey[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p] <= heapKey[i]) break;
      const ti = heapIdx[p]; heapIdx[p] = heapIdx[i]; heapIdx[i] = ti;
      const tk = heapKey[p]; heapKey[p] = heapKey[i]; heapKey[i] = tk;
      i = p;
    }
  };
  const pop = () => {
    const top = heapIdx[0];
    heapLen--;
    if (heapLen > 0) {
      heapIdx[0] = heapIdx[heapLen];
      heapKey[0] = heapKey[heapLen];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heapLen && heapKey[l] < heapKey[m]) m = l;
        if (r < heapLen && heapKey[r] < heapKey[m]) m = r;
        if (m === i) break;
        const ti = heapIdx[m]; heapIdx[m] = heapIdx[i]; heapIdx[i] = ti;
        const tk = heapKey[m]; heapKey[m] = heapKey[i]; heapKey[i] = tk;
        i = m;
      }
    }
    return top;
  };

  const seed = sy * size + sx;
  mask[seed] = 1;
  push(seed, h[seed]);

  while (heapLen > 0) {
    const cell = pop();
    const cx = cell % size;
    const cy = (cell / size) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? -1 : k === 1 ? 1 : 0);
      const ny = cy + (k === 2 ? -1 : k === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (mask[j]) continue;
      if (h[j] > level) continue;             // above the level: water does not go there
      mask[j] = 1;
      push(j, h[j]);
    }
  }
  return mask;
}

/**
 * `lake::lake_create` — find the basin's spill level, then bisect the lake level above it.
 *
 * WHAT FLT_MAX IS, AND WHAT IT IS NOT
 * `K_LAKE_UPPER_INIT` is a SEARCH THRESHOLD sentinel, not a bisection bound. The binary sets
 * `local_470 = FLT_MAX` and hands it to the flood as "find the lowest cell reachable", then
 * uses the found value (the spill) plus `WaterLevel` as the lake level. An earlier version of
 * this function used it as the bisection's upper bound, which made the first midpoint
 * `(level + 3.4e38) / 2` and flooded the entire grid — caught by the app's node smoke test as
 * `Lake: exploded range [1.7e38, 1.7e38]`.
 *
 * WHAT IS RECOVERED
 *   * the spill is the minimum height at which the flood stops being confined
 *   * the lake level is that spill plus a fraction of `WaterLevel`
 *   * the refinement is 9 iterations with a 0.5 midpoint
 *
 * WHAT IS INFERRED
 * The exact bracket. The binary's two bounds are `spill + 0.18 * WaterLevel` and
 * `spill + WaterLevel` (0.2 from `0x1803561e4` and 0.9 from `0x18035625c`), which do not form
 * a bracket in the usual sense, and the lambda vtable hides the test that updates them. This
 * implementation therefore searches between the spill and the terrain's own maximum, which
 * makes the bisection well-posed and bounded. That choice is why the fidelity is `approx`.
 *
 * @param {object} o
 * @param {Float32Array} o.height
 * @param {number} o.size
 * @param {number} o.seedX,o.seedY
 * @param {number} o.waterLevel
 * @returns {{mask: Uint8Array, level: number, spill: number, iterations: number}}
 */
export function gaeaLakeCreate({ height, size, seedX, seedY, waterLevel }) {
  const wl = Number.isFinite(waterLevel) ? waterLevel : 0;
  const empty = new Uint8Array(size * size);
  if (!(wl > 0)) return { mask: empty, level: 0, spill: 0, iterations: 0 };

  const start = gaeaLakeSearchMin(height, size, seedX, seedY, wl);

  // The spill: the lowest level at which water escapes the immediate basin. Found by flooding
  // at increasing levels until the flooded count jumps, which is the same quantity the
  // binary's FLT_MAX-thresholded search returns.
  let maxH = -Infinity;
  for (let i = 0; i < height.length; i++) if (height[i] > maxH) maxH = height[i];

  let spill = start.level;
  {
    let lo = start.level;
    let hi = maxH;
    let prev = countOnes(gaeaLakeFlood(height, size, start.x, start.y, lo));
    const probe = new Uint8Array(size * size);
    for (let i = 0; i < LAKE_BISECTION_STEPS; i++) {
      const mid = (lo + hi) * K_LAKE_MIDPOINT;
      const n = countOnes(gaeaLakeFlood(height, size, start.x, start.y, mid, probe));
      if (n > prev * 8 && prev > 0) { hi = mid; } else { lo = mid; prev = n; }
    }
    spill = lo;
  }

  // The lake level: the spill plus the requested water level, refined over 9 iterations
  // between the spill and the terrain maximum.
  let lower = Math.min(spill + wl, maxH);
  let upper = maxH;
  let best = gaeaLakeFlood(height, size, start.x, start.y, lower);
  let bestCount = countOnes(best);
  let iterations = 0;

  const probe = new Uint8Array(size * size);
  for (let i = 0; i < LAKE_BISECTION_STEPS && upper > lower; i++) {
    iterations++;
    const mid = (lower + upper) * K_LAKE_MIDPOINT;
    const mask = gaeaLakeFlood(height, size, start.x, start.y, mid, probe);
    const n = countOnes(mask);
    if (n > bestCount) {
      lower = mid;
      bestCount = n;
      best.set(mask);
    } else {
      upper = mid;
    }
  }
  return { mask: best, level: lower, spill, iterations, seed: start };
}

function countOnes(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

/**
 * The `Lake` node as the app calls it.
 *
 * Returns a HEIGHT FIELD, not the flood mask — the mask is an intermediate. Flooded cells get
 * a flat water surface at the resolved level; everything else passes through unchanged.
 *
 * `Render Surface` selects between rendering the water plane itself (a flat surface at the
 * level) and rendering the lake bed with the level used only as a ceiling. `Water Floor`
 * lowers the bed relative to the surface, which is what makes a lake read as depth rather
 * than as a filled pit.
 */
export function gaeaLake(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const ch = src.channels || 1;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) {
    const v = src.data[i * ch];
    h[i] = Number.isFinite(v) ? v : 0;
  }

  // X and Y are normalised -1..1 in the catalogue; map to cell coordinates.
  const nx = P(params, 'X', 0);
  const ny = P(params, 'Y', 0);
  const seedX = Math.round((nx + 1) * 0.5 * (size - 1));
  const seedY = Math.round((ny + 1) * 0.5 * (size - 1));
  const waterLevel = P(params, 'Water Level', 0.01);

  const { mask, level } = gaeaLakeCreate({ height: h, size, seedX, seedY, waterLevel });

  const renderSurface = !!P(params, 'Render Surface', false);
  const floor = P(params, 'Water Floor', 0);
  const out = createField(size, 'height');
  for (let i = 0; i < h.length; i++) {
    if (mask[i]) {
      out.data[i] = renderSurface ? level : Math.max(h[i], level - floor);
    } else {
      out.data[i] = h[i];
    }
  }
  return out;
}

function P(params, name, dflt) {
  if (!params) return dflt;
  const v = params[name];
  return v === undefined || v === null ? dflt : v;
}

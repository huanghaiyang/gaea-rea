/**
 * coords.js — coordinate space conventions shared by every field kernel.
 *
 * The whole engine works on square fields of size N x N stored row-major in a Float32Array.
 * Three coordinate spaces exist and every kernel documents which one it consumes:
 *
 *   uv     [0,1]               normalized texture space, pixel centers at (i+0.5)/N
 *   cuv    [-1,1]              centered uv; useful for radial shapes
 *   world  [0,WORLD_SIZE_KM]   approximate kilometers, using the caller supplied terrain
 *                              scale (Gaea's "Real Scale"/terrain width concept). This is
 *                              what gives Scale parameters a physically meaningful unit.
 *
 * Gaea does not publish its internal coordinate conventions, so the mapping used here is a
 * REASONABLE APPROXIMATION chosen for numerical stability; see IMPLEMENTATION-NOTES.md.
 */

/** Default terrain width in kilometers used by the `world` space (Gaea's 60 km default). */
export const WORLD_SIZE_KM = 60;

/**
 * Precomputed per-axis coordinate ramps. Built once per (size, mode) and reused by every
 * kernel in a pass, which removes N*N divisions from the inner loops.
 */
export function makeCoordRamp(size, mode = 'uv', worldSize = WORLD_SIZE_KM) {
  const out = new Float64Array(size);
  const inv = 1 / size;
  for (let i = 0; i < size; i++) {
    const t = (i + 0.5) * inv; // [0,1)
    switch (mode) {
      case 'cuv': out[i] = t * 2 - 1; break;
      case 'world': out[i] = t * worldSize; break;
      default: out[i] = t;
    }
  }
  return out;
}

/** Sample a field with configurable edge behaviour. Never throws, never produces NaN. */
export const EDGE = { CLAMP: 0, MIRROR: 1, WRAP: 2 };

export function sampleBilinear(data, size, x, y, edge = EDGE.CLAMP) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const max = size - 1;
  let x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  let x1 = x0 + 1, y1 = y0 + 1;

  switch (edge) {
    case EDGE.WRAP: {
      const n = size;
      x0 = ((x0 % n) + n) % n; x1 = ((x1 % n) + n) % n;
      y0 = ((y0 % n) + n) % n; y1 = ((y1 % n) + n) % n;
      break;
    }
    case EDGE.MIRROR: {
      x0 = mirrorIndex(x0, size); x1 = mirrorIndex(x1, size);
      y0 = mirrorIndex(y0, size); y1 = mirrorIndex(y1, size);
      break;
    }
    default: {
      x0 = clampInt(x0, 0, max); x1 = clampInt(x1, 0, max);
      y0 = clampInt(y0, 0, max); y1 = clampInt(y1, 0, max);
    }
  }
  const a = data[y0 * size + x0], b = data[y0 * size + x1];
  const c = data[y1 * size + x0], d = data[y1 * size + x1];
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  const v = top + (bot - top) * fy;
  return Number.isFinite(v) ? v : 0;
}

function mirrorIndex(i, n) {
  if (n <= 1) return 0;
  const period = 2 * n;
  let m = ((i % period) + period) % period;
  if (m >= n) m = period - 1 - m;
  return m;
}
function clampInt(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Nearest-neighbour sample with the same edge semantics. */
export function sampleNearest(data, size, x, y, edge = EDGE.CLAMP) {
  let xi = Math.round(x), yi = Math.round(y);
  switch (edge) {
    case EDGE.WRAP: {
      const n = size;
      xi = ((xi % n) + n) % n; yi = ((yi % n) + n) % n;
      break;
    }
    case EDGE.MIRROR: xi = mirrorIndex(xi, size); yi = mirrorIndex(yi, size); break;
    default: xi = clampInt(xi, 0, size - 1); yi = clampInt(yi, 0, size - 1);
  }
  const v = data[yi * size + xi];
  return Number.isFinite(v) ? v : 0;
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(e0, e1, x) {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
/** Guard every division in the engine. */
export function safeDiv(a, b, fallback = 0) {
  return b === 0 || !Number.isFinite(b) ? fallback : a / b;
}

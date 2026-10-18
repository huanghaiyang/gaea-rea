/**
 * gaea-exact.js — ports that reproduce Gaea's shipped engine arithmetic, not an approximation.
 *
 * THE POINT
 * The remaining nodes are thin `Build()` wrappers around shared static helpers. Those helpers were
 * recovered from the real assemblies (`evidence/decompiled/Gaea.Engine.whole.cs`), and every port
 * here is verified against a numeric oracle: `tools/gaea-probe oracle` loads the installed
 * `Gaea.Nodes.dll` / `Gaea.Engine.dll`, runs the REAL method on the same input, and the two float
 * arrays are diffed (`tools/verify-exact.mjs`). That is the difference between "the output looks
 * like a terrain" and "the output is the same numbers Gaea produces".
 *
 * SEMANTICS LEARNED FROM THE SHIPPED CODE (keep these notes with the functions):
 *  - All maths is single precision in Gaea; Float32Array is the storage type here.
 *  - `Map` is a square Float32Array of N*N values; N = resolution.X.
 *  - The obfuscated helpers are:
 *      \uf55c\uf0ba\ue6e5  pair/curve ops  (two overloads: array pair and in-place curve)
 *      \uf55c\uf0ba\ue6dc  fractional-radius box blur, iterated
 *      \uf55c\uf0ba\ue6d5  stats / range remap / clamp
 *    Their names are noise; the behaviour below was read from the real bodies and confirmed
 *    numerically, so do not "improve" it.
 */

/* ================================================================== basic stats */

/** min/max over the whole array. */
export function stats(data) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** Clamp a single value. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ================================================================== blur */

/**
 * One 1D pass of the fractional-radius box filter.
 *
 * Recovered from `\uf55c\uf0ba\ue6dc`: with integer part R = floor(radius) and fraction F = radius-R,
 * the window is [j-R, j+R] with weight 1 for the body and weight F for the two taps just outside,
 * divided by (2R + 2F + 1). Out-of-range samples replicate the edge.
 *
 *   out[j] = ( Σ_{k=-R..R} v[clamp(j+k)] + F*(v[clamp(j-R-1)] + v[clamp(j+R+1)]) ) / (2R+2F+1)
 *
 * The shipped code implements this as a sliding window over columns and writes transposed, then a
 * second pass restores the orientation. That is an optimisation; the filter is separable, so this
 * direct form produces the same numbers.
 */
export function boxBlur1D(src, N, radius, horizontal) {
  const out = new Float32Array(src.length);
  const R = Math.floor(radius);
  const F = radius - R;
  const w = 1 / (2 * R + 2 * F + 1);
  const last = N - 1;
  if (horizontal) {
    for (let y = 0; y < N; y++) {
      const base = y * N;
      for (let x = 0; x < N; x++) {
        let sum = 0;
        for (let k = -R; k <= R; k++) {
          let ix = x + k;
          if (ix < 0) ix = 0;
          else if (ix > last) ix = last;
          sum += src[base + ix];
        }
        let a = x - R - 1;
        a = a < 0 ? 0 : a > last ? last : a;
        let b = x + R + 1;
        b = b < 0 ? 0 : b > last ? last : b;
        sum += F * (src[base + a] + src[base + b]);
        out[base + x] = sum * w;
      }
    }
  } else {
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) {
        let sum = 0;
        for (let k = -R; k <= R; k++) {
          let iy = y + k;
          if (iy < 0) iy = 0;
          else if (iy > last) iy = last;
          sum += src[iy * N + x];
        }
        let a = y - R - 1;
        a = a < 0 ? 0 : a > last ? last : a;
        let b = y + R + 1;
        b = b < 0 ? 0 : b > last ? last : b;
        sum += F * (src[a * N + x] + src[b * N + x]);
        out[y * N + x] = sum * w;
      }
    }
  }
  return out;
}

/**
 * The full blur helper: `iterations` rounds of (horizontal, then vertical) box passes.
 * `\uf55c\uf0ba\ue6dc.\uf4c9\uf065\uf4e7(src, N, radius, iterations=5)`.
 */
export function gaeaBlur(src, N, radius, iterations = 5) {
  let buf = Float32Array.from(src);
  for (let i = 0; i < iterations; i++) {
    buf = boxBlur1D(buf, N, radius, true);
    buf = boxBlur1D(buf, N, radius, false);
  }
  return buf;
}

/* ================================================================== pair ops */

/**
 * Element-wise difference → new array (`\uf70f\ue6c9\ue2b3(float[], float[], int)`).
 * Note the shipped body is literally `a - b`; it is NOT "apply a curve". Applying a curve here
 * instead is the single most dangerous mistake in this file: it still renders a plausible terrain.
 */
export function pairSubtract(a, b, N) {
  const out = new Float32Array(a.length);
  const n = Math.min(a.length, N * N);
  for (let i = 0; i < n; i++) out[i] = a[i] - b[i];
  return out;
}

/** Element-wise sum → new array (`\uf70f\ue6c9\ue2b4(float[], float[], int)`). */
export function pairAdd(a, b, N) {
  const out = new Float32Array(a.length);
  const n = Math.min(a.length, N * N);
  for (let i = 0; i < n; i++) out[i] = a[i] + b[i];
  return out;
}

/* ================================================================== curves / remap */

/**
 * In-place exponential curve (`\uf70f\ue6c9\ue2b3(float[], float, int)`), the "Shaper" transfer.
 *
 *   t = (v - min) / (max - min)
 *   v' = ((exp(t*c) - 1) / (exp(c) - 1)) * (max - min) + min
 *
 * Skipped entirely when the range is below 1e-5 (the shipped guard, a double-precision constant).
 */
export function exponentialCurveInPlace(data, curve) {
  if (curve === 0) return data;
  const { min, max } = stats(data);
  const range = max - min;
  if (Math.abs(range) < 1e-5) return data;
  const inv = 1 / range;
  const denom = Math.exp(curve) - 1;
  if (denom === 0) return data;
  const scale = 1 / denom;
  for (let i = 0; i < data.length; i++) {
    const t = (data[i] - min) * inv;
    data[i] = (Math.exp(t * curve) - 1) * scale * range + min;
  }
  return data;
}

/**
 * Linear remap so that [inMin,inMax] becomes [outMin,outMax]
 * (`\ueb77\uf21d\ue95c(float[], int, inMin, inMax, outMin, outMax)`).
 * Degenerate input range leaves the data untouched.
 */
export function remapRange(data, inMin, inMax, outMin, outMax) {
  const span = inMin - inMax;
  if (span === 0) return data;
  const scale = (outMin - outMax) / span;
  const offset = outMax - inMax * scale;
  for (let i = 0; i < data.length; i++) data[i] = data[i] * scale + offset;
  return data;
}

/* ================================================================== Profiles.Shaper */

/**
 * `Profiles.Shaper` — the Shape / Shaper node.
 *
 *   shape *= -10
 *   if (shape == 0) return input
 *   if (fineDetails || localEffect) remember original min/max
 *   if (fineDetails) { blurred = blur(radius1); detail = input - blurred; input = blurred }
 *   if (localEffect)  { blurred2 = blur(radius2); d = input - blurred2; curve(d); input = blurred2 + d }
 *   else              curve(input)
 *   if (fineDetails) input += detail
 *   if (fineDetails || localEffect) remap new min/max back to the original range
 *
 * radii:  N * (0.0005 + detailSize*0.01)   and   N * 0.08 * (localArea + 0.1)
 */
export function profilesShaper(input, N, shape, localEffect = false, localArea = 0.5, fineDetails = false, detailSize = 0.75) {
  let curve = shape * -10;
  if (curve === 0) return Float32Array.from(input);
  let arr = Float32Array.from(input);
  let detail = null;
  let oldStats = null;
  if (fineDetails || localEffect) oldStats = stats(arr);

  if (fineDetails) {
    const blurred = gaeaBlur(arr, N, N * (0.0005 + detailSize * 0.01), 5);
    detail = pairSubtract(arr, blurred, N);
    arr = blurred;
  }
  if (localEffect) {
    const blurred2 = gaeaBlur(arr, N, N * 0.08 * (localArea + 0.1), 5);
    const d = pairSubtract(arr, blurred2, N);
    exponentialCurveInPlace(d, curve);
    arr = pairAdd(blurred2, d, N);
  } else {
    exponentialCurveInPlace(arr, curve);
  }
  if (fineDetails) arr = pairAdd(arr, detail, N);
  if (oldStats) {
    const s = stats(arr);
    remapRange(arr, s.min, s.max, oldStats.min, oldStats.max);
  }
  return arr;
}

/* ================================================================== blur-based profiles */

import { mapBlur, mapBlurPercent } from './gaea-blur.js';

/**
 * `Profiles.GraphicEQ(map, b1..b7)` — the 7-band spectral EQ.
 *
 * Each band is the difference between successive blur levels, with the radius stepping by
 * `log(52)/log(5)` (≈2.456) starting at `N/10` pixels; band 7 is the residual high frequency.
 * Implemented with the measured native blur, so the interior matches; border accuracy is limited by
 * the blur edge model (see gaea-blur.js).
 */
export function graphicEQ(data, N, gains) {
  const src = Float32Array.from(data);
  const out = new Float32Array(N * N);
  const ratio = Math.log(52) / Math.log(5);
  let step = 10;
  let bandData0 = Float32Array.from(src);
  let prev = Float32Array.from(src);
  for (let band = 0; band < 7; band++) {
    const radius = N / step;
    if (band < 6) bandData0 = mapBlur(src, N, radius);
    const g = gains[band];
    for (let i = 0; i < N * N; i++) {
      let d;
      if (band >= 6) d = src[i] - prev[i];
      else if (band !== 0) d = bandData0[i] - prev[i];
      else d = bandData0[i];
      out[i] += d * g;
    }
    prev = bandData0;
    step *= ratio;
  }
  return out;
}

/**
 * `Texturize.Soil2(map, Soil)` — five ever-larger blurs, each subtracted from the original and
 * accumulated, then autoleveled. Produces the granular "soil" relief.
 */
export function soil2(data, N, soil) {
  let m3 = Float32Array.from(data);
  const acc = new Float32Array(N * N);
  for (let i = 0; i < 5; i++) {
    m3 = mapBlurPercent(m3, N, (soil / 2) * (i + 1));
    for (let k = 0; k < N * N; k++) acc[k] = m3[k] - data[k] + acc[k];
  }
  const { min, max } = stats(acc);
  const span = max - min;
  if (span === 0) return acc;
  const inv = 1 / span;
  for (let k = 0; k < N * N; k++) {
    let v = (acc[k] - min) * inv;
    if (v < 0) v = 0;
    else if (v > 1) v = 1;
    acc[k] = v;
  }
  return acc;
}

/**
 * gaea-blur.js — exact model of Gaea's native `Map.Blur`.
 *
 * The native filter is a P/Invoke (`Gaea.Native.dll`), so there is no managed body to port. Its
 * behaviour was measured with impulse responses (`tools/build-blur-lut.mjs`) and confirmed to be:
 *
 *   1. SEPARABLE      — p11*p00 == p10*p01 exactly (to float32 precision)
 *   2. NORMALISED     — a constant image stays constant
 *   3. EDGE-REPLICATE — so borders do not darken
 *   4. radius_px = value / 40 * resolution   for the percent entry point, and radius in pixels for
 *      the direct entry point
 *   5. NOT a plain Gaussian — the tails decay faster than a Gaussian with the same centre weight, so
 *      the kernel is carried as a measured 1D profile table (`blur-kernel-data.js`) instead of a
 *      formula. Off-grid radii are linearly interpolated between adjacent measured profiles and the
 *      result is validated on real images by `tools/verify-exact.mjs`.
 */

import { BLUR_RADII, BLUR_KERNELS } from './blur-kernel-data.js';

const F = Math.fround;

/** Normalised 1D profile for a radius parameter, linearly interpolated between measured radii. */
export function blurKernel(radiusPx) {
  const p = Math.max(BLUR_RADII[0], radiusPx);
  if (p >= BLUR_RADII[BLUR_RADII.length - 1]) return BLUR_KERNELS[BLUR_KERNELS.length - 1];
  let lo = 0;
  while (lo + 1 < BLUR_RADII.length && BLUR_RADII[lo + 1] <= p) lo++;
  const hi = Math.min(lo + 1, BLUR_RADII.length - 1);
  const t = (p - BLUR_RADII[lo]) / (BLUR_RADII[hi] - BLUR_RADII[lo]);
  const a = BLUR_KERNELS[lo];
  const b = BLUR_KERNELS[hi];
  const n = Math.max(a.length, b.length);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const av = i < a.length ? a[i] : 0;
    const bv = i < b.length ? b[i] : 0;
    out[i] = av + (bv - av) * t;
  }
  return out;
}

/**
 * One separable pass, `horizontal` false means vertical.
 *
 * EDGE MODEL: Gaea's border rule could not be recovered exactly (an impulse test only measures the
 * interior; a ramp test shows the border response is between edge-clamp and mirror, and the best
 * global fit is their average). Using the average of a clamp-padded and a mirror-padded convolution
 * cuts the worst edge error from 2.5e-2 to 2.7e-3 on real images, while interior pixels stay exact
 * (1.7e-4). This is the only part of `Map.Blur` that is modelled rather than measured.
 */
const EDGE_MIX = 0.5;
function blur1D(src, N, k, horizontal) {
  const R = k.length - 1;
  const out = new Float64Array(N * N);
  const mirror = (v) => {
    if (v < 0) return Math.min(N - 1, -v);
    if (v >= N) return Math.max(0, 2 * (N - 1) - v);
    return v;
  };
  if (horizontal) {
    for (let y = 0; y < N; y++) {
      const base = y * N;
      for (let x = 0; x < N; x++) {
        let sc = k[0] * src[base + x];
        let sm = sc;
        for (let j = 1; j <= R; j++) {
          const xa = x - j;
          const xb = x + j;
          const ca = xa < 0 ? 0 : xa;
          const cb = xb > N - 1 ? N - 1 : xb;
          sc += k[j] * (src[base + ca] + src[base + cb]);
          sm += k[j] * (src[base + mirror(xa)] + src[base + mirror(xb)]);
        }
        out[base + x] = sc * (1 - EDGE_MIX) + sm * EDGE_MIX;
      }
    }
  } else {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let sc = k[0] * src[y * N + x];
        let sm = sc;
        for (let j = 1; j <= R; j++) {
          const ya = y - j;
          const yb = y + j;
          const ca = ya < 0 ? 0 : ya;
          const cb = yb > N - 1 ? N - 1 : yb;
          sc += k[j] * (src[ca * N + x] + src[cb * N + x]);
          sm += k[j] * (src[mirror(ya) * N + x] + src[mirror(yb) * N + x]);
        }
        out[y * N + x] = sc * (1 - EDGE_MIX) + sm * EDGE_MIX;
      }
    }
  }
  return out;
}

/** `Map.Blur(map, radiusPx)` — radius in pixels. */
export function mapBlur(src, N, radiusPx) {
  if (!(radiusPx > 0)) return Float32Array.from(src);
  const k = blurKernel(radiusPx);
  const h = blur1D(src, N, k, true);
  return Float32Array.from(blur1D(h, N, k, false));
}

/** `map.Blur(value)` — the percent entry point: radius_px = value / 40 * resolution. */
export function mapBlurPercent(src, N, value) {
  return mapBlur(src, N, (value / 40) * N);
}


/**
 * gaea-combine.js — exact ports of Gaea's field-combination and range helpers.
 *
 * Sources (constant-resolved): `Combiner.Mix`, `Masking.Mask`, the `\uf55c\uf0ba\ue6d5` range helpers
 * (`Normalize` / `Autolevel` / clamp-subtract), `Others.SmoothedMedianBlur`, and the colour-channel
 * conversions used by RGBMerge / RGBSplit.
 *
 * The blend maths is `Mix(a,b,t) = a*(1-t) + b*t` (confirmed from `MathV.Mix`) with one expression per
 * BlendMode, transcribed from `Combiner.Mix`. The enum values are pinned by the shipped wrappers:
 * `Combiner.Subtract = Mix(3)`, `Difference = Mix(4)`, `Multiply = Mix(5)`, `Max = Mix(8)`, `Min = Mix(9)`.
 */

export const BLEND = {
  Blend: 0,
  Add: 1,
  Screen: 2,
  Subtract: 3,
  Difference: 4,
  Multiply: 5,
  Divide: 6,
  Divide2: 7,
  Max: 8,
  Min: 9,
};

const mix = (a, b, t) => a * (1 - t) + b * t;

/**
 * One BlendMode expression, exactly as `Combiner.Mix` computes it for ratio t.
 * Returns `undefined` for modes this port does not cover yet (caller decides).
 */
export function blendPair(mode, ratio, av, bv) {
  const one = 1;
  switch (mode) {
    case BLEND.Blend: return mix(av, bv, ratio);
    case BLEND.Add: return mix(av, av + bv, ratio);
    case BLEND.Screen: return mix(av, one - (one - av) * (one - bv), ratio);
    case BLEND.Subtract: return mix(av, av - bv, ratio);
    case BLEND.Multiply: return mix(av, av * bv, ratio);
    case BLEND.Divide: {
      const d = bv === 0 ? 0 : bv;
      return mix(av, av / d, ratio);
    }
    case BLEND.Divide2: return Math.abs(av * (1 - ratio) + av / (bv * ratio));
    case BLEND.Max: return mix(av, Math.max(av, bv), ratio);
    case BLEND.Min: return mix(av, Math.min(av, bv), ratio);
    case BLEND.Difference: return Math.abs(av - bv * ratio);
    default: return undefined;
  }
}

/** `Combiner.Mix(mode, ratio, a, b)` over two equal-length fields. */
export function combine(mode, ratio, a, b) {
  const n = a.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = blendPair(mode, ratio, a[i], b[i]);
    out[i] = v === undefined ? a[i] : v;
  }
  return out;
}

/** `Masking.Mask(a, b, mask) = a*(1-mask) + b*mask`. */
export function maskBlend(a, b, mask) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * (1 - mask[i]) + b[i] * mask[i];
  return out;
}

/* ================================================================== range helpers */

export function minMax(data) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * `\uf55c\uf0ba\ue6d5.\ueb77\uf21d\ue95e(map, a=0, b=1)` — subtract the low bound and clamp into [0, b-a].
 * Probed against the shipped method on a ramp: with (0.3, 0.7) the output is
 * `clamp(v, 0.3, 0.7) - 0.3`, i.e. a Bias-style shift with a hard ceiling.
 */
export function shiftClamp(data, a = 0, b = 1) {
  const span = b - a;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    let v = data[i] - a;
    if (v < 0) v = 0;
    else if (v > span) v = span;
    out[i] = v;
  }
  return out;
}

/** `Normalize(map, a, b, outA=1, outB=0)` — linear map a→outA, b→outB, extrapolating (no clamp). */
export function normalizeMap(data, a, b, outA = 1, outB = 0) {
  const out = new Float32Array(data.length);
  if (a === b) return out.set(data), out;
  const scale = (outA - outB) / (a - b);
  const offset = outB - b * scale;
  for (let i = 0; i < data.length; i++) out[i] = data[i] * scale + offset;
  return out;
}

/** `map.Autolevel()` — stretch the actual min/max to 0..1. */
export function autolevel(data) {
  const { min, max } = minMax(data);
  if (max === min) return Float32Array.from(data);
  const out = new Float32Array(data.length);
  const inv = 1 / (max - min);
  for (let i = 0; i < data.length; i++) {
    let v = (data[i] - min) * inv;
    if (v < 0) v = 0;
    else if (v > 1) v = 1;
    out[i] = v;
  }
  return out;
}

/**
 * Histogram equalisation with `bins` buckets and a prior stretch to 0..1.
 * Gaea's equalize lives behind `\uf55c\uf0ba\ue6e2` with 16384 bins; this matches the classic
 * cumulative-histogram definition. Documented as a close model, not oracle-verified.
 */
export function equalize(data, bins = 16384) {
  const base = autolevel(data);
  const n = base.length;
  const hist = new Int32Array(bins);
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let b = Math.floor(base[i] * bins);
    if (b < 0) b = 0;
    else if (b >= bins) b = bins - 1;
    idx[i] = b;
    hist[b]++;
  }
  const lut = new Float32Array(bins);
  let acc = 0;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    lut[b] = acc / n;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = lut[idx[i]];
  return out;
}

/* ================================================================== median */

/**
 * `Others.SmoothedMedianBlur(map, size, size2, width)`.
 *
 * The kernel radius is scaled by `width/512` using INTEGER division, so below 512 the shipped code
 * computes half=0 and then indexes `sorted[len/2-1]` out of range — i.e. the node only runs at 512+.
 * This port keeps the exact formula and floors the radius at 1 so the node also works at the app's
 * smaller default resolutions. The oracle check runs at 512, where both agree exactly.
 */
export function smoothedMedianBlur(data, N, size, size2, width) {
  const scale = Math.floor(width / 512);
  const halfA = Math.max(1, Math.floor(size / 2) * scale);
  const halfB = Math.max(1, Math.floor(size2 / 2) * scale);
  const out = new Float32Array(N * N);
  const cap = (2 * halfA + 1) * (2 * halfB + 1);
  // The shipped body allocates ONE window per row and reuses it across the row: it writes only the
  // in-bounds taps, then sorts the whole buffer. Out-of-bounds entries therefore carry values left
  // over from the previous pixel, and the border median depends on them. Reproducing that reuse is
  // what makes the border match; "cleaner" per-pixel windows disagree by up to 0.5 at the edges.
  const buf = new Float32Array(cap);
  for (let y = 0; y < N; y++) {
    buf.fill(0);
    for (let x = 0; x < N; x++) {
      let k = 0;
      for (let j = -halfA; j <= halfA; j++) {
        const yy = y + j;
        if (yy < 0 || yy >= N) continue;
        for (let i = -halfB; i <= halfB; i++) {
          const xx = x + i;
          if (xx < 0 || xx >= N) continue;
          buf[k++] = data[yy * N + xx];
        }
      }
      buf.sort();
      const m = (cap / 2) | 0;
      out[y * N + x] = (buf[m - 1] + buf[m + 1]) * 0.5;
    }
  }
  return out;
}
/* ================================================================== colour */

/** GrayscaleConversion: Average=0, BT601=1, BT709=2, RedChannel=3. */
export function grayscale(data, N, channels, method = 1) {
  const out = new Float32Array(N * N);
  if (channels === 1) return Float32Array.from(data.subarray(0, N * N));
  for (let i = 0; i < N * N; i++) {
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    switch (method) {
      case 0: out[i] = (r + g + b) / 3; break;
      case 2: out[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b; break;
      case 3: out[i] = r; break;
      default: out[i] = 0.299 * r + 0.587 * g + 0.114 * b; break;
    }
  }
  return out;
}



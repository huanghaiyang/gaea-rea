/**
 * field.js — the single field abstraction used by every node of the graph.
 *
 * A Field is a square Float32Array plus metadata. Channel layout is one of:
 *   'height' — 1 float per pixel, nominal range [0,1] (values below 0 are legal, see clamp nodes)
 *   'mask'   — 1 float per pixel, nominal range [0,1]
 *   'flow'   — 1 float per pixel, non-negative accumulation
 *   'color'  — 4 floats per pixel (RGBA, linear 0..1)
 *
 * All helpers here are pure, allocation-explicit and NaN-safe. They are shared verbatim by
 * the browser engine, the worker and the Node test harness.
 */

export const CHANNELS = { height: 1, mask: 1, flow: 1, color: 4 };

/* ------------------------------------------------------------------ scalar helpers
 * Re-exported here (and also defined in coords.js) so kernels have a single import site
 * for "field maths". Duplicating two one-line functions is cheaper than an import cycle.
 */

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(e0, e1, x) {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
/** Guard every division in the engine: a zero or non-finite denominator yields `fallback`. */
export function safeDiv(a, b, fallback = 0) {
  return b === 0 || !Number.isFinite(b) ? fallback : a / b;
}

export function createField(size, channel = 'height', fill = 0) {
  const c = CHANNELS[channel] || 1;
  const data = new Float32Array(size * size * c);
  if (fill !== 0) data.fill(fill);
  return { size, channel, channels: c, data };
}

export function cloneField(f) {
  return { size: f.size, channel: f.channel, channels: f.channels, data: new Float32Array(f.data) };
}

/** Convert a field to single channel by taking the first component (luminance for color). */
export function toScalar(f) {
  if (f.channels === 1) return f;
  const n = f.size * f.size;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = 0.2126 * f.data[o] + 0.7152 * f.data[o + 1] + 0.0722 * f.data[o + 2];
  }
  return { size: f.size, channel: 'height', channels: 1, data: out };
}

export function isFiniteField(f) {
  const d = f.data;
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) return false;
  return true;
}

/** Replace NaN/Inf with a neutral value. Called defensively at graph boundaries. */
export function sanitize(f, neutral = 0) {
  const d = f.data;
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) d[i] = neutral;
  return f;
}

export function stats(f) {
  const d = f.data;
  let min = Infinity, max = -Infinity, sum = 0, sum2 = 0, count = 0;
  // stride over channels: sample every channel value for color, every pixel for scalar
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v; sum2 += v * v; count++;
  }
  if (count === 0) return { min: 0, max: 0, mean: 0, std: 0, count: 0 };
  const mean = sum / count;
  const variance = Math.max(0, sum2 / count - mean * mean);
  return { min, max, mean, std: Math.sqrt(variance), count };
}

export function minMax(f) {
  const s = stats(f);
  return [s.min, s.max];
}

/** In-place affine remap of every channel. */
export function remap(f, inMin, inMax, outMin, outMax) {
  const span = inMax - inMin;
  const s = span === 0 ? 0 : (outMax - outMin) / span;
  const d = f.data;
  for (let i = 0; i < d.length; i++) d[i] = outMin + (d[i] - inMin) * s;
  return f;
}

export function mapInPlace(f, fn) {
  const d = f.data;
  for (let i = 0; i < d.length; i++) d[i] = fn(d[i], i);
  return f;
}

export function mapToNew(f, fn) {
  const out = createField(f.size, f.channel);
  const d = f.data, o = out.data;
  for (let i = 0; i < d.length; i++) o[i] = fn(d[i], i);
  return out;
}

export function addInPlace(f, other, weight = 1) {
  const d = f.data, o = other.data;
  const n = Math.min(d.length, o.length);
  for (let i = 0; i < n; i++) d[i] += o[i] * weight;
  return f;
}

export function scaleInPlace(f, k) {
  const d = f.data;
  for (let i = 0; i < d.length; i++) d[i] *= k;
  return f;
}

/* ------------------------------------------------------------------ separable blur */

/** Build a normalized 1D kernel with reflect-101 boundary handling at application time. */
export function gaussianKernel1D(sigma, radius) {
  const r = Math.max(0, Math.min(256, Math.round(radius)));
  const k = new Float32Array(r * 2 + 1);
  if (r === 0) { k[0] = 1; return k; }
  const s = Math.max(1e-4, sigma);
  const denom = 2 * s * s;
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / denom);
    k[i + r] = v; sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Box kernel for cheap multi-pass approximation (3 box passes ~ gaussian). */
export function boxKernel1D(radius) {
  const r = Math.max(0, Math.min(512, Math.round(radius)));
  const k = new Float32Array(r * 2 + 1);
  const inv = 1 / (r * 2 + 1);
  k.fill(inv);
  return k;
}

function reflect(i, n) {
  if (n === 1) return 0;
  const period = 2 * n - 2;
  let m = ((i % period) + period) % period;
  if (m >= n) m = period - m;
  return m;
}

/**
 * Separable 1D convolution. Operates on the channel stride so colour fields blur per channel.
 * Deterministic and O(N^2 * (2r+1)) with two passes.
 */
export function convolveSeparable(f, kernel, channelStride = null) {
  const size = f.size;
  const stride = channelStride || f.channels;
  const src = f.data;
  const dst = new Float32Array(src.length);
  const r = (kernel.length - 1) >> 1;
  if (r === 0) { dst.set(src); return { size, channel: f.channel, channels: f.channels, data: dst }; }

  // horizontal
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < stride; c++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          const sx = reflect(x + k, size);
          acc += src[(row + sx) * stride + c] * kernel[k + r];
        }
        dst[(row + x) * stride + c] = acc;
      }
    }
  }
  // vertical
  const out = new Float32Array(src.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < stride; c++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          const sy = reflect(y + k, size);
          acc += dst[(sy * size + x) * stride + c] * kernel[k + r];
        }
        out[(y * size + x) * stride + c] = acc;
      }
    }
  }
  return { size, channel: f.channel, channels: f.channels, data: out };
}

/** Gaussian blur with radius in pixels. radius<=0 returns a copy. */
export function gaussianBlur(f, radius) {
  const r = Math.max(0, radius);
  if (r < 0.5) return cloneField(f);
  // sigma chosen so the kernel visually matches a "Radius" control: ~ r/2.5
  const sigma = Math.max(0.35, r / 2.5);
  return convolveSeparable(f, gaussianKernel1D(sigma, Math.ceil(r)));
}

/* ------------------------------------------------------------------ morphology */

/** Morphological kernel masks matching Gaea's Dilate/Deflate "Kernel" enum. */
export function morphKernel(kind, shape = 0) {
  const sq = kind === 'Rectangle' || shape > 0.5;
  const offsets = [];
  if (kind === 'Line') { offsets.push([-1, 0], [1, 0]); return offsets; }
  if (kind === 'LineVertical') { offsets.push([0, -1], [0, 1]); return offsets; }
  if (kind === 'Cross') { offsets.push([0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]); return offsets; }
  // Rectangle / square structure element
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) offsets.push([x, y]);
  if (!sq && shape > 0) {
    // "Shape" rounds the kernel: drop corners as shape grows
    return offsets.filter(([x, y]) => Math.abs(x) + Math.abs(y) <= (shape > 0.5 ? 1 : 2));
  }
  return offsets;
}

/**
 * Iterative morphological operator.
 *   mode = 'max'  -> Dilate (grow bright regions)
 *   mode = 'min'  -> Erode  (shrink bright regions, used by Deflate)
 */
export function morphology(f, mode, iterations = 1, kernel = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]], edge = 0) {
  const size = f.size;
  const stride = f.channels;
  let src = f.data;
  const iters = Math.max(0, Math.min(64, iterations | 0));
  let cur = src;
  for (let it = 0; it < iters; it++) {
    const out = new Float32Array(cur.length);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        for (let c = 0; c < stride; c++) {
          let best = mode === 'max' ? -Infinity : Infinity;
          for (let k = 0; k < kernel.length; k++) {
            const kx = x + kernel[k][0], ky = y + kernel[k][1];
            let sx, sy;
            if (edge === 2) { sx = ((kx % size) + size) % size; sy = ((ky % size) + size) % size; }
            else if (edge === 1) { sx = reflect(kx, size); sy = reflect(ky, size); }
            else { sx = kx < 0 ? 0 : kx >= size ? size - 1 : kx; sy = ky < 0 ? 0 : ky >= size ? size - 1 : ky; }
            const v = cur[(sy * size + sx) * stride + c];
            if (mode === 'max' ? v > best : v < best) best = v;
          }
          out[(y * size + x) * stride + c] = best;
        }
      }
    }
    cur = out;
  }
  return { size, channel: f.channel, channels: f.channels, data: cur };
}

/* ------------------------------------------------------------------ derivatives */

/** Simple central-difference slope magnitude, normalized to roughly [0, 1] for a unit field. */
export function slopeMagnitude(f, cellSize = 1) {
  const size = f.size;
  const src = f.channels === 1 ? f.data : toScalar(f).data;
  const out = new Float32Array(size * size);
  const inv = 1 / (2 * cellSize);
  for (let y = 0; y < size; y++) {
    const ym = y === 0 ? 0 : y - 1, yp = y === size - 1 ? size - 1 : y + 1;
    for (let x = 0; x < size; x++) {
      const xm = x === 0 ? 0 : x - 1, xp = x === size - 1 ? size - 1 : x + 1;
      const dx = (src[y * size + xp] - src[y * size + xm]) * inv;
      const dy = (src[yp * size + x] - src[ym * size + x]) * inv;
      out[y * size + x] = Math.sqrt(dx * dx + dy * dy);
    }
  }
  return { size, channel: 'mask', channels: 1, data: out };
}

/** Normals for lighting: returns a Float32Array of xyz triples. */export function computeNormals(f, strength = 1) {
  const size = f.size;
  const src = f.channels === 1 ? f.data : toScalar(f).data;
  const out = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    const ym = y === 0 ? 0 : y - 1, yp = y === size - 1 ? size - 1 : y + 1;
    for (let x = 0; x < size; x++) {
      const xm = x === 0 ? 0 : x - 1, xp = x === size - 1 ? size - 1 : x + 1;
      const dx = (src[y * size + xp] - src[y * size + xm]) * 0.5 * strength;
      const dy = (src[yp * size + x] - src[ym * size + x]) * 0.5 * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const o = (y * size + x) * 3;
      out[o] = nx / len; out[o + 1] = ny / len; out[o + 2] = nz / len;
    }
  }
  return out;
}

/** Histogram with `bins` buckets over [min,max]. Returns normalized cumulative. */
export function histogram(f, bins = 256, min = 0, max = 1) {
  const h = new Float64Array(bins);
  const d = f.channels === 1 ? f.data : toScalar(f).data;
  const span = max - min || 1;
  for (let i = 0; i < d.length; i++) {
    let t = (d[i] - min) / span;
    t = t < 0 ? 0 : t > 0.999999 ? 0.999999 : t;
    h[(t * bins) | 0]++;
  }
  let total = 0;
  for (let i = 0; i < bins; i++) total += h[i];
  const cdf = new Float64Array(bins);
  let acc = 0;
  for (let i = 0; i < bins; i++) { acc += h[i]; cdf[i] = total > 0 ? acc / total : 0; }
  return { hist: h, cdf, min, max, total };
}

/**
 * Histogram equalization LUT: maps [min,max] through the CDF, blended by `factor` (0..1).
 * Equivalent to Gaea's Equalize node when factor = 1.
 */
export function equalizeInPlace(f, factor = 1, min = 0, max = 1, bins = 512) {
  const { cdf } = histogram(f, bins, min, max);
  const d = f.data;
  const span = max - min || 1;
  const fcl = factor < 0 ? 0 : factor > 1 ? 1 : factor;
  if (fcl === 0) return f;
  for (let i = 0; i < d.length; i++) {
    let t = (d[i] - min) / span;
    t = t < 0 ? 0 : t > 0.999999 ? 0.999999 : t;
    const eq = cdf[(t * bins) | 0] * span + min;
    d[i] = d[i] + (eq - d[i]) * fcl;
  }
  return f;
}

/**
 * Percentile from a histogram, using the same binning the histogram used.
 * `q` is in 0..1. Returns a value inside [min, max].
 */
export function quantileFromHistogram(hg, q) {
  const { cdf, min, max } = hg;
  const bins = cdf.length;
  const target = Math.min(1, Math.max(0, q));
  // first bin whose cumulative mass reaches the target
  let lo = 0, hi = bins - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < target) lo = mid + 1; else hi = mid;
  }
  const binLo = min + (lo / bins) * (max - min);
  const binHi = min + ((lo + 1) / bins) * (max - min);
  const before = lo === 0 ? 0 : cdf[lo - 1];
  const within = cdf[lo] - before;
  const t = within > 1e-12 ? (target - before) / within : 0;
  return binLo + (binHi - binLo) * Math.min(1, Math.max(0, t));
}

/**
 * Autolevel: stretch a value window to [outMin, outMax].
 *
 * Gaea's Autolevel exposes no parameters, so the window is derived from the data. The default
 * window is the FULL min..max range, which is the plain meaning of "use the full available
 * height range". A non-zero `clipPercent` switches to a robust percentile window instead; it
 * is OFF by default because clipping is destructive on a skewed distribution (a terrain where
 * most of the area sits in the lower third gets its lowlands cut off and the result is no
 * longer confined to [0,1]).
 */
export function autolevelInPlace(f, outMin = 0, outMax = 1, clipPercent = 0, bins = 1024) {
  const scalar = f.channels === 1 ? f : toScalar(f);
  const s = stats(scalar);
  if (!(s.max - s.min > 1e-12)) {
    // constant field: map it to the middle of the output window
    const mid = (outMin + outMax) / 2;
    for (let i = 0; i < f.data.length; i++) f.data[i] = mid;
    return f;
  }
  let lo = s.min, hi = s.max;
  if (clipPercent > 0) {
    const hg = histogram(scalar, bins, s.min, s.max);
    lo = quantileFromHistogram(hg, clipPercent);
    hi = quantileFromHistogram(hg, 1 - clipPercent);
    if (!(hi - lo > 1e-12)) { lo = s.min; hi = s.max; }
  }
  return remap(f, lo, hi, outMin, outMax);
}

/* ------------------------------------------------------------------ seam / wrap helpers */

/** Apply a smooth radial falloff, used by generators that must not leave a hard frame. */
export function radialFalloffMask(size, start = 0.7, end = 1.0, mode = 'smooth') {
  const out = new Float32Array(size * size);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv * 2 - 1;
      const r = Math.sqrt(u * u + v * v) / Math.SQRT2;
      let t = (r - start) / Math.max(1e-6, end - start);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      out[y * size + x] = mode === 'linear' ? 1 - t : 1 - (t * t * (3 - 2 * t));
    }
  }
  return out;
}

/** Directional gradient ramp across the field, 0..1, along `angle` radians. */
export function linearGradientMask(size, angle = 0, center = 0.5, width = 1) {
  const out = new Float32Array(size * size);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv - 0.5;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv - 0.5;
      let t = (u * ca + v * sa) / Math.max(1e-6, width) + 0.5 + center;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      out[y * size + x] = t;
    }
  }
  return out;
}

/**
 * filters.js 鈥?kernels that TRANSFORM a field (1 or 2 input ports).
 *
 * Signatures: (ctx) => Field, with ctx = { size, params, input(i), seed, worldSize }.
 * Parameter names are the exact Gaea names from data/nodes.json.
 */

import {
  perlin2, value2, worley2, fractalSum,
} from '../kernel/noise.js';
import {
  createField, cloneField, toScalar, stats, clamp01, clamp, lerp, smoothstep, safeDiv,
  gaussianBlur, morphology, morphKernel, convolveSeparable, gaussianKernel1D, equalizeInPlace,
  autolevelInPlace, remap,
} from '../kernel/field.js';

function P(params, name, dflt) {
  const v = params ? params[name] : undefined;
  if (v === undefined || v === null) return dflt;
  if (typeof v === 'number') return Number.isFinite(v) ? v : dflt;
  return v;
}

/** Default input when a port is unconnected: neutral mid-height or a fallback. */
function inOr(ctx, i, dflt = 0.5) {
  const f = ctx.input(i);
  if (f) return f;
  return createField(ctx.size, 'height', dflt);
}

/** Scalar view of a field (first channel). */
function scalarOf(f) { return f.channels === 1 ? f : toScalar(f); }

/* ================================================================== Adjust */

/**
 * Adjust 鈥?the composite Fx node. Order of operations follows the panel order:
 *   Multiply -> Shaper (gamma/pivot) -> Clamp -> Clip -> Autolevel -> Equalize ->
 *   Strong (S-curve contrast) -> Invert -> Drop (remap to 0..1).
 * Gaea's exact ordering is not documented; this order is monotone and stable, and each
 * control's effect is individually verifiable.
 */
export function adjust(ctx) {
  const { size, params } = ctx;
  let f = cloneField(inOr(ctx, 0));
  const mult = P(params, 'Multiply', 1);
  const shaper = P(params, 'Shaper', 1);
  const clampV = P(params, 'Clamp', [-1e9, 1e9]);
  const clipV = P(params, 'Clip', [-1e9, 1e9]);
  const drop = P(params, 'Drop', false);
  const doAuto = P(params, 'Autolevel', false);
  const doEq = P(params, 'Equalize', false);
  const strong = P(params, 'Strong', false);
  const invert = P(params, 'Invert', false);

  const d = f.data;
  const cm = Array.isArray(clampV) ? clampV : [-1e9, 1e9];
  const cl = Array.isArray(clipV) ? clipV : [-1e9, 1e9];
  const lo = Math.min(cm[0], cm[1]), hi = Math.max(cm[0], cm[1]);
  const clo = Math.min(cl[0], cl[1]), chi = Math.max(cl[0], cl[1]);

  if (mult !== 1 || shaper !== 1 || lo > -1e8 || hi < 1e8 || clo > -1e8 || chi < 1e8 || invert) {
    const invShaper = 1 / Math.max(1e-4, shaper);
    for (let i = 0; i < d.length; i++) {
      let v = d[i] * mult;
      if (shaper !== 1) v = v <= 0 ? 0 : Math.pow(v, invShaper);
      if (v < lo) v = lo; else if (v > hi) v = hi;
      if (v < clo) v = clo; else if (v > chi) v = chi;
      d[i] = v;
    }
  }
  if (doAuto) autolevelInPlace(f, 0, 1, 0);
  if (doEq) equalizeInPlace(f, 1, 0, 1, 512);
  if (strong) {
    for (let i = 0; i < d.length; i++) {
      const t = clamp01(d[i]);
      d[i] = (t * t * (3 - 2 * t)) * 0.65 + t * 0.35;
    }
  }
  if (invert) for (let i = 0; i < d.length; i++) d[i] = 1 - d[i];
  if (drop) {
    const s = stats(scalarOf(f));
    if (s.max - s.min > 1e-9) remap(f, s.min, s.max, 0, 1);
  }
  return f;
}

/** Clamp 鈥?Standard clamps to Value lo..hi; Normalized first autolevels then clamps. */
export function clampNode(ctx) {
  const { params } = ctx;
  let f = cloneField(inOr(ctx, 0));
  const mode = P(params, 'Mode', 'Standard');
  const v = P(params, 'Value', [0, 1]);
  const drop = P(params, 'Drop', false);
  const arr = Array.isArray(v) ? v : [0, 1];
  const lo = Math.min(arr[0], arr[1]), hi = Math.max(arr[0], arr[1]);
  if (mode === 'Normalized') autolevelInPlace(f, 0, 1, 0);
  const d = f.data;
  for (let i = 0; i < d.length; i++) {
    let x = d[i];
    if (x < lo) x = lo; else if (x > hi) x = hi;
    d[i] = x;
  }
  if (drop) remap(f, lo, hi, 0, 1);
  return f;
}

/** Autolevel 鈥?no exposed parameters in Gaea; robust percentile stretch to [0,1]. */
export function autolevel(ctx) {
  const f = cloneField(inOr(ctx, 0));
  return autolevelInPlace(f, 0, 1, 0);
}

/** Equalize 鈥?histogram equalization with a blend Factor. */
export function equalize(ctx) {
  const { params } = ctx;
  const factor = clamp01(P(params, 'Factor', 1));
  const f = cloneField(inOr(ctx, 0));
  return equalizeInPlace(f, factor, 0, 1, 512);
}

/**
 * Extend 鈥?stretch the field so that the requested Value range maps to the full 0..1 range.
 * Gaea's Extend "expands the terrain range beyond its current limits".
 */
export function extend(ctx) {
  const { params } = ctx;
  const f = cloneField(inOr(ctx, 0));
  const v = P(params, 'Value', [0, 1]);
  const arr = Array.isArray(v) ? v : [0, 1];
  const lo = Math.min(arr[0], arr[1]), hi = Math.max(arr[0], arr[1]);
  if (hi - lo < 1e-9) return f;
  return remap(f, lo, hi, 0, 1);
}

/** Clip 鈥?hard cut against Min/Max, Auto Clip derives the ceiling from the data. */
export function clip(ctx) {
  const { params } = ctx;
  const f = cloneField(inOr(ctx, 0));
  const auto = P(params, 'Auto Clip', false);
  let lo = P(params, 'Min', 0);
  let hi = P(params, 'Max', 1);
  if (auto) {
    const s = stats(scalarOf(f));
    lo = Math.max(lo, s.min);
    hi = Math.min(hi, s.max);
  }
  const d = f.data;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    d[i] = x < lo ? 0 : x > hi ? hi : x;
  }
  return f;
}

/** Invert 鈥?1 - v, exposed on several nodes as a Boolean. */
export function invert(ctx) {
  const f = cloneField(inOr(ctx, 0));
  const d = f.data;
  for (let i = 0; i < d.length; i++) d[i] = 1 - d[i];
  return f;
}

/** Flip 鈥?X / Y / XY mirror with exact index reversal. */
export function flip(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0);
  const type = P(params, 'Type', 'X');
  const stride = src.channels;
  const out = createField(size, src.channel);
  const s = src.data, o = out.data;
  const doX = type === 'X' || type === 'XY';
  const doY = type === 'Y' || type === 'XY';
  for (let y = 0; y < size; y++) {
    const sy = doY ? size - 1 - y : y;
    for (let x = 0; x < size; x++) {
      const sx = doX ? size - 1 - x : x;
      for (let c = 0; c < stride; c++) {
        o[(y * size + x) * stride + c] = s[(sy * size + sx) * stride + c];
      }
    }
  }
  return out;
}

/* ================================================================== Curve */

/** Monotone cubic (PCHIP) interpolation through the control points. */
export function pchipEval(xs, ys, x) {
  const n = xs.length;
  if (n === 0) return x;
  if (n === 1) return ys[0];
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let k = 0;
  while (k < n - 2 && x > xs[k + 1]) k++;
  const h = xs[k + 1] - xs[k];
  if (h <= 0) return ys[k];
  const t = (x - xs[k]) / h;
  // derivatives (Fritsch-Carlson)
  const d = new Array(n);
  for (let i = 1; i < n - 1; i++) {
    const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i];
    const s0 = (ys[i] - ys[i - 1]) / (h0 || 1e-9);
    const s1 = (ys[i + 1] - ys[i]) / (h1 || 1e-9);
    d[i] = (s0 * s1 <= 0) ? 0 : (s0 + s1) / 2;
  }
  d[0] = (ys[1] - ys[0]) / (xs[1] - xs[0] || 1e-9);
  d[n - 1] = (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2] || 1e-9);
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return h00 * ys[k] + h10 * h * (d[k] ?? 0) + h01 * ys[k + 1] + h11 * h * (d[k + 1] ?? 0);
}

/** Build a lookup table from curve control points for fast application. */
export function curveLUT(points, bins = 1024) {
  const pts = (points && points.length >= 2 ? points : [[0, 0], [1, 1]]).slice().sort((a, b) => a[0] - b[0]);
  const xs = pts.map((p) => clamp01(p[0]));
  const ys = pts.map((p) => p[1]);
  const lut = new Float32Array(bins + 1);
  for (let i = 0; i <= bins; i++) lut[i] = pchipEval(xs, ys, i / bins);
  return lut;
}

/**
 * Curve 鈥?spline remap of the height curve.
 * Mode Absolute resets the output range to 0..1; Relative keeps the input's range and moves
 * values by the curve's delta. The control spline arrives as the "Curve Spline" list param.
 */
export function curve(ctx) {
  const { params } = ctx;
  const f = cloneField(inOr(ctx, 0));
  const mode = P(params, 'Mode', 'Absolute');
  const spline = P(params, 'Curve Spline', null);
  const s = stats(scalarOf(f));
  const lo = Math.min(0, s.min), hi = Math.max(1, s.max);
  const lut = curveLUT(spline, 1024);

  if (mode === 'Absolute') {
    const d = f.data;
    const span = hi - lo || 1;
    for (let i = 0; i < d.length; i++) {
      let t = (d[i] - lo) / span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      d[i] = lut[(t * 1024) | 0];
    }
  } else {
    const d = f.data;
    const span = hi - lo || 1;
    for (let i = 0; i < d.length; i++) {
      let t = (d[i] - lo) / span;
      t = t < 0 ? 0 : t > 0.999999 ? 0.999999 : t;
      d[i] = clamp01(d[i] + (lut[(t * 1024) | 0] - t) * span * 0.5);
    }
  }
  return f;
}

/* ================================================================== Warp */

/**
 * Warp 鈥?domain warp of input 0, using input 1 as the warp source when connected.
 *
 * Modes:
 *   Bitmap             鈥?standard displacement: uv += (source-0.5)*strength
 *   VectorField        鈥?direction from the source's gradient, magnitude from its value
 *   VectorFieldIntegral鈥?as VectorField, iterated (a.k.a. "Integral" / iterative warp)
 *
 * "Perturbation" adds a high-frequency jitter on top of the warp vector, which is what makes
 * Gaea's Warp look filamentary rather than merely smeared.
 */
export function warp(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0);
  const warpSrc = ctx.input(1);

  const wsize = Math.max(0.5, P(params, 'Size', 100));
  const strength = P(params, 'Strength', 0.5);
  const source = P(params, 'Warp Source', 'PerlinFBM');
  // "Z Scale" drives the third axis of the procedural warp source: it offs/advances the
  // lattice along a slow sine of the field, which is what gives a 2D warp its volumetric feel.
  const zPhase = P(params, 'Z Scale', 0.5) * 8;
  const perturbation = clamp01(P(params, 'Perturbation', 0));
  const complexity = Math.max(1, P(params, 'Complexity', 3) | 0);
  const roughness = clamp01(P(params, 'Roughness', 0.5));
  const normalized = P(params, 'Normalized', false);
  const edgeBehaviour = P(params, 'Edge Behaviour', 'Edge');
  const modulation = P(params, 'Modulation', 0);
  const modDir = P(params, 'Modulation Direction', 0);
  const iterations = Math.max(1, Math.min(16, P(params, 'Iterations', 1) | 0));
  const mode = P(params, 'Mode', 'Bitmap');

  const stride = src.channels;
  const out = createField(size, src.channel);
  const s = src.data, o = out.data;
  const inv = 1 / size;
  const freq = Math.max(0.25, (wsize / 100) * 4);
  const period = Math.max(1, Math.round(freq));
  const amt = strength * 0.5;
  const edge = edgeBehaviour === 'Mirror' ? 1 : 0;
  const mAng = (modDir / 360) * Math.PI * 2;
  const mdx = Math.cos(mAng) * modulation, mdy = Math.sin(mAng) * modulation;

  // pre-fetch the warp source as scalar
  const ws = warpSrc ? scalarOf(warpSrc) : null;

  const sampleSrc = (fx, fy) => {
    // bilinear on the scalar source field, mirror or clamp at the border
    const sizeM1 = size - 1;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    let x1 = x0 + 1, y1 = y0 + 1;
    const fix = (v) => {
      let m = v;
      if (edge === 1) {
        const per = 2 * size - 2;
        m = ((m % per) + per) % per;
        if (m >= size) m = per - m;
      } else {
        m = m < 0 ? 0 : m > sizeM1 ? sizeM1 : m;
      }
      return m;
    };
    x0 = fix(x0); x1 = fix(x1); y0 = fix(y0); y1 = fix(y1);
    const a = s[(y0 * size + x0) * stride], b = s[(y0 * size + x1) * stride];
    const c = s[(y1 * size + x0) * stride], d = s[(y1 * size + x1) * stride];
    const top = a + (b - a) * tx, bot = c + (d - c) * tx;
    return top + (bot - top) * ty;
  };
  const sampleSrcChannel = (fx, fy, ch) => {
    const sizeM1 = size - 1;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    let x1 = x0 + 1, y1 = y0 + 1;
    const fix = (v) => {
      let m = v;
      if (edge === 1) {
        const per = 2 * size - 2;
        m = ((m % per) + per) % per;
        if (m >= size) m = per - m;
      } else {
        m = m < 0 ? 0 : m > sizeM1 ? sizeM1 : m;
      }
      return m;
    };
    x0 = fix(x0); x1 = fix(x1); y0 = fix(y0); y1 = fix(y1);
    const a = s[(y0 * size + x0) * stride + ch], b = s[(y0 * size + x1) * stride + ch];
    const c = s[(y1 * size + x0) * stride + ch], d = s[(y1 * size + x1) * stride + ch];
    const top = a + (b - a) * tx, bot = c + (d - c) * tx;
    return top + (bot - top) * ty;
  };

  for (let y = 0; y < size; y++) {
    const v0 = (y + 0.5) * inv - 0.5;
    for (let x = 0; x < size; x++) {
      const u0 = (x + 0.5) * inv - 0.5;
      let wx = 0, wy = 0;

      if (ws) {
        const sv = ws.data[y * size + x];
        const svN = normalized ? sv * 2 - 1 : sv;
        if (mode === 'VectorField' || mode === 'VectorFieldIntegral') {
          const xm = x < 1 ? 0 : x - 1, xp = x > size - 2 ? size - 1 : x + 1;
          const ym = y < 1 ? 0 : y - 1, yp = y > size - 2 ? size - 1 : y + 1;
          const gx = ws.data[y * size + xp] - ws.data[y * size + xm];
          const gy = ws.data[yp * size + x] - ws.data[ym * size + x];
          wx = -gy * svN;
          wy = gx * svN;
        } else {
          // Bitmap: sample the source's R and G channels for the two displacement axes
          const nc = Math.min(2, warpSrc.channels);
          wx = (sampleSrcChannel(x, y, 0) - 0.5) * 2;
          wy = nc > 1 ? (sampleSrcChannel(x, y, 1) - 0.5) * 2 : svN * 0.6;
          wx *= (normalized ? 1 : 0.5);
          wy *= (normalized ? 1 : 0.5);
        }
      } else {
        // procedural warp source
        switch (source) {
          case 'VoronoiR': case 'VoronoiP': case 'VoronoiA': case 'VoronoiS':
          case 'VoronoiM': case 'VoronoiD': {
            const w = worley2(u0 * freq, v0 * freq, seed, { jitter: 0.9 });
            wx = w.f1 * 2 - 1;
            wy = (w.f2 - w.f1) * 2 - 1;
            break;
          }
          default: {
            // A slow "z" drift separates the two displacement axes in the third dimension,
            // which is what Z Scale controls.
            const zOff = zPhase * 0.35;
            wx = fractalSum(perlin2, u0 * freq, v0 * freq + zOff, seed ^ 0x1234, complexity, 2, roughness, 'Standard', period);
            wy = fractalSum(perlin2, u0 * freq + 37.1, v0 * freq - 19.7 - zOff, seed ^ 0x5678, complexity, 2, roughness, 'Standard', period);
            break;
          }
        }
      }

      if (perturbation > 0) {
        wx += (value2(u0 * freq * 8, v0 * freq * 8, seed ^ 0xabc) - 0.5) * perturbation * 2;
        wy += (value2(u0 * freq * 8 + 5.5, v0 * freq * 8 - 3.3, seed ^ 0xdef) - 0.5) * perturbation * 2;
      }
      wx = wx + mdx; wy = wy + mdy;

      const iters = mode === 'VectorFieldIntegral' ? iterations : 1;
      let fu = u0, fv = v0;
      for (let it = 0; it < iters; it++) {
        fu += wx * amt / iters;
        fv += wy * amt / iters;
      }

      const px = (fu + 0.5) * size - 0.5;
      const py = (fv + 0.5) * size - 0.5;
      for (let c = 0; c < stride; c++) {
        o[(y * size + x) * stride + c] = sampleSrcChannel(px, py, c);
      }
    }
  }
  return out;
}

/**
 * DirectionalWarp 鈥?displace input 0 along a uniform direction, driven by input 1's value.
 * Direction is an angle in degrees; Edge Behaviour selects clamp vs mirror resampling.
 */
export function directionalWarp(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0);
  const driverF = ctx.input(1);
  const strength = P(params, 'Strength', 0.5);
  const direction = P(params, 'Direction', 0);
  const edgeB = P(params, 'Edge Behaviour', 'Edge');

  const stride = src.channels;
  const s = src.data;
  const out = createField(size, src.channel);
  const o = out.data;
  const ang = (direction / 360) * Math.PI * 2;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const edge = edgeB === 'Mirror' ? 1 : 0;
  const sizeM1 = size - 1;
  const fix = (v) => {
    if (edge === 1) {
      const per = 2 * size - 2;
      let m = ((v % per) + per) % per;
      if (m >= size) m = per - m;
      return m;
    }
    return v < 0 ? 0 : v > sizeM1 ? sizeM1 : v;
  };
  const drv = driverF ? scalarOf(driverF).data : null;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = drv ? drv[y * size + x] : 0.5;
      const amp = (d - 0.5) * 2 * strength * size * 0.25;
      const fx = x + dx * amp;
      const fy = y + dy * amp;
      let x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const x1 = x0 + 1, y1 = y0 + 1;
      const ax0 = fix(x0), ax1 = fix(x1), ay0 = fix(y0), ay1 = fix(y1);
      for (let c = 0; c < stride; c++) {
        const a = s[(ay0 * size + ax0) * stride + c], b = s[(ay0 * size + ax1) * stride + c];
        const cc = s[(ay1 * size + ax0) * stride + c], dd = s[(ay1 * size + ax1) * stride + c];
        const top = a + (b - a) * tx, bot = cc + (dd - cc) * tx;
        o[(y * size + x) * stride + c] = top + (bot - top) * ty;
      }
    }
  }
  return out;
}

/* ================================================================== Blur family */

/** Blur 鈥?isotropic gaussian; Radius is in pixels. */
export function blur(ctx) {
  const { params } = ctx;
  const radius = Math.max(0, P(params, 'Radius', 4));
  return gaussianBlur(inOr(ctx, 0), radius);
}

/**
 * Deflate 鈥?pulls terrain features inward. Implemented as iterative grayscale erosion
 * (running minimum) blended by Amount, with a short blur to remove the blocky stair-step
 * that raw erosion leaves behind.
 */
export function deflate(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0);
  const amount = clamp01(P(params, 'Amount', 0.5));
  if (amount <= 0) return cloneField(src);
  const iterations = Math.max(1, Math.round(1 + amount * 6));
  const eroded = morphology(src, 'min', iterations, morphKernel('Rectangle', 1), 1);
  const smoothed = gaussianBlur(eroded, Math.max(0.8, iterations * 0.9));
  const o = new Float32Array(src.data.length);
  const a = smoothed.data, b = src.data;
  for (let i = 0; i < o.length; i++) o[i] = b[i] + (a[i] - b[i]) * amount;
  return { size, channel: src.channel, channels: src.channels, data: o };
}

/**
 * Dilate 鈥?grows bright regions. Size scales the structure element, Shape rounds it,
 * Iterations repeats it, Kernel picks the element, Invert flips before/after.
 */
export function dilate(ctx) {
  const { size, params } = ctx;
  const src = cloneField(inOr(ctx, 0));
  const sz = P(params, 'Size', 1);
  const shape = clamp01(P(params, 'Shape', 0));
  const iterations = Math.max(1, Math.min(32, P(params, 'Iterations', 1) | 0));
  const kernelName = P(params, 'Kernel', 'Cross');
  const inv = P(params, 'Invert', false);

  const expand = Math.max(1, Math.round(1 + sz * 2));
  const base = morphKernel(kernelName, shape);
  const kernel = [];
  for (let e = 0; e < expand; e++) {
    for (const [kx, ky] of base) kernel.push([kx * e, ky * e]);
  }
  if (inv) { const d = src.data; for (let i = 0; i < d.length; i++) d[i] = 1 - d[i]; }
  const out = morphology(src, 'max', iterations, kernel, 1);
  if (inv) { const d = out.data; for (let i = 0; i < d.length; i++) d[i] = 1 - d[i]; }
  return out;
}

/**
 * Denoise 鈥?noise removal.
 *   OnePass / TwoPass : edge-preserving heat diffusion (Perona-Malik style) passes
 *   Pixels            : isolated-pixel removal via a 3x3 median when the pixel deviates
 *                       from its neighbourhood by more than Amount
 * Gaea's exact filter is unknown; these are the standard replacements.
 */
export function denoise(ctx) {
  const { size, params } = ctx;
  const type = P(params, 'Type', 'OnePass');
  const amount = clamp01(P(params, 'Amount', 0.5));
  const passes = Math.max(1, Math.min(16, P(params, 'Passes', 2) | 0));
  const src = cloneField(inOr(ctx, 0));

  if (amount <= 0) return src;
  const stride = src.channels;
  let cur = src.data;

  if (type === 'Pixels') {
    // isolated pixel removal
    const k = amount * 0.5;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        for (let c = 0; c < stride; c++) {
          const v = cur[i * stride + c];
          const neigh = [];
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = clamp(x + dx, 0, size - 1), ny = clamp(y + dy, 0, size - 1);
              neigh.push(cur[(ny * size + nx) * stride + c]);
            }
          }
          neigh.sort((a, b) => a - b);
          const med = neigh[neigh.length >> 1];
          if (Math.abs(v - med) > k) cur[i * stride + c] = v + (med - v) * amount;
        }
      }
    }
    return { size, channel: src.channel, channels: src.channels, data: cur };
  }

  const iters = type === 'TwoPass' ? passes * 2 : passes;
  const lambda = Math.min(0.24, 0.06 + amount * 0.18); // stability requires lambda <= 0.25
  const kappa = 0.01 + amount * 0.06;
  for (let it = 0; it < iters; it++) {
    const next = new Float32Array(cur.length);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        for (let c = 0; c < stride; c++) {
          const v = cur[i * stride + c];
          let flux = 0;
          const nb = [[-1, 0], [1, 0], [0, -1], [0, 1]];
          for (let n = 0; n < 4; n++) {
            const nx = x + nb[n][0], ny = y + nb[n][1];
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            const dv = cur[(ny * size + nx) * stride + c] - v;
            // Perona-Malik conductance: strong gradients diffuse little (edges preserved)
            const g = 1 / (1 + (dv / kappa) * (dv / kappa));
            flux += g * dv;
          }
          next[i * stride + c] = v + lambda * flux;
        }
      }
    }
    cur = next;
  }
  return { size, channel: src.channel, channels: src.channels, data: cur };
}

/* ================================================================== Combine family */

/** Scalar blend functions matching Gaea's 24 Combine modes. */
export function combineValues(a, b, mode, ratio) {
  const t = ratio;
  switch (mode) {
    case 'Add': return a + b;
    case 'Screen': return 1 - (1 - a) * (1 - b);
    case 'Subtract': return a - b;
    case 'Difference': return Math.abs(a - b);
    case 'Multiply': return a * b;
    case 'Divide': return safeDiv(a, b, 0);
    case 'Divide2': return safeDiv(b, a, 0);
    case 'Max': return Math.max(a, b);
    case 'Min': return Math.min(a, b);
    case 'Hypotenuse': return Math.sqrt(a * a + b * b);
    case 'Overlay': return a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    case 'Power': return Math.pow(Math.abs(a), Math.abs(b));
    case 'Exclusion': return a + b - 2 * a * b;
    case 'Dodge': return b >= 1 ? 1 : clamp01(a / (1 - b));
    case 'Burn': return b <= 0 ? 0 : clamp01(1 - (1 - a) / b);
    case 'SoftLight': {
      const v = b < 0.5 ? 2 * a * b + a * a * (1 - 2 * b) : 2 * a * (1 - b) + Math.sqrt(Math.max(0, a)) * (2 * b - 1);
      return clamp01(v);
    }
    case 'HardLight':
      return b < 0.5 ? clamp01(2 * a * b) : clamp01(1 - 2 * (1 - a) * (1 - b));
    case 'PinLight':
      return b < 0.5 ? Math.min(a, 2 * b) : Math.max(a, 2 * b - 1);
    case 'GrainMerge': return a + b - 0.5;
    case 'GrainExtract': return a - b + 0.5;
    case 'Reflect': return b >= 1 ? 1 : clamp01(a * a / (1 - b));
    case 'Glow': return b >= 1 ? 1 : clamp01(a * a / (1 - b) + 2 * a * b);
    case 'Phoenix': return Math.min(a, b) - Math.max(a, b) + 1;
    case 'Blend':
    default: return a + (b - a) * t;
  }
}

/**
 * Combine 鈥?the core two-input operator. Ratio drives Blend (and scales additive modes by
 * convention: it is the mix weight for every mode that is not a pure arithmetic op).
 * Output None|Clamp|Extend post-processes; Enhance applies Autolevel or Equalize.
 */
export function combine(ctx) {
  const { size, params } = ctx;
  const mode = P(params, 'Mode', 'Blend');
  const ratio = P(params, 'Ratio', 0.5);
  const output = P(params, 'Output', 'None');
  const enhance = P(params, 'Enhance', 'None');

  const a = inOr(ctx, 0, 0.5);
  const bF = ctx.input(1);
  const b = bF || createField(size, 'height', 0.5);
  const strideA = a.channels, strideB = b.channels;
  const outChannels = Math.max(strideA, strideB);
  const out = createField(size, outChannels === 4 ? 'color' : a.channel);
  const da = a.data, db = b.data, o = out.data;
  const isBlend = mode === 'Blend' || mode === 'Blend2';

  for (let i = 0; i < size * size; i++) {
    for (let c = 0; c < outChannels; c++) {
      const av = da[i * strideA + (c < strideA ? c : 0)];
      const bv = db[i * strideB + (c < strideB ? c : 0)];
      let v = combineValues(av, bv, mode, ratio);
      if (!isBlend && mode !== 'Add' && mode !== 'Subtract' && mode !== 'Difference') {
        // partial-ratio blending for all non-mixing modes keeps Ratio meaningful
        v = av + (v - av) * ratio;
      }
      o[i * outChannels + c] = Number.isFinite(v) ? v : av;
    }
  }
  const f = { size, channel: out.channel, channels: out.channels, data: o };
  if (output === 'Clamp') { for (let i = 0; i < o.length; i++) o[i] = clamp01(o[i]); }
  else if (output === 'Extend') {
    const s = stats(outChannels === 1 ? f : scalarOf(f));
    if (s.max - s.min > 1e-9) remap(f, s.min, s.max, 0, 1);
  }
  if (enhance === 'Autolevel') autolevelInPlace(f, 0, 1, 0);
  else if (enhance === 'Equalize') equalizeInPlace(f, 1, 0, 1, 512);
  return f;
}

/* ================================================================== Mask family */

/**
 * Mask 鈥?modulate input 0 by the mask on input 1.
 * Not a documented Gaea behaviour (the Mask node itself is a drawing primitive); this
 * implements the conventional mask semantics used across Gaea's graph: mask 1 = keep,
 * mask 0 = neutral (mid-height). Mode/Amount are honored when present on the node.
 */
export function maskApply(ctx) {
  const { size, params } = ctx;
  const a = inOr(ctx, 0, 0.5);
  const m = ctx.input(1);
  if (!m) return cloneField(a);
  const amount = P(params, 'Amount', 1);
  const invertMask = P(params, 'Invert', false);
  const stride = a.channels;
  const ms = scalarOf(m).data;
  const out = createField(size, a.channel);
  const o = out.data, da = a.data;
  for (let i = 0; i < size * size; i++) {
    let mval = clamp01(ms[i]);
    if (invertMask) mval = 1 - mval;
    const w = 1 - (1 - mval) * amount;
    for (let c = 0; c < stride; c++) {
      const v = da[i * stride + c];
      o[i * stride + c] = v + (0.5 - v) * (1 - w);
    }
  }
  return out;
}

/** Blend-style mask: keep = input0 where mask=1, input1 elsewhere. */
export function maskBlend(ctx) {
  const { size } = ctx;
  const a = inOr(ctx, 0, 0.5);
  const bF = ctx.input(1);
  const mF = ctx.input(2);
  if (!bF && !mF) return cloneField(a);
  const b = bF || createField(size, 'height', 0.5);
  const m = mF ? scalarOf(mF).data : null;
  const stride = a.channels;
  const out = createField(size, a.channel);
  const o = out.data, da = a.data, db = b.data;
  for (let i = 0; i < size * size; i++) {
    const w = m ? clamp01(m[i]) : 1;
    for (let c = 0; c < stride; c++) o[i * stride + c] = lerp(db[i * stride + c], da[i * stride + c], w);
  }
  return out;
}


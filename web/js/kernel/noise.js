/**
 * noise.js — the deterministic noise basis used by every primitive node.
 *
 * Nominal output range for every function here is roughly [-1, 1] (gradient / value noise)
 * or [0, 1] where the name says so. Nothing here depends on Math.random(), so a build is
 * bit-reproducible for a given seed.
 *
 * Tiling: when `period` > 0 the lattice is wrapped with a positive modulo, which makes the
 * field seamlessly tileable across the [0,period)^2 lattice. Callers pass period = scale
 * (noise cycles across the field) to get a tile that has no visible seam.
 */

import { hash2f, hash3f, grad2, mix32 } from './hash.js';

/* ------------------------------------------------------------------ lattice utils */

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** Positive modulo that also handles the period<=0 (no tiling) case cheaply. */
function wrap(v, period) {
  if (period <= 0) return v;
  const m = v % period;
  return m < 0 ? m + period : m;
}

/* ------------------------------------------------------------------ gradient noise */

/** 2D Perlin-style gradient noise. Output roughly [-0.71, 0.71] before scaling. */
export function perlin2(x, y, seed = 0, period = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = wrap(xi, period), x1 = wrap(xi + 1, period);
  const y0 = wrap(yi, period), y1 = wrap(yi + 1, period);

  const g00 = grad2(x0, y0, seed), g10 = grad2(x1, y0, seed);
  const g01 = grad2(x0, y1, seed), g11 = grad2(x1, y1, seed);

  const n00 = g00[0] * xf + g00[1] * yf;
  const n10 = g10[0] * (xf - 1) + g10[1] * yf;
  const n01 = g01[0] * xf + g01[1] * (yf - 1);
  const n11 = g11[0] * (xf - 1) + g11[1] * (yf - 1);

  const u = fade(xf), v = fade(yf);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4142135623730951;
}

/** 2D value noise, output [0,1]. Cheaper, blockier, useful for masks and DotNoise. */
export function value2(x, y, seed = 0, period = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = wrap(xi, period), x1 = wrap(xi + 1, period);
  const y0 = wrap(yi, period), y1 = wrap(yi + 1, period);
  const v00 = hash2f(x0, y0, seed), v10 = hash2f(x1, y0, seed);
  const v01 = hash2f(x0, y1, seed), v11 = hash2f(x1, y1, seed);
  const u = fade(xf), v = fade(yf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}

/** 3D value noise, output [0,1]. */
export function value3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const c = (dx, dy, dz) => hash3f(xi + dx, yi + dy, zi + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

/** 3D gradient noise, output roughly [-1,1]. Used by Cellular3D-style volumetric breakup. */
export function perlin3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const grad = (dx, dy, dz, px, py, pz) => {
    const h = mix32(xi + dx, yi + dy, Math.imul(zi + dz, 0x9e3779b1) ^ seed);
    const a = ((h >>> 24) & 255) * 0.02454369260617026; // * (2pi/256)
    const b = ((h >>> 16) & 255) * 0.02454369260617026;
    const gz = (h & 511) / 511 * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - gz * gz));
    return Math.cos(a) * r * px + Math.sin(a) * r * py + gz * pz;
  };
  const n000 = grad(0, 0, 0, xf, yf, zf);
  const n100 = grad(1, 0, 0, xf - 1, yf, zf);
  const n010 = grad(0, 1, 0, xf, yf - 1, zf);
  const n110 = grad(1, 1, 0, xf - 1, yf - 1, zf);
  const n001 = grad(0, 0, 1, xf, yf, zf - 1);
  const n101 = grad(1, 0, 1, xf - 1, yf, zf - 1);
  const n011 = grad(0, 1, 1, xf, yf - 1, zf - 1);
  const n111 = grad(1, 1, 1, xf - 1, yf - 1, zf - 1);
  const x00 = lerp(n000, n100, u), x10 = lerp(n010, n110, u);
  const x01 = lerp(n001, n101, u), x11 = lerp(n011, n111, u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 1.1547005383792517;
}

/** Ridged variant of perlin2, output [0,1] with sharp crests. Used by Mountain/Ridge. */
export function ridged2(x, y, seed = 0, period = 0, sharpness = 1) {
  const n = perlin2(x, y, seed, period);
  const r = 1 - Math.abs(n);
  return Math.pow(r < 0 ? 0 : r > 1 ? 1 : r, sharpness);
}

/** Billowy variant, output [0,1]. */
export function billow2(x, y, seed = 0, period = 0) {
  return Math.abs(perlin2(x, y, seed, period));
}

/* ------------------------------------------------------------------ cellular / worley */

/**
 * Worley / cellular feature lookup for one cell neighbourhood.
 * Returns {f1,f2,id} where f1 is the nearest feature distance, f2 the second nearest,
 * and `id` a per-feature integer identity (used to distinguish cells).
 *
 * `metric` selects the distance norm; `morph` blends between Euclidean and the metric
 * (Gaea's "Metric Morph"), approximated here as a blended norm.
 */
export function worley2(x, y, seed, opts = {}) {
  const {
    jitter = 1,
    metric = 'euclid',
    morph = 0,
    density = 1,
    p = 4,
    anisotropy = 0,
    angle = 0,
  } = opts;

  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = Infinity, f2 = Infinity, id = 0;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const anisoX = 1 + anisotropy, anisoY = 1 / (1 + anisotropy);

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const h = mix32(cx, cy, seed);
      const jx = ((h >>> 24) & 255) / 255;
      const jy = ((h >>> 16) & 255) / 255;
      // density scales how many features land in a cell (0 -> 1 feature, 1 -> full jitter)
      // feature position inside the cell
      let fx = cx + (0.5 + (jx - 0.5) * jitter) * density;
      let fy = cy + (0.5 + (jy - 0.5) * jitter) * density;
      let ddx = fx - x, ddy = fy - y;
      if (anisotropy) {
        const rx = ddx * ca - ddy * sa, ry = ddx * sa + ddy * ca;
        ddx = rx / anisoX; ddy = ry / anisoY;
      }
      const ax = Math.abs(ddx), ay = Math.abs(ddy);
      let d;
      switch (metric) {
        case 'manhattan': d = ax + ay; break;
        case 'chebyshev': d = ax > ay ? ax : ay; break;
        case 'minkowski': d = Math.pow(Math.pow(ax, p) + Math.pow(ay, p), 1 / p); break;
        default: d = Math.sqrt(ddx * ddx + ddy * ddy);
      }
      if (morph !== 0) {
        const e = Math.sqrt(ddx * ddx + ddy * ddy);
        d = e + (d - e) * morph;
      }
      if (d < f1) { f2 = f1; f1 = d; id = h; }
      else if (d < f2) { f2 = d; }
    }
  }
  return { f1, f2: Number.isFinite(f2) ? f2 : f1, id };
}

/**
 * Map a Worley result to a normalised [0,1] output according to Gaea's
 * "Distance Function" vocabulary. Unknown names fall back to F1.
 */
export function worleySurface(f1, f2, mode) {
  switch (mode) {
    case 'DistanceInv': return 1 / (1 + f1 * f1 * 4);
    case 'Distance2Inv': return 1 / (1 + f2 * f2 * 4);
    case 'DistanceDiff': return Math.min(1, (f2 - f1) * 1.4);
    case 'DistanceToEdge': return Math.min(1, f1 * 1.4);
    case 'Hash': default: return Math.min(1, f1);
  }
}

/* ------------------------------------------------------------------ fractal / fBm */

/** Fractal type tokens observed in MultiFractal/Synth/Voronoi "Fractal Type" enums. */
export const FRACTAL_TYPES = [
  'None', 'Standard', 'fBm', 'Billow', 'Ridged', 'Ridge', 'Swiss', 'Jordan', 'Sawtooth',
  'Heterogeneous', 'Hybrid', 'HybridMulti', 'Multi', 'Power', 'Cliff', 'Sharp',
  'Erosion', 'Erosion2', 'Fractal', 'Turbulence', 'Absolute', 'Sine', 'Square', 'Random',
];

/**
 * Fractal sum of a 2D noise basis.
 *
 * @param fn        (x,y,seed,period) => [-1,1]
 * @param x,y       sample point
 * @param seed      base seed
 * @param octaves   number of octaves (>=1)
 * @param lacunarity frequency multiplier per octave
 * @param gain      amplitude multiplier per octave (a.k.a. persistence)
 * @param type      fractal flavour, see FRACTAL_TYPES
 * @param tiling    when > 0, lattice period so the field tiles
 * @returns [-1,1]-ish (some flavours are [0,1])
 */
export function fractalSum(fn, x, y, seed, octaves, lacunarity, gain, type = 'Standard', tiling = 0) {
  const n = Math.max(1, Math.min(24, octaves | 0));
  let freq = 1, amp = 1;
  let sum = 0, norm = 0;

  switch (type) {
    case 'Billow': case 'Sharp': {
      // Mean of |noise| across octaves, mapped like the Standard branch: [0,1] -> [-1,1].
      for (let o = 0; o < n; o++) {
        let v = Math.abs(fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0));
        v = type === 'Sharp' ? v * v : v;
        sum += v * amp; norm += amp;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm * 2 - 1 : 0;
    }
    case 'Ridged': case 'Ridge': {
      for (let o = 0; o < n; o++) {
        let v = 1 - Math.abs(fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0));
        v *= v;
        sum += v * amp; norm += amp;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm : 0;
    }
    case 'Swiss': {
      // Swiss: ridged base with an increasing sharpening exponent (Gaea/A.N.Other flavour)
      for (let o = 0; o < n; o++) {
        let v = 1 - Math.abs(fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0));
        const k = Math.min(1, o / Math.max(1, n - 1));
        v = Math.pow(v, 1 + k * 3);
        sum += v * amp; norm += amp;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm : 0;
    }
    case 'Jordan': {
      for (let o = 0; o < n; o++) {
        const v = 1 - Math.abs(fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0));
        sum += Math.sin(v * Math.PI * 0.5) * amp; norm += amp;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm : 0;
    }
    case 'Sawtooth': case 'Turbulence': {
      for (let o = 0; o < n; o++) {
        const v = fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0);
        sum += (v * 0.5 + 0.5) * amp; norm += amp;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm * 2 - 1 : 0;
    }
    case 'Absolute': {
      for (let o = 0; o < n; o++) {
        const v = Math.abs(fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0));
        sum += v * amp; norm += amp;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm * 2 - 1 : 0;
    }
    case 'Heterogeneous': {
      let prev = fn(x, y, seed, tiling);
      let value = prev;
      for (let o = 1; o < n; o++) {
        freq *= lacunarity; amp *= gain;
        const v = fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0);
        value += v * amp * prev;
        prev = v;
      }
      return Math.max(-1, Math.min(1, value / (1 + gain)));
    }
    case 'Hybrid': case 'HybridMulti': {
      let weight = 1, value = 0, wsum = 0;
      for (let o = 0; o < n; o++) {
        let v = fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0);
        v = (v + 1) * 0.5;
        v = (v + weight * 1.4) / (1 + weight);
        weight = Math.min(1, v * 1.6);
        value += v * v * weight * amp; wsum += amp;
        freq *= lacunarity; amp *= gain;
      }
      return wsum > 0 ? (value / wsum) * 2 - 1 : 0;
    }
    case 'Multi': {
      // multiplicative: each octave modulates the running product (libnoise "multifractal")
      let value = 1;
      for (let o = 0; o < n; o++) {
        const v = fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0) * 0.5 + 0.5;
        value *= (v * gain + (1 - gain));
        freq *= lacunarity; amp *= gain;
      }
      return Math.max(-1, Math.min(1, value * 2 - 1));
    }
    case 'Power': {
      for (let o = 0; o < n; o++) {
        let v = fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0) * 0.5 + 0.5;
        v = Math.pow(Math.max(0, v), 1 + o * 0.35);
        sum += v * amp; norm += amp;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm * 2 - 1 : 0;
    }
    case 'Cliff': {
      for (let o = 0; o < n; o++) {
        const v = fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0) * 0.5 + 0.5;
        sum += Math.pow(v, 0.6) * amp; norm += amp;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm * 2 - 1 : 0;
    }
    case 'Erosion': case 'Erosion2': {
      // octave amplitudes modulated by a slow low-frequency mask; gives weathered plateaus
      for (let o = 0; o < n; o++) {
        const v = fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0);
        const m = fn(x * freq * 0.25, y * freq * 0.25, seed + 777, tiling ? tiling * freq * 0.25 : 0) * 0.5 + 0.5;
        sum += v * amp * (type === 'Erosion2' ? Math.pow(m, 0.6) : m);
        norm += amp;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm : 0;
    }
    case 'Sine': {
      for (let o = 0; o < n; o++) {
        const v = fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0);
        sum += Math.sin(v * Math.PI) * amp; norm += amp;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm : 0;
    }
    case 'Square': {
      for (let o = 0; o < n; o++) {
        const v = fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0);
        sum += (v > 0 ? 1 : -1) * amp; norm += amp;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm : 0;
    }
    case 'Random': {
      for (let o = 0; o < n; o++) {
        const g = 0.5 + 0.5 * hash2f((seed + o * 977) | 0, o * 31, 0x5eed);
        const v = fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0);
        sum += v * amp * g; norm += amp * g;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm : 0;
    }
    case 'None': {
      return fn(x, y, seed, tiling);
    }
    case 'Fractal':
    case 'Standard':
    case 'fBm':
    default: {
      for (let o = 0; o < n; o++) {
        const v = fn(x * freq, y * freq, seed + o * 131, tiling ? tiling * freq : 0);
        sum += v * amp; norm += amp;
        freq *= lacunarity; amp *= gain;
      }
      return norm > 0 ? sum / norm : 0;
    }
  }
}

/**
 * fastnoise.js — scalar port of the FastNoiseSIMD calls Gaea makes.
 *
 * Gaea's RawNoise helpers drive FastNoiseSIMD (Jordan Peck's library, MIT). The kernel is
 * transcribed here instead of being re-invented, so node output lands on Gaea's values
 * rather than on a similar-looking noise.
 *
 * VALIDATED against the shipped Gaea build through tools/gaea-probe:
 *   - seed/hash, quintic fade and the 16-entry 3-D gradient table are exact;
 *   - fBm/billowy/ridged octave stacking (per-octave seed increment, amplitude sum
 *     normalisation) is exact;
 *   - the 16x16 grid at Scale 0.5 and 0.25/0.35/0.65/0.75 with seeds 0..7 matches to
 *     <= 2.2e-7 (float32 rounding) for WarpType None.
 *
 * NOT YET VALIDATED: the gradient perturbation used for WarpType Simple/Complex. The
 * structure below (three independent Perlin fields, seeds seed/+1/+2, amplitude in raw
 * grid units) is the documented FastNoise behaviour, but it does not reproduce Gaea's
 * warped grids — see docs/gaea-erosion-kernel-recovered.md for the measurements. Warp is
 * therefore opt-in and never used to claim fidelity.
 */

const X_PRIME = 1619;
const Y_PRIME = 31337;
const Z_PRIME = 6971;

/**
 * The 16 gradient vectors. Indices 0-11 are FastNoise's twelve cube-edge gradients;
 * 12-15 were recovered from Gaea's output by solving each entry against cells whose
 * other seven corners were already known.
 */
const GRAD = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  [1, 1, -1], [0, -1, -1], [-1, 1, -1], [0, -1, -1],
];

export const FN_FRACTAL = { FBM: 0, BILLOW: 1, RIDGED: 2 };

/** FastNoise's integer hash, run on the lattice corner. */
export function fnHash3(seed, x, y, z) {
  let h = seed | 0;
  h ^= Math.imul(X_PRIME, x | 0);
  h ^= Math.imul(Y_PRIME, y | 0);
  h ^= Math.imul(Z_PRIME, z | 0);
  h = Math.imul(Math.imul(Math.imul(h, h), h), 60493);
  return ((h >>> 13) ^ h) | 0;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + t * (b - a);

/** Single-octave 3-D Perlin, range approximately [-1, 1]. */
export function fnPerlin3(seed, x, y, z) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const xd = x - x0, yd = y - y0, zd = z - z0;
  const u = fade(xd), v = fade(yd), w = fade(zd);
  const g = (dx, dy, dz) => {
    const gr = GRAD[fnHash3(seed, x0 + dx, y0 + dy, z0 + dz) & 15];
    return (dx ? xd - 1 : xd) * gr[0] + (dy ? yd - 1 : yd) * gr[1] + (dz ? zd - 1 : zd) * gr[2];
  };
  return lerp(
    lerp(lerp(g(0, 0, 0), g(1, 0, 0), u), lerp(g(0, 1, 0), g(1, 1, 0), u), v),
    lerp(lerp(g(0, 0, 1), g(1, 0, 1), u), lerp(g(0, 1, 1), g(1, 1, 1), u), v),
    w,
  );
}

/** 1 / sum of the octave amplitudes FastNoise uses to normalise a fractal. */
export function fnFractalBounding(octaves, gain) {
  let sum = 0, amp = 1;
  for (let i = 0; i < octaves; i++) { sum += amp; amp *= gain; }
  return sum > 0 ? 1 / sum : 1;
}

/**
 * Octave stacking, exactly as FastNoise does it: each octave advances the seed by one,
 * doubles the frequency and multiplies the amplitude by `gain`, and the sum is scaled by
 * the reciprocal of the amplitude sum.
 *
 * Billow maps each octave through `2|n| - 1`; ridged is the negative of that (Gaea's
 * RawNoise implements Ridged as an inverted Billowy).
 */
export function fnFractalPerlin(seed, x, y, z, { octaves = 1, gain = 0.5, lacunarity = 2, fractalType = 0 } = {}) {
  const n = Math.max(1, octaves | 0);
  let f = 1, amp = 1, sum = 0;
  for (let i = 0; i < n; i++) {
    let v = fnPerlin3(seed + i, x * f, y * f, z * f);
    if (fractalType !== 0) v = 2 * Math.abs(v) - 1;
    sum += v * amp;
    f *= lacunarity;
    amp *= gain;
  }
  const value = sum * fnFractalBounding(n, gain);
  return fractalType === FN_FRACTAL.RIDGED ? -value : value;
}

/**
 * Domain warp used by WarpType Simple/Complex. Structural only — see the file header.
 * Returns the displaced position; `complex` stacks `octaves` fractal iterations.
 */
export function fnPerturb(seed, x, y, z, { amount = 1, frequency = 1, octaves = 1, gain = 0.5, complex = false } = {}) {
  const n = complex ? Math.max(1, octaves | 0) : 1;
  const bounding = fnFractalBounding(n, gain);
  let f = 1, amp = 1;
  let dx = 0, dy = 0, dz = 0;
  for (let i = 0; i < n; i++) {
    dx += fnPerlin3(seed + i, x * frequency * f, y * frequency * f, z * frequency * f) * amp;
    dy += fnPerlin3(seed + i + 1, x * frequency * f, y * frequency * f, z * frequency * f) * amp;
    dz += fnPerlin3(seed + i + 2, x * frequency * f, y * frequency * f, z * frequency * f) * amp;
    f *= 2;
    amp *= gain;
  }
  return [x + dx * bounding * amount, y + dy * bounding * amount, z + dz * bounding * amount];
}

/* ================================================================ Cellular / Voronoi */

/**
 * Gaea's `RawNoise.Voronoi` drives FastNoiseSIMD's *Cellular* noise. Note the enum order
 * in the DLL Gaea ships: WhiteNoise is 6 and Cellular is 7 (upstream FastNoiseSIMD has them
 * the other way round), which is why RawNoise calls SetNoiseType(7).
 *
 * Everything below was recovered from Gaea's own output; see
 * docs/gaea-erosion-kernel-recovered.md for the probe method and the fit residuals.
 */

/** FastNoise's Cellular hash: the cube-multiply WITHOUT the >>13 fold used by Perlin. */
export function fnCellHash(seed, x, y, z) {
  let h = seed | 0;
  h ^= Math.imul(X_PRIME, x | 0);
  h ^= Math.imul(Y_PRIME, y | 0);
  h ^= Math.imul(Z_PRIME, z | 0);
  return Math.imul(Math.imul(Math.imul(h, h), h), 60493) | 0;
}

/** FastNoise's ValCoord3D: the signed hash reinterpreted as a float in [-1, 1). */
export function fnCellValue(seed, x, y, z) {
  return fnCellHash(seed, x, y, z) / 2147483648;
}

/**
 * Jitter direction of a cell: three signed 10-bit slices of the cellular hash, normalised.
 * Gaea's sites sit exactly `Jitter` away from the lattice node, i.e. the direction is a
 * unit vector — verified against 36 probed cells to < 3e-4 per component.
 */
export function fnCellDir(seed, x, y, z) {
  const h = fnCellHash(seed, x, y, z);
  const dx = (h & 1023) / 511.5 - 1;
  const dy = ((h >>> 10) & 1023) / 511.5 - 1;
  const dz = ((h >>> 20) & 1023) / 511.5 - 1;
  const len = Math.hypot(dx, dy, dz) || 1;
  return [dx / len, dy / len, dz / len];
}

export const FN_CELLULAR_DISTANCE = { EUCLIDEAN: 0, MANHATTAN: 1, NATURAL: 2 };
export const FN_CELLULAR_RETURN = {
  CELL: 0, DISTANCE: 1, DISTANCE2: 2, ADD: 3, SUB: 4, MUL: 5, DIV: 6, NOISE: 7, CAVE: 8,
};

/**
 * One cellular sample. `FNSIMD` accumulates distances in a form where Euclidean and the
 * composite "Natural" function are squared, while Manhattan is not:
 *
 *   Euclidean  dx² + dy² + dz²
 *   Manhattan  |dx| + |dy| + |dz|
 *   Natural    (|dx| + |dy| + |dz|) · (dx² + dy² + dz²)
 *
 * Return types combine the nearest (d1) and second-nearest (d2) distances; Gaea only
 * exposes R/P/A/S/M/D, but the others are implemented for completeness.
 */
export function fnCellular3(seed, x, y, z, {
  jitter = 0.45, distanceFunction = 0, returnType = FN_CELLULAR_RETURN.DISTANCE2,
} = {}) {
  const xr = fastRound(x), yr = fastRound(y), zr = fastRound(z);
  let d1 = Infinity, d2 = Infinity;
  let cx = 0, cy = 0, cz = 0;

  for (let zi = zr - 1; zi <= zr + 1; zi++) {
    for (let yi = yr - 1; yi <= yr + 1; yi++) {
      for (let xi = xr - 1; xi <= xr + 1; xi++) {
        const dir = fnCellDir(seed, xi, yi, zi);
        const dx = xi + jitter * dir[0] - x;
        const dy = yi + jitter * dir[1] - y;
        const dz = zi + jitter * dir[2] - z;
        const d = cellularDistance(distanceFunction, dx, dy, dz);
        if (d < d1) {
          d2 = d1; d1 = d; cx = xi; cy = yi; cz = zi;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
  }

  switch (returnType) {
    case FN_CELLULAR_RETURN.CELL: return fnCellValue(seed, cx, cy, cz);
    case FN_CELLULAR_RETURN.DISTANCE: return d1;
    case FN_CELLULAR_RETURN.ADD: return d1 + d2;
    case FN_CELLULAR_RETURN.SUB: return d2 - d1;
    case FN_CELLULAR_RETURN.MUL: return d1 * d2;
    case FN_CELLULAR_RETURN.DIV: return d2 !== 0 ? d1 / d2 : 0;
    case FN_CELLULAR_RETURN.NOISE: return 0; // NoiseLookup needs the perlin lookup probe
    case FN_CELLULAR_RETURN.CAVE: return 1 - d2;
    default: return d2;
  }
}

function cellularDistance(fn, dx, dy, dz) {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  const sum = ax + ay + az;
  if (fn === FN_CELLULAR_DISTANCE.MANHATTAN) return sum;
  const sq = dx * dx + dy * dy + dz * dz;
  if (fn === FN_CELLULAR_DISTANCE.NATURAL) return sum * sq;
  return sq;
}

/** FastNoise's FastRound: half away from zero. */
function fastRound(v) {
  return v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5);
}

/**
 * Gaea's Voronoi sampler. Position frame and frequency are shared with Perlin:
 *
 *   freq     = Scale * 0.01 * (512/size)
 *   position = ((i,y)/size + offset*wavelength/size - 0.5) * size
 *
 * Unlike Perlin, the result is already remapped by the sampler (`0.5 + 0.5*v`), so the
 * returned grid can exceed 1 for return types that sum distances.
 *
 * Warp uses the same structural perturbation as Perlin and is NOT numerically validated.
 */
export function fnVoronoiGrid({
  size, scale = 50, jitter = 0.45, distanceFunction = 0, returnType = 2, seed = 0,
  warp = 'None', frequency = 0.1, amplitude = 0.3, warpOctaves = 12,
  scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0,
}) {
  const n = Math.max(16, size | 0);
  const out = new Float32Array(n * n);
  const freq = scale * 0.01 * (512 / n);
  const wavelength = freq !== 0 ? 1 / freq : 0;
  const inv = 1 / n;
  const doWarp = warp === 'Simple' || warp === 'Complex';
  const amount = amplitude * 10;

  for (let j = 0; j < n; j++) {
    const py = ((j * inv + offsetY * wavelength * inv) - 0.5) * n * scaleY;
    for (let i = 0; i < n; i++) {
      const px = ((i * inv + offsetX * wavelength * inv) - 0.5) * n * scaleX;
      let x = px, y = py;
      if (doWarp) {
        [x, y] = fnPerturb(seed, px, py, 0, {
          amount, frequency, octaves: warpOctaves, complex: warp === 'Complex',
        });
      }
      const v = fnCellular3(seed, x * freq, y * freq, 0, {
        jitter, distanceFunction, returnType,
      });
      out[j * n + i] = 0.5 + v * 0.5;
    }
  }
  return out;
}

/**
 * Gaea's Perlin sampler, in the coordinate frame Gaea builds:
 *
 *   resInv   = 1/size
 *   freq     = (1 - Scale) * 0.01 * (512/size)
 *   position = ((i,y) * resInv + offset * wavelength * resInv - 0.5) * size
 *
 * The result array is the raw noise, not remapped; callers apply 0.5 + 0.5*n.
 *
 * @returns {Float32Array} size*size, row-major
 */
export function fnPerlinGrid({
  size, scale = 0.5, octaves = 10, gain = 0.5, fractalType = 0, seed = 0,
  warp = 'None', frequency = 0.05, amplitude = 0.5, warpOctaves = 10,
  scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0,
}) {
  const n = Math.max(16, size | 0);
  const out = new Float32Array(n * n);
  const s = scale > 1 ? scale / 100 : scale;       // tolerate the old 0-100 Scale
  const freq = (1 - s) * 0.01 * (512 / n);
  const wavelength = freq !== 0 ? 1 / freq : 0;
  const inv = 1 / n;
  const doWarp = warp === 'Simple' || warp === 'Complex';
  const amount = amplitude * 10;
  for (let j = 0; j < n; j++) {
    const py = ((j * inv + offsetY * wavelength * inv) - 0.5) * n * scaleY;
    for (let i = 0; i < n; i++) {
      const px = ((i * inv + offsetX * wavelength * inv) - 0.5) * n * scaleX;
      let x = px, y = py;
      if (doWarp) {
        [x, y] = fnPerturb(seed, px, py, 0, {
          amount, frequency, octaves: warpOctaves, complex: warp === 'Complex',
        });
      }
      out[j * n + i] = fnFractalPerlin(seed, x * freq, y * freq, 0, { octaves, gain, fractalType });
    }
  }
  return out;
}

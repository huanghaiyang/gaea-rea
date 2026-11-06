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

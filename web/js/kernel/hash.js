/**
 * hash.js — deterministic integer hashing and PRNG.
 *
 * Every stochastic kernel in this project draws from these primitives so that a given
 * (seed, coordinate) pair always produces the same value, in the worker and in Node.
 * All arithmetic is |0/>>> normalized to stay inside int32 and avoid float drift.
 */

export const MASK32 = 0xffffffff;

/** Two-round integer avalanche. Deterministic across platforms and Node/browser. */
export function mix32(a, b, c) {
  let h = (a | 0) ^ Math.imul(b | 0, 0x27d4eb2d) ^ Math.imul(c | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h | 0;
}

/** Hash one 2D integer lattice point to a float in [0,1). */
export function hash2f(x, y, seed) {
  return (mix32(x, y, seed) >>> 0) / 4294967296;
}

/** Hash one 3D integer lattice point to a float in [0,1). */
export function hash3f(x, y, z, seed) {
  let h = (x | 0) ^ Math.imul(y | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Hash to unit vector on the circle. Used for gradient (Perlin) noise.
 * Uses the classic "top 8 bits index a 256-entry table of well spread angles" trick.
 */
const GRAD_ANGLES = new Float32Array(256);
{
  // golden-angle sequence: maximally uniform for sequential indices, still scrambled by hash
  for (let i = 0; i < 256; i++) GRAD_ANGLES[i] = (i * 2.399963229728653) % (Math.PI * 2);
}
export function grad2(x, y, seed) {
  const idx = (mix32(x, y, seed) >>> 24) & 255;
  const a = GRAD_ANGLES[idx];
  return [Math.cos(a), Math.sin(a)];
}

/** Fast deterministic uint32 PRNG (xorshift32) with an explicit state object. */
export function makeRng(seed) {
  let s = (seed | 0) || 0x9e3779b9;
  if (s === 0) s = 0x9e3779b9;
  return {
    /** next uint32 */
    next() {
      s ^= s << 13; s |= 0;
      s ^= s >>> 17;
      s ^= s << 5; s |= 0;
      return s >>> 0;
    },
    /** next float in [0,1) */
    unit() { return this.next() / 4294967296; },
    /** next float in [a,b) */
    range(a, b) { return a + (b - a) * this.unit(); },
  };
}

/** A tiny deterministic 1D/2D "blue noise-ish" cell index permutation. */
export function permute(i, n, seed) {
  if (n <= 1) return 0;
  const v = (mix32(i, 0x51ed, seed) >>> 0) % n;
  return v < 0 ? v + n : v;
}

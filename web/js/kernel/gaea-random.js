/**
 * gaea-random.js — exact port of the engine's `XorShift64Star`.
 *
 * WHY IT MATTERS
 * Several nodes and helpers randomise deterministically from a `Seed` (terrace boundaries, line
 * noise, distress, rock placement). Any deviation in the PRNG makes every one of those nodes wrong,
 * so this is a shared primitive rather than per-node code.
 *
 * PARAMETERS (read from the encrypted constant pools, not guessed):
 *   step     : x ^= x >> 12;  x ^= x << 25;  x ^= x >> 7      (Int32 pool 44/45/46)
 *   multiply : 2685821657736338717                            (Int64 pool 1)
 *   nextInt(): (int)(x*M >> 33)                               (Int32 pool 47)
 *   nextFloat: (float)(x*M >> 24) * 9.094947e-13 (= 2^-40)    (Int32 pool 48, Single pool 15)
 *   seed==0  : state = Int64 pool 0 = -6758474490012166922 (as unsigned)
 *
 * All 64-bit steps use BigInt and mask to 64 bits, mirroring C# `ulong` semantics.
 */

const MASK64 = (1n << 64n) - 1n;
const STAR = 2685821657736338717n;
const DEFAULT_SEED = 18446744072951074694n; // -6758474490012166922 as unsigned

export class XorShift64Star {
  constructor(seed = 0) {
    const s = Math.trunc(seed) | 0;
    this.state = s === 0 ? DEFAULT_SEED : BigInt(s >>> 0);
  }

  /** Raw 64-bit xorshift step (the `>>12, <<25, >>7` triple). */
  static step(x) {
    x ^= x >> 12n;
    x &= MASK64;
    x ^= x << 25n;
    x &= MASK64;
    x ^= x >> 7n;
    x &= MASK64;
    return x;
  }

  /** Advance and return `state * 2685821657736338717` (mod 2^64). */
  next64() {
    this.state = XorShift64Star.step(this.state);
    return (this.state * STAR) & MASK64;
  }

  /** `Next()` — high 31 bits, always non-negative. */
  nextInt() {
    return Number(this.next64() >> 33n);
  }

  /** `Next(int max)` — `((x*M - 1) & 0x7FFFFFFF) % max`. */
  nextIntMax(max) {
    const v = Number((this.next64() - 1n) & 0x7fffffffn);
    return v % max;
  }

  /** `Next(int min, int max)`. */
  nextIntRange(min, max) {
    return min + this.nextIntMax(max - min);
  }

  /** `Next()` float — `(float)(x*M >> 24) * 2^-40`, i.e. uniform in [0,1). */
  nextFloat() {
    const high = Number(this.next64() >> 24n);
    // C# converts the 64-bit value to float first (24-bit mantissa), then multiplies by a float
    return Math.fround(Math.fround(high) * Math.fround(9.094947e-13));
  }

  nextFloatMax(max) {
    return this.nextFloat() * max;
  }

  nextFloatRange(min, max) {
    return min + this.nextFloat() * (max - min);
  }
}

/** Convenience: deterministic float stream for a seed, used by tests and kernels. */
export function randomFloats(seed, count) {
  const rng = new XorShift64Star(seed);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = rng.nextFloat();
  return out;
}

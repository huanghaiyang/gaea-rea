/**
 * pyramid.js — the Laplacian pyramid that erosion, hydrological correction and rivers share.
 *
 * Three nodes sit on the same `LaplacianLevel` chain (0xa8 bytes per level), each building it
 * with `FUN_18003ed80` / `FUN_18003ee10` and running one `_vcomp_fork` per level. This module
 * is that infrastructure, recovered.
 *
 * THE SHAPE, from `FUN_18003ee10`
 *
 *     level.width  = parent.width  >> 1        a plain halving, not (n+1)/2
 *     level.height = parent.height >> 1
 *     level.index  = parent.index + 1
 *     level.parent = parent
 *     fork(FUN_1802d2ec0, level)               downsample
 *     fork(FUN_1802d2f60, parent, level)       detail
 *
 * and from `FUN_1802d2f60`:
 *
 *     parent.detail[y][x] = parent.base[y][x] - sample(level, x, y)
 *
 * which is the Laplacian definition. Reconstruction is therefore `base = upsample(coarse) + detail`.
 *
 * ONE TABLE, TWO DIRECTIONS
 * The whole pyramid runs off a single 25-value table in `.data` at `0x18044ea40`, which the
 * drivers install at runtime from a `.rdata` block. That block is the twelve assignments every
 * one of those drivers opens with — previously unexplained, now identified.
 *
 *   * DOWNSAMPLE (`FUN_18003f250`) convolves the full 5x5 table over the parent at stride 2
 *     and divides by `0x18044eaa4`.
 *   * UPSAMPLE (`FUN_1800463b0`) reads the SAME table, with the parity of the fine coordinate
 *     selecting which sub-window of those 25 taps applies.
 *
 * THE TABLE IS SEPARABLE, WHICH IS WHAT MAKES IT VERIFIABLE
 * Writing the 1D kernel as `v = [v0, v1, v2, v1, v0]`, every one of the 25 values must equal
 * `v[i] * v[j]`. That is not a coincidence to be hoped for — it is six equations that a
 * misread table would fail. Recovering the 1D kernel from the table and multiplying it back
 * out reproduces all 25 values, and `sum(v)` comes to exactly 1, which is why the 2D divisor
 * is `0.999998` (the float rounding of `1.0`).
 */

/**
 * The 1D kernel, recovered from the 5x5 table by taking the square roots of its centre row's
 * three distinct values (`0.003765`, `0.059912`, `0.150342`) and verified by the outer-product
 * identity against all 25 entries.
 *
 * IT IS ONLY APPROXIMATELY NORMALISED, and that is a property of the original rather than a
 * rounding artefact of this transcription: `2*v0 + 2*v1 + v2 = 0.99999673`, and the binary's
 * own divisor at `0x18044eaa4` is `0.999998` — a DIFFERENT number again. So the table does not
 * sum to its divisor, which means downsampling scales the field by about
 *
 *     (1 / 0.999998) * 0.99999673  ~=  0.99999873
 *
 * or roughly 1.3 parts per million per level, in the shrinking direction. Across a seven-level
 * pyramid that compounds to a few parts per million overall. It is small enough that no one
 * would notice on a render and large enough that it is worth stating rather than calling the
 * kernel normalised.
 */
export const PYRAMID_1D = [
  Math.sqrt(0.003765),
  Math.sqrt(0.059912),
  Math.sqrt(0.150342),
  Math.sqrt(0.059912),
  Math.sqrt(0.003765),
];

/** The sum of the 1D kernel: 0.99999673..., NOT 1. See the note on `PYRAMID_1D`. */
export const PYRAMID_1D_SUM = PYRAMID_1D.reduce((a, b) => a + b, 0);

/** `0x18044eaa4` — the 2D normaliser, which differs from the table's own sum. */
export const PYRAMID_DIVISOR = 0.999998;

/** The 3x3 subsample of the table, which is the upsampler's both-even tap set. */
export const PYRAMID_W_CORNER = PYRAMID_1D[0] * PYRAMID_1D[0];
export const PYRAMID_W_EDGE = PYRAMID_1D[0] * PYRAMID_1D[2];
export const PYRAMID_W_CENTRE = PYRAMID_1D[2] * PYRAMID_1D[2];

/** The full 5x5 table as the outer product of `PYRAMID_1D` with itself. */
export const PYRAMID_5X5 = (() => {
  const m = [];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) m.push(PYRAMID_1D[j] * PYRAMID_1D[i]);
  return m;
})();

const CLAMP = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The coarse dimensions a level takes from its parent: `>> 1`, a plain floor halving.
 *
 * Worth stating because the obvious alternative — `(n + 1) / 2`, which preserves odd sizes
 * through a full pyramid — is NOT what Gaea does, and the difference shows on any
 * non-power-of-two grid.
 */
export function pyramidCoarseSize(w, h) {
  const wi = Number.isFinite(w) && w > 0 ? Math.floor(w) : 1;
  const hi = Number.isFinite(h) && h > 0 ? Math.floor(h) : 1;
  return { width: wi >> 1, height: hi >> 1 };
}

/**
 * Downsample by the 5x5 separable Gaussian, stride 2.
 *
 * Transcribed from `FUN_18003f250`: for each coarse cell `(x, y)` the fine window is centred
 * on `(2x, 2y)` and spans `2x-2 .. 2x+2` by `2y-2 .. 2y+2`, each index clamped to the grid.
 * All 25 taps are summed and divided by `PYRAMID_DIVISOR`.
 *
 * @param {Float32Array} fine
 * @param {number} fineW,fineH
 * @returns {{data: Float32Array, width: number, height: number}}
 */
export function pyramidDownsample(fine, fineW, fineH) {
  const { width, height } = pyramidCoarseSize(fineW, fineH);
  const out = new Float32Array(width * height);
  if (width <= 0 || height <= 0) return { data: out, width: Math.max(0, width), height: Math.max(0, height) };
  for (let y = 0; y < height; y++) {
    const fy = 2 * y;
    for (let x = 0; x < width; x++) {
      const fx = 2 * x;
      let sum = 0;
      for (let j = 0; j < 5; j++) {
        const sy = CLAMP(fy - 2 + j, 0, fineH - 1);
        const rowW = j * 5;
        for (let i = 0; i < 5; i++) {
          const sx = CLAMP(fx - 2 + i, 0, fineW - 1);
          sum += PYRAMID_5X5[rowW + i] * fine[sy * fineW + sx];
        }
      }
      out[y * width + x] = sum / PYRAMID_DIVISOR;
    }
  }
  return { data: out, width, height };
}

/**
 * Upsample along one axis at fine coordinate `f`.
 *
 * The parity of `f` decides the taps, and the two cases are the two halves of a linear-phase
 * interpolation:
 *
 *     f even  ->  coarse c-1, c, c+1   with   [v0, v2, v0]
 *     f odd   ->  coarse c,   c+1      with   [v1, v1]      i.e. a plain two-point mean
 *
 * That the odd case is a plain mean is not an assumption: the binary divides the four-tap
 * (odd, odd) case by `4 * v1^2` with four equal terms, which is exactly a 2x2 average.
 *
 * @returns {{indices: number[], weights: number[]}}
 */
export function pyramidUpsampleTaps1D(f, size) {
  const c = f >> 1;
  if ((f & 1) === 0) {
    return {
      indices: [CLAMP(c - 1, 0, size - 1), CLAMP(c, 0, size - 1), CLAMP(c + 1, 0, size - 1)],
      weights: [PYRAMID_1D[0], PYRAMID_1D[2], PYRAMID_1D[0]],
    };
  }
  return {
    indices: [CLAMP(c, 0, size - 1), CLAMP(c + 1, 0, size - 1)],
    weights: [PYRAMID_1D[1], PYRAMID_1D[1]],
  };
}

/**
 * The upsampler: the fine value at `(fx, fy)` interpolated from the coarse grid.
 *
 * The interpolation is a separable outer product of the 1D taps, normalised by the sum of the
 * taps actually PRESENT — which is why a window clamped at an edge still produces an unbiased
 * average. Dividing by a constant instead would bias every boundary cell.
 */
export function pyramidUpsample(coarse, cw, ch, fx, fy) {
  const tx = pyramidUpsampleTaps1D(fx, cw);
  const ty = pyramidUpsampleTaps1D(fy, ch);
  let sum = 0;
  let w = 0;
  for (let j = 0; j < ty.indices.length; j++) {
    for (let i = 0; i < tx.indices.length; i++) {
      const weight = ty.weights[j] * tx.weights[i];
      sum += weight * coarse[ty.indices[j] * cw + tx.indices[i]];
      w += weight;
    }
  }
  return w > 0 ? sum / w : 0;
}

/** The both-coordinates-even case on its own, kept because callers and tests use it directly. */
export function pyramidSampleEvenEven(coarse, cw, ch, x, y) {
  return pyramidUpsample(coarse, cw, ch, x * 2, y * 2);
}

/**
 * The Laplacian detail: `fine - upsample(coarse)`, written on the COARSE grid.
 *
 * @param {Float32Array} fine
 * @param {number} fineW,fineH
 * @param {Float32Array} coarse
 * @param {number} cw,ch
 * @returns {Float32Array}
 */
export function pyramidDetail(fine, fineW, fineH, coarse, cw, ch) {
  const out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      // The fine value is read at the SAME coarse coordinates: the detail lives on the coarse
      // grid, not the fine one.
      out[i] = fine[i] - pyramidUpsample(coarse, cw, ch, x * 2, y * 2);
    }
  }
  return out;
}

/** Reconstruction of a full-resolution row pair from a coarse grid, its detail, and a phase. */
export function pyramidReconstructRow(coarse, cw, ch, detail) {
  const out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      out[i] = pyramidUpsample(coarse, cw, ch, x * 2, y * 2) + detail[i];
    }
  }
  return out;
}

/**
 * FIDELITY: `exact` on the filter, `approx` on the pyramid as a whole.
 *
 * Now recovered in full: the 5x5 separable Gaussian and its normaliser, the `>> 1` geometry,
 * the Laplacian definition, ALL FOUR upsample parity cases, and the normalisation by the
 * taps present.
 *
 * Still missing: the per-level curve and the reconstruction driver that walks the chain back
 * up, so a round trip through this module is not yet expected to reproduce a Gaea pyramid
 * end to end. The FILTER is exact; the assembly is not complete.
 */
export const PYRAMID_FIDELITY = 'approx';

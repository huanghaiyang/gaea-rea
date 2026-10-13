/**
 * gaea-pyramid-test.mjs — the Laplacian pyramid shared by erosion, hydrology and rivers.
 *
 * THE DECISIVE TEST IS THE OUTER-PRODUCT IDENTITY. The 25 weights live in a table read out of
 * the binary at addresses recovered from a runtime block copy. If that table really is a
 * separable Gaussian, then writing the 1D kernel as `v = [v0, v1, v2, v1, v0]` requires all 25
 * values to equal `v[i] * v[j]`, and `sum(v)` must come to 1. A misread table — the one at a
 * neighbouring address, or the same address at the wrong operand width — fails those
 * equations. Reproducing them is what turns "these numbers look like a Gaussian" into
 * evidence.
 *
 * Run: node web/tests/gaea-pyramid-test.mjs
 */

import {
  PYRAMID_1D, PYRAMID_1D_SUM, PYRAMID_5X5, PYRAMID_DIVISOR,
  PYRAMID_W_CORNER, PYRAMID_W_EDGE, PYRAMID_W_CENTRE, PYRAMID_FIDELITY,
  pyramidCoarseSize, pyramidDownsample, pyramidUpsample, pyramidUpsampleTaps1D,
  pyramidSampleEvenEven, pyramidDetail, pyramidReconstructRow,
} from '../js/kernels/pyramid.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
const close = (a, b, eps) => Math.abs(a - b) <= eps;

/* ------------------------------------------------------------------- the table itself */

{
  // THE KERNEL IS ONLY APPROXIMATELY NORMALISED, and that is the original's behaviour rather
  // than a transcription artefact. The 1D sum is 0.99999673 and the binary's own divisor is
  // 0.999998 — two different numbers, neither of them 1. An earlier assertion demanded exactly
  // 1 and was wrong about the kernel.
  ok(close(PYRAMID_1D_SUM, 1, 1e-5), 'the 1D kernel sums to within 1e-5 of 1',
    PYRAMID_1D_SUM);
  ok(PYRAMID_1D_SUM !== 1, 'but it is NOT exactly 1', PYRAMID_1D_SUM);
  ok(PYRAMID_1D_SUM < 1, 'it is slightly below 1, so downsampling shrinks by a few ppm',
    PYRAMID_1D_SUM);
  // And the divisor is a different number from the table sum, which is what makes the scaling
  // 1.3 ppm rather than exactly 1.
  ok(Math.abs(PYRAMID_DIVISOR - PYRAMID_1D_SUM) > 1e-7,
    'the divisor differs from the table sum', `${PYRAMID_DIVISOR} vs ${PYRAMID_1D_SUM}`);
  ok(close(PYRAMID_DIVISOR, 0.999998, 1e-9), 'the divisor is 0.999998 as read', PYRAMID_DIVISOR);
  // The per-level shrink factor, stated so a change to either number is visible.
  const shrink = PYRAMID_1D_SUM / PYRAMID_DIVISOR;
  ok(shrink < 1 && shrink > 0.99999, 'the per-level shrink is about 1.3 ppm', shrink);

  // Symmetric, single-peaked, and strictly decreasing away from the centre.
  ok(PYRAMID_1D[0] === PYRAMID_1D[4] && PYRAMID_1D[1] === PYRAMID_1D[3],
    'the 1D kernel is symmetric');
  ok(PYRAMID_1D[2] > PYRAMID_1D[1] && PYRAMID_1D[1] > PYRAMID_1D[0],
    'the 1D kernel decreases from the centre');

  // THE OUTER PRODUCT. Every one of the 25 table values must be v[j] * v[i]. This is the check
  // that separates a correctly recovered table from a plausible neighbour.
  let worst = 0;
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 5; i++) {
      worst = Math.max(worst, Math.abs(PYRAMID_5X5[j * 5 + i] - PYRAMID_1D[j] * PYRAMID_1D[i]));
    }
  }
  ok(worst < 1e-9, 'all 25 table values are the outer product of the 1D kernel', worst);

  // The six distinct values the table uses, matching what was read out of the binary.
  ok(close(PYRAMID_W_CORNER, 0.003765, 1e-6), 'the corner weight matches the reading',
    PYRAMID_W_CORNER);
  ok(close(PYRAMID_W_EDGE, 0.023792, 1e-6), 'the edge weight matches the reading',
    PYRAMID_W_EDGE);
  ok(close(PYRAMID_W_CENTRE, 0.150342, 1e-6), 'the centre weight matches the reading',
    PYRAMID_W_CENTRE);
  ok(close(PYRAMID_1D[1] * PYRAMID_1D[1], 0.059912, 1e-6), 'v1^2 matches the reading',
    PYRAMID_1D[1] * PYRAMID_1D[1]);
  ok(close(PYRAMID_1D[1] * PYRAMID_1D[2], 0.094907, 1e-6), 'v1*v2 matches the reading',
    PYRAMID_1D[1] * PYRAMID_1D[2]);
  ok(close(PYRAMID_1D[0] * PYRAMID_1D[1], 0.015019, 1e-6), 'v0*v1 matches the reading',
    PYRAMID_1D[0] * PYRAMID_1D[1]);

  ok(PYRAMID_FIDELITY === 'approx', 'the fidelity label is approx', PYRAMID_FIDELITY);
}

/* ------------------------------------------------------------------------ the geometry */

{
  ok(pyramidCoarseSize(256, 256).width === 128, '256 halves to 128');
  ok(pyramidCoarseSize(255, 255).width === 127, '255 halves to 127, a floor');
  ok(pyramidCoarseSize(3, 3).width === 1, '3 halves to 1');
  ok(pyramidCoarseSize(1, 1).width === 0, '1 halves to 0 — a pyramid must stop before here');
  ok(pyramidCoarseSize(255, 255).width !== Math.ceil(255 / 2),
    'the halving is a floor, not a round-up');
}

/* -------------------------------------------------------------------- the downsample */

{
  const w = 16;
  const h = 16;

  // A CONSTANT FIELD IS A FIXED POINT, because the kernel is normalised. Dividing by a wrong
  // constant would show up here immediately.
  {
    const f = new Float32Array(w * h).fill(0.4);
    const d = pyramidDownsample(f, w, h);
    let worst = 0;
    for (let i = 0; i < d.data.length; i++) worst = Math.max(worst, Math.abs(d.data[i] - 0.4));
    ok(worst < 1e-5, 'a constant field survives downsampling', worst);
    ok(d.width === 8 && d.height === 8, 'the coarse size is half', `${d.width}x${d.height}`);
  }

  // An impulse spreads according to the kernel: the centre of the 5x5 window gets the largest
  // share and the corners the smallest.
  {
    const f = new Float32Array(w * h);
    f[8 * w + 8] = 1;
    const d = pyramidDownsample(f, w, h);
    // The impulse at fine (8,8) lands at coarse (4,4), the centre of its 5x5 window.
    const centre = d.data[4 * d.width + 4];
    ok(close(centre, PYRAMID_1D[2] * PYRAMID_1D[2] / PYRAMID_DIVISOR, 1e-4),
      'the impulse lands with the v2^2 weight', centre);
    // Fine (6,6) is offset -2 in both axes, so it receives v0^2 through the same window.
    const corner = d.data[3 * d.width + 3];
    ok(close(corner, PYRAMID_1D[0] * PYRAMID_1D[0] / PYRAMID_DIVISOR, 1e-5),
      'a two-cell offset lands with the v0^2 weight', corner);
    ok(corner < centre, 'the corner weight is below the centre weight');
  }

  // Energy must be roughly conserved for a smooth field — the filter is a normalised average,
  // so a downsampled constant is that constant and a downsampled ramp keeps its range.
  {
    const f = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = x / (w - 1);
    const d = pyramidDownsample(f, w, h);
    let inRange = true;
    for (let i = 0; i < d.data.length; i++) if (d.data[i] < -1e-6 || d.data[i] > 1 + 1e-6) inRange = false;
    ok(inRange, 'a downsampled ramp stays within the original range');
  }

  // Degenerate sizes must not throw or read out of bounds.
  {
    const tiny = pyramidDownsample(new Float32Array([0.5]), 1, 1);
    ok(tiny.width === 0 && tiny.height === 0, 'a 1x1 input gives an empty coarse level');
    const odd = pyramidDownsample(new Float32Array(9 * 9).fill(0.25), 9, 9);
    ok(odd.width === 4 && odd.height === 4, 'an odd size floors when halved',
      `${odd.width}x${odd.height}`);
    let finite = true;
    for (let i = 0; i < odd.data.length; i++) if (!Number.isFinite(odd.data[i])) finite = false;
    ok(finite, 'an odd size produces finite values');
  }
}

/* ---------------------------------------------------------------------- the upsample */

{
  const cw = 8;
  const ch = 8;

  // The two tap sets, and the normalisation of each.
  {
    const even = pyramidUpsampleTaps1D(4, cw);        // f even
    ok(even.weights.length === 3, 'an even fine coordinate takes 3 taps', even.weights.length);
    ok(close(even.weights[0], PYRAMID_1D[0], 1e-12), 'the outer taps use v0');
    ok(close(even.weights[1], PYRAMID_1D[2], 1e-12), 'the centre tap uses v2');

    const odd = pyramidUpsampleTaps1D(5, cw);         // f odd
    ok(odd.weights.length === 2, 'an odd fine coordinate takes 2 taps', odd.weights.length);
    ok(odd.weights[0] === odd.weights[1], 'and they are EQUAL, a plain two-point mean');
  }

  // THE FOUR PARITY CASES, counted through the full 2D interpolation. 3x3 = 9, 3x2 and 2x3 = 6,
  // 2x2 = 4 — the counts the binary's four branches imply.
  {
    const counts = {};
    for (let fy = 0; fy < 2; fy++) {
      for (let fx = 0; fx < 2; fx++) {
        const tx = pyramidUpsampleTaps1D(fx, cw).weights.length;
        const ty = pyramidUpsampleTaps1D(fy, ch).weights.length;
        counts[`${fx}${fy}`] = tx * ty;
      }
    }
    ok(counts['00'] === 9, 'both-even takes 9 taps', counts['00']);
    ok(counts['01'] === 6, 'even-odd takes 6 taps', counts['01']);
    ok(counts['10'] === 6, 'odd-even takes 6 taps', counts['10']);
    ok(counts['11'] === 4, 'both-odd takes 4 taps', counts['11']);
  }

  // A constant coarse grid must upsample back to that constant at EVERY parity — the
  // normalisation by present taps is what guarantees it, and it holds at the clamped edges too.
  {
    const c = new Float32Array(cw * ch).fill(0.3);
    let worst = 0;
    for (let fy = 0; fy < cw * 2; fy++) {
      for (let fx = 0; fx < cw * 2; fx++) {
        worst = Math.max(worst, Math.abs(pyramidUpsample(c, cw, ch, fx, fy) - 0.3));
      }
    }
    ok(worst < 1e-5, 'a constant grid upsamples to itself at every parity', worst);
  }

  // The both-even case must agree with the direct 3x3 form, which is how it was originally
  // read out of the binary — an independent route to the same number.
  {
    const c = new Float32Array(cw * ch);
    for (let i = 0; i < c.length; i++) c[i] = Math.sin(i * 0.7) * 0.5 + 0.5;
    let worst = 0;
    for (let y = 1; y < ch - 1; y++) {
      for (let x = 1; x < cw - 1; x++) {
        const direct = pyramidSampleEvenEven(c, cw, ch, x, y);
        const vals = [
          [x - 1, y - 1, PYRAMID_W_CORNER], [x, y - 1, PYRAMID_W_EDGE], [x + 1, y - 1, PYRAMID_W_CORNER],
          [x - 1, y, PYRAMID_W_EDGE], [x, y, PYRAMID_W_CENTRE], [x + 1, y, PYRAMID_W_EDGE],
          [x - 1, y + 1, PYRAMID_W_CORNER], [x, y + 1, PYRAMID_W_EDGE], [x + 1, y + 1, PYRAMID_W_CORNER],
        ];
        let sum = 0;
        let w = 0;
        for (const [vx, vy, wt] of vals) { sum += wt * c[vy * cw + vx]; w += wt; }
        worst = Math.max(worst, Math.abs(direct - sum / w));
      }
    }
    ok(worst < 1e-9, 'the both-even tap set matches the direct 3x3 form', worst);
  }

  // A coarse grid whose values are all within [lo, hi] can only interpolate to within it.
  {
    const c = new Float32Array(cw * ch);
    for (let i = 0; i < c.length; i++) c[i] = i / c.length;
    let inRange = true;
    for (let fy = 0; fy < ch * 2; fy++) {
      for (let fx = 0; fx < cw * 2; fx++) {
        const v = pyramidUpsample(c, cw, ch, fx, fy);
        if (v < -1e-6 || v > 1 + 1e-6) inRange = false;
      }
    }
    ok(inRange, 'interpolation stays inside the coarse range at every parity');
  }
}

/* --------------------------------------------------- the Laplacian round trip */

{
  const cw = 8;
  const ch = 8;
  const coarse = new Float32Array(cw * ch);
  for (let i = 0; i < coarse.length; i++) coarse[i] = Math.sin(i * 0.4) * 0.5 + 0.5;

  // Build a fine grid that IS the upsample, so the detail is exactly zero — the identity that
  // defines the Laplacian.
  const ups = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) ups[y * cw + x] = pyramidSampleEvenEven(coarse, cw, ch, x, y);
  }
  const zeroDetail = pyramidDetail(ups, cw, ch, coarse, cw, ch);
  let maxDetail = 0;
  for (let i = 0; i < zeroDetail.length; i++) maxDetail = Math.max(maxDetail, Math.abs(zeroDetail[i]));
  ok(maxDetail < 1e-5, 'a fine grid equal to the upsample has zero detail', maxDetail);

  // And with a non-zero detail, reconstruction returns the fine grid exactly.
  const fine = new Float32Array(cw * ch);
  for (let i = 0; i < fine.length; i++) fine[i] = ups[i] + 0.01 * Math.cos(i * 1.3);
  const detail = pyramidDetail(fine, cw, ch, coarse, cw, ch);
  const back = pyramidReconstructRow(coarse, cw, ch, detail);
  let worst = 0;
  for (let i = 0; i < fine.length; i++) worst = Math.max(worst, Math.abs(back[i] - fine[i]));
  ok(worst < 1e-5, 'reconstruction inverts the detail exactly', worst);

  // The detail is genuinely zero-mean in the sense that it carries only the residual: its
  // magnitude must be small relative to the signal for a nearly-band-limited fine grid.
  let detailMax = 0;
  for (let i = 0; i < detail.length; i++) detailMax = Math.max(detailMax, Math.abs(detail[i]));
  ok(detailMax < 0.02, 'the detail stays small for a nearly band-limited grid', detailMax);
}

/* ------------------------------------------------------------------------------ report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('Gaea Laplacian pyramid: 5x5 separable Gaussian, >>1 geometry, fine - upsample');
  console.log('fidelity: approx — the filter is exact; the chain walk is not implemented');
}

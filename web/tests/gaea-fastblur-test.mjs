/**
 * gaea-fastblur-test.mjs — Gaea's FastBlur, transcribed from FUN_180053e80.
 *
 * The claim this file has to keep honest is that the filter is Gaea's ITERATED SEPARABLE BOX,
 * not a Gaussian. That distinction is testable rather than aesthetic: one box pass turns an
 * impulse into a UNIFORM (2r+1)x(2r+1) block, and a Gaussian of any width cannot, because its
 * weights are not equal across the window.
 *
 * Run: node web/tests/gaea-fastblur-test.mjs
 */

import { gaeaFastBlur } from '../js/kernels/filters.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

const field = (data, size) => ({ data, channels: 1, size, channel: 'height' });
const idx = (size, x, y) => y * size + x;

/* ------------------------------------------------- the box signature (the decisive test) */

{
  const size = 33;
  const src = new Float32Array(size * size);
  const cx = 16, cy = 16;
  src[idx(size, cx, cy)] = 1;

  const r = 3;
  const out = gaeaFastBlur(field(src, size), r, 1);

  // Every cell of the (2r+1)^2 window must receive EXACTLY the same value: 1 / (2r+1)^2.
  const expect = 1 / ((2 * r + 1) ** 2);
  let uniform = true;
  let worst = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const v = out.data[idx(size, cx + dx, cy + dy)];
      worst = Math.max(worst, Math.abs(v - expect));
      if (Math.abs(v - expect) > 1e-7) uniform = false;
    }
  }
  ok(uniform, 'one pass spreads an impulse into a UNIFORM (2r+1)^2 block — the box signature',
    `worst deviation ${worst}`);
  ok(Math.abs(out.data[idx(size, cx, cy)] - expect) < 1e-7,
    'the centre cell holds exactly 1/(2r+1)^2, not a larger Gaussian peak',
    out.data[idx(size, cx, cy)]);

  // Outside the window must be untouched: a box has finite support, a Gaussian only
  // approaches zero.
  let outsideZero = true;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.abs(x - cx) <= r && Math.abs(y - cy) <= r) continue;
      if (out.data[idx(size, x, y)] !== 0) outsideZero = false;
    }
  }
  ok(outsideZero, 'a one-pass box has FINITE support, unlike a Gaussian');

  // And the total must be conserved, since the window is normalised.
  let sum = 0;
  for (let i = 0; i < out.data.length; i++) sum += out.data[i];
  ok(Math.abs(sum - 1) < 1e-6, 'a one-pass box conserves the impulse', sum);
}

/* ---------------------------------------------------------------- radius and iteration */

{
  const size = 32;
  const src = new Float32Array(size * size).fill(0.25);
  const out = gaeaFastBlur(field(src, size), 4, 3);
  let preserved = true;
  for (let i = 0; i < out.data.length; i++) {
    if (Math.abs(out.data[i] - 0.25) > 1e-7) { preserved = false; break; }
  }
  ok(preserved, 'a constant field survives any number of passes unchanged');
}

{
  // Gaea clamps the radius to min(requested, w/2 - 1, h/2 - 1). A radius past that must not
  // wrap or read out of bounds, and it must behave as the cap.
  const size = 16;
  const src = new Float32Array(size * size);
  src[idx(size, 8, 8)] = 1;
  const capped = gaeaFastBlur(field(src, size), 999, 1);
  const atCap = gaeaFastBlur(field(src, size), Math.floor(size / 2) - 1, 1);

  let identical = true;
  for (let i = 0; i < capped.data.length; i++) {
    if (Math.abs(capped.data[i] - atCap.data[i]) > 1e-9) { identical = false; break; }
  }
  ok(identical, 'a radius past half the grid clamps to w/2 - 1 rather than wrapping', size);
}

{
  const size = 24;
  const src = new Float32Array(size * size);
  for (let i = 0; i < src.length; i++) src[i] = (i % 7) / 7;
  const f = field(src, size);

  const zero = gaeaFastBlur(f, 3, 0);
  let identity = true;
  for (let i = 0; i < src.length; i++) if (zero.data[i] !== src[i]) { identity = false; break; }
  ok(identity, 'zero iterations is the identity');

  const r0 = gaeaFastBlur(f, 0, 5);
  let identity2 = true;
  for (let i = 0; i < src.length; i++) if (r0.data[i] !== src[i]) { identity2 = false; break; }
  ok(identity2, 'radius zero is the identity however many iterations are asked for');

  // More iterations must keep spreading: the box converges towards a Gaussian, it does not
  // stop after one.
  const one = gaeaFastBlur(f, 3, 1);
  const four = gaeaFastBlur(f, 3, 4);
  let differs = false;
  for (let i = 0; i < src.length; i++) if (Math.abs(one.data[i] - four.data[i]) > 1e-6) {
    differs = true; break;
  }
  ok(differs, 'four iterations differ from one, so the filter really iterates');

  // Variance must fall monotonically with more blurring.
  const variance = (a) => {
    let m = 0; for (let i = 0; i < a.length; i++) m += a[i]; m /= a.length;
    let v = 0; for (let i = 0; i < a.length; i++) v += (a[i] - m) ** 2; return v / a.length;
  };
  ok(variance(four.data) < variance(one.data),
    'more iterations reduce variance', `${variance(four.data)} < ${variance(one.data)}`);
}

/* ------------------------------------------------------------- separability and symmetry */

{
  // A box is separable, so blurring a field that is constant along y must leave it constant
  // along y: the horizontal pass does nothing, and the vertical pass averages equal values.
  const size = 20;
  const src = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) src[idx(size, x, y)] = x / (size - 1);
  }
  const out = gaeaFastBlur(field(src, size), 2, 3);
  let columnConstant = true;
  for (let y = 1; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.abs(out.data[idx(size, x, y)] - out.data[idx(size, x, 0)]) > 1e-6) {
        columnConstant = false; break;
      }
    }
    if (!columnConstant) break;
  }
  ok(columnConstant, 'a field varying only along x stays constant along y (separability)');
}

{
  // Symmetry must be preserved: a symmetric input must not become asymmetric, which would
  // indicate an edge-handling bias.
  const size = 21;
  const src = new Float32Array(size * size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x - c) + Math.abs(y - c);
      src[idx(size, x, y)] = Math.exp(-d * d / 20);
    }
  }
  const out = gaeaFastBlur(field(src, size), 3, 2);
  let symmetric = true;
  let worst = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = out.data[idx(size, x, y)];
      const b = out.data[idx(size, size - 1 - x, size - 1 - y)];
      worst = Math.max(worst, Math.abs(a - b));
      if (Math.abs(a - b) > 1e-6) symmetric = false;
    }
  }
  ok(symmetric, 'a point-symmetric input stays point-symmetric', `worst ${worst}`);
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
  console.log('Gaea FastBlur: iterated separable box, radius capped at min(r, w/2-1, h/2-1)');
  console.log('fidelity: approx — structure transcribed; the SIMD sum order is not');
}

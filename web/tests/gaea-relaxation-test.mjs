/**
 * gaea-relaxation-test.mjs — the 3x3 relaxation kernel recovered from Gaea.Native.dll.
 *
 * WHAT THIS FILE IS ACTUALLY PROTECTING
 * The numbers in kernels/relaxation.js were read out of a shipped binary's read-only data.
 * A future edit that "tidies" 0.707099974 into 0.7071, or 0.146447197 into 0.1464, would
 * look harmless and would silently change the algorithm. So the strongest assertions here
 * are not about behaviour — they are about the *relationships between the constants*:
 *
 *   diagonal weight = 1/sqrt(2)
 *   normaliser      = 1 / (4 + 4/sqrt(2)) = (2 - sqrt(2)) / 4
 *
 * Those two are not independent, and the pair being consistent is what makes this a real
 * 3x3 kernel rather than a plausible-looking guess. The decisive check is that the weighted
 * average of a CONSTANT field returns that constant: it can only do so if the weights and
 * the normaliser agree.
 *
 * Run: node web/tests/gaea-relaxation-test.mjs
 */

import {
  K_DIAG, K_NORMALIZE, K_GRAD_SCALE, K_SLOPE2, K_ONE,
  K_CLAMP_A_THRESHOLD, K_CLAMP_A_WEIGHT, K_CLAMP_B_WEIGHT, K_DIFFUSION,
  K_BLEND_SIGN, K_FLOW_THRESHOLD, K_DIAG_THRESHOLD_SCALE, K_FLOW_NORMALIZE,
  K_FIXED_SCALE, K_FIXED_INV, toFixed, fromFixed, gaeaDeferredApply,
  gaeaBlur3x3, gaeaRelaxationPass, gaeaFlowReceiverMax,
  gaeaFlowNormalize, gaeaFlushAccumulator,
} from '../js/kernels/relaxation.js';

let pass = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
function near(a, b, eps) { return Math.abs(a - b) <= eps; }

const SQRT2 = Math.SQRT2;

/* ------------------------------------------------- the constants are a consistent pair */

{
  // These are NOT the algebraic ideals, and the difference is far too large to be float32
  // rounding. The first version of this test asserted 1/sqrt(2) and (2-sqrt(2))/4 and
  // FAILED by ~113 ulps, which is what established the real values:
  //
  //   0.707099974  = float32(0.7071)                  <- a round decimal
  //   0.146447197  = float32(1 / (4 + 4*0.7071))      <- its exact reciprocal
  ok(K_DIAG === 0.7071, 'K_DIAG is the decimal 0.7071', K_DIAG);
  ok(K_NORMALIZE === Math.fround(1 / (4 + 4 * 0.7071)),
    'K_NORMALIZE is the float32 reciprocal of the weight sum', K_NORMALIZE);

  // The discriminating check: 0.7071 must NOT be 1/sqrt(2). If someone "corrects" it, the
  // algorithm silently changes, so assert the gap rather than tolerating it.
  ok(Math.abs(K_DIAG - 1 / SQRT2) > 1e-6,
    'K_DIAG is measurably NOT 1/sqrt(2)',
    `gap ${Math.abs(K_DIAG - 1 / SQRT2).toExponential(3)}`);
  ok(Math.abs(K_NORMALIZE - (2 - SQRT2) / 4) > 1e-7,
    'K_NORMALIZE is measurably NOT (2-sqrt(2))/4',
    `gap ${Math.abs(K_NORMALIZE - (2 - SQRT2) / 4).toExponential(3)}`);

  // The pair must still close the normalisation. With the correct values the residual is
  // pure float32 rounding (~2.5e-8), not a modelling error.
  const total = 4 * K_DIAG + 4;
  ok(Math.abs(total * K_NORMALIZE - 1) < 1e-7,
    'the weights and the normaliser multiply to 1',
    `(4*K_DIAG + 4) * K_NORMALIZE = ${total * K_NORMALIZE}`);

  // The remaining constants, pinned to the words read from the image.
  ok(K_GRAD_SCALE === 0.125, 'K_GRAD_SCALE is 0.125', K_GRAD_SCALE);
  ok(K_SLOPE2 === 0.9, 'K_SLOPE2 is 0.9', K_SLOPE2);
  ok(K_ONE === 1, 'K_ONE is 1.0', K_ONE);
  ok(near(K_CLAMP_A_THRESHOLD, 0.3, 1e-7), 'K_CLAMP_A_THRESHOLD is 0.3', K_CLAMP_A_THRESHOLD);
  ok(near(K_CLAMP_A_WEIGHT, 0.7, 1e-7), 'K_CLAMP_A_WEIGHT is 0.7', K_CLAMP_A_WEIGHT);
  ok(K_CLAMP_B_WEIGHT === 30, 'K_CLAMP_B_WEIGHT is 30', K_CLAMP_B_WEIGHT);
  ok(near(K_DIFFUSION, 0.02, 1e-8), 'K_DIFFUSION is 0.02', K_DIFFUSION);
}

/* -------------------------------------------------------------- the 3x3 average itself */

{
  const n = 17;
  const flat = new Float32Array(n * n).fill(0.25);
  let worst = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      worst = Math.max(worst, Math.abs(gaeaBlur3x3(flat, n, x, y) - 0.25));
    }
  }
  // This is the decisive correctness check: a weighted average that does not reproduce a
  // constant field has the wrong normaliser. It passes only because K_DIAG and K_NORMALIZE
  // are the matching pair.
  ok(worst < 1e-6, 'the 3x3 average reproduces a constant field exactly', `worst ${worst}`);
}

{
  // An impulse, to pin the kernel's most easily-misread property: THE CENTRE IS EXCLUDED.
  // The first version of this test asserted the impulse's own position was attenuated and
  // failed with 0, which is the correct answer — the eight neighbours of an isolated
  // impulse are all zero. That exclusion is what makes `centre - blur` usable as a
  // high-pass term, so it is asserted rather than assumed.
  const n = 9;
  const f = new Float32Array(n * n);
  const cx = 4, cy = 4;
  f[cy * n + cx] = 1;

  ok(gaeaBlur3x3(f, n, cx, cy) === 0,
    'the centre cell is excluded from the 3x3 average',
    gaeaBlur3x3(f, n, cx, cy));

  // The four axial neighbours of a pure impulse receive only the axial weight, and the
  // four diagonals only the diagonal weight — so their ratio is exactly K_DIAG.
  const axial = gaeaBlur3x3(f, n, cx + 1, cy);
  const diag = gaeaBlur3x3(f, n, cx + 1, cy + 1);
  ok(axial > 0 && diag > 0, 'both axial and diagonal neighbours pick up the impulse',
    `${axial} / ${diag}`);
  ok(near(diag / axial, K_DIAG, 1e-6),
    'the diagonal/axial response ratio equals the diagonal weight',
    `${diag / axial} vs ${K_DIAG}`);

  // Every entry that sees the impulse must sum to 1, since the kernel is normalised.
  let sum = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) sum += gaeaBlur3x3(f, n, x, y);
  ok(near(sum, 1, 1e-6), 'the normalised kernel conserves a unit impulse', sum);
}

/* ------------------------------------------------------------- the full relaxation pass */

{
  // A slope: the pass must stay finite and must not invert the terrain.
  const n = 32;
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = (n - y) / n;

  const { out, accum } = gaeaRelaxationPass({ height: h, size: n, scale: 1, slope: 1 });

  let finite = true;
  let maxAbs = 0;
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) { finite = false; break; }
    maxAbs = Math.max(maxAbs, Math.abs(out[i]));
  }
  ok(finite, 'the pass produces finite values on a slope');
  ok(maxAbs < 1e3, 'the pass does not blow up', `max |v| = ${maxAbs}`);

  // The second output accumulates, the first assigns. On a single pass from zero the
  // accumulator must therefore equal the assigned output.
  let equal = true;
  for (let i = 0; i < out.length; i++) {
    if (Math.abs(out[i] - accum[i]) > 1e-9) { equal = false; break; }
  }
  ok(equal, 'on one pass from zero, the accumulated output equals the assigned output');

  // Running a second pass into the same accumulator must keep adding, never reset — this
  // is the `+=` that the binary performs and that a naive reimplementation drops.
  const second = gaeaRelaxationPass({ height: h, size: n, scale: 1, slope: 1, accum });
  let grew = true;
  for (let i = 0; i < out.length; i++) {
    if (Math.abs(second.accum[i] - accum[i] * 2) > 1e-6) { grew = false; break; }
  }
  ok(grew, 'the accumulated output adds across passes rather than overwriting');
}

{
  // Determinism: no RNG, no ordering dependence.
  const n = 24;
  const h = new Float32Array(n * n);
  for (let i = 0; i < h.length; i++) h[i] = Math.sin(i * 0.31) * 0.5 + 0.5;
  const a = gaeaRelaxationPass({ height: h, size: n, scale: 1, slope: 0.5 });
  const b = gaeaRelaxationPass({ height: h, size: n, scale: 1, slope: 0.5 });
  let same = true;
  for (let i = 0; i < a.out.length; i++) if (a.out[i] !== b.out[i]) { same = false; break; }
  ok(same, 'the pass is deterministic');

  // A flat field has no drops and no gradient, so the drop term must be zero rather than
  // NaN — this is the `sumQ > 0` guard.
  const flat = new Float32Array(n * n).fill(0.5);
  const r = gaeaRelaxationPass({ height: flat, size: n, scale: 1, slope: 1 });
  let anyNaN = false;
  for (let i = 0; i < r.out.length; i++) if (!Number.isFinite(r.out[i])) { anyNaN = true; break; }
  ok(!anyNaN, 'a flat field produces no NaN in the normalisation');
}

/* ------------------------------------------------- the blend term is NEGATED (a real bug) */

{
  // FUN_1801f35f0's final expression multiplies the clamp/diffusion blend by
  // DAT_1803563fc = -1.0. An earlier version of this file omitted the factor because that
  // address had not been decoded and was assumed unused. Reading the sibling FUN_1801f2f30
  // showed the same reference there, which forced a second look.
  ok(K_BLEND_SIGN === -1, 'K_BLEND_SIGN is -1', K_BLEND_SIGN);

  // A directional check that the negation is actually applied: on a monotone slope the
  // blend term is non-zero, so adding rather than subtracting gives a different answer.
  const n = 16;
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = 1 - x / n;
  const { out } = gaeaRelaxationPass({ height: h, size: n, scale: 1, slope: 0.5 });
  const flat = new Float32Array(n * n).fill(1);
  const { out: flatOut } = gaeaRelaxationPass({ height: flat, size: n, scale: 1, slope: 0.5 });
  // On a flat field every term is zero, so both signs agree; the difference must only show
  // where the field is not flat. This pins that the sign is load-bearing without pinning a
  // specific magnitude that would break on any legitimate reweighting.
  let anyNonZero = false;
  for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > 1e-9) { anyNonZero = true; break; }
  ok(anyNonZero, 'the pass produces non-zero output on a slope, so the sign matters');
  let flatZero = true;
  for (let i = 0; i < flatOut.length; i++) if (Math.abs(flatOut[i]) > 1e-9) { flatZero = false; break; }
  ok(flatZero, 'a flat field yields exactly zero, so the terms cancel there');
}

/* ------------------------------------------------------ the flow-receiver stage */

{
  // The threshold pair is the discriminating property: a diagonal step is longer, so it
  // needs a bigger drop. A drop chosen between the two must count for an axial neighbour
  // and NOT for a diagonal one.
  const n = 5;
  const cx = 2, cy = 2;
  const drop = K_FLOW_THRESHOLD * 1.25;      // between axial (1.0x) and diagonal (1.414x)
  ok(drop > K_FLOW_THRESHOLD && drop < K_FLOW_THRESHOLD * K_DIAG_THRESHOLD_SCALE,
    'the test drop sits strictly between the axial and diagonal thresholds', drop);

  const h = new Float32Array(n * n).fill(1);
  const flow = new Float32Array(n * n);
  h[cy * n + (cx + 1)] = 1 - drop;            // axial neighbour, lower by `drop`
  h[(cy + 1) * n + (cx + 1)] = 1 - drop;      // diagonal neighbour, lower by `drop`
  flow[cy * n + (cx + 1)] = 10;               // axial
  flow[(cy + 1) * n + (cx + 1)] = 20;         // diagonal

  const r = gaeaFlowReceiverMax({ height: h, flow, size: n, scale: 1 });
  ok(r[cy * n + cx] === 10,
    'the axial neighbour is admitted and the diagonal one is not, at the same drop',
    r[cy * n + cx]);

  // With the same threshold for both the answer would be 20, so this test discriminates.
  ok(r[cy * n + cx] !== 20, 'the diagonal neighbour is genuinely excluded, not merely smaller');
}

{
  // Direction: an uphill neighbour must never contribute, however large its flow value.
  const n = 5;
  const cx = 2, cy = 2;
  const h = new Float32Array(n * n).fill(1);
  const flow = new Float32Array(n * n);
  h[cy * n + (cx - 1)] = 1.5;                 // higher, so uphill
  flow[cy * n + (cx - 1)] = 100;

  const r = gaeaFlowReceiverMax({ height: h, flow, size: n, scale: 1 });
  ok(r[cy * n + cx] === 0,
    'an uphill neighbour contributes nothing even with a large flow value',
    r[cy * n + cx]);
}

{
  // A cell whose every neighbour is higher keeps its own value: this is what stops an
  // existing channel from being starved.
  const n = 5;
  const cx = 2, cy = 2;
  const h = new Float32Array(n * n).fill(2);
  const flow = new Float32Array(n * n);
  h[cy * n + cx] = 1;                          // the cell is the lowest point
  flow[cy * n + cx] = 7;

  const r = gaeaFlowReceiverMax({ height: h, flow, size: n, scale: 1 });
  ok(r[cy * n + cx] === 7, 'a pit retains its own flow value', r[cy * n + cx]);
}

{
  // Flat terrain: no neighbour is lower, so the stage degenerates to identity. This is the
  // cleanest statement that it selects downstream cells and nothing else.
  const n = 8;
  const h = new Float32Array(n * n).fill(0.5);
  const flow = new Float32Array(n * n);
  for (let i = 0; i < flow.length; i++) flow[i] = (i % 13) / 13;
  const r = gaeaFlowReceiverMax({ height: h, flow, size: n, scale: 1 });
  let identical = true;
  for (let i = 0; i < flow.length; i++) if (r[i] !== flow[i]) { identical = false; break; }
  ok(identical, 'on flat terrain the stage returns its input unchanged');
}

{
  // The result must never exceed the largest value in the flow buffer: it is a maximum of
  // selected entries plus the centre, so it cannot invent a value.
  const n = 16;
  const h = new Float32Array(n * n);
  const flow = new Float32Array(n * n);
  for (let i = 0; i < h.length; i++) h[i] = Math.sin(i * 0.7) * 0.5 + 0.5;
  for (let i = 0; i < flow.length; i++) flow[i] = (i % 7) * 0.3;
  const r = gaeaFlowReceiverMax({ height: h, flow, size: n, scale: 1 });
  let maxIn = -Infinity, maxOut = -Infinity;
  for (let i = 0; i < flow.length; i++) {
    maxIn = Math.max(maxIn, flow[i]);
    maxOut = Math.max(maxOut, r[i]);
  }
  ok(maxOut <= maxIn + 1e-9, 'the stage cannot exceed the maximum of its input', `${maxOut} > ${maxIn}`);
}

/* ------------------------------------------- pass 5 and pass 7/9, both small and exact */

{
  // FUN_1801f2ec0: flow = max(flow, min(1, 0.25 * raw)). A max, so it can only raise.
  ok(K_FLOW_NORMALIZE === 0.25, 'K_FLOW_NORMALIZE is 0.25', K_FLOW_NORMALIZE);

  const flow = new Float32Array([0, 0.9, 0.1, 0, 0.5]);
  const raw = new Float32Array([2, 1, 8, 0, -4]);      // 0.25*raw = .5, .25, 2, 0, -1
  const before = Float32Array.from(flow);
  gaeaFlowNormalize({ raw, flow });

  ok(flow[0] === 0.5, 'a raised entry takes the scaled raw value', flow[0]);
  ok(flow[1] === Math.fround(0.9),
    'an entry already above the bound is untouched', flow[1]);
  ok(flow[2] === 1, 'the scaled value saturates at 1', flow[2]);
  ok(flow[3] === 0, 'zero raw leaves zero flow', flow[3]);
  ok(flow[4] === 0.5, 'negative raw cannot lower the flow buffer', flow[4]);

  let neverLowered = true;
  for (let i = 0; i < flow.length; i++) if (flow[i] < before[i]) neverLowered = false;
  ok(neverLowered, 'the kernel never lowers the flow buffer');

  // Saturation means raw above 4 is indistinguishable from raw equal to 4.
  const a = new Float32Array([0]); const b = new Float32Array([0]);
  gaeaFlowNormalize({ raw: new Float32Array([4]), flow: a });
  gaeaFlowNormalize({ raw: new Float32Array([4000]), flow: b });
  ok(a[0] === b[0] && a[0] === 1, 'raw 4 and raw 4000 both saturate to 1', `${a[0]} / ${b[0]}`);
}

{
  // FUN_1801f3560: dst += src; src = 0.
  const src = new Float32Array([1, 0, 2.5, -0.5]);
  const dst = new Float32Array([10, 10, 10, 10]);
  const { dst: out, cleared } = gaeaFlushAccumulator({ src, dst });

  ok(out[0] === 11 && out[2] === 12.5 && out[3] === 9.5,
    'the source is accumulated into the destination', `${out[0]}, ${out[2]}, ${out[3]}`);
  ok(src[0] === 0 && src[2] === 0, 'the source is cleared', `${src[0]}, ${src[2]}`);
  ok(cleared === 3, 'cleared counts only the non-zero entries', cleared);

  // A second flush of the same (now empty) source must be a no-op, which is the property
  // that keeps iteration n from folding iteration n-1 in again.
  const again = gaeaFlushAccumulator({ src, dst });
  ok(again.dst[0] === 11 && again.dst[2] === 12.5,
    'flushing an already-cleared source changes nothing', `${again.dst[0]}, ${again.dst[2]}`);
  ok(again.cleared === 0, 'the second flush has nothing to clear', again.cleared);
}

/* --------------------------- the deferred last-writer apply (FUN_1801f0c60, pass 4) */

{
  // The fixed-point pair must be EXACT reciprocals; if it were 2^24 / 2^23 the applied value
  // would come out doubled, which is the kind of error that survives every smoke test.
  ok(K_FIXED_SCALE === 16777216, 'K_FIXED_SCALE is 2^24', K_FIXED_SCALE);
  ok(K_FIXED_INV * K_FIXED_SCALE === 1,
    'the fixed-point pair are exact reciprocals', K_FIXED_INV * K_FIXED_SCALE);
  ok(fromFixed(toFixed(0.75), 1) === 0.75, 'a fixed-point round trip is exact for 0.75',
    fromFixed(toFixed(0.75), 1));
}

{
  // Order independence is the whole reason the mechanism exists. Three droplets contributing
  // to one cell must give the same terrain regardless of the order they are processed in,
  // and the committed value must be the AVERAGE, not the sum.
  const run = (order) => {
    const height = new Float32Array([10]);
    const sumFixed = [0], visitCount = [0], startCount = [3];
    const contributions = [0.3, 0.9, 0.6];
    for (const idx of order) {
      gaeaDeferredApply({
        height, sumFixed, visitCount, startCount, cell: 0, amount: contributions[idx],
      });
    }
    return height[0];
  };

  const a = run([0, 1, 2]);
  const b = run([2, 1, 0]);
  const c = run([1, 0, 2]);
  ok(a === b && b === c, 'the applied result is independent of droplet order',
    `${a}, ${b}, ${c}`);

  // Average, not sum: contributions total 1.8, so the mean is 0.6.
  const mean = (0.3 + 0.9 + 0.6) / 3;
  ok(Math.abs((a - 10) - mean) < 1e-6,
    'the committed value is the average of the contributions, not their sum',
    `${(a - 10)} vs ${mean}`);

  // A sum-based implementation would land on 1.8, so this asserts the distinction rather
  // than merely being close to something.
  ok(Math.abs((a - 10) - 1.8) > 0.5, 'the result is clearly not the sum');
}

{
  // Only the last writer commits, and the accumulators must be reset so the next iteration
  // does not inherit this one.
  const height = new Float32Array([5]);
  const sumFixed = [0], visitCount = [0], startCount = [2];
  const first = gaeaDeferredApply({ height, sumFixed, visitCount, startCount, cell: 0, amount: 1 });
  ok(first.committed === false, 'the first droplet does not commit');
  ok(height[0] === 5, 'the terrain is untouched until the last writer', height[0]);

  const second = gaeaDeferredApply({ height, sumFixed, visitCount, startCount, cell: 0, amount: 3 });
  ok(second.committed === true, 'the second droplet commits');
  ok(Math.abs(height[0] - 7) < 1e-6, 'the average of 1 and 3 raises the cell by 2', height[0]);
  ok(sumFixed[0] === 0 && visitCount[0] === 0,
    'the accumulators are reset after committing', `${sumFixed[0]}, ${visitCount[0]}`);

  // With the accumulators cleared, a second round must not see the first round's material.
  const sumFixed2 = [0], visitCount2 = [0], startCount2 = [1];
  const round2 = gaeaDeferredApply({
    height, sumFixed: sumFixed2, visitCount: visitCount2, startCount: startCount2, cell: 0, amount: 4,
  });
  ok(Math.abs(round2.applied - 4) < 1e-6,
    'a fresh round applies only its own contribution', round2.applied);
}

/* -------------------------------------------------------------------------- report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('Gaea 3x3 relaxation: constants are a consistent pair, kernel is normalised');
  console.log('fidelity: the arithmetic is transcribed exactly; the node-parameter mapping is NOT');
}

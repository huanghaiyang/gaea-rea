/**
 * gaea-imaging-test.mjs — the ImageMagick-backed Gaea nodes.
 *
 * `Gamma` is the first of roughly twenty nodes that delegate to ImageMagick. The operation is
 * `pow(v, 1/gamma)`, and the defining test is not "does it look like a gamma curve" but the
 * fixed points and the AutoGamma property:
 *
 *   * 0 and 1 cannot move, for any gamma
 *   * gamma 1 is exactly the identity
 *   * AutoGamma must map the MEAN to 0.5 — that is what "auto" means, and a formula that only
 *     resembles the right shape fails it
 *
 * Run: node web/tests/gaea-imaging-test.mjs
 */

import { magickGammaCorrect, magickAutoGamma, magickGammaForMean, gaeaGamma } from '../js/kernels/imaging.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/* -------------------------------------------------------------------- gamma correct */

{
  // The endpoints are fixed points for every gamma. This is what stops a gamma change from
  // clipping the terrain's floor or ceiling.
  for (const g of [0.1, 0.44, 1, 2.2, 10]) {
    ok(magickGammaCorrect(0, g) === 0, `0 is a fixed point at gamma ${g}`);
    ok(magickGammaCorrect(1, g) === 1, `1 is a fixed point at gamma ${g}`);
  }

  // gamma 1 is exactly the identity, elementwise.
  let identity = true;
  for (let v = 0; v <= 1.0001; v += 0.01) {
    if (Math.abs(magickGammaCorrect(v, 1) - Math.min(1, v)) > 1e-12) { identity = false; break; }
  }
  ok(identity, 'gamma 1 is the identity');

  // THE DIRECTION. gamma > 1 means exponent 1/gamma < 1, which RAISES midtones. Getting the
  // reciprocal backwards produces the opposite look, so the direction is asserted rather than
  // left to inspection.
  ok(magickGammaCorrect(0.25, 2.2) > 0.25, 'gamma > 1 raises midtones',
    magickGammaCorrect(0.25, 2.2));
  ok(magickGammaCorrect(0.25, 0.5) < 0.25, 'gamma < 1 lowers midtones',
    magickGammaCorrect(0.25, 0.5));

  // Monotone in the sample, for a fixed gamma. A non-monotone curve would invert contrast
  // somewhere, which no gamma curve does.
  let monotone = true;
  let prev = -Infinity;
  for (let v = 0; v <= 1.0001; v += 0.005) {
    const o = magickGammaCorrect(v, 2.2);
    if (!(o >= prev)) { monotone = false; break; }
    prev = o;
  }
  ok(monotone, 'the curve is monotone in the sample');

  // Monotone in the gamma, for a fixed midtone below 1: raising gamma raises the output.
  let gammaMonotone = true;
  let prevG = -Infinity;
  for (let g = 0.1; g <= 5; g += 0.1) {
    const o = magickGammaCorrect(0.25, g);
    if (!(o >= prevG)) { gammaMonotone = false; break; }
    prevG = o;
  }
  ok(gammaMonotone, 'for a midtone, the output rises with gamma');

  // Out-of-range samples clamp rather than extrapolating into negative or large values.
  ok(magickGammaCorrect(-1, 2.2) === 0, 'a negative sample clamps to 0');
  ok(magickGammaCorrect(5, 2.2) === 1, 'a sample above 1 clamps to 1');
  ok(Number.isFinite(magickGammaCorrect(0.5, 0)) && magickGammaCorrect(0.5, 0) === 0.5,
    'a non-positive gamma falls back to the identity');
  ok(Number.isFinite(magickGammaCorrect(0.5, -3)), 'a negative gamma does not produce NaN');
}

/* --------------------------------------------------------------------- the auto gamma */

{
  // THE DEFINING PROPERTY: after AutoGamma, the mean must sit at 0.5. Anything that merely
  // reshapes the histogram fails this.
  for (const mean of [0.05, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 0.95]) {
    const g = magickAutoGamma(mean);
    const mapped = magickGammaCorrect(mean, g);
    ok(near(mapped, 0.5, 1e-9),
      `AutoGamma maps a mean of ${mean} to 0.5`, `${mapped} via gamma ${g}`);
  }

  // A mean already at 0.5 needs no correction.
  ok(near(magickAutoGamma(0.5), 1, 1e-12), 'a mean of 0.5 needs gamma 1',
    magickAutoGamma(0.5));

  // A dark image needs gamma > 1 to brighten; a bright one needs gamma < 1 to darken. The
  // direction follows from the fixed-point form and is worth pinning.
  ok(magickAutoGamma(0.25) > 1, 'a dark mean needs a gamma above 1', magickAutoGamma(0.25));
  ok(magickAutoGamma(0.75) < 1, 'a bright mean needs a gamma below 1', magickAutoGamma(0.75));

  // Degenerate means have no finite solution and must fall back rather than return NaN.
  for (const bad of [0, 1, -1, 2, NaN]) {
    const g = magickAutoGamma(bad);
    ok(Number.isFinite(g) && g > 0, `a degenerate mean ${bad} yields a usable gamma`, g);
  }

  // The closed form: g = log(mean)/log(0.5).
  ok(near(magickAutoGamma(0.25), Math.log(0.25) / Math.log(0.5), 1e-12),
    'the auto gamma is log(mean)/log(0.5)', magickAutoGamma(0.25));
  // log(0.25)/log(0.5) is exactly 2, which is a check on the whole derivation.
  ok(near(magickAutoGamma(0.25), 2, 1e-12), 'a mean of 0.25 gives exactly gamma 2',
    magickAutoGamma(0.25));

  // A different target must generalise, since the helper takes one.
  ok(near(magickGammaCorrect(0.3, magickGammaForMean(0.3, 0.25)), 0.25, 1e-12),
    'the mean-to-target helper generalises beyond 0.5');
}

/* -------------------------------------------------------------------------- the node */

{
  const size = 8;
  const n = size * size;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = (i + 1) / (n + 1);
  const field = { data, channels: 1, size, channel: 'height' };
  const ctx = (params) => ({ size, params, input: () => field });

  // The authoritative default and range come from the managed source, not from a guess:
  // [Parameter(0.44f, 0f, 4f)]. The old 0..1 assumption would be wrong.
  //
  // The output is a Float32Array, so the expectation is rounded with Math.fround before
  // comparing. Comparing a float32 store against a float64 computation needs a tolerance of
  // about 1e-7 relative, and using 1e-12 fails on correct code — which is what happened here.
  const manual = gaeaGamma(ctx({ Gamma: 0.44, Automatic: false }));
  let manualOk = true;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const want = Math.fround(magickGammaCorrect(data[i], 0.44));
    worst = Math.max(worst, Math.abs(manual.data[i] - want));
    if (manual.data[i] !== want) { manualOk = false; }
  }
  ok(manualOk, 'the node applies the manual gamma per sample', `worst ${worst}`);

  // Automatic must override the manual value, matching the if/else in Build().
  const auto = gaeaGamma(ctx({ Gamma: 0.44, Automatic: true }));
  const auto2 = gaeaGamma(ctx({ Gamma: 3.9, Automatic: true }));
  let same = true;
  for (let i = 0; i < n; i++) if (auto.data[i] !== auto2.data[i]) { same = false; break; }
  ok(same, 'Automatic ignores the manual Gamma parameter');

  // With Automatic, the OUTPUT mean must be near 0.5 — the operation applied per sample with
  // the gamma derived from the input mean.
  let meanIn = 0;
  for (let i = 0; i < n; i++) meanIn += data[i];
  meanIn /= n;
  let meanOut = 0;
  for (let i = 0; i < n; i++) meanOut += auto.data[i];
  meanOut /= n;
  ok(near(meanOut, 0.5, 1e-6), 'Automatic maps the field mean to 0.5', meanOut);

  // A missing input must yield null rather than throwing.
  ok(gaeaGamma({ size, params: {}, input: () => null }) === null,
    'a missing input yields null');

  // A multi-channel map must be transformed channel by channel, not flattened.
  const rgb = { data: new Float32Array(n * 3).fill(0.25), channels: 3, size, channel: 'color' };
  const rgbCtx = { size, params: { Gamma: 2, Automatic: false }, input: () => rgb };
  const out = gaeaGamma(rgbCtx);
  ok(out.channels === 3 && out.data.length === n * 3,
    'a multi-channel map keeps its channel count');
  ok(near(out.data[0], Math.fround(magickGammaCorrect(0.25, 2)), 0),
    'each channel is transformed', out.data[0]);
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
  console.log('Gaea Gamma (ImageMagick-backed): pow(v, 1/g), AutoGamma maps the mean to 0.5');
  console.log('fidelity: exact on the formula; the IL parameter default is authoritative');
}

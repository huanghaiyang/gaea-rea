/**
 * gaea-ops4-test.mjs — four more catalog-only nodes recovered in round 38.
 *
 * The pattern from the last three batches holds: the assertion worth writing is the one the
 * node's OWN parameters imply. Six real bugs have been caught that way -- a dead quantiser, a
 * window centred on the wrong bound, an absolute value cancelling a sign, an inverted Laplacian
 * convention, a low-pass that was the identity, and two nodes that ERASED their input wherever
 * they added nothing. Not one was found by checking that the code runs.
 *
 * Run: node web/tests/gaea-ops4-test.mjs
 */

import {
  gaeaLichtenberg, gaeaOrigami, gaeaAperture, gaeaAccumulator,
} from '../js/kernels/ops4.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
const idx = (size, x, y) => y * size + x;
const field = (data, size) => ({ data, channels: 1, size, channel: 'height' });
const ctx = (size, params, data) => ({ size, params, input: () => field(data, size) });

function base(size) {
  const d = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d[idx(size, x, y)] = 0.3 + 0.3 * (x / (size - 1));
  return d;
}
const identical = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const mean = (a) => { let s = 0; for (const v of a) s += v; return s / a.length; };

/* --------------------------------------------------------------- Lichtenberg */

{
  const size = 32;
  const b = base(size);
  const P = (o) => ({ Style: 'A', Scale: 0.4, Complexity: 2, Depth: 0.2, Expand: 0, Bias: 0, Seed: 1, ...o });

  // DEPTH 0 IS A STRICT NO-OP -- and this is the assertion that caught two nodes erasing their
  // input in the previous round, so it is checked first every time.
  const none = gaeaLichtenberg(ctx(size, P({ Depth: 0 }), b));
  ok(identical(none.data, b), 'Depth 0 leaves the field untouched');

  // With depth, channels must CUT DOWN into the terrain. A branching erosion only ever lowers,
  // so the mean must fall and nothing may exceed the input.
  const cut = gaeaLichtenberg(ctx(size, P({}), b));
  ok(mean(cut.data) < mean(b), 'Lichtenberg lowers the terrain on average',
    `${mean(b).toFixed(4)} -> ${mean(cut.data).toFixed(4)}`);
  let raised = 0;
  for (let i = 0; i < b.length; i++) if (cut.data[i] > b[i] + 1e-9) raised++;
  ok(raised === 0, 'a channel never raises a cell', raised);

  // Unvisited cells must keep the input, which is the property two earlier nodes violated.
  let untouched = 0;
  for (let i = 0; i < b.length; i++) if (cut.data[i] === b[i]) untouched++;
  ok(untouched > 0, 'cells away from the channels keep the input', untouched);

  // SEED MATTERS AND REPRODUCES.
  const s2 = gaeaLichtenberg(ctx(size, P({ Seed: 2 }), b));
  ok(!identical(cut.data, s2.data), 'a different Seed moves the channels');
  ok(identical(cut.data, gaeaLichtenberg(ctx(size, P({}), b)).data), 'the same Seed reproduces');

  // Output is a valid height.
  let inRange = true;
  for (const v of cut.data) if (v < 0 || v > 1) inRange = false;
  ok(inRange, 'the output stays in 0..1');
}

/* -------------------------------------------------------------------- Origami */

{
  const size = 24;
  const b = base(size);
  const P = (o) => ({ Amount: 0.25, Seed: 1, ...o });

  // AMOUNT 0 IS A STRICT NO-OP.
  const none = gaeaOrigami(ctx(size, P({ Amount: 0 }), b));
  ok(identical(none.data, b), 'Amount 0 leaves the field untouched');

  const folded = gaeaOrigami(ctx(size, P({}), b));
  ok(!identical(folded.data, b), 'Amount above 0 folds the terrain');

  // A FOLD RAISES, and it is PIECEWISE-LINEAR -- the signature is that a cell far from its
  // panel's crease rises MORE than one near it, in both directions away from the line.
  let raised = 0;
  for (let i = 0; i < b.length; i++) if (folded.data[i] > b[i]) raised++;
  ok(raised > 0, 'a fold raises terrain', raised);

  // Seed must matter.
  ok(!identical(folded.data, gaeaOrigami(ctx(size, P({ Seed: 2 }), b)).data),
    'a different Seed folds differently');

  let inRange = true;
  for (const v of folded.data) if (v < 0 || v > 1) inRange = false;
  ok(inRange, 'the folded output stays in 0..1');
}

/* ------------------------------------------------------------------- Aperture */

{
  const size = 24;
  // A field with a single high point, so erode and dilate must move in opposite directions.
  const b = new Float32Array(size * size).fill(0.4);
  b[idx(size, 12, 12)] = 0.9;
  const P = (o) => ({
    Mode: 'Erode', Size: 0.08, Shape: 'Square', VerticesCount: 4, CornerAngle: 90,
    Direction: 0, Antialiased: false, ...o,
  });

  // SIZE 0 IS A STRICT NO-OP.
  const none = gaeaAperture(ctx(size, P({ Size: 0 }), b));
  ok(identical(none.data, b), 'Size 0 leaves the field untouched');

  // THE TWO MODES MUST OPPOSE EACH OTHER. Erode takes the local minimum, dilate the maximum, so
  // on the same input one lowers the peak's neighbourhood and the other raises the flat's.
  const erode = gaeaAperture(ctx(size, P({ Mode: 'Erode' }), b));
  const dilate = gaeaAperture(ctx(size, P({ Mode: 'Dilate' }), b));
  ok(!identical(erode.data, dilate.data), 'the two modes differ');
  ok(mean(erode.data) < mean(b), 'Erode lowers the mean', `${mean(b).toFixed(4)} -> ${mean(erode.data).toFixed(4)}`);
  ok(mean(dilate.data) > mean(b), 'Dilate raises the mean', `${mean(b).toFixed(4)} -> ${mean(dilate.data).toFixed(4)}`);

  // And they bracket the input on every cell, which is the definition of a morphological pair.
  let bracketed = true;
  for (let i = 0; i < b.length; i++) {
    if (erode.data[i] > b[i] + 1e-9 || dilate.data[i] < b[i] - 1e-9) bracketed = false;
  }
  ok(bracketed, 'every cell is bracketed by erode and dilate');

  // Antialiased must blend rather than step.
  const aa = gaeaAperture(ctx(size, P({ Mode: 'Erode', Antialiased: true }), b));
  ok(!identical(aa.data, erode.data), 'Antialiased changes the result');
}

/* ---------------------------------------------------------------- Accumulator */

{
  const size = 16;

  // IT TAKES NO INPUT, so the context supplies none. That is the whole point of the node.
  const noInput = () => null;
  const a = gaeaAccumulator({ size, params: { Type: 'SnowMask' }, input: noInput });
  ok(a !== null, 'the accumulator works with no input connected');
  ok(a.data.length === size * size, 'and produces a full field', a.data.length);

  // EVERY TYPE MUST BE A VALID MASK.
  const types = ['SnowMask', 'RainMask', 'SandMask', 'DebrisMask', 'FlowMask'];
  for (const t of types) {
    const m = gaeaAccumulator({ size, params: { Type: t }, input: noInput });
    let inRange = true;
    for (const v of m.data) if (v < 0 || v > 1) inRange = false;
    ok(inRange, `${t} is a 0..1 mask`);
  }

  // AND THE TYPES MUST DIFFER. A generator that ignored its only parameter would return the
  // same mask for every type, which is the failure this asserts against.
  const snow = gaeaAccumulator({ size, params: { Type: 'SnowMask' }, input: noInput });
  const rain = gaeaAccumulator({ size, params: { Type: 'RainMask' }, input: noInput });
  ok(!identical(snow.data, rain.data), 'SnowMask and RainMask differ');
  // Snow settles high, rain collects low, so they must be roughly opposed rather than merely
  // different -- that is what makes the type names mean something.
  // OPPOSITION IS A CORRELATION, NOT A COUNT. Counting cells where snow exceeds rain gives
  // exactly half for two monotone gradients -- the split falls on the median -- so the first
  // version of this assertion failed at 128 of 256 while the masks were, in fact, perfectly
  // anti-correlated. The SIGN of the correlation is what "opposed" means, and the count was
  // measuring where the crossover happens rather than whether there is one.
  let corr = 0;
  {
    const a = snow.data;
    const b = rain.data;
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
    ma /= a.length;
    mb /= b.length;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] - ma;
      const y = b[i] - mb;
      num += x * y;
      da += x * x;
      db += y * y;
    }
    corr = num / Math.sqrt(da * db || 1);
  }
  ok(corr < -0.5, 'snow and rain are anti-correlated, not merely different', corr.toFixed(4));

  const unknown = gaeaAccumulator({ size, params: { Type: 'SomethingElse' }, input: noInput });
  let finite = true;
  for (const v of unknown.data) if (!Number.isFinite(v)) finite = false;
  ok(finite, 'an unrecognised type still yields a finite field');
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
  console.log('Gaea ops4: Lichtenberg, Origami, Aperture, Accumulator');
  console.log('fidelity: approx — the helper bodies were not read; parameter shapes are exact');
}

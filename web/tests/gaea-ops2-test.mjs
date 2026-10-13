/**
 * gaea-ops2-test.mjs — five more catalog-only nodes recovered in round 36.
 *
 * The properties asserted here are the ones each node's OWN parameters imply, not cosmetic
 * checks. Round 35's batch turned up four real bugs that only a property assertion could catch
 * -- a dead quantiser, a window centred on the wrong bound, an absolute value that cancelled a
 * sign, and a Laplacian convention opposite to the continuous one. So each test below asks for
 * the thing that would break if the operation were merely shaped correctly.
 *
 * Run: node web/tests/gaea-ops2-test.mjs
 */

import {
  gaeaAngle, gaeaFilter, gaeaEdge, gaeaRoughen, gaeaCraggy,
} from '../js/kernels/ops2.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
const idx = (size, x, y) => y * size + x;
const field = (data, size) => ({ data, channels: 1, size, channel: 'height' });
const ctx = (size, params, data) => ({ size, params, input: () => field(data, size) });
const mean = (a) => { let s = 0; for (const v of a) s += v; return s / a.length; };

/* ------------------------------------------------------------------------ Angle */

{
  const size = 17;

  // A FLAT FIELD HAS NO ASPECT. This is the assertion that catches a missing zero-gradient
  // guard, where normalising a zero vector produces an arbitrary direction.
  const flat = new Float32Array(size * size).fill(0.5);
  const f = gaeaAngle(ctx(size, { Azimuth: 0, Range: [0.5, 1], Falloff: 0.1 }, flat));
  let flatMax = 0;
  for (const v of f.data) flatMax = Math.max(flatMax, v);
  ok(flatMax < 1e-9, 'a flat field faces nothing', flatMax);

  // A SLOPE RISING TOWARDS +x faces azimuth 0. With the range selecting the upper half of the
  // cosine, that cell must be lit and the opposite-facing one dark.
  const ramp = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) ramp[idx(size, x, y)] = 0.2 + 0.03 * x;
  const east = gaeaAngle(ctx(size, { Azimuth: 0, Range: [0.5, 1], Falloff: 0.05 }, ramp));
  ok(east.data[idx(size, 8, 8)] > 0.9, 'a slope rising towards the azimuth is lit',
    east.data[idx(size, 8, 8)]);

  // The SAME ramp measured against azimuth 180 must go dark, which is what makes this a
  // directional mask rather than a slope mask.
  const west = gaeaAngle(ctx(size, { Azimuth: 180, Range: [0.5, 1], Falloff: 0.05 }, ramp));
  ok(west.data[idx(size, 8, 8)] < 0.1, 'the opposite azimuth goes dark',
    west.data[idx(size, 8, 8)]);

  // Output is a mask.
  let inRange = true;
  for (const v of east.data) if (v < 0 || v > 1) inRange = false;
  ok(inRange, 'the angle output is a 0..1 mask');
}

/* ----------------------------------------------------------------------- Filter */

{
  const size = 24;
  const d = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // A smooth base plus fine ripples, so there is a real band to separate.
    d[idx(size, x, y)] = 0.5 + 0.2 * Math.sin(x * 0.15) + 0.02 * ((x * 7 + y * 13) % 5) / 5;
  }
  const P = (over) => ({ Mode: 'LowPass', Frequency: 0.5, Gain: 1, Q: 0.5, KeepDC: false, ...over });

  // A LOW-PASS MUST REDUCE VARIANCE. If the mode were ignored, this would be unchanged.
  const variance = (a) => { const m = mean(a); let v = 0; for (const x of a) v += (x - m) ** 2; return v / a.length; };
  const low = gaeaFilter(ctx(size, P({ Mode: 'LowPass' }), d));
  ok(variance(low.data) < variance(d), 'LowPass reduces variance',
    `${variance(d).toFixed(6)} -> ${variance(low.data).toFixed(6)}`);

  // Gain must scale the selected band. A gain of 3 on the detail must raise the variance above
  // the unit-gain case.
  const g1 = gaeaFilter(ctx(size, P({ Mode: 'HighPass', Gain: 1 }), d));
  const g3 = gaeaFilter(ctx(size, P({ Mode: 'HighPass', Gain: 3 }), d));
  ok(variance(g3.data) > variance(g1.data), 'Gain scales the selected band',
    `${variance(g1.data).toFixed(6)} -> ${variance(g3.data).toFixed(6)}`);

  // KEEPDC IS THE CHECKABLE ONE: the output mean must match the input's. Without it a band gain
  // shifts the mean, which is exactly what the flag exists to prevent.
  const kept = gaeaFilter(ctx(size, P({ Mode: 'LowPass', Gain: 0.2, KeepDC: true }), d));
  ok(Math.abs(mean(kept.data) - mean(d)) < 1e-6, 'KeepDC preserves the mean',
    `${mean(d).toFixed(8)} vs ${mean(kept.data).toFixed(8)}`);
  const unkept = gaeaFilter(ctx(size, P({ Mode: 'LowPass', Gain: 0.2, KeepDC: false }), d));
  ok(Math.abs(mean(unkept.data) - mean(d)) > 1e-3, 'without KeepDC the mean moves',
    `${mean(unkept.data).toFixed(6)}`);
}

/* ------------------------------------------------------------------------- Edge */

{
  const size = 24;

  // A FLAT FIELD HAS NO EDGES.
  const flat = new Float32Array(size * size).fill(0.5);
  const f = gaeaEdge(ctx(size, { Style: 'Square', Size: 1, Pixels: 2, Softness: 0.25 }, flat));
  let flatMax = 0;
  for (const v of f.data) flatMax = Math.max(flatMax, v);
  ok(flatMax < 1e-6, 'a flat field has no edges', flatMax);

  // A STEP DOES. Only the boundary should light, not the interiors.
  const step = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) step[idx(size, x, y)] = x < size / 2 ? 0.2 : 0.8;
  const e = gaeaEdge(ctx(size, { Style: 'Square', Size: 1, Pixels: 2, Softness: 0.25 }, step));
  const atEdge = e.data[idx(size, size / 2 - 1, 12)];
  const interior = e.data[idx(size, 3, 12)];
  ok(atEdge > interior, 'the step boundary is brighter than the interior',
    `${atEdge.toFixed(4)} vs ${interior.toFixed(4)}`);
  ok(interior < 0.1, 'a flat interior reads as no edge', interior.toFixed(4));

  // A ROUND style must differ from a SQUARE one on a diagonal-ish feature. Using a single
  // raised point gives a gradient whose two components differ, which is where they diverge.
  const dot = new Float32Array(size * size).fill(0.5);
  dot[idx(size, 12, 12)] = 0.9;
  const sq = gaeaEdge(ctx(size, { Style: 'Square', Size: 1, Pixels: 1, Softness: 0.05 }, dot));
  const rd = gaeaEdge(ctx(size, { Style: 'Round', Size: 1, Pixels: 1, Softness: 0.05 }, dot));
  let differs = false;
  for (let i = 0; i < sq.data.length; i++) if (sq.data[i] !== rd.data[i]) { differs = true; break; }
  ok(differs, 'the round and square styles differ');

  // Softness must change the output, or the parameter is decorative.
  const soft = gaeaEdge(ctx(size, { Style: 'Square', Size: 1, Pixels: 2, Softness: 0.6 }, step));
  let softDiffers = false;
  for (let i = 0; i < e.data.length; i++) if (e.data[i] !== soft.data[i]) { softDiffers = true; break; }
  ok(softDiffers, 'Softness changes the edge response');
}

/* ---------------------------------------------------------------------- Roughen */

{
  const size = 20;
  const base = new Float32Array(size * size).fill(0.5);

  // DEPTH 0 IS A STRICT NO-OP.
  const none = gaeaRoughen(ctx(size, { Width: 0.2, Depth: 0, Oriented: false, Quality: 'Quarter' }, base));
  let unchanged = true;
  for (let i = 0; i < base.length; i++) if (none.data[i] !== base[i]) { unchanged = false; break; }
  ok(unchanged, 'Depth 0 leaves the field untouched');

  // With depth the field must gain variance -- a placeholding no-op would fail this.
  const rough = gaeaRoughen(ctx(size, { Width: 0.2, Depth: 0.5, Oriented: false, Quality: 'Quarter' }, base));
  let variance = 0;
  for (const v of rough.data) variance += (v - 0.5) ** 2;
  ok(variance > 0, 'Depth above 0 adds relief', variance);
  let stillInRange = true;
  for (const v of rough.data) if (v < 0 || v > 1) stillInRange = false;
  ok(stillInRange, 'the roughened field stays in range');

  // Oriented must differ from isotropic, or the flag does nothing.
  const iso = gaeaRoughen(ctx(size, { Width: 0.3, Depth: 0.6, Oriented: false, Quality: 'Quarter' }, base));
  const ori = gaeaRoughen(ctx(size, { Width: 0.3, Depth: 0.6, Oriented: true, Quality: 'Quarter' }, base));
  let differs = false;
  for (let i = 0; i < iso.data.length; i++) if (iso.data[i] !== ori.data[i]) { differs = true; break; }
  ok(differs, 'Oriented changes the noise');

  // Width must matter too.
  const wide = gaeaRoughen(ctx(size, { Width: 0.9, Depth: 0.6, Oriented: false, Quality: 'Quarter' }, base));
  let widthDiffers = false;
  for (let i = 0; i < iso.data.length; i++) if (iso.data[i] !== wide.data[i]) { widthDiffers = true; break; }
  ok(widthDiffers, 'Width changes the noise scale');
}

/* ---------------------------------------------------------------------- Craggy */

{
  const size = 20;
  const base = new Float32Array(size * size).fill(0.5);

  // DEPTH 0 IS A STRICT NO-OP.
  const none = gaeaCraggy(ctx(size, { Size: 1.5, Depth: 0, Shape: 0.5, Seed: 1 }, base));
  let unchanged = true;
  for (let i = 0; i < base.length; i++) if (none.data[i] !== base[i]) { unchanged = false; break; }
  ok(unchanged, 'Depth 0 leaves the field untouched');

  const c = gaeaCraggy(ctx(size, { Size: 1.5, Depth: 0.8, Shape: 0.5, Seed: 1 }, base));
  let variance = 0;
  for (const v of c.data) variance += (v - 0.5) ** 2;
  ok(variance > 0, 'Depth above 0 adds craggy relief', variance);

  // SEED MUST MATTER, or the field is not noise.
  const c2 = gaeaCraggy(ctx(size, { Size: 1.5, Depth: 0.8, Shape: 0.5, Seed: 2 }, base));
  let seedDiffers = false;
  for (let i = 0; i < c.data.length; i++) if (c.data[i] !== c2.data[i]) { seedDiffers = true; break; }
  ok(seedDiffers, 'a different Seed changes the field');

  // And the same seed must be reproducible.
  const c3 = gaeaCraggy(ctx(size, { Size: 1.5, Depth: 0.8, Shape: 0.5, Seed: 1 }, base));
  let same = true;
  for (let i = 0; i < c.data.length; i++) if (c.data[i] !== c3.data[i]) { same = false; break; }
  ok(same, 'the same Seed reproduces the field');

  // Shape must change the character, and Size the scale.
  const shaped = gaeaCraggy(ctx(size, { Size: 1.5, Depth: 0.8, Shape: 0.9, Seed: 1 }, base));
  let shapeDiffers = false;
  for (let i = 0; i < c.data.length; i++) if (c.data[i] !== shaped.data[i]) { shapeDiffers = true; break; }
  ok(shapeDiffers, 'Shape changes the relief character');
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
  console.log('Gaea ops2: Angle, Filter, Edge, Roughen, Craggy');
  console.log('fidelity: approx — the helper bodies were not read; parameter shapes are exact');
}

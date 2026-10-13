/**
 * gaea-ops3-test.mjs — five more catalog-only nodes recovered in round 37.
 *
 * The previous two batches turned up five real bugs, every one caught by asking what the node's
 * own NAME implies must hold rather than by checking that it runs. This file follows that
 * discipline: neutral settings must be identities, zero settings must be no-ops, seeds must
 * matter and be reproducible, and a mask must respond to the quantity it is named after.
 *
 * Run: node web/tests/gaea-ops3-test.mjs
 */

import {
  gaeaGraphicEQ, gaeaPockmarks, gaeaOutcrops, gaeaRockMap, gaeaBulbous,
} from '../js/kernels/ops3.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
const idx = (size, x, y) => y * size + x;
const field = (data, size) => ({ data, channels: 1, size, channel: 'height' });
const ctx = (size, params, data) => ({ size, params, input: () => field(data, size) });

function ramp(size) {
  const d = new Float32Array(size * size);
  for (let i = 0; i < d.length; i++) d[i] = i / (d.length - 1);
  return d;
}
function shuffled(size, seedv) {
  const d = ramp(size);
  let s = seedv >>> 0;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = d[i]; d[i] = d[j]; d[j] = t;
  }
  return d;
}

/* ------------------------------------------------------------------- GraphicEQ */

{
  const size = 20;
  const d = shuffled(size, 7);

  // ALL BANDS NEUTRAL IS AN IDENTITY. An equaliser that reshapes the distribution with every
  // band at 1 is a mapping error, and this is the assertion that catches it.
  const neutral = gaeaGraphicEQ(ctx(size, {
    Band1: 1, Band2: 1, Band3: 1, Band4: 1, Band5: 1, Band6: 1, Band7: 1,
  }, d));
  let worst = 0;
  for (let i = 0; i < d.length; i++) worst = Math.max(worst, Math.abs(neutral.data[i] - d[i]));
  ok(worst < 1e-6, 'all bands at 1 is an identity', worst);

  // A BOOSTED BAND MUST CHANGE ITS RANGE. Band 1 covers the bottom seventh, so raising it must
  // move low values and leave high ones alone.
  const boosted = gaeaGraphicEQ(ctx(size, {
    Band1: 2, Band2: 1, Band3: 1, Band4: 1, Band5: 1, Band6: 1, Band7: 1,
  }, d));
  const lowIdx = d.findIndex((v) => v > 0.02 && v < 0.1);
  const highIdx = d.findIndex((v) => v > 0.9);
  ok(boosted.data[lowIdx] !== d[lowIdx], 'a boosted band moves its own range',
    `${d[lowIdx].toFixed(4)} -> ${boosted.data[lowIdx].toFixed(4)}`);
  ok(Math.abs(boosted.data[highIdx] - d[highIdx]) < 1e-6,
    'and leaves the other bands alone', boosted.data[highIdx]);

  // Output stays a valid height.
  let inRange = true;
  for (const v of boosted.data) if (v < 0 || v > 1) inRange = false;
  ok(inRange, 'the equalised output stays in 0..1');
}

/* ------------------------------------------------------------------- Pockmarks */

{
  const size = 24;
  const base = new Float32Array(size * size).fill(0.5);
  const P = (o) => ({ Size: 0.4, Scale: 0.6, Height: 1, Density: 0.5, Multiplier: 0.5, Invert: false, Seed: 1, ...o });

  // DENSITY 0 IS A STRICT NO-OP.
  const none = gaeaPockmarks(ctx(size, P({ Density: 0 }), base));
  let unchanged = true;
  for (let i = 0; i < base.length; i++) if (none.data[i] !== base[i]) { unchanged = false; break; }
  ok(unchanged, 'Density 0 leaves the field untouched');

  // With density the field must gain relief.
  const marks = gaeaPockmarks(ctx(size, P({}), base));
  let variance = 0;
  for (const v of marks.data) variance += (v - 0.5) ** 2;
  ok(variance > 0, 'Density above 0 adds marks', variance);

  // INVERT MUST FLIP THE SIGN of the marks.
  const inverted = gaeaPockmarks(ctx(size, P({ Invert: true }), base));
  let above = 0;
  let below = 0;
  for (let i = 0; i < base.length; i++) {
    if (marks.data[i] < base[i]) below++;
    if (inverted.data[i] > base[i]) above++;
  }
  ok(below > 0 && above > 0, 'Invert turns pits into bumps', `${below} pits, ${above} bumps`);

  // SEED MUST MATTER and be reproducible.
  const s2 = gaeaPockmarks(ctx(size, P({ Seed: 2 }), base));
  let differs = false;
  for (let i = 0; i < marks.data.length; i++) if (marks.data[i] !== s2.data[i]) { differs = true; break; }
  ok(differs, 'a different Seed moves the marks');
  const again = gaeaPockmarks(ctx(size, P({}), base));
  let same = true;
  for (let i = 0; i < marks.data.length; i++) if (marks.data[i] !== again.data[i]) { same = false; break; }
  ok(same, 'the same Seed reproduces the marks');
}

/* -------------------------------------------------------------------- Outcrops */

{
  const size = 24;
  const base = new Float32Array(size * size).fill(0.5);
  const P = (o) => ({
    Variations: 3, Strata: 0.1, Density: 0.4, Shape: 0, Chipped: true,
    Seed: 1, Size: 0.4, Height: 0.45, Rotation: 0, ...o,
  });

  const none = gaeaOutcrops(ctx(size, P({ Density: 0 }), base));
  let unchanged = true;
  for (let i = 0; i < base.length; i++) if (none.data[i] !== base[i]) { unchanged = false; break; }
  ok(unchanged, 'Density 0 leaves the field untouched');

  // Outcrops RAISE the terrain, since Height is a positive parameter.
  const raised = gaeaOutcrops(ctx(size, P({}), base));
  let above = 0;
  for (let i = 0; i < base.length; i++) if (raised.data[i] > base[i]) above++;
  ok(above > 0, 'outcrops raise the terrain', above);

  // Height 0 must add nothing, which separates "placed a mass" from "painted noise".
  const flat = gaeaOutcrops(ctx(size, P({ Height: 0 }), base));
  let flatUnchanged = true;
  for (let i = 0; i < base.length; i++) if (flat.data[i] !== base[i]) { flatUnchanged = false; break; }
  ok(flatUnchanged, 'Height 0 adds nothing');

  const s2 = gaeaOutcrops(ctx(size, P({ Seed: 2 }), base));
  let differs = false;
  for (let i = 0; i < raised.data.length; i++) if (raised.data[i] !== s2.data[i]) { differs = true; break; }
  ok(differs, 'a different Seed moves the outcrops');
}

/* -------------------------------------------------------------------- RockMap */

{
  const size = 20;

  // A FLAT FIELD HAS NO SLOPE, so no rock.
  const flat = new Float32Array(size * size).fill(0.5);
  const f = gaeaRockMap(ctx(size, { Coverage: 0.33, Density: 0 }, flat));
  let flatMax = 0;
  for (const v of f.data) flatMax = Math.max(flatMax, v);
  ok(flatMax < 1e-6, 'a flat field holds no rock', flatMax);

  // THE MASK MUST RISE WITH SLOPE. A steep ramp against a gentle one must read higher, which is
  // what makes this a slope map rather than a threshold on height.
  const gentle = new Float32Array(size * size);
  const steep = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      gentle[idx(size, x, y)] = 0.5 + 0.002 * x;
      steep[idx(size, x, y)] = 0.5 + 0.02 * x;
    }
  }
  // Each is normalised against its OWN maximum, so compare against a mixed field instead: put
  // both slopes in one field so the normalisation is shared.
  const mixed = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      mixed[idx(size, x, y)] = y < size / 2 ? 0.5 + 0.02 * x : 0.5 + 0.002 * x;
    }
  }
  const m = gaeaRockMap(ctx(size, { Coverage: 0.5, Density: 0 }, mixed));
  const slopeHigh = m.data[idx(size, 10, 5)];
  const slopeLow = m.data[idx(size, 10, 15)];
  ok(slopeHigh > slopeLow, 'the steeper half reads higher', `${slopeHigh.toFixed(4)} vs ${slopeLow.toFixed(4)}`);

  // Output is a mask.
  let inRange = true;
  for (const v of m.data) if (v < 0 || v > 1) inRange = false;
  ok(inRange, 'the rock map is a 0..1 mask');
}

/* -------------------------------------------------------------------- Bulbous */

{
  const size = 20;
  const d = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d[idx(size, x, y)] = 0.2 + 0.6 * (x / (size - 1));

  // MONOTONE IN THE INPUT: inflating masses must not invert the terrain's ordering, which a
  // sign error in the scale term would do.
  const out = gaeaBulbous(ctx(size, { Scale: 0.9, Jitter: 0 }, d));
  let monotone = true;
  for (let y = 0; y < size; y++) {
    for (let x = 1; x < size; x++) {
      if (out.data[idx(size, x, y)] < out.data[idx(size, x - 1, y)] - 1e-9) monotone = false;
    }
  }
  ok(monotone, 'the bulge is monotone in the input');

  // Scale must matter, and differently on either side of the neutral 0.5.
  const shrink = gaeaBulbous(ctx(size, { Scale: 0.1, Jitter: 0 }, d));
  let differs = false;
  for (let i = 0; i < d.length; i++) if (shrink.data[i] !== out.data[i]) { differs = true; break; }
  ok(differs, 'Scale changes the result');

  // JITTER 0 IS DETERMINISTIC; jitter above 0 must vary.
  const a = gaeaBulbous(ctx(size, { Scale: 0.9, Jitter: 0 }, d));
  const b = gaeaBulbous(ctx(size, { Scale: 0.9, Jitter: 0 }, d));
  let same = true;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) { same = false; break; }
  ok(same, 'Jitter 0 is deterministic');

  const j = gaeaBulbous(ctx(size, { Scale: 0.9, Jitter: 0.5 }, d));
  let jDiffers = false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== j.data[i]) { jDiffers = true; break; }
  ok(jDiffers, 'Jitter changes the result');

  // Output stays a valid height.
  let inRange = true;
  for (const v of j.data) if (v < 0 || v > 1) inRange = false;
  ok(inRange, 'the bulged output stays in 0..1');
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
  console.log('Gaea ops3: GraphicEQ, Pockmarks, Outcrops, RockMap, Bulbous');
  console.log('fidelity: approx — the helper bodies were not read; parameter shapes are exact');
}

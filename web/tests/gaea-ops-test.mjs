/**
 * gaea-ops-test.mjs — five small catalog-only nodes recovered in round 35.
 *
 * Each of these calls a named Gaea helper whose semantics are fixed by the node's parameters.
 * The tests therefore check the PROPERTIES the parameters imply rather than reproducing an
 * unread body:
 *
 *   * Threshold's split must be inclusive at the level, or a 0.5-lit field goes dark
 *   * SoftClip at Softness 0 must degenerate to a HARD clip
 *   * Terraces must actually produce the requested number of distinct bands
 *   * Pixelate must produce exactly `block^2` distinct values with Antialias off
 *   * Curvature must be zero on a plane and non-zero on a ridge
 *
 * Run: node web/tests/gaea-ops-test.mjs
 */

import {
  gaeaThreshold, gaeaSoftClip, gaeaTerraces, gaeaPixelate, gaeaCurvature,
} from '../js/kernels/ops.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
const idx = (size, x, y) => y * size + x;
const field = (data, size) => ({ data, channels: 1, size, channel: 'height' });
const ctx = (size, params, data) => ({ size, params, input: () => field(data, size) });

/* ------------------------------------------------------------------- Threshold */

{
  const size = 8;
  const d = new Float32Array(size * size);
  for (let i = 0; i < d.length; i++) d[i] = i / (d.length - 1);

  const out = gaeaThreshold(ctx(size, { Level: 0.5 }, d));
  let ones = 0;
  let zeros = 0;
  for (const v of out.data) { if (v === 1) ones++; else if (v === 0) zeros++; }
  ok(ones + zeros === d.length, 'the threshold output is strictly binary', `${ones}/${zeros}`);
  ok(ones > 0 && zeros > 0, 'both sides are represented');

  // THE INCLUSIVE BOUNDARY. A field exactly at the level must land on the lit side; a strict
  // comparison would put a 0.5-lit field entirely in the dark half.
  const flat = new Float32Array(size * size).fill(0.5);
  const at = gaeaThreshold(ctx(size, { Level: 0.5 }, flat));
  ok(at.data[0] === 1, 'a cell exactly at the level is lit, not dark', at.data[0]);

  // Below the level stays dark.
  const below = gaeaThreshold(ctx(size, { Level: 0.75 }, flat));
  ok(below.data[0] === 0, 'a cell below the level is dark', below.data[0]);

  ok(gaeaThreshold({ size, params: {}, input: () => null }) !== null,
    'a missing input yields an empty field rather than throwing');
}

/* -------------------------------------------------------------------- SoftClip */

{
  const size = 8;
  const flat = new Float32Array(size * size).fill(0.8);
  const P = (over) => ({ ClipMode: 'AboveThreshold', Threshold: 0.5, Softness: 0.1, Clipping: 1, ...over });

  // SOFTNESS 0 DEGENERATES TO A HARD CLIP: 0.8 above a 0.5 threshold with full clipping comes
  // out AT the threshold, not near it. A soft clip that stayed soft at zero would fail this.
  const hard = gaeaSoftClip(ctx(size, P({ Softness: 0 }), flat));
  ok(Math.abs(hard.data[0] - 0.5) < 1e-6, 'Softness 0 clips hard to the threshold', hard.data[0]);

  // With softness the value stays ABOVE the threshold, because the knee only pulls partway.
  // The knee spans +-Softness, so a 0.3 offset needs a knee wider than 0.3 for the value to
  // stay above the threshold. The first version used 0.3 and saturated the knee exactly.
  const soft = gaeaSoftClip(ctx(size, P({ Softness: 0.5 }), flat));
  ok(soft.data[0] > 0.5, 'a soft knee leaves the value above the threshold', soft.data[0]);
  ok(soft.data[0] < 0.8, 'but still pulls it down');

  // Clipping 0 must leave the field alone entirely.
  const none = gaeaSoftClip(ctx(size, P({ Clipping: 0 }), flat));
  ok(Math.abs(none.data[0] - 0.8) < 1e-6, 'Clipping 0 is a no-op', none.data[0]);

  // The mode must select the side. AboveThreshold leaves a low value alone; BelowThreshold
  // clips it, so the low field must move UP under the other mode.
  const low = new Float32Array(size * size).fill(0.2);
  const lowAbove = gaeaSoftClip(ctx(size, P({ ClipMode: 'AboveThreshold' }), low));
  ok(Math.abs(lowAbove.data[0] - 0.2) < 1e-6, 'AboveThreshold leaves a low value alone',
    lowAbove.data[0]);
  const lowBelow = gaeaSoftClip(ctx(size, P({ ClipMode: 'BelowThreshold' }), low));
  ok(lowBelow.data[0] > 0.2, 'BelowThreshold pulls a low value up', lowBelow.data[0]);

  // Output must stay in range whatever the input.
  const wild = new Float32Array(size * size);
  for (let i = 0; i < wild.length; i++) wild[i] = (i % 7) / 7 * 2 - 0.5;
  const clipped = gaeaSoftClip(ctx(size, P({}), wild));
  let inRange = true;
  for (const v of clipped.data) if (v < 0 || v > 1) inRange = false;
  ok(inRange, 'the output stays in 0..1 for out-of-range input');
}

/* --------------------------------------------------------------------- Terraces */

{
  const size = 16;
  const ramp = new Float32Array(size * size);
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / (ramp.length - 1);

  // THE BAND COUNT is the defining property. With Uniformity 1 there is no jitter, so the
  // number of distinct values should be close to NumTerraces.
  const out = gaeaTerraces(ctx(size, {
    NumTerraces: 8, Uniformity: 1, Steepness: 0, Intensity: 1, Seed: 0,
  }, ramp));
  const distinct = new Set();
  for (const v of out.data) distinct.add(v.toFixed(4));
  ok(distinct.size >= 6 && distinct.size <= 10,
    'the output has roughly the requested band count', distinct.size);

  // A higher count must produce more bands.
  const many = gaeaTerraces(ctx(size, {
    NumTerraces: 32, Uniformity: 1, Steepness: 0, Intensity: 1, Seed: 0,
  }, ramp));
  const manyDistinct = new Set();
  for (const v of many.data) manyDistinct.add(v.toFixed(4));
  ok(manyDistinct.size > distinct.size, 'more terraces give more bands',
    `${distinct.size} -> ${manyDistinct.size}`);

  // Intensity 0 must leave the field untouched.
  const none = gaeaTerraces(ctx(size, {
    NumTerraces: 8, Uniformity: 1, Steepness: 0, Intensity: 0, Seed: 0,
  }, ramp));
  let unchanged = true;
  for (let i = 0; i < ramp.length; i++) if (Math.abs(none.data[i] - ramp[i]) > 1e-6) { unchanged = false; break; }
  ok(unchanged, 'Intensity 0 leaves the field unchanged');

  // Uniformity controls the jitter and must be observable. An earlier version asserted a
  // seed-to-seed difference instead, which at 8 bands is not reliable: the jitter amplitude is
  // at most half a band, so most cells stay inside their step and the two seeds agree. Uniformity
  // 0 against 1 is the effect the parameter actually names.
  const jittered = gaeaTerraces(ctx(size, { NumTerraces: 8, Uniformity: 0.2, Steepness: 0, Intensity: 1, Seed: 1 }, ramp));
  const clean = gaeaTerraces(ctx(size, { NumTerraces: 8, Uniformity: 1, Steepness: 0, Intensity: 1, Seed: 1 }, ramp));
  let differs = false;
  for (let i = 0; i < jittered.data.length; i++) {
    if (jittered.data[i] !== clean.data[i]) { differs = true; break; }
  }
  ok(differs, 'Uniformity below 1 introduces jitter');
}

/* --------------------------------------------------------------------- Pixelate */

{
  const size = 16;
  // The ramp must vary ACROSS blocks, not merely along a direction: `(x + y)` is constant on
  // anti-diagonals, so several blocks share a mean and the distinct-value count came out at 7
  // instead of block^2. Indexing by the block itself makes every block distinct.
  const d = new Float32Array(size * size);
  {
    const blk = Math.round(0.25 * size);
    const bw = Math.ceil(size / blk);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const bi = Math.floor(y / blk) * bw + Math.floor(x / blk);
        d[idx(size, x, y)] = (bi + 1) / (bw * bw + 1);
      }
    }
  }

  // ANTIALIAS OFF MEANS EXACTLY ONE VALUE PER BLOCK, which is the definition of pixelation and
  // is checkable by counting distinct values.
  const hard = gaeaPixelate(ctx(size, { Size: 0.25, Autosize: false, Antialias: false }, d));
  const block = Math.round(0.25 * size);      // 4
  const distinct = new Set();
  for (const v of hard.data) distinct.add(v.toFixed(4));
  ok(distinct.size === block * block, 'hard pixelation gives exactly block^2 distinct values',
    `${distinct.size} vs ${block * block}`);
  // Every cell of a block shares its value.
  const v00 = hard.data[idx(size, 0, 0)];
  let sameBlock = true;
  for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) {
    if (hard.data[idx(size, x, y)] !== v00) sameBlock = false;
  }
  ok(sameBlock, 'a block is uniform with Antialias off');

  // Antialias on must produce more distinct values, since the edges blend.
  const soft = gaeaPixelate(ctx(size, { Size: 0.25, Autosize: false, Antialias: true }, d));
  const softDistinct = new Set();
  for (const v of soft.data) softDistinct.add(v.toFixed(4));
  ok(softDistinct.size > distinct.size, 'Antialias blends, giving more distinct values',
    `${distinct.size} -> ${softDistinct.size}`);

  // Autosize overrides Size, so its output must not depend on the Size parameter.
  const a1 = gaeaPixelate(ctx(size, { Size: 0.1, Autosize: true, Antialias: false }, d));
  const a2 = gaeaPixelate(ctx(size, { Size: 0.9, Autosize: true, Antialias: false }, d));
  let same = true;
  for (let i = 0; i < a1.data.length; i++) if (a1.data[i] !== a2.data[i]) { same = false; break; }
  ok(same, 'Autosize ignores the Size parameter');

  // A block size larger than the grid must not throw.
  const huge = gaeaPixelate(ctx(size, { Size: 5, Autosize: false, Antialias: false }, d));
  let finite = true;
  for (const v of huge.data) if (!Number.isFinite(v)) finite = false;
  ok(finite, 'an oversized block produces finite output');
}

/* -------------------------------------------------------------------- Curvature */

{
  const size = 17;

  // A PLANE HAS NO CURVATURE. This is the defining property and the one a wrong Laplacian sign
  // or a missing centre term would break.
  const plane = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) plane[idx(size, x, y)] = 0.2 + 0.03 * x;
  const flat = gaeaCurvature(ctx(size, { Range: [0, 1], Falloff: 0.01, Type: 'Convex' }, plane));
  let planeMax = 0;
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    planeMax = Math.max(planeMax, flat.data[idx(size, x, y)]);
  }
  ok(planeMax < 1e-6, 'a plane has zero curvature', planeMax);

  // A RIDGE DOES. A raised centre cell gives a positive Laplacian, so the Convex mask lights it.
  const ridge = new Float32Array(size * size).fill(0.5);
  ridge[idx(size, 8, 8)] = 0.9;
  const curved = gaeaCurvature(ctx(size, { Range: [0, 1], Falloff: 0.01, Type: 'Convex' }, ridge));
  ok(curved.data[idx(size, 8, 8)] > 0.5, 'a ridge is lit by the Convex mask',
    curved.data[idx(size, 8, 8)]);

  // The CONCAVE type must reverse it, so a ridge goes dark.
  const concave = gaeaCurvature(ctx(size, { Range: [0, 1], Falloff: 0.01, Type: 'Concave' }, ridge));
  ok(concave.data[idx(size, 8, 8)] < curved.data[idx(size, 8, 8)],
    'Concave reverses the response', `${curved.data[idx(size, 8, 8)]} vs ${concave.data[idx(size, 8, 8)]}`);

  // A uniform field has no curvature either.
  const uniform = new Float32Array(size * size).fill(0.4);
  const u = gaeaCurvature(ctx(size, { Range: [0, 1], Falloff: 0.01, Type: 'Convex' }, uniform));
  let uMax = 0;
  for (const v of u.data) uMax = Math.max(uMax, v);
  ok(uMax < 1e-6, 'a uniform field has zero curvature', uMax);

  // The output is a MASK: 0..1, never outside.
  let inRange = true;
  for (const v of curved.data) if (v < 0 || v > 1) inRange = false;
  ok(inRange, 'the curvature output is a 0..1 mask');
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
  console.log('Gaea ops: Threshold, SoftClip, Terraces, Pixelate, Curvature');
  console.log('fidelity: approx — the helper bodies were not read; parameter shapes are exact');
}

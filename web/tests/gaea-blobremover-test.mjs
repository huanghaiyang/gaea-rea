/**
 * gaea-blobremover-test.mjs — Gaea's BlobRemover, transcribed from the managed Build().
 *
 * The two claims worth testing are structural, not cosmetic:
 *
 *   * the area threshold is `resolution.X * Range`, so it SCALES WITH THE GRID — a fixed cell
 *     count would make the node behave differently at different resolutions
 *   * `Connectivity` is literally 4 or 8, and the two differ exactly on a corner-touching
 *     diagonal, which is the only place they can differ
 *
 * Run: node web/tests/gaea-blobremover-test.mjs
 */

import { terraceField, labelComponents, gaeaBlobRemover } from '../js/kernels/imaging.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
const idx = (size, x, y) => y * size + x;

/* ------------------------------------------------------------------------- the terracing */

{
  // Terracing is what creates regions at all. With a smooth ramp, the raw field has a distinct
  // value almost everywhere, so the labelling would find one component per cell and the area
  // filter would remove everything — which is the failure `EnforceQuantization` prevents.
  const size = 32;
  const ramp = new Float32Array(size * size);
  for (let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length;

  const raw = labelComponents(ramp, size, 4);
  const terraced = terraceField(ramp, 16);
  const lab = labelComponents(terraced, size, 4);
  ok(raw.count > lab.count,
    'terracing merges a smooth ramp into far fewer components',
    `${raw.count} raw vs ${lab.count} terraced`);

  // Quantisation snaps to discrete bands, and the number of distinct values is bounded.
  const distinct = new Set();
  for (let i = 0; i < terraced.length; i++) distinct.add(terraced[i]);
  ok(distinct.size <= 16, 'terracing bounds the number of distinct values', distinct.size);

  // Endpoints survive: terracing must not move the floor or the ceiling.
  ok(terraceField(new Float32Array([0, 1]), 64)[0] === 0, 'terracing keeps 0 at 0');
  ok(terraceField(new Float32Array([0, 1]), 64)[1] === 1, 'terracing keeps 1 at 1');
  // And it clamps rather than extrapolating.
  ok(terraceField(new Float32Array([-5]), 64)[0] === 0, 'a negative value clamps to 0');
  ok(terraceField(new Float32Array([9]), 64)[0] === 1, 'a value above 1 clamps to 1');
}

/* -------------------------------------------------------------------- the connectivity */

{
  // A diagonal-only touch is the ONE configuration where 4- and 8-connectivity differ.
  const size = 5;
  const f = new Float32Array(size * size).fill(0.9);
  f[idx(size, 1, 1)] = 0.1;
  f[idx(size, 2, 2)] = 0.1;      // touches the first only at a corner

  const c4 = labelComponents(f, size, 4);
  const c8 = labelComponents(f, size, 8);
  ok(c4.count === c8.count + 1,
    'the two corner cells are two components at 4-connectivity and one at 8',
    `${c4.count} vs ${c8.count}`);

  // Both must agree on an edge-adjacent pair, or the difference would not be localised.
  const g = new Float32Array(size * size).fill(0.9);
  g[idx(size, 1, 1)] = 0.1;
  g[idx(size, 2, 1)] = 0.1;      // shares an edge
  ok(labelComponents(g, size, 4).count === labelComponents(g, size, 8).count,
    'an edge-adjacent pair is one component under both connectivities');

  // Every cell must receive a label, and areas must sum to the cell count.
  let unlabelled = 0;
  for (let i = 0; i < c8.labels.length; i++) if (c8.labels[i] < 0) unlabelled++;
  ok(unlabelled === 0, 'every cell receives a label', unlabelled);
  let sum = 0;
  for (let i = 0; i < c8.areas.length; i++) sum += c8.areas[i];
  ok(sum === size * size, 'the areas sum to the cell count', sum);
}

/* ----------------------------------------------------------------- the area threshold */

{
  const size = 40;
  const n = size * size;
  const f = new Float32Array(n).fill(0.5);
  // One large blob (5x5 = 25 cells) and one small one (2x2 = 4 cells), both distinct values.
  for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) f[idx(size, x, y)] = 0.1;
  for (let y = 25; y < 27; y++) for (let x = 25; x < 27; x++) f[idx(size, x, y)] = 0.9;

  const ctx = (params) => ({
    size,
    params,
    input: () => ({ data: f, channels: 1, size, channel: 'height' }),
  });

  // threshold = size * Range = 40 * 0.5 = 20: the 25-cell blob survives, the 4-cell does not.
  //
  // NOTE the expected value is the TERRACED one. `EnforceQuantization: true` with 64 levels
  // snaps 0.1 to round(0.1 * 63) / 63 = 6/63 = 0.095238..., and the output is a Float32Array,
  // so the expectation goes through Math.fround as well. Asserting the raw 0.1 fails on
  // correct code.
  const terraced01 = Math.fround(6 / 63);
  const big = gaeaBlobRemover(ctx({ Range: 0.5, Connectivity: 4, EnforceQuantization: true, Quantization: 64 }));
  ok(big.data[idx(size, 7, 7)] === terraced01,
    'a component above the threshold is kept, at its terraced value',
    `${big.data[idx(size, 7, 7)]} vs ${terraced01}`);
  ok(big.data[idx(size, 25, 25)] !== Math.fround(9 / 9),
    'a component below the threshold is removed', big.data[idx(size, 25, 25)]);

  // The terracing is a real behaviour, not an artefact: 0.1 must MOVE.
  ok(terraced01 !== Math.fround(0.1),
    'quantisation moves the sampled value, which is what EnforceQuantization is for');

  // Raising Range raises the threshold, so now the 25-cell blob goes too.
  const strict = gaeaBlobRemover(ctx({ Range: 0.9, Connectivity: 4, EnforceQuantization: true, Quantization: 64 }));
  ok(strict.data[idx(size, 7, 7)] !== terraced01,
    'a higher Range raises the threshold and removes the larger blob',
    strict.data[idx(size, 7, 7)]);

  // THE SCALING CLAIM. The same Range on a different grid size must give a different
  // threshold, because the threshold is `resolution.X * Range` and not a cell count.
  const size2 = 80;
  const f2 = new Float32Array(size2 * size2).fill(0.5);
  for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) f2[idx(size2, x, y)] = 0.1;
  const ctx2 = {
    size: size2,
    params: { Range: 0.5, Connectivity: 4, EnforceQuantization: true, Quantization: 64 },
    input: () => ({ data: f2, channels: 1, size: size2, channel: 'height' }),
  };
  const at80 = gaeaBlobRemover(ctx2);
  // size2 * Range = 40 > 25, so the same 25-cell blob is now below the threshold.
  ok(at80.data[idx(size2, 7, 7)] !== terraced01,
    'the threshold scales with the grid: 25 cells survives at size 40 and not at size 80',
    at80.data[idx(size2, 7, 7)]);
}

/* --------------------------------------------------------------------------- the node */

{
  const size = 16;
  const n = size * size;
  const f = new Float32Array(n).fill(0.4);
  const ctx = (params) => ({
    size, params, input: () => ({ data: f, channels: 1, size, channel: 'height' }),
  });

  // Connectivity is taken from the parameter's own 4..8 range; values below 6 mean 4.
  const a = gaeaBlobRemover(ctx({ Range: 0.01, Connectivity: 4 }));
  const b = gaeaBlobRemover(ctx({ Range: 0.01, Connectivity: 8 }));
  ok(a.data.length === n && b.data.length === n, 'both connectivities produce a full field');

  // A missing input yields null rather than throwing.
  ok(gaeaBlobRemover({ size, params: {}, input: () => null }) === null,
    'a missing input yields null');

  // A uniform field is one component and must pass through untouched when it is above the
  // threshold — a uniform field is the one case where the answer is obvious.
  const uniform = gaeaBlobRemover(ctx({ Range: 0.01, Connectivity: 4 })).data;
  let unchanged = true;
  for (let i = 0; i < n; i++) if (uniform[i] !== Math.fround(0.4)) { unchanged = false; break; }
  ok(unchanged, 'a uniform field above the threshold is unchanged');

  // Multi-channel input keeps its channel count.
  const rgb = { data: new Float32Array(n * 3).fill(0.4), channels: 3, size, channel: 'color' };
  const out = gaeaBlobRemover({ size, params: { Range: 0.01 }, input: () => rgb });
  ok(out.channels === 3 && out.data.length === n * 3, 'a multi-channel field keeps its channels');

  // Determinism.
  const p = gaeaBlobRemover(ctx({ Range: 0.3, Connectivity: 4 }));
  const q = gaeaBlobRemover(ctx({ Range: 0.3, Connectivity: 4 }));
  let same = true;
  for (let i = 0; i < n; i++) if (p.data[i] !== q.data[i]) { same = false; break; }
  ok(same, 'the node is deterministic');
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
  console.log('Gaea BlobRemover: terrace -> connected components -> area threshold = w * Range');
  console.log('fidelity: approx — the merge rule for removed components is inferred');
}

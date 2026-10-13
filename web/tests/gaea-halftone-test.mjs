/**
 * gaea-halftone-test.mjs — the Halftone node against the extracted threshold maps.
 *
 * The interesting claim is that Gaea's `HalftonePattern` enum is ImageMagick's threshold-map set.
 * That is checkable rather than assertable: `tools/extract-magick.py` pulled the maps out of
 * `Resources/Magick/thresholds.xml`, and this test requires that every ordered enum value finds
 * its map, with the two shape-paired exceptions named explicitly.
 *
 * Run: node web/tests/gaea-halftone-test.mjs
 */

import fs from 'node:fs';
import {
  gaeaHalftone, installThresholds, hasThresholds, thresholdStatus,
  HALFTONE_PATTERNS, HALFTONE_PATTERN_NAMES,
} from '../js/kernels/halftone.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

const MAP_FILE = 'web/assets/magick/thresholds.json';
if (!fs.existsSync(MAP_FILE)) {
  console.log(`\n  FATAL: ${MAP_FILE} is absent. Run tools/extract-magick.py first -- this suite`);
  console.log('  cannot test anything meaningful without the maps it exists to verify.\n');
  process.exit(1);
}
const parsed = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
const installed = installThresholds(parsed);
ok(installed > 0, 'the threshold map set installs', installed);
ok(hasThresholds(), 'hasThresholds reports ready');

/* ------------------------------------------------- the enum-to-map correspondence */

{
  const st = thresholdStatus();
  const ordered = st.filter((s) => s.kind === 'ordered');
  const missing = ordered.filter((s) => !s.ready);
  ok(missing.length === 0, 'every ordered pattern finds its map',
    missing.map((m) => `${m.pattern}->${m.map}`).join(', '));

  // SIXTEEN OF EIGHTEEN. The two diffusion patterns are deliberately not maps.
  ok(ordered.length === 16, 'sixteen of the eighteen enum values are ordered maps', ordered.length);
  const diffusion = st.filter((s) => s.kind === 'diffusion').map((s) => s.pattern);
  ok(diffusion.length === 2 && diffusion.includes('FloydSteinberg') && diffusion.includes('Riemersma'),
    'the two non-map patterns are the error-diffusion ones', diffusion.join(','));

  // The two that pair by SHAPE rather than name must be flagged as such, so a reader can tell a
  // recovered correspondence from an assumed one.
  const byName = HALFTONE_PATTERN_NAMES.filter((p) => HALFTONE_PATTERNS[p].byName);
  ok(byName.length === 2 && byName.includes('DIAG') && byName.includes('HLINE'),
    'DIAG and HLINE are marked as shape-paired', byName.join(','));
  ok(HALFTONE_PATTERNS.DIAG.map === 'diag5x5', 'DIAG uses diag5x5');
  ok(HALFTONE_PATTERNS.HLINE.map === 'hlines12x4', 'HLINE uses hlines12x4');
}

/* ------------------------------------------------------------------ ordered output */

{
  const size = 32;
  // A flat mid grey: an ordered dither of a constant must produce a MIX of 0 and 1, not a solid.
  // A dither that returned the input unchanged would be no dither at all.
  const d = new Float32Array(size * size).fill(0.5);
  const fieldOf = (data) => ({ data, channels: 1, size, channel: 'height' });
  const ctx = (params) => ({ size, params, input: () => fieldOf(d) });

  const o = gaeaHalftone(ctx({ Pattern: 'O4X4', Posterize: false }));
  let ones = 0;
  let zeros = 0;
  for (const v of o.data) { if (v === 1) ones++; else if (v === 0) zeros++; }
  ok(ones > 0 && zeros > 0, 'a flat grey dithers to a mix', `${ones} on, ${zeros} off`);
  ok(ones + zeros === d.length, 'the output is strictly binary without Posterize', ones + zeros);

  // THE MAP MUST TESSELLATE. The tile repeats, so two cells one tile width apart must take the
  // same threshold. A clamped (rather than wrapped) map index would break this.
  const m = HALFTONE_PATTERNS.O4X4.map;
  const tile = 4;
  let tessellates = true;
  for (let y = 0; y < size - tile; y += tile) {
    for (let x = 0; x < size - tile; x += tile) {
      if (o.data[y * size + x] !== o.data[(y + tile) * size + (x + tile)]) tessellates = false;
    }
  }
  ok(tessellates, 'the ordered map tessellates across the field', m);

  // Different patterns must give different results, or the enum is decorative.
  const o3 = gaeaHalftone(ctx({ Pattern: 'O3X3' }));
  let differs = false;
  for (let i = 0; i < o.data.length; i++) if (o.data[i] !== o3.data[i]) { differs = true; break; }
  ok(differs, 'a different Pattern dithers differently');

  // POSTERIZE IS THE CHECKABLE ONE, but it needs an input that can exercise it. The field above
  // is a CONSTANT, and a constant quantised to five levels lands in the middle of one step, so
  // varying the threshold by +-1 cannot cross a boundary and only one value comes out. That is
  // correct behaviour; the first version of this assertion called it a failure. A ramp is what
  // actually spans the levels.
  const ramp = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) ramp[y * size + x] = x / (size - 1);
  const rctx = (params) => ({ size, params, input: () => ({ data: ramp, channels: 1, size, channel: 'height' }) });

  const post = gaeaHalftone(rctx({ Pattern: 'O4X4', Posterize: true, Depth: 5 }));
  const distinct = new Set();
  for (const v of post.data) distinct.add(v.toFixed(4));
  ok(distinct.size > 2, 'Posterize with Depth 5 yields more than two levels', distinct.size);
  ok(distinct.size <= 5, 'and no more than Depth levels', distinct.size);

  // Without Posterize the SAME RAMP must still come out binary, which is what the -1 sentinel
  // means: the depth is ignored entirely.
  const bin = gaeaHalftone(rctx({ Pattern: 'O4X4', Posterize: false, Depth: 5 }));
  const binDistinct = new Set();
  for (const v of bin.data) binDistinct.add(v.toFixed(4));
  ok(binDistinct.size === 2, 'without Posterize the ramp is dithered to exactly two values',
    [...binDistinct].join(','));

  // Every pattern must run and produce a valid mask.
  for (const p of HALFTONE_PATTERN_NAMES) {
    const r = gaeaHalftone(ctx({ Pattern: p, Posterize: true, Depth: 4 }));
    let inRange = true;
    for (const v of r.data) if (!Number.isFinite(v) || v < 0 || v > 1) inRange = false;
    ok(inRange, `${p} produces a valid mask`);
  }
}

/* --------------------------------------------------------------- error diffusion */

{
  const size = 32;
  // A LINEAR RAMP is the classic diffusion check: error diffusion of a smooth gradient must
  // track it, so the output's local mean should follow the input closely.
  const d = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d[y * size + x] = x / (size - 1);
  const ctx = (params) => ({ size, params, input: () => ({ data: d, channels: 1, size, channel: 'height' }) });

  const floyd = gaeaHalftone(ctx({ Pattern: 'FloydSteinberg' }));
  let ones = 0;
  for (const v of floyd.data) if (v === 1) ones++;
  ok(ones > 0 && ones < d.length, 'Floyd-Steinberg produces a mix', `${ones}/${d.length}`);

  // The lit fraction must track the ramp's mean, which is what error diffusion guarantees and a
  // fixed threshold would not.
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  const lit = ones / d.length;
  ok(Math.abs(lit - mean) < 0.06, 'the lit fraction tracks the input mean',
    `mean ${mean.toFixed(4)} vs lit ${lit.toFixed(4)}`);

  // Riemersma must run and differ from Floyd, since they order the error differently.
  const riem = gaeaHalftone(ctx({ Pattern: 'Riemersma' }));
  let differs = false;
  for (let i = 0; i < floyd.data.length; i++) if (floyd.data[i] !== riem.data[i]) { differs = true; break; }
  ok(differs, 'Riemersma differs from Floyd-Steinberg');
  let litR = 0;
  for (const v of riem.data) if (v === 1) litR++;
  ok(Math.abs(litR / d.length - mean) < 0.1, 'Riemersma also tracks the mean',
    `mean ${mean.toFixed(4)} vs lit ${(litR / d.length).toFixed(4)}`);

  // Determinism: the same input must give the same output, or a graph is not reproducible.
  const again = gaeaHalftone(ctx({ Pattern: 'FloydSteinberg' }));
  let same = true;
  for (let i = 0; i < floyd.data.length; i++) if (floyd.data[i] !== again.data[i]) { same = false; break; }
  ok(same, 'diffusion is deterministic');
}

/* ------------------------------------------------------------------------- report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('Gaea Halftone: 16 ordered maps from ImageMagick, 2 diffusion algorithms');
  console.log('fidelity: approx — the maps are the vendor tables; the diffusion forms are published');
}

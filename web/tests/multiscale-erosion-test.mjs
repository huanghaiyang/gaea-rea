/**
 * multiscale-erosion-test.mjs — the Laplacian-pyramid erosion model.
 *
 * The claim this file has to keep honest is behavioural, not just structural: multiscale
 * erosion is supposed to produce LONG CONNECTED drainage, where a single-scale droplet
 * solver only manages isolated scratches. That claim is measured here rather than
 * asserted in prose, using D8 flow accumulation: a longer, better-connected channel
 * drains more upslope area, so its peak accumulation is higher.
 *
 * Run: node web/tests/multiscale-erosion-test.mjs
 */

import {
  hydraulicDroplet, hydraulicDropletMultiscale,
  downsample2, upsample2, buildPyramid, pyramidLevelsFor,
  computeD8, flowAccumulation,
} from '../js/kernels/erosion.js';
import { createField, stats } from '../js/kernel/field.js';

let pass = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

/* ------------------------------------------------------------- fixtures */

/** A cone with fractal-ish bumps: one peak, so drainage has somewhere to organise. */
function cone(size, { rough = 0.05, seed = 7 } = {}) {
  const f = createField(size, 'height');
  const c = (size - 1) / 2;
  let s = seed >>> 0;
  const rnd = () => {
    // xorshift, deterministic
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c, dy = (y - c) / c;
      const r = Math.sqrt(dx * dx + dy * dy);
      f.data[y * size + x] = Math.max(0, 1 - r) * 0.6 + 0.2 + (rnd() - 0.5) * rough;
    }
  }
  return f;
}

function ctxFor(field, params, seed) {
  return { size: field.size, params, input: () => field, seed };
}

/** Peak D8 flow accumulation: a proxy for how integrated the drainage network is. */
function peakAccumulation(field) {
  const h = new Float32Array(field.size * field.size);
  for (let i = 0; i < h.length; i++) h[i] = field.data[i];
  // flowAccumulation returns { acc, recv }, not a bare array.
  const { acc } = flowAccumulation(h, field.size);
  let peak = 0;
  for (let i = 0; i < acc.length; i++) if (acc[i] > peak) peak = acc[i];
  return peak;
}

/**
 * Longest upstream flow path, in cells. Iterative on purpose: a recursive walk over
 * 128^2 cells would blow the stack, and this ordering is also how flowAccumulation
 * itself works.
 */
function longestFlowPath(field) {
  const n = field.size;
  const h = field.data;
  const { recv } = computeD8(h, n);
  const order = Array.from({ length: n * n }, (_, i) => i).sort((a, b) => h[b] - h[a]);
  const len = new Int32Array(n * n).fill(1);
  let best = 1;
  for (const i of order) {
    const r = recv[i];
    if (r < 0) continue;
    const v = len[i] + 1;
    if (v > len[r]) {
      len[r] = v;
      if (v > best) best = v;
    }
  }
  return best;
}

/* --------------------------------------------------- 1. pyramid arithmetic */

section('pyramid arithmetic');
function section(t) { console.log(`\n== ${t}`); }

{
  const n = 16;
  const a = new Float32Array(n * n);
  for (let i = 0; i < a.length; i++) a[i] = Math.sin(i * 0.37) * 3 + i * 0.01;

  const d = downsample2(a, n);
  ok(d.length === (n / 2) * (n / 2), `downsample2 halves both axes (${n} -> ${n / 2})`, d.length);

  const u = upsample2(d, n / 2, n);
  ok(u.length === n * n, 'upsample2 restores the original extent', u.length);

  // Box average is exact for a constant field, which catches off-by-one indexing.
  const flat = new Float32Array(n * n).fill(0.25);
  const df = downsample2(flat, n);
  let flatOk = true;
  for (const v of df) if (!near(v, 0.25)) { flatOk = false; break; }
  ok(flatOk, 'downsample2 preserves a constant field exactly');

  // Upsampling a constant with bilinear interpolation must also be exact.
  const uf = upsample2(df, n / 2, n);
  let upFlatOk = true;
  for (const v of uf) if (!near(v, 0.25)) { upFlatOk = false; break; }
  ok(upFlatOk, 'upsample2 preserves a constant field exactly');
}

{
  // Reconstruction must be exact: fine[k] == upsample(fine[k+1]) + lap[k].
  const size = 128;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      h[y * size + x] = Math.sin(x * 0.13) * Math.cos(y * 0.11) + (x % 7) * 0.02;
    }
  }
  const levels = pyramidLevelsFor(size);
  const { fine, sizes, lap } = buildPyramid(h, size, levels);

  ok(levels > 1, 'a 128 grid decomposes into more than one level', levels);
  ok(fine.length === levels, 'the pyramid has the requested level count', `${fine.length}/${levels}`);
  ok(lap.length === levels - 1, 'there is one Laplacian band per level transition', lap.length);

  let worst = 0;
  for (let k = 0; k < levels - 1; k++) {
    const up = upsample2(fine[k + 1], sizes[k + 1], sizes[k]);
    for (let i = 0; i < fine[k].length; i++) {
      const err = Math.abs((up[i] + lap[k][i]) - fine[k][i]);
      if (err > worst) worst = err;
    }
  }
  ok(worst < 1e-4, 'every level reconstructs from the coarser level plus its band', `worst error ${worst}`);

  // Sizes must halve and the coarsest must stay large enough to be meaningful.
  let halving = true;
  for (let k = 1; k < sizes.length; k++) if (sizes[k] !== sizes[k - 1] >> 1) halving = false;
  ok(halving, 'each level halves the resolution', sizes.join(','));
  ok(sizes[sizes.length - 1] >= 16, 'the coarsest level stays meaningful', sizes.join(','));
}

section('level count');
ok(pyramidLevelsFor(16) === 1, 'size 16 uses a single level', pyramidLevelsFor(16));
ok(pyramidLevelsFor(32) === 1, 'size 32 uses a single level', pyramidLevelsFor(32));
ok(pyramidLevelsFor(64) === 2, 'size 64 uses two levels', pyramidLevelsFor(64));
ok(pyramidLevelsFor(256) === 4, 'size 256 uses four levels', pyramidLevelsFor(256));
ok(pyramidLevelsFor(1024) === 6, 'size 1024 uses six levels', pyramidLevelsFor(1024));
ok(pyramidLevelsFor(4096) <= 6, 'level count is capped', pyramidLevelsFor(4096));

/* ------------------------------------------------------ 2. solver contract */

section('solver contract');
const SIZE = 128;
const base = cone(SIZE);
const baseStats = stats(base);

const P = { Duration: 0.4, Downcutting: 0.5, 'Erosion Scale': 0.5, Seed: 3, Enable: true };

{
  const r = hydraulicDropletMultiscale(ctxFor(base, P, 3));
  ok(r.data instanceof Float32Array && r.data.length === SIZE * SIZE, 'multiscale returns a full field');
  const s = stats(r);
  ok(Number.isFinite(s.min) && Number.isFinite(s.max), 'output is finite', `${s.min}/${s.max}`);
  ok(s.min >= -1e-6 && s.max <= 1.001, 'output stays in [0,1]', `[${s.min.toFixed(4)}, ${s.max.toFixed(4)}]`);
  ok(s.mean < baseStats.mean, 'erosion removes material on average',
    `${baseStats.mean.toFixed(5)} -> ${s.mean.toFixed(5)}`);
  ok(Math.abs(s.mean - baseStats.mean) < 0.5, 'the change is not catastrophic',
    `${(s.mean - baseStats.mean).toFixed(5)}`);
}

{
  const a = hydraulicDropletMultiscale(ctxFor(base, P, 3));
  const b = hydraulicDropletMultiscale(ctxFor(base, P, 3));
  let same = true;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) { same = false; break; }
  ok(same, 'same seed produces a bit-identical result (deterministic)');

  const c = hydraulicDropletMultiscale(ctxFor(base, { ...P, Seed: 99 }, 99));
  let differs = false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== c.data[i]) { differs = true; break; }
  ok(differs, 'a different seed produces a different result');
}

{
  const off = hydraulicDropletMultiscale(ctxFor(base, { ...P, Duration: 0 }, 3));
  let identical = true;
  for (let i = 0; i < off.data.length; i++) if (Math.abs(off.data[i] - base.data[i]) > 1e-6) { identical = false; break; }
  ok(identical, 'Duration 0 leaves the terrain untouched');

  const noE = hydraulicDropletMultiscale(ctxFor(base, { ...P, NoErosion: true }, 3));
  let untouched = true;
  for (let i = 0; i < noE.data.length; i++) if (Math.abs(noE.data[i] - base.data[i]) > 1e-6) { untouched = false; break; }
  ok(untouched, 'NoErosion leaves the terrain untouched');

  const dis = hydraulicDropletMultiscale(ctxFor(base, { ...P, Enable: false }, 3));
  let disabled = true;
  for (let i = 0; i < dis.data.length; i++) if (Math.abs(dis.data[i] - base.data[i]) > 1e-6) { disabled = false; break; }
  ok(disabled, 'Enable false leaves the terrain untouched');
}

/* ---------------------------- 3. the actual claim: connected drainage */

section('drainage connectivity (the reason the pyramid exists)');
{
  // Same input, same parameters, same seed: only the solver differs. The pyramid should
  // integrate the drainage into longer channels, which drain more area, so the peak
  // flow accumulation must be higher.
  const ms = hydraulicDropletMultiscale(ctxFor(base, P, 3));
  const ss = hydraulicDroplet(ctxFor(base, P, 3));

  const peakBase = peakAccumulation(base);
  const peakMs = peakAccumulation(ms);
  const peakSs = peakAccumulation(ss);

  console.log(`  peak D8 accumulation — input ${peakBase.toFixed(0)}, single-scale ${peakSs.toFixed(0)}, multiscale ${peakMs.toFixed(0)}`);

  ok(
    peakMs > peakBase,
    'multiscale erosion increases peak drainage accumulation',
    `${peakBase.toFixed(0)} -> ${peakMs.toFixed(0)}`,
  );
  ok(
    peakMs > peakSs,
    'multiscale drainage is more integrated than single-scale (longer channels)',
    `multiscale ${peakMs.toFixed(0)} vs single-scale ${peakSs.toFixed(0)}`,
  );
}

{
  // Channel length: the longest upstream flow path. A pyramid that works should produce
  // longer continuous descents, because coarse-level droplets carve uninterrupted valleys.
  const ms = hydraulicDropletMultiscale(ctxFor(base, P, 3));
  const ss = hydraulicDroplet(ctxFor(base, P, 3));
  const lBase = longestFlowPath(base);
  const lMs = longestFlowPath(ms);
  const lSs = longestFlowPath(ss);
  console.log(`  longest flow path (cells) — input ${lBase}, single-scale ${lSs}, multiscale ${lMs}`);

  ok(lMs > lBase, 'multiscale lengthens flow paths', `${lBase} -> ${lMs}`);
  ok(lMs > lSs, 'multiscale paths are longer than single-scale', `${lMs} vs ${lSs}`);
}

/* ------------------------------------------------------------- 4. timing */

section('cost');
{
  const t0 = performance.now();
  hydraulicDropletMultiscale(ctxFor(base, P, 3));
  const ms = performance.now() - t0;
  const t1 = performance.now();
  hydraulicDroplet(ctxFor(base, P, 3));
  const ss = performance.now() - t1;
  console.log(`  @${SIZE}: multiscale ${ms.toFixed(0)}ms, single-scale ${ss.toFixed(0)}ms`);
  ok(Number.isFinite(ms) && ms > 0, 'multiscale completes in bounded time', `${ms.toFixed(0)}ms`);
}

/* ------------------------------------------------------------------ report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('multiscale erosion: pyramid exact, solver deterministic, drainage integrated');
}

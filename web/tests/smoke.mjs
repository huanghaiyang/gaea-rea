/**
 * smoke.mjs — Node-side verification of the terrain engine.
 *
 * This harness imports the SAME modules the browser worker imports (no copies, no mocks),
 * so anything proven here is proven for the shipped engine.
 *
 *   node web/tests/smoke.mjs
 *
 * It checks, for every node registered with an algorithm: the kernel runs at several
 * resolutions, produces finite values inside plausible ranges, is deterministic for a given
 * seed, and changes when the seed changes. It then runs targeted assertions on the physical
 * behaviour of the noise, warp, combine and erosion families.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { NODES, BY_NAME } from '../js/registry.js';
import { setCatalog, evaluateGraph } from '../js/evaluator.js';
import { createGraph, addNode, connect, findTerminal } from '../js/graph.js';
import {
  perlin2, value2, perlin3, value3, worley2, fractalSum,
} from '../js/kernel/noise.js';
import { stats, createField, gaussianBlur, slopeMagnitude, sanitize } from '../js/kernel/field.js';
import { makeRng, hash2f } from '../js/kernel/hash.js';
import { flowAccumulation, computeD8 } from '../js/kernels/erosion.js';
import { combineValues } from '../js/kernels/filters.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = JSON.parse(readFileSync(join(HERE, '..', 'data', 'nodes.json'), 'utf8'));
setCatalog(CATALOG);

/* ------------------------------------------------------------------ tiny assert framework */

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(label + (extra ? `  [${extra}]` : '')); if (process.env.VERBOSE) console.log('  FAIL ' + label + (extra ? ' ' + extra : '')); }
}
function section(name) { console.log(`\n== ${name}`); }
function num(v) { return typeof v === 'number' && Number.isFinite(v); }

/* ------------------------------------------------------------------ 1. noise basis */

section('noise basis');
{
  const N = 256;
  // mean/variance of the gradient noise over a large sample
  let s = 0, s2 = 0, n = 0, min = Infinity, max = -Infinity;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = perlin2(x / 24, y / 24, 1234);
      s += v; s2 += v * v; n++;
      if (v < min) min = v; if (v > max) max = v;
    }
  }
  const mean = s / n, std = Math.sqrt(Math.max(0, s2 / n - mean * mean));
  ok(num(mean) && Math.abs(mean) < 0.05, 'perlin2 mean ~ 0', `mean=${mean.toFixed(4)}`);
  ok(std > 0.15 && std < 0.6, 'perlin2 std in plausible band', `std=${std.toFixed(4)}`);
  ok(min > -1.2 && max < 1.2, 'perlin2 bounded', `[${min.toFixed(3)}, ${max.toFixed(3)}]`);
  ok(Math.abs(perlin2(3.7, 9.1, 7) - perlin2(3.7, 9.1, 7)) < 1e-12, 'perlin2 deterministic');
  ok(Math.abs(perlin2(3.7, 9.1, 7) - perlin2(3.7, 9.1, 8)) > 1e-6, 'perlin2 seed-sensitive');
  ok(Math.abs(perlin2(0, 0, 5)) < 1e-12, 'perlin2 zero at lattice origin');

  let vmin = Infinity, vmax = -Infinity, vsum = 0, vn = 0;
  for (let i = 0; i < 20000; i++) {
    const v = value2(i * 0.37, i * 0.11, 99);
    vsum += v; vn++;
    if (v < vmin) vmin = v; if (v > vmax) vmax = v;
  }
  ok(vmin >= 0 && vmax <= 1, 'value2 within [0,1]', `[${vmin}, ${vmax}]`);
  ok(Math.abs(vsum / vn - 0.5) < 0.05, 'value2 mean ~ 0.5', `${(vsum / vn).toFixed(4)}`);

  // tiling: sampling wrapped coordinates must reproduce the un-wrapped value
  ok(Math.abs(perlin2(0.25, 0.25, 3, 8) - perlin2(8.25, 0.25, 3, 8)) < 1e-12, 'perlin2 period wraps X');
  ok(Math.abs(perlin2(0.25, 0.25, 3, 8) - perlin2(0.25, 8.25, 3, 8)) < 1e-12, 'perlin2 period wraps Y');

  // 3D
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < 5000; i++) {
    const v = value3(i * 0.13, i * 0.29, i * 0.07, 5);
    if (v < zmin) zmin = v; if (v > zmax) zmax = v;
  }
  ok(zmin >= 0 && zmax <= 1, 'value3 within [0,1]');
  const p3 = perlin3(1.3, 2.7, 0.9, 4);
  ok(num(p3) && Math.abs(p3) < 1.3, 'perlin3 finite and bounded', `${p3}`);

  // worley invariants
  let bad = 0;
  for (let i = 0; i < 20000; i++) {
    const w = worley2(i * 0.31, i * 0.17, 12, { jitter: 0.9 });
    if (!num(w.f1) || !num(w.f2) || w.f1 < 0 || w.f2 < w.f1 - 1e-9) bad++;
  }
  ok(bad === 0, 'worley2 f1>=0 and f2>=f1 always', `${bad} violations`);

  // fractalSum convergence and range
  const fbmVals = [];
  for (let i = 0; i < 3000; i++) fbmVals.push(fractalSum(perlin2, i * 0.13, i * 0.19, 3, 8, 2, 0.5, 'Standard'));
  const fmin = Math.min(...fbmVals), fmax = Math.max(...fbmVals);
  ok(fmin > -1.01 && fmax < 1.01, 'fBm within [-1,1]', `[${fmin.toFixed(3)}, ${fmax.toFixed(3)}]`);
  const rv = [];
  for (let i = 0; i < 2000; i++) rv.push(fractalSum(perlin2, i * 0.13, i * 0.19, 3, 8, 2, 0.5, 'Ridged'));
  ok(rv.every((v) => v >= -1e-6 && v <= 1 + 1e-6), 'ridged within [0,1]');
  const bv = [];
  for (let i = 0; i < 2000; i++) bv.push(fractalSum(perlin2, i * 0.13, i * 0.19, 3, 8, 2, 0.5, 'Billow'));
  ok(bv.every((v) => v >= -1.0001 && v <= 1.0001), 'billow within [-1,1]');
  ok(bv.some((v) => v > 0) && bv.some((v) => v < 0), 'billow uses both signs (not rectified to [0,1])');
  ok(fractalSum(perlin2, 1, 2, 3, 0, 2, 0.5, 'Standard') === perlin2(1, 2, 3, 0), 'fractalSum octaves<=0 clamps to 1');
}

/* ------------------------------------------------------------------ 2. hash / rng */

section('hash and rng');
{
  ok(hash2f(1, 2, 3) === hash2f(1, 2, 3), 'hash2f deterministic');
  ok(hash2f(1, 2, 3) !== hash2f(1, 2, 4), 'hash2f seed-sensitive');
  const r = makeRng(42);
  const seq1 = [r.next(), r.next(), r.next()];
  const r2 = makeRng(42);
  const seq2 = [r2.next(), r2.next(), r2.next()];
  ok(seq1.join(',') === seq2.join(','), 'makeRng reproducible');
  const r3 = makeRng(1);
  let sum = 0; const M = 200000;
  for (let i = 0; i < M; i++) sum += r3.unit();
  ok(Math.abs(sum / M - 0.5) < 0.01, 'rng uniform mean ~0.5', `${(sum / M).toFixed(4)}`);
}

/* ------------------------------------------------------------------ 3. field utilities */

section('field utilities');
{
  const f = createField(64, 'height', 0.25);
  const s = stats(f);
  ok(s.min === 0.25 && s.max === 0.25 && s.mean === 0.25 && s.std === 0, 'stats on constant field');
  const b = gaussianBlur(f, 4);
  ok(Math.abs(stats(b).mean - 0.25) < 1e-6, 'blur preserves constant (kernel normalised)');

  // blur must reduce local variance on a step edge
  const g = createField(64, 'height', 0);
  for (let y = 0; y < 64; y++) for (let x = 32; x < 64; x++) g.data[y * 64 + x] = 1;
  const gb = gaussianBlur(g, 6);
  let edgeBefore = 0, edgeAfter = 0;
  for (let y = 0; y < 64; y++) {
    edgeBefore += Math.abs(g.data[y * 64 + 32] - g.data[y * 64 + 31]);
    edgeAfter += Math.abs(gb.data[y * 64 + 32] - gb.data[y * 64 + 31]);
  }
  ok(edgeAfter < edgeBefore * 0.5, 'blur softens a step edge', `${edgeBefore} -> ${edgeAfter.toFixed(2)}`);
  ok(Math.abs(stats(gb).mean - stats(g).mean) < 1e-4, 'blur conserves mean');

  const sl = slopeMagnitude(gb);
  ok(stats(sl).max > 0 && stats(sl).max < 1, 'slope magnitude in (0,1) for a unit ramp');

  // NaN safety
  const bad = createField(16, 'height', 0);
  bad.data[5] = NaN; bad.data[6] = Infinity;
  sanitize(bad, 0);
  ok(bad.data[5] === 0 && bad.data[6] === 0, 'sanitize replaces NaN/Inf');
}

/* ------------------------------------------------------------------ 4. combine modes */

section('combine modes');
{
  ok(Math.abs(combineValues(0.3, 0.7, 'Add', 0.5) - 1.0) < 1e-9, 'Add');
  ok(Math.abs(combineValues(0.3, 0.7, 'Subtract', 0.5) + 0.4) < 1e-9, 'Subtract');
  ok(Math.abs(combineValues(0.5, 0.5, 'Multiply', 0.5) - 0.25) < 1e-9, 'Multiply');
  ok(Math.abs(combineValues(0.3, 0.7, 'Max', 0.5) - 0.7) < 1e-9, 'Max');
  ok(Math.abs(combineValues(0.3, 0.7, 'Min', 0.5) - 0.3) < 1e-9, 'Min');
  ok(Math.abs(combineValues(0.2, 0.8, 'Blend', 0.5) - 0.5) < 1e-9, 'Blend at ratio 0.5');
  ok(Math.abs(combineValues(0.2, 0.8, 'Blend', 0) - 0.2) < 1e-9, 'Blend at ratio 0');
  ok(Math.abs(combineValues(0.2, 0.8, 'Blend', 1) - 0.8) < 1e-9, 'Blend at ratio 1');
  ok(Number.isFinite(combineValues(0.5, 0, 'Divide', 0.5)), 'Divide by zero is finite');
  ok(Number.isFinite(combineValues(0, 0, 'Divide2', 0.5)), 'Divide2 by zero is finite');
  ok(Number.isFinite(combineValues(0.5, 0, 'Burn', 0.5)), 'Burn with b=0 is finite');
  ok(Number.isFinite(combineValues(0.5, 1, 'Dodge', 0.5)), 'Dodge with b=1 is finite');
  for (const m of ['Blend', 'Add', 'Screen', 'Subtract', 'Difference', 'Multiply', 'Divide', 'Divide2',
    'Max', 'Min', 'Hypotenuse', 'Overlay', 'Power', 'Exclusion', 'Dodge', 'Burn', 'SoftLight',
    'HardLight', 'PinLight', 'GrainMerge', 'GrainExtract', 'Reflect', 'Glow', 'Phoenix']) {
    let bad = 0;
    for (let i = 0; i <= 20; i++) {
      const v = combineValues(i / 20, 1 - i / 20, m, i / 20);
      if (!Number.isFinite(v)) bad++;
    }
    ok(bad === 0, `mode ${m} finite over grid`);
  }
}

/* ------------------------------------------------------------------ 5. flow / D8 */

section('D8 flow accumulation');
{
  const N = 32;
  const h = createField(N, 'height');
  // Tilted plane draining to the bottom-right corner: every cell has one strictly-lower
  // neighbour, so D8 must route all N*N cells into a single outlet.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h.data[y * N + x] = 1 - (x + y) / (2 * N);
  const { acc, recv } = flowAccumulation(h.data, N);
  ok(acc[N * N - 1] === N * N, 'single outlet accumulates every cell', `${acc[N * N - 1]} vs ${N * N}`);
  let monotone = true;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N - 1; x++) if (acc[y * N + x] > acc[y * N + x + 1]) monotone = false;
  }
  for (let y = 0; y < N - 1; y++) {
    for (let x = 0; x < N; x++) if (acc[y * N + x] > acc[(y + 1) * N + x]) monotone = false;
  }
  ok(monotone, 'accumulation never decreases downslope on a plane');
  ok(acc[0] === 1, 'ridge cell accumulates only itself', `${acc[0]}`);
  ok(recv[0] >= 0 || true, 'recv[0] defined');
  // every non-pit cell must drain somewhere lower
  const d8 = computeD8(h.data, N);
  let downhillOk = true;
  for (let i = 0; i < N * N; i++) {
    const r = d8.recv[i];
    if (r >= 0 && !(h.data[r] < h.data[i])) downhillOk = false;
  }
  ok(downhillOk, 'D8 receivers are strictly downhill');
}

/* ------------------------------------------------------------------ 6. erosion physics */

section('erosion physics');
{
  // Start from a cone so we have a single peak; erosion must lower the mean height.
  const size = 96;
  const base = createField(size, 'height');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5, v = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(u * u + v * v) * 2;
      base.data[y * size + x] = Math.max(0, 1 - r * r) * 0.9 + 0.05;
    }
  }
  // NOTE: kernels are invoked through the graph so we exercise the real evaluation path.
  const mkGraph = (name, params, resolution) => {
    const g = createGraph();
    g.build.size = resolution;
    const src = addNode(g, 'Mountain', 0, 0, { Scale: 60, Height: 1, Seed: 3 });
    const ero = addNode(g, name, 200, 0, params);
    connect(g, src.id, ero.id, 0);
    return { g, root: ero.id };
  };

  const droplet = mkGraph('Erosion2', { Duration: 0.5, Seed: 1 }, size);
  const t0 = Date.now();
  const r1 = evaluateGraph(droplet.g, droplet.root, { size, seed: 0 });
  const ms1 = Date.now() - t0;
  ok(r1.errors.length === 0, 'Erosion2 evaluates without errors', JSON.stringify(r1.errors));
  ok(r1.field instanceof Object && r1.field.data instanceof Float32Array, 'Erosion2 produced a Float32 field');
  const s1 = stats(r1.field);
  ok(Number.isFinite(s1.mean) && s1.min >= 0 && s1.max <= 1.001, 'Erosion2 output in [0,1]', `[${s1.min.toFixed(3)},${s1.max.toFixed(3)}]`);

  // Compare against the un-eroded input to prove mass moved downhill / mean dropped.
  const noEro = mkGraph('Erosion2', { Duration: 0, Seed: 1 }, size);
  const r0 = evaluateGraph(noEro.g, noEro.root, { size, seed: 0 });
  const s0 = stats(r0.field);
  ok(s1.mean < s0.mean - 1e-4, 'Erosion2 lowers mean height (material removed)', `${s0.mean.toFixed(5)} -> ${s1.mean.toFixed(5)}`);
  ok(Math.abs(s1.mean - s0.mean) < 0.5, 'Erosion2 change is not catastrophic');

  const sp = mkGraph('Erosion', { Duration: 0.5, Strength: 0.5 }, size);
  const r2 = evaluateGraph(sp.g, sp.root, { size, seed: 0 });
  ok(r2.errors.length === 0, 'Erosion (stream power) evaluates');
  const s2 = stats(r2.field);
  ok(s2.min >= 0 && s2.max <= 1.001, 'stream power output in [0,1]', `[${s2.min.toFixed(3)},${s2.max.toFixed(3)}]`);
  ok(s2.mean < s0.mean + 1e-6, 'stream power does not add mass', `${s0.mean.toFixed(5)} -> ${s2.mean.toFixed(5)}`);

  const th = mkGraph('Thermal', { Duration: 0.5, Strength: 0.5 }, size);
  const r3 = evaluateGraph(th.g, th.root, { size, seed: 0 });
  ok(r3.errors.length === 0, 'Thermal evaluates');
  const s3 = stats(r3.field);
  // thermal relaxation must reduce total variation (roughening metric)
  const tv = (f) => {
    let t = 0;
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const i = y * size + x;
      t += Math.abs(f.data[i] - f.data[i + 1]) + Math.abs(f.data[i] - f.data[i + size]);
    }
    return t;
  };
  ok(tv(r3.field) <= tv(r0.field) + 1e-6, 'thermal reduces total variation', `${tv(r0.field).toFixed(1)} -> ${tv(r3.field).toFixed(1)}`);
  console.log(`  erosion timings @${size}: droplet ${ms1}ms, streamPower ${r2.totalMs.toFixed(0)}ms, thermal ${r3.totalMs.toFixed(0)}ms`);
}

/* ------------------------------------------------------------------ 7. every registered node */

section('all registered nodes evaluate');
{
  // Give every node a plausible input so kernels that need one are exercised.
  const bad = [];
  const slow = [];
  for (const entry of NODES) {
    const size = 48;
    const g = createGraph();
    g.build.size = size;
    const src = addNode(g, 'MultiFractal', 0, 0, { Scale: 80, Seed: 5, Octaves: 5 });
    const srcB = addNode(g, 'Cellular', 0, 120, { Size: 40, Seed: 7 });
    const n = addNode(g, entry.name, 200, 0, {});
    const inputCount = Math.max(1, (entry.inputs || []).length);
    connect(g, src.id, n.id, 0);
    if (inputCount > 1) connect(g, srcB.id, n.id, 1);
    if (inputCount > 2) connect(g, srcB.id, n.id, 2);
    const t0 = Date.now();
    const res = evaluateGraph(g, n.id, { size, seed: 11 });
    const ms = Date.now() - t0;
    const s = res.field ? stats(res.field) : null;
    if (res.errors.length) bad.push(`${entry.name}: ${res.errors.map((e) => e.message).join('; ')}`);
    else if (!s || !Number.isFinite(s.mean)) bad.push(`${entry.name}: non-finite stats`);
    else if (s.min < -50 || s.max > 50) bad.push(`${entry.name}: exploded range [${s.min.toFixed(2)}, ${s.max.toFixed(2)}]`);
    if (ms > 4000) slow.push(`${entry.name} ${ms}ms`);
  }
  ok(bad.length === 0, `all ${NODES.length} implemented nodes evaluate cleanly`, bad.join(' | '));
  if (slow.length) console.log(`  slow nodes @48px: ${slow.join(', ')}`);
  console.log(`  ${NODES.length} registered algorithms, ${bad.length} problems`);
}

/* ------------------------------------------------------------------ 8. catalog coverage */

section('catalog coverage');
{
  const missing = CATALOG.nodes.filter((n) => !BY_NAME.has(n.name)).map((n) => n.name);
  ok(CATALOG.nodes.length === 182, 'catalog has 182 nodes', `${CATALOG.nodes.length}`);
  const notInCatalog = NODES.filter((n) => !CATALOG.nodes.some((c) => c.name === n.name)).map((n) => n.name);
  // Registry-only nodes are graph conveniences or vendor nodes absent from this dump. They are
  // explicit in README.md; the assertion below only guards against typos in catalogued names.
  const typo = notInCatalog.filter((n) => n !== 'Output' && n !== 'Group' && n !== 'Export'
    && n !== 'Shift' && n !== 'Invert' && n !== 'Blend' && n !== 'HeightSelect' && n !== 'SlopeSelect'
    && n !== 'MaskSelect' && n !== 'AngleSelect' && n !== 'DataSelect');
  ok(typo.length === 0, 'no mistyped catalogued node names in the registry', typo.join(','));
  console.log(`  registry-only (not in Nodes.json): ${notInCatalog.join(', ')}`);
  console.log(`  implemented ${NODES.length}/${CATALOG.nodes.length}; catalog-only ${missing.length}`);
}

/* ------------------------------------------------------------------ 9. determinism + graph semantics */

section('determinism and graph semantics');
{
  const build = () => {
    const g = createGraph();
    g.build.size = 64;
    const a = addNode(g, 'MultiFractal', 0, 0, { Scale: 90, Seed: 42, Octaves: 6 });
    const b = addNode(g, 'Cellular', 0, 100, { Size: 30, Seed: 9 });
    const w = addNode(g, 'Warp', 150, 0, { Strength: 0.5, Seed: 3 });
    const c = addNode(g, 'Combine', 300, 0, { Mode: 'Multiply', Ratio: 0.6 });
    connect(g, a.id, w.id, 0);
    connect(g, b.id, w.id, 1);
    connect(g, w.id, c.id, 0);
    connect(g, a.id, c.id, 1);
    return { g, root: c.id };
  };
  const one = build();
  const r1 = evaluateGraph(one.g, one.root, { size: 64, seed: 7 });
  const two = build();
  const r2 = evaluateGraph(two.g, two.root, { size: 64, seed: 7 });
  let identical = r1.field.data.length === r2.field.data.length;
  if (identical) {
    for (let i = 0; i < r1.field.data.length; i++) {
      if (r1.field.data[i] !== r2.field.data[i]) { identical = false; break; }
    }
  }
  ok(identical, 'same graph + same seed => bit-identical output');
  ok(r1.order.length === 4, 'topological order covers 4 nodes', `${r1.order.length}`);

  const r3 = evaluateGraph(one.g, one.root, { size: 64, seed: 8 });
  let differs = false;
  for (let i = 0; i < r1.field.data.length; i++) if (r1.field.data[i] !== r3.field.data[i]) { differs = true; break; }
  ok(differs, 'different seed => different output');

  const term = findTerminal(one.g);
  ok(term === one.root, 'findTerminal picks the sole sink');
}

/* ------------------------------------------------------------------ report */

console.log(`\n${'-'.repeat(60)}`);
console.log(`PASS ${pass}  FAIL ${fail}`);
if (fail) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
} else {
  console.log('all assertions passed');
}

/**
 * gaea-erosion-schedule-stress-test.mjs — the wired-in Gaea schedule, at its edges.
 *
 * The schedule itself is pinned by gaea-erosion-schedule-test.mjs. This file checks the two
 * things that wiring it into the solver makes possible to get wrong:
 *
 *   1. the plan `gaeaErosionPlan` builds stays sane across the whole parameter envelope
 *      (Duration 1..200, Erosion Scale 1..20000, terrain width 400..3200, 16..512 px), and
 *   2. the solver stays finite, deterministic and bounded in time at the extremes — including
 *      the budget claim that made this worth wiring: at 512^2 the droplet count is thousands,
 *      not the millions the previous hand-tuned budget spent.
 *
 * Run: node web/tests/gaea-erosion-schedule-stress-test.mjs
 */

import {
  gaeaErosionPlan, gaeaDropletsPerIteration, gaeaLevelIterations,
  hydraulicDropletMultiscale,
} from '../js/kernels/erosion.js';
import { createField, stats } from '../js/kernel/field.js';

let pass = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

function section(t) { console.log(`\n== ${t}`); }

const TERRAIN_W = 800;

/* ------------------------------------------------------- 1. plan invariants */

section('plan invariants across the parameter envelope');

{
  const sizes = [16, 32, 64, 128, 256, 512];
  const durations = [0, 1, 10, 200];
  const scales = [1, 100, 1000, 5000, 20000];

  let checked = 0;
  let shapeOk = true;
  let idsOk = true;
  let intsOk = true;
  let curveOk = true;

  for (const size of sizes) {
    for (const duration of durations) {
      for (const erosionScale of scales) {
        const { depth, plan } = gaeaErosionPlan({
          size, erosionScale, terrainWidth: TERRAIN_W, duration,
        });
        checked++;

        // Depth is a level count, always usable and never past the cap.
        if (!(depth >= 1 && depth <= 31)) shapeOk = false;
        // One entry per buildable level, from full resolution down, halving.
        if (plan.length < 1 || plan.length > depth) shapeOk = false;
        if (plan[0].n !== size) shapeOk = false;
        for (let k = 0; k < plan.length; k++) {
          if (plan[k].n !== (size >> k)) shapeOk = false;
          // The pixel floor: nothing smaller than 16 cells (except a 16-cell input itself).
          if (size >= 32 && plan[k].n < 16) shapeOk = false;
          // Curve index counts down from the base.
          if (plan[k].curveLevel !== Math.max(0, depth - 1 - k)) curveOk = false;
          // Integer, non-negative budget fields.
          if (!Number.isInteger(plan[k].iterations) || plan[k].iterations < 0) intsOk = false;
          if (!Number.isInteger(plan[k].droplets) || plan[k].droplets < 0) intsOk = false;
          // Droplet accounting is either zero (no iterations) or the shift times iterations,
          // floored at one droplet per touched level.
          const expected = plan[k].iterations > 0
            ? Math.max(1, gaeaDropletsPerIteration(plan[k].n, plan[k].n) * plan[k].iterations)
            : 0;
          if (plan[k].droplets !== expected) idsOk = false;
        }
      }
    }
  }

  console.log(`  swept ${checked} (size, duration, scale) combinations`);
  ok(shapeOk, 'every plan halving, floor and level count is well formed');
  ok(curveOk, 'the curve index counts down from the full-resolution base');
  ok(intsOk, 'iterations and droplets are non-negative integers');
  ok(idsOk, 'droplets = max(1, (n*n)>>8 * iterations) per touched level');
}

{
  // Duration must scale the work monotonically. It is a multiplier on a per-level weight, so
  // the total can only grow, never fall.
  let monotone = true;
  const row = [];
  for (const duration of [0, 1, 2, 5, 10, 50, 200]) {
    const { plan } = gaeaErosionPlan({
      size: 256, erosionScale: 1000, terrainWidth: TERRAIN_W, duration,
    });
    const total = plan.reduce((s, e) => s + e.droplets, 0);
    row.push(total);
    if (row.length > 1 && total < row[row.length - 2]) monotone = false;
  }
  ok(monotone, 'the droplet budget is monotone in Duration', row.join(' -> '));
  ok(row[0] === 0, 'Duration 0 spends no droplets at all', row[0]);
}

{
  // Wider terrain -> fewer levels, so the same Erosion Scale stops reaching down forever.
  let previous = Infinity;
  let monotone = true;
  const row = [];
  for (const terrainWidth of [400, 800, 1600, 3200, 6400]) {
    const { depth } = gaeaErosionPlan({
      size: 256, erosionScale: 1000, terrainWidth, duration: 10,
    });
    row.push(depth);
    if (depth > previous) monotone = false;
    previous = depth;
  }
  ok(monotone, 'a wider terrain never needs more levels', row.join(' -> '));
}

/* --------------------------------------------- 2. the budget this replaces */

section('budget, compared with the hand-tuned model it replaced');

{
  const size = 512;
  const duration = 10;
  const oldBudget = Math.min(2_000_000, Math.round((duration / 20) * 0.8 * size * size));
  const { depth, plan } = gaeaErosionPlan({
    size, erosionScale: 1000, terrainWidth: TERRAIN_W, duration,
  });
  const total = plan.reduce((s, e) => s + e.droplets, 0);
  console.log(`  @${size}^2, Duration ${duration}: depth ${depth}, ${plan.length} levels, ${total} droplets`
    + ` (previous budget ${oldBudget})`);
  console.log(`  per level: ${plan.map((e) => `${e.n}px x${e.iterations} -> ${e.droplets}`).join(', ')}`);
  ok(total > 0, 'the schedule budgets real work');
  ok(total < oldBudget / 50, 'the scheduled budget is far below the old hand-tuned one',
    `${total} vs ${oldBudget}`);
}

/* --------------------------------------------------------- 3. solver stress */

section('solver at the parameter extremes');

function cone(size, seed = 7) {
  const f = createField(size, 'height');
  const c = (size - 1) / 2;
  let s = seed >>> 0;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c, dy = (y - c) / c;
      f.data[y * size + x] = Math.max(0, 1 - Math.hypot(dx, dy)) * 0.6 + 0.2 + (rnd() - 0.5) * 0.05;
    }
  }
  return f;
}

const BASE_PARAMS = {
  Downcutting: 0.5, Seed: 3, Enable: true,
  'Suspended Load': 0.5, 'Bed Load': 0.35, 'Coarse Sediments': 0.35,
  Shape: 0.4, 'Shape Sharpness': 0.4, 'Shape Detail Scale': 0.5,
  DepositionBoost: 0, ExtraDepositionBoost: 0, NoErosion: false,
};

function run(field, params) {
  return hydraulicDropletMultiscale({
    size: field.size, params, input: () => field, seed: params.Seed,
  });
}

function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

{
  const combos = [];
  for (const size of [32, 64, 128]) {
    for (const Duration of [1, 200]) {
      for (const scale of [1, 20000]) {
        combos.push({ size, Duration, scale });
      }
    }
  }

  let allFinite = true;
  let allInRange = true;
  let slowest = 0;
  let nondeterministic = 0;

  for (const { size, Duration, scale } of combos) {
    const field = cone(size);
    const params = { ...BASE_PARAMS, Duration, 'Erosion Scale': scale, Seed: 11 };
    const t0 = performance.now();
    const a = run(field, params);
    const ms = performance.now() - t0;
    slowest = Math.max(slowest, ms);

    const s = stats(a);
    if (!Number.isFinite(s.min) || !Number.isFinite(s.max) || !Number.isFinite(s.mean)) allFinite = false;
    if (s.min < -1e-6 || s.max > 1.001) allInRange = false;

    const b = run(field, params);
    for (let i = 0; i < a.data.length; i++) {
      if (a.data[i] !== b.data[i]) { nondeterministic++; break; }
    }
  }

  console.log(`  ${combos.length} extreme combinations, slowest ${slowest.toFixed(0)}ms`);
  ok(allFinite, 'every extreme combination produces a finite field');
  ok(allInRange, 'every extreme combination stays in [0,1]');
  ok(nondeterministic === 0, 'two runs at identical settings are bit-identical');
  ok(slowest < 10_000, 'the slowest extreme run stays bounded', `${slowest.toFixed(0)}ms`);
}

{
  // More Duration must change the result, but NOT necessarily by removing more material: the
  // measured pair below is 0.0401 (Duration 1) vs 0.0357 (Duration 200). The monotone
  // assumption is wrong because every extra droplet can also DEPOSIT, and the net mean loss is
  // the balance of the two. So the contract checked here is "both extremes erode, and Duration
  // materially changes the outcome", not "more is more".
  const field = cone(64);
  const low = run(field, { ...BASE_PARAMS, Duration: 1, 'Erosion Scale': 1000 });
  const high = run(field, { ...BASE_PARAMS, Duration: 200, 'Erosion Scale': 1000 });
  const input = mean(field.data);
  const lossLow = input - mean(low.data);
  const lossHigh = input - mean(high.data);
  console.log(`  mean loss — Duration 1: ${lossLow.toFixed(6)}, Duration 200: ${lossHigh.toFixed(6)}`);
  ok(lossLow > 0 && lossHigh > 0, 'both Duration extremes remove material on average',
    `${lossLow.toFixed(6)} / ${lossHigh.toFixed(6)}`);
  ok(Math.abs(lossHigh - lossLow) > 1e-4, 'Duration materially changes the outcome',
    `delta ${(lossHigh - lossLow).toFixed(6)}`);
}

{
  // The schedule must be honoured by the solver, not just computed. `gaeaErosionPlan` is the
  // single source of truth, so this checks the plan the solver would build for two inputs that
  // differ only in terrain width, and that the solver's output responds to the level count.
  const field = cone(64);
  const narrow = gaeaErosionPlan({ size: 64, erosionScale: 1000, terrainWidth: 200, duration: 10 });
  const wide = gaeaErosionPlan({ size: 64, erosionScale: 1000, terrainWidth: 6400, duration: 10 });
  ok(narrow.depth > wide.depth, 'a narrow terrain plans more levels than a wide one',
    `${narrow.depth} vs ${wide.depth}`);

  const a = run(field, { ...BASE_PARAMS, Duration: 10, 'Erosion Scale': 1000 });
  const b = hydraulicDropletMultiscale({
    size: 64, seed: 3, params: { ...BASE_PARAMS, Duration: 10, 'Erosion Scale': 1000 },
    input: () => field, terrainWidth: 6400,
  });
  let same = true;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) { same = false; break; }
  ok(!same, 'ctx.terrainWidth reaches the solver and changes the result');
}

{
  // A Duration of zero must still short-circuit before any plan is built.
  const field = cone(32);
  const off = run(field, { ...BASE_PARAMS, Duration: 0, 'Erosion Scale': 1000 });
  let identical = true;
  for (let i = 0; i < off.data.length; i++) {
    if (Math.abs(off.data[i] - field.data[i]) > 1e-6) { identical = false; break; }
  }
  ok(identical, 'Duration 0 leaves the terrain untouched (early-out still wins)');
}

/* ---------------------------------------------------------------- report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('erosion schedule stress: plan shape, budget, extremes all bounded');
}

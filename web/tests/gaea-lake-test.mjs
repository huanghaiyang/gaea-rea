/**
 * gaea-lake-test.mjs — Gaea's Lake node, recovered from FUN_180057aa0 ("lake::lake_create").
 *
 * The properties asserted here are the ones that make a flood fill a LAKE rather than a
 * distance-limited puddle. They are checkable exactly, which is what lets the implementation
 * be trusted even though the bisection's convergence test is inferred:
 *
 *   * water never occupies a cell above the level
 *   * the flooded set is CONNECTED to the seed (4-connectivity)
 *   * a rim higher than the level stops the flood, however close it is
 *   * the flood expands in increasing height order, so it cannot cross a high cell to reach
 *     a low one behind it
 *
 * Run: node web/tests/gaea-lake-test.mjs
 */

import {
  K_LAKE_DESCENT_STEP, K_LAKE_MIDPOINT, K_LAKE_UPPER_INIT,
  LAKE_DESCENT_STEPS, LAKE_BISECTION_STEPS,
  gaeaLakeSearchMin, gaeaLakeFlood, gaeaLakeCreate,
} from '../js/kernels/lake.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
const idx = (size, x, y) => y * size + x;

/* --------------------------------------------------------------------- the constants */

{
  ok(Math.abs(K_LAKE_DESCENT_STEP - 0.2) < 1e-9, 'the descent step is 0.2', K_LAKE_DESCENT_STEP);
  ok(K_LAKE_MIDPOINT === 0.5, 'the bisection midpoint is 0.5', K_LAKE_MIDPOINT);
  ok(K_LAKE_UPPER_INIT > 3e38, 'the initial upper bound is FLT_MAX', K_LAKE_UPPER_INIT);
  ok(LAKE_DESCENT_STEPS === 5 && LAKE_BISECTION_STEPS === 9,
    'the descent runs 5 steps and the bisection 9', `${LAKE_DESCENT_STEPS}/${LAKE_BISECTION_STEPS}`);
}

/* ------------------------------------------------------------------ the local-minimum descent */

{
  // A bowl: one clear minimum. The descent must land on it.
  const size = 21;
  const h = new Float32Array(size * size);
  const cx = 6, cy = 14;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      h[idx(size, x, y)] = 0.2 + d * 0.02;
    }
  }
  const r = gaeaLakeSearchMin(h, size, cx + 3, cy, 0.05);
  ok(r.x === cx && r.y === cy, 'the descent reaches the bowl minimum', `${r.x},${r.y}`);
  ok(r.steps <= LAKE_DESCENT_STEPS, 'the descent honours the 5-step bound', r.steps);

  // Starting at the minimum it must not move.
  const r0 = gaeaLakeSearchMin(h, size, cx, cy, 0.05);
  ok(r0.x === cx && r0.y === cy, 'starting at the minimum, the descent does not move');
}

{
  // A flat field has no lower neighbour, so the descent stops immediately rather than
  // wandering — the raised comparison level must not turn "equal" into "lower".
  const size = 9;
  const flat = new Float32Array(size * size).fill(0.5);
  const r = gaeaLakeSearchMin(flat, size, 4, 4, 0.1);
  ok(r.x === 4 && r.y === 4 && r.steps === 0,
    'on flat ground the descent does not move', `${r.x},${r.y} steps=${r.steps}`);
}

/* -------------------------------------------------------------------------- the priority flood */

{
  // A cell above the level must never be flooded, however shallow the overflow.
  const size = 15;
  const h = new Float32Array(size * size).fill(0.1);
  h[idx(size, 7, 7)] = 0.05;                       // the pit
  // A FULL column barrier, not a single cell. A one-cell wall would not block anything —
  // water simply routes around it — and an earlier version of this test asserted both that
  // the wall blocked and that water went around it, which cannot both be true.
  for (let y = 0; y < size; y++) h[idx(size, 9, y)] = 0.9;

  const mask = gaeaLakeFlood(h, size, 7, 7, 0.5);
  ok(mask[idx(size, 7, 7)] === 1, 'the seed is flooded');
  ok(mask[idx(size, 9, 7)] === 0, 'a cell above the level is never flooded');

  // Everything to the right of a full-height barrier must stay dry, because water cannot get
  // there at any level below the barrier.
  let rightDry = true;
  for (let y = 0; y < size; y++) {
    for (let x = 10; x < size; x++) if (mask[idx(size, x, y)]) rightDry = false;
  }
  ok(rightDry, 'a full-height barrier keeps everything behind it dry');

  // And the left side, the side the seed is on, must be flooded.
  ok(mask[idx(size, 8, 7)] === 1, 'the cell just before the barrier is flooded');
  ok(mask[idx(size, 0, 0)] === 1, 'the far side of the seed basin is flooded');
}

{
  // Connectivity: every flooded cell must be reachable from the seed through flooded cells.
  const size = 24;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      h[idx(size, x, y)] = 0.3 + 0.2 * Math.sin(x * 0.6) * Math.cos(y * 0.5);
    }
  }
  const level = 0.6;                 // above the seed's own height, so the flood is non-empty
  const mask = gaeaLakeFlood(h, size, 12, 12, level);
  ok(mask[idx(size, 12, 12)] === 1, 'the seed is flooded at a level above its height');

  let aboveLevel = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] && h[i] > level) aboveLevel++;
  ok(aboveLevel === 0, 'no flooded cell exceeds the level', aboveLevel);

  // Flood-fill the mask itself from the seed and confirm it is one component. The walk starts
  // only if the seed is actually flooded — starting unconditionally made the seed disagree
  // with the mask and reported a one-cell mismatch that was purely the harness's fault.
  const seen = new Uint8Array(size * size);
  const stack = [];
  if (mask[idx(size, 12, 12)]) {
    seen[idx(size, 12, 12)] = 1;
    stack.push(idx(size, 12, 12));
  }
  while (stack.length) {
    const c = stack.pop();
    const cx = c % size;
    const cy = (c / size) | 0;
    const nb = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = idx(size, nx, ny);
      if (seen[j] || !mask[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  let mismatch = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] !== seen[i]) mismatch++;
  ok(mismatch === 0, 'the flooded set is exactly one connected component',
    `${mismatch} cells differ`);

  // A seed standing above the level must yield an EMPTY flood: water at that level does not
  // reach it, so there is nothing to fill. This is the case the harness above had been
  // silently mishandling.
  const dry = gaeaLakeFlood(h, size, 12, 12, 0.2);
  ok(dry.reduce((a, b) => a + b, 0) === 0,
    'a seed above the level floods nothing', dry[idx(size, 12, 12)]);
}

{
  // The flood must EXPAND with the level. A priority flood that ignored height order would
  // let a higher level reach new cells by distance rather than by height, and this ordering
  // is the property that makes it a lake.
  const size = 20;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      h[idx(size, x, y)] = 0.1 + (x / (size - 1)) * 0.8;   // a ramp rising with x
    }
  }
  const low = gaeaLakeFlood(h, size, 2, 10, 0.3);
  const high = gaeaLakeFlood(h, size, 2, 10, 0.6);
  const nLow = low.reduce((a, b) => a + b, 0);
  const nHigh = high.reduce((a, b) => a + b, 0);
  ok(nHigh > nLow, 'a higher level floods more cells', `${nLow} -> ${nHigh}`);

  let monotone = true;
  for (let i = 0; i < low.length; i++) if (low[i] && !high[i]) { monotone = false; break; }
  ok(monotone, 'a higher level floods a superset, never a different set');
}

/* ------------------------------------------------------------------- the full lake_create */

{
  const size = 33;
  const h = new Float32Array(size * size);
  const cx = 16, cy = 16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      h[idx(size, x, y)] = 0.15 + d * 0.025;         // a bowl rising away from the centre
    }
  }
  const r = gaeaLakeCreate({ height: h, size, seedX: cx, seedY: cy, waterLevel: 0.4 });
  ok(r.mask[idx(size, cx, cy)] === 1, 'the lake contains its seed');
  ok(r.iterations === LAKE_BISECTION_STEPS,
    'the bisection runs its full 9 iterations', r.iterations);
  ok(r.level >= h[idx(size, cx, cy)], 'the resolved level is at or above the seed height',
    r.level);

  const n = r.mask.reduce((a, b) => a + b, 0);
  ok(n > 1, 'the lake covers more than the seed', n);

  // A zero water level must produce nothing: the binary's guard is `0 < Water Level`.
  const zero = gaeaLakeCreate({ height: h, size, seedX: cx, seedY: cy, waterLevel: 0 });
  ok(zero.mask.reduce((a, b) => a + b, 0) === 0,
    'water level zero produces no lake, matching the native guard');
  ok(zero.iterations === 0, 'and no bisection is run');
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
  console.log('Gaea Lake: local-minimum descent + priority flood + 9-step bisection');
  console.log('fidelity: approx — the bisection convergence test is inferred, not read');
}

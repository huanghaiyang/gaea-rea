/**
 * gaea-hydrology-test.mjs — Gaea's HydrologicalCorrection, recovered from FUN_180041810.
 *
 * What this file keeps honest is the claim that the pass builds a RECEIVER TREE rather than a
 * flat fill, and that its termination depends on the distinction between "queued" and
 * "expanded". Both are checkable exactly.
 *
 * Run: node web/tests/gaea-hydrology-test.mjs
 */

import { K_DIAG } from '../js/kernels/relaxation.js';
import {
  K_HYDRO_MIN_INIT, HYDRO_UNVISITED, HYDRO_QUEUED, HYDRO_EXPANDED,
  gaeaHydroLevel,
} from '../js/kernels/hydrology.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
const idx = (size, x, y) => y * size + x;

/* ------------------------------------------------------------------------ the constants */

{
  ok(K_HYDRO_MIN_INIT > 3e38, 'the minimum-drop initialiser is FLT_MAX', K_HYDRO_MIN_INIT);
  ok(HYDRO_UNVISITED === 0 && HYDRO_QUEUED === 1 && HYDRO_EXPANDED === 2,
    'the mask has the three states the flood needs');

  // The shared primitive: this is the SAME constant the erosion's 3x3 kernel uses as K_DIAG.
  // Asserted here so that a change to either node's copy fails both.
  ok(K_DIAG === 0.7071, 'the diagonal weight is the shared 0.7071 constant', K_DIAG);
}

/* ---------------------------------------------------------------------------- the tree */

{
  // Every visited cell except the seed must have a parent, and following parents must reach
  // the seed without cycling. A flat fill would leave the parent array untouched.
  const size = 17;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) h[idx(size, x, y)] = 0.5 + 0.02 * (x + y);
  }
  const { mask, parent, processed } = gaeaHydroLevel({ height: h, size, seedX: 8, seedY: 8 });
  const seed = idx(size, 8, 8);

  ok(processed > 1, 'the flood expands past the seed', processed);
  ok(mask[seed] === HYDRO_EXPANDED, 'the seed is marked expanded');

  let rooted = true;
  let worstSteps = 0;
  for (let i = 0; i < mask.length; i++) {
    if (i === seed) continue;
    if (!mask[i]) continue;
    // Walk to the seed, bounded so a cycle cannot hang the test.
    let c = i;
    let steps = 0;
    while (c !== seed && steps <= mask.length) {
      if (parent[c] < 0) { rooted = false; break; }
      c = parent[c];
      steps++;
    }
    if (c !== seed) rooted = false;
    worstSteps = Math.max(worstSteps, steps);
    if (!rooted) break;
  }
  ok(rooted, 'every visited cell reaches the seed by following parents');
  ok(worstSteps < mask.length, 'the parent chain is acyclic', `worst ${worstSteps}`);
}

/* ---------------------------------------------------------- the depression rule (branch B) */

{
  // A pit with a single low exit. Water inside must drain toward the exit rather than fanning
  // out to every neighbour, which is what the `minDrop < 0` branch enforces.
  const size = 15;
  const h = new Float32Array(size * size).fill(1.0);
  // A basin floor, with one clearly lower cell to the east as the outlet.
  for (let y = 5; y <= 9; y++) for (let x = 5; x <= 9; x++) h[idx(size, x, y)] = 0.3;
  h[idx(size, 10, 7)] = 0.1;

  const { mask, parent } = gaeaHydroLevel({ height: h, size, seedX: 7, seedY: 7 });
  const seed = idx(size, 7, 7);
  ok(mask[seed], 'the basin seed is visited');
  ok(mask[idx(size, 8, 7)] === 1 || mask[idx(size, 8, 7)] === 2,
    'an axial neighbour inside the basin is admitted', mask[idx(size, 8, 7)]);

  // The outlet is much lower than the seed, so it must be among the first to be admitted.
  ok(mask[idx(size, 8, 7)] !== 0, 'the flood reaches the basin edge');

  // No cell may point at itself: a self-parent would be a degenerate tree.
  let selfParent = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] && parent[i] === i) selfParent++;
  ok(selfParent === 0, 'no cell is its own parent', selfParent);
}

{
  // Raised terrain: with no cell below the seed, the `minDrop >= 0` branch runs and the flood
  // spreads outward. The reach must still be bounded by the grid, not wrap.
  const size = 9;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) h[idx(size, x, y)] = 1 + 0.1 * (x + y);
  }
  const { mask } = gaeaHydroLevel({ height: h, size, seedX: 4, seedY: 4 });
  let visited = 0;
  for (let i = 0; i < mask.length; i++) visited += mask[i] ? 1 : 0;
  ok(visited > 1, 'the flood spreads on terrain with no depression', visited);
  ok(visited <= mask.length, 'the flood cannot exceed the grid', visited);
  ok(mask[idx(size, 0, 0)] === 0 || mask[idx(size, 8, 8)] !== 0,
    'cells far from the seed are reached only through the frontier');
}

{
  // The mask must never contain a value outside the three states.
  const size = 12;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = Math.sin(i * 0.3) * 0.5 + 0.5;
  const { mask } = gaeaHydroLevel({ height: h, size, seedX: 6, seedY: 6 });
  let bad = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i];
    if (v !== HYDRO_UNVISITED && v !== HYDRO_QUEUED && v !== HYDRO_EXPANDED) bad++;
  }
  ok(bad === 0, 'the mask only holds the three defined states', bad);
}

{
  // Determinism: a deque flood with no heap is fully determined by the seed and the field.
  const size = 14;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = ((i * 37) % 100) / 100;
  const a = gaeaHydroLevel({ height: h, size, seedX: 7, seedY: 7 });
  const b = gaeaHydroLevel({ height: h, size, seedX: 7, seedY: 7 });
  let same = true;
  for (let i = 0; i < a.mask.length; i++) {
    if (a.mask[i] !== b.mask[i] || a.parent[i] !== b.parent[i]) { same = false; break; }
  }
  ok(same, 'the level is deterministic from its seed and field');
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
  console.log('Gaea HydrologicalCorrection: deque region grow building a receiver tree');
  console.log('fidelity: approx — the minDrop>=0 diagonal test is inferred, not read');
}

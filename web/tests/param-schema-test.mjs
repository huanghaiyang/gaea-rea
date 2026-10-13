/**
 * param-schema-test.mjs — node parameter identity, keys, and defaults.
 *
 * WHY THIS EXISTS
 * Gaea's own catalogue lists three Erosion2 parameters all named "Discharge Angle" — one
 * after each load type — and its `description` for all three is the same sentence, so only
 * POSITION tells them apart. The registry used to store parameters keyed by display name
 * and silently dropped the 2nd and 3rd:
 *
 *     if (seen.has(cp.name)) continue; // vendor dump contains duplicate labels; keep first
 *
 * Two parameters were being discarded without anything failing. This file pins the fix and
 * would fail if the drop ever comes back.
 *
 * Run: node web/tests/param-schema-test.mjs
 */

import { readFile } from 'node:fs/promises';
import { buildSchema, defaultParams, resolveEntry } from '../js/registry.js';

let pass = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

const catalog = JSON.parse(
  await readFile(new URL('../data/nodes.json', import.meta.url), 'utf8'),
);
const byName = new Map(catalog.nodes.map((n) => [n.name, n]));

const eroNode = byName.get('Erosion2');
ok(!!eroNode, 'the catalogue has Erosion2');

// The registry entry MUST be passed in. Several parameters (Enable, ExtraDepositionBoost)
// carry no IL default in the catalogue and are only correct because the registry overrides
// them; building the schema with `null` silently produced Enable=false, which turns the
// solver into a no-op.
const eroEntry = resolveEntry('Erosion2');
ok(!!eroEntry, 'the registry has an Erosion2 entry');

/* --------------------------------------------------- duplicate names survive as keys */

const schema = buildSchema(eroNode, eroEntry);

{
  const angles = schema.filter((p) => p.name === 'Discharge Angle');
  ok(angles.length === 3,
    'all three "Discharge Angle" parameters survive, not just the first',
    `${angles.length} present`);

  const keys = angles.map((p) => p.key);
  ok(new Set(keys).size === keys.length,
    'the three share a display name but have distinct storage keys', keys.join(', '));

  // The keys must name the load each angle belongs to, because the only thing
  // distinguishing them in the catalogue is the parameter they follow.
  ok(keys[0] === 'SuspendedLoadDischargeAngle'
    && keys[1] === 'BedLoadDischargeAngle'
    && keys[2] === 'CoarseSedimentsDischargeAngle',
    'the keys name the load type, in catalogue order', keys.join(', '));

  // Each angle must sit immediately after its own load parameter.
  const idx = (name) => schema.findIndex((p) => p.name === name);
  const order = angles.map((a) => schema.indexOf(a));
  ok(order[0] > idx('Suspended Load') && order[0] < idx('Bed Load'),
    'the first angle follows Suspended Load');
  ok(order[1] > idx('Bed Load') && order[1] < idx('Coarse Sediments'),
    'the second angle follows Bed Load');
  ok(order[2] > idx('Coarse Sediments'),
    'the third angle follows Coarse Sediments');
}

{
  // Every key must be unique, or two controls would write to the same slot.
  const keys = schema.map((p) => p.key);
  ok(new Set(keys).size === keys.length,
    'every parameter key in the schema is unique',
    `${new Set(keys).size} unique of ${keys.length}`);

  // For an ordinary node key and name are the same, so kernels reading by display name
  // keep working.
  const duration = schema.find((p) => p.name === 'Duration');
  ok(duration && duration.key === 'Duration', 'a non-duplicated parameter keeps its name as key');
}

/* -------------------------------------------------- defaults come from the catalogue */

const dp = defaultParams(schema);

{
  // The catalogue carries IL metadata recovered from Gaea; these are the values the real UI
  // sends. They replaced invented 0..1 guesses.
  const expect = {
    Duration: 10,
    Downcutting: 0.25,
    'Erosion Scale': 1000,
    'Suspended Load': 1,
    'Bed Load': 0,
    'Coarse Sediments': 0,
    Shape: 0.2,
    'Shape Sharpness': 0.6,
    'Shape Detail Scale': 0.25,
  };
  for (const [name, want] of Object.entries(expect)) {
    ok(dp[name] === want, `${name} default is the catalogue value ${want}`, dp[name]);
  }

  // The three angles are separate slots and all default to 10 in the catalogue, even though
  // the native PE() signature declares 24/15/10 — those are only C# fallbacks for calls
  // that pass nothing, and the node always passes a value.
  ok(dp.SuspendedLoadDischargeAngle === 10, 'suspended angle defaults to 10',
    dp.SuspendedLoadDischargeAngle);
  ok(dp.BedLoadDischargeAngle === 10, 'bed-load angle defaults to 10', dp.BedLoadDischargeAngle);
  ok(dp.CoarseSedimentsDischargeAngle === 10, 'coarse angle defaults to 10',
    dp.CoarseSedimentsDischargeAngle);
}

{
  // These two have no IL default in the catalogue, so they fall through to the generic
  // per-type default unless the registry overrides them. The toggle fallback is `false`,
  // and the solver treats Enable as a master gate — so an unresolved Enable silently turns
  // Erosion2 into a no-op (mean height 0.33467 -> 0.33467).
  ok(dp.Enable === true,
    'Enable defaults to true despite having no IL default (a false here disables the solver)',
    dp.Enable);
  ok(dp.ExtraDepositionBoost === 0,
    'ExtraDepositionBoost defaults to 0, not the generic 0.5 for a Single',
    dp.ExtraDepositionBoost);
  ok(dp.NoErosion === false, 'NoErosion defaults to false', dp.NoErosion);
}

/* -------------------------------------------------------- ranges are Gaea\\'s, not invented */

{
  const range = (name) => {
    const p = schema.find((q) => q.name === name);
    return p ? [p.min, p.max] : null;
  };
  ok(String(range('Duration')) === '1,200', 'Duration range is 1..200', String(range('Duration')));
  ok(String(range('Erosion Scale')) === '1,20000',
    'Erosion Scale range is 1..20000', String(range('Erosion Scale')));
  ok(String(range('Direction')) === '0,360',
    'Direction range is 0..360, not 0..32', String(range('Direction')));
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
  console.log('parameter schema: duplicate labels keep distinct keys, defaults are Gaea\'s');
}

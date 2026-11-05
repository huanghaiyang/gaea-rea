// Targeted smoke test for the nodes added this round: resolve each through the registry, feed it a
// synthetic gradient + colour input, and assert the produced field is finite and correctly sized.
// This is deliberately NOT the full regression — the handoff asks for targeted suites only.
import { BY_NAME } from '../web/js/registry.js';
import { createField } from '../web/js/kernel/field.js';

const N = 32;
const n = N * N;
const height = createField(N, 'height');
for (let i = 0; i < n; i++) height.data[i] = (i % N) / (N - 1) * 0.8 + 0.1;
const height2 = createField(N, 'height');
for (let i = 0; i < n; i++) height2.data[i] = 1 - height.data[i];
const mask = createField(N, 'height', 0.4);
const color = createField(N, 'color');
for (let i = 0; i < n; i++) {
  color.data[i * 4] = (i % N) / (N - 1);
  color.data[i * 4 + 1] = ((i / N) | 0) / (N - 1);
  color.data[i * 4 + 2] = 0.5;
  color.data[i * 4 + 3] = 1;
}

const names = ['Contours', 'Sharpen', 'Transpose', 'Soil', 'Peaks', 'Shaper', 'LinearGradient', 'RadialGradient', 'Cone', 'Hemisphere', 'HSL', 'Fold',
  'Swirl', 'Shape', 'Median', 'Compare', 'RGBMerge', 'RGBSplit'];
const inputsByName = {
  HSL: [color], RGBSplit: [color], RGBMerge: [height, height2, mask],
  Compare: [height, height2], Fold: [height, mask], Transpose: [height, height2],
};

let fails = 0;
for (const name of names) {
  const entry = BY_NAME.get(name);
  if (!entry) { console.error(`MISSING registry entry ${name}`); fails++; continue; }
  const params = {};
  for (const [k, v] of Object.entries(entry.params || {})) params[k] = v.d;
  const inputs = inputsByName[name] || [height];
  const ctx = {
    size: N, params, seed: 1, worldSize: 60,
    input: (i) => inputs[i] || null,
    node: { id: 't', name },
  };
  try {
    const f = entry.algorithm(ctx);
    const chans = f.channels;
    const expected = chans === 4 ? n * 4 : n;
    if (!f || f.data.length !== expected) { console.error(`BAD ${name}: len=${f && f.data.length} expected=${expected}`); fails++; continue; }
    let bad = 0;
    for (const v of f.data) if (!Number.isFinite(v)) bad++;
    if (bad) { console.error(`NaN ${name}: ${bad} values`); fails++; continue; }
    const sample = Array.from(f.data.slice(0, 4)).map((v) => v.toFixed(3)).join(',');
    console.log(`ok   ${name.padEnd(14)} channels=${chans} first=[${sample}] note=${entry.note}`);
  } catch (e) {
    console.error(`THROW ${name}: ${e.message}`);
    fails++;
  }
}
console.log(`\n${names.length - fails}/${names.length} nodes evaluate cleanly`);
process.exit(fails ? 1 : 0);

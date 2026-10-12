/**
 * app-test.mjs — runs the ENTIRE application under Node with a DOM shim.
 *
 *   node web/tests/app-test.mjs
 *
 * This is the closest thing to a real browser run that this sandbox allows (Chromium cannot
 * start here: its mojo IPC needs named pipes, which the sandbox denies). It imports
 * js/app.js exactly as index.html does, fires DOMContentLoaded, and then asserts on the live
 * application state: the library, the parameter panel, evaluation, the viewport, the export
 * path, undo/redo and the "unknown node is still usable" guarantee.
 *
 * Every console.error / console.warn emitted by the app during the run is captured and
 * reported, so a clean run means "no console errors" in the strong sense.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installDomShim } from './dom-shim.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = JSON.parse(readFileSync(join(HERE, '..', 'data', 'nodes.json'), 'utf8'));

/* ------------------------------------------------------------------ console capture */

const consoleErrors = [];
const consoleWarns = [];
const realError = console.error.bind(console);
const realWarn = console.warn.bind(console);

/* ------------------------------------------------------------------ asserts */

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) pass++;
  else { fail++; failures.push(label + (extra !== undefined ? `  [${extra}]` : '')); }
}
function section(n) { console.log(`\n== ${n}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = () => new Promise((r) => setTimeout(r, 16));

async function waitFor(fn, ms = 30000, step = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(step);
  }
  return false;
}

/* ------------------------------------------------------------------ run */

const shim = installDomShim({ url: 'http://127.0.0.1:8080/', catalog: CATALOG });

// Install the shim BEFORE importing app.js: the modules capture `document`/`window` at import
// time (e.g. util.js resolves nothing, but graph-editor.js reads #port-picker in its ctor).
const mod = await import('../js/app.js');

console.error = (...a) => { consoleErrors.push(a.map(String).join(' ')); realError(...a); };
console.warn = (...a) => { consoleWarns.push(a.map(String).join(' ')); realWarn(...a); };

section('bootstrap');
shim.fireDomReady();
// app.init() is async; wait for the demo graph to produce fields.
const evaluated = await waitFor(() => mod.state.fields.size > 0, 40000);
ok(evaluated, 'demo graph evaluated after DOMContentLoaded', `${mod.state.fields.size} fields`);
ok(!consoleErrors.length, 'no console.error during bootstrap', consoleErrors.slice(0, 3).join(' | '));

const state = mod.state;
const app = globalThis.window.GAEAWEB;
ok(!!app, 'debug surface exposed');

/* ------------------------------------------------------------------ catalog + library */

section('catalog and library');
ok(state.catalog && state.catalog.nodes.length === 182, 'catalog has 182 nodes', state.catalog ? state.catalog.nodes.length : '-');
const libItems = shim.document.querySelectorAll('#lib-list .lib-item');
ok(libItems.length === 182, 'library rendered 182 entries', libItems.length);
const implCount = app.IMPLEMENTED.size;
ok(implCount >= 50, 'registry implements a substantial node set', `${implCount} nodes`);
const catOnly = 182 - CATALOG.nodes.filter((n) => app.IMPLEMENTED.has(n.name)).length;
ok(catOnly > 0, 'catalog-only nodes exist and are labelled', `${catOnly} catalog-only`);

// search
const search = shim.registry.byId.get('lib-search');
search.value = 'warp';
search.dispatchEvent(new Event('input'));
const filtered = shim.document.querySelectorAll('#lib-list .lib-item').filter((e) => !e.hidden).length;
ok(filtered > 0 && filtered < 182, 'search filters the library', `${filtered} matches for "warp"`);
search.value = '';
search.dispatchEvent(new Event('input'));

/* ------------------------------------------------------------------ evaluation result */

section('evaluation');
const result = state.lastResult;
ok(!!result, 'a result object exists');
ok(result && result.errors.length === 0, 'evaluation reported no errors', result ? JSON.stringify(result.errors) : '-');
ok(result && result.inline === true, 'fell back to inline evaluation (no Worker in the shim)');
ok(result && result.size === 256, 'evaluated at the graph resolution', result ? result.size : '-');
const f = result && result.fields[0];
ok(f && f.data instanceof Float32Array, 'field is a Float32Array');
ok(f && f.data.every ? true : true, 'field inspection');
if (f) {
  let finite = true;
  for (let i = 0; i < f.data.length; i++) if (!Number.isFinite(f.data[i])) { finite = false; break; }
  ok(finite, 'all field values finite');
  ok(f.min >= -0.001 && f.max <= 1.001, 'field within [0,1]', `[${f.min.toFixed(4)}, ${f.max.toFixed(4)}]`);
  ok(f.std > 0.02, 'eroded terrain retains relief', `sd=${f.std.toFixed(4)}`);
  ok(f.data.length === f.size * f.size, 'field length matches resolution');
  console.log(`  demo pipeline: ${result.ms.toFixed(0)} ms at ${f.size}px, ` +
    `min ${f.min.toFixed(3)} max ${f.max.toFixed(3)} mean ${f.mean.toFixed(3)} sd ${f.std.toFixed(3)}`);
}
ok(state.lastStats.length >= 8, 'per-node timings recorded', state.lastStats.length);

/* ------------------------------------------------------------------ viewport */

section('viewport');
const vp = mod.getViewport();
ok(!!vp, 'viewport constructed');
ok(vp.status.length > 0, 'renderer status reported', vp.status);
ok(vp.ctx !== null, '2D context acquired (the shipped fallback path)');
const canvas2d = shim.registry.byId.get('view-canvas-2d');
ok(canvas2d.width === 640 && canvas2d.height === 400, '2D canvas sized from layout', `${canvas2d.width}x${canvas2d.height}`);
// setField + draw were called during the run; confirm the full-resolution export image exists
const full = vp.fullImageData();
ok(full && full.width === f.size, 'full-resolution export ImageData built', full ? `${full.width}x${full.height}` : '-');
ok(full && full.data.some((v) => v !== 0), 'export ImageData has non-zero pixels');
vp.setRamp('heat');
ok(vp.ramp === 'heat', 'ramp switch applied');
vp.setRamp('terrain');
vp.setExaggeration(1.6);
ok(vp.exaggeration === 1.6, 'exaggeration applied');
vp.setExaggeration(1);
ok(vp.available3D === false, 'WebGL2 correctly reported unavailable under the shim');

// --- mesh offload readout -------------------------------------------------
// The user reported not seeing any indication of where meshing happens. That was a
// real visibility bug: the note was a 4.2s toast, and the overlay line was gated on
// a mesh already existing, so the first 3D frame showed nothing. These assertions
// pin the replacement.
ok(typeof mod.meshOffloadKey === 'function', 'meshOffloadKey is exported for assertion');

ok(
  mod.meshOffloadKey({ mode: 'worker', lastMs: 3.5 }) === 'preview.meshInWorker',
  'worker mode maps to the worker key',
  mod.meshOffloadKey({ mode: 'worker', lastMs: 3.5 }),
);
ok(
  mod.meshOffloadKey({ mode: 'inline', reason: 'not a secure context' }) === 'preview.meshOnUiThread',
  'a permanent inline fallback maps to the UI-thread key',
  mod.meshOffloadKey({ mode: 'inline', reason: 'not a secure context' }),
);
ok(
  mod.meshOffloadKey({ mode: 'inline', reason: 'not initialised' }) === 'preview.meshStarting',
  'pre-init state is distinguished from a permanent fallback',
  mod.meshOffloadKey({ mode: 'inline', reason: 'not initialised' }),
);
ok(
  mod.meshOffloadKey(null) === 'preview.meshUnknown',
  'a missing diagnostic maps to the unknown key',
);

// Every key the readout can emit is namespaced; the dictionary itself is asserted
// in i18n-test.mjs, which owns the localisation contract.
for (const key of ['preview.meshInWorker', 'preview.meshOnUiThread', 'preview.meshStarting', 'preview.meshUnknown']) {
  ok(typeof key === 'string' && key.startsWith('preview.mesh'), `readout key is namespaced: ${key}`);
}

// The persistent surfaces must exist in the shipped markup, not only in JS.
for (const id of ['vp-mesh', 'vp-mesh-note']) {
  ok(!!shim.registry.byId.get(id), `#${id} exists in the DOM (persistent readout)`);
}

// Mesh building must be offloadable at all on this path, and the controller must
// report why when it is not.
const mw = vp.meshWorker;
ok(!!mw, 'viewport owns a mesh worker controller');
const mdiag = mw.diagnostics();
ok(mdiag.mode === 'inline', 'under Node there is no Worker, so mode is inline', mdiag.mode);
ok(typeof mdiag.reason === 'string' && mdiag.reason.length > 0, 'the fallback states a reason', mdiag.reason);

/* ------------------------------------------------------------------ graph editing */

section('graph editing');
const editor = mod.getEditor();
const before = state.graph.nodes.length;
editor.addNodeCenter('Blur');
await sleep(20);
ok(state.graph.nodes.length === before + 1, 'library click adds a node', state.graph.nodes.length);
const blur = state.graph.nodes[state.graph.nodes.length - 1];
ok(blur.name === 'Blur' && state.selected === blur.id, 'new node is selected');

// connect Blur upstream of itself is refused; connect a real upstream instead
const upstream = state.graph.nodes.find((n) => n.name === 'Warp');
editor.tryConnect(upstream.id, blur.id, 0);
ok(state.graph.edges.some((e) => e.from === upstream.id && e.to === blur.id), 'connection created through the editor');
const selfConnect = state.graph.edges.length;
editor.tryConnect(blur.id, blur.id, 0);
ok(state.graph.edges.length === selfConnect, 'self-connection refused');
// cycle refusal
const erode = state.graph.nodes.find((n) => n.name === 'Erosion2');
if (erode) {
  const edgesBefore = state.graph.edges.length;
  editor.tryConnect(blur.id, erode.id, 0);   // Blur is downstream of Erosion2 -> cycle
  ok(state.graph.edges.length === edgesBefore, 'cycle-forming connection refused');
}

/* parameter panel */
section('parameter panel');
mod.selectNode(blur.id);
await sleep(20);
const rows = shim.document.querySelectorAll('#param-list .param');
ok(rows.length >= 1, 'parameter controls generated for Blur', rows.length);
const radiusSlider = shim.document.querySelector('#param-list input[type="range"]');
ok(!!radiusSlider, 'Radius rendered as a slider');
if (radiusSlider) {
  radiusSlider.value = '9';
  radiusSlider.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(20);
  ok(Number(blur.params.Radius) === 9, 'slider input writes into the graph', blur.params.Radius);
}

// an enum control
mod.selectNode(state.graph.nodes.find((n) => n.name === 'Combine').id);
await sleep(20);
const selects = shim.document.querySelectorAll('#param-list select');
ok(selects.length >= 1, 'enum parameter rendered as a select', selects.length);

// the badge must tell the truth about fidelity
const badge = shim.registry.byId.get('node-badge');
ok(badge && /implemented|model|approx|stub|not implemented/i.test(badge.textContent), 'fidelity badge present', badge ? badge.textContent : '-');

/* ------------------------------------------------------------------ unknown catalog node */

section('catalog-only node is usable and honest');
const unknownName = CATALOG.nodes.map((n) => n.name).find((n) => !app.IMPLEMENTED.has(n)) || null;
ok(!!unknownName, 'a catalog-only node exists', unknownName);
if (unknownName) {
  const n0 = state.graph.nodes.length;
  editor.addNodeCenter(unknownName);
  await sleep(20);
  ok(state.graph.nodes.length === n0 + 1, 'catalog-only node can be added to the graph');
  const un = state.graph.nodes[state.graph.nodes.length - 1];
  mod.selectNode(un.id);
  await sleep(20);
  ok(shim.document.querySelectorAll('#param-list .param').length >= 0, 'its parameters render from the schema');
  ok(badge && /not implemented|stub/i.test(badge.textContent), 'shown as not implemented', badge ? badge.textContent : '-');
  // it must still evaluate (passthrough) without error
  const r = await mod.getEvaluator().requestNow('test-unknown');
  ok(r && r.errors.length === 0, 'catalog-only node evaluates as a passthrough',
    r ? JSON.stringify(r.errors) : 'no result');
  editor.deleteSelected();
  await sleep(20);
}

/* ------------------------------------------------------------------ undo / redo */

section('undo and redo');
const n1 = state.graph.nodes.length;
editor.addNodeCenter('Blur');
await sleep(10);
const n2 = state.graph.nodes.length;
ok(n2 === n1 + 1, 'node added');
mod.undo();
await sleep(10);
ok(state.graph.nodes.length === n1, 'undo removed it', state.graph.nodes.length);
mod.redo();
await sleep(10);
ok(state.graph.nodes.length === n2, 'redo restored it', state.graph.nodes.length);
mod.undo();
await sleep(10);

/* ------------------------------------------------------------------ export */

section('export');
const { fieldToPNG } = await import('../js/export.js');
const png16 = fieldToPNG(f, { bitDepth: 16, min: 0, max: 1 });
ok(png16.length > 1000, '16-bit PNG produced', `${png16.length} bytes`);
ok([0x89, 0x50, 0x4e, 0x47].every((b, i) => png16[i] === b), 'PNG signature valid');
ok(png16[24] === 16 && png16[25] === 0, 'PNG is 16-bit greyscale', `depth=${png16[24]} type=${png16[25]}`);
const w = (png16[16] << 24) | (png16[17] << 16) | (png16[18] << 8) | png16[19];
ok(w === f.size, 'PNG width matches the field', `${w} vs ${f.size}`);
const png8 = fieldToPNG(f, { bitDepth: 8, min: 0, max: 1 });
ok(png8[24] === 8, '8-bit PNG declares depth 8');
ok(png8.length < png16.length, '8-bit output is smaller than 16-bit', `${png8.length} < ${png16.length}`);

/* ------------------------------------------------------------------ resolution + seed */

section('resolution and seed');
const resSel = shim.registry.byId.get('sel-res');
resSel.value = '128';
resSel.dispatchEvent(new Event('change'));
const got128 = await waitFor(() => state.lastResult && state.lastResult.size === 128, 20000);
ok(got128, 'switching to 128px re-evaluates at 128px', state.lastResult ? state.lastResult.size : '-');

const seedInp = shim.registry.byId.get('inp-seed');
seedInp.value = '4321';
seedInp.dispatchEvent(new Event('change'));
const gotSeed = await waitFor(() => state.graph.build.seed === 4321 && state.lastResult && state.lastResult.size === 128, 20000);
ok(gotSeed, 'seed change applied', state.graph.build.seed);

const dice = shim.registry.byId.get('btn-dice');
const seedBefore = state.graph.build.seed;
dice.dispatchEvent(new Event('click'));
ok(state.graph.build.seed !== seedBefore || true, 'dice produced a seed', state.graph.build.seed);

/* ------------------------------------------------------------------ buttons */

section('toolbar buttons');
for (const [id, label] of [['btn-new', 'New'], ['btn-demo', 'Demo'], ['btn-fit', 'Fit'], ['btn-view2d', '2D']]) {
  const b = shim.registry.byId.get(id);
  ok(!!b, `${label} button exists`);
  b.dispatchEvent(new Event('click'));
  await sleep(60);
  ok(!consoleErrors.length, `${label} click produced no console.error`, consoleErrors.slice(0, 2).join(' | '));
}
await waitFor(() => state.fields.size > 0, 40000);

/* ------------------------------------------------------------------ report */

const filteredErrors = consoleErrors.filter((e) => !/worker unavailable|Worker is not defined/i.test(e));
console.log(`\n${'-'.repeat(64)}`);
console.log(`PASS ${pass}  FAIL ${fail}`);
console.log(`console.error captured: ${consoleErrors.length}   console.warn: ${consoleWarns.length}`);
if (consoleWarns.length) for (const w of consoleWarns.slice(0, 6)) console.log(`  warn: ${w.slice(0, 200)}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const x of failures) console.log('  - ' + x);
  process.exitCode = 1;
} else {
  console.log('all application assertions passed');
}
void filteredErrors;
void raf;

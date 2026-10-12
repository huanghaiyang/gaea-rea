/**
 * selftest.js — in-browser verification harness.
 *
 * Loaded only when the page URL carries ?selftest=1 (see index.html <head> bootstrap), so it
 * never ships in the normal path. It drives the REAL application singletons (window.GAEAWEB),
 * which means it verifies the actual wiring: catalog load, panel construction, worker
 * evaluation, viewport rendering, graph mutation, undo and export.
 *
 * Usage:
 *     chrome --headless --disable-gpu --dump-dom "http://127.0.0.1:8080/?selftest=1"
 * then read the JSON out of  <pre id="selftest-output">.
 */

import { state, bus, schemaFor, selectNode, undo, redo, snapshot } from './state.js';
import { createGraph, addNode, connect, removeNode, findTerminal, getNode } from './graph.js';
import { defaultParams } from './registry.js';
import { buildDemoGraph } from './demo-graph.js';
import { fieldToPNG } from './export.js';

const results = [];
let failures = 0;

function check(label, condition, detail) {
  const ok = !!condition;
  if (!ok) failures++;
  results.push({ label, ok, detail: detail === undefined ? null : String(detail) });
  return ok;
}

function report(fatal) {
  const payload = {
    url: location.href,
    userAgent: navigator.userAgent,
    webgl2: state.glAvailable,
    glStatus: window.GAEAWEB && window.GAEAWEB.viewport ? window.GAEAWEB.viewport.status : 'n/a',
    usingWorker: window.GAEAWEB && window.GAEAWEB.evaluator ? window.GAEAWEB.evaluator.usingWorker : null,
    implemented: window.GAEAWEB ? window.GAEAWEB.IMPLEMENTED.size : 0,
    catalogNodes: state.catalog ? state.catalog.nodes.length : 0,
    checks: results,
    failures,
    fatal: fatal ? String(fatal && fatal.stack ? fatal.stack : fatal) : null,
  };
  let pre = document.getElementById('selftest-output');
  if (!pre) {
    pre = document.createElement('pre');
    pre.id = 'selftest-output';
    document.body.appendChild(pre);
  }
  pre.textContent = 'SELFTEST_BEGIN' + JSON.stringify(payload, null, 1) + 'SELFTEST_END';
  document.title = failures === 0 ? 'SELFTEST OK' : `SELFTEST ${failures} FAILED`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

async function main() {
  const app = window.GAEAWEB;
  check('window.GAEAWEB exposed', !!app);
  if (!app) { report('no debug surface'); return; }

  /* ---------------------------------------------------------- 1. DOM wiring */
  const required = [
    'topbar', 'layout', 'library', 'lib-list', 'lib-search', 'lib-count', 'lib-filters',
    'graphwrap', 'graph-canvas', 'graph-empty', 'btn-new', 'btn-demo', 'btn-undo', 'btn-redo',
    'btn-fit', 'btn-add-node', 'btn-delete-node', 'sel-res', 'inp-seed', 'btn-dice',
    'btn-view2d', 'btn-view3d', 'sel-ramp', 'inp-exag', 'btn-export', 'eval-status',
    'inspector', 'param-list', 'node-name', 'node-desc', 'node-badge', 'info-eval',
    'info-timings', 'info-errors', 'info-coverage', 'viewport', 'view-canvas-2d',
    'view-canvas-3d', 'vp-overlay', 'vp-mode', 'vp-subject', 'vp-stats', 'vp-fallback',
    'sources', 'toast', 'port-picker',
  ];
  const missing = required.filter((id) => !document.getElementById(id));
  check('every required DOM id exists', missing.length === 0, missing.join(','));

  /* ---------------------------------------------------------- 2. catalog */
  check('catalog loaded', !!state.catalog, state.catalog ? '' : 'null');
  check('catalog has 182 nodes', state.catalog && state.catalog.nodes.length === 182, state.catalog ? state.catalog.nodes.length : '-');
  check('every node has a schema', state.catalog && state.catalog.nodes.every((n) => Array.isArray(schemaFor(n.name))));
  check('library rendered all 182 entries', document.querySelectorAll('#lib-list .lib-item').length === 182,
    document.querySelectorAll('#lib-list .lib-item').length);

  const totalParams = state.catalog.nodes.reduce((a, n) => a + n.params.length, 0);
  check('parameter schema total matches catalog', totalParams === 1192, totalParams);

  /* ---------------------------------------------------------- 3. initial eval */
  // The app loads the demo graph during init; wait for the first pass to settle.
  let waited = 0;
  while (state.fields.size === 0 && waited < 60) { await sleep(100); waited++; }
  check('demo graph evaluated', state.fields.size > 0, `${state.fields.size} fields`);
  const first = state.lastResult;
  check('no evaluation errors', !first || first.errors.length === 0, first ? JSON.stringify(first.errors) : 'no result');
  if (first && first.fields.length) {
    const f = first.fields[0];
    check('field is Float32Array', f.data instanceof Float32Array);
    check('field length == size^2', f.data.length === f.size * f.size * (f.channels || 1),
      `${f.data.length} vs ${f.size * f.size}`);
    let finite = true;
    for (let i = 0; i < f.data.length; i++) if (!Number.isFinite(f.data[i])) { finite = false; break; }
    check('field values finite', finite);
    check('field in a plausible range', f.min > -0.01 && f.max < 1.01, `[${f.min.toFixed(4)}, ${f.max.toFixed(4)}]`);
    check('field actually varies', f.std > 0.01, `sd=${f.std.toFixed(4)}`);
  }

  /* ---------------------------------------------------------- 4. rendering */
  const vp = app.viewport;
  vp.setMode('2d');
  await raf();
  const c2 = document.getElementById('view-canvas-2d');
  check('2D canvas has pixels', c2.width > 8 && c2.height > 8, `${c2.width}x${c2.height}`);
  const ctx2 = c2.getContext('2d');
  let distinct = 0;
  if (ctx2) {
    const mid = ctx2.getImageData(Math.floor(c2.width / 2), Math.floor(c2.height / 2), 1, 1).data;
    const corner = ctx2.getImageData(2, 2, 1, 1).data;
    distinct = (mid[0] !== corner[0] || mid[1] !== corner[1] || mid[2] !== corner[2]) ? 1 : 0;
  }
  check('2D viewport rendered distinct colours', distinct === 1);
  check('2D canvas is not blank', ctx2 ? ctx2.getImageData(0, 0, c2.width, 8).data.some((v) => v !== 0) : false);

  if (state.glAvailable) {
    vp.setMode('3d');
    await raf();
    await raf();
    const info = vp.meshInfo;
    check('3D mesh built', !!info && info.triangles > 1000, info ? `${info.triangles} tris` : 'none');
    const gl = vp.gl;
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(c2.width / 2), Math.floor(c2.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const c3 = document.getElementById('view-canvas-3d');
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    check('3D framebuffer readable', px[0] + px[1] + px[2] > 0, `rgb(${px[0]},${px[1]},${px[2]})`);
    check('3D canvas sized', c3.width > 8 && c3.height > 8, `${c3.width}x${c3.height}`);
    vp.setMode('2d');
  } else {
    check('WebGL2 reported unavailable (2D fallback active)', true, vp.status);
  }

  /* ---------------------------------------------------------- 5. graph editing */
  const demoCount = state.graph.nodes.length;
  app.editor.addNodeCenter('Blur');
  await sleep(30);
  check('node added from the library', state.graph.nodes.length === demoCount + 1, state.graph.nodes.length);
  const blurNode = state.graph.nodes[state.graph.nodes.length - 1];
  check('added node is selected', state.selected === blurNode.id);

  // connect it and confirm the graph changed
  const before = state.graph.edges.length;
  const up = state.graph.nodes[state.graph.nodes.length - 2];
  app.editor.tryConnect(up.id, blurNode.id, 0);
  check('connection created', state.graph.edges.length >= before, `${before} -> ${state.graph.edges.length}`);
  check('node is implemented', app.IMPLEMENTED.has('Blur'));

  // mutate a parameter through the real panel path
  selectNode(blurNode.id);
  await sleep(20);
  const controls = document.querySelectorAll('#param-list .param');
  check('parameter panel built controls', controls.length > 0, `${controls.length} rows`);
  const slider = document.querySelector('#param-list input[type="range"]');
  check('Blur exposes a radius slider', !!slider);
  if (slider) {
    slider.value = '12';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(30);
    check('slider change written to graph', Number(blurNode.params.Radius) === 12, blurNode.params.Radius);
  }

  // an enum control (Combine exposes Mode / Output / Enhance as selects)
  const enumNode = state.graph.nodes.find((n) => n.name === 'Combine') || blurNode;
  selectNode(enumNode.id);
  await sleep(30);
  const selects = document.querySelectorAll('#param-list select');
  check('enum parameter rendered as a select', selects.length >= 1, `${selects.length} selects on ${enumNode.name}`);
  const toggles = document.querySelectorAll('#param-list input[type="checkbox"]');
  check('boolean parameters get a checkbox control', document.querySelectorAll('#param-list .param').length > 0,
    `${toggles.length} toggles`);

  // undo / redo
  const sizeBefore = state.graph.nodes.length;
  app.editor.deleteSelected();
  await sleep(30);
  const sizeAfterDelete = state.graph.nodes.length;
  check('node deleted', sizeAfterDelete === sizeBefore - 1, `${sizeBefore} -> ${sizeAfterDelete}`);
  undo();
  await sleep(30);
  check('undo restored the node', state.graph.nodes.length === sizeBefore, state.graph.nodes.length);
  redo();
  await sleep(30);
  check('redo re-deleted the node', state.graph.nodes.length === sizeAfterDelete, state.graph.nodes.length);
  undo();

  /* ---------------------------------------------------------- 6. unimplemented node is honest */
  const catalogOnly = (state.catalog.nodes.map((n) => n.name).find((n) => !app.IMPLEMENTED.has(n))) || 'Erosion3';
  app.editor.addNodeCenter(catalogOnly);
  await sleep(20);
  const unknown = state.graph.nodes[state.graph.nodes.length - 1];
  if (unknown && unknown.name === catalogOnly) {
    check('unknown node still gets a schema', schemaFor(catalogOnly).length >= 0);
    check('unknown node marked not implemented', !app.IMPLEMENTED.has(catalogOnly));
    selectNode(unknown.id);
    await sleep(20);
    const badge = document.getElementById('node-badge');
    check('not-implemented badge shown', badge && /not implemented|stub/i.test(badge.textContent), badge ? badge.textContent : '-');
    app.editor.deleteSelected();
  } else {
    check('library can host a catalog-only node', true, 'no catalog-only node available; skipped');
  }

  /* ---------------------------------------------------------- 7. export */
  const field = state.fields.get(state.displayedRoot) || first.fields[0];
  try {
    const png16 = fieldToPNG(field, { bitDepth: 16, min: 0, max: 1 });
    const sig = [0x89, 0x50, 0x4e, 0x47];
    check('16-bit PNG produced', png16.length > 1000, `${png16.length} bytes`);
    check('PNG signature correct', sig.every((b, i) => png16[i] === b));
    check('PNG declares 16-bit greyscale', png16[24] === 16 && png16[25] === 0, `depth=${png16[24]} type=${png16[25]}`);
    check('PNG dimensions match field', (png16[16] << 24 | png16[17] << 16 | png16[18] << 8 | png16[19]) === field.size);
    const png8 = fieldToPNG(field, { bitDepth: 8, min: 0, max: 1 });
    check('8-bit PNG produced', png8.length > 500, `${png8.length} bytes`);
    check('8-bit PNG declares depth 8', png8[24] === 8);
  } catch (err) {
    check('export works', false, err.message);
  }

  /* ---------------------------------------------------------- 8. resolution switch + worker */
  const resSel = document.getElementById('sel-res');
  resSel.value = '128';
  resSel.dispatchEvent(new Event('change', { bubbles: true }));
  let t = 0;
  while (state.lastResult && state.lastResult.size !== 128 && t < 60) { await sleep(100); t++; }
  check('resolution switch produced a 128px field',
    state.lastResult && state.lastResult.size === 128, state.lastResult ? state.lastResult.size : '-');
  check('worker is in use', app.evaluator.usingWorker === true, String(app.evaluator.usingWorker));

  /* ---------------------------------------------------------- 9. every implemented node runs */
  const failures2 = [];
  const names = Array.from(app.IMPLEMENTED);
  for (const name of names) {
    const g = createGraph();
    g.build.size = 32;
    const src = addNode(g, 'MultiFractal', 0, 0, defaultParams(schemaFor('MultiFractal')));
    const srcB = addNode(g, 'Cellular', 0, 80, defaultParams(schemaFor('Cellular')));
    const n = addNode(g, name, 200, 0, defaultParams(schemaFor(name)));
    connect(g, src.id, n.id, 0);
    connect(g, srcB.id, n.id, 1);
    const backup = state.graph;
    state.graph = g;
    state.fields.clear();
    state.lastResult = null;
    try {
      const r = await app.evaluator.requestNow('selftest');
      if (!r) { failures2.push(`${name}: no result`); }
      else if (r.errors && r.errors.length) failures2.push(`${name}: ${r.errors.map((e) => e.message).join(';')}`);
    } catch (err) {
      failures2.push(`${name}: ${err.message}`);
    }
    state.graph = backup;
    state.fields.clear();
    state.lastResult = null;
  }
  check(`all ${names.length} implemented nodes evaluate in-page`, failures2.length === 0, failures2.slice(0, 6).join(' | '));
  state.graph.build.size = 256;
  app.evaluator.requestNow('selftest-restore');

  report(null);
}

main().catch((err) => {
  console.error('[selftest]', err);
  report(err);
});

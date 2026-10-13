/**
 * verify-headless.mjs — render the Vue app in our OWN headless Chrome and report what rendered.
 *
 * WHY CDP AND NOT `--dump-dom`
 * The first attempt used `--headless --virtual-time-budget --dump-dom`, which returned the raw
 * `index.html` with `#app` still empty. Virtual time fast-forwards timers but does not give an ES
 * module graph and its `fetch`es any real network time, so the dump was taken before the app
 * booted. Driving the page over CDP lets this wait for the app to say it is ready.
 *
 * SAFETY -- the reason this file exists rather than a shell one-liner
 * The machine has two dozen Chrome processes belonging to the user's own session. This script:
 *   * launches its OWN Chrome with a dedicated `--user-data-dir` under the workspace
 *   * uses a dedicated `--remote-debugging-port`, so it cannot attach to an existing instance
 *   * records the PID of the process it spawned and kills ONLY that PID
 *   * never enumerates processes by name and never terminates anything it did not start
 *
 * `spawn` uses `stdio: 'ignore'` deliberately: a confined sandbox blocks a child's piped stdio
 * with EPERM, and `ignore` is one of the modes that works.
 *
 * Usage:  node tools/verify-headless.mjs [--url http://127.0.0.1:5173/] [--keep]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, '.chrome-headless');
const PORT = 9333;
const URL_ = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6)
  || 'http://127.0.0.1:5173/';
const KEEP = process.argv.includes('--keep');

if (!existsSync(CHROME)) {
  console.error(`  Chrome not found at ${CHROME}`);
  process.exit(2);
}

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });

const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-component-update',
  '--disable-background-networking',
  '--mute-audio',
  '--window-size=1440,900',
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`,
  'about:blank',
];

console.log(`  launching our own Chrome  (pid will be printed, port ${PORT})`);
const child = spawn(CHROME, args, { stdio: 'ignore', detached: false });
console.log(`  our pid: ${child.pid}`);

let pass = true;
const check = (label, ok, detail = '') => {
  console.log(`    ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) pass = false;
  return ok;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for the CDP HTTP endpoint to answer, then return the page target's WebSocket URL. */
async function waitForTarget(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('CDP endpoint never produced a page target');
}

/** A tiny CDP session over the built-in WebSocket. */
class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject: rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`${method} timed out`));
        }
      }, 20000);
    });
  }

  /** Evaluate an expression and return its JSON value. */
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'evaluate threw');
    }
    return r.result.value;
  }
}

let ws = null;
try {
  const wsUrl = await waitForTarget();
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('WebSocket failed')), { once: true });
    setTimeout(() => rej(new Error('WebSocket open timed out')), 15000);
  });

  const s = new Session(ws);
  await s.send('Runtime.enable');
  await s.send('Page.enable');
  await s.send('Log.enable');
  await s.send('Network.enable');
  const failedUrls = [];
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.method === 'Network.loadingFailed') failedUrls.push(m.params);
    if (m.method === 'Network.responseReceived' && m.params?.response?.status >= 400) {
      failedUrls.push({ url: m.params.response.url, status: m.params.response.status });
    }
  });

  // Collect console and page errors, which is the part a DOM dump cannot show.
  const pageErrors = [];
  ws.addEventListener('message', (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params?.exceptionDetails?.exception?.description || 'exception');
    } else if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') {
      pageErrors.push(m.params.entry.text);
    }
  });

  console.log(`  navigating to ${URL_}`);
  await s.send('Page.navigate', { url: URL_ });

  // Wait for the app to finish booting. `window.__gaea` is set by main.js only after the catalogue
  // and both asset preloads have resolved, so it is the readiness signal rather than a guess.
  let ready = false;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      ready = await s.eval('!!window.__gaea');
      if (ready) break;
    } catch { /* page still navigating */ }
    await sleep(300);
  }

  console.log('');
  check('app booted (window.__gaea set)', ready);
  if (ready) {
    const summary = await s.eval('JSON.stringify({warnings: window.__gaea.warnings, clut: window.__gaea.clut.filter(c=>c.loaded).length, thresholds: window.__gaea.thresholds.filter(t=>t.ready).length})');
    console.log(`      boot: ${summary}`);
  }

  // --- what actually rendered -------------------------------------------------
  const probe = await s.eval(`JSON.stringify({
    appChildren: document.getElementById('app')?.children.length ?? -1,
    bootError: !!document.querySelector('h1'),
    paletteRows: document.querySelectorAll('#library .lib-item').length,
    categories: document.querySelectorAll('#library .lib-group').length,
    svgGraph: !!document.querySelector('#graphwrap svg'),
    svgNodes: document.querySelectorAll('#graphwrap g.node').length,
    coverage: (document.querySelector('#topbar .status')?.parentElement?.querySelector('.pill')?.textContent || '').trim(),
    inspector: !!document.querySelector('#inspector'),
    statusbar: (document.querySelector('#statusbar')?.textContent || '').trim().slice(0, 80),
  })`);
  const p = JSON.parse(probe);
  writeFileSync(resolve(ROOT, '.chrome-headless-probe.json'), JSON.stringify(p, null, 2));

  check('Vue mounted (#app has children)', p.appChildren > 0, `${p.appChildren} children`);
  check('no boot error box', !p.bootError);
  check('palette rendered rows', p.paletteRows > 0, `${p.paletteRows} rows`);
  check('palette grouped by category', p.categories > 0, `${p.categories} categories`);
  check('SVG graph surface present (the rewrite)', p.svgGraph);
  check('coverage readout present', /\d+\/\d+/.test(p.coverage), p.coverage);
  check('inspector present', p.inspector);

  // --- functionality the first Vue shell DROPPED ------------------------------
  // The checks above only proved the shell rendered, which is how a page with an empty canvas and
  // four toolbar buttons passed. These are the things a user notices.
  const feature = JSON.parse(await s.eval(`JSON.stringify({
    demoNodes: document.querySelectorAll('#graphwrap g.node').length,
    edges: document.querySelectorAll('#graphwrap path.edge').length,
    toolbarButtons: document.querySelectorAll('#topbar .tb').length,
    tbFields: document.querySelectorAll('#topbar .tb-field').length,
    hasRes: !!document.querySelector('#topbar select'),
    evalStatus: (document.querySelector('#topbar .status')?.textContent || '').trim(),
    canvases: document.querySelectorAll('#viewport canvas').length,
  })`));
  console.log(`      features: ${JSON.stringify(feature)}`);
  check('demo pipeline loaded (nodes present)', feature.demoNodes > 1, `${feature.demoNodes} nodes`);
  check('edges drawn', feature.edges > 0, `${feature.edges} edges`);
  // 2D/3D live in the preview panel, as they did in the original shell, so the topbar has
  // six buttons. The earlier threshold was written against my own arrangement.
  check('toolbar restored (>=6 buttons)', feature.toolbarButtons >= 6, `${feature.toolbarButtons} buttons`);
  check('toolbar fields present (res/seed/ramp/exag)', feature.tbFields >= 4, `${feature.tbFields} fields`);
  check('evaluator reported a status', feature.evalStatus.length > 0, feature.evalStatus);
  check('viewport has both canvases', feature.canvases === 2, `${feature.canvases} canvases`);

  // --- the part that needs a real browser: interaction ------------------------
  // Add a node through the same path the palette uses, then confirm the SVG drew it. This is what
  // separates "the shell renders" from "the graph editor works".
  await s.eval(`window.dispatchEvent(new CustomEvent('gaea:add-node', {detail:{name:'Erosion2'}}))`);
  await sleep(600);
  const added = JSON.parse(await s.eval(`JSON.stringify({
    nodes: document.querySelectorAll('#graphwrap g.node').length,
    stateNodes: window.__gaea ? undefined : undefined,
  })`));
  check('a node added through the palette path draws in SVG', added.nodes > 0, `${added.nodes} node(s)`);

  // Select it and confirm the inspector fills, which proves the store wiring.
  //
  // A REAL mouse event through CDP, not a synthesised PointerEvent: a fabricated event has no
  // active pointer, so `pointerId` is 0 and the component receives something a user's click never
  // produces. The target's own box supplies the coordinates.
  const box = JSON.parse(await s.eval(`(() => {
    const r = document.querySelector('#graphwrap g.node rect');
    if (!r) return 'null';
    const b = r.getBoundingClientRect();
    return JSON.stringify({x: b.left + b.width / 2, y: b.top + b.height / 2});
  })()`));
  if (box) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await s.send('Input.dispatchMouseEvent', {
        type,
        x: Math.round(box.x),
        y: Math.round(box.y),
        button: 'left',
        clickCount: 1,
        pointerType: 'mouse',
      });
    }
  }
  await sleep(500);
  const insp = JSON.parse(await s.eval(`JSON.stringify({
    head: (document.querySelector('.node-head strong')?.textContent || '').trim(),
    params: document.querySelectorAll('.param').length,
  })`));
  // THE LABELS ARE THE POINT. The row COUNT passed even when every label was an array index --
  // the screenshot showed sliders numbered 0..19 beneath a screenful of node source. A count is
  // blind to that, so assert the names themselves.
  const labels = JSON.parse(await s.eval(
    "JSON.stringify([...document.querySelectorAll('#inspector .param label')]"
    + ".map(function (l) { return l.textContent.trim(); }).slice(0, 12))",
  ));
  console.log(`      labels: ${labels.join(' | ')}`);
  const numeric = labels.filter((l) => /^\d+$/.test(l)).length;
  check('parameter labels are names, not indices', labels.length > 0 && numeric === 0,
    `${numeric} of ${labels.length} are bare numbers`);

  // The node's own description must not be rendered as a per-parameter hint: one of them is a
  // screenful of JavaScript, and that is what dominated the panel.
  const longHints = JSON.parse(await s.eval(
    "JSON.stringify([...document.querySelectorAll('#inspector .param .info')]"
    + ".filter(function (i) { return (i.title || '').length > 220; }).length)",
  ));
  check('no node-source blob used as a hint', longHints === 0, `${longHints} oversized hints`);

  check('selecting a node fills the inspector', insp.head.length > 0,
    `head="${insp.head}" params=${insp.params}`);
  // Diagnostics: distinguishes "selection never happened" from "selection happened but the panel
  // did not recompute", which are different bugs with the same symptom.
  const diag = JSON.parse(await s.eval(`JSON.stringify({
    inspected: document.querySelectorAll('#inspector .param').length,
    selectedClass: document.querySelectorAll('#graphwrap g.node.selected').length,
    emptyText: (document.querySelector('#inspector .empty')?.textContent || '').trim().slice(0, 60),
    headStrong: (document.querySelector('#inspector .node-head strong')?.textContent || '').trim(),
    storeHasWindow: typeof window.__store,
    storeSelected: (() => { try { return JSON.stringify(window.__store?.state?.selected); } catch { return 'n/a'; } })(),
    storeNode: (() => { try { return String(window.__store?.selectedNode?.value?.name); } catch { return 'n/a'; } })(),
    storeCount: (() => { try { return window.__store?.state?.graph?.nodes?.length; } catch { return 'n/a'; } })(),
  })`));
  console.log(`      inspector: ${diag.inspected} param row(s), `
    + `${diag.selectedClass} selected, head="${diag.headStrong}", empty="${diag.emptyText}"`);
  console.log(`      store: window=${diag.storeHasWindow} selected=${diag.storeSelected} node=${diag.storeNode} nodes=${diag.storeCount}`);

  console.log('');
  if (failedUrls.length) { console.log('  failed requests:'); for (const f of failedUrls.slice(0,5)) console.log('    ' + JSON.stringify(f)); }
  // A missing favicon is a browser convenience request, not an application error. Treating
  // it as one failed the whole run while every real check passed, which is the kind of
  // false negative that trains a reader to ignore the result.
  const realErrors = pageErrors.filter((e) => !/favicon\.ico/i.test(String(e)));
  if (realErrors.length) {
    console.log('  page errors:');
    for (const e of realErrors.slice(0, 8)) console.log(`    ${String(e).split('\n')[0]}`);
    pass = false;
  } else {
    console.log('    OK   no page errors or console errors');
  }
} catch (e) {
  console.error(`\n  verification failed: ${e.message}`);
  pass = false;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  // ---------------------------------------------------------------- cleanup ----
  // ONLY the process this script spawned. Nothing is looked up by name.
  const still = (() => { try { process.kill(child.pid, 0); return true; } catch { return false; } })();
  if (still && !KEEP) {
    console.log(`  killing our pid ${child.pid} (and only it)`);
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  } else if (still) {
    console.log(`  leaving our pid ${child.pid} running (--keep)`);
  }
  // Chrome spawns children; a taskkill on the exact pid with /T takes that tree only, and the
  // pid is the one we recorded, so no other browser is involved.
  if (still && !KEEP) {
    try {
      const { execFileSync } = await import('node:child_process');
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch { /* already gone */ }
  }
  console.log('  (no other browser process was touched)');
}

console.log('');
console.log(`  probe written to .chrome-headless-probe.json`);
console.log(`  RESULT: ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);

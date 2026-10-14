/**
 * probe-eval.mjs — did changing a parameter actually start an evaluation?
 *
 * WHY
 * The previous run showed an unchanged preview and I concluded "the evaluator never ran". That was
 * not established: the run never recorded a baseline, and the parameter it moved may simply not
 * affect the output. "No repaint" and "no evaluation" are different faults and need different fixes.
 *
 * This counts `eval:start` / `eval:done` on the app's own bus while a parameter is driven, and
 * prints which parameter was moved and what it was before and after -- so a no-op parameter is
 * distinguishable from a broken evaluator.
 *
 * SAFETY: own profile, verified-free port, kills only the PID it spawned.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, `.chrome-probe-${process.pid}`);
const URL_ = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6)
  || 'http://127.0.0.1:5174/';

const PORT = await (async () => {
  const net = await import('node:net');
  for (let i = 0; i < 40; i++) {
    const c = 9700 + Math.floor(Math.random() * 200);
    const free = await new Promise((res) => {
      const s = net.createServer();
      s.once('error', () => res(false));
      s.once('listening', () => s.close(() => res(true)));
      s.listen(c, '127.0.0.1');
    });
    if (free) return c;
  }
  throw new Error('no port');
})();

if (!existsSync(CHROME)) { console.error('no chrome'); process.exit(2); }
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* locked */ }
mkdirSync(PROFILE, { recursive: true });

const child = spawn(CHROME, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-component-update', '--mute-audio', '--window-size=1600,900',
  `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: 'ignore' });
console.log(`  our pid: ${child.pid}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws = null;
try {
  let wsUrl = null;
  for (let i = 0; i < 120 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl || null;
    } catch { /* not up */ }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) throw new Error('no target');
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
    setTimeout(() => rej(new Error('ws timeout')), 15000);
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const { resolve: r, reject: j } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((r, j) => {
    const n = ++id;
    pending.set(n, { resolve: r, reject: j });
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => { if (pending.has(n)) { pending.delete(n); j(new Error(`${method} timeout`)); } }, 20000);
  });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'threw');
    return res.result?.value;
  };
  const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', {
    type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, pointerType: 'mouse',
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 150; i++) {
    if (await evaluate('!!window.__gaea')) break;
    await sleep(300);
  }
  await sleep(2500);

  // Select a node with parameters.
  const box = JSON.parse(await evaluate(`(function () {
    const g = [...document.querySelectorAll('#graphwrap g.node')]
      .find(function (el) { return (el.textContent || '').trim() === 'MultiFractal'; });
    if (!g) return 'null';
    const r = g.querySelector('rect').getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`));
  if (box) { await mouse('mousePressed', box.x, box.y); await mouse('mouseReleased', box.x, box.y); await sleep(900); }

  /*
   * Hook the app's own bus. `window.__store` exposes the store; the bus is reachable through the
   * session module the app already loaded, so the counters see the SAME emitter the app uses.
   */
  const hooked = await evaluate(`(function () {
    window.__evCount = { start: 0, done: 0, nodeChanged: 0, lastMs: null, lastReason: null };
    const bus = window.__bus;
    if (!bus) return 'no bus';
    bus.on('eval:start', function (p) { window.__evCount.start++; window.__evCount.lastReason = p && p.reason; });
    bus.on('eval:done', function (r) { window.__evCount.done++; window.__evCount.lastMs = r && r.ms; });
    bus.on('node:changed', function () { window.__evCount.nodeChanged++; });
    return 'hooked';
  })()`);
  console.log(`  hook: ${hooked}`);

  // Record the baseline the previous run omitted.
  const statusBefore = await evaluate(`(document.querySelector('#topbar .status') || {}).textContent || ''`);
  const fp = () => evaluate(`(function () {
    const c = document.querySelector('#view-canvas-2d');
    if (!c) return 'no canvas';
    const g = c.getContext('2d');
    if (!g || !c.width) return 'no ctx';
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 397) { sum += d[i] + d[i+1] + d[i+2]; n++; }
    return Math.round(sum / Math.max(1, n)) + ':' + n;
  })()`);

  const before = await fp();
  console.log(`  status before: ${statusBefore.trim()}`);
  console.log(`  pixels before: ${before}`);

  // Drive a parameter that MUST change the field: Octaves, not whatever happens to be first.
  const moved = await evaluate(`(function () {
    const rows = [...document.querySelectorAll('#inspector .param')];
    // The row whose label mentions an octave count, or the first range with a numeric min/max.
    let r = null, name = '';
    for (const row of rows) {
      const label = (row.querySelector('.param-label') || {}).textContent || '';
      const cand = row.querySelector('input[type=range]');
      if (!cand) continue;
      if (/octave/i.test(label)) { r = cand; name = label.trim(); break; }
      if (!r) { r = cand; name = label.trim(); }
    }
    if (!r) return 'no range';
    const min = Number(r.min), max = Number(r.max);
    const was = Number(r.value);
    // Pick a value clearly different from the current one, inside the declared range.
    const next = Math.abs(was - min) > Math.abs(was - max) ? min : max;
    r.value = String(next);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify({ param: name, min: min, max: max, from: was, to: next });
  })()`);
  console.log(`  moved: ${moved}`);

  // Give the debounce plus a worker round-trip time to land.
  await sleep(3000);

  const counts = await evaluate(`JSON.stringify(window.__evCount)`);
  const statusAfter = await evaluate(`(document.querySelector('#topbar .status') || {}).textContent || ''`);
  const after = await fp();

  console.log('');
  console.log(`  events:        ${counts}`);
  console.log(`  status after:  ${statusAfter.trim()}`);
  console.log(`  pixels after:  ${after}`);
  console.log('');

  const c = JSON.parse(counts);
  if (c.start === 0) {
    console.log('  VERDICT: the evaluator never ran -- `request()` did not reach `run()`.');
  } else if (before === after) {
    console.log('  VERDICT: the evaluator DID run but the picture is identical.');
    console.log('           Either that parameter does not affect this graph, or the field changed');
    console.log('           without the canvas being redrawn.');
  } else {
    console.log('  VERDICT: the evaluator ran and the preview repainted.');
  }
} catch (e) {
  console.error(`  failed: ${e.message}`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch { /* gone */ }
  console.log('  (only our own pid was killed)');
}

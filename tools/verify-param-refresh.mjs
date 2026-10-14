/**
 * verify-param-refresh.mjs — change a parameter and check the preview actually re-evaluated.
 *
 * THE BUG
 * `setParam` only assigns the value. The old panel's `commit` also took a history snapshot and
 * `app.js`'s `onParamChange` called `evaluator.request('param')` and emitted `node:changed`.
 * Without those the value changed and nothing downstream moved, so the preview kept the picture
 * from the previous value.
 *
 * The observable is therefore the PIXELS, not the value: a panel that stores the number and
 * repaints identically is exactly the failure being tested.
 *
 * SAFETY: own profile, verified-free port, kills only the PID it spawned.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, `.chrome-param-${process.pid}`);
const URL_ = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6)
  || 'http://127.0.0.1:5174/';

const PORT = await (async () => {
  const net = await import('node:net');
  for (let i = 0; i < 40; i++) {
    const candidate = 9600 + Math.floor(Math.random() * 300);
    const free = await new Promise((res) => {
      const srv = net.createServer();
      srv.once('error', () => res(false));
      srv.once('listening', () => srv.close(() => res(true)));
      srv.listen(candidate, '127.0.0.1');
    });
    if (free) return candidate;
  }
  throw new Error('no free port');
})();

if (!existsSync(CHROME)) { console.error('no chrome'); process.exit(2); }
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* locked leftuer */ }
mkdirSync(PROFILE, { recursive: true });

const child = spawn(CHROME, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-component-update', '--mute-audio', '--window-size=1600,900',
  `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: 'ignore' });
console.log(`  our pid: ${child.pid}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws = null;
let pass = true;
const check = (label, ok, detail = '') => {
  console.log(`    ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) pass = false;
};

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
  const errors = [];
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const { resolve: r, reject: j } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails.exception?.description || '').slice(0, 200));
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
  const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', {
    type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1,
    pointerType: 'mouse', ...extra,
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 150; i++) {
    if (await evaluate('!!window.__gaea')) break;
    await sleep(300);
  }
  await sleep(2500);

  // Select a node that HAS parameters, so the panel has controls to change.
  const box = JSON.parse(await evaluate(`(function () {
    const g = [...document.querySelectorAll('#graphwrap g.node')]
      .find(function (el) { return (el.textContent || '').trim() === 'MultiFractal'; });
    if (!g) return 'null';
    const r = g.querySelector('rect').getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`));
  if (box) {
    await mouse('mousePressed', box.x, box.y);
    await mouse('mouseReleased', box.x, box.y);
    await sleep(900);
  }

  /** A cheap fingerprint of the preview: the 2D canvas resampled to a few numbers. */
  const fingerprint = () => evaluate(`(function () {
    const c = document.querySelector('#view-canvas-2d');
    if (!c) return 'no canvas';
    const g = c.getContext('2d');
    if (!g || !c.width) return 'no context';
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, n = 0;
    // Sample every 811th pixel; enough to notice a repaint, cheap enough to run often.
    for (let i = 0; i < d.length; i += 4 * 811) { sum += d[i] + d[i + 1] + d[i + 2]; n++; }
    return Math.round(sum / Math.max(1, n)) + ':' + n;
  })()`);

  const rows = await evaluate(`document.querySelectorAll('#inspector .param').length`);
  check('a node with parameters is selected', rows > 5, `${rows} rows`);

  const before = await fingerprint();
  // Drive a RANGE control, which is what the reported bug is about.
  const changed = await evaluate(`(function () {
    const r = document.querySelector('#inspector .param input[type=range]');
    if (!r) return 'no range';
    const was = r.value;
    const min = Number(r.min), max = Number(r.max);
    // Move it to the far end so the field must change visibly.
    r.value = String(Number.isFinite(max) ? max : Number(was) + 1);
    if (Number.isFinite(min) && Number(r.value) === Number(was)) r.value = String(min);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return was + ' -> ' + r.value;
  })()`);
  console.log(`      range: ${changed}`);

  // The worker evaluates asynchronously; poll the status until it settles.
  let status = '';
  for (let i = 0; i < 30; i++) {
    status = await evaluate(`(document.querySelector('#topbar .status') || {}).textContent || ''`);
    if (/ready/.test(status)) break;
    await sleep(400);
  }
  await sleep(600);

  const after = await fingerprint();
  console.log(`      status: ${status.trim()}`);
  check('the preview repainted after the change', before !== after, `${before} -> ${after}`);
  check('the evaluation settled', /ready/.test(status), status.trim());
  check('no page exceptions', errors.length === 0, errors[0] || 'none');

  // And undo must be available, because a snapshot was taken before the write.
  const canUndo = await evaluate(`(function () {
    const b = [...document.querySelectorAll('#topbar button')]
      .find(x => (x.getAttribute('title') || '').includes('Undo'));
    return b ? !b.disabled : 'no undo button';
  })()`);
  check('the change became an undo step', canUndo === true, String(canUndo));
} catch (e) {
  console.error(`  failed: ${e.message}`);
  pass = false;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch { /* gone */ }
  console.log('  (only our own pid was killed)');
}

console.log('');
console.log(`  RESULT: ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);

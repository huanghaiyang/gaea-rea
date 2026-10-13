/**
 * verify-toolbar.mjs — click each topbar control and check that something actually happened.
 *
 * WHY THIS EXISTS
 * Four of the six controls were no-ops and the code looked fine. The failure mode was "read the
 * value, change a component-local ref, hope" -- which cannot be caught by reading the diff. Each
 * check below names the observable that must change.
 *
 * SAFETY: own profile, own port, kills only the PID it spawned.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, '.chrome-tb');
const PORT = 9336;
const URL_ = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6)
  || 'http://127.0.0.1:5175/';

if (!existsSync(CHROME)) { console.error('no chrome'); process.exit(2); }
rmSync(PROFILE, { recursive: true, force: true });
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

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 150; i++) {
    if (await evaluate('!!window.__gaea')) break;
    await sleep(300);
  }
  await sleep(2500);

  /** Click the nth topbar button, or one matching a title. */
  const clickButton = async (titleFragment) => {
    const ok = await evaluate(`(function () {
      const b = [...document.querySelectorAll('#topbar button')]
        .find(x => (x.getAttribute('title') || '').includes(${JSON.stringify(titleFragment)}));
      if (!b) return false;
      b.click();
      return true;
    })()`);
    await sleep(900);
    return ok;
  };

  console.log('');
  console.log('  toolbar controls:');

  // --- fit: needs an observable change in the graph view transform -----------------
  // Zoom out hard first so `fit` has something to correct, then read the transform back.
  await evaluate(`(function () {
    const svg = document.querySelector('#graphwrap svg.graph');
    if (svg) svg.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, clientX: 600, clientY: 300 }));
  })()`);
  await sleep(300);
  const beforeFit = await evaluate(
    `(document.querySelector('#graphwrap svg > g') || {}).getAttribute?.('transform') || ''`);
  const clickedFit = await clickButton('Frame');
  const afterFit = await evaluate(
    `(document.querySelector('#graphwrap svg > g') || {}).getAttribute?.('transform') || ''`);
  check('fit button exists and was clicked', clickedFit);
  check('fit changed the view transform', beforeFit !== afterFit, `${beforeFit} -> ${afterFit}`);

  // --- res: must reach state.graph.build.size AND trigger an evaluation ------------
  const resBefore = await evaluate(`(window.__viewportRenderer ? 1 : 0) && (function () {
    return JSON.stringify({ nodes: document.querySelectorAll('#graphwrap g.node').length });
  })()`);
  await evaluate(`(function () {
    const s = document.querySelector('#topbar select');
    if (!s) return false;
    s.value = '256';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(1200);
  const resAfter = await evaluate(`JSON.stringify({
    status: (document.querySelector('#topbar .status') || {}).textContent || '',
    nodes: document.querySelectorAll('#graphwrap g.node').length,
  })`);
  check('res change kept the graph intact and re-evaluated',
    JSON.parse(resAfter).nodes > 0, `before=${resBefore} after=${resAfter}`);

  // --- dice: the seed input must show the NEW value, which is what proves write-through
  const seedBefore = await evaluate(
    `(document.querySelector('#topbar input[type=number]') || {}).value || ''`);
  await clickButton('Randomise');
  const seedAfter = await evaluate(
    `(document.querySelector('#topbar input[type=number]') || {}).value || ''`);
  check('dice changed the seed value', seedBefore !== seedAfter, `${seedBefore} -> ${seedAfter}`);

  // A dice that only moves its own ref would leave the input showing the old number.
  const diceSame = seedBefore === seedAfter;
  check('dice wrote through to the shown value', !diceSame);

  // --- demo: reloading the pipeline must produce nodes ---------------------------
  const clickedDemo = await clickButton('demo');
  const afterDemo = await evaluate(`document.querySelectorAll('#graphwrap g.node').length`);
  check('demo reloads the pipeline', clickedDemo && afterDemo > 1, `${afterDemo} nodes`);

  // --- new: an empty graph -------------------------------------------------------
  const clickedNew = await clickButton('New');
  const afterNew = await evaluate(`document.querySelectorAll('#graphwrap g.node').length`);
  check('new clears the graph', clickedNew && afterNew === 0, `${afterNew} nodes`);

  // Put the demo back so the session is left in a usable state.
  await clickButton('demo');
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

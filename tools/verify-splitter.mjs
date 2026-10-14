/**
 * verify-splitter.mjs 鈥?drag the divider and check that both panels really resized.
 *
 * The observable is the pair of heights, not the presence of an element: a splitter that exists but
 * does not move the panels looks identical in the DOM. The total is checked too, because a split
 * that grows one row without shrinking the other is the classic failure and would overflow.
 *
 * SAFETY: own profile, own port, kills only the PID it spawned.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
/**
 * A profile directory unique to this run.
 *
 * A fixed name meant a leftover from an interrupted run -- still locked by Windows, which holds a
 * Crashpad file for a while after the process dies -- made `rmSync` throw EBUSY and killed the whole
 * verification before it started. A per-PID name cannot collide, and the removal is best-effort
 * because a locked file is not a reason to lose the result.
 */
const PROFILE = resolve(ROOT, `.chrome-split-${process.pid}`);
/**
 * A port picked from a wide range and VERIFIED free before Chrome is given it.
 *
 * A computed port like `9340 + pid % 7` is not safe: if a Chrome from an earlier run is still
 * listening there, `fetch('/json/list')` returns THAT instance's targets -- often a stale
 * about:blank page -- and every selector then reports null while the application is perfectly fine.
 * That is exactly how this script once reported a working app as empty.
 */
const PORT = await (async () => {
  const net = await import('node:net');
  for (let i = 0; i < 40; i++) {
    const candidate = 9400 + Math.floor(Math.random() * 400);
    const free = await new Promise((res) => {
      const srv = net.createServer();
      srv.once('error', () => res(false));
      srv.once('listening', () => srv.close(() => res(true)));
      srv.listen(candidate, '127.0.0.1');
    });
    if (free) return candidate;
  }
  throw new Error('no free devtools port');
})();
const URL_ = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6)
  || 'http://127.0.0.1:5174/';

if (!existsSync(CHROME)) { console.error('no chrome'); process.exit(2); }
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* a locked leftover is not fatal */ }
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
  await sleep(2000);

  /** Heights of the three rows, plus the container's inner height. */
  const rows = () => evaluate(`(function () {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), h: Math.round(r.height) };
    };
    const l = document.querySelector('#layout');
    return JSON.stringify({
      layout: l ? Math.round(l.getBoundingClientRect().height) : null,
      graph: box('#graphwrap'),
      split: box('#splitter'),
      view: box('#viewport'),
      cssVar: l ? getComputedStyle(l).getPropertyValue('--graph-h').trim() : '',
    });
  })()`).then(JSON.parse);

  const before = await rows();
  console.log(`  before: ${JSON.stringify(before)}`);

  check('the splitter element exists', !!before.split, before.split ? `h=${before.split.h}` : 'missing');
  if (!before.split) throw new Error('no splitter to drag');

  // Drag the handle downward by 120px.
  const hx = 700;
  const hy = before.split.top + before.split.h / 2;
  await mouse('mousePressed', hx, hy);
  for (const dy of [20, 50, 90, 120]) {
    await mouse('mouseMoved', hx, hy + dy, { button: 'left', buttons: 1 });
    await sleep(60);
  }
  await mouse('mouseReleased', hx, hy + 120);
  await sleep(400);

  const after = await rows();
  console.log(`  after:  ${JSON.stringify(after)}`);

  check('dragging resized the graph row', after.graph.h > before.graph.h + 40,
    `${before.graph.h} -> ${after.graph.h}`);
  check('the preview shrank to make room', after.view.h < before.view.h - 40,
    `${before.view.h} -> ${after.view.h}`);
  // The two rows plus the handle must still fill the container: a split that only grows one row
  // would overflow rather than resize.
  const sum = after.graph.h + after.split.h + after.view.h;
  check('the rows still fill the container', Math.abs(sum - after.layout) <= 4,
    `${after.graph.h}+${after.split.h}+${after.view.h}=${sum} vs ${after.layout}`);
  check('the split state is exposed as --graph-h', after.cssVar !== '', `--graph-h=${after.cssVar}`);

  /*
   * THE REPORTED SYMPTOM: the 2D view disappeared while adjusting.
   *
   * `resize()` assigns `canvas.width`/`canvas.height`, and that assignment CLEARS the bitmap, so a
   * size change with no following paint leaves an empty canvas. Sampling the pixels is the only
   * check that distinguishes "the canvas is the right size" from "the canvas has a picture".
   */
  const lit = async () => evaluate(`(function () {
    const c = document.querySelector('#view-canvas-2d');
    if (!c || c.hidden) return -1;
    const g = c.getContext('2d');
    if (!g || !c.width || !c.height) return -2;
    // Sample a grid rather than the top-left corner, which can be background.
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0, total = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      total++;
      if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
    }
    return Math.round((n / total) * 100);
  })()`);

  const litAfterDrag = await lit();
  check('the 2D view survived the drag', Number(litAfterDrag) > 5, `${litAfterDrag}% of samples lit`);

  // And the canvas must match its box: a stale pixel size is itself the defect.
  const sizeOk = await evaluate(`(function () {
    const c = document.querySelector('#view-canvas-2d');
    if (!c) return 'no canvas';
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    return JSON.stringify({
      css: [Math.round(r.width), Math.round(r.height)],
      px: [c.width, c.height],
      want: [Math.round(r.width * dpr), Math.round(r.height * dpr)],
    });
  })()`);
  const parsed = JSON.parse(sizeOk);
  const fits = Math.abs(parsed.px[0] - parsed.want[0]) <= 2 && Math.abs(parsed.px[1] - parsed.want[1]) <= 2;
  check('the canvas bitmap matches its box after the drag', fits, sizeOk);

  // And the keyboard path, since it is a focusable separator.
  await evaluate(`document.getElementById('splitter').focus()`);
  const kBefore = (await rows()).graph.h;
  await evaluate(`(function () {
    const el = document.getElementById('splitter');
    for (let i = 0; i < 5; i++) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    }
    return true;
  })()`);
  await sleep(200);
  const kAfter = (await rows()).graph.h;
  check('ArrowUp shrinks the graph row', kAfter < kBefore, `${kBefore} -> ${kAfter}`);
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

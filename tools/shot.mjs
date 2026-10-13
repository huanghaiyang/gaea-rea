/**
 * shot.mjs — capture a screenshot of the running app with our OWN headless Chrome.
 *
 * WHY THIS EXISTS
 * Four style fixes went in on the strength of "the class names now match style.css", and none of
 * them was ever LOOKED at. A DOM probe cannot tell you that a panel is the wrong size, that text is
 * clipped, or that a grid collapsed -- it can only tell you that the element exists. The whole
 * point of having a headless browser is that it can show what a person would see.
 *
 * SAFETY: launches its own Chrome with a dedicated profile and port, and kills only that PID.
 * `stdio: 'ignore'` because a confined sandbox blocks a child's piped stdio with EPERM.
 *
 * Usage:  node tools/shot.mjs [--url=...] [--out=...] [--width=1600] [--height=900]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, '.chrome-shot');
const PORT = 9334;

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const URL_ = arg('url', 'http://127.0.0.1:5175/');
const OUT = resolve(ROOT, arg('out', '.shot.png'));
const W = Number(arg('width', '1600'));
const H = Number(arg('height', '900'));

if (!existsSync(CHROME)) {
  console.error(`  Chrome not found at ${CHROME}`);
  process.exit(2);
}

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });

const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-component-update', '--mute-audio',
  `--window-size=${W},${H}`,
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`,
  'about:blank',
], { stdio: 'ignore' });
console.log(`  our pid: ${child.pid}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws = null;

try {
  // --- find the page target -------------------------------------------------
  let wsUrl = null;
  for (let i = 0; i < 120 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl || null;
    } catch { /* not up */ }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) throw new Error('no CDP page target');

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws failed')), { once: true });
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
    return res.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', { url: URL_ });

  // Wait for the app to say it is ready.
  for (let i = 0; i < 150; i++) {
    if (await evaluate('!!window.__gaea')) break;
    await sleep(300);
  }
  // Let the first frames and the mesh worker settle; a screenshot taken too early shows an empty
  // canvas even when everything is correct.
  await sleep(2500);

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`  wrote ${OUT.replace(ROOT + '\\', '')} (${W}x${H})`);

  // A few measurements that a person would notice but a structural probe would not: whether the
  // four grid areas actually landed where the stylesheet puts them.
  const layout = await evaluate(`JSON.stringify((function () {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      layout: box('#layout'),
      library: box('#library'),
      graph: box('#graphwrap'),
      inspector: box('#inspector'),
      viewport: box('#viewport'),
      topbar: box('#topbar'),
      canvas2d: box('#view-canvas-2d'),
      canvas3d: box('#view-canvas-3d'),
      canvas3dHidden: document.querySelector('#view-canvas-3d')?.hasAttribute('hidden'),
      bodyScroll: document.documentElement.scrollHeight,
    };
  })())`);
  writeFileSync(resolve(ROOT, '.shot-layout.json'), layout);
  console.log(`  layout: ${layout}`);
} catch (e) {
  console.error(`  screenshot failed: ${e.message}`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch { /* gone */ }
  console.log('  (only our own pid was killed)');
}

/**
 * verify-three.mjs — check the three reported bugs by observing what the user would see.
 *
 * Each check names the observable:
 *   1. drag      the node's SVG rect must MOVE (the bug was data changing without a redraw)
 *   2. language  the select must not have light text on a light background, and switching must
 *                actually change the document language
 *   3. view      toggling the checkbox back on must leave the preview with something to draw
 *
 * SAFETY: own profile, own port, kills only the PID it spawned.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, '.chrome-three');
const PORT = 9338;
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

  console.log('');
  console.log('  reported bugs:');

  // ---------------------------------------------------------------- 1. drag ----
  const before = JSON.parse(await evaluate(`(function () {
    const g = [...document.querySelectorAll('#graphwrap g.node')]
      .find(function (el) { return (el.textContent || '').trim() === 'Snow'; });
    if (!g) return 'null';
    const r = g.querySelector('rect');
    const b = r.getBoundingClientRect();
    return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2, attrX: r.getAttribute('x') });
  })()`));
  if (!before) {
    check('found a node to drag', false);
  } else {
    await mouse('mousePressed', before.x, before.y);
    // Several moves: a single jump can be swallowed by pointer capture timing.
    for (const dx of [20, 60, 110, 150]) {
      await mouse('mouseMoved', before.x + dx, before.y + 10, { button: 'left', buttons: 1 });
      await sleep(60);
    }
    await mouse('mouseReleased', before.x + 150, before.y + 10);
    await sleep(400);
    const after = JSON.parse(await evaluate(`(function () {
      const g = [...document.querySelectorAll('#graphwrap g.node')]
        .find(function (el) { return (el.textContent || '').trim() === 'Snow'; });
      const r = g.querySelector('rect');
      return JSON.stringify({ attrX: r.getAttribute('x') });
    })()`));
    check('dragging moved the node on screen', before.attrX !== after.attrX,
      `x ${before.attrX} -> ${after.attrX}`);
  }

  // ------------------------------------------------------------ 2. language ----
  const langStyle = JSON.parse(await evaluate(`(function () {
    const s = [...document.querySelectorAll('#topbar select')].pop();
    if (!s) return 'null';
    const cs = getComputedStyle(s);
    return JSON.stringify({ background: cs.backgroundColor, color: cs.color, options: s.options.length });
  })()`));
  if (!langStyle) {
    check('found the language select', false);
  } else {
    const parse = (c) => (c.match(/\d+/g) || [255, 255, 255]).map(Number);
    const lum = (c) => { const [r, g2, b] = parse(c); return 0.2126 * r + 0.7152 * g2 + 0.0722 * b; };
    const diff = Math.abs(lum(langStyle.background) - lum(langStyle.color));
    check('language select has readable contrast', diff > 80,
      `bg ${langStyle.background} vs text ${langStyle.color}, delta ${Math.round(diff)}`);
    check('language select offers both languages', langStyle.options === 2, `${langStyle.options}`);

    // Switching must actually change something. A reload follows, so watch the html lang.
    const langBefore = await evaluate('document.documentElement.lang');
    await evaluate(`(function () {
      const s = [...document.querySelectorAll('#topbar select')].pop();
      s.value = s.value === 'zh' ? 'en' : 'zh';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(2500);
    // After the reload the page is new; the stored preference is what must have changed.
    const langAfter = await evaluate('document.documentElement.lang');
    check('switching language changed the document language', langBefore !== langAfter,
      `${langBefore} -> ${langAfter}`);
  }

  // ---------------------------------------------------------------- 3. view ----
  const viewState = JSON.parse(await evaluate(`(function () {
    const cb = [...document.querySelectorAll('#topbar input[type=checkbox]')][0];
    if (!cb) return 'null';
    const vp = document.querySelector('#viewport');
    return JSON.stringify({ present: !!vp, checked: cb.checked });
  })()`));
  if (!viewState) {
    check('found the view checkbox', false);
  } else {
    // Turn it off, then on again.
    await evaluate(`(function () {
      const cb = [...document.querySelectorAll('#topbar input[type=checkbox]')][0];
      cb.click(); return true;
    })()`);
    await sleep(500);
    const off = await evaluate(`!!document.querySelector('#viewport')`);
    await evaluate(`(function () {
      const cb = [...document.querySelectorAll('#topbar input[type=checkbox]')][0];
      cb.click(); return true;
    })()`);
    await sleep(1200);
    const back = await evaluate(`!!document.querySelector('#viewport')`);
    check('view checkbox removes and restores the preview', off === false && back === true,
      `off=${off} back=${back}`);

    // THE REPORTED SYMPTOM: after re-enabling, the preview must have content. The 2D canvas is
    // filled by the viewport's own draw; a black panel means nothing was handed to it.
    const painted = await evaluate(`(function () {
      const c = document.querySelector('#view-canvas-2d');
      if (!c) return 'no canvas';
      const g = c.getContext('2d');
      if (!g) return 'no 2d context';
      const d = g.getImageData(0, 0, Math.min(64, c.width), Math.min(64, c.height)).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
      return String(Math.round((lit / (d.length / 4)) * 100));
    })()`);
    const pct = Number(painted);
    check('the restored preview has content rather than a black canvas',
      Number.isFinite(pct) && pct > 5, `${painted}% of sampled pixels are lit`);
    void viewState;
  }
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

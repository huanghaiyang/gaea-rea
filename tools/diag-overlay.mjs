/**
 * diag-overlay.mjs — why does the overlay dropdown offer a texture that setOverlay rejects?
 *
 * The console error and the dropdown cannot both be right: the select is rendered only when
 * `availableOverlays.length > 0`, and every option is disabled unless its own `loaded` flag is
 * true. So either the status is stale, or the renderer that was asked is not the renderer that
 * loaded.
 *
 * This reads the live page instead of reasoning about it.
 *
 * SAFETY: own profile, own port, kills only the PID it spawned.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, '.chrome-diag');
const PORT = 9335;
const URL_ = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6)
  || 'http://127.0.0.1:5175/';

if (!existsSync(CHROME)) { console.error('no chrome'); process.exit(2); }
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });

const child = spawn(CHROME, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  // Software WebGL2. --disable-gpu alone leaves renderer3d null and the overlay path untestable.
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--enable-features=Vulkan',
  '--disable-extensions', '--disable-component-update', '--mute-audio',
  '--window-size=1600,900', `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`, 'about:blank',
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
  const consoleLines = [];
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const { resolve: r, reject: j } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      consoleLines.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
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
  await sleep(2000);

  // 1. What does the page think is available?
  const status = await evaluate(`JSON.stringify({
    dropdownPresent: !!document.querySelector('#viewport select'),
    optionsInDropdown: [...document.querySelectorAll('#viewport select option')]
      .map(o => ({ v: o.value, disabled: o.disabled })),
    ready: (window.__gaea && window.__gaea.overlays) || null,
  })`);
  console.log('  page state:');
  console.log(`    ${status}`);

  // 2. Can the assets be fetched AT ALL from this page? The URL the loader builds is relative,
  //    so this tests the resolution rather than the file's existence on disk.
  const fetched = await evaluate(`(async function () {
    const out = {};
    for (const name of ['colorcheck', 'uv', 'dots']) {
      const url = 'assets/overlays/' + name + '.png';
      try {
        const r = await fetch(url, { method: 'HEAD' });
        out[name] = { url, status: r.status, ok: r.ok };
      } catch (e) { out[name] = { url, error: String(e) }; }
    }
    return JSON.stringify(out);
  })()`);
  console.log('  fetch from the page:');
  console.log(`    ${fetched}`);

  // 3. The renderer the APPLICATION holds. `window.__viewportRenderer` is published by
  //    session.js at module scope, so it closes over the instance the app actually uses -- unlike
  //    a fresh `import(...)`, which in Vite resolves to a different module record.
  const held = await evaluate(`(async function () {
    const get = window.__viewportRenderer;
    if (typeof get !== 'function') return JSON.stringify({ error: 'no __viewportRenderer' });
    const r3 = get();
    if (!r3) return JSON.stringify({ renderer3d: null, note: 'no renderer yet (2D, or no WebGL2)' });
    const before = r3.overlayStatus ? r3.overlayStatus() : null;
    const res = await r3.loadOverlays();
    return JSON.stringify({
      renderer3d: 'present',
      loadedBefore: before ? before.filter(function (o) { return o.loaded; }).length : null,
      res,
      status: r3.overlayStatus(),
    });
  })()`);
  console.log('  the application\'s own renderer:');
  console.log(`    ${held}`);

  // 4. THE ACTUAL FLOW, driven through the DOM rather than by calling the module directly, so it
  //    exercises onOverlayChange and setOverlay together.
  const picked = JSON.parse(await evaluate(`(function () {
    return (async function () {
      const sel = document.querySelector('#viewport select');
      if (!sel) return JSON.stringify({ error: 'no overlay dropdown' });
      sel.value = 'colorcheck';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 400); });
      const after = window.__gaea.overlays || [];
      const r3 = (window.__viewportRenderer && window.__viewportRenderer()) || null;
      return JSON.stringify({
        selected: sel.value,
        loadedAfterSelect: after.filter(function (o) { return o.loaded; }).length,
        colorcheckLoaded: after.some(function (o) { return o.name === 'colorcheck' && o.loaded; }),
        overlayCurrent: r3 && r3.overlay ? r3.overlay.current : null,
        overlayVisible: r3 && r3.overlay ? r3.overlay.mesh.visible : null,
      });
    })();
  })()`));
  console.log('  real selection through the dropdown:');
  console.log('    ' + JSON.stringify(picked));

  console.log('  console lines mentioning overlay:');
  for (const l of consoleLines.filter((x) => /overlay|clut|halftone/i.test(x)).slice(0, 8)) {
    console.log(`    ${l}`);
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

/**
 * verify-3d.mjs — switch to 3D and check the terrain actually renders, with the shader compiling.
 *
 * WHY SWIFTSHADER
 * `--disable-gpu` alone leaves `renderer3d` null, so the 3D path never runs and the shader is never
 * compiled -- a test that would pass while the change under test is inert. `--use-angle=swiftshader`
 * gives a real WebGL2 context in software, which is what makes this observable at all.
 *
 * The assertions name what a person would see: the mesh exists, it has vertices, the frame is not
 * black, and the console carries no shader compile or link error.
 *
 * SAFETY: own profile, verified-free port, kills only the PID it spawned.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, `.chrome-3d-${process.pid}`);
const URL_ = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6)
  || 'http://127.0.0.1:5174/';

const PORT = await (async () => {
  const net = await import('node:net');
  for (let i = 0; i < 40; i++) {
    const c = 9800 + Math.floor(Math.random() * 150);
    const free = await new Promise((res) => {
      const s = net.createServer();
      s.once('error', () => res(false));
      s.once('listening', () => s.close(() => res(true)));
      s.listen(c, '127.0.0.1');
    });
    if (free) return c;
  }
  throw new Error('no free port');
})();

if (!existsSync(CHROME)) { console.error('no chrome'); process.exit(2); }
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* locked */ }
mkdirSync(PROFILE, { recursive: true });

const child = spawn(CHROME, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-component-update', '--mute-audio', '--window-size=1600,900',
  // Software WebGL2. Without it the 3D path is never entered and nothing below is exercised.
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
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
  const logs = [];
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const { resolve: r, reject: j } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`${m.params.type}: ` + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || ''));
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

  // Switch to 3D the way the UI does, so the real code path runs.
  const clicked = await evaluate(`(function () {
    const b = [...document.querySelectorAll('#viewport button, #viewport .vp-tools button')]
      .find(x => (x.textContent || '').trim() === '3D');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  console.log(`  3D button clicked: ${clicked}`);
  await sleep(3500);

  const state = JSON.parse(await evaluate(`(function () {
    const r3 = window.__viewportRenderer && window.__viewportRenderer();
    const c3 = document.querySelector('#view-canvas-3d');
    return JSON.stringify({
      renderer: !!r3,
      available: r3 ? !!r3.available : null,
      glInfo: r3 ? String(r3.glInfo || '').slice(0, 90) : null,
      mode: r3 ? r3.mode : null,
      mesh: r3 && r3.mesh ? { visible: r3.mesh.visible, verts: r3.geometry ? r3.geometry.attributes.position.count : 0 } : null,
      canvas3d: c3 ? { w: c3.width, h: c3.height, hidden: c3.hidden } : null,
      hasFrontFacing: !!(r3 && r3.material && /gl_FrontFacing/.test(r3.material.fragmentShader || '')),
    });
  })()`));
  console.log(`  state: ${JSON.stringify(state)}`);

  check('a 3D renderer exists under SwiftShader', state.renderer === true, state.glInfo || '');
  check('it reports itself available', state.available === true);
  check('the viewport switched to 3D', state.mode === '3d', String(state.mode));
  check('the terrain mesh exists with vertices', !!(state.mesh && state.mesh.verts > 100),
    state.mesh ? `${state.mesh.verts} verts` : 'no mesh');
  check('the 3D canvas is shown at a real size',
    !!(state.canvas3d && !state.canvas3d.hidden && state.canvas3d.w > 100 && state.canvas3d.h > 100),
    JSON.stringify(state.canvas3d));
  // The change under test must actually be in the compiled source.
  check('the shader carries the two-sided branch', state.hasFrontFacing === true);

  // THE decisive one: did the shader COMPILE? A GLSL error leaves the mesh unlit or absent, and the
  // console is the only place it is reported.
  const shaderErrors = logs.filter((l) => /shader|glsl|compile|link|ERROR:/i.test(l));
  check('no shader compile or link errors', shaderErrors.length === 0,
    shaderErrors[0] ? shaderErrors[0].slice(0, 160) : 'none');

  // The frame must have content: a black readback means nothing was drawn.
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(ROOT, '.shot-3d.png'), Buffer.from(shot.data, 'base64'));
  console.log('  wrote .shot-3d.png');

  const lit = await evaluate(`(function () {
    const c = document.querySelector('#view-canvas-3d');
    if (!c || c.hidden) return -1;
    // Read the WebGL framebuffer through a 2D copy of the canvas.
    const t = document.createElement('canvas');
    t.width = c.width; t.height = c.height;
    const g = t.getContext('2d');
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    let n = 0, total = 0;
    for (let i = 0; i < d.length; i += 4 * 499) { total++; if (d[i] + d[i + 1] + d[i + 2] > 40) n++; }
    return Math.round((n / Math.max(1, total)) * 100);
  })()`);
  check('the 3D frame has content rather than black', Number(lit) > 8, `${lit}% of samples lit`);
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

/**
 * probe-add-node.mjs — what actually happens when a palette row is clicked.
 *
 * Reading the code path end to end (NodePalette.add -> CustomEvent -> GraphCanvas.onAdd ->
 * graph.addNode -> viewNodes -> the SVG label) showed every link correct, so the fault is not
 * visible in the source. This asks the live page instead.
 *
 * SAFETY: own profile, verified-free port, kills only the PID it spawned.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, `.chrome-add-${process.pid}`);
const URL_ = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6)
  || 'http://127.0.0.1:5174/';

const PORT = await (async () => {
  const net = await import('node:net');
  for (let i = 0; i < 40; i++) {
    const c = 9850 + Math.floor(Math.random() * 140);
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
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 200));
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
    if (res.exceptionDetails) return `THREW: ${res.exceptionDetails.exception?.description}`;
    return res.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 150; i++) {
    if (await evaluate('!!window.__gaea')) break;
    await sleep(300);
  }
  await sleep(2200);

  // What the first palette row carries.
  const row = await evaluate(`(function () {
    const li = document.querySelector('#library .lib-item');
    if (!li) return 'no .lib-item';
    return JSON.stringify({
      text: (li.querySelector('.nm') || {}).textContent,
      title: li.getAttribute('title'),
      html: li.outerHTML.slice(0, 220),
    });
  })()`);
  console.log(`  first palette row: ${row}`);

  // What the store's palette rows carry.
  const storeRow = await evaluate(`JSON.stringify((function () {
    const p = window.__store;
    if (!p) return 'no __store';
    // The palette is a computed; reach it through the catalog the store exposes.
    const cat = p.state.catalog;
    const nodes = (cat && cat.nodes) || [];
    return { catalogNodes: nodes.length, first: nodes[0] ? Object.keys(nodes[0]) : null, firstVals: nodes[0] || null };
  })())`);
  console.log(`  catalog: ${storeRow}`);

  // Now click it and see what lands in the graph.
  const before = await evaluate(`document.querySelectorAll('#graphwrap g.node').length`);
  await evaluate(`(function () {
    const li = document.querySelector('#library .lib-item');
    if (li) li.click();
    return true;
  })()`);
  await sleep(1200);
  const after = await evaluate(`document.querySelectorAll('#graphwrap g.node').length`);
  const labels = await evaluate(`JSON.stringify([...document.querySelectorAll('#graphwrap g.node text')].map(function (t) {
    return (t.textContent || '').trim();
  }).slice(0, 14))`);
  const nodeShape = await evaluate(`JSON.stringify((window.__store.state.graph.nodes || []).slice(-3))`);

  console.log(`  nodes: ${before} -> ${after}`);
  console.log(`  svg labels: ${labels}`);
  console.log(`  last graph nodes: ${nodeShape}`);
  console.log('');
  console.log('  console:');
  for (const l of logs.slice(0, 18)) console.log(`    ${l.slice(0, 190)}`);
  if (!logs.length) console.log('    (nothing)');
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

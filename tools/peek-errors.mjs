/**
 * peek-errors.mjs — print the page's console and exceptions, and what #app contains.
 *
 * Written because a verification reported every element as null while `window.__gaea` was set:
 * the boot completed and the render then threw, and the existing scripts never surfaced why.
 *
 * SAFETY: own profile, own port, kills only the PID it spawned.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, `.chrome-peek-${process.pid}`);
const PORT = 9350 + (process.pid % 5);
const URL_ = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6)
  || 'http://127.0.0.1:5174/';

if (!existsSync(CHROME)) { console.error('no chrome'); process.exit(2); }
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* locked leftover */ }
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
  const log = [];
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const { resolve: r, reject: j } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      log.push(`[${m.params.type}] ` + (m.params.args || [])
        .map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 400));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      log.push(`[EXCEPTION] ${d.exception?.description || d.text}`.slice(0, 700));
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
  await sleep(6000);

  console.log('');
  console.log('  page:');
  console.log(`    __gaea: ${await evaluate('typeof window.__gaea')}`);
  console.log(`    #app innerHTML length: ${await evaluate("document.getElementById('app')?.innerHTML.length ?? 'no #app'")}`);
  console.log(`    #layout: ${await evaluate("!!document.getElementById('layout')")}`);
  console.log(`    #graphwrap: ${await evaluate("!!document.getElementById('graphwrap')")}`);
  console.log(`    body children: ${await evaluate("[...document.body.children].map(e=>e.id||e.tagName).join(', ')")}`);

  console.log('');
  console.log('  console:');
  for (const l of log.slice(0, 25)) console.log(`    ${l}`);
  if (!log.length) console.log('    (nothing)');
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

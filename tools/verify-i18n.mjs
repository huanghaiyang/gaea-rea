/**
 * verify-i18n.mjs — read the VISIBLE text and check that it is actually Chinese.
 *
 * The earlier verification asserted `document.documentElement.lang` changed, which was true while
 * every label stayed English -- the attribute was not the observable. This one reads textContent
 * and counts CJK characters, which is what a user sees.
 *
 * SAFETY: own profile, own port, kills only the PID it spawned.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, '.chrome-i18n');
const PORT = 9339;
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

  const lang = await evaluate('document.documentElement.lang');
  console.log(`  document lang: ${lang}`);

  /** CJK count for one selector. */
  const cjk = async (sel) => evaluate(`(function () {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return -1;
    const text = el.textContent || '';
    return (text.match(/[\\u4e00-\\u9fff]/g) || []).length;
  })()`);

  const probes = [
    ['#library .panel-head', '节点库'],
    ['#inspector .panel-head', '参数'],
    ['#viewport .panel-head', '预览'],
    ['#graphwrap .panel-head', '节点图'],
    ['#library .lib-item', 'Adjust → 调整'],
  ];
  for (const [sel, what] of probes) {
    const n = await cjk(sel);
    check(`${what} is Chinese (${sel})`, n > 0, `${n} CJK chars`);
  }

  // The visible labels, printed, so the result can be read rather than inferred from a count.
  const sample = await evaluate(`JSON.stringify({
    library: (document.querySelector('#library .panel-head h2') || {}).textContent || '',
    search: (document.querySelector('#library .search') || {}).placeholder || '',
    inspector: (document.querySelector('#inspector .panel-head h2') || {}).textContent || '',
    preview: (document.querySelector('#viewport .panel-head h2') || {}).textContent || '',
    graph: (document.querySelector('#graphwrap .panel-head h2') || {}).textContent || '',
    firstRow: (document.querySelector('#library .lib-item .nm') || {}).textContent || '',
  })`);
  console.log(`      visible: ${sample}`);

  // And an English pass must still work, or the dictionary is one-way.
  await evaluate(`(function () {
    const s = [...document.querySelectorAll('#topbar select')].pop();
    s.value = 'en';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(2500);
  const enCount = await cjk('#library .panel-head');
  check('switching to English removes the Chinese', enCount <= 0, `${enCount} CJK chars`);
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

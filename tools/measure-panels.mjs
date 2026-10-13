/**
 * measure-panels.mjs — read the COMPUTED styles of the library and inspector, rather than
 * guessing from a screenshot why they look flat.
 *
 * A screenshot shows a symptom; computed styles show which declaration won. That distinction has
 * cost several cycles already.
 *
 * SAFETY: own profile, own port, kills only the PID it spawned.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = resolve(ROOT, '.chrome-measure');
const PORT = 9337;
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

  // Select a node that HAS parameters, with a REAL mouse event. Synthetic PointerEvents carry no
  // active pointer and the component's handlers do not act on them -- which is why an earlier run
  // reported paramRows: 0 and answered nothing.
  const box = JSON.parse(await evaluate(`(function () {
    const g = [...document.querySelectorAll('#graphwrap g.node')]
      .find(function (el) { return (el.textContent || '').trim() === 'MultiFractal'; });
    if (!g) return 'null';
    const r = g.querySelector('rect').getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`));
  if (box) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type, x: Math.round(box.x), y: Math.round(box.y),
        button: 'left', clickCount: 1, pointerType: 'mouse',
      });
    }
  }
  await sleep(900);

  const report = await evaluate(`JSON.stringify((function () {
    const pick = (sel, props) => {
      const el = document.querySelector(sel);
      if (!el) return { missing: sel };
      const cs = getComputedStyle(el);
      const out = { tag: el.tagName.toLowerCase(), classes: el.className };
      for (const p of props) out[p] = cs.getPropertyValue(p);
      const r = el.getBoundingClientRect();
      out.box = [Math.round(r.width), Math.round(r.height)];
      return out;
    };

    return {
      // Does the sheet reach the elements at all?
      sheetHrefs: [...document.styleSheets].map(function (s) { return s.href || '(inline)'; }),

      library: pick('#library', ['background-color', 'display', 'padding']),
      panelHead: pick('#library .panel-head', ['height', 'padding', 'border-bottom-width', 'background-color']),
      headH2: pick('#library .panel-head h2', ['font-size', 'text-transform', 'letter-spacing']),
      libList: pick('#library .lib-list', ['display', 'gap', 'padding', 'overflow']),
      libGroup: pick('#library .lib-group', ['font-size', 'text-transform', 'margin']),
      libItem: pick('#library .lib-item', ['display', 'padding', 'border-width', 'border-radius', 'background-color', 'cursor']),
      libDot: pick('#library .lib-item .dot', ['width', 'height', 'border-radius', 'background-color']),
      libNm: pick('#library .lib-item .nm', ['flex-grow', 'font-size', 'overflow']),
      libCnt: pick('#library .lib-item .cnt', ['font-size', 'font-family']),

      inspector: pick('#inspector', ['background-color', 'display']),
      insBody: pick('#inspector .panel-body', ['padding', 'overflow']),
      nodeHead: pick('#inspector .node-head', ['padding-bottom', 'border-bottom-width']),
      nodeTitle: pick('#inspector .node-title', ['display', 'gap', 'align-items']),
      pill: pick('#inspector .pill, #library .pill', ['font-size', 'border-radius', 'padding', 'border-width']),

      // Is the parameter grid present at all on a node that has parameters?
      // The actual trees, so a mismatch between the selector and the markup is visible.
      libraryTree: (function () {
        const el = document.querySelector('#library');
        if (!el) return 'no #library';
        return [el.tagName, ...[...el.children].map(function (c) { return c.tagName + '.' + c.className; })].join(' > ');
      })(),
      inspectorTree: (function () {
        const el = document.querySelector('#inspector');
        if (!el) return 'no #inspector';
        return [el.tagName, ...[...el.children].map(function (c) { return c.tagName + '.' + c.className; })].join(' > ');
      })(),
      panelBodyAll: [...document.querySelectorAll('.panel-body')].map(function (b) {
        const cs = getComputedStyle(b);
        const r = b.getBoundingClientRect();
        return {
          inLibrary: !!b.closest('#library'),
          inInspector: !!b.closest('#inspector'),
          overflowY: cs.overflowY,
          height: Math.round(r.height),
          scrollHeight: b.scrollHeight,
          padding: cs.padding,
        };
      }),
      paramRows: document.querySelectorAll('#inspector .param').length,
      paramControlPresent: document.querySelectorAll('#inspector .param-control').length,
      // THE REPORTED BUG: a select must not have the panel's text colour on the browser's
      // default background.
      selectStyle: (function () {
        const s = document.querySelector('#inspector .param-control select');
        if (!s) return 'no select in the panel';
        const cs = getComputedStyle(s);
        return { background: cs.backgroundColor, color: cs.color, borderWidth: cs.borderTopWidth };
      })(),
      sliderStyle: (function () {
        const s = document.querySelector('#inspector .param-control input[type=range]');
        if (!s) return 'no range in the panel';
        const cs = getComputedStyle(s);
        return { accent: cs.accentColor, flexGrow: cs.flexGrow };
      })(),
      paramValue: (function () {
        const v = document.querySelector('#inspector .param-value');
        if (!v) return 'no .param-value';
        const r = v.getBoundingClientRect();
        return { text: (v.textContent || '').trim().slice(0, 12), box: [Math.round(r.width), Math.round(r.height)] };
      })(),
    };
  })())`);

  writeFileSync(resolve(ROOT, '.measure-panels.json'), report);
  const r = JSON.parse(report);
  for (const [k, v] of Object.entries(r)) {
    console.log(`  ${k}: ${JSON.stringify(v)}`);
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

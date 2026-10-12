/**
 * verify-browser.mjs — end-to-end verification of the 3D view in a real browser.
 *
 * WHY A BROWSER IS REQUIRED HERE
 * Everything else about this project can be checked from Node. The 3D path cannot:
 * whether three.js initialises, whether the GLSL actually compiles on a driver, and
 * whether the Worker offload engages are only observable in a browser. The Node suite
 * covers the algorithms, the geometry and the sign conventions; this covers the rest.
 *
 * HOW IT WORKS
 * Chromium exposes no eval endpoint over plain HTTP, so the page POSTs its findings
 * back to this server instead of being polled over the DevTools socket.
 *
 *   node tools/verify-browser.mjs                    # serve, print the URL, wait
 *   node tools/verify-browser.mjs --chrome <exe>     # also launch headless Chrome
 *
 * PROCESS DISCIPLINE
 * With --chrome this spawns Chrome with an isolated --user-data-dir and a dedicated
 * debug-free profile, records the exact PID, and on exit signals ONLY that PID and its
 * direct children. It never matches processes by name, because a name match would kill
 * the user's own browser. This is deliberate and should stay that way.
 *
 * Headless Chrome has no GPU, so SwiftShader is enabled explicitly; without it WebGL is
 * unavailable and the run would report a false negative.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', 'web');
const PORT = Number(process.env.VERIFY_PORT || 8510);

const argv = process.argv.slice(2);
const chromeFlag = argv.indexOf('--chrome');
const chromeExe = chromeFlag >= 0 ? argv[chromeFlag + 1] : null;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
};

const PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>3D verification</title></head>
<body>
<div id="status">running…</div>
<iframe id="app" src="/app/index.html" style="width:1280px;height:720px;border:0"></iframe>
<script>
const out = [];
const log = (s) => { out.push(s); document.getElementById('status').textContent = 'running…\\n' + out.join('\\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = () => fetch('/report', { method: 'POST',
  body: 'origin=' + location.origin + ' secure=' + window.isSecureContext + '\\n' + out.join('\\n') });

(async () => {
  try {
    log('origin = ' + location.origin);
    log('isSecureContext = ' + window.isSecureContext);
    log('typeof Worker   = ' + typeof Worker);
    log('three           = ' + (await import('/app/vendor/three/three.module.js')
      .then((m) => 'OK REVISION ' + m.REVISION).catch((e) => 'FAIL ' + e.message)));

    const f = document.getElementById('app');
    await new Promise((res) => { f.onload = res; setTimeout(res, 20000); });
    await sleep(4000);

    const W = f.contentWindow, D = f.contentDocument;
    log('app title = ' + D.title);
    log('GAEAWEB   = ' + typeof W.GAEAWEB);

    const errs = [], warns = [];
    const oe = W.console.error, ow = W.console.warn;
    W.console.error = function (...a) { errs.push(a.map(String).join(' ')); return oe.apply(W.console, a); };
    W.console.warn = function (...a) { warns.push(a.map(String).join(' ')); return ow.apply(W.console, a); };

    // The toolbar listeners attach partway through app init, so poll rather than guess.
    log('viewMode before click = ' + W.GAEAWEB.state.viewMode);
    let tries = 0;
    for (; tries < 30; tries++) {
      D.getElementById('btn-view3d').click();
      await sleep(500);
      if (W.GAEAWEB.state.viewMode === '3d') break;
    }
    log('3D switch attempts = ' + (tries + 1) + ', viewMode = ' + W.GAEAWEB.state.viewMode);

    const vp = W.GAEAWEB.viewport;
    log('available3D     = ' + vp.available3D);
    log('renderer3d.info = ' + (vp.renderer3d ? vp.renderer3d.info : '(none)'));

    for (let i = 0; i < 60 && !vp.meshInfo; i++) { vp.draw(); await sleep(150); }
    const mi = vp.meshInfo;
    log('mesh = ' + (mi ? mi.vertices + ' verts, ' + mi.triangles + ' tris, stride ' + mi.stride
      + ', built in ' + mi.mode + ' in ' + (mi.buildMs || 0).toFixed(1) + 'ms' : 'null'));
    if (vp.meshWorker) {
      const d = vp.meshWorker.diagnostics();
      log('meshWorker = ' + d.mode + ' (' + d.reason + ')');
    }

    // Read the framebuffer in the SAME task as the draw: with preserveDrawingBuffer
    // false the buffer is gone after compositing.
    const gl = vp.renderer3d && vp.renderer3d.renderer ? vp.renderer3d.renderer.getContext() : null;
    if (!gl) {
      log('FRAMEBUFFER: no WebGL context');
    } else {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      vp.draw();
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const seen = new Set();
      let nonClear = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (seen.size < 4096) seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
        if (px[i] > 20 || px[i + 1] > 20 || px[i + 2] > 25) nonClear++;
      }
      const total = w * h;
      log('drawingBuffer = ' + w + 'x' + h + ', distinct colours = ' + seen.size);
      log('non-clear = ' + nonClear + '/' + total + ' (' + (100 * nonClear / total).toFixed(1) + '%)');
      log('RENDERED = ' + (nonClear > total * 0.01 ? 'YES' : 'NO (blank frame)'));
    }

    log('console.error = ' + errs.length);
    for (const e of errs.slice(0, 5)) log('   error: ' + e);
    log('console.warn  = ' + warns.length);
    for (const w2 of warns.slice(0, 5)) log('   warn: ' + w2);
    log('DONE');
  } catch (e) {
    log('FATAL ' + (e && e.stack || e));
  }
  await report();
  document.getElementById('status').textContent = 'COMPLETE';
})();
</script>
</body></html>`;

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(data);
  });
}

let child = null;
let childPid = null;

function stopOwnChild() {
  if (!childPid) return;
  // Kill the recorded PID and its direct children only. Never match by name.
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(childPid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { process.kill(childPid, 'SIGTERM'); } catch { /* already gone */ }
    }
  } catch { /* ignore */ }
  childPid = null;
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/report') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      console.log(`\n----- report (host=${req.headers.host}) -----\n${body}\n`);
      res.writeHead(204).end();
      finish(0);
    });
    return;
  }

  const url = (req.url || '/').split('?')[0];
  if (url.startsWith('/app/')) {
    const file = path.resolve(WEB, url.slice('/app/'.length) || 'index.html');
    if (!file.startsWith(WEB)) { res.writeHead(403).end(); return; }
    sendFile(res, file);
    return;
  }
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(PAGE);
    return;
  }
  res.writeHead(404).end('not found');
});

function finish(code) {
  stopOwnChild();
  try { server.close(); } catch { /* ignore */ }
  setTimeout(() => process.exit(code), 150);
}

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`serving ${WEB}`);
  console.log(`open ${url}`);
  console.log('(127.0.0.1 is a secure context, so Workers are available)');

  if (chromeExe) {
    if (!fs.existsSync(chromeExe)) {
      console.error(`\n--chrome path does not exist: ${chromeExe}`);
      console.error('(if it contains spaces, quote it when passing it through a shell)');
      finish(2);
      return;
    }
    const profile = path.join(os.tmpdir(), `gaea-verify-${process.pid}`);
    fs.mkdirSync(profile, { recursive: true });
    child = spawn(chromeExe, [
      '--headless=new',
      // Headless has no GPU; without SwiftShader WebGL is unavailable and the run
      // would report a false negative.
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      `--user-data-dir=${profile}`,
      url,
    ], { stdio: 'ignore', detached: false });
    childPid = child.pid;
    // A spawn failure arrives as an 'error' event, not a throw. Without this handler an
    // unhandled event aborts the run with no explanation, which is exactly what
    // happened the first time this script was used.
    child.on('error', (err) => {
      console.error(`\nChrome failed to start: ${err.message}`);
      finish(2);
    });
    console.log(`launched headless Chrome pid=${childPid} with an isolated profile`);
    console.log('on exit, only this pid (and its children) is signalled — never by name');
  }
});

setTimeout(() => {
  console.log('\n[timeout] no report received');
  finish(1);
}, 150000);

/**
 * mesh-worker-controller.js — offloads mesh building to a Worker when possible.
 *
 * Why a controller rather than a bare `new Worker`
 *  - Worker availability is environment-dependent, and the difference is invisible
 *    to the user unless it is reported. In a NON-SECURE context (plain HTTP on a LAN
 *    address, which is how this app is often served) Chromium does not expose
 *    `Worker` at all, so mesh building necessarily runs on the UI thread and the 3D
 *    view stutters. `diagnostics()` returns the reason so the UI can say so instead
 *    of merely feeling slow.
 *  - The worker is bootstrapped from a Blob URL. `new Worker(url, {type:'module'})`
 *    is rejected in a non-secure context, so the classic form is the only portable
 *    one; meshing the source through a blob also keeps this working when the page is
 *    opened from disk (file://).
 *  - Requests are serialised — at most one mesh in flight — and a newer request
 *    supersedes an older one, so dragging a slider cannot queue a backlog of stale
 *    builds.
 */

import { buildMesh, sampleCountFor } from './mesh-build.js';

export class MeshWorkerController {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.dead = false;
    this.reason = 'not initialised';
    this.nextIndex = 1;
    this.pending = null;
    this.queued = null;
    this.lastMs = null;
    this.lastMode = 'inline';
    this.builds = 0;
    this.workerBuilds = 0;
    this.offloadRatio = 0;
  }

  /**
   * Attempt to start the worker. Never rejects; failure is a supported mode.
   * @returns {Promise<{ok: boolean, mode: 'worker'|'inline', reason?: string}>}
   */
  async init() {
    if (typeof Worker === 'undefined') {
      this.dead = true;
      this.reason = (typeof isSecureContext !== 'undefined' && !isSecureContext)
        ? 'Worker is unavailable because this page is not a secure context. Serve it over '
          + 'http://localhost or https (a LAN IP over plain http cannot create Workers).'
        : 'Worker is not available in this browser.';
      return { ok: false, mode: 'inline', reason: this.reason };
    }
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
      this.dead = true;
      this.reason = 'Blob URL is unavailable, so the worker could not be bootstrapped.';
      return { ok: false, mode: 'inline', reason: this.reason };
    }

    try {
      const src = new URL('./mesh-worker.js', import.meta.url).href;
      const text = await fetch(src).then((r) => {
        if (!r.ok) throw new Error(`fetch ${src} -> HTTP ${r.status}`);
        return r.text();
      });
      // Blob mode: the worker cannot see its own base URL, so it waits for a
      // `config` message before announcing readiness.
      const boot = `self.__MESH_WORKER_MODE__ = 'blob';\n${text}\n`;
      const url = URL.createObjectURL(new Blob([boot], { type: 'text/javascript' }));

      const worker = new Worker(url);
      this.worker = worker;

      const ok = await new Promise((resolve) => {
        const to = setTimeout(() => resolve(false), 4000);
        worker.onmessage = (ev) => {
          const msg = ev.data || {};
          if (msg.type === 'ready') { clearTimeout(to); resolve(true); return; }
          this._handle(msg);
        };
        worker.onerror = (err) => {
          clearTimeout(to);
          this.reason = `worker error: ${(err && err.message) || 'unknown'}`;
          resolve(false);
        };
        worker.postMessage({ type: 'config' });
      });

      if (!ok) {
        this.dead = true;
        if (this.reason === 'not initialised') {
          this.reason = 'worker did not announce readiness within 4s';
        }
        try { worker.terminate(); } catch { /* ignore */ }
        this.worker = null;
        return { ok: false, mode: 'inline', reason: this.reason };
      }

      this.ready = true;
      this.reason = 'worker active';
      worker.onmessage = (ev) => this._handle(ev.data || {});
      return { ok: true, mode: 'worker' };
    } catch (err) {
      this.dead = true;
      this.reason = `worker unavailable: ${(err && err.message) || err}`;
      this.worker = null;
      return { ok: false, mode: 'inline', reason: this.reason };
    }
  }

  get usingWorker() { return this.ready && !this.dead && !!this.worker; }

  /** Human-readable explanation of the current mode, for the status pill. */
  diagnostics() {
    return {
      mode: this.usingWorker ? 'worker' : 'inline',
      reason: this.reason,
      lastMs: this.lastMs,
      builds: this.builds,
      workerBuilds: this.workerBuilds,
      offloadRatio: this.builds ? this.workerBuilds / this.builds : 0,
      lastSampleCount: this._lastSampleCount || null,
    };
  }

  /**
   * Request a mesh. Resolves with the built mesh — transferable buffers on the
   * worker path — or null when the request was superseded by a newer one.
   *
   * @param {{data: Float32Array|number[], size: number, channels?: number,
   *          min: number, max: number, exaggeration: number, token?: any}} req
   * @returns {Promise<object|null>}
   */
  request(req) {
    this.builds++;
    this._lastSampleCount = sampleCountFor(req.size);

    if (!this.usingWorker) return this._buildInline(req);

    const index = this.nextIndex++;
    return new Promise((resolve, reject) => {
      const entry = { req, index, resolve, reject, superseded: false };
      if (this.pending) {
        this.pending.superseded = true;
        this.queued = entry;
      } else {
        this._dispatch(entry);
      }
    });
  }

  _dispatch(entry) {
    this.pending = entry;
    this.workerBuilds++;
    try {
      this.worker.postMessage({
        type: 'mesh',
        index: entry.index,
        data: entry.req.data,
        size: entry.req.size,
        channels: entry.req.channels || 1,
        min: entry.req.min,
        max: entry.req.max,
        exaggeration: entry.req.exaggeration,
      });
    } catch (err) {
      this.pending = null;
      // A clone failure is fatal for the worker path; degrade for this and future
      // requests rather than throwing into the render loop.
      this.dead = true;
      this.reason = `postMessage failed: ${(err && err.message) || err}`;
      try { this.worker.terminate(); } catch { /* ignore */ }
      this.worker = null;
      this._buildInline(entry.req).then(entry.resolve, entry.reject);
    }
  }

  _handle(msg) {
    if (msg.type === 'error') {
      const entry = this.pending;
      this.pending = null;
      if (entry && !entry.superseded) entry.reject(new Error(msg.message || 'mesh worker error'));
      else if (entry) entry.resolve(null);
      this._drain();
      return;
    }
    if (msg.type !== 'mesh') return;

    const entry = this.pending;
    this.pending = null;
    if (entry) {
      this.lastMs = msg.buildMs;
      this.lastMode = 'worker';
      if (entry.superseded) {
        entry.resolve(null);
      } else {
        entry.resolve({
          verts: msg.verts,
          idx: msg.idx,
          n: msg.n,
          stride: msg.stride,
          vertices: msg.vertices,
          triangles: msg.triangles,
          mode: 'worker',
          buildMs: msg.buildMs,
          token: entry.req.token,
        });
      }
    }
    this._drain();
  }

  _drain() {
    const q = this.queued;
    this.queued = null;
    if (q && this.usingWorker) this._dispatch(q);
  }

  async _buildInline(req) {
    const t0 = now();
    const res = buildMesh(req);
    const buildMs = now() - t0;
    this.lastMs = buildMs;
    this.lastMode = 'inline';
    return { ...res, mode: 'inline', buildMs, token: req.token };
  }

  dispose() {
    if (this.worker) { try { this.worker.terminate(); } catch { /* ignore */ } }
    this.worker = null;
    this.ready = false;
  }
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

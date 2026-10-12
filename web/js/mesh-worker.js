/**
 * mesh-worker.js — builds render meshes off the UI thread.
 *
 * CLASSIC worker (no `{type:'module'}`). Module workers are rejected in a
 * non-secure context, and this app is expected to be served over plain HTTP on a
 * LAN, so a classic script is the only form that can be relied on.
 *
 * A classic worker cannot `import`, so the algorithm appears here as well as in
 * mesh-build.js. The copy is deliberate and pinned by
 * `web/tests/mesh-worker-parity-test.mjs`, which runs both implementations over the
 * same inputs and asserts identical output. That test is the reason the duplication
 * is acceptable rather than dangerous.
 *
 * Two ways to load it:
 *   URL  -> `new Worker('js/mesh-worker.js')`. The worker announces readiness
 *           immediately, because it can be given everything up front.
 *   BLOB -> the controller wraps this file in a Blob URL and sets
 *           `self.__MESH_WORKER_MODE__ = 'config'`; the worker then waits for a
 *           `config` message instead of announcing readiness, because a blob cannot
 *           see its own base URL.
 *
 * Protocol
 *   in : { type: 'config' }                       (blob mode only)
 *        { type: 'mesh', index, data, size, channels, min, max, exaggeration }
 *        { type: 'ping' }
 *   out: { type: 'ready' }
 *        { type: 'mesh', index, verts, idx, n, stride, vertices, triangles, buildMs }
 *        { type: 'error', index, message }
 *
 * Heights arrive as a structured clone of the caller's array, which costs one pass
 * over the samples; the mesh returns as transferable buffers, so the reply is
 * zero-copy.
 */

const MAX_SAMPLES = 384;
const FLOATS_PER_VERTEX = 7;

const MODE = (typeof self !== 'undefined' && self.__MESH_WORKER_MODE__) || 'url';

self.onmessage = (ev) => {
  const msg = ev.data || {};
  try {
    switch (msg.type) {
      case 'ping':
        self.postMessage({ type: 'pong' });
        return;
      case 'config':
        self.postMessage({ type: 'ready' });
        return;
      case 'mesh': {
        const t0 = performance.now();
        const res = buildMesh(msg);
        self.postMessage(
          { type: 'mesh', index: msg.index, ...res, buildMs: performance.now() - t0 },
          [res.verts.buffer, res.idx.buffer],
        );
        return;
      }
      default:
        self.postMessage({ type: 'error', message: `unknown message type: ${msg.type}` });
    }
  } catch (err) {
    self.postMessage({ type: 'error', index: msg.index, message: String((err && err.message) || err) });
  }
};

function buildMesh(req) {
  const data = req.data;
  const size = req.size | 0;
  const channels = req.channels || 1;
  const stride = Math.max(1, Math.ceil(size / MAX_SAMPLES));
  const n = Math.floor((size - 1) / stride) + 1;

  const min = req.min;
  const max = req.max;
  const vrange = max - min > 1e-9 ? max - min : 1;
  const stretch = Math.max(0.02, Math.min(0.55, 0.34 * req.exaggeration));

  const verts = new Float32Array(n * n * FLOATS_PER_VERTEX);

  for (let j = 0; j < n; j++) {
    const yj = Math.min(size - 1, j * stride);
    const yUp = Math.max(0, (j - 1) * stride);
    const yDn = Math.min(size - 1, (j + 1) * stride);
    const rowC = yj * size;
    const rowUp = yUp * size;
    const rowDn = yDn * size;

    for (let i = 0; i < n; i++) {
      const xi = Math.min(size - 1, i * stride);
      const xl = Math.max(0, (i - 1) * stride);
      const xr = Math.min(size - 1, (i + 1) * stride);

      const h = data[(rowC + xi) * channels];
      const t = (h - min) / vrange;

      const hl = data[(rowC + xl) * channels];
      const hr = data[(rowC + xr) * channels];
      const hd = data[(rowUp + xi) * channels];
      const hu = data[(rowDn + xi) * channels];

      const dx = ((hr - hl) / vrange) * stretch * n * 0.5;
      const dz = ((hu - hd) / vrange) * stretch * n * 0.5;
      let nx = -dx, ny = 1, nz = -dz;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;

      const o = (j * n + i) * FLOATS_PER_VERTEX;
      verts[o] = i / (n - 1) - 0.5;
      verts[o + 1] = t * stretch - stretch * 0.5;
      verts[o + 2] = j / (n - 1) - 0.5;
      verts[o + 3] = nx;
      verts[o + 4] = ny;
      verts[o + 5] = nz;
      verts[o + 6] = t;
    }
  }

  const quads = (n - 1) * (n - 1);
  const idx = new Uint32Array(quads * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }

  return { verts, idx, n, stride, vertices: n * n, triangles: quads * 2 };
}

if (MODE !== 'blob') self.postMessage({ type: 'ready' });

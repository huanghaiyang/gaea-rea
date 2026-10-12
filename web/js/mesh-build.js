/**
 * mesh-build.js — height-field → render mesh, as a pure function.
 *
 * Kept dependency-free and side-effect-free so it can run in three places without
 * divergence:
 *   - the main thread, as the fallback when no worker is available;
 *   - mesh-worker.js, which offloads it off the UI thread;
 *   - the Node test harness, which asserts the numbers.
 *
 * Output layout matches the vertex shader: 7 floats per vertex
 *   [px, py, pz, nx, ny, nz, height]
 * and triangles as Uint32 indices, 6 per quad.
 */

/** Floats per vertex in the interleaved buffer (see viewport.js attribute setup). */
export const FLOATS_PER_VERTEX = 7;

/** Cap on samples per axis regardless of field resolution. */
export const MAX_SAMPLES = 384;

/**
 * @typedef {object} MeshRequest
 * @property {Float32Array|number[]} data      height samples, row-major
 * @property {number} size                     samples per axis in `data`
 * @property {number} [channels]               interleaved channels (default 1)
 * @property {number} min                      value mapped to the lowest vertex
 * @property {number} max                      value mapped to the highest vertex
 * @property {number} exaggeration             vertical stretch multiplier
 * @property {number} [index]                  optional identity, echoed back
 */

/**
 * @typedef {object} MeshResult
 * @property {Float32Array} verts
 * @property {Uint32Array} idx
 * @property {number} n            samples per axis actually written
 * @property {number} stride       field samples skipped per output sample
 * @property {number} vertices
 * @property {number} triangles
 * @property {number} [index]      echoed request index
 * @property {number} buildMs
 */

/**
 * Build the mesh in place on the calling thread.
 * @param {MeshRequest} req
 * @returns {MeshResult}
 */
export function buildMesh(req) {
  const t0 = now();
  const { data, size } = req;
  const channels = req.channels || 1;
  const stride = Math.max(1, Math.ceil(size / MAX_SAMPLES));
  const n = Math.floor((size - 1) / stride) + 1;

  const min = req.min;
  const max = req.max;
  const vrange = max - min > 1e-9 ? max - min : 1;
  const stretch = Math.max(0.02, Math.min(0.55, 0.34 * req.exaggeration));

  const verts = new Float32Array(n * n * FLOATS_PER_VERTEX);
  // Hoisted row offsets keep the inner loop from recomputing the clamp on every tap.
  const lastRow = (size - 1) * size;

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

  const idx = buildIndices(n);

  return {
    verts,
    idx,
    n,
    stride,
    vertices: n * n,
    triangles: (n - 1) * (n - 1) * 2,
    index: req.index,
    buildMs: now() - t0,
  };
}

/**
 * Triangulate an n x n vertex grid: two triangles per quad, wound so the terrain
 * faces the default camera. Topology depends only on `n`, which is what lets the
 * caller cache the index buffer.
 * @param {number} n
 * @returns {Uint32Array}
 */
export function buildIndices(n) {
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
  return idx;
}

/** Sample count per axis for a given field size, without building anything. */
export function sampleCountFor(size) {
  const stride = Math.max(1, Math.ceil(size / MAX_SAMPLES));
  return Math.floor((size - 1) / stride) + 1;
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

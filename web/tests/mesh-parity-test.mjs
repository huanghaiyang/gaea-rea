/**
 * mesh-parity-test.mjs — the worker's mesh algorithm must equal mesh-build.js.
 *
 * The two implementations are duplicated on purpose: a classic Worker cannot
 * `import`, and the classic form is the only one a non-secure context allows. That
 * duplication is only acceptable while something proves they agree, which is this
 * test. It loads the worker script with a minimal `self` stub, feeds both
 * implementations identical inputs, and compares every float and index bit-for-bit.
 *
 * Run: node web/tests/mesh-parity-test.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

import {
  buildMesh, buildIndices, sampleCountFor, FLOATS_PER_VERTEX, MAX_SAMPLES,
} from '../js/mesh-build.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(HERE, '..', 'js', 'mesh-worker.js');

let pass = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------- load the worker script headlessly */

const source = await readFile(WORKER, 'utf8');

/** Collect whatever the worker posts, keyed by message type. */
function loadWorker() {
  const posted = [];
  const sandbox = {
    performance: { now: () => 0 },
    Math, Float32Array, Uint32Array, Error, String, JSON, console,
    self: {
      __MESH_WORKER_MODE__: 'blob',   // suppress the immediate 'ready' post
      postMessage: (msg, transfer) => posted.push({ msg, transfer }),
      set onmessage(fn) { this._onmessage = fn; },
      get onmessage() { return this._onmessage; },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'mesh-worker.js' });

  const onmessage = sandbox.self.onmessage;
  if (typeof onmessage !== 'function') throw new Error('worker did not register onmessage');

  return {
    posted,
    /** Send one request and return the mesh message that came back. */
    send(data) {
      posted.length = 0;
      onmessage({ data });
      const mesh = posted.find((p) => p.msg.type === 'mesh');
      if (!mesh) {
        const err = posted.find((p) => p.msg.type === 'error');
        throw new Error(err ? err.msg.message : 'worker posted no mesh');
      }
      return mesh;
    },
  };
}

/* ------------------------------------------------------------------ fixtures */

function makeField(size, { channels = 1, fn } = {}) {
  const n = size * size * channels;
  const data = new Float32Array(n);
  const f = fn || ((x, y) => 0.5 + 0.35 * Math.sin(x * 0.21) * Math.cos(y * 0.17));
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = f(x, y);
      for (let c = 0; c < channels; c++) data[(y * size + x) * channels + c] = v + c * 0.01;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { data, size, channels, min, max };
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return `index ${i}: ${a[i]} vs ${b[i]}`;
  }
  return null;
}

/* -------------------------------------------------------------------- cases */

const CASES = [
  { label: 'size 2 (minimum grid)', size: 2, exag: 1 },
  { label: 'size 16', size: 16, exag: 1 },
  { label: 'size 64', size: 64, exag: 1 },
  { label: 'size 256 (app default)', size: 256, exag: 1 },
  { label: 'size 256, exaggeration 0.25', size: 256, exag: 0.25 },
  { label: 'size 256, exaggeration 3', size: 256, exag: 3 },
  { label: 'size 384 (stride 1 boundary)', size: 384, exag: 1 },
  { label: 'size 385 (stride 2 begins)', size: 385, exag: 1 },
  { label: 'size 1024 (stride 3)', size: 1024, exag: 1.5 },
  { label: 'size 64, multi-channel', size: 64, channels: 3, exag: 1 },
  { label: 'size 128, flat field', size: 128, exag: 1, fn: () => 0.5 },
  { label: 'size 128, extreme range', size: 128, exag: 1, fn: (x, y) => (x * y) % 7 },
];

const worker = loadWorker();

for (const c of CASES) {
  const field = makeField(c.size, { channels: c.channels, fn: c.fn });
  const req = {
    data: field.data,
    size: field.size,
    channels: field.channels,
    min: field.min,
    max: field.max,
    exaggeration: c.exag,
  };

  const pure = buildMesh(req);
  let viaWorker;
  try {
    viaWorker = worker.send({ type: 'mesh', index: 1, ...req }).msg;
  } catch (e) {
    ok(false, `${c.label}: worker produced a mesh`, e.message);
    continue;
  }

  ok(
    viaWorker.n === pure.n && viaWorker.stride === pure.stride,
    `${c.label}: same sample count and stride`,
    `${viaWorker.n}/${viaWorker.stride} vs ${pure.n}/${pure.stride}`,
  );
  ok(
    viaWorker.vertices === pure.vertices && viaWorker.triangles === pure.triangles,
    `${c.label}: same vertex and triangle counts`,
    `${viaWorker.vertices}/${viaWorker.triangles} vs ${pure.vertices}/${pure.triangles}`,
  );

  const dv = arraysEqual(viaWorker.verts, pure.verts);
  ok(dv === null, `${c.label}: vertices identical`, dv);

  const di = arraysEqual(viaWorker.idx, pure.idx);
  ok(di === null, `${c.label}: indices identical`, di);

  ok(
    viaWorker.verts.length === viaWorker.vertices * FLOATS_PER_VERTEX,
    `${c.label}: vertex buffer is 7 floats per vertex`,
    viaWorker.verts.length,
  );
}

/* ------------------------------------------------- invariant / property checks */

ok(
  sampleCountFor(256) === 256,
  'sampleCountFor(256) is 256 (stride 1)',
  sampleCountFor(256),
);
ok(
  sampleCountFor(MAX_SAMPLES * 2) <= MAX_SAMPLES,
  `sample count never exceeds MAX_SAMPLES (${MAX_SAMPLES})`,
  sampleCountFor(MAX_SAMPLES * 2),
);
ok(
  buildIndices(2).length === 6,
  'a 2x2 grid yields exactly two triangles',
  buildIndices(2).length,
);

// Indices must stay in range; a typo there would read past the vertex buffer.
{
  const f = makeField(96);
  const res = buildMesh({ ...f, exaggeration: 1 });
  let maxIndex = -1;
  for (const v of res.idx) if (v > maxIndex) maxIndex = v;
  ok(maxIndex === res.vertices - 1, 'indices span exactly 0..vertices-1', `${maxIndex} vs ${res.vertices - 1}`);
}

// Heights must stay inside the vertical band the shader expects.
{
  const f = makeField(64);
  const res = buildMesh({ ...f, exaggeration: 1 });
  const stretch = Math.max(0.02, Math.min(0.55, 0.34));
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < res.vertices; i++) {
    const y = res.verts[i * FLOATS_PER_VERTEX + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  ok(
    minY >= -stretch * 0.5 - 1e-6 && maxY <= stretch * 0.5 + 1e-6,
    'vertex heights stay within the stretched band',
    `[${minY}, ${maxY}] vs +/-${stretch * 0.5}`,
  );
}

// Normals must be unit length and point upward.
{
  const f = makeField(64);
  const res = buildMesh({ ...f, exaggeration: 1 });
  let worst = 0, minNy = 1;
  for (let i = 0; i < res.vertices; i++) {
    const o = i * FLOATS_PER_VERTEX + 3;
    const nx = res.verts[o], ny = res.verts[o + 1], nz = res.verts[o + 2];
    const len = Math.hypot(nx, ny, nz);
    if (Math.abs(len - 1) > worst) worst = Math.abs(len - 1);
    if (ny < minNy) minNy = ny;
  }
  ok(worst < 1e-5, 'all normals are unit length', `worst error ${worst}`);
  ok(minNy > 0, 'all normals point upward (positive Y)', `min ny ${minNy}`);
}

// A flat field must produce flat, identical geometry apart from position.
{
  const f = makeField(32, { fn: () => 0.5 });
  const res = buildMesh({ ...f, exaggeration: 1 });
  const first = res.verts[1];
  let flat = true;
  for (let i = 1; i < res.vertices; i++) {
    if (Math.abs(res.verts[i * FLOATS_PER_VERTEX + 1] - first) > 1e-9) { flat = false; break; }
  }
  ok(flat, 'a flat field yields a flat mesh');
}

/* ------------------------------------------------------------------ report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}   (${CASES.length} parity cases)`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures.slice(0, 25)) console.log(`  - ${f}`);
  if (failures.length > 25) console.log(`  ... and ${failures.length - 25} more`);
  process.exitCode = 1;
} else {
  console.log('worker and mesh-build.js agree bit-for-bit');
}

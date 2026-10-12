/**
 * eval-worker.js — runs the terrain engine off the UI thread.
 *
 * Protocol (structured clone, transferable ArrayBuffers for field data):
 *   main -> worker  { type:'catalog', catalog }
 *                   { type:'eval', id, graph, roots:[nodeId], size, seed }
 *   worker -> main  { type:'ready' }
 *                   { type:'progress', id, node, index, total }
 *                   { type:'result', id, size, totalMs, errors, stats, fields:[{root,channel,channels,data,min,max,mean,std}] }
 *
 * The worker imports exactly the same modules the Node test harness imports, so there is a
 * single implementation of every algorithm in the project.
 */

import { evaluateGraph, setCatalog } from './evaluator.js';
import { createField, stats as fieldStats } from './kernel/field.js';

let ready = false;

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'catalog') {
    setCatalog(msg.catalog);
    ready = true;
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'eval') {
    const { id, graph, roots, size, seed } = msg;
    if (!ready) {
      self.postMessage({ type: 'result', id, error: 'worker not initialised with a catalog', fields: [], stats: [], errors: [] });
      return;
    }
    try {
      const t0 = performance.now();
      const allStats = [];
      const allErrors = [];
      const fields = [];
      const buffers = [];
      let totalMs = 0;

      // Evaluate each requested root. Each call owns its own memo cache; when the caller
      // requests several roots the shared prefix is recomputed, which keeps the worker
      // stateless and the timings honest. A single root is the common case.
      for (const root of roots) {
        const res = evaluateGraph(graph, root, { size, seed });
        totalMs += res.totalMs;
        for (const s of res.stats) allStats.push(s);
        for (const e of res.errors) allErrors.push(e);
        if (res.field) {
          const s = fieldStats(res.field);
          const copy = new Float32Array(res.field.data);
          buffers.push(copy.buffer);
          fields.push({
            root,
            channel: res.field.channel,
            channels: res.field.channels,
            size: res.field.size,
            min: s.min, max: s.max, mean: s.mean, std: s.std,
            data: copy,
          });
        } else {
          fields.push({ root, channel: 'height', channels: 1, size, min: 0, max: 0, mean: 0, std: 0, data: null });
        }
      }

      // Deduplicate stats by nodeId, keeping the first measurement.
      const seenStat = new Set();
      const stats = allStats.filter((s) => (seenStat.has(s.nodeId) ? false : (seenStat.add(s.nodeId), true)));
      const errKey = new Set();
      const errors = allErrors.filter((e) => (errKey.has(e.nodeId + e.message) ? false : (errKey.add(e.nodeId + e.message), true)));

      self.postMessage({
        type: 'result', id, size,
        totalMs: totalMs || (performance.now() - t0),
        errors, stats, fields,
      }, buffers);
    } catch (err) {
      self.postMessage({
        type: 'result', id, size, totalMs: 0,
        errors: [{ nodeId: '', message: `worker failure: ${err && err.message ? err.message : String(err)}` }],
        stats: [], fields: [],
      });
    }
    return;
  }

  if (msg.type === 'ping') {
    self.postMessage({ type: 'pong' });
  }
};

// Make the module import side-effect explicit for bundler-free loading.
export const WORKER_VERSION = 1;
export { createField };

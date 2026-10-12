/**
 * eval-controller.js — schedules graph evaluation, preferably on a Worker.
 *
 * Design notes
 *  - The engine is CPU code (see IMPLEMENTATION-NOTES.md for why). Running it in a Worker is
 *    what keeps the UI responsive during a 1-second droplet erosion at 256px.
 *  - Workers are created from a Blob URL so the page keeps working when it is opened directly
 *    from disk (file://), where a classic `new Worker('js/eval-worker.js', {type:'module'})`
 *    is blocked. Inside the blob the worker does `import(absoluteUrl)` of the real module, so
 *    there is still exactly one implementation of every algorithm.
 *  - If Workers are unavailable the controller evaluates inline; the UI is then blocked for the
 *    duration of the pass, which is reported in the status pill.
 */

import { evaluateGraph, setCatalog } from './evaluator.js';
import { stats as fieldStats } from './kernel/field.js';
import { bus, state, rootsToEvaluate } from './state.js';

export class EvalController {
  constructor() {
    this.worker = null;
    this.workerReady = false;
    this.workerBroken = false;
    this.nextId = 1;
    this.pending = new Map();
    this.inflight = false;
    /** latest result, kept so a finished pass is never lost while another is queued */
    this.latest = null;
    this.queued = null;
    this.timer = null;
    this.debounceMs = 90;
  }

  /**
   * Try to spin up the worker. Resolves to true when the worker announced readiness.
   * Never rejects: a failure is a supported mode (inline fallback).
   */
  async init(catalog) {
    if (typeof Worker === 'undefined') return false;
    try {
      const src = new URL('./eval-worker.js', import.meta.url).href;
      const boot = `import(${JSON.stringify(src)});`;
      const blob = new Blob([boot], { type: 'text/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));
      this.worker = worker;

      const ready = await new Promise((resolve) => {
        const to = setTimeout(() => resolve(false), 4000);
        worker.onmessage = (ev) => {
          const msg = ev.data || {};
          if (msg.type === 'ready') { clearTimeout(to); resolve(true); return; }
          this.handleMessage(msg);
        };
        worker.onerror = (err) => {
          clearTimeout(to);
          console.warn('[eval] worker error, falling back to inline evaluation:', err && err.message);
          this.workerBroken = true;
          resolve(false);
        };
        worker.postMessage({ type: 'catalog', catalog });
      });

      if (!ready) {
        this.workerBroken = true;
        try { worker.terminate(); } catch { /* ignore */ }
        this.worker = null;
        return false;
      }
      this.workerReady = true;
      // Route future messages (after ready) through the normal handler.
      worker.onmessage = (ev) => this.handleMessage(ev.data || {});
      // The inline evaluator also needs the catalog.
      setCatalog(catalog);
      return true;
    } catch (err) {
      console.warn('[eval] worker unavailable:', err && err.message);
      this.worker = null;
      this.workerBroken = true;
      setCatalog(catalog);
      return false;
    }
  }

  get usingWorker() { return this.workerReady && !this.workerBroken; }

  handleMessage(msg) {
    if (msg.type !== 'result') return;
    const entry = this.pending.get(msg.id);
    if (entry) {
      this.pending.delete(msg.id);
      entry.resolve(msg);
    }
    this.inflight = false;
    this.drain();
  }

  /** Debounced request. Repeated calls within `debounceMs` collapse into one pass. */
  request(reason = 'change') {
    this.reason = reason;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), this.debounceMs);
  }

  /** Immediate request (used by the toolbar and on load). */
  requestNow(reason = 'manual') {
    this.reason = reason;
    clearTimeout(this.timer);
    return this.run();
  }

  async run() {
    const roots = rootsToEvaluate();
    if (!roots.length) {
      this.latest = { fields: [], stats: [], errors: [], ms: 0, size: state.graph.build.size, at: Date.now() };
      bus.emit('eval:done', this.latest);
      return this.latest;
    }
    if (this.inflight) {
      this.queued = { roots: roots.slice(), reason: this.reason };
      return null;
    }
    this.inflight = true;
    bus.emit('eval:start', { roots, reason: this.reason });

    const size = state.graph.build.size | 0;
    const seed = state.graph.build.seed | 0;
    const t0 = performance.now();
    let result;

    if (this.usingWorker) {
      const id = this.nextId++;
      result = await new Promise((resolve) => {
        this.pending.set(id, { resolve });
        this.worker.postMessage({ type: 'eval', id, graph: state.graph, roots, size, seed });
      });
    } else {
      result = evaluateInline(state.graph, roots, size, seed);
    }

    const fields = (result.fields || []).filter((f) => f && f.data);
    const out = {
      fields,
      stats: result.stats || [],
      errors: result.errors || [],
      ms: result.totalMs || (performance.now() - t0),
      size,
      at: Date.now(),
      reason: this.reason,
      inline: !this.usingWorker,
    };
    this.latest = out;
    state.fields.clear();
    for (const f of fields) state.fields.set(f.root, f);
    state.lastStats = out.stats;
    state.lastErrors = out.errors;
    state.lastMs = out.ms;
    this.inflight = false;
    bus.emit('eval:done', out);
    this.drain();
    return out;
  }

  drain() {
    if (this.inflight) return;
    const q = this.queued;
    this.queued = null;
    if (q) {
      this.reason = q.reason;
      this.run();
    }
  }

  dispose() {
    if (this.worker) { try { this.worker.terminate(); } catch { /* ignore */ } }
    this.worker = null;
  }
}

/** Inline (main-thread) fallback path. Same modules, same numbers, no Worker. */
function evaluateInline(graph, roots, size, seed) {
  const t0 = performance.now();
  const fields = [];
  const allStats = [];
  const errors = [];
  for (const root of roots) {
    const res = evaluateGraph(graph, root, { size, seed });
    for (const s of res.stats) allStats.push(s);
    for (const e of res.errors) errors.push(e);
    if (res.field) {
      const s = fieldStats(res.field);
      fields.push({
        root, size: res.field.size, channel: res.field.channel, channels: res.field.channels,
        data: new Float32Array(res.field.data),
        min: s.min, max: s.max, mean: s.mean, std: s.std,
      });
    }
  }
  return { fields, stats: allStats, errors, totalMs: performance.now() - t0 };
}

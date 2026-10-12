/**
 * util.js — small DOM, math and formatting helpers. No dependencies.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Compact signed number for readouts: 0.5 -> "0.500", 12 -> "12". */
export function fmt(v, digits = 3) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v === null || v === undefined) return '—';
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return 'NaN';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  if (a >= 10) return v.toFixed(2);
  return v.toFixed(digits);
}

export function fmtMs(ms) {
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Escape text for safe innerHTML use. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Minimal synchronous event bus. */
export function createBus() {
  const map = new Map();
  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => map.get(evt).delete(fn);
    },
    emit(evt, payload) {
      const set = map.get(evt);
      if (!set) return;
      for (const fn of Array.from(set)) {
        try { fn(payload); } catch (err) { console.error(`[bus:${evt}]`, err); }
      }
    },
  };
}

let toastTimer = null;
export function toast(message, kind = 'info', ms = 2600) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.className = `toast${kind === 'error' ? ' error' : ''}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, ms);
}

/** requestAnimationFrame throttle that always runs the LAST call. */
export function rafThrottle(fn) {
  let queued = false;
  let lastArgs = null;
  return function throttled(...args) {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn.apply(this, lastArgs);
    });
  };
}

/** debounce with a trailing call */
export function debounce(fn, ms) {
  let t = null;
  return function debounced(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/** Short, stable string hash (for UI keys). */
export function shortHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36).slice(0, 6);
}

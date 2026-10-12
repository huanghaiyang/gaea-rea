/**
 * dom-shim.mjs — a small in-memory DOM used to run the WHOLE browser application under Node.
 *
 * Why this exists: this build sandbox cannot start a browser (Chromium's mojo IPC needs named
 * pipes, which the sandbox denies), so a real headless run is impossible here. Instead of
 * skipping verification, we provide just enough DOM for js/app.js and every panel to run
 * unmodified, which exercises the real import graph, the real event wiring, the real parameter
 * panel construction, the real evaluator and the real export path.
 *
 * It is intentionally NOT a general DOM implementation. Anything the app does not touch is
 * absent, so a new dependency on an unimplemented API fails loudly instead of silently.
 */

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...names) { for (const n of names) this.set.add(n); this._sync(); }
  remove(...names) { for (const n of names) this.set.delete(n); this._sync(); }
  toggle(name, force) {
    const want = force === undefined ? !this.set.has(name) : !!force;
    if (want) this.set.add(name); else this.set.delete(name);
    this._sync();
    return want;
  }
  contains(name) { return this.set.has(name); }
  _sync() { this.el._className = Array.from(this.set).join(' '); }
  toString() { return Array.from(this.set).join(' '); }
}

class Style {
  constructor() { this._props = new Map(); }
  setProperty(k, v) { this._props.set(k, v); }
  getPropertyValue(k) { return this._props.get(k) || ''; }
}

class Event {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.defaultPrevented = false;
    Object.assign(this, init);
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stopped = true; }
}

class Node2 {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.attributes = new Map();
    // Real DOMStringMap rejects keys that are not valid property names: a hyphen
    // (or anything that is not followed by an uppercase letter) throws a
    // SyntaxError on assignment. The shim enforces the same rule, because a plain
    // object would silently accept invalid keys and hide exactly that class of bug.
    this.dataset = new Proxy({}, {
      set(target, prop, value) {
        if (typeof prop === 'string' && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(prop)) {
          throw new SyntaxError(
            `Failed to set a named property '${prop}' on 'DOMStringMap': '${prop}' is not a valid property name.`,
          );
        }
        target[prop] = value;
        return true;
      },
      get(target, prop) {
        if (typeof prop === 'string' && (prop.startsWith('to') || prop === 'valueOf')) {
          // Let Object.prototype helpers through untouched.
          return target[prop] ?? undefined;
        }
        return target[prop];
      },
    });
    this.style = new Style();
    this.classList = new ClassList(this);
    this._className = '';
    this._listeners = new Map();
    this._text = '';
    this._html = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this.title = '';
    this.tabIndex = 0;
    this.selectedIndex = 0;
    this.scrollTop = 0;
    this.offsetWidth = 100;
    this.offsetHeight = 30;
    this.clientWidth = 100;
    this.clientHeight = 30;
  }

  get className() { return this._className; }
  set className(v) {
    this._className = String(v || '');
    this.classList.set = new Set(String(v || '').split(/\s+/).filter(Boolean));
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) { this._text = String(v == null ? '' : v); this.children.length = 0; }

  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v == null ? '' : v);
    this.children.length = 0;
    this._text = '';
    // Parse a tiny subset: elements with optional id/class so querySelector can find them.
    const re = /<(\w+)([^>]*)>/g;
    let m;
    while ((m = re.exec(this._html))) {
      const el = new Node2(m[1]);
      const attrs = m[2] || '';
      const idm = /id="([^"]+)"/.exec(attrs);
      if (idm) el.setAttribute('id', idm[1]);
      const clm = /class="([^"]+)"/.exec(attrs);
      if (clm) el.className = clm[1];
      el._text = '';
      el.parentNode = this;
      this.children.push(el);
      registry.register(el);
    }
  }

  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get parentElement() { return this.parentNode; }
  get nextSibling() { return null; }

  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k === 'id') { this.id = String(v); registry.register(this); }
    if (k === 'class') this.className = v;
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
  }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  removeAttribute(k) { this.attributes.delete(k); }
  hasAttribute(k) { return this.attributes.has(k); }

  // `aria-label` is a reflected attribute in real browsers: assigning the IDL
  // property updates the content attribute and vice versa. The i18n layer writes
  // el['aria-label'], so without this the two views would disagree in the shim
  // while agreeing in a browser.
  get 'aria-label'() { return this.attributes.has('aria-label') ? this.attributes.get('aria-label') : null; }
  set 'aria-label'(v) { this.attributes.set('aria-label', String(v)); }

  appendChild(child) {
    if (!child) return child;
    if (child._fragment) {
      for (const c of child.children.slice()) this.appendChild(c);
      child.children.length = 0;
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    registry.register(child);
    return child;
  }
  insertBefore(child, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    child.parentNode = this;
    if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
    registry.register(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) {
    this.children.length = 0;
    for (const n of nodes) this.appendChild(n);
  }
  cloneNode() { const n = new Node2(this.tagName); n.className = this.className; return n; }
  contains(other) {
    let p = other;
    while (p) { if (p === this) return true; p = p.parentNode; }
    return false;
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    const s = this._listeners.get(type);
    if (s) s.delete(fn);
  }
  dispatchEvent(evt) {
    if (typeof evt === 'string') evt = new Event(evt);
    const s = this._listeners.get(evt.type);
    evt.target = this;
    if (s) for (const fn of Array.from(s)) fn.call(this, evt);
    if (evt.bubbles && this.parentNode) this.parentNode.dispatchEvent(evt);
    return !evt.defaultPrevented;
  }
  click() { this.dispatchEvent(new Event('click', { bubbles: true })); }

  focus() { doc.activeElement = this; }
  blur() { if (doc.activeElement === this) doc.activeElement = null; }
  setPointerCapture() {}
  releasePointerCapture() {}
  scrollIntoView() {}
  getBoundingClientRect() {
    // Geometry large enough for the viewport's internal ImageData logic to be exercised: the
    // canvas host (#viewport) is the layout box the renderer measures.
    if (this.tagName === 'CANVAS' || this.id === 'viewport' || this.classList.contains('vp-body')) {
      return { x: 0, y: 0, width: 640, height: 400, top: 0, left: 0, right: 640, bottom: 400 };
    }
    return { x: 0, y: 0, width: 300, height: 360, top: 0, left: 0, right: 300, bottom: 360 };
  }
  getContext(kind) {
    if (kind === '2d') return this._ctx2d || (this._ctx2d = make2DContext(this));
    return null;  // no WebGL2 under the shim -> exercises the 2D fallback path
  }
  toDataURL() { return 'data:image/png;base64,'; }
  toBlob(cb) { if (cb) cb({ size: 1, type: 'image/png' }); }

  querySelector(sel) { return query(this, sel, true)[0] || null; }
  querySelectorAll(sel) { return query(this, sel, false); }
  closest(sel) {
    let p = this;
    while (p) { if (matchesSel(p, sel)) return p; p = p.parentNode; }
    return null;
  }
  get elements() { return this.children; }
}

class Document2 extends Node2 {
  constructor() {
    super('#document');
    this.nodeType = 9;
    this.body = new Node2('body');
    this.head = new Node2('head');
    this.documentElement = new Node2('html');
    this.appendChild(this.head);
    this.appendChild(this.body);
    this.activeElement = null;
  }
  createElement(tag) { return new Node2(tag); }
  createElementNS(ns, tag) { return new Node2(tag); }
  getElementById(id) { return registry.byId.get(String(id)) || null; }
  getElementsByClassName(cls) { return query(this, '.' + cls, false); }
  getElementsByTagName(tag) { return query(this, tag, false); }
  createTextNode(text) { const n = new Node2('#text'); n.nodeType = 3; n._text = String(text); return n; }
  createDocumentFragment() { const f = new Node2('#fragment'); f._fragment = true; return f; }
}

/* --------------------------------------------------------------- registry + selectors */

const registry = {
  byId: new Map(),
  all: new Set(),
  register(el) {
    this.all.add(el);
    if (el.id) this.byId.set(el.id, el);
    for (const c of el.children) this.register(c);
  },
};

/**
 * Minimal CSS matcher supporting exactly the selector grammar this app uses:
 *   #id  .class  tag  [attr]  [attr="value"]  and combinations of those in one compound,
 *   plus the descendant combinator (whitespace) between compounds.
 * Matching is right-to-left through the ancestor chain, exactly like a real engine, so
 * `#inspector .tab` and `#view-canvas-3d` both behave as expected.
 */
const ATTR_RE = /\[([^\]=]+)(?:=("?)([^"\]]*)\2)?\]/g;

function parseCompound(text) {
  const attrs = [];
  let rest = text;
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(text))) attrs.push({ name: m[1], attrValue: m[3] });
  rest = rest.replace(ATTR_RE, '');
  const tokens = rest.split(/(?=[.#])/).filter(Boolean);
  return {
    id: tokens.filter((t) => t[0] === '#').map((t) => t.slice(1)),
    classes: tokens.filter((t) => t[0] === '.').map((t) => t.slice(1)),
    tag: tokens.find((t) => t[0] !== '#' && t[0] !== '.') || null,
    attrs,
  };
}

function compoundMatches(el, c) {
  if (!el || el.nodeType !== 1) return false;
  for (const id of c.id) if (el.id !== id) return false;
  for (const cls of c.classes) if (!el.classList.contains(cls)) return false;
  if (c.tag && el.tagName !== c.tag.toUpperCase()) return false;
  for (const a of c.attrs) {
    // Attribute reflection: real DOM reflects properties like 	ype, so a shim that only
    // consults setAttribute would miss input[type=range]. Fall back to the property.
    let actual;
    if (a.name.startsWith('data-')) {
      actual = el.dataset[a.name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())];
    } else {
      actual = el.getAttribute(a.name);
      if (actual === null && a.name in el && typeof el[a.name] !== 'object') actual = el[a.name];
    }
    if (a.attrValue === undefined) { if (actual === null || actual === undefined) return false; }
    else if (String(actual) !== a.attrValue) return false;
  }
  return true;
}

/** Right-to-left match of a compound chain against an element. */
function matchesChain(el, chain) {
  let i = chain.length - 1;
  if (!compoundMatches(el, chain[i])) return false;
  i--;
  let node = el.parentNode;
  while (i >= 0 && node) {
    if (compoundMatches(node, chain[i])) i--;
    node = node.parentNode;
  }
  return i < 0;
}

function query(root, sel, first) {
  const chain = String(sel).trim().split(/\s+/).filter(Boolean).map(parseCompound);
  if (!chain.length) return [];
  const results = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (child.nodeType === 1) {
        if (matchesChain(child, chain)) {
          results.push(child);
          if (first) return;
        }
        walk(child);
        if (first && results.length) return;
      }
    }
  };
  walk(root);
  return results;
}

/* --------------------------------------------------------------- 2D context stub */

function make2DContext(canvas) {
  const noop = () => {};
  return {
    canvas,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px monospace',
    textBaseline: 'alphabetic',
    textAlign: 'start',
    save: noop, restore: noop, scale: noop, translate: noop, rotate: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop, rect: noop, stroke: noop, fill: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop, clip: noop,
    fillText: noop, setLineDash: noop, drawImage: noop,
    measureText: (t) => ({ width: String(t).length * 6 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    putImageData: noop,
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)).fill(128) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
}

/* --------------------------------------------------------------- globals */

export function installDomShim({ url = 'http://127.0.0.1:8080/', catalog } = {}) {
  const doc = new Document2();

  // Pre-create every element the app looks up by id, plus the canvases.
  const ids = [
    'topbar', 'layout', 'library', 'lib-list', 'lib-search', 'lib-count', 'lib-filters',
    'graphwrap', 'graphview', 'graph-canvas', 'graph-empty', 'port-picker',
    'btn-new', 'btn-demo', 'btn-undo', 'btn-redo', 'btn-fit', 'btn-add-node', 'btn-delete-node',
    'btn-view2d', 'btn-view3d', 'btn-dice', 'btn-export', 'btn-hint', 'graph-hint',
    'sel-res', 'inp-seed', 'sel-ramp', 'inp-exag', 'eval-status',
    'inspector', 'node-head', 'node-name', 'node-desc', 'node-badge',
    'param-list', 'page-params', 'page-info',
    'info-eval', 'info-timings', 'info-errors', 'info-coverage',
    'viewport', 'view-canvas-2d', 'view-canvas-3d', 'vp-overlay', 'vp-mode', 'vp-subject',
    'vp-stats', 'vp-fallback', 'sources', 'toast',
  ];
  for (const id of ids) {
    const tag = id.startsWith('view-canvas') ? 'canvas' : id.startsWith('btn') ? 'button' : 'div';
    const el = new Node2(tag);
    el.id = id;
    doc.body.appendChild(el);
    registry.register(el);
  }
  // The app looks for "#viewport .vp-body"; give the injected element that child so the shim
  // mirrors the real layout (index.html nests both canvases inside .vp-body).
  {
    const vp = registry.byId.get('viewport');
    const body = new Node2('div');
    body.className = 'vp-body';
    vp.appendChild(body);
    // re-parent the canvases into it, exactly as the host page does
    for (const id of ['view-canvas-2d', 'view-canvas-3d']) {
      const c = registry.byId.get(id);
      if (c && c.parentNode) c.parentNode.removeChild(c);
      body.appendChild(c);
      registry.register(c);
    }
  }
  // canvas size so the viewport's internal ImageData logic is exercised
  for (const id of ['view-canvas-2d', 'view-canvas-3d']) {
    const c = registry.byId.get(id);
    c.width = 640; c.height = 400;
  }
  const seedInput = registry.byId.get('inp-seed');
  seedInput.type = 'number'; seedInput.value = '0';
  const resSel = registry.byId.get('sel-res');
  resSel.value = '256';
  const rampSel = registry.byId.get('sel-ramp');
  rampSel.value = 'terrain';
  const exag = registry.byId.get('inp-exag');
  exag.type = 'range'; exag.value = '1';

  class ImageDataShim {
    constructor(a, b, c) {
      if (a instanceof Uint8ClampedArray) { this.data = a; this.width = b; this.height = c; }
      else { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
    }
  }

  const listeners = new Map();
  const win = {
    document: doc,
    devicePixelRatio: 1,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { const s = listeners.get(type); if (s) s.delete(fn); },
    dispatchEvent(evt) {
      const s = listeners.get(evt.type);
      if (s) for (const fn of Array.from(s)) fn(evt);
      return true;
    },
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: globalThis.performance,
    console,
    location: new URL(url),
    navigator: { userAgent: 'node-dom-shim/1.0' },
    ResizeObserver: undefined,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };

  globalThis.window = win;
  globalThis.document = doc;
  globalThis.ImageData = ImageDataShim;
  globalThis.Event = Event;
  globalThis.location = win.location;
  // Node 22 exposes `navigator` as a getter-only global; define an override instead of assigning.
  try {
    Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true, writable: true });
  } catch { /* keep Node's own navigator if it cannot be replaced */ }
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  globalThis.getComputedStyle = win.getComputedStyle;
  globalThis.Blob = globalThis.Blob || class { constructor(p) { this.parts = p; } };
  globalThis.URL.createObjectURL = () => 'blob:shim';
  globalThis.URL.revokeObjectURL = () => {};
  // Deliberately NO Worker: EvalController must fall back to inline evaluation.
  delete globalThis.Worker;

  // fetch(): serve data/nodes.json from the provided object, refuse everything else.
  globalThis.fetch = async (input) => {
    const u = String(input);
    if (u.includes('nodes.json')) {
      if (!catalog) throw new Error('shim: no catalog supplied');
      return { ok: true, status: 200, json: async () => catalog, text: async () => JSON.stringify(catalog) };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };

  return { document: doc, window: win, registry, fireDomReady: () => win.dispatchEvent(new Event('DOMContentLoaded')) };
}

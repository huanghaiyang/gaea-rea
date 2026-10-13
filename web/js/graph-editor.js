/**
 * graph-editor.js — the node-graph canvas: draw, hit-test, drag, connect, delete.
 *
 * Rendering is immediate-mode Canvas2D (crisp at any DPI, no DOM node churn), while the
 * parameter panel is DOM. Hit-testing shares the geometry helpers used for drawing so the
 * two can never drift apart.
 *
 * Interactions
 *   click node            select
 *   drag node body        move (snapped to a 6px grid)
 *   drag from output port start a connection
 *   click an input port   show a picker of upstream outputs (or disconnect if only one)
 *   drag on empty canvas  rubber-band select is intentionally NOT implemented; empty drag pans
 *   wheel                 zoom about the cursor
 *   middle / space drag   pan
 *   Del                   delete selection
 */

import {
  state, bus, snapshot, selectNode, schemaFor, isImplemented, registryEntry,
} from './state.js';
import { addNode, removeNode, connect, disconnect, getNode, wouldCreateCycle, incomingEdges } from './graph.js';
import { defaultParams, KIND_COLOR } from './registry.js';
import { rafThrottle, clamp } from './util.js';

const NODE_W = 108;
const NODE_H = 30;
const PORT_R = 4.5;
const GRID = 24;

export class GraphEditor {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.wrap = canvas.parentElement;
    this.ctx = canvas.getContext('2d');
    this.view = { x: 40, y: 30, k: 1 };
    this.hover = null;          // { kind:'node'|'port'|'edge', ... }
    this.drag = null;
    this.linkFrom = null;       // { nodeId, port, x, y }
    this.mouse = { x: 0, y: 0 };
    this.onStatus = opts.onStatus || (() => {});
    this.picker = document.getElementById('port-picker');
    this._schedule = rafThrottle(() => this.draw());
    this._bind();
    this.resize();
    // The unsubscribers are KEPT. Dropping them, as the first version did, leaves three live
    // closures pointing at a detached canvas as soon as a caller stops using the editor -- which
    // is exactly what a Vue unmount does.
    this._busOff = [
      bus.on('graph:replaced', () => { this.frameAll(); this._schedule(); }),
      bus.on('selection:changed', () => this._schedule()),
      bus.on('node:changed', () => this._schedule()),
    ];
  }

  /* ------------------------------------------------------------ geometry */

  nodeSize(node) {
    const entry = registryEntry(node.name);
    const inputs = entry && entry.inputs ? entry.inputs.length : 1;
    const outputs = entry && entry.outputs ? entry.outputs.length : 1;
    return { w: NODE_W, h: NODE_H, inputs: Math.max(0, inputs), outputs: Math.max(0, outputs) };
  }

  portPos(node, side, index, count) {
    const { h } = this.nodeSize(node);
    const y = node.y + h / 2 + (count > 1 ? (index - (count - 1) / 2) * 12 : 0);
    const x = side === 'in' ? node.x : node.x + NODE_W;
    return { x, y };
  }

  toScreen(x, y) { return [x * this.view.k + this.view.x, y * this.view.k + this.view.y]; }
  toWorld(sx, sy) { return [(sx - this.view.x) / this.view.k, (sy - this.view.y) / this.view.k]; }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // CSS-pixel size of the drawing surface. view.x/view.y, pointer offsetX/Y and
    // all drawing share this space; the backing store is this multiplied by dpr.
    this.cssWidth = Math.max(1, rect.width);
    this.cssHeight = Math.max(1, rect.height);
    const w = Math.max(1, Math.round(this.cssWidth * dpr));
    const h = Math.max(1, Math.round(this.cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.dpr = dpr;
      this._schedule();
    }
    this.dpr = dpr;
  }

  /* ------------------------------------------------------------ events */

  _bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const [wx, wy] = this.toWorld(e.offsetX, e.offsetY);
      const hit = this.hitTest(wx, wy);

      if (e.button === 1 || e.button === 2 || e.altKey) {
        this.drag = { kind: 'pan', sx: e.offsetX, sy: e.offsetY, vx: this.view.x, vy: this.view.y };
        c.style.cursor = 'grabbing';
        return;
      }

      if (hit && hit.kind === 'port' && hit.side === 'out') {
        this.linkFrom = { nodeId: hit.nodeId, port: hit.index };
        this.mouse = { x: wx, y: wy };
        this._schedule();
        return;
      }
      if (hit && hit.kind === 'port' && hit.side === 'in') {
        this.showPortPicker(hit.nodeId, hit.index, e.clientX, e.clientY);
        return;
      }
      if (hit && hit.kind === 'node') {
        selectNode(hit.nodeId);
        const node = getNode(state.graph, hit.nodeId);
        this.drag = { kind: 'node', nodeId: hit.nodeId, dx: wx - node.x, dy: wy - node.y, moved: false, before: null };
        return;
      }
      // empty space: pan
      this.drag = { kind: 'pan', sx: e.offsetX, sy: e.offsetY, vx: this.view.x, vy: this.view.y };
      c.style.cursor = 'grabbing';
      selectNode(null);
      this.hidePortPicker();
    });

    c.addEventListener('pointermove', (e) => {
      const [wx, wy] = this.toWorld(e.offsetX, e.offsetY);
      this.mouse = { x: wx, y: wy };

      if (this.drag && this.drag.kind === 'pan') {
        this.view.x = this.drag.vx + (e.offsetX - this.drag.sx);
        this.view.y = this.drag.vy + (e.offsetY - this.drag.sy);
        this._schedule();
        return;
      }
      if (this.drag && this.drag.kind === 'node') {
        const node = getNode(state.graph, this.drag.nodeId);
        if (node) {
          if (!this.drag.before) this.drag.before = { x: node.x, y: node.y };
          const nx = Math.round((wx - this.drag.dx) / 6) * 6;
          const ny = Math.round((wy - this.drag.dy) / 6) * 6;
          if (nx !== node.x || ny !== node.y) this.drag.moved = true;
          node.x = nx;
          node.y = ny;
          this._schedule();
        }
        return;
      }
      if (this.linkFrom) { this._schedule(); return; }

      const hit = this.hitTest(wx, wy);
      const key = hit ? `${hit.kind}:${hit.nodeId || ''}:${hit.index ?? ''}:${hit.side || ''}` : null;
      const prevKey = this.hover ? `${this.hover.kind}:${this.hover.nodeId || ''}:${this.hover.index ?? ''}:${this.hover.side || ''}` : null;
      if (key !== prevKey) {
        this.hover = hit;
        c.style.cursor = !hit ? 'default'
          : hit.kind === 'port' ? 'crosshair'
          : hit.kind === 'node' ? 'move' : 'pointer';
        this._schedule();
      }
    });

    const finish = (e) => {
      if (this.drag && this.drag.kind === 'node' && this.drag.moved) {
        snapshot();
        bus.emit('graph:changed', { reason: 'move' });
      }      if (this.linkFrom) {
        const [wx, wy] = this.toWorld(e.offsetX, e.offsetY);
        const hit = this.hitTest(wx, wy);
        if (hit && hit.kind === 'port' && hit.side === 'in') this.tryConnect(this.linkFrom.nodeId, hit.nodeId, hit.index);
        else if (hit && hit.kind === 'node') this.tryConnect(this.linkFrom.nodeId, hit.nodeId, 0);
        this.linkFrom = null;
        this._schedule();
      }
      this.drag = null;
      c.style.cursor = 'default';
      try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    c.addEventListener('pointerup', finish);
    c.addEventListener('pointercancel', finish);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [wx, wy] = this.toWorld(e.offsetX, e.offsetY);
      const factor = Math.exp(-e.deltaY * 0.0016);
      this.view.k = clamp(this.view.k * factor, 0.25, 2.6);
      const [nx, ny] = this.toScreen(wx, wy);
      this.view.x += e.offsetX - nx;
      this.view.y += e.offsetY - ny;
      this._schedule();
    }, { passive: false });

    c.addEventListener('dblclick', (e) => {
      const [wx, wy] = this.toWorld(e.offsetX, e.offsetY);
      const hit = this.hitTest(wx, wy);
      if (hit && hit.kind === 'node') {
        // double-click an input-less node's body -> reset parameters
        const node = getNode(state.graph, hit.nodeId);
        if (node) {
          snapshot();
          node.params = defaultParams(schemaFor(node.name));
          bus.emit('node:changed', { id: node.id });
          this._schedule();
        }
      }
    });

    window.addEventListener('resize', () => { this.resize(); this._schedule(); });
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => { this.resize(); this._schedule(); });
      this._ro.observe(this.wrap);
    }
  }

  tryConnect(fromId, toId, toPort) {
    if (fromId === toId) { this.onStatus('Cannot connect a node to itself'); return; }
    if (wouldCreateCycle(state.graph, fromId, toId)) {
      this.onStatus('That connection would create a cycle');
      return;
    }
    snapshot();
    connect(state.graph, fromId, toId, toPort);
    this.onStatus(`connected ${getNode(state.graph, fromId).name} \u2192 ${getNode(state.graph, toId).name}`);
    bus.emit('graph:changed', { reason: 'connect' });
    this._schedule();
  }

  /* ------------------------------------------------------------ hit-test */

  hitTest(wx, wy) {
    // ports first (they overlap the node border)
    for (let i = this.graphNodes().length - 1; i >= 0; i--) {
      const node = this.graphNodes()[i];
      const size = this.nodeSize(node);
      for (let p = 0; p < size.outputs; p++) {
        const pt = this.portPos(node, 'out', p, size.outputs);
        if (Math.hypot(wx - pt.x, wy - pt.y) <= PORT_R + 3) return { kind: 'port', side: 'out', nodeId: node.id, index: p };
      }
      for (let p = 0; p < size.inputs; p++) {
        const pt = this.portPos(node, 'in', p, size.inputs);
        if (Math.hypot(wx - pt.x, wy - pt.y) <= PORT_R + 3) return { kind: 'port', side: 'in', nodeId: node.id, index: p };
      }
    }
    for (let i = this.graphNodes().length - 1; i >= 0; i--) {
      const node = this.graphNodes()[i];
      const size = this.nodeSize(node);
      if (wx >= node.x && wx <= node.x + size.w && wy >= node.y && wy <= node.y + size.h) {
        return { kind: 'node', nodeId: node.id };
      }
    }
    // edges
    const edges = state.graph.edges;
    for (const e of edges) {
      const seg = this.edgeGeometry(e);
      if (!seg) continue;
      // cheap distance to the two control points' hull: sample 8 points
      let best = Infinity;
      for (let s = 0; s <= 8; s++) {
        const t = s / 8;
        const p = cubicAt(seg, t);
        best = Math.min(best, Math.hypot(wx - p[0], wy - p[1]));
      }
      if (best < 6) return { kind: 'edge', edgeId: e.id };
    }
    return null;
  }

  graphNodes() { return state.graph.nodes; }

  edgeGeometry(edge) {
    const from = getNode(state.graph, edge.from);
    const to = getNode(state.graph, edge.to);
    if (!from || !to) return null;
    const fs = this.nodeSize(from), ts = this.nodeSize(to);
    const a = this.portPos(from, 'out', Math.min(edge.fromPort, fs.outputs - 1), fs.outputs);
    const b = this.portPos(to, 'in', Math.min(edge.toPort, ts.inputs - 1), ts.inputs);
    const dx = Math.max(24, Math.abs(b.x - a.x) * 0.5);
    return { a, b, c1: [a.x + dx, a.y], c2: [b.x - dx, b.y] };
  }

  /* ------------------------------------------------------------ view */

  fit() {
    const nodes = state.graph.nodes;
    if (!nodes.length) { this.view = { x: 40, y: 30, k: 1 }; this._schedule(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + NODE_H);
    }
    const pad = 40;
    const rect = this.canvas.getBoundingClientRect();
    const kx = (rect.width - pad * 2) / Math.max(1, maxX - minX);
    const ky = (rect.height - pad * 2) / Math.max(1, maxY - minY);
    this.view.k = clamp(Math.min(kx, ky, 1.4), 0.25, 2.2);
    this.view.x = pad / 2 - minX * this.view.k + (rect.width - pad - (maxX - minX) * this.view.k) / 2;
    this.view.y = pad / 2 - minY * this.view.k + (rect.height - pad - (maxY - minY) * this.view.k) / 2;
    this._schedule();
  }

  frameAll() { this.fit(); }

  /** Centre of the viewport in world coordinates (where "+ Node" drops things). */
  viewCenter() {
    const rect = this.canvas.getBoundingClientRect();
    return this.toWorld(rect.width / 2, rect.height / 2);
  }

  /* ------------------------------------------------------------ render */

  /**
   * Detach from the bus.
   *
   * The canvas listeners added in `_bind()` are anonymous and attached to the canvas itself, so
   * they are released with the element and are deliberately not tracked here.
   */
  dispose() {
    if (this._busOff) {
      for (const off of this._busOff) {
        try { off(); } catch { /* an already-detached handler is not an error */ }
      }
      this._busOff = null;
    }
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const dpr = this.dpr || 1;
    ctx.save();
    // The backing store is sized `CSS px * dpr`, so the context must be scaled by
    // the same factor. Everything drawn after this — and every pointer coordinate
    // read from offsetX/offsetY — is then in CSS pixels, which is also the space
    // view.x/view.y live in. Without this scale the drawing occupies the top-left
    // 1/dpr of the bitmap while hit-testing still assumes CSS pixels, so clicks
    // land off by that factor on any display with devicePixelRatio > 1.
    ctx.scale(dpr, dpr);
    const w = this.cssWidth || this.canvas.width / dpr;
    const h = this.cssHeight || this.canvas.height / dpr;
    ctx.fillStyle = '#0f151c';
    ctx.fillRect(0, 0, w, h);

    this._drawGrid(ctx, w, h);

    ctx.save();
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.k, this.view.k);

    // edges under nodes
    for (const e of state.graph.edges) this._drawEdge(ctx, e);
    if (this.linkFrom) this._drawPendingLink(ctx);
    for (const n of state.graph.nodes) this._drawNode(ctx, n);

    ctx.restore();
    ctx.restore();

    const empty = document.getElementById('graph-empty');
    if (empty) empty.hidden = state.graph.nodes.length > 0;
    const delBtn = document.getElementById('btn-delete-node');
    if (delBtn) delBtn.disabled = !state.selected;
  }

  _drawGrid(ctx, w, h) {
    // w/h are CSS pixels: the caller has already applied the DPR scale.
    const k = this.view.k;
    const step = GRID * k;
    if (step < 7) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.028)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let x = this.view.x % step;
    for (; x < w; x += step) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
    let y = this.view.y % step;
    for (; y < h; y += step) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
    ctx.stroke();
  }

  _drawEdge(ctx, edge) {
    const seg = this.edgeGeometry(edge);
    if (!seg) return;
    const hot = this.hover && this.hover.kind === 'edge' && this.hover.edgeId === edge.id;
    const from = getNode(state.graph, edge.from);
    const entry = from ? registryEntry(from.name) : null;
    const kind = entry && entry.outputs && entry.outputs[edge.fromPort] ? entry.outputs[edge.fromPort].kind : 'height';
    const color = KIND_COLOR[kind] || KIND_COLOR.any;
    ctx.save();
    ctx.lineWidth = hot ? 2.6 : 1.7;
    ctx.strokeStyle = hot ? '#ffffff' : color;
    ctx.globalAlpha = hot ? 1 : 0.72;
    ctx.beginPath();
    ctx.moveTo(seg.a.x, seg.a.y);
    ctx.bezierCurveTo(seg.c1[0], seg.c1[1], seg.c2[0], seg.c2[1], seg.b.x, seg.b.y);
    ctx.stroke();
    // direction arrow at the midpoint
    const m = cubicAt(seg, 0.5);
    const m2 = cubicAt(seg, 0.56);
    const ang = Math.atan2(m2[1] - m[1], m2[0] - m[0]);
    ctx.globalAlpha = hot ? 1 : 0.85;
    ctx.fillStyle = hot ? '#ffffff' : color;
    ctx.beginPath();
    ctx.moveTo(m[0] + Math.cos(ang) * 5, m[1] + Math.sin(ang) * 5);
    ctx.lineTo(m[0] + Math.cos(ang + 2.5) * 4.4, m[1] + Math.sin(ang + 2.5) * 4.4);
    ctx.lineTo(m[0] + Math.cos(ang - 2.5) * 4.4, m[1] + Math.sin(ang - 2.5) * 4.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawPendingLink(ctx) {
    const from = getNode(state.graph, this.linkFrom.nodeId);
    if (!from) return;
    const size = this.nodeSize(from);
    const a = this.portPos(from, 'out', Math.min(this.linkFrom.port, size.outputs - 1), size.outputs);
    const b = this.mouse;
    ctx.save();
    ctx.strokeStyle = '#4c9aff';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    const dx = Math.max(24, Math.abs(b.x - a.x) * 0.5);
    ctx.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  _drawNode(ctx, node) {
    const size = this.nodeSize(node);
    const selected = state.selected === node.id;
    const isPreview = state.previewRoot === node.id;
    const entry = registryEntry(node.name);
    const impl = isImplemented(node.name);
    const cat = entry ? entry.category : 'Catalog only';
    const accent = categoryColor(cat);

    ctx.save();
    // body
    const r = 5;
    roundRect(ctx, node.x, node.y, size.w, size.h, r);
    const grad = ctx.createLinearGradient(node.x, node.y, node.x, node.y + size.h);
    if (impl) { grad.addColorStop(0, '#1e2937'); grad.addColorStop(1, '#151d27'); }
    else { grad.addColorStop(0, '#242028'); grad.addColorStop(1, '#1b181e'); }
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? '#4c9aff' : (isPreview ? '#5ed3a0' : '#2c3844');
    ctx.stroke();

    // category stripe
    ctx.save();
    roundRect(ctx, node.x, node.y, size.w, size.h, r);
    ctx.clip();
    ctx.fillStyle = accent;
    ctx.globalAlpha = impl ? 0.85 : 0.35;
    ctx.fillRect(node.x, node.y, 3.5, size.h);
    ctx.restore();

    // title
    ctx.fillStyle = impl ? '#e6edf3' : '#a9a4b0';
    ctx.font = `600 ${Math.min(12, 12)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const label = clipText(ctx, node.name, size.w - 18);
    ctx.fillText(label, node.x + 8, node.y + size.h / 2);
    if (!impl) {
      ctx.fillStyle = '#f0a35e';
      ctx.font = '9px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('catalog', node.x + size.w - 5, node.y + 7);
    }
    if (isPreview) {
      ctx.fillStyle = '#5ed3a0';
      ctx.beginPath();
      ctx.arc(node.x + size.w - 6, node.y + size.h - 7, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // ports
    for (let p = 0; p < size.outputs; p++) {
      const pt = this.portPos(node, 'out', p, size.outputs);
      const kind = entry && entry.outputs && entry.outputs[p] ? entry.outputs[p].kind : 'height';
      this._drawPort(ctx, pt, KIND_COLOR[kind] || KIND_COLOR.any, this.hover, node.id, 'out', p);
    }
    for (let p = 0; p < size.inputs; p++) {
      const pt = this.portPos(node, 'in', p, size.inputs);
      const kind = entry && entry.inputs && entry.inputs[p] ? entry.inputs[p].kind : 'height';
      const filled = incomingEdges(state.graph, node.id);
      const connected = filled.some((e) => e.toPort === p);
      this._drawPort(ctx, pt, KIND_COLOR[kind] || KIND_COLOR.any, this.hover, node.id, 'in', p, connected);
    }
    ctx.restore();
  }

  _drawPort(ctx, pt, color, hover, nodeId, side, index, connected = true) {
    const hot = hover && hover.kind === 'port' && hover.nodeId === nodeId && hover.side === side && hover.index === index;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, hot ? PORT_R + 1.6 : PORT_R, 0, Math.PI * 2);
    ctx.fillStyle = side === 'in' && !connected ? '#0f151c' : color;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = hot ? '#ffffff' : color;
    ctx.globalAlpha = hot ? 1 : 0.9;
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------ port picker */

  showPortPicker(nodeId, portIndex, clientX, clientY) {
    const picker = this.picker;
    if (!picker) return;
    const existing = incomingEdges(state.graph, nodeId).filter((e) => e.toPort === portIndex);
    const wrapRect = this.wrap.getBoundingClientRect();
    picker.innerHTML = '';
    picker.hidden = false;

    const header = document.createElement('div');
    header.className = 'hint';
    header.style.padding = '2px 8px 4px';
    header.textContent = `Input ${portIndex + 1}`;
    picker.appendChild(header);

    if (existing.length) {
      const b = document.createElement('button');
      b.textContent = 'Disconnect';
      b.addEventListener('click', () => {
        snapshot();
        disconnect(state.graph, nodeId, portIndex);
        bus.emit('graph:changed', { reason: 'disconnect' });
        this.hidePortPicker();
        this._schedule();
      });
      picker.appendChild(b);
    }

    // candidate upstream outputs
    const candidates = [];
    for (const n of state.graph.nodes) {
      if (n.id === nodeId) continue;
      if (wouldCreateCycle(state.graph, n.id, nodeId)) continue;
      const entry = registryEntry(n.name);
      const outs = entry && entry.outputs && entry.outputs.length ? entry.outputs.length : 1;
      for (let p = 0; p < outs; p++) candidates.push({ node: n, port: p });
    }
    if (!candidates.length) {
      const d = document.createElement('div');
      d.className = 'hint';
      d.style.padding = '2px 8px 4px';
      d.textContent = 'no other nodes';
      picker.appendChild(d);
    }
    for (const c of candidates.slice(0, 24)) {
      const b = document.createElement('button');
      b.textContent = `${c.node.name}${c.port > 0 ? ` [${c.port + 1}]` : ''}`;
      b.addEventListener('click', () => {
        this.tryConnect(c.node.id, nodeId, portIndex);
        this.hidePortPicker();
      });
      picker.appendChild(b);
    }

    const maxLeft = wrapRect.width - 140;
    picker.style.left = `${Math.max(4, Math.min(maxLeft, clientX - wrapRect.left))}px`;
    picker.style.top = `${Math.max(4, Math.min(wrapRect.height - 40, clientY - wrapRect.top))}px`;
  }

  hidePortPicker() { if (this.picker) this.picker.hidden = true; }

  /* ------------------------------------------------------------ commands */

  addNodeAt(name, wx, wy) {
    const schema = schemaFor(name);
    snapshot();
    const node = addNode(state.graph, name, Math.round(wx), Math.round(wy), defaultParams(schema));
    selectNode(node.id);
    bus.emit('graph:changed', { reason: 'add', id: node.id });
    this._schedule();
    return node;
  }

  addNodeCenter(name) {
    const c = this.viewCenter();
    const jitter = (state.graph.nodes.length % 5) * 14;
    return this.addNodeAt(name, c[0] - NODE_W / 2 + jitter, c[1] - NODE_H / 2 + jitter);
  }

  deleteSelected() {
    if (!state.selected) return false;
    const node = getNode(state.graph, state.selected);
    if (!node) return false;
    snapshot();
    removeNode(state.graph, state.selected);
    selectNode(null);
    this.onStatus(`deleted ${node.name}`);
    bus.emit('graph:changed', { reason: 'delete' });
    this._schedule();
    return true;
  }
}

/* ------------------------------------------------------------------ helpers */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function cubicAt(seg, t) {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return [
    a * seg.a.x + b * seg.c1[0] + c * seg.c2[0] + d * seg.b.x,
    a * seg.a.y + b * seg.c1[1] + c * seg.c2[1] + d * seg.b.y,
  ];
}

function clipText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 2 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

function categoryColor(cat) {
  switch (cat) {
    case 'Primitive / Noise': return '#6ea8fe';
    case 'Warp & Distort': return '#7ee0c0';
    case 'Adjust & Filter': return '#b9a2ff';
    case 'Combine & Route': return '#f5c66b';
    case 'Erosion & Flow': return '#5ed3a0';
    case 'Terrain Shape': return '#f0a35e';
    case 'Mask & Select': return '#e88fb0';
    case 'Input / Output': return '#9fb0c3';
    case 'Color / Fx': return '#c07ee8';
    default: return '#4a5768';
  }
}

export { NODE_W, NODE_H, categoryColor };

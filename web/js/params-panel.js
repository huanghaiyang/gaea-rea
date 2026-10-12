/**
 * params-panel.js — auto-generated parameter inspector.
 *
 * The panel is built ENTIRELY from the merged schema (vendor nodes.json + registry overrides),
 * so a catalogued node with no algorithm still gets a correct, typed parameter UI:
 *   Single   -> slider + numeric readout
 *   Int32/Byte -> number input (with step 1)
 *   Boolean  -> switch
 *   Enum     -> select built from the vendor option list
 *   Color    -> colour picker (+ alpha slider)
 *   Float2   -> two coupled numeric fields
 *   String   -> text field
 *   <none>   -> section header (group), rendered as a divider
 */

import { state, bus, schemaFor, isImplemented, registryEntry, nodeDescription, resetNodeParams, snapshot } from './state.js';
import { getNode } from './graph.js';
import { fmt, $ } from './util.js';

export class ParamsPanel {
  constructor(opts = {}) {
    this.list = $('#param-list');
    this.nameEl = $('#node-name');
    this.descEl = $('#node-desc');
    this.badgeEl = $('#node-badge');
    this.onChange = opts.onChange || (() => {});
    this.currentId = null;
    this.controls = new Map();  // paramName -> { read, write }
    this.pendingSnapshot = null;

    bus.on('selection:changed', () => this.render());
    bus.on('graph:replaced', () => this.render());
    bus.on('node:changed', ({ id }) => { if (id === this.currentId) this.render(); });
    bus.on('graph:changed', ({ reason }) => { if (reason !== 'move') this.render(); });
  }

  render() {
    const node = state.selected ? getNode(state.graph, state.selected) : null;
    this.currentId = node ? node.id : null;
    this.controls.clear();
    if (!this.list) return;

    if (!node) {
      this.nameEl.textContent = 'No selection';
      this.descEl.textContent = 'Select a node in the graph to edit its parameters.';
      this.descEl.classList.add('muted');
      this.badgeEl.hidden = true;
      this.list.innerHTML = '<p class="muted small">Nothing selected.</p>';
      return;
    }

    const entry = registryEntry(node.name);
    const impl = isImplemented(node.name);
    const catalogNode = state.catalogIndex.get(node.name);
    const schema = schemaFor(node.name);
    const groups = new Set((catalogNode && catalogNode.groups) || []);

    this.nameEl.textContent = node.name;
    this.descEl.textContent = nodeDescription(node.name) || (catalogNode && catalogNode.description) || 'No description available.';
    this.descEl.classList.remove('muted');

    // --- fidelity badge
    const note = entry && entry.note;
    let badgeText, badgeClass;
    if (!impl) { badgeText = note === 'stub' ? 'stub' : 'not implemented'; badgeClass = 'stub'; }
    else if (note === 'stub') { badgeText = 'stub'; badgeClass = 'stub'; }
    else if (note === 'model') { badgeText = 'model'; badgeClass = 'model'; }
    else if (note === 'approx') { badgeText = 'approx'; badgeClass = 'approx'; }
    else { badgeText = 'implemented'; badgeClass = 'ok'; }
    this.badgeEl.textContent = badgeText;
    this.badgeEl.className = `badge ${badgeClass}`;
    this.badgeEl.hidden = false;

    // --- body
    this.list.innerHTML = '';

    if (!impl) {
      const warn = document.createElement('div');
      warn.className = 'param-group';
      warn.textContent = 'not implemented — passes its first input through';
      this.list.appendChild(warn);
      const p = document.createElement('p');
      p.className = 'muted small';
      p.style.margin = '0 0 8px';
      p.textContent = note === 'stub'
        ? 'This node is catalogued and its parameters are editable, but the operation is a documented stub in this build.'
        : 'This node is catalogued from Nodes.json. Its parameters are generated from the schema, and evaluation falls back to a passthrough. See README.md for the implemented list.';
      this.list.appendChild(p);
    }

    const tree = document.createElement('div');
    tree.className = 'tree-controls';
    tree.style.display = 'flex';
    tree.style.gap = '6px';
    tree.style.margin = '0 0 8px';
    tree.innerHTML = `<button class="tb small" id="p-reset">Reset</button>
      <button class="tb small" id="p-preview">Pin preview</button>
      <button class="tb small" id="p-unpin">Unpin</button>`;
    this.list.appendChild(tree);
    tree.querySelector('#p-reset').addEventListener('click', () => {
      snapshot();
      resetNodeParams(node.id);
      bus.emit('node:changed', { id: node.id });
      this.onChange('reset');
    });
    tree.querySelector('#p-preview').addEventListener('click', () => {
      state.previewRoot = node.id;
      bus.emit('preview:changed', { id: node.id });
      this.render();
    });
    tree.querySelector('#p-unpin').addEventListener('click', () => {
      state.previewRoot = null;
      bus.emit('preview:changed', { id: null });
      this.render();
    });
    if (state.previewRoot === node.id) {
      tree.querySelector('#p-preview').classList.add('primary');
    }

    let currentGroup = null;
    void currentGroup;
    if (!schema.length && !(catalogNode && catalogNode.groups && catalogNode.groups.length)) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'This node exposes no parameters.';
      this.list.appendChild(p);
      return;
    }

    for (const p of schema) {
      if (groups.has(p.name) && p.control === 'group') {
        this.list.appendChild(groupHeader(p.name, p.description));
        continue;
      }
      const row = this.buildControl(node, p, schema);
      if (row) this.list.appendChild(row);
    }
  }

  buildControl(node, param, schema) {
    const row = document.createElement('div');
    row.className = 'param';
    const label = document.createElement('label');
    label.className = 'param-label';
    label.textContent = param.label || param.name;
    const src = param.source || { default: 'type', range: 'type' };
    const srcNote = src.default === 'il' && src.range === 'il'
      ? 'default and range recovered from the Gaea assembly'
      : src.default === 'il'
        ? 'default recovered from the Gaea assembly'
        : src.range === 'il'
          ? 'range recovered from the Gaea assembly'
          : src.default === 'registry'
            ? 'hand-tuned for this implementation'
            : 'conservative fallback (no recovered metadata)';
    label.title = `${param.name}${param.description ? ` — ${param.description}` : ''}\n(${srcNote})`;
    row.appendChild(label);

    const readout = document.createElement('span');
    readout.className = 'param-value';
    row.appendChild(readout);

    const control = document.createElement('div');
    control.className = 'param-control';
    row.appendChild(control);

    const key = param.name;
    const value = node.params && node.params[key] !== undefined ? node.params[key] : param.value;

    // Some vendor parameters declare an integer type but carry an option list; the option list
    // is the real control in that case.
    const effective = (param.control === 'number' && param.options && param.options.length) ? 'select' : param.control;

    switch (effective) {
      case 'toggle': {
        const sw = document.createElement('label');
        sw.className = 'switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!value;
        const txt = document.createElement('span');
        txt.textContent = value ? 'on' : 'off';
        sw.appendChild(input); sw.appendChild(txt);
        control.appendChild(sw);
        readout.textContent = '';
        input.addEventListener('change', () => {
          txt.textContent = input.checked ? 'on' : 'off';
          this.commit(node, key, input.checked);
        });
        this.controls.set(key, { write: (v) => { input.checked = !!v; txt.textContent = v ? 'on' : 'off'; } });
        return row;
      }

      case 'select': {
        const sel = document.createElement('select');
        const opts = param.options && param.options.length ? param.options : ['None'];
        for (const o of opts) {
          const opt = document.createElement('option');
          opt.value = o; opt.textContent = o;
          sel.appendChild(opt);
        }
        sel.value = String(value);
        control.appendChild(sel);
        readout.textContent = opts.length + ' opt';
        sel.addEventListener('change', () => this.commit(node, key, sel.value));
        this.controls.set(key, { write: (v) => { sel.value = String(v); } });
        return row;
      }

      case 'number': {
        const input = document.createElement('input');
        input.type = 'number';
        input.value = String(value);
        input.step = String(param.step || 1);
        if (param.min !== undefined) input.min = String(param.min);
        if (param.max !== undefined) input.max = String(param.max);
        control.appendChild(input);
        readout.textContent = '';
        input.addEventListener('change', () => {
          const n = Number(input.value);
          if (Number.isFinite(n)) this.commit(node, key, n);
        });
        this.controls.set(key, { write: (v) => { input.value = String(v); } });
        return row;
      }

      case 'color': {
        const arr = Array.isArray(value) ? value : [0.5, 0.5, 0.5, 1];
        const input = document.createElement('input');
        input.type = 'color';
        input.value = rgbToHex(arr[0], arr[1], arr[2]);
        const alpha = document.createElement('input');
        alpha.type = 'range'; alpha.min = '0'; alpha.max = '1'; alpha.step = '0.01';
        alpha.value = String(arr[3] !== undefined ? arr[3] : 1);
        const pair = document.createElement('div');
        pair.className = 'pair';
        pair.appendChild(input); pair.appendChild(alpha);
        control.appendChild(pair);
        readout.textContent = `a ${fmt(arr[3], 2)}`;
        const push = () => {
          const rgb = hexToRgb(input.value);
          alpha.setAttribute('aria-label', 'alpha');
          this.commit(node, key, [rgb[0], rgb[1], rgb[2], Number(alpha.value)]);
          readout.textContent = `a ${fmt(Number(alpha.value), 2)}`;
        };
        input.addEventListener('input', push);
        alpha.addEventListener('input', push);
        this.controls.set(key, {
          write: (v) => {
            const a = Array.isArray(v) ? v : [0.5, 0.5, 0.5, 1];
            input.value = rgbToHex(a[0], a[1], a[2]);
            alpha.value = String(a[3] !== undefined ? a[3] : 1);
            readout.textContent = `a ${fmt(a[3], 2)}`;
          },
        });
        return row;
      }

      case 'vector2': {
        const arr = Array.isArray(value) ? value : [param.min ?? 0, param.max ?? 1];
        const pair = document.createElement('div');
        pair.className = 'pair';
        const mk = (i, tag) => {
          const lab = document.createElement('label');
          const tagEl = document.createElement('span');
          tagEl.textContent = tag;
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.step = String(param.step || 0.01);
          inp.value = String(arr[i]);
          if (param.min !== undefined) inp.min = String(param.min);
          if (param.max !== undefined) inp.max = String(param.max);
          lab.appendChild(tagEl); lab.appendChild(inp);
          return { lab, inp };
        };
        const a = mk(0, 'X'), b = mk(1, 'Y');
        pair.appendChild(a.lab); pair.appendChild(b.lab);
        control.appendChild(pair);
        readout.textContent = '';
        const push = () => {
          const x = Number(a.inp.value), y = Number(b.inp.value);
          if (Number.isFinite(x) && Number.isFinite(y)) this.commit(node, key, [x, y]);
        };
        a.inp.addEventListener('change', push);
        b.inp.addEventListener('change', push);
        this.controls.set(key, {
          write: (v) => {
            const q = Array.isArray(v) ? v : [0, 1];
            a.inp.value = String(q[0]); b.inp.value = String(q[1]);
          },
        });
        return row;
      }

      case 'text': {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = String(value ?? '');
        input.spellcheck = false;
        control.appendChild(input);
        readout.textContent = '';
        input.addEventListener('change', () => this.commit(node, key, input.value));
        this.controls.set(key, { write: (v) => { input.value = String(v ?? ''); } });
        return row;
      }

      case 'group': {
        // a vendor section header that has no children: render as a divider only
        const div = groupHeader(param.name, param.description);
        return div;
      }

      default: {
        // slider: the workhorse for Single
        const useSlider = param.min !== undefined && param.max !== undefined && (param.max - param.min) <= 1e5;
        if (useSlider) {
          const range = document.createElement('input');
          range.type = 'range';
          range.min = String(param.min);
          range.max = String(param.max);
          range.step = String(param.step || 0.005);
          range.value = String(value);
          const num = document.createElement('input');
          num.type = 'number';
          num.style.width = '74px';
          num.style.flex = '0 0 auto';
          num.step = String(param.step || 0.005);
          num.value = String(value);
          control.appendChild(range);
          control.appendChild(num);
          readout.textContent = fmt(value);
          const push = (v) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return;
            readout.textContent = fmt(n);
            range.value = String(n);
            num.value = String(n);
            this.commit(node, key, n);
          };
          range.addEventListener('input', () => push(range.value));
          num.addEventListener('change', () => push(num.value));
          this.controls.set(key, { write: (v) => { range.value = String(v); num.value = String(v); readout.textContent = fmt(v); } });
        } else {
          const input = document.createElement('input');
          input.type = 'number';
          input.value = String(value);
          input.step = String(param.step || 0.01);
          control.appendChild(input);
          readout.textContent = '';
          input.addEventListener('change', () => {
            const n = Number(input.value);
            if (Number.isFinite(n)) this.commit(node, key, n);
          });
          this.controls.set(key, { write: (v) => { input.value = String(v); } });
        }
        return row;
      }
    }
  }

  /**
   * Persist a parameter change. A slider drag fires many `input` events; we take ONE history
   * snapshot per continuous interaction (cleared after 600ms of quiet) so undo steps are
   * meaningful rather than one-per-pixel.
   */
  commit(node, name, value) {
    this.snapshotOnce(node.id, name);
    node.params = node.params || {};
    node.params[name] = value;
    this.onChange(name, value, node);
  }

  snapshotOnce(nodeId, name) {
    const key = `${nodeId}:${name}`;
    if (this.pendingSnapshot === key) return;
    this.pendingSnapshot = key;
    snapshot();
    clearTimeout(this._snapTimer);
    this._snapTimer = setTimeout(() => { this.pendingSnapshot = null; }, 600);
  }

  /** Push external value changes into the existing controls without rebuilding the DOM. */
  syncValues() {
    const node = state.selected ? getNode(state.graph, state.selected) : null;
    if (!node || node.id !== this.currentId) return;
    for (const [name, ctl] of this.controls) {
      const v = node.params ? node.params[name] : undefined;
      if (v !== undefined && ctl.write) ctl.write(v);
    }
  }
}

function groupHeader(name, description) {
  const div = document.createElement('div');
  div.className = 'param-group';
  div.textContent = name;
  if (description) div.title = description;
  return div;
}

function rgbToHex(r, g, b) {
  const c = (v) => {
    const n = Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 255);
    return n.toString(16).padStart(2, '0');
  };
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export { rgbToHex, hexToRgb };

/**
 * library-panel.js — the searchable node library.
 *
 * Driven purely by data/nodes.json (182 entries) merged with the algorithm registry:
 *   green dot  = an algorithm is implemented in js/registry.js
 *   grey dot   = catalogued only; usable, evaluated as a passthrough
 *   dimmed     = filtered out by the active query/filter
 *
 * Clicking an entry adds that node to the graph at the centre of the view.
 */

import { state, bus, schemaFor, isImplemented, nodeDescription, registryEntry, categoryOf } from './state.js';
import { $, esc } from './util.js';

export class LibraryPanel {
  constructor(opts = {}) {
    this.list = $('#lib-list');
    this.search = $('#lib-search');
    this.count = $('#lib-count');
    this.filters = $('#lib-filters');
    this.onAdd = opts.onAdd || (() => {});
    this.items = new Map(); // name -> element

    this.search.addEventListener('input', () => {
      state.libQuery = this.search.value.trim().toLowerCase();
      this.render();
    });
    this.filters.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      state.libFilter = btn.dataset.filter;
      for (const c of this.filters.querySelectorAll('.chip')) c.classList.toggle('active', c === btn);
      this.render();
    });
    bus.on('graph:changed', () => this.refreshUsage());
    bus.on('graph:replaced', () => this.refreshUsage());
  }

  build(catalog) {
    this.catalog = catalog.nodes || [];
    this.render();
  }

  /** Names currently present anywhere in the graph. */
  usedNames() {
    const s = new Set();
    for (const n of state.graph.nodes) s.add(n.name);
    return s;
  }

  matches(name) {
    const q = state.libQuery;
    if (!q) return true;
    if (name.toLowerCase().includes(q)) return true;
    const cat = state.catalogIndex.get(name);
    const desc = ((cat && cat.description) || '').toLowerCase();
    if (desc.includes(q)) return true;
    // also match parameter names so "octaves" or "mask" finds relevant nodes
    const schema = schemaFor(name);
    for (const p of schema) if (p.name.toLowerCase().includes(q)) return true;
    return false;
  }

  render() {
    if (!this.list) return;
    const used = this.usedNames();
    const filter = state.libFilter;
    const frag = document.createDocumentFragment();
    this.items.clear();

    const groups = new Map();
    let shown = 0;
    let implCount = 0;

    for (const cat of this.catalog) {
      const name = cat.name;
      const impl = isImplemented(name);
      if (impl) implCount++;
      if (!this.matches(name)) continue;
      if (filter === 'implemented' && !impl) continue;
      if (filter === 'catalog' && impl) continue;
      if (filter === 'used' && !used.has(name)) continue;

      const group = categoryOf(name);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ cat, impl, name });
      shown++;
    }

    const order = [
      'Input / Output', 'Primitive / Noise', 'Terrain Shape', 'Warp & Distort',
      'Adjust & Filter', 'Combine & Route', 'Mask & Select', 'Erosion & Flow',
      'Color / Fx', 'Catalog only (no algorithm)',
    ];
    const keys = Array.from(groups.keys()).sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });

    for (const group of keys) {
      const head = document.createElement('div');
      head.className = 'lib-group';
      head.textContent = `${group} · ${groups.get(group).length}`;
      frag.appendChild(head);
      for (const item of groups.get(group)) {
        frag.appendChild(this.makeItem(item.cat, item.impl, used.has(item.name)));
      }
    }

    this.list.innerHTML = '';
    this.list.appendChild(frag);

    if (this.count) {
      this.count.textContent = `${shown}/${this.catalog.length} · ${implCount} impl`;
      this.count.title = `${implCount} of ${this.catalog.length} nodes have an algorithm in this build`;
    }
  }

  makeItem(cat, impl, isUsed) {
    const el = document.createElement('div');
    el.className = `lib-item${impl ? ' impl' : ''}${isUsed ? ' used' : ''}`;
    el.setAttribute('role', 'option');
    el.tabIndex = 0;

    const dot = document.createElement('span');
    dot.className = 'dot';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = cat.name;
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    const paramCount = (cat.params || []).length;
    cnt.textContent = impl ? String(paramCount) : '—';

    const summary = nodeDescription(cat.name) || cat.description || '';
    el.title = `${cat.name}${impl ? '' : '  [catalog only]'}\n${summary}\n${paramCount} parameters`;
    el.appendChild(dot); el.appendChild(nm); el.appendChild(cnt);

    const activate = () => this.onAdd(cat.name);
    el.addEventListener('click', activate);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    this.items.set(cat.name, el);
    return el;
  }

  /** Cheap update of the "in graph" highlight without rebuilding the list. */
  refreshUsage() {
    const used = this.usedNames();
    for (const [name, el] of this.items) el.classList.toggle('used', used.has(name));
  }
}

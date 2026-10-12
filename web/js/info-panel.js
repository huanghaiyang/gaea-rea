/**
 * info-panel.js — the Info tab: build facts, per-node evaluation timings, diagnostics and
 * honest coverage numbers.
 */

import { state, bus } from './state.js';
import { $, fmtMs, fmt } from './util.js';

/** Local HTML escape (kept here so the panel has no dependency on util's markup helpers). */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class InfoPanel {
  constructor() {
    this.evalTable = $('#info-eval');
    this.timings = $('#info-timings');
    this.errors = $('#info-errors');
    this.coverage = $('#info-coverage');
    bus.on('eval:done', (r) => this.update(r));
    bus.on('eval:start', () => this.markBusy());
    bus.on('selection:changed', () => this.update(state._lastResult));
  }

  markBusy() {
    if (this.evalTable) this.evalTable.innerHTML = '<tr><td>status</td><td>evaluating…</td></tr>';
  }

  update(result) {
    if (result) state._lastResult = result;
    const r = state._lastResult;
    const g = state.graph;

    if (this.evalTable) {
      const rows = [
        ['nodes in graph', String(g.nodes.length)],
        ['connections', String(g.edges.length)],
        ['resolution', `${g.build.size} x ${g.build.size}`],
        ['global seed', String(g.build.seed)],
        ['last pass', r ? fmtMs(r.ms) : '—'],
        ['engine', r ? (r.inline ? 'main thread' : 'worker') : '—'],
        ['rendering', state.glAvailable ? 'WebGL2' : 'Canvas2D'],
        ['viewport', state.viewMode === '3d' ? '3D' : '2D'],
      ];
      if (r && r.fields && r.fields.length) {
        const f = r.fields[0];
        rows.push(['field min', fmt(f.min)]);
        rows.push(['field max', fmt(f.max)]);
        rows.push(['field mean', fmt(f.mean)]);
        rows.push(['field std', fmt(f.std)]);
        rows.push(['measured px', `${f.size} x ${f.size}`]);
      }
      if (r && r.fields) rows.push(['fields cached', String(r.fields.length)]);
      this.evalTable.innerHTML = `<tbody>${rows
        .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody>`;
    }

    if (this.timings) {
      const stats = (r && r.stats) || state.lastStats;
      if (!stats || !stats.length) {
        this.timings.innerHTML = '<span class="muted small">run an evaluation</span>';
      } else {
        const max = Math.max(...stats.map((s) => s.ms), 0.001);
        const sorted = stats.slice().sort((a, b) => b.ms - a.ms).slice(0, 14);
        this.timings.innerHTML = sorted.map((s) => `
          <div class="timing-row">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</span>
            <span style="display:flex;align-items:center;gap:6px;flex:0 0 auto">
              <span class="bar" style="width:${Math.max(2, Math.round((s.ms / max) * 54))}px"></span>
              <span class="mono" style="min-width:52px;text-align:right">${s.ms.toFixed(1)}</span>
            </span>
          </div>`).join('');
      }
    }

    if (this.errors) {
      const errs = (r && r.errors) || state.lastErrors;
      if (!errs || !errs.length) {
        this.errors.className = 'errors';
        this.errors.textContent = 'no errors';
      } else {
        this.errors.className = 'errors has';
        this.errors.textContent = errs.map((e) => `${e.nodeId ? e.nodeId.slice(0, 6) + ' ' : ''}${e.message}`).join('\n');
      }
    }

    if (this.coverage) {
      const algos = state.implementedCount || 0;
      const covered = state.catalogCovered || 0;
      const total = state.catalog ? state.catalog.nodes.length : 0;
      this.coverage.textContent =
        `${algos} node algorithms are shipped in this build (js/registry.js). ` +
        `${covered} of the ${total} catalogued nodes run one under their own name; 4 more ` +
        `(DuneSea, EasyErosion, Snowfield, Thermal2) resolve by alias. The remaining catalogued ` +
        `nodes are fully browsable with editable, schema-generated parameters but evaluate as ` +
        `passthroughs. See README.md and IMPLEMENTATION-NOTES.md.`;
    }
  }
}

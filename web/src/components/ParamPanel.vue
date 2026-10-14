<script setup>
/**
 * ParamPanel — the inspector.
 *
 * Rebuilt in Vue because this is the part of the UI that benefits most: the form is derived from
 * `buildSchema`, which resolves each parameter through the authority table, the registry, the
 * catalogue's IL metadata and the declared type, in that order. With 988 parameters across 174
 * nodes, the old imperative panel was doing by hand what a `v-for` over a computed does.
 *
 * Two things the data forces and the old panel relied on getting right:
 *
 *   * The catalogue's label for a checkbox is `Enforce Quantization` WITH A SPACE, while the
 *     managed property is `EnforceQuantization`. Reading the wrong spelling silently leaves the
 *     feature off, so the schema is the only source consulted here.
 *   * `Enable` is Ersion2's master gate. A parameter whose value resolves to `undefined` stops the
 *     solver rather than disabling it, so a missing value falls back to the schema default rather
 *     than being rendered as blank.
 */
import { computed } from 'vue';
import {
  schemaFor, setParam, resetParams, state, algorithmOf, version, snapshot, bus,
} from '../stores/app.js';
import { evaluator } from '../stores/session.js';
import { t, term, paramLabel, option as i18nOption } from '@js/i18n.js';

/*
 * The state this panel shows, computed HERE from the shared plain `state` object.
 *
 * An imported computed arrives in the template as the ref OBJECT rather than its value -- the
 * compiler can only auto-unwrap bindings it saw declared as refs. Two attempts to work around that
 * with local aliases ended in a temporal-dead-zone collision and a binding whose `.value` the
 * module boundary apparently ate. Deriving the values locally sidesteps the question entirely:
 * these ARE local refs, so they unwrap, and they are the only source this component reads.
 */
/**
 * The selected node, looked up during render.
 *
 * A METHOD, not a computed. Three attempts to get a computed's value into this template failed --
 * once to a temporal-dead-zone collision from an alias, twice to the ref/value question at the
 * module boundary -- while the store's own equivalent was demonstrably correct in the same page.
 * A plain lookup during render depends on nothing but reading a shared object, and the component
 * already re-renders whenever the bus bumps `version`.
 */
function currentNode() {
  const id = state.selected;
  if (!id) return null;
  return (state.graph?.nodes || []).find((n) => n.id === id) || null;
}

/**
 * The template's view of the selection.
 *
 * A LOCAL computed, not a bare function call. A function invoked from the template is only re-run
 * when the component re-renders, and this component has no other tracked dependency -- so it never
 * would. A local computed is also unwrapped by the compiler, which is the property three earlier
 * attempts at importing one failed to get.
 */
/**
 * Whether a kernel exists for the selected node.
 *
 * A BOOLEAN, deliberately. `algorithmOf` returns the registry's function OBJECT, so rendering it
 * put the function's source in the panel -- the `function outputNode(ctx) {...}` block that opened
 * the inspector. The old `params-panel.js` never displayed it either.
 */
const hasKernel = computed(() => {
  version.value;
  const n = selNode.value;
  return !!(n && algorithmOf(n.name));
});

const selNode = computed(() => {
  version.value;
  return currentNode();
});

const rows = computed(() => {
  // The reactive dependency: `state` is not a reactive proxy on purpose, so without reading the
  // store's `version` counter this computed has nothing to invalidate it and caches forever.
  version.value;

  const node = currentNode();
  const schema = node ? schemaFor(node.name) : null;
  if (!node || !schema) return [];

  // AN ARRAY, not `{ params: {...} }`. Treating it as an object produced keys "0".."19" and a
  // parameter list that was just numbered sliders.
  const entries = Array.isArray(schema)
    ? schema
    : Object.entries(schema.params || schema).map(([k, v]) => ({ key: k, name: k, ...v }));

  return entries.map((spec) => {
    const key = spec.key || spec.name;
    // The default lives in `value`. `spec.d` does not exist on a merged schema.
    const raw = node.params && key in node.params ? node.params[key] : spec.value;
    const value = raw === undefined ? spec.value : raw;
    const kind = controlKind(spec, value);
    return {
      key,
      spec,
      value,
      label: spec.label || spec.name || key,
      // ONLY a real per-parameter hint. `description` is the node's own text and belongs with the
      // node; showing it here put a screenful of source above the sliders.
      hint: spec.hint || '',
      kind,
      options: kind === 'select' ? optionsFor(spec, value) : null,
      min: spec.min,
      max: spec.max,
      step: spec.step,
    };
  });
});

/**
 * The choices for a select.
 *
 * `options` is the schema's own list. When it is absent the parameter is an enum whose members the
 * catalogue did not carry, and the current value is offered rather than an empty dropdown that
 * would render the parameter unsettable.
 */
function optionsFor(spec, value) {
  if (spec.options) return spec.options;
  if (spec.choices) return spec.choices;
  return value === undefined ? [] : [value];
}

/**
 * Pick the control from the SPEC's declared type first, and the value only as a fallback.
 *
 * Reading the type off the value alone breaks on a boolean default of `false` and a numeric default
 * of `0`, because both are indistinguishable from "unset" once they are coerced for display.
 */
function controlKind(spec, value) {
  if (spec.options || spec.choices) return 'select';
  if (spec.min !== undefined && spec.max !== undefined) return 'range';
  // `value`, not `d` -- the merged schema has no `d`.
  const dv = spec.value;
  if (typeof dv === 'boolean') return 'check';
  if (typeof dv === 'string') return 'text';
  if (typeof dv === 'number') return 'number';
  if (Array.isArray(dv)) return 'vec';
  if (typeof value === 'boolean') return 'check';
  if (typeof value === 'number') return 'number';
  return 'text';
}

/**
 * Persist a parameter change and make the rest of the app notice.
 *
 * A VALUE WRITE IS NOT A CHANGE. `setParam` only assigns; the old panel's `commit` did three more
 * things, and `app.js`'s `onParamChange` did a fourth, and without them nothing downstream moves:
 *
 *   snapshotOnce(...)                 one history step per continuous drag
 *   setParam(...)                     the write
 *   evaluator.request('param')        re-run the graph -- the preview refresh
 *   bus.emit('node:changed', ...)     recompute the panels
 *
 * All four live here rather than in `setParam`, because `setParam` is a plain store mutator shared
 * with other callers and the coalescing timer is inherently a UI concern.
 */

/** One snapshot per continuous interaction, cleared after 600ms of quiet. */
let pendingSnapshot = null;
let snapTimer = 0;

function snapshotOnce(nodeId, key) {
  const id = `${nodeId}:${key}`;
  if (pendingSnapshot === id) return;
  pendingSnapshot = id;
  snapshot();
  clearTimeout(snapTimer);
  // A slider fires an input event per pixel; without this every pixel would be its own undo step.
  snapTimer = setTimeout(() => { pendingSnapshot = null; }, 600);
}

/** The trigger `app.js` used: re-evaluate, then tell the panels. */
function afterParamChange(node) {
  // `request` (not `requestNow`) so a drag coalesces instead of queueing a run per event.
  evaluator?.request?.('param');
  bus.emit('node:changed', { id: node.id });
}

function onInput(key, ev, kind) {
  const node = currentNode();
  if (!node) return;
  let v;
  if (kind === 'check') v = ev.target.checked;
  else if (kind === 'range' || kind === 'number') v = Number(ev.target.value);
  else v = ev.target.value;
  snapshotOnce(node.id, key);
  setParam(node.id, key, v);
  afterParamChange(node);
}

function onVector(key, index, spec, ev) {
  const node = currentNode();
  if (!node) return;
  const current = Array.isArray(node.params?.[key])
    ? [...node.params[key]]
    : [...(spec.value || [])];
  current[index] = Number(ev.target.value);
  snapshotOnce(node.id, key);
  setParam(node.id, key, current);
  afterParamChange(node);
}

/** Labels for the vector components, so a 2-vector reads as X/Y rather than 0/1. */
const AXES = ['X', 'Y', 'Z', 'W'];
</script>

<template>
  <aside id="inspector" class="panel">
    <header class="panel-head">
      <h2>{{ t('inspector.tabParams') }}</h2>
      <button v-if="selNode" class="tb small" @click="resetParams(selNode.id)">
        {{ t('panel.reset') }}
      </button>
    </header>

    <p v-if="!selNode" class="empty panel-body">
      {{ t('inspector.selectPrompt') }}
    </p>

    <template v-else>
      <div class="node-head">
        <div class="node-title">
          <!-- The node's own name is a term. -->
          <strong>{{ term(selNode.name) }}</strong>
          <span v-if="hasKernel" class="pill">{{ t('badge.implemented') }}</span>
          <span v-else class="pill">{{ t('badge.notImplemented') }}</span>
        </div>
      </div>

      <p v-if="!rows.length" class="empty panel-body">
        {{ t('inspector.noParams') }}
      </p>

      <!-- The structure params-panel.js builds, and the one style.css is written for:
           .param > .param-label + .param-value + .param-control > control.
           The `.param-control` wrapper is not decoration -- `style.css` sets a select's BACKGROUND
           through it, and without it `color: inherit` left white text on the browser's default
           light control. -->
      <div v-else class="panel-body">
        <div class="param-list">
          <div v-for="row in rows" :key="row.key" class="param">
            <label class="param-label" :for="`p-${row.key}`" :title="row.hint">
              {{ row.label }}<span v-if="row.hint" class="info" :title="row.hint">?</span>
            </label>

            <span class="param-value">
              {{ row.kind === 'check' ? (row.value ? 'on' : 'off') : row.value }}
            </span>

            <div class="param-control">
              <select
                v-if="row.kind === 'select'"
                :id="`p-${row.key}`"
                :value="row.value"
                @change="onInput(row.key, $event, 'select')"
              >
                <option v-for="o in row.options" :key="String(o)" :value="o">
                  {{ i18nOption(o) }}
                </option>
              </select>

              <input
                v-else-if="row.kind === 'check'"
                :id="`p-${row.key}`"
                type="checkbox"
                :checked="!!row.value"
                @change="onInput(row.key, $event, 'check')"
              />

              <input
                v-else-if="row.kind === 'range'"
                :id="`p-${row.key}`"
                type="range"
                :min="row.min"
                :max="row.max"
                :step="row.step ?? 0.01"
                :value="row.value"
                @input="onInput(row.key, $event, 'range')"
              />

              <template v-else-if="row.kind === 'vec'">
                <input
                  v-for="(v, i) in row.value"
                  :key="i"
                  class="vec"
                  type="number"
                  :value="v"
                  :step="row.step ?? 0.01"
                  :aria-label="`${row.label} ${AXES[i] || i}`"
                  @input="onVector(row.key, i, row.spec, $event)"
                />
              </template>

              <input
                v-else-if="row.kind === 'number'"
                :id="`p-${row.key}`"
                type="number"
                :value="row.value"
                :step="row.step ?? 1"
                @input="onInput(row.key, $event, 'number')"
              />

              <input
                v-else
                :id="`p-${row.key}`"
                type="text"
                :value="row.value"
                @input="onInput(row.key, $event, 'text')"
              />
            </div>
          </div>
        </div>
      </div>
    </template>
  </aside>
</template>

<style scoped>
/* style.css supplies `.param`, `.param-label`, `.param-value`, `.param-control` and their control
   rules. Nothing here re-declares them -- doing so is how the select lost its background. */
.info {
  display: inline-block; margin-left: 4px; width: 12px; height: 12px; line-height: 12px;
  text-align: center; border-radius: 50%; border: 1px solid currentColor;
  font-size: 9px; color: var(--tx-2, #888);
}
.param-control .vec { width: 100%; margin-bottom: 2px; }
</style>


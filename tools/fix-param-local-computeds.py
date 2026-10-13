#!/usr/bin/env python3
"""Give ParamPanel its own computeds, built from the plain `state` object.

WHY THIS REPLACES THE ALIAS APPROACH
Three attempts went into getting an imported computed to arrive in the template as a value:
aliasing to a local const, renaming to dodge a TDZ collision, and probing `window.__store`. The
probe kept reporting that the imported binding had no `.value` while the template kept receiving
something truthy with no `.name` -- and rather than keep guessing at the module boundary, the
robust move is to not cross it.

`state` is a plain object shared by every module, so a computed declared HERE over `state` is
unambiguously a local ref: the compiler sees it declared, unwraps it in the template, and there is
no import to reason about. This is the fix that does not depend on how the bundler or the compiler
treats an imported binding.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "ParamPanel.vue"
t = p.read_text(encoding="utf-8")

start = t.find("import { computed } from 'vue';")
end = t.find("/** Labels for the vector components")
if start < 0 or end < 0:
    print("  !! script markers not found")
    sys.exit(1)

NEW = """import { computed } from 'vue';
import {
  schemaFor, setParam, resetParams, state, algorithmOf,
} from '../stores/app.js';
import { term, paramLabel, option as i18nOption } from '@js/i18n.js';

/*
 * The state this panel shows, computed HERE from the shared plain `state` object.
 *
 * An imported computed arrives in the template as the ref OBJECT rather than its value -- the
 * compiler can only auto-unwrap bindings it saw declared as refs. Two attempts to work around that
 * with local aliases ended in a temporal-dead-zone collision and a binding whose `.value` the
 * module boundary apparently ate. Deriving the values locally sidesteps the question entirely:
 * these ARE local refs, so they unwrap, and they are the only source this component reads.
 */
const selNode = computed(() => {
  const id = state.selected;
  if (!id) return null;
  return (state.graph?.nodes || []).find((n) => n.id === id) || null;
});

const selSchema = computed(() => {
  const n = selNode.value;
  return n ? schemaFor(n.name) || null : null;
});

/** The parameter list, in a stable order so the form does not reshuffle between nodes. */
const rows = computed(() => {
  const schema = selSchema.value;
  const node = selNode.value;
  if (!schema || !node) return [];
  const params = schema.params || schema;
  return Object.entries(params).map(([name, spec]) => {
    // `d` is the resolved default; a value that lands on `undefined` must fall back to it, because
    // `Enable` is Erosion2's master gate and an undefined gate silently stops the solver.
    const raw = node.params && name in node.params ? node.params[name] : spec.d;
    const value = raw === undefined ? spec.d : raw;
    const kind = controlKind(spec, value);
    return {
      name,
      spec,
      value,
      label: paramLabel(name) || name,
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
 * `spec.options` is the schema's own list; when it is absent the parameter is an enum whose values
 * the catalogue did not carry, and the current value is offered rather than an empty dropdown that
 * would render the parameter unsettable.
 */
function optionsFor(spec, value) {
  if (spec.options) return spec.options;
  if (spec.choices) return spec.choices;
  return value === undefined ? [] : [value];
}

/**
 * Pick the control from the SPEC's declared type first and the value only as a fallback.
 *
 * Reading the type off the value alone breaks on a boolean default of `false` and a numeric
 * default of `0`, because both are indistinguishable from "unset" once coerced for display.
 */
function controlKind(spec, value) {
  if (spec.options || spec.choices) return 'select';
  if (spec.min !== undefined && spec.max !== undefined) return 'range';
  if (typeof spec.d === 'boolean') return 'check';
  if (typeof spec.d === 'string') return 'text';
  if (typeof spec.d === 'number') return 'number';
  if (Array.isArray(spec.d)) return 'vec';
  if (typeof value === 'boolean') return 'check';
  if (typeof value === 'number') return 'number';
  return 'text';
}

function onInput(name, ev, kind) {
  const node = selNode.value;
  if (!node) return;
  let v;
  if (kind === 'check') v = ev.target.checked;
  else if (kind === 'range' || kind === 'number') v = Number(ev.target.value);
  else v = ev.target.value;
  setParam(node.id, name, v);
}

function onVector(name, index, spec, ev) {
  const node = selNode.value;
  if (!node) return;
  const current = Array.isArray(node.params?.[name])
    ? [...node.params[name]]
    : [...(spec.d || [])];
  current[index] = Number(ev.target.value);
  setParam(node.id, name, current);
}

"""

t = t[:start] + NEW + t[end:]

# The template already refers to `selNode`, `rows`, `algorithmOf`, `resetParams`, `setParam`.
# Nothing else to rewrite: `term` and `i18nOption` are still imported above.
p.write_text(t, encoding="utf-8")
print("  ParamPanel.vue: own computeds over the shared state; no imported refs in the template")

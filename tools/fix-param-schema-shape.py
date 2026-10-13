#!/usr/bin/env python3
"""Make ParamPanel read the schema shape `buildSchema` actually returns.

WHAT THE SCHEMA IS
`buildSchema` returns an ARRAY of entries built by `mergeParam`, each of the form:

    { name, key, type, control, description, options, value, min, max, step, source, hint?, label? }

The panel treated it as `{ params: {...} }` and fell back to iterating it as an object, which gave
`Object.entries`-style keys of "0", "1", "2" ... "19" -- exactly the numbered sliders in the
screenshot, with no parameter names at all.

Four further mismatches, all from the same unverified assumption:
  * the default lives in `value`, not `d` -- `spec.d` was always undefined
  * storage identity is `key`, not `name`; they differ whenever the vendor catalogue repeats a
    label, and `key` is what `setNodeParam` expects
  * `label` is optional, so `name` is the display text
  * `description` is the NODE-level text. Rendering it as each parameter's hint is what put a
    screenful of `function snow(ctx) {...}` above the sliders.

`description` is deliberately no longer shown per-parameter; the node's own description belongs
with the node, and a hint is only shown when the parameter actually carries one.
"""
import pathlib
import sys

P = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "ParamPanel.vue"
t = P.read_text(encoding="utf-8")

start = t.find("const rows = computed(() => {")
end = t.find("function onInput(name, ev, kind) {")
if start < 0 or end < 0:
    print("  !! rows block not found")
    sys.exit(1)

NEW = """const rows = computed(() => {
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

"""
t = t[:start] + NEW + t[end:]

# The mutators must address parameters by `key`, which is what `setNodeParam` stores under.
old = """function onInput(name, ev, kind) {
  const node = currentNode();
  if (!node) return;
  let v;
  if (kind === 'check') v = ev.target.checked;
  else if (kind === 'range' || kind === 'number') v = Number(ev.target.value);
  else v = ev.target.value;
  setParam(node.id, name, v);
}

function onVector(name, index, spec, ev) {
  const node = currentNode();
  if (!node) return;
  const current = Array.isArray(node.params?.[name])
    ? [...node.params[name]]
    : [...(spec.d || [])];
  current[index] = Number(ev.target.value);
  setParam(node.id, name, current);
}"""
new = """function onInput(key, ev, kind) {
  const node = currentNode();
  if (!node) return;
  let v;
  if (kind === 'check') v = ev.target.checked;
  else if (kind === 'range' || kind === 'number') v = Number(ev.target.value);
  else v = ev.target.value;
  setParam(node.id, key, v);
}

function onVector(key, index, spec, ev) {
  const node = currentNode();
  if (!node) return;
  const current = Array.isArray(node.params?.[key])
    ? [...node.params[key]]
    : [...(spec.value || [])];
  current[index] = Number(ev.target.value);
  setParam(node.id, key, current);
}"""
if old not in t:
    print("  !! mutators not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# controlKind read `spec.d`; it must read `spec.value`.
t = t.replace("""function controlKind(spec, value) {
  if (spec.options || spec.choices) return 'select';
  if (spec.min !== undefined && spec.max !== undefined) return 'range';
  if (typeof spec.d === 'boolean') return 'check';
  if (typeof spec.d === 'string') return 'text';
  if (typeof spec.d === 'number') return 'number';
  if (Array.isArray(spec.d)) return 'vec';""",
"""function controlKind(spec, value) {
  if (spec.options || spec.choices) return 'select';
  if (spec.min !== undefined && spec.max !== undefined) return 'range';
  // `value`, not `d` -- the merged schema has no `d`.
  const dv = spec.value;
  if (typeof dv === 'boolean') return 'check';
  if (typeof dv === 'string') return 'text';
  if (typeof dv === 'number') return 'number';
  if (Array.isArray(dv)) return 'vec';""", 1)

# The template binds on `row.name`; it is `row.key` now.
for a, b in ((':key="row.name"', ':key="row.key"'),
             (':id="`p-${row.name}`"', ':id="`p-${row.key}`"'),
             ('row.name, $event', 'row.key, $event')):
    t = t.replace(a, b)

P.write_text(t, encoding="utf-8")
print("  ParamPanel.vue: array schema, key/value/label fields, no node description as a hint")

#!/usr/bin/env python3
"""Re-add the two helpers my block replacement removed.

Rewriting the `rows` computed to the correct schema shape replaced everything from the start of
that block to `function onInput`, which also deleted `optionsFor` and `controlKind` sitting between
them. The result was a boot-time `ReferenceError: controlKind is not defined` that aborted the whole
component.
"""
import pathlib
import sys

P = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "ParamPanel.vue"
t = P.read_text(encoding="utf-8")

if "function controlKind" in t:
    print("  helpers already present")
    sys.exit(0)

anchor = "function onInput(key, ev, kind) {"
if anchor not in t:
    print("  !! onInput not found")
    sys.exit(1)

HELPERS = """/**
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

"""

t = t.replace(anchor, HELPERS + anchor, 1)
P.write_text(t, encoding="utf-8")
print("  ParamPanel.vue: optionsFor and controlKind restored before onInput")

#!/usr/bin/env python3
"""Generate the authoritative parameter table from the managed assembly's attributes.

113 of 224 registry parameters disagreed with the `[Parameter(default, min, max)]` attribute
that the runtime actually reads — some of them wildly, e.g. `Blur.Radius` was 4.0/0..128 where
the authoritative value is 0.1/0..2, and several `Scale`/`Size` parameters were guessed as
0..300 where the real range is normalised 0..1.

Rather than rewriting that many scattered literals in hand-written source, this emits a single
generated table that the registry applies on top of its own values. That keeps the change:

  * reproducible — regenerate from the assembly, never hand-edit
  * auditable — one file, every override in one place
  * non-destructive — parameters the table does not mention keep their existing definition

Usage:  python tools/gen-param-authority.py
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
ROUTING = WS / "docs" / "node-routing.json"
OUT = WS / "web" / "js" / "param-authority.js"

NUM = re.compile(r"^-?\d+(?:\.\d+)?f?$")
INT_TYPES = {"int", "uint", "short", "byte", "long"}


def parse_meta(meta: str):
    """Return (default, min, max), with `default` possibly None for a partial extraction.

    Three shapes occur in the assembly:

      [Parameter(0.44f, 0f, 4f)]                        plain: default, min, max
      [Parameter(Parameters.Enum, SomeEnum.X, 0f, 1f)]  enum default, numeric range
      [Parameter(0f, 1f, 0f, 1f)]                       TWO (min, max) pairs, a range parameter

    The middle shape still yields a usable RANGE even though the default is an enum member, so
    it is extracted with `default = None` rather than discarded. The third shape is not
    extracted at all: with four numbers there is no way to know which pair is the default
    without reading the property's declaring type, and guessing would put a wrong default on a
    slider — which is the failure this whole table exists to prevent.
    """
    parts = [p.strip() for p in meta.split(",") if p.strip()]
    if len(parts) < 2:
        return None
    nums = [p for p in parts if NUM.match(p)]
    if len(nums) < 2:
        return None
    # Four or more numbers means paired ranges; refuse rather than guess.
    if len(nums) >= 4:
        return None
    tail = parts[-3:]
    if len(tail) == 3 and all(NUM.match(p) for p in tail):
        vals = [float(p.rstrip("fF")) for p in tail]
        return vals[0], vals[1], vals[2]
    # Enum default plus a numeric range: take the last two as min and max.
    last2 = parts[-2:]
    if all(NUM.match(p) for p in last2):
        lo, hi = (float(p.rstrip("fF")) for p in last2)
        if hi > lo:
            return None, lo, hi
    return None


def main() -> int:
    routing = json.loads(ROUTING.read_text(encoding="utf-8"))

    table: dict[str, dict] = {}
    unresolved = 0
    for node, meta in routing["nodes"].items():
        for p in meta["params"]:
            # A name the extractor could not resolve is emitted as "?" by tools/node-routing.py.
            # Such an entry can never match a real parameter, so including it would only pad the
            # table and hide the extraction gap. Skipped and counted instead.
            if p["name"] == "?":
                unresolved += 1
                continue
            parsed = parse_meta(p["meta"])
            if parsed is None:
                continue
            default, lo, hi = parsed
            # A range whose max is 1 and min is 0 is a normalised 0..1 parameter; a sensible
            # step for the UI is 100x smaller than the span, floored so it is never 0.
            span = hi - lo
            if span <= 0:
                continue
            step = span / 100
            entry: dict = {"min": lo, "max": hi}
            # `default` is None when the attribute carries an enum default, in which case the
            # range is still authoritative but the default must come from elsewhere.
            if default is not None:
                entry["d"] = default
            if step > 0:
                entry["step"] = round(step, 6)
            table.setdefault(node, {})[p["name"]] = entry

    lines = [
        "/**",
        " * param-authority.js — GENERATED. Do not edit by hand.",
        " *",
        " * Source: the `[Parameter(default, min, max)]` attributes in the decompiled managed",
        " * assembly (`Gaea.Nodes.whole.cs`), extracted by `tools/node-routing.py`.",
        " *",
        " * WHY THIS FILE EXISTS",
        " * The registry's parameter ranges were partly guessed. An audit found 113 of 224",
        " * comparable parameters disagreeing with the attribute the runtime actually reads,",
        " * including `Blur.Radius` (guessed 4.0 / 0..128; authoritative 0.1 / 0..2) and several",
        " * `Scale`/`Size` parameters guessed as 0..300 where the real range is normalised 0..1.",
        " * A wrong range is not a cosmetic problem: it changes what the UI lets a user express,",
        " * so the node becomes impossible to drive the way Gaea drives it.",
        " *",
        " * Regenerate with:  python tools/gen-param-authority.py",
        " */",
        "",
        "/**",
        " * `nodeName -> paramName -> {d, min, max, step}`. Only parameters with a purely numeric",
        " * attribute appear; enum and list attributes are skipped because their values are not",
        " * numbers and the registry already declares them from the catalogue.",
        " */",
        "export const AUTHORITATIVE_PARAMS = {",
    ]
    for node in sorted(table):
        lines.append(f"  {json.dumps(node, ensure_ascii=False)}: {{")
        for pname in sorted(table[node]):
            e = table[node][pname]
            bits = []
            # `d` is absent when the attribute carried an enum default; the range is still
            # authoritative, so the entry is emitted without a default rather than with a guess.
            if "d" in e:
                bits.append(f"d: {e['d']}")
            bits.append(f"min: {e['min']}")
            bits.append(f"max: {e['max']}")
            if "step" in e:
                bits.append(f"step: {e['step']}")
            lines.append(f"    {json.dumps(pname, ensure_ascii=False)}: {{ {', '.join(bits)} }},")
        lines.append("  },")
    lines.append("};")
    lines.append("")
    lines.append("/**")
    lines.append(" * Apply the authoritative values over a registry parameter definition.")
    lines.append(" *")
    lines.append(" * Called from the schema builder so that EVERY consumer — the UI, `defaultParams`,")
    lines.append(" * and the node kernels — sees the same range. Applying it in one place is what")
    lines.append(" * keeps a kernel from silently reading a default the UI never shows.")
    lines.append(" *")
    lines.append(" * @param {string} node")
    lines.append(" * @param {string} param")
    lines.append(" * @param {object|undefined} def the registry's own definition, if any")
    lines.append(" * @returns {object|undefined} the definition with authoritative fields applied")
    lines.append(" */")
    lines.append("export function authoritativeParam(node, param, def) {")
    lines.append("  const auth = AUTHORITATIVE_PARAMS[node]?.[param];")
    lines.append("  if (!auth) return def;")
    lines.append("  const out = { ...(def || {}) };")
    lines.append("  for (const k of ['d', 'min', 'max', 'step']) {")
    lines.append("    if (auth[k] !== undefined) out[k] = auth[k];")
    lines.append("  }")
    lines.append("  return out;")
    lines.append("}")
    lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    total = sum(len(v) for v in table.values())
    print(f"  nodes covered : {len(table)}")
    print(f"  params covered: {total}")
    if unresolved:
        print(f"  skipped {unresolved} attribute(s) whose property name the extractor could not")
        print("          resolve — these are a gap in tools/node-routing.py, not in the assembly")
    print(f"  wrote {OUT.relative_to(WS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

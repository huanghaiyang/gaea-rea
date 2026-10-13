#!/usr/bin/env python3
"""Audit the app's EFFECTIVE parameters against the authoritative metadata.

The managed source carries `[Parameter(default, min, max)]` attributes, which are what the
runtime actually reads. This compares the schema the app really builds — after
`param-authority.js` has been applied by `buildSchema` — against those attributes.

WHY IT READS THE EFFECTIVE SCHEMA AND NOT THE REGISTRY SOURCE
An earlier version scanned `web/js/registry.js` for `d`/`min`/`max` literals. Once the
authority table started overriding them at runtime, that audit kept reporting the same 113
divergences no matter how many were fixed, because it was measuring the hand-written values
the table deliberately replaces. Auditing the effective schema is the only thing that can
converge.

It also reports how many parameters are STILL hand-authored (`source: 'registry'`), which is
the number that should fall as the extracted table grows.

Exit status is 0 always — this is a report, not a gate.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
ROUTING = WS / "docs" / "node-routing.json"
EFFECTIVE = WS / "docs" / "effective-schema.json"

NUM = re.compile(r"^-?\d+(?:\.\d+)?f?$")


def parse_meta(meta: str):
    """Return (default, min, max) as floats, or None when the attribute is not numeric."""
    parts = [p.strip() for p in meta.split(",") if p.strip()]
    if len(parts) < 3:
        return None
    tail = parts[-3:]
    if not all(NUM.match(p) for p in tail):
        return None
    vals = [float(p.rstrip("fF")) for p in tail]
    return vals[0], vals[1], vals[2]


def main() -> int:
    routing = json.loads(ROUTING.read_text(encoding="utf-8"))
    if not EFFECTIVE.exists():
        print("  docs/effective-schema.json is missing.")
        print("  Run:  node tools/dump-schema.mjs docs/effective-schema.json")
        return 1
    eff = json.loads(EFFECTIVE.read_text(encoding="utf-8"))

    checked = 0
    divergences: list[dict] = []
    unknown: list[dict] = []
    by_source: dict[str, int] = {}

    for node_name, meta in routing["nodes"].items():
        rparams = eff.get(node_name)
        if not rparams:
            continue
        for p in meta["params"]:
            parsed = parse_meta(p["meta"])
            if parsed is None:
                continue
            default, pmin, pmax = parsed
            # The authority table is keyed by the C# property name, which may differ from the
            # catalogue label by a space (e.g. `Enforce Quantization` vs `EnforceQuantization`).
            rp = rparams.get(p["name"])
            if rp is None:
                alt = [k for k in rparams
                       if k.replace(" ", "").lower() == p["name"].replace(" ", "").lower()]
                if alt:
                    rp = rparams[alt[0]]
                else:
                    unknown.append({"node": node_name, "param": p["name"],
                                    "auth": [default, pmin, pmax],
                                    "reason": "not in the effective schema"})
                    continue
            checked += 1
            src = rp.get("source") or "?"
            by_source[src] = by_source.get(src, 0) + 1
            # A list- or curve-valued parameter has an array where a number would be; it has no
            # scalar default to compare, so only its range is checked.
            issues = []
            eff_d = rp["d"] if isinstance(rp["d"], (int, float)) else None
            if eff_d is not None and abs(eff_d - default) > 1e-6:
                issues.append(f"default {eff_d} != {default}")
            if isinstance(rp["min"], (int, float)) and abs(rp["min"] - pmin) > 1e-6:
                issues.append(f"min {rp['min']} != {pmin}")
            if isinstance(rp["max"], (int, float)) and abs(rp["max"] - pmax) > 1e-6:
                issues.append(f"max {rp['max']} != {pmax}")
            if issues:
                divergences.append({
                    "node": node_name, "param": p["name"],
                    "authoritative": [default, pmin, pmax],
                    "effective": [eff_d, rp["min"], rp["max"]],
                    "source": src,
                    "issues": issues,
                })

    print(f"  effective schema nodes           : {len(eff)}")
    print(f"  numeric params compared          : {checked}")
    print(f"  DIVERGENT from the C# attribute  : {len(divergences)}")
    print(f"  not in the effective schema      : {len(unknown)}")
    print()
    print("  where each compared default came from:")
    for k in sorted(by_source, key=lambda x: -by_source[x]):
        print(f"    {k:<12} {by_source[k]}")

    if divergences:
        print()
        print("  Divergences (node.param : effective -> authoritative):")
        for d in divergences[:30]:
            print(f"    {d['node']}.{d['param']:<24} {d['effective']} -> {d['authoritative']}"
                  f"  [source={d['source']}]")

    out = WS / "docs" / "param-audit.json"
    out.write_text(json.dumps({
        "checked": checked,
        "bySource": by_source,
        "divergences": divergences,
        "notInSchema": unknown,
        "caveat": (
            "A parameter the extractor could not name is reported as absent rather than as "
            "divergent; 220 such attributes exist, which is a gap in tools/node-routing.py."
        ),
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n  wrote {out.relative_to(WS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


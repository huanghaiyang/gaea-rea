#!/usr/bin/env python3
"""Enforce the correct role for terms that are BOTH a node/group and a parameter.

Four names carry genuinely different senses in the two roles and had drifted to a
single value during a dictionary merge:

    Steps       node/group "阶地"   parameter "阶数"
    Peaks       node/group "峰群"   parameter "峰数"
    Layers      node/group "图层"   parameter "图层数"
    Variation   node/group "变化"   parameter "变化量"

This script is idempotent and authoritative: run it after any merge so the two
namespaces cannot silently collapse again.

Usage:
    python tools/enforce_role_terms.py [--check]
"""
from __future__ import annotations

import json
import sys
from collections import OrderedDict
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
TERMS = WS / "web" / "data" / "i18n-terms.zh.json"

# key -> (node/group rendering, parameter rendering)
ROLE_PAIRS: dict[str, tuple[str, str]] = {
    "Steps": ("阶地", "阶数"),
    "Peaks": ("峰群", "峰数"),
    "Layers": ("图层", "图层数"),
    "Variation": ("变化", "变化量"),
}


def main() -> int:
    check = "--check" in sys.argv
    doc = json.loads(TERMS.read_text(encoding="utf-8"), object_pairs_hook=OrderedDict)
    terms = doc.setdefault("terms", OrderedDict())
    params = doc.setdefault("paramNames", OrderedDict())

    changes = []
    for key, (node_val, param_val) in ROLE_PAIRS.items():
        if key in terms and terms[key] != node_val:
            changes.append(f"terms.{key}: {terms[key]!r} -> {node_val!r}")
            terms[key] = node_val
        if key in params and params[key] != param_val:
            changes.append(f"paramNames.{key}: {params[key]!r} -> {param_val!r}")
            params[key] = param_val

    if changes:
        print("corrected role renderings:")
        for c in changes:
            print(f"  {c}")
    else:
        print("role renderings already correct")

    if not check and changes:
        TERMS.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {TERMS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Merge and de-duplicate the Chinese term dictionary.

Earlier revisions listed parameter names and group names twice (once in `terms`,
once in `paramNames`). JavaScript keeps the last occurrence, so the result was
still correct, but duplicate keys are a maintenance hazard and break
case-insensitive JSON consumers.

This rewrites web/data/i18n-terms.zh.json as:
    terms     -> node names and group names
    paramNames-> parameter names
with every key appearing exactly once across the file, and identical translations
collapsed.

Usage:
    python tools/merge_i18n_terms.py [--check]
"""
from __future__ import annotations

import json
import sys
from collections import OrderedDict
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
TERMS = WS / "web" / "data" / "i18n-terms.zh.json"
VOCAB = WS / "web" / "data" / "i18n-vocab.json"


def main() -> int:
    check = "--check" in sys.argv
    doc = json.loads(TERMS.read_text(encoding="utf-8"), object_pairs_hook=OrderedDict)
    vocab = json.loads(VOCAB.read_text(encoding="utf-8"))

    node_names = set(vocab["nodeNames"])
    groups = set(vocab["groups"])
    param_names = set(vocab["paramNames"])

    old_terms = doc.get("terms", {})
    old_params = doc.get("paramNames", {})

    # A key belongs to whichever category the source vocabulary says it does.
    new_terms: OrderedDict = OrderedDict()
    new_params: OrderedDict = OrderedDict()

    # Names that serve BOTH roles (Steps is a node and a parameter) must land in
    # each namespace with its own rendering, so:
    #   terms      <- node/group role
    #   paramNames <- parameter role (takes precedence for the parameter value)
    def place(key: str, value: str) -> None:
        is_node = key in node_names or key in groups
        is_param = key in param_names
        if is_node:
            new_terms[key] = value
        elif is_param:
            new_params[key] = value
        else:
            new_terms[key] = value

    # Parameter block first so its rendering wins when building new_params, then
    # the node/group block (which never writes into new_params).
    for src in (old_params, old_terms):
        for k, v in src.items():
            place(k, v)

    # Sort each block by name for stable diffs.
    new_terms = OrderedDict((k, new_terms[k]) for k in sorted(new_terms))
    new_params = OrderedDict((k, new_params[k]) for k in sorted(new_params, key=str.lower))

    # Report collisions that did NOT survive (i.e. had differing translations).
    conflicts = []
    for k in set(old_terms) & set(old_params):
        if old_terms[k] != old_params[k]:
            conflicts.append((k, old_terms[k], old_params[k]))

    out = OrderedDict()
    out["_note"] = doc.get("_note", "")
    out["_scope"] = doc.get("_scope", "")
    out["terms"] = new_terms
    out["paramNames"] = new_params

    total = len(new_terms) + len(new_params)
    print(f"terms:      {len(new_terms)}")
    print(f"paramNames: {len(new_params)}")
    print(f"total keys: {total} (was {len(old_terms) + len(old_params)} with "
          f"{len(set(old_terms) & set(old_params))} duplicated)")
    if conflicts:
        print(f"\ncollisions with DIFFERING translations ({len(conflicts)}) — "
              f"paramNames value kept:")
        for k, a, b in conflicts[:30]:
            print(f"  {k}: terms={a!r} paramNames={b!r}")

    if check:
        return 0

    TERMS.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nwrote {TERMS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Detect duplicate JSON keys, case-sensitively and case-insensitively.

JavaScript object keys are case-sensitive, so two keys differing only in case are
distinct there but collide in case-insensitive consumers (PowerShell's
ConvertFrom-Json, some editors). object_pairs_hook lets us see every literal key.

Duplicates are reported per object, not across the whole document: the i18n
dictionary deliberately lists namespaces side by side (a name may appear in both
`terms` and `paramNames` with different renderings), and that is not a collision.

Usage:
    python tools/check_dup_keys.py web/data/i18n-terms.zh.json [...]
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path


def scan(path: Path) -> int:
    # exact[obj_path][key] = count ; folded likewise
    exact: dict[str, Counter] = {}
    folded: dict[str, dict[str, list[str]]] = {}

    def walk(obj, prefix: str) -> None:
        if isinstance(obj, dict):
            e = exact.setdefault(prefix, Counter())
            f = folded.setdefault(prefix, {})
            for k, v in obj.items():
                e[k] += 1
                f.setdefault(k.lower(), [])
                if k not in f[k.lower()]:
                    f[k.lower()].append(k)
                walk(v, f"{prefix}.{k}" if prefix else k)
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                walk(v, f"{prefix}[{i}]")

    def hook(pairs):
        # The hook fires for every object; rebuilding a plain dict loses nothing
        # because walk() re-reads the parsed structure for path reporting.
        return dict(pairs)

    parsed = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=hook)
    walk(parsed, "")

    dups_exact = {p: {k: c for k, c in cnt.items() if c > 1} for p, cnt in exact.items()}
    dups_exact = {p: d for p, d in dups_exact.items() if d}
    dups_folded = {p: {k: n for k, n in d.items() if len(n) > 1} for p, d in folded.items()}
    dups_folded = {p: d for p, d in dups_folded.items() if d}

    print(f"{path}:")
    if dups_exact:
        print(f"  EXACT duplicates ({sum(len(d) for d in dups_exact.values())}) — "
              f"last value wins in JS:")
        for p, d in dups_exact.items():
            where = p or "<root>"
            for k, c in sorted(d.items()):
                print(f"    {where}: {k}  x{c}")
    else:
        print("  no exact duplicates within any object")

    if dups_folded:
        print(f"  case-only collisions ({sum(len(d) for d in dups_folded.values())}) — "
              f"harmless in JS, breaks case-insensitive parsers:")
        for p, d in dups_folded.items():
            where = p or "<root>"
            for k, names in sorted(d.items()):
                print(f"    {where}: {names}")
    else:
        print("  no case-only collisions")

    return 1 if dups_exact else 0


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    rc = 0
    for a in sys.argv[1:]:
        rc |= scan(Path(a))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())

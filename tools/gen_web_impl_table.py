#!/usr/bin/env python3
"""Emit the implemented-node/fidelity table from web/js/registry.js.

Node entries are located structurally (each begins with a `name: '...'` at the
same indentation inside the NODES array) and the following fields are read up to
the next entry. Keeping this generated means web/IMPLEMENTATION-NOTES.md cannot
silently drift from the registry that actually runs.

Usage:
    python gen_web_impl_table.py [registry.js]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Start of one node entry: `name: 'X'` — node entries are indented consistently
# inside the NODES array, while `name:` also appears in nested port/param objects.
NAME_RE = re.compile(r"^\s*name:\s*'([^']+)'\s*,", re.MULTILINE)
# Fields may be inline after `name:` or on their own (more indented) line, so no
# leading-anchor requirement here.
ALGO_RE = re.compile(r"\balgorithm:\s*([A-Za-z0-9_]+)")
CAT_RE = re.compile(r"\bcategory:\s*([A-Za-z0-9_.]+)")
NOTE_RE = re.compile(r"\bnote:\s*'([^']*)'")


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/sgames/gaea-rea/web/js/registry.js")
    src = path.read_text(encoding="utf-8")

    starts = [(m.start(), m.group(1)) for m in NAME_RE.finditer(src)]
    rows = []
    for i, (pos, name) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(src)
        block = src[pos:end]
        algo = ALGO_RE.search(block)
        cat = CAT_RE.search(block)
        note = NOTE_RE.search(block)
        rows.append((
            name,
            algo.group(1) if algo else "?",
            (cat.group(1).split(".")[-1] if cat else ""),
            note.group(1) if note else "exact",
        ))

    rows.sort(key=lambda r: (r[2], r[0].lower()))
    print("| Node | Kernel function | Category | Fidelity |")
    print("| --- | --- | --- | --- |")
    for name, algo, cat, note in rows:
        print(f"| `{name}` | `{algo}` | {cat} | {note} |")
    print()
    tally: dict[str, int] = {}
    for _, _, _, note in rows:
        tally[note] = tally.get(note, 0) + 1
    print(f"*Implemented nodes: {len(rows)}* — " +
          ", ".join(f"{k}={v}" for k, v in sorted(tally.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

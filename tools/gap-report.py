#!/usr/bin/env python3
"""Measure the gap between this build and the Gaea node catalogue.

Parses the registry entries properly: `name`, `note` (the per-node fidelity label)
and `algorithm` are often on different lines, so a single-line regex under-counts.

Everything here is derived from the committed files, not from memory.
"""
from __future__ import annotations

import json
import pathlib
import re
from collections import Counter, defaultdict

WS = pathlib.Path(__file__).resolve().parent.parent
CAT = WS / "web" / "data" / "nodes.json"
REG = WS / "web" / "js" / "registry.js"

cat = json.loads(CAT.read_text(encoding="utf-8"))
cat_nodes = cat["nodes"]
cat_names = [n["name"] for n in cat_nodes]
reg = REG.read_text(encoding="utf-8")

# Pair each `algorithm:` with the nearest preceding `name:` — no single-line assumption.
names = [(m.start(), m.group(1)) for m in re.finditer(r"\bname:\s*'([^']+)'", reg)]
als = [m.start() for m in re.finditer(r"\balgorithm:\s*([A-Za-z0-9_]+)", reg)]
algs = [(m.start(), m.group(1)) for m in re.finditer(r"\balgorithm:\s*([A-Za-z0-9_]+)", reg)]

entries = []
for pos, alg in algs:
    prev = [n for n in names if n[0] < pos]
    if not prev:
        continue
    # the entry's own name is the nearest preceding one
    entries.append((prev[-1][1], alg))

# Fidelity label per entry: the nearest `note:` before the algorithm, inside the entry.
def note_for(name: str) -> str | None:
    m = re.search(r"name:\s*'" + re.escape(name) + r"'.{0,400}?note:\s*'([^']+)'", reg, re.S)
    return m.group(1) if m else None

impl = {n: a for n, a in entries}
print("=" * 74)
print("NODE COVERAGE  (catalogue from Nodes.json vs registry entries with a kernel)")
print("=" * 74)
print(f"  catalogue nodes                  : {len(cat_names)}")
print(f"  registry entries with a kernel    : {len(entries)}")
print(f"  distinct kernel functions         : {len(set(impl.values()))}")

covered = [n for n in cat_names if n in impl]
extra = [n for n in impl if n not in cat_names]
missing = [n for n in cat_names if n not in impl]
print(f"  catalogue nodes covered           : {len(covered)}  ({100*len(covered)/len(cat_names):.1f}%)")
print(f"  catalogue nodes NOT covered       : {len(missing)}  ({100*len(missing)/len(cat_names):.1f}%)")
print(f"  registry entries not in catalogue : {len(extra)}  ({', '.join(sorted(extra))})")

print()
print("  FIDELITY OF THE COVERED NODES  (the registry's own `note:` labels)")
labels = Counter()
unlabelled = []
for n in covered:
    lab = note_for(n)
    if lab:
        labels[lab] += 1
    else:
        unlabelled.append(n)
for k, v in sorted(labels.items(), key=lambda kv: -kv[1]):
    print(f"    {k:<18} {v:>3}")
if unlabelled:
    print(f"    {'(no note)':<18} {len(unlabelled):>3}   {', '.join(unlabelled[:8])}")
print(f"    {'TOTAL':<18} {sum(labels.values()) + len(unlabelled):>3}")

print()
print("  MISSING NODES BY CATALOGUE GROUP")
by_group: dict[str, list[str]] = defaultdict(list)
for n in cat_nodes:
    if n["name"] in missing:
        g = (n.get("groups") or ["(ungrouped)"])[0]
        by_group[g].append(n["name"])
for g in sorted(by_group, key=lambda k: -len(by_group[k])):
    lst = by_group[g]
    print(f"    {g:<20} {len(lst):>3}   {', '.join(lst[:5])}{' …' if len(lst) > 5 else ''}")

print()
print("  ALL MISSING NODES")
for i in range(0, len(missing), 6):
    print("    " + ", ".join(missing[i:i + 6]))

print()
print("=" * 74)
print("PARAMETER SURFACE")
print("=" * 74)
total = sum(len(n.get("params") or []) for n in cat_nodes)
print(f"  parameters declared in the catalogue : {total}")
print("  A node whose parameters are not all consumed silently ignores them, so an")
print("  unimplemented parameter is a behaviour difference, not a cosmetic one.")

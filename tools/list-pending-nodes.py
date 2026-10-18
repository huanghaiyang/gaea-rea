#!/usr/bin/env python3
"""List the catalogued nodes that still have no kernel, simplest first.

The worklist entries carry `{name, line, lines, stmts, opaque}` where `line` is a line number in
`evidence/decompiled/Gaea.Nodes.whole.cs`. Sorting by `lines` puts the ones whose recovered body is
a handful of statements first: those are the ones that can be implemented from the IL alone without
guessing, which is what makes them safe to batch.

`opaque` lists the callees the earlier pass could not resolve. A node with entries there needs its
call graph followed before its behaviour is known, so it is deliberately ranked lower even when the
body is short.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
w = json.loads((ROOT / "docs" / "node-worklist.json").read_text(encoding="utf-8"))
reg = (ROOT / "web" / "js" / "registry.js").read_text(encoding="utf-8")

# Node names as the registry declares them.
impl = set(re.findall(r"name:\s*'([A-Za-z0-9_]+)'", reg))
# Also pick up names registered through a table/loop, if any.
impl |= set(re.findall(r"'([A-Za-z0-9_]+)'", reg)) & {e["name"] for e in w}

pending = [e for e in w if e["name"] not in impl]
# Short body AND no unresolved callees first: those are fully determined by the recovered IL.
pending.sort(key=lambda e: (len(e.get("opaque") or []), e.get("lines", 999), e.get("stmts", 999)))

print(f"  catalogued with a worklist body : {len(w)}")
print(f"  already registered              : {len(impl)}")
print(f"  still pending                   : {len(pending)}")
print("")
print(f"  {'name':<24} {'lines':>5} {'stmts':>5} {'opaque':>6}  source line")
print(f"  {'-'*24} {'-'*5} {'-'*5} {'-'*6}  -----------")
for e in pending[:30]:
    print(f"  {e['name']:<24} {e.get('lines',0):>5} {e.get('stmts',0):>5} "
          f"{len(e.get('opaque') or []):>6}  L{e.get('line',0)}")

# Emit the shortlist so a batch pass can consume it without re-deriving.
out = ROOT / "docs" / "node-pending.json"
out.write_text(json.dumps(pending, indent=2, ensure_ascii=False), encoding="utf-8")
print("")
print(f"  wrote {out}  ({len(pending)} entries)")

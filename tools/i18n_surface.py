#!/usr/bin/env python3
"""Report the translation surface of web/data/nodes.json."""
import json
from pathlib import Path

d = json.loads(Path("web/data/nodes.json").read_text(encoding="utf-8"))
nodes = d["nodes"] if isinstance(d, dict) else d

print(f"nodes: {len(nodes)}")
print(f"top-level keys: {sorted(nodes[0].keys())}")
print(f"node keys sample: {sorted(nodes[0].keys())}")

desc = sum(1 for n in nodes if n.get("description"))
print(f"nodes with description: {desc}")

# Parameter shape
p0 = next((n["params"][0] for n in nodes if n.get("params")), None)
if p0:
    print(f"param keys: {sorted(p0.keys())}")
    print(f"param sample: {json.dumps(p0, ensure_ascii=False)[:220]}")

labels = set()
types = {}
total_params = 0
for n in nodes:
    for p in n.get("params") or []:
        total_params += 1
        if p.get("label"):
            labels.add(p["label"])
        types[p.get("control") or p.get("type")] = types.get(p.get("control") or p.get("type"), 0) + 1
print(f"total params: {total_params}")
print(f"unique labels: {len(labels)}")
print(f"control/type histogram: {types}")

groups = set()
for n in nodes:
    for g in n.get("groups") or []:
        groups.add(g if isinstance(g, str) else str(g))
print(f"unique groups: {len(groups)}")
gd = d.get("groups") if isinstance(d, dict) else None
if gd:
    print(f"top-level groups map: {len(gd)} entries")
    print(f"  sample: {json.dumps(list(gd.items())[:3], ensure_ascii=False)[:300]}")

stats = d.get("stats") if isinstance(d, dict) else None
if stats:
    print(f"stats: {json.dumps(stats, ensure_ascii=False)}")

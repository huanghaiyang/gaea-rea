#!/usr/bin/env python3
"""Route each catalog node to its implementation, and list the ImageMagick-backed work.

The previous round established that most nodes live in the managed assembly, not in
`Gaea.Native.dll`, and that roughly twenty of them are thin wrappers over ImageMagick. This
turns that into a concrete work list by parsing the decompiled C#:

  * every `class X : Node`, with its `[Family]`/`[Toolbox]` attributes
  * the ImageMagick operations its `Build()` calls
  * every `[Parameter(default, min, max)]` with the property it decorates, which is the
    AUTHORITATIVE default and range — better than the catalogue's `ilDefault` because it is
    the attribute the runtime actually reads

Output is written to docs/node-routing.json for the implementation pass.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from collections import Counter

WS = pathlib.Path(__file__).resolve().parent.parent
SRC = WS / "evidence" / "decompiled" / "Gaea.Nodes.whole.cs"
CAT = WS / "web" / "data" / "nodes.json"
OUT = WS / "docs" / "node-routing.json"

CLASS_RE = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+)?class\s+(\w+)\s*:\s*Node\b")
# [Parameter(0.44f, 0f, 4f)] possibly followed by [Name("...")] then the property
PARAM_RE = re.compile(r"\[Parameter\(([^)]*)\)\]")
# A property declaration following the attribute, e.g. `public float GammaValue`
PROP_RE = re.compile(r"^\s*(?:public|internal)\s+(?:override\s+)?([\w<>\[\]]+)\s+(\w+)\s*$")
IM_CALL_RE = re.compile(r"\b\w*[Mm]agick\w*\.(\w+)\s*\(")


def main() -> int:
    lines = SRC.read_text(encoding="utf-8", errors="replace").splitlines()
    cat = json.loads(CAT.read_text(encoding="utf-8"))
    catalog_names = {n["name"] for n in cat["nodes"]}

    nodes: dict[str, dict] = {}
    current = None
    pending_params: list[tuple[str, str]] = []

    for i, line in enumerate(lines):
        m = CLASS_RE.match(line)
        if m:
            current = m.group(1)
            nodes[current] = {"line": i + 1, "params": [], "imOps": [], "attrs": []}
            pending_params = []
            continue
        if current is None:
            continue

        # A new top-level class ends the previous node.
        if re.match(r"^\s*(?:public|internal)\s+(?:sealed\s+)?class\s+\w+", line) and not CLASS_RE.match(line):
            current = None
            continue

        for a in ("Family", "Toolbox", "ShortCode", "Classification"):
            am = re.search(rf"\[{a}\(([^\]]*)\)\]", line)
            if am:
                nodes[current]["attrs"].append(f"{a}({am.group(1)})")

        pm = PARAM_RE.search(line)
        if pm:
            args = [a.strip() for a in pm.group(1).split(",")]
            # The property name is on one of the next few non-attribute lines.
            #
            # The declaration is matched structurally (`public <Type> <Name>`, no body) rather
            # than against a list of primitive type names. An earlier version hardcoded
            # `float|bool|int|double|string|Color|Vector2`, which silently failed on every
            # attribute decorating an ENUM property — `public AccumulatorType Type` — and
            # produced 220 unnamed attributes, a quarter of the whole table.
            name = None
            for j in range(i + 1, min(i + 8, len(lines))):
                nx = lines[j].strip()
                if nx.startswith("[") or not nx:
                    continue
                q = re.match(
                    r"^(?:public|internal|protected|private)\s+(?:override\s+)?(?:static\s+)?"
                    r"[\w.<>\[\]]+\s+(\w+)\s*$",
                    nx,
                )
                if q:
                    name = q.group(1)
                break
            pending_params.append((name or "?", ",".join(args)))
            continue

        if pending_params and PROP_RE.match(line):
            nodes[current]["params"].extend(pending_params)
            pending_params = []

        for op in IM_CALL_RE.findall(line):
            if op not in nodes[current]["imOps"]:
                nodes[current]["imOps"].append(op)
        # Variable-style calls: magickImage.AutoGamma()
        for op in re.findall(r"\b(?:magickImage|magick|_magick)\w*\.(\w+)\s*\(", line):
            if op not in nodes[current]["imOps"]:
                nodes[current]["imOps"].append(op)

    in_catalog = {k: v for k, v in nodes.items() if k in catalog_names}
    im_nodes = {k: v for k, v in in_catalog.items() if v["imOps"]}

    print(f"  Node subclasses in the managed source : {len(nodes)}")
    print(f"  of which in the vendor catalogue       : {len(in_catalog)}")
    print(f"  with [Parameter] metadata extracted    : "
          f"{sum(1 for v in in_catalog.values() if v['params'])}")
    print(f"  calling an ImageMagick operation       : {len(im_nodes)}")
    print()

    ops: Counter = Counter()
    for v in im_nodes.values():
        for o in v["imOps"]:
            ops[o] += 1
    print("  ImageMagick operations by node count:")
    for op, c in ops.most_common(30):
        print(f"    {op:<28} {c}")

    print()
    print("  Nodes grouped by operation:")
    for op, _ in ops.most_common(30):
        names = sorted(k for k, v in im_nodes.items() if op in v["imOps"])
        print(f"    {op:<24} {', '.join(names[:12])}")

    doc = {
        "source": "evidence/decompiled/Gaea.Nodes.whole.cs",
        "method": "parse managed Node subclasses for [Parameter] attributes and ImageMagick calls",
        "caveat": (
            "ImageMagick call detection is textual and variable-name based, so it can miss a "
            "call made through a differently named local, and can false-positive on a method "
            "that merely shares a name. It is a work list, not a proof of the call graph."
        ),
        "counts": {
            "nodeSubclasses": len(nodes),
            "inCatalog": len(in_catalog),
            "imageMagickBacked": len(im_nodes),
        },
        "nodes": {
            k: {
                "line": v["line"],
                "attrs": v["attrs"],
                "params": [{"name": n, "meta": m} for n, m in v["params"]],
                "imOps": v["imOps"],
            }
            for k, v in sorted(in_catalog.items())
        },
    }
    OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n  wrote {OUT.relative_to(WS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

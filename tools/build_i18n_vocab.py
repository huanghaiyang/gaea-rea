#!/usr/bin/env python3
"""Build the translation vocabulary for the web UI.

Produces web/data/i18n-vocab.json listing every unique string that needs a
Chinese rendering, so translations are authored once per unique term instead of
once per occurrence.

Usage:
    python tools/build_i18n_vocab.py [--out web/data/i18n-vocab.json]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
NODES = WS / "web" / "data" / "nodes.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(WS / "web" / "data" / "i18n-vocab.json"))
    args = ap.parse_args()

    d = json.loads(NODES.read_text(encoding="utf-8"))
    nodes = d["nodes"]

    node_names: set[str] = set()
    node_descs: dict[str, str] = {}
    param_names: set[str] = set()
    param_descs: set[str] = set()
    enum_options: set[str] = set()
    enum_option_descs: set[str] = set()
    groups: set[str] = set()

    for n in nodes:
        if n.get("name"):
            node_names.add(n["name"])
        if n.get("description"):
            node_descs[n["name"]] = n["description"]
        for g in n.get("groups") or []:
            if isinstance(g, str) and g:
                groups.add(g)
        gd = n.get("groupDetails")
        # groupDetails is a mapping or a list of objects depending on the node.
        if isinstance(gd, dict):
            names = gd.keys()
        elif isinstance(gd, list):
            names = [
                (g.get("name") if isinstance(g, dict) else g)
                for g in gd
            ]
        else:
            names = ()
        for gname in names:
            if isinstance(gname, str) and gname:
                groups.add(gname)
        for p in n.get("params") or []:
            if p.get("name"):
                param_names.add(p["name"])
            if p.get("description"):
                param_descs.add(p["description"])
            for o in p.get("options") or []:
                if isinstance(o, str) and o:
                    enum_options.add(o)
            od = p.get("optionDescriptions")
            # The catalog emits either a mapping or a list depending on the node.
            if isinstance(od, dict):
                values = od.values()
            elif isinstance(od, list):
                values = od
            else:
                values = ()
            for v in values:
                if isinstance(v, str) and v:
                    enum_option_descs.add(v)
                elif isinstance(v, dict):
                    for vv in v.values():
                        if isinstance(vv, str) and vv:
                            enum_option_descs.add(vv)

    vocab = {
        "schema": "gaea-web-i18n-vocab/1",
        "note": (
            "Unique strings requiring translation. Node/parameter/group names are "
            "technical identifiers and may be kept in English where a translation "
            "would obscure the correspondence with Gaea; their descriptions should "
            "be translated."
        ),
        "counts": {
            "nodeNames": len(node_names),
            "nodeDescriptions": len(node_descs),
            "paramNames": len(param_names),
            "paramDescriptions": len(param_descs),
            "enumOptions": len(enum_options),
            "enumOptionDescriptions": len(enum_option_descs),
            "groups": len(groups),
        },
        "nodeNames": sorted(node_names),
        "paramNames": sorted(param_names),
        "groups": sorted(groups),
        "enumOptions": sorted(enum_options),
        "nodeDescriptions": {k: node_descs[k] for k in sorted(node_descs)},
        "paramDescriptions": sorted(param_descs),
        "enumOptionDescriptions": sorted(enum_option_descs),
    }
    out = Path(args.out)
    out.write_text(json.dumps(vocab, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out}")
    for k, v in vocab["counts"].items():
        print(f"  {k:26} {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

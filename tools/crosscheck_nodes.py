#!/usr/bin/env python3
"""Cross-check the Nodes.json catalog against the decompiled IL specification.

Answers: which shipped node classes are absent from Nodes.json, which catalog
names have no implementation class, and how parameter names line up between the
two sources. That delta is evidence in its own right.

Usage:
    python crosscheck_nodes.py <nodes.json> <node-specs-from-il.json> [--json out.json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def load_nodes_json(path: Path) -> dict[str, dict]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    out: dict[str, dict] = {}
    for n in data:
        out[n["Name"]] = n
    return out


def _norm(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


def flatten_catalog(flubs: list[dict], in_enum: bool = False):
    """Yield (kind, name) for the catalog tree, distinguishing real parameters
    from enum member values.

    Nodes.json nests enum choices as child "Flubs" of an "Enum" entry. Counting
    those children as parameters inflates the parameter total dramatically
    (Accumulator would read as 14 instead of 3), so they are reported separately
    as enum members.
    """
    for f in flubs or []:
        t = f.get("Type")
        nm = f.get("Name")
        if in_enum:
            yield ("enum_member", nm)
        elif t == "EnumValue":
            yield ("enum_member", nm)
        elif t == "Enum":
            # The enum itself is one parameter; children are its choices.
            yield ("parameter", nm)
            for child in f.get("Flubs") or []:
                yield ("enum_member", child.get("Name"))
            continue
        elif t is None and (f.get("Flubs") or f.get("Type")):
            # A structural node holding sub-parameters without a concrete type.
            pass
        else:
            yield ("parameter", nm)
        if f.get("Flubs") and t != "Enum":
            yield from flatten_catalog(f["Flubs"], in_enum or t == "EnumValue")


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    nodes_path = Path(sys.argv[1])
    il_path = Path(sys.argv[2])
    out_path = None
    if "--json" in sys.argv:
        out_path = Path(sys.argv[sys.argv.index("--json") + 1])

    catalog = load_nodes_json(nodes_path)
    il = json.loads(il_path.read_text(encoding="utf-8"))
    classes = {c["class_name"]: c for c in il["nodes"]}
    # Graph-node implementation classes. `base_class == "Node"` alone also
    # matches the `Node` base type declaration itself, which is not an
    # implementation, so it is excluded explicitly.
    node_classes = {
        name: c for name, c in classes.items()
        if c.get("base_class") == "Node" and name != "Node"
    }

    cat_names = set(catalog)
    il_node_names = {c.get("node_name") or k for k, c in node_classes.items()}

    only_catalog = sorted(cat_names - il_node_names)
    only_il = sorted(il_node_names - cat_names)
    both = sorted(cat_names & il_node_names)

    print("=" * 72)
    print("NODE SET COMPARISON")
    print("=" * 72)
    print(f"Nodes.json node names          : {len(cat_names)}")
    print(f"IL node-like classes           : {len(node_classes)} (from {len(classes)} classes)")
    print(f"matched by name                : {len(both)}")
    print(f"only in Nodes.json             : {len(only_catalog)}")
    print(f"only in IL                     : {len(only_il)}")

    if only_catalog:
        print("\n-- in Nodes.json but no IL class matched by name --")
        for n in only_catalog:
            print(f"   {n}")
    if only_il:
        print("\n-- IL node-like classes with no Nodes.json entry --")
        for n in only_il:
            c = node_classes.get(n) or next((v for v in node_classes.values() if (v.get('node_name') or '') == n), {})
            print(f"   {n:28} build={c.get('build_call')} toolbox={c.get('toolbox')} class={c.get('class_name')}")

    # Parameter-name comparison for matched nodes.
    print("\n" + "=" * 72)
    print("PARAMETER NAME COMPARISON (matched nodes)")
    print("=" * 72)
    mismatches = []
    total_il = total_cat = 0
    total_enum_members = 0
    for name in both:
        cat = catalog[name]
        cls = node_classes.get(name) or next(
            (v for v in node_classes.values() if (v.get("node_name") or "") == name), None)
        if cls is None:
            continue
        flat = list(flatten_catalog(cat.get("Flubs") or []))
        cat_params = [n for k, n in flat if k == "parameter" and n]
        enum_members = [n for k, n in flat if k == "enum_member" and n]
        il_params = [p["name"] for p in cls.get("parameters", [])]
        total_cat += len(cat_params)
        total_il += len(il_params)
        total_enum_members += len(enum_members)
        cset = {_norm(p) for p in cat_params}
        iset = {_norm(p) for p in il_params}
        if cset != iset:
            mismatches.append({
                "node": name,
                "catalog_only": sorted({p for p in cat_params if _norm(p) not in iset}),
                "il_only": sorted({p for p in il_params if _norm(p) not in cset}),
                "catalog_count": len(cat_params),
                "il_count": len(il_params),
            })

    print(f"total catalog parameters (matched nodes): {total_cat}")
    print(f"total catalog enum members (matched)    : {total_enum_members}")
    print(f"total IL parameters (matched nodes)     : {total_il}")
    print(f"nodes with differing param sets         : {len(mismatches)} / {len(both)}")
    for m in mismatches[:40]:
        print(f"\n   {m['node']}  (catalog {m['catalog_count']} vs IL {m['il_count']})")
        if m["catalog_only"]:
            print(f"      catalog only: {', '.join(m['catalog_only'][:12])}")
        if m["il_only"]:
            print(f"      IL only     : {', '.join(m['il_only'][:12])}")
    if len(mismatches) > 40:
        print(f"\n   ... and {len(mismatches) - 40} more (see JSON output)")

    payload = {
        "catalog_count": len(cat_names),
        "il_node_class_count": len(node_classes),
        "matched": len(both),
        "matched_catalog_parameter_total": total_cat,
        "matched_catalog_enum_member_total": total_enum_members,
        "matched_il_parameter_total": total_il,
        "only_in_catalog": only_catalog,
        "only_in_il": only_il,
        "parameter_mismatches": mismatches,
    }
    if out_path:
        out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nwrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

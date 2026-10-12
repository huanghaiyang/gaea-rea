#!/usr/bin/env python3
"""Generate the human-readable node reference from the extracted specifications.

Merges the shipped catalog (docs/node-specs-from-il.json is assembly-side; the
shipped Nodes.json supplies descriptions) plus the assembly-extracted defaults
and ranges, then emits a categorised Markdown reference covering every node.

This exists so the reference can be regenerated from evidence after a Gaea
update instead of being hand-maintained.

Usage:
    python gen_nodes_reference.py <Nodes.json> <node-specs-from-il.json> <out.md>
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

# Category assignment by toolbox attribute first, then name heuristics. The
# toolbox value comes from the assembly, so it is evidence; the heuristic
# fallback is inference and is labelled as such in the output.
TOOLBOX_LABELS = {
    "Primitive": "Primitives and noise",
    "Modify": "Modify and filter",
    "Surface": "Surface and features",
    "Simulate": "Simulation",
    "Derive": "Derive and analyse",
    "Output": "Output and export",
    "Utility": "Utility",
    "Color": "Colour",
    "Mask": "Masking",
    "Layout": "Layout",
}


def flatten_params(flubs):
    """Yield (group, param_name, type, enum_members) honouring group headers."""
    group = None
    for f in flubs or []:
        t = f.get("Type")
        nm = f.get("Name")
        has_type_key = "Type" in f
        if t is None and has_type_key:
            group = nm  # inline group header
            continue
        if t is None and not has_type_key:
            group = nm
            continue
        if t == "EnumValue":
            continue
        members = []
        if t == "Enum":
            members = [c.get("Name") for c in (f.get("Flubs") or [])]
        yield group, nm, t, members, f.get("Description") or ""


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    nodes_path, il_path, out_path = (Path(a) for a in sys.argv[1:4])

    catalog = json.loads(nodes_path.read_text(encoding="utf-8-sig"))
    il = json.loads(il_path.read_text(encoding="utf-8"))

    il_by_node: dict[str, dict] = {}
    for c in il["nodes"]:
        il_by_node[c.get("node_name") or c["class_name"]] = c

    groups: dict[str, list[dict]] = defaultdict(list)
    for n in catalog:
        spec = il_by_node.get(n["Name"], {})
        toolbox = spec.get("toolbox") or ""
        if toolbox in TOOLBOX_LABELS:
            group = TOOLBOX_LABELS[toolbox]
        else:
            group = "Unclassified (toolbox attribute absent)"
        groups[group].append({
            "node": n,
            "spec": spec,
        })

    lines: list[str] = []
    lines.append("# Gaea 2.0 node reference")
    lines.append("")
    lines.append("Generated from the shipped catalog (`Resources/Nodes.json`) merged with")
    lines.append("assembly-extracted defaults and ranges (`Gaea.Nodes.dll`).")
    lines.append("")
    lines.append("**Evidence conventions used below**")
    lines.append("")
    lines.append("| Marker | Meaning |")
    lines.append("| --- | --- |")
    lines.append("| `observed` | Read directly from `Nodes.json` or assembly metadata |")
    lines.append("| `inferred` | Derived by reasoning; not stated by the artifacts |")
    lines.append("| *(no type)* | Inline group header, not a parameter — see `parameter-types.md` |")
    lines.append("| *(no default)* | The assembly attribute carries no explicit default |")
    lines.append("")
    lines.append(f"Nodes documented: **{len(catalog)}**")
    lines.append("")
    lines.append("## Contents")
    lines.append("")
    for g in sorted(groups):
        lines.append(f"- [{g}](#{g.lower().replace(' ', '-').replace('(', '').replace(')', '')}) — {len(groups[g])} nodes")
    lines.append("")
    lines.append("---")
    lines.append("")

    for g in sorted(groups):
        lines.append(f"## {g}")
        lines.append("")
        for entry in sorted(groups[g], key=lambda e: e["node"]["Name"]):
            n = entry["node"]
            spec = entry["spec"]
            name = n["Name"]
            lines.append(f"### {name}")
            lines.append("")
            desc = (n.get("Description") or "").strip().replace("\n", " ")
            if desc:
                lines.append(f"{desc}")
                lines.append("")
            meta_bits = []
            if spec.get("class_name"):
                meta_bits.append(f"`{spec['class_name']}`")
            if spec.get("short_code"):
                meta_bits.append(f"short code `{spec['short_code']}`")
            if spec.get("classification"):
                meta_bits.append(f"classification `{spec['classification']}`")
            if spec.get("build_call"):
                meta_bits.append(f"algorithm entry `{spec['build_call']}`")
            if spec.get("flags"):
                meta_bits.append("flags " + ", ".join(f"`{f}`" for f in spec["flags"]))
            if meta_bits:
                lines.append(" · ".join(meta_bits))
                lines.append("")
            if not spec:
                lines.append("*No implementation class matched by name in `Gaea.Nodes.dll` (observed gap).*")
                lines.append("")

            il_params = {}
            for p in spec.get("parameters", []):
                il_params[p["name"].lower()] = p

            lines.append("| Group | Parameter | Type | Default | Range | Enum values |")
            lines.append("| --- | --- | --- | --- | --- | --- |")
            rows = 0
            for grp, pname, ptype, members, pdesc in flatten_params(n.get("Flubs") or []):
                ip = il_params.get((pname or "").lower(), {})
                typ = ptype if ptype else "*(none — group header)*"
                default = ip.get("default") or ""
                lo, hi = ip.get("minimum") or "", ip.get("maximum") or ""
                rng = f"{lo} … {hi}" if (lo or hi) else ""
                enumvals = ", ".join(m for m in members if m) if members else ""
                lines.append(f"| {grp or ''} | {pname or ''} | {typ} | {default} | {rng} | {enumvals} |")
                rows += 1
            if rows == 0:
                lines.append("| | *(no parameters declared)* | | | | |")
            lines.append("")

    out = Path(out_path)
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size:,} bytes, {len(catalog)} nodes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

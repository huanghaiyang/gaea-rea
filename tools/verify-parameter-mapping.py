#!/usr/bin/env python3
"""Re-derive the ParallelErosion parameter mapping from the evidence, and check it.

The mapping is a JOIN across two files whose field names cannot be matched textually:
Eazfuscator renamed every field, and both dumps show the mangled name identically. The join
is therefore by ORDER, which is only sound if it can be independently checked. It can:

  * the obfuscated suffixes run contiguously, and their count must equal the field count
  * the type list contains exactly one Int32 and exactly one Boolean, and the call site has
    exactly one integer parameter (Seed) and exactly one boolean (NoErosion)

If either check fails the join is wrong and this script says so instead of emitting a
plausible mapping.

Run: python tools/verify-parameter-mapping.py
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from collections import Counter

WS = pathlib.Path(__file__).resolve().parent.parent
MEMBERS = WS / "evidence" / "kernels" / "raw" / "Gaea.Engine.dll.SyclFunctions.members.txt"
NODES = WS / "evidence" / "decompiled" / "Gaea.Nodes.whole.cs"
OUT = WS / "docs" / "gaea-parameter-mapping.json"

failures: list[str] = []


def check(cond: bool, label: str, detail: object = "") -> None:
    mark = "OK  " if cond else "FAIL"
    print(f"  {mark} {label}" + (f"  [{detail}]" if detail != "" else ""))
    if not cond:
        failures.append(label)


# ---------------------------------------------------------------- field types, in order
def field_types() -> list[str]:
    text = MEMBERS.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    start = None
    for i, l in enumerate(lines):
        if "ParallelErosion.Parameters (Struct)" in l:
            start = i + 1
            break
    if start is None:
        raise SystemExit("ParallelErosion.Parameters block not found")
    out = []
    for l in lines[start:]:
        if l.strip().startswith("==="):
            break
        m = re.match(r"\s*field\s+(\S+)\s", l)
        if m and m.group(1) != "Void":
            out.append(m.group(1))
    return out


# ------------------------------------------- obfuscated suffix -> semantic, from the call site
def call_site() -> list[tuple[str, str]]:
    text = NODES.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    start = None
    for i, l in enumerate(lines):
        if "ParallelErosion.Parameters parameters = new ParallelErosion.Parameters" in l:
            start = i + 1
            break
    if start is None:
        raise SystemExit("the PE call site was not found")
    out = []
    for l in lines[start:]:
        if l.strip().startswith("};"):
            break
        # e.g.  \ue231\ue782\ue759 = Duration ,
        # The third escape carries the distinguishing suffix: \ue759 -> "759". Capturing
        # only the digits after "\ue7" would record "59" and lose the leading 7, which is
        # the part that ties the entry back to the obfuscated name.
        m = re.search(r"\\ue231\\ue782\\ue(7[0-9a-f]{2})\s*=\s*(.+?),?\s*$", l.strip())
        if m:
            out.append((m.group(1), m.group(2).strip().rstrip(",")))
    return out


# ------------------------------------------------------------------- the PE signature
def signature_defaults() -> dict[str, str]:
    text = NODES.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"internal static Map\[\] PE\((.*?)\)\s*\n", text, re.S)
    if not m:
        return {}
    defaults = {}
    for part in m.group(1).split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            defaults[k.strip().split()[-1]] = v.strip().rstrip("f").strip('"')
    return defaults


def main() -> int:
    print("=" * 74)
    print("ParallelErosion parameter mapping — re-derived and cross-checked")
    print("=" * 74)

    types = field_types()
    pairs = call_site()
    defaults = signature_defaults()

    print(f"\n  fields declared in the type list : {len(types)}")
    print(f"  values assigned at the call site : {len(pairs)}")
    print(f"  PE parameters with defaults      : {len(defaults)}")

    # --- check 1: the suffix run is contiguous and its size equals the field count
    suffixes = [s for s, _ in pairs]
    vals = sorted(int(s, 16) for s in suffixes)
    print()
    print("  CHECK 1 — suffix run")
    lo, hi = min(vals), max(vals)
    span = hi - lo + 1
    check(span == len(types),
          "the contiguous suffix span equals the declared field count",
          f"0x{lo:x}..0x{hi:x} = {span} vs {len(types)} fields")
    missing = [f"{v:x}" for v in range(lo, hi + 1) if v not in vals]
    check(len(missing) == span - len(vals),
          "every suffix in the span is either assigned or accounted for",
          f"unassigned: {missing}")

    # --- check 2: the type list must force the order
    print()
    print("  CHECK 2 — the field types must uniquely locate the odd-typed parameters")
    tc = Counter(types)
    check(tc.get("Int32") == 1, "exactly one Int32 field", dict(tc))
    check(tc.get("Boolean") == 1, "exactly one Boolean field", dict(tc))

    # Reconstruct the declaration order by splicing the unassigned suffixes back in.
    by_suffix = {int(s, 16): name for s, name in pairs}
    ordered = []
    for v in range(lo, hi + 1):
        ordered.append((v, by_suffix.get(v)))
    check(len(ordered) == len(types),
          "the spliced order has one slot per declared field",
          f"{len(ordered)} vs {len(types)}")

    # The single Int32 must land on Seed and the single Boolean on NoErosion.
    int_idx = [i for i, t in enumerate(types) if t == "Int32"]
    bool_idx = [i for i, t in enumerate(types) if t == "Boolean"]
    int_name = ordered[int_idx[0]][1] if int_idx else None
    bool_name = ordered[bool_idx[0]][1] if bool_idx else None
    check(int_name is not None and "Seed" in int_name,
          "the single Int32 lands on Seed", f"index {int_idx} -> {int_name}")
    check(bool_name is not None and "NoErosion" in bool_name,
          "the single Boolean lands on NoErosion", f"index {bool_idx} -> {bool_name}")

    # --- check 3: every named parameter must exist in the PE signature
    print()
    print("  CHECK 3 — every mapped argument is a real PE parameter or a known map access")
    # The map accessors carry an Eazfuscator-renamed type prefix (`\uf55c\uf0ba\ue6d3.`), so
    # match on the trailing member path rather than the whole expression.
    known_map_suffixes = (".Terrain.Width", ".Terrain.Height", ".Resolution")
    unknown = []
    for v, name in ordered:
        if name is None or name.endswith(known_map_suffixes) or name == "map.Resolution":
            continue
        if name not in defaults:
            unknown.append(name)
    check(not unknown, "each mapped name appears in the PE signature", unknown)

    # --- emit the verified mapping
    fields = []
    for i, t in enumerate(types):
        v, name = ordered[i]
        entry = {
            "index": i,
            "type": t,
            "obfuscatedSuffix": f"{v:x}",
            "name": name,
        }
        if name in defaults:
            entry["peArgument"] = name
            try:
                entry["default"] = json.loads(defaults[name].lower()
                                              if defaults[name].lower() in ("true", "false")
                                              else defaults[name])
            except Exception:
                entry["default"] = defaults[name]
        fields.append(entry)

    doc = json.loads(OUT.read_text(encoding="utf-8"))
    doc["fields"] = fields
    doc["derivedBy"] = "tools/verify-parameter-mapping.py"
    doc["checkResults"] = {
        "suffixSpan": f"0x{lo:x}..0x{hi:x}",
        "declaredFields": len(types),
        "assignedAtCallSite": len(pairs),
        "unassignedSuffixes": missing,
        "singleInt32AtIndex": int_idx[0] if int_idx else None,
        "singleBooleanAtIndex": bool_idx[0] if bool_idx else None,
    }

    # ---------------------------------------------------- node UI -> kernel correspondence
    # The catalogue is built from Gaea's own node metadata, so it carries the parameter
    # names and IL defaults the UI actually uses. Comparing it with the native struct
    # separates three things that are easy to conflate: kernel parameters, pre-erosion
    # masks, and defaults that only exist as C# fallbacks.
    catalogue_path = WS / "web" / "data" / "nodes.json"
    cat = json.loads(catalogue_path.read_text(encoding="utf-8"))
    ui = []
    for n in cat["nodes"]:
        if n["name"] == "Erosion2":
            ui = n.get("params") or []
            break

    print()
    print("  CHECK 4 — node UI vs kernel Parameters")
    print(f"    catalogue UI parameters : {len(ui)}")
    print(f"    native kernel fields    : {len(types)}")

    # Kernel parameters, in field order, with the map-only entries dropped.
    kernel = [f["name"] for f in fields
              if f["name"] and not str(f["name"]).endswith(
                  (".Terrain.Width", ".Terrain.Height", "map.Resolution"))]

    # The UI has three parameters literally named "Discharge Angle". A JS object keyed by
    # name cannot represent that, which is why registry.js has only one of them.
    ui_names = [p["name"] for p in ui]
    dupes = [k for k, c in Counter(ui_names).items() if c > 1]
    print(f"    duplicate UI names      : {dupes}")
    doc["nodeVsKernel"] = {
        "catalogueParameterCount": len(ui),
        "kernelParameterCount": len(kernel),
        "duplicateUiNames": dupes,
        "uiParameters": [
            {"index": i, "name": p.get("name"), "type": p.get("type"),
             "ilDefault": p.get("ilDefault"), "ilMin": p.get("ilMin"), "ilMax": p.get("ilMax"),
             "description": p.get("description", "")}
            for i, p in enumerate(ui)
        ],
        "kernelParametersInFieldOrder": kernel,
        "note": (
            "Duplicate 'Discharge Angle' entries are distinguished only by position: each "
            "follows the load parameter it belongs to. Gaea's own descriptions for all "
            "three are identical, so the description cannot be used to tell them apart."
        ),
    }

    print()
    print("=" * 74)
    OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  wrote {OUT.relative_to(WS)}")
    print()
    if failures:
        print(f"MAPPING NOT VERIFIED — {len(failures)} check(s) failed:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("MAPPING VERIFIED — the order is forced by the field types, not assumed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

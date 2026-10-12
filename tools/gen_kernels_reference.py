#!/usr/bin/env python3
"""Generate the human-readable kernel reference from recovered evidence.

Inputs:
  evidence/kernels/metadata.json        per-assembly member inventories
  evidence/kernels/native-symbols.json  native SYCL symbol signatures
  docs/node-specs-from-il.json          node -> algorithm entry points

The native symbol table is the strongest kernel evidence available on a host
with no decompiler: the shipped SYCL binaries carry mangled C++ names whose
argument lists still describe each kernel interface.

Important asymmetry this document makes explicit: the C++/CLI wrapper classes
keep readable field names (authored source identifiers such as
`m_fluvial_erosion_strength`), whereas the managed `SyclFunctions.*.Parameters`
structs have obfuscated field names. So the C++/CLI layer, not the managed
layer, is the authoritative parameter list.

Usage:
    python gen_kernels_reference.py <metadata.json> <native-symbols.json> <specs.json> <out.md>
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ALGORITHM_NAMESPACES = {
    "parallel_erosion", "flow", "thermal", "thermal_shaper", "lighting",
    "lighting_x", "color_transport", "resampling", "MeshRasterizer",
    "mesh_rasterizer", "mesh_port", "shm", "lake", "Debris",
}
VENDOR_NAMESPACES = {"Concurrency", "Assimp", "aiScene", "aiMaterial", "aiNode", "std"}

# Field-name prefixes used by the C++ layer; stripped for readability.
MEMBER_PREFIXES = ("m_", "_")


def simplify(t: str) -> str:
    """Shorten unreadable STL/SYCL type spellings for display."""
    t = re.sub(r"std::allocator<[^>]*>", "alloc", t)
    t = re.sub(r"hipsycl::sycl::", "sycl::", t)
    t = re.sub(r"sycl::detail::vec_storage<[^>]*>", "…", t)
    t = re.sub(r",alloc,void>", ">", t)
    t = re.sub(r"\s+", " ", t)
    return t if len(t) <= 110 else t[:107] + "..."


def clean_field(f: str) -> tuple[str, str]:
    """'Double m_fluvial_erosion_strength' -> ('fluvial_erosion_strength', 'Double')"""
    parts = f.split(" ", 1)
    if len(parts) != 2:
        return f, ""
    typ, name = parts[0], parts[1].strip()
    for p in MEMBER_PREFIXES:
        if name.startswith(p):
            name = name[len(p):]
            break
    return name, typ


def looks_obfuscated(name: str) -> bool:
    """True when a field name is private-use-area gibberish rather than authored text."""
    if not name:
        return True
    weird = sum(1 for ch in name if ord(ch) >= 0xE000)
    return weird > 0 or not re.search(r"[a-z]{3}", name)


def main() -> int:
    if len(sys.argv) < 5:
        print(__doc__)
        return 2
    meta_path, sym_path, spec_path, out_path = (Path(a) for a in sys.argv[1:5])

    meta = json.loads(meta_path.read_text(encoding="utf-8-sig")) if meta_path.exists() else {}
    syms = json.loads(sym_path.read_text(encoding="utf-8-sig")) if sym_path.exists() else {}
    specs = json.loads(spec_path.read_text(encoding="utf-8")) if spec_path.exists() else {"nodes": []}

    entry_users: dict[str, list[str]] = defaultdict(list)
    for c in specs.get("nodes", []):
        bc = c.get("build_call")
        if bc:
            entry_users[bc].append(c.get("node_name") or c["class_name"])

    L: list[str] = []
    L.append("# Gaea 2.0 compute kernel reference")
    L.append("")
    L.append("Gaea's terrain arithmetic is not managed code. This documents everything")
    L.append("recoverable on a host with no Ghidra/IDA/Hopper, no network access, and no")
    L.append("native debug symbols: parameter surfaces from the C++/CLI and managed")
    L.append("layers, plus the **native SYCL symbol signatures** present in the shipped")
    L.append("binaries.")
    L.append("")
    L.append("| Marker | Meaning |")
    L.append("| --- | --- |")
    L.append("| `observed` | Symbol name, argument list, or field name read from shipped metadata |")
    L.append("| `derived` | Structure inferred from those signatures (input/output roles) |")
    L.append("| `inferred` | Mathematical form or physical meaning; not present in the artifacts |")
    L.append("")
    L.append("## Layering")
    L.append("")
    L.append("```")
    L.append("Nodes.json                       UI catalog: names, descriptions, enum members")
    L.append("      |")
    L.append("Gaea.Nodes.dll    (obfuscated)   [Parameter] defaults/ranges; Build() call site")
    L.append("      |  calls")
    L.append("      v")
    L.append("Gaea.Engine.dll   (managed)      SyclFunctions.*.Parameters structs; Map/Channel")
    L.append("      |  P/Invoke")
    L.append("      v")
    L.append("Gaea.CE/CS/CW/TS.dll (C++/CLI)   XxxWrapper fields + SetVars(...) order")
    L.append("      |  C++")
    L.append("      v")
    L.append("Gaea.Native / oneAPI / AdaptiveCpp.dll (native SYCL)   kernel symbols only")
    L.append("```")
    L.append("")
    L.append("The compiled toolchain is confirmed by the symbols themselves: argument")
    L.append("types appear as `hipsycl::sycl::*` (AdaptiveCpp) in `Gaea.AdaptiveCpp.dll`")
    L.append("and `sycl::*` (Intel oneAPI) in `Gaea.oneAPI.dll`.")
    L.append("")

    # ---- native symbols ---------------------------------------------------
    dlls = syms.get("dlls", {})
    L.append("## Native SYCL symbol inventory")
    L.append("")
    if not dlls:
        L.append("*No native symbol data available.*")
        L.append("")
    else:
        L.append("| Binary | Gaea algorithm namespaces |")
        L.append("| --- | --- |")
        for dll in sorted(dlls):
            info = dlls[dll]
            ns = info.get("namespaces", {}) if isinstance(info, dict) else {}
            alg = {k: v for k, v in ns.items() if k not in VENDOR_NAMESPACES}
            cell = ", ".join(f"`{k}` ({v})" for k, v in sorted(alg.items())) or "—"
            L.append(f"| `{dll}` | {cell} |")
        L.append("")
        L.append("Bundled third-party runtimes also appear and are not Gaea algorithms: "
                 + ", ".join(f"`{n}`" for n in sorted(VENDOR_NAMESPACES)) + ".")
        L.append("")

        merged: dict[str, list[tuple[str, dict]]] = defaultdict(list)
        for dll, info in dlls.items():
            methods = info.get("methods", {}) if isinstance(info, dict) else {}
            for m in methods.values():
                if not isinstance(m, dict):
                    continue
                ns = m.get("namespace", "")
                if not ns or ns in VENDOR_NAMESPACES:
                    continue
                merged[ns].append((dll, m))

        L.append("## Kernels by namespace")
        L.append("")
        L.append("Buffer columns are `derived` from the symbol's argument list; the argument")
        L.append("string is `observed`.")
        L.append("")
        for ns in sorted(merged, key=lambda k: (k not in ALGORITHM_NAMESPACES, k)):
            entries = merged[ns]
            tag = "algorithm" if ns in ALGORITHM_NAMESPACES else "support/auxiliary"
            L.append(f"### `{ns}` — {len(entries)} symbols ({tag})")
            L.append("")
            L.append("| Symbol | Buffers (derived) | First overload (simplified, observed) |")
            L.append("| --- | --- | --- |")
            for _, m in sorted(entries, key=lambda x: x[1].get("method", "")):
                method = m.get("method", "?")
                dims = m.get("bufferDims") or []
                elems = m.get("bufferElementTypes") or []
                bits = []
                if dims:
                    bits.append("dim" + "/".join(str(d) for d in dims))
                if elems:
                    bits.append("[" + ", ".join(simplify(e) for e in elems[:3]) + "]")
                shape = " ".join(bits) or "—"
                ov = [o for o in (m.get("overloads") or []) if isinstance(o, dict)]
                sig = ov[0].get("args", "") if ov else ""
                more = f" **+{len(ov) - 1} overloads**" if len(ov) > 1 else ""
                L.append(f"| `{method}` | {shape} | `{simplify(sig)}`{more} |")
            L.append("")

    # ---- C++/CLI + managed parameter surfaces -----------------------------
    L.append("## Parameter surfaces")
    L.append("")
    L.append("**Readability asymmetry (important):** the C++/CLI wrapper classes keep")
    L.append("authored field names; the managed `SyclFunctions.*.Parameters` structs have")
    L.append("obfuscated ones. The C++/CLI layer is therefore the authoritative parameter")
    L.append("list, and it is reproduced in full below.")
    L.append("")

    assemblies = meta.get("assemblies", {}) if isinstance(meta, dict) else {}
    for asm in sorted(assemblies):
        members = assemblies[asm].get("members", {}) if isinstance(assemblies[asm], dict) else {}
        interesting = {
            k: v for k, v in members.items()
            if "Wrapper" in k or k.endswith(".Parameters")
        }
        if not interesting:
            continue
        L.append(f"### `{asm}`")
        L.append("")
        for name in sorted(interesting):
            v = interesting[name]
            fields = v.get("fields") or []
            readable = [clean_field(f) for f in fields if not looks_obfuscated(clean_field(f)[0])]
            if not readable:
                L.append(f"- `{name}` — {len(fields)} fields, **all obfuscated** "
                         f"(no recoverable parameter names at this layer)")
                continue
            L.append(f"#### `{name}` ({v.get('kind','?')}, {len(fields)} fields, "
                     f"{len(readable)} readable)")
            L.append("")
            L.append("| Field | Type | Role (derived) |")
            L.append("| --- | --- | --- |")
            for fname, ftype in sorted(readable):
                role = derive_role(fname)
                L.append(f"| `{fname}` | `{ftype}` | {role} |")
            L.append("")

    # ---- node -> algorithm mapping ---------------------------------------
    L.append("## Node to algorithm entry points")
    L.append("")
    L.append("Extracted from decompiled `Build()` bodies, so this mapping is `observed`.")
    L.append("")
    L.append("| Algorithm entry point | Nodes that call it |")
    L.append("| --- | --- |")
    for entry in sorted(entry_users):
        users = sorted(set(entry_users[entry]))
        shown = ", ".join(f"`{u}`" for u in users[:10])
        if len(users) > 10:
            shown += f" (+{len(users) - 10} more)"
        L.append(f"| `{entry}` | {shown} |")
    L.append("")

    out = Path(out_path)
    out.write_text("\n".join(L), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size:,} bytes)")
    return 0


def derive_role(field: str) -> str:
    """Classify a wrapper field by name. Derived, not observed."""
    f = field.lower()
    if any(k in f for k in ("heightmap", "height_range", "results", "wear", "deposit",
                            "flow", "mask", "sediment", "output")):
        return "data buffer"
    if "seed" in f or "random" in f:
        return "randomness"
    if any(k in f for k in ("resolution", "size", "scale", "threads", "width", "depth")):
        return "scale / resolution"
    if any(k in f for k in ("enable", "invert", "mode", "model", "detail", "laminar",
                            "rivers", "fixed", "by_shader")):
        return "mode flag"
    if any(k in f for k in ("angle", "talus", "softness", "roughness", "smoothness",
                            "strength", "duration", "volume", "level", "lakes",
                            "density", "removal", "settling", "retardation",
                            "downcutting", "debris")):
        return "physical parameter"
    return ""


if __name__ == "__main__":
    raise SystemExit(main())

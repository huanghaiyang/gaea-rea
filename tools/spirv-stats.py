#!/usr/bin/env python3
"""Compact per-module statistics, to check which extracted modules are really readable.

Kept separate from the disassembler because dumping a module's OpName table is thousands
of lines of SYCL scaffolding; what matters first is whether a module parsed cleanly at all.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

spec = importlib.util.spec_from_file_location(
    "dis", str(pathlib.Path(__file__).resolve().parent / "spirv-dis.py"))
dis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dis)


def stats(path: pathlib.Path) -> None:
    buf = path.read_bytes()
    base = buf.find(dis.MAGIC_LE)
    if base < 0:
        print(f"{path.name}: no SPIR-V magic")
        return
    try:
        mod = dis.Module(buf, base)
    except Exception as e:
        print(f"{path.name}: parse failed {e}")
        return

    # A module is plausible only if the instruction walk ended cleanly: a truncated or
    # mis-based module yields far fewer constants than its function count implies.
    funcs = len(mod.functions)
    consts = len(mod.consts)
    named = sum(1 for f in mod.functions if f["id"] in mod.names)
    # How many float constants, and a sample of the interesting ones.
    floats = []
    import struct
    for c in mod.consts.values():
        t = mod.types.get(c["t"], {})
        if t.get("k") == "float" and t.get("w") == 32 and c["v"] and not c.get("composite"):
            floats.append(struct.unpack("<f", struct.pack("<I", c["v"][0]))[0])
    sample = sorted({round(f, 6) for f in floats})[:14] if floats else []

    print(f"{path.name:14} {len(buf):>9,} B  words={len(mod.words):>8,}  "
          f"funcs={funcs:>4}  named={named:>4}  consts={consts:>5}  "
          f"f32consts={len(floats):>5}  types={len(mod.types):>4}")
    if sample:
        print(f"               float sample: {', '.join(str(x) for x in sample)}")


if __name__ == "__main__":
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".build/spirv")
    for p in sorted(root.glob("*.spv")):
        stats(p)

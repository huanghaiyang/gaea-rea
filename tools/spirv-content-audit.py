#!/usr/bin/env python3
"""Decide what the embedded SPIR-V actually contains: metadata, or executable bodies?

This is a correction tool. An earlier round concluded from an over-long carve that Gaea's
particle-erosion kernel bodies were readable in Gaea.oneAPI.dll's SPIR-V. That conclusion
rested on a carve that ran from one magic to the next and swallowed the trailing
`0x17171717` filler plus adjacent data, which decoded as plausible-looking instructions.

With the carve stopping at the filler, the modules must be re-assessed. The question is
answerable exactly: a module that contains executable code MUST contain OpType* declarations,
OpConstant* literals and OpFunction bodies. A module with only OpString/OpName/OpEntryPoint
is a reflection blob.

Run: python tools/spirv-content-audit.py .build/spirv2
"""
from __future__ import annotations

import pathlib
import struct
import sys
from collections import Counter

MAGIC_LE = b"\x03\x02\x23\x07"

# Opcodes grouped by what their presence proves.
GROUPS = {
    "capability/header": [14, 15, 16, 17],
    "debug/reflection only": [3, 4, 5, 6, 7, 8],
    "types": list(range(19, 34)),
    "constants": list(range(39, 53)),
    "functions": [54, 55, 56],
    "arithmetic/memory": list(range(61, 84)) + list(range(99, 170)),
    "control flow": list(range(195, 206)) + [246, 247, 248, 249],
    "atomics/group": list(range(171, 188)) + list(range(207, 281)),
}

NAMES = {
    3: "OpSource", 4: "OpSourceExtension", 5: "OpName", 6: "OpMemberName",
    7: "OpString", 8: "OpLine", 11: "OpExtInstImport", 12: "OpExtInst",
    14: "OpMemoryModel", 15: "OpEntryPoint", 16: "OpExecutionMode", 17: "OpCapability",
}


def audit(buf: bytes) -> dict:
    n = len(buf) // 4
    ws = struct.unpack_from(f"<{n}I", buf, 0)
    counts: Counter = Counter()
    i = 5
    while i < len(ws):
        wc = ws[i] >> 16
        op = ws[i] & 0xFFFF
        if wc == 0 or i + wc > len(ws):
            break
        counts[op] += 1
        i += wc
    groups = {}
    for label, ops in GROUPS.items():
        groups[label] = sum(counts.get(o, 0) for o in ops)
    return {"counts": counts, "groups": groups, "instructions": sum(counts.values())}


def main() -> int:
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".build/spirv2")
    files = sorted(root.glob("*.spv"))
    if not files:
        print(f"no .spv in {root}")
        return 1

    print(f"{'module':<10} {'instr':>7} {'types':>6} {'consts':>7} {'funcs':>6} "
          f"{'arith':>7} {'ctrl':>6} {'debug':>7}  content")
    print("-" * 82)

    any_code = False
    for p in files:
        a = audit(p.read_bytes())
        g = a["groups"]
        has_code = g["functions"] > 0 or g["types"] > 0
        any_code = any_code or has_code
        verdict = "CODE" if has_code else "metadata only"
        print(f"{p.name:<10} {a['instructions']:>7} {g['types']:>6} {g['constants']:>7} "
              f"{g['functions']:>6} {g['arithmetic/memory']:>7} {g['control flow']:>6} "
              f"{g['debug/reflection only']:>7}  {verdict}")

    print()
    if not any_code:
        print("VERDICT: every module is reflection metadata.")
        print()
        print("  They carry OpEntryPoint and OpName, so the KERNEL NAMES AND THEIR FULL C++")
        print("  SIGNATURES are recoverable — the mangled names encode parameter types and")
        print("  arity. What is NOT here is any OpType*, OpConstant* or OpFunction, so the")
        print("  modules contain no algorithm, no literals and no control flow.")
        print()
        print("  Consequence: the SPIR-V route yields an INTERFACE INVENTORY, not bodies.")
        print("  Kernel implementations must come from disassembling the native libraries.")
    else:
        code = [p.name for p in files
                if audit(p.read_bytes())["groups"]["functions"] > 0]
        print(f"VERDICT: executable code present in {', '.join(code)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

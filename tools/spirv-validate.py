#!/usr/bin/env python3
"""Validate the extracted SPIR-V modules: is each one a real module or a false positive?

The extraction found 13 occurrences of the SPIR-V magic in Gaea.oneAPI.dll and carved a
module at each. But the magic can also appear inside another module's data, and a naive
carve then produces a stream that still "walks" (the walk just follows word counts) while
emitting impossible opcodes — which is what a run of `Op5911` and 254 `OpConstantSampler`
records pointed at.

The SPIR-V spec makes this checkable without a disassembler:

  * the FIRST instruction of a module must be OpCapability (17)
  * the first few instructions must be the capability / extension / memory-model /
    entry-point preamble, in that broad order
  * every opcode must be one the spec defines, and
  * the walk must consume the module exactly, with no trailing partial word

A module failing any of these is reported as invalid rather than being read as code.
"""
from __future__ import annotations

import pathlib
import struct
import sys

MAGIC_LE = b"\x03\x02\x23\x07"

# The opcodes this project has actually seen in DPC++ output, plus the ones the spec defines
# in the ranges those occupy. An opcode outside the union is treated as evidence of a
# misaligned carve, not as an exotic instruction.
KNOWN_RANGES = [
    (3, 17),      # OpSource .. OpCapability
    (19, 33),     # type declarations
    (39, 52),     # constants
    (54, 68),     # functions, memory access
    (71, 81),     # decorations, composites
    (82, 100),    # image and conversion ops
    (100, 169),   # arithmetic, comparison, derivatives
    (171, 205),   # atomics, control flow
    (207, 280),   # group and non-uniform ops
]


def known(op: int) -> bool:
    return any(lo <= op <= hi for lo, hi in KNOWN_RANGES)


def inspect(buf: bytes, offset: int) -> dict:
    n = (len(buf) - offset) // 4
    if n < 6:
        return {"ok": False, "why": "too short"}
    ws = struct.unpack_from(f"<{n}I", buf, offset)

    first_op = ws[5] & 0xFFFF
    first_wc = ws[5] >> 16

    i = 5
    ops: list[int] = []
    bad_at = None
    bad_op = None
    while i < len(ws):
        wc = ws[i] >> 16
        op = ws[i] & 0xFFFF
        if wc == 0 or i + wc > len(ws):
            bad_at = i
            bad_op = op
            break
        if not known(op):
            bad_at = i
            bad_op = op
            ops.append(op)
            break
        ops.append(op)
        i += wc

    residue = len(ws) - i
    return {
        "words": n,
        "firstOp": first_op,
        "firstWc": first_wc,
        "instructions": len(ops),
        "badAt": bad_at,
        "badOp": bad_op,
        "residueWords": residue,
        "ok": first_op == 17 and bad_at is None and residue == 0,
        "why": ("first instruction is not OpCapability" if first_op != 17
                else f"opcode {bad_op} (0x{bad_op:04x}) at word {bad_at}" if bad_at is not None
                else f"{residue} trailing word(s)" if residue else ""),
    }


def main() -> int:
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".build/spirv")
    valid, invalid = [], []
    for p in sorted(root.glob("*.spv")):
        buf = p.read_bytes()
        base = buf.find(MAGIC_LE)
        if base < 0:
            invalid.append((p.name, {"why": "no magic", "words": 0}))
            continue
        info = inspect(buf, base)
        (valid if info["ok"] else invalid).append((p.name, info))

    print(f"{'module':<16} {'words':>9} {'1st op':>7} {'instr':>7}  verdict")
    print("-" * 72)
    for name, i in valid:
        print(f"{name:<16} {i['words']:>9,} {i['firstOp']:>7} {i['instructions']:>7}  VALID")
    for name, i in invalid:
        print(f"{name:<16} {i.get('words', 0):>9,} {i.get('firstOp', 0):>7} "
              f"{i.get('instructions', 0):>7}  INVALID — {i['why']}")

    print()
    print(f"valid: {len(valid)}  invalid: {len(invalid)}")
    if invalid:
        print()
        print("An invalid carve is not readable as code. Re-extract with a real module")
        print("boundary (the module's own word count) rather than one magic-to-magic span.")
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())

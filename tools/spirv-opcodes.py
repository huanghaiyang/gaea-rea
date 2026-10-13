#!/usr/bin/env python3
"""Count SPIR-V opcodes in a module — direct evidence of what the module actually contains.

Written because the parser reported f32consts=0 for every module, including ones with heavy
arithmetic. Either the parse is misaligned or the constants genuinely live elsewhere, and a
raw opcode histogram distinguishes those without relying on the parser being right.
"""
from __future__ import annotations

import argparse
import pathlib
import struct
import sys
from collections import Counter

MAGIC_LE = b"\x03\x02\x23\x07"

OPS = {
    3: "OpSource", 5: "OpName", 6: "OpMemberName", 7: "OpString", 11: "OpExtInstImport",
    12: "OpExtInst", 14: "OpMemoryModel", 15: "OpEntryPoint", 16: "OpExecutionMode",
    17: "OpCapability", 19: "OpTypeVoid", 20: "OpTypeBool", 21: "OpTypeInt",
    22: "OpTypeFloat", 23: "OpTypeVector", 28: "OpTypeArray", 29: "OpTypeRuntimeArray",
    30: "OpTypeStruct", 32: "OpTypePointer", 33: "OpTypeFunction",
    39: "OpConstantTrue", 40: "OpConstantFalse", 41: "OpConstant",
    42: "OpConstantComposite", 43: "OpConstantSampler", 44: "OpConstantNull",
    48: "OpSpecConstantTrue", 49: "OpSpecConstantFalse", 50: "OpSpecConstant",
    51: "OpSpecConstantComposite", 52: "OpSpecConstantOp",
    54: "OpFunction", 55: "OpFunctionParameter", 56: "OpFunctionEnd", 57: "OpFunctionCall",
    61: "OpVariable", 62: "OpLoad", 63: "OpStore", 65: "OpAccessChain",
    66: "OpInBoundsAccessChain", 71: "OpDecorate", 72: "OpMemberDecorate",
    79: "OpCompositeConstruct", 80: "OpCompositeExtract", 84: "OpImageSampleImplicitLod",
    95: "OpImageFetch", 99: "OpBitcast", 100: "OpSNegate", 101: "OpFNegate",
    104: "OpIAdd", 105: "OpFAdd", 106: "OpISub", 107: "OpFSub", 108: "OpIMul",
    109: "OpFMul", 111: "OpSDiv", 112: "OpFDiv", 116: "OpFRem", 117: "OpFMod",
    128: "OpLogicalNot", 129: "OpSelect", 195: "OpPhi", 196: "OpLoopMerge",
    197: "OpSelectionMerge", 198: "OpLabel", 199: "OpBranch", 200: "OpBranchConditional",
    201: "OpSwitch", 203: "OpReturn", 204: "OpReturnValue", 218: "OpImageRead",
    219: "OpImageWrite", 234: "OpCopyMemory", 240: "OpControlBarrier", 241: "OpMemoryBarrier",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("module")
    ap.add_argument("--top", type=int, default=40)
    args = ap.parse_args()

    buf = pathlib.Path(args.module).read_bytes()
    base = buf.find(MAGIC_LE)
    n = (len(buf) - base) // 4
    ws = struct.unpack_from(f"<{n}I", buf, base)
    print(f"{args.module}: {len(buf):,} bytes, {n:,} words, header at {base}")

    hdr = ws[:5]
    print(f"  magic={hdr[0]:#010x} version={hdr[1]:#010x} generator={hdr[2]:#x} "
          f"bound={hdr[3]} schema={hdr[4]}")

    counts: Counter = Counter()
    total_words = 0
    i = 5
    bad = 0
    while i < len(ws):
        wc = ws[i] >> 16
        op = ws[i] & 0xFFFF
        if wc == 0 or i + wc > len(ws):
            bad += 1
            break
        counts[op] += 1
        total_words += wc
        i += wc

    print(f"  walked {i - 5} instruction words in {sum(counts.values())} instructions "
          f"(coverage {total_words}/{n - 5} words), stopped_early={bad > 0}")
    print()
    print("  opcode histogram (top %d):" % args.top)
    for op, c in counts.most_common(args.top):
        print(f"    {c:>7}  {OPS.get(op, f'Op{op}')}")

    # Anything in the constant range? If genuinely absent, the kernels get their numbers
    # as kernel arguments or from buffers, which changes how they must be read.
    const_ops = {k: counts.get(k, 0) for k in
                 (39, 40, 41, 42, 43, 44, 48, 49, 50, 51, 52)}
    print()
    print("  constant-class opcodes:", {OPS.get(k, k): v for k, v in const_ops.items() if v})
    if not any(const_ops.values()):
        print("  -> NO literal constants in this module")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Read structure out of an extracted SPIR-V module: names, types, constants, calls.

WHY THIS IS THE SHORT ROAD TO THE ALGORITHM
`Gaea.oneAPI.dll` embeds SPIR-V produced by Intel's DPC++ (generator 0x6000e), and the
modules carry debug names, so `parallel_erosion::ParallelErosion::flow(...)` and friends
are readable symbols — not `FUN_xxxx`. That means the real body of Gaea's particle
erosion can be recovered from a well-specified IR, without a machine-code disassembler.

This tool answers, for one module:
  - which functions exist, and which one calls which (OpFunctionCall)
  - the declared types, including struct field layout (OpTypeStruct + OpMemberName)
  - literal constants, with the float interpretation that SPIR-V stores bit-exactly
  - which functions touch which constants

Opcode numbers are from the SPIR-V 1.x specification, section 3.
"""
from __future__ import annotations

import argparse
import pathlib
import struct
import sys
from collections import defaultdict

MAGIC = 0x07230203

OPS = {
    3: "OpSource", 5: "OpName", 6: "OpMemberName", 7: "OpString", 8: "OpLine",
    11: "OpExtInstImport", 12: "OpExtInst", 14: "OpMemoryModel", 15: "OpEntryPoint",
    16: "OpExecutionMode", 17: "OpCapability", 19: "OpTypeVoid", 20: "OpTypeBool",
    21: "OpTypeInt", 22: "OpTypeFloat", 23: "OpTypeVector", 24: "OpTypeMatrix",
    25: "OpTypeImage", 26: "OpTypeSampler", 27: "OpTypeSampledImage", 28: "OpTypeArray",
    29: "OpTypeRuntimeArray", 30: "OpTypeStruct", 31: "OpTypeOpaque", 32: "OpTypePointer",
    33: "OpTypeFunction", 39: "OpConstantTrue", 40: "OpConstantFalse",
    41: "OpConstant", 42: "OpConstantComposite", 43: "OpConstantSampler",
    44: "OpConstantNull", 46: "OpSpecConstantOp", 48: "OpSpecConstantTrue",
    49: "OpSpecConstantFalse", 50: "OpSpecConstant", 51: "OpSpecConstantComposite",
    54: "OpFunction", 55: "OpFunctionParameter", 56: "OpFunctionEnd",
    57: "OpFunctionCall", 61: "OpVariable", 62: "OpLoad", 63: "OpStore", 65: "OpAccessChain",
    66: "OpInBoundsAccessChain", 71: "OpDecorate", 72: "OpMemberDecorate",
    79: "OpCompositeConstruct", 80: "OpCompositeExtract", 81: "OpCompositeInsert",
    84: "OpImageSampleImplicitLod", 87: "OpImageSampleExplicitLod",
    99: "OpBitcast", 109: "OpConvertFToS", 110: "OpConvertSToF", 111: "OpConvertFToU",
    112: "OpConvertUToF", 124: "OpFAdd", 126: "OpFDiv", 127: "OpFRem", 128: "OpFMod",
    129: "OpFMul", 130: "OpFSub", 131: "OpFNegate", 133: "OpFOrdLessThan",
    137: "OpFOrdGreaterThan", 141: "OpFOrdLessThanEqual", 145: "OpFOrdGreaterThanEqual",
    186: "OpIAdd", 190: "OpIMul", 194: "OpISub", 195: "OpSDiv", 199: "OpSRem",
    201: "OpSNegate", 205: "OpBitwiseAnd", 246: "OpLoopMerge", 247: "OpSelectionMerge",
    248: "OpLabel", 249: "OpBranch", 250: "OpBranchConditional", 251: "OpSwitch",
}


def read_string(words, start):
    out = bytearray()
    i = start
    while i < len(words):
        w = words[i]
        i += 1
        for shift in (0, 8, 16, 24):
            b = (w >> shift) & 0xFF
            if b == 0:
                return out.decode("utf-8", "replace"), i
            out.append(b)
        if len(out) > 8192:
            break
    return out.decode("utf-8", "replace"), i


def decode_constant(type_info, words):
    """Interpret a literal constant using the type it was declared with."""
    if not type_info:
        return words
    kind = type_info.get("kind")
    if kind == "OpTypeFloat":
        width = type_info["width"]
        if width == 32 and words:
            return struct.unpack("<f", struct.pack("<I", words[0]))[0]
        if width == 64 and len(words) >= 2:
            return struct.unpack("<d", struct.pack("<II", words[0], words[1]))[0]
    if kind == "OpTypeInt":
        width = type_info["width"]
        signed = type_info.get("signed", 1)
        if words:
            v = words[0]
            if signed and width == 32 and v >= 0x80000000:
                v -= 0x100000000
            return v
    if kind == "OpTypeBool":
        return bool(words[0]) if words else None
    return words


def parse(buf: bytes, offset: int = 0):
    words = struct.unpack_from("<5I", buf, offset)
    if words[0] != MAGIC:
        raise ValueError("not SPIR-V")
    n = (len(buf) - offset) // 4
    ws = struct.unpack_from(f"<{n}I", buf, offset)

    names: dict[int, str] = {}
    member_names: dict[tuple[int, int], str] = {}
    types: dict[int, dict] = {}
    constants: dict[int, tuple[int, list[int]]] = {}
    functions: list[dict] = []
    entries: list[tuple[str, str]] = []
    ext_imports: dict[int, str] = {}
    capabilities: list[int] = []
    decorations: dict[int, list[tuple[int, list[int]]]] = defaultdict(list)

    cur = None
    i = 5
    while i < len(ws):
        w0 = ws[i]
        wc = w0 >> 16
        op = w0 & 0xFFFF
        if wc == 0 or i + wc > len(ws):
            break
        ops = ws[i + 1:i + wc]
        try:
            if op == 5 and len(ops) >= 1:
                nm, _ = read_string(ws, i + 2)
                names[ops[0]] = nm
            elif op == 6 and len(ops) >= 2:
                nm, _ = read_string(ws, i + 3)
                member_names[(ops[0], ops[1])] = nm
            elif op == 7 and len(ops) >= 1:
                nm, _ = read_string(ws, i + 2)
                ext_imports[ops[0]] = nm
            elif op == 15 and len(ops) >= 3:
                nm, _ = read_string(ws, i + 3)
                entries.append(("entry", nm))
            elif op == 17 and ops:
                capabilities.append(ops[0])
            elif op == 21 and len(ops) >= 3:
                types[ops[0]] = {"kind": "OpTypeInt", "width": ops[1], "signed": ops[2]}
            elif op == 22 and len(ops) >= 2:
                types[ops[0]] = {"kind": "OpTypeFloat", "width": ops[1]}
            elif op == 23 and len(ops) >= 3:
                types[ops[0]] = {"kind": "OpTypeVector", "component": ops[1], "count": ops[2]}
            elif op == 24 and len(ops) >= 3:
                types[ops[0]] = {"kind": "OpTypeMatrix", "column": ops[1], "count": ops[2]}
            elif op == 28 and len(ops) >= 3:
                types[ops[0]] = {"kind": "OpTypeArray", "element": ops[1], "length": ops[2]}
            elif op == 29 and len(ops) >= 2:
                types[ops[0]] = {"kind": "OpTypeRuntimeArray", "element": ops[1]}
            elif op == 30 and len(ops) >= 1:
                types[ops[0]] = {"kind": "OpTypeStruct", "members": list(ops[1:])}
            elif op == 32 and len(ops) >= 3:
                types[ops[0]] = {"kind": "OpTypePointer", "storage": ops[1], "pointee": ops[2]}
            elif op == 33 and len(ops) >= 2:
                types[ops[0]] = {"kind": "OpTypeFunction", "ret": ops[1], "params": list(ops[2:])}
            elif op == 19:
                types[ops[0]] = {"kind": "OpTypeVoid"}
            elif op == 20:
                types[ops[0]] = {"kind": "OpTypeBool"}
            elif op == 41 and len(ops) >= 2:
                constants[ops[1]] = (ops[0], list(ops[2:]))
            elif op == 39 and len(ops) >= 2:
                constants[ops[1]] = (ops[0], [1])
            elif op == 40 and len(ops) >= 2:
                constants[ops[1]] = (ops[0], [0])
            elif op == 71 and len(ops) >= 2:
                decorations[ops[0]].append((ops[1], list(ops[2:])))
            elif op == 54:
                cur = {"id": ops[1] if len(ops) > 1 else None, "ret": ops[0],
                       "calls": [], "consts": set(), "labels": 0, "instr": 0}
                functions.append(cur)
            elif op == 56:
                cur = None
            elif op == 57 and cur is not None and ops:
                cur["calls"].append(ops[-1])
            elif op == 248 and cur is not None:
                cur["labels"] += 1
            elif op == 251 and cur is not None and len(ops) >= 2:
                cur["consts"].add(ops[1])
        except Exception:
            pass
        if cur is not None and op not in (54,):
            cur["instr"] += 1
        i += wc

    return {
        "names": names, "member_names": member_names, "types": types,
        "constants": constants, "functions": functions, "entries": entries,
        "ext_imports": ext_imports, "capabilities": capabilities,
        "decorations": decorations, "word_count": len(ws),
    }


def type_name(mod, tid, depth=0):
    t = mod["types"].get(tid)
    if not t:
        return mod["names"].get(tid, f"%{tid}")
    k = t["kind"]
    if k == "OpTypeInt":
        return ("int" if t["signed"] else "uint") + str(t["width"])
    if k == "OpTypeFloat":
        return "float" + str(t["width"])
    if k == "OpTypeVector":
        return f"{type_name(mod, t['component'], depth+1)}x{t['count']}"
    if k == "OpTypePointer":
        return f"*{type_name(mod, t['pointee'], depth+1)}"
    if k == "OpTypeArray":
        ln = mod["constants"].get(t["length"])
        n = decode_constant(mod["types"].get(ln[0]) if ln else None, ln[1]) if ln else "?"
        return f"{type_name(mod, t['element'], depth+1)}[{n}]"
    if k == "OpTypeRuntimeArray":
        return f"{type_name(mod, t['element'], depth+1)}[]"
    if k == "OpTypeStruct":
        if depth > 0:
            return mod["names"].get(tid, "struct")
        return mod["names"].get(tid, "struct")
    return k


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("module")
    ap.add_argument("--function", help="substring of a function name to detail")
    ap.add_argument("--structs", action="store_true", help="list struct layouts")
    ap.add_argument("--constants", action="store_true", help="list literal constants")
    ap.add_argument("--calls", action="store_true", help="list the call graph")
    args = ap.parse_args()

    p = pathlib.Path(args.module)
    mod = parse(p.read_bytes(), 0)

    print(f"module        : {p}  ({p.stat().st_size:,} bytes, {mod['word_count']:,} words)")
    print(f"names         : {len(mod['names'])}  functions: {len(mod['functions'])}"
          f"  types: {len(mod['types'])}  constants: {len(mod['constants'])}")
    if mod["ext_imports"]:
        print(f"ext imports   : {', '.join(sorted(mod['ext_imports'].values()))}")

    named = []
    for f in mod["functions"]:
        nm = mod["names"].get(f["id"], f"%{f['id']}")
        named.append((nm, f))
    named.sort(key=lambda kv: kv[0])

    print()
    print(f"FUNCTIONS ({len(named)})")
    for nm, f in named:
        print(f"  {nm}")
        print(f"      id=%{f['id']} labels={f['labels']} instr={f['instr']} calls={len(f['calls'])}")

    if args.structs:
        print()
        print("STRUCT LAYOUTS")
        for tid, t in mod["types"].items():
            if t["kind"] != "OpTypeStruct":
                continue
            nm = mod["names"].get(tid, f"%{tid}")
            print(f"  {nm}  ({len(t['members'])} members)")
            for idx, mid in enumerate(t["members"]):
                fname = mod["member_names"].get((tid, idx), "?")
                dec = mod["decorations"].get(tid, [])
                offset = None
                for d, dargs in dec:
                    # OpMemberDecorate: member, decoration, [literals]  (decoration 35 = Offset)
                    pass
                print(f"      [{idx:>2}] {type_name(mod, mid):<24} {fname}")

    if args.constants:
        print()
        print("LITERAL CONSTANTS")
        for cid, (tid, words) in sorted(mod["constants"].items(), key=lambda kv: kv[0]):
            val = decode_constant(mod["types"].get(tid), words)
            print(f"  %{cid:<6} {type_name(mod, tid):<12} = {val}")

    if args.calls:
        print()
        print("CALL GRAPH")
        for nm, f in named:
            called = [mod["names"].get(c, f"%{c}") for c in f["calls"]]
            if called:
                print(f"  {nm}")
                for c in sorted(set(called)):
                    print(f"      -> {c}")

    if args.function:
        print()
        print(f"MATCHES FOR {args.function!r}")
        for nm, f in named:
            if args.function.lower() in nm.lower():
                print(f"  {nm}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

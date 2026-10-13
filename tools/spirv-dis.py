#!/usr/bin/env python3
"""Disassemble a SPIR-V function body into readable pseudo-code.

This is the reading tool for complete replication: SPIR-V is a fully specified IR, so the
*kernels* are recoverable, but only if the instruction stream can be read instead of stared
at. The output is a linear listing with SSA ids resolved to expressions, which is enough to
recover arithmetic, constants, memory access patterns and control flow.

Scope and honesty: this is a disassembler with expression folding, NOT a decompiler. It
does not reconstruct `if`/`for` structure or name variables. Loops show as labels and
branches. That is deliberate — a partial, faithful listing is more useful than a confident
reconstruction that quietly invents structure.

Usage:
  python tools/spirv-dis.py module.spv --list
  python tools/spirv-dis.py module.spv --function downsample_magic
"""
from __future__ import annotations

import argparse
import pathlib
import re
import struct
import sys
from collections import defaultdict

MAGIC = 0x07230203
MAGIC_LE = b"\x03\x02\x23\x07"

OPS = {
    3: "OpSource", 4: "OpSourceExtension", 5: "OpName", 6: "OpMemberName", 7: "OpString",
    8: "OpLine", 11: "OpExtInstImport", 12: "OpExtInst", 14: "OpMemoryModel",
    15: "OpEntryPoint", 16: "OpExecutionMode", 17: "OpCapability", 19: "OpTypeVoid",
    20: "OpTypeBool", 21: "OpTypeInt", 22: "OpTypeFloat", 23: "OpTypeVector",
    24: "OpTypeMatrix", 25: "OpTypeImage", 26: "OpTypeSampler", 27: "OpTypeSampledImage",
    28: "OpTypeArray", 29: "OpTypeRuntimeArray", 30: "OpTypeStruct", 31: "OpTypeOpaque",
    32: "OpTypePointer", 33: "OpTypeFunction", 39: "OpConstantTrue", 40: "OpConstantFalse",
    41: "OpConstant", 42: "OpConstantComposite", 43: "OpConstantSampler", 44: "OpConstantNull",
    46: "OpSpecConstantOp", 48: "OpSpecConstantTrue", 49: "OpSpecConstantFalse",
    50: "OpSpecConstant", 51: "OpSpecConstantComposite", 54: "OpFunction",
    55: "OpFunctionParameter", 56: "OpFunctionEnd", 57: "OpFunctionCall", 61: "OpVariable",
    62: "OpLoad", 63: "OpStore", 65: "OpAccessChain", 66: "OpInBoundsAccessChain",
    67: "OpPtrAccessChain", 68: "OpArrayLength", 71: "OpDecorate", 72: "OpMemberDecorate",
    73: "OpDecorationGroup", 74: "OpGroupDecorate", 79: "OpCompositeConstruct",
    80: "OpCompositeExtract", 81: "OpCompositeInsert", 82: "OpCopyObject",
    83: "OpTranspose", 84: "OpImageSampleImplicitLod", 85: "OpImageSampleExplicitLod",
    86: "OpImageSampleDrefImplicitLod", 88: "OpImageSampleProjImplicitLod",
    95: "OpImageFetch", 96: "OpImageGather", 99: "OpBitcast", 100: "OpSNegate",
    101: "OpFNegate", 104: "OpIAdd", 105: "OpFAdd", 106: "OpISub", 107: "OpFSub",
    108: "OpIMul", 109: "OpFMul", 110: "OpUDiv", 111: "OpSDiv", 112: "OpFDiv",
    113: "OpUMod", 114: "OpSRem", 115: "OpSMod", 116: "OpFRem", 117: "OpFMod",
    118: "OpVectorTimesScalar", 119: "OpMatrixTimesScalar", 120: "OpVectorTimesMatrix",
    126: "OpLogicalOr", 127: "OpLogicalAnd", 128: "OpLogicalNot", 129: "OpSelect",
    130: "OpIEqual", 131: "OpINotEqual", 132: "OpUGreaterThan", 133: "OpSGreaterThan",
    134: "OpUGreaterThanEqual", 135: "OpSGreaterThanEqual", 136: "OpULessThan",
    137: "OpSLessThan", 138: "OpULessThanEqual", 139: "OpSLessThanEqual",
    140: "OpFOrdEqual", 141: "OpFUnordEqual", 142: "OpFOrdNotEqual", 143: "OpFUnordNotEqual",
    144: "OpFOrdLessThan", 145: "OpFUnordLessThan", 146: "OpFOrdGreaterThan",
    147: "OpFUnordGreaterThan", 148: "OpFOrdLessThanEqual", 149: "OpFUnordLessThanEqual",
    150: "OpFOrdGreaterThanEqual", 151: "OpFUnordGreaterThanEqual", 153: "OpShiftRightLogical",
    154: "OpShiftRightArithmetic", 155: "OpShiftLeftLogical", 156: "OpBitwiseOr",
    157: "OpBitwiseXor", 158: "OpBitwiseAnd", 159: "OpNot", 160: "OpBitFieldInsert",
    161: "OpBitFieldSExtract", 162: "OpBitFieldUExtract", 164: "OpBitReverse",
    165: "OpBitCount", 167: "OpDPdx", 168: "OpDPdy", 169: "OpFwidth",
    171: "OpAtomicLoad", 172: "OpAtomicStore", 174: "OpAtomicExchange",
    175: "OpAtomicCompareExchange", 176: "OpAtomicCompareExchangeWeak", 177: "OpAtomicIIncrement",
    178: "OpAtomicIDecrement", 179: "OpAtomicIAdd", 180: "OpAtomicISub", 181: "OpAtomicSMin",
    182: "OpAtomicUMin", 183: "OpAtomicSMax", 184: "OpAtomicUMax", 185: "OpAtomicAnd",
    186: "OpAtomicOr", 187: "OpAtomicXor", 195: "OpPhi", 196: "OpLoopMerge",
    197: "OpSelectionMerge", 198: "OpLabel", 199: "OpBranch", 200: "OpBranchConditional",
    201: "OpSwitch", 202: "OpKill", 203: "OpReturn", 204: "OpReturnValue",
    205: "OpUnreachable", 207: "OpGroupAll", 208: "OpGroupAny", 209: "OpGroupBroadcast",
    210: "OpGroupIAdd", 211: "OpGroupFAdd", 212: "OpGroupFMin", 213: "OpGroupUMin",
    214: "OpGroupSMin", 215: "OpGroupFMax", 216: "OpGroupUMax", 217: "OpGroupSMax",
    218: "OpImageRead", 219: "OpImageWrite", 220: "OpImage", 221: "OpImageQuerySizeLod",
    222: "OpImageQuerySize", 223: "OpImageQueryLod", 224: "OpImageQueryLevels",
    225: "OpImageQuerySamples", 228: "OpAtomicFlagTestAndSet", 229: "OpAtomicFlagClear",
    234: "OpCopyMemory", 235: "OpCopyMemorySized", 240: "OpControlBarrier",
    241: "OpMemoryBarrier", 245: "OpGroupNonUniformElect", 246: "OpGroupNonUniformAll",
    247: "OpGroupNonUniformAny", 248: "OpGroupNonUniformAllEqual",
    249: "OpGroupNonUniformBroadcast", 252: "OpGroupNonUniformBallot",
    259: "OpGroupNonUniformShuffle", 260: "OpGroupNonUniformShuffleXor",
    261: "OpGroupNonUniformShuffleUp", 262: "OpGroupNonUniformShuffleDown",
    263: "OpGroupNonUniformIAdd", 264: "OpGroupNonUniformFAdd",
    265: "OpGroupNonUniformIMul", 266: "OpGroupNonUniformFMul",
    267: "OpGroupNonUniformSMin", 268: "OpGroupNonUniformUMin",
    269: "OpGroupNonUniformFMin", 270: "OpGroupNonUniformSMax",
    271: "OpGroupNonUniformUMax", 272: "OpGroupNonUniformFMax",
    273: "OpGroupNonUniformBitwiseAnd", 274: "OpGroupNonUniformBitwiseOr",
    275: "OpGroupNonUniformBitwiseXor", 276: "OpGroupNonUniformLogicalAnd",
    277: "OpGroupNonUniformLogicalOr", 278: "OpGroupNonUniformLogicalXor",
    279: "OpGroupNonUniformQuadBroadcast", 280: "OpGroupNonUniformQuadSwap",
    317: "OpGroupNonUniformPartitionNV",
}

# GLSL.std.450 extended instruction numbers.
GLSL = {
    1: "Round", 2: "RoundEven", 3: "Trunc", 4: "FAbs", 5: "SAbs", 6: "FSign", 7: "SSign",
    8: "Floor", 9: "Ceil", 10: "Fract", 11: "Radians", 12: "Degrees", 13: "Sin", 14: "Cos",
    15: "Tan", 16: "Asin", 17: "Acos", 18: "Atan", 19: "Sinh", 20: "Cosh", 21: "Tanh",
    22: "Asinh", 23: "Acosh", 24: "Atanh", 25: "Atan2", 26: "Pow", 27: "Exp", 28: "Log",
    29: "Exp2", 30: "Log2", 31: "Sqrt", 32: "InverseSqrt", 33: "Determinant",
    34: "MatrixInverse", 35: "Modf", 37: "FMin", 38: "UMin", 39: "SMin", 40: "FMax",
    41: "UMax", 42: "SMax", 43: "FClamp", 44: "UClamp", 45: "SClamp", 46: "FMix",
    47: "IMix", 48: "Step", 49: "SmoothStep", 50: "Fma", 51: "Frexp", 53: "Ldexp",
    66: "Length", 67: "Distance", 68: "Cross", 69: "Normalize", 70: "FaceForward",
    71: "Reflect", 72: "Refract", 79: "NMin", 80: "NMax", 81: "NClamp",
}

BINOPS = {
    104: "+", 105: "+", 106: "-", 107: "-", 108: "*", 109: "*", 110: "/", 111: "/",
    112: "/", 113: "%", 114: "%", 115: "%", 116: "%", 117: "%", 118: "*", 119: "*",
    120: "*", 126: "||", 127: "&&", 128: "!", 130: "==", 131: "!=", 132: ">", 133: ">",
    134: ">=", 135: ">=", 136: "<", 137: "<", 138: "<=", 139: "<=", 140: "==",
    141: "==", 142: "!=", 143: "!=", 144: "<", 145: "<", 146: ">", 147: ">", 148: "<=",
    149: "<=", 150: ">=", 151: ">=", 153: ">>", 154: ">>", 155: "<<", 156: "|",
    157: "^", 158: "&", 159: "~", 167: "dFdx", 168: "dFdy", 169: "fwidth",
}

ATOMIC = {
    179: "atomicAdd", 180: "atomicSub", 174: "atomicExchange", 177: "atomicInc",
    178: "atomicDec", 181: "atomicSMin", 182: "atomicUMin", 183: "atomicSMax",
    184: "atomicUMax", 185: "atomicAnd", 186: "atomicOr", 187: "atomicXor",
    171: "atomicLoad", 172: "atomicStore",
}

GROUP = {
    207: "groupAll", 208: "groupAny", 209: "groupBroadcast", 210: "groupIAdd",
    211: "groupFAdd", 212: "groupFMin", 213: "groupUMin", 214: "groupSMin",
    215: "groupFMax", 216: "groupUMax", 217: "groupSMax",
}

SUBSCRIPT = {"-", "+", "*", "/"}


def read_str(words, start):
    out = bytearray()
    i = start
    while i < len(words):
        w = words[i]
        i += 1
        for s in (0, 8, 16, 24):
            b = (w >> s) & 0xFF
            if b == 0:
                return out.decode("utf-8", "replace"), i
            out.append(b)
        if len(out) > 8192:
            break
    return out.decode("utf-8", "replace"), i


class Module:
    def __init__(self, buf: bytes, offset: int = 0):
        self.words = struct.unpack_from(f"<{(len(buf) - offset) // 4}I", buf, offset)
        self.names: dict[int, str] = {}
        self.member_names: dict[tuple[int, int], str] = {}
        self.types: dict[int, dict] = {}
        self.consts: dict[int, dict] = {}
        self.ext_imports: dict[int, str] = {}
        self.decorations: dict[int, list] = defaultdict(list)
        self.functions: list[dict] = []
        self._scan()

    def _scan(self):
        ws = self.words
        i = 5
        cur = None
        while i < len(ws):
            wc = ws[i] >> 16
            op = ws[i] & 0xFFFF
            if wc == 0 or i + wc > len(ws):
                break
            o = ws[i + 1:i + wc]
            try:
                self._op(op, o, ws, i, cur)
                if op == 54 and len(o) > 1:
                    cur = {"id": o[1], "ret": o[0], "ops": []}
                    self.functions.append(cur)
                elif cur is not None:
                    cur["ops"].append((op, o, i))
                if op == 56:
                    cur = None
            except Exception:
                pass
            i += wc

    def _op(self, op, o, ws, i, cur):
        if op == 5 and o:
            self.names[o[0]] = read_str(ws, i + 2)[0]
        elif op == 6 and len(o) >= 2:
            self.member_names[(o[0], o[1])] = read_str(ws, i + 3)[0]
        elif op == 7 and o:
            self.ext_imports[o[0]] = read_str(ws, i + 2)[0]
        elif op == 21:
            self.types[o[0]] = {"k": "int", "w": o[1], "s": o[2]}
        elif op == 22:
            self.types[o[0]] = {"k": "float", "w": o[1]}
        elif op == 23:
            self.types[o[0]] = {"k": "vec", "c": o[1], "n": o[2]}
        elif op == 24:
            self.types[o[0]] = {"k": "mat", "c": o[1], "n": o[2]}
        elif op == 25:
            self.types[o[0]] = {"k": "image"}
        elif op == 27:
            self.types[o[0]] = {"k": "sampled_image"}
        elif op == 28:
            self.types[o[0]] = {"k": "array", "e": o[1], "l": o[2]}
        elif op == 29:
            self.types[o[0]] = {"k": "rarray", "e": o[1]}
        elif op == 30:
            self.types[o[0]] = {"k": "struct", "m": list(o[1:])}
        elif op == 32:
            self.types[o[0]] = {"k": "ptr", "store": o[1], "pointee": o[2]}
        elif op == 33:
            self.types[o[0]] = {"k": "func", "ret": o[1], "p": list(o[2:])}
        elif op == 19:
            self.types[o[0]] = {"k": "void"}
        elif op == 20:
            self.types[o[0]] = {"k": "bool"}
        elif op == 41 and len(o) >= 2:
            self.consts[o[1]] = {"t": o[0], "v": list(o[2:])}
        elif op in (39, 48) and len(o) >= 2:
            self.consts[o[1]] = {"t": o[0], "v": [1]}
        elif op in (40, 49) and len(o) >= 2:
            self.consts[o[1]] = {"t": o[0], "v": [0]}
        elif op == 42 and len(o) >= 2:
            self.consts[o[1]] = {"t": o[0], "v": list(o[2:]), "composite": True}
        elif op == 44 and len(o) >= 2:
            self.consts[o[1]] = {"t": o[0], "v": [], "composite": True}
        elif op == 71 and len(o) >= 2:
            self.decorations[o[0]].append((o[1], list(o[2:])))

    def type_str(self, tid, depth=0):
        t = self.types.get(tid)
        if not t:
            return f"%{tid}"
        k = t["k"]
        if k == "float":
            return f"f{t['w']}"
        if k == "int":
            return ("i" if t["s"] else "u") + str(t["w"])
        if k == "vec":
            return f"{self.type_str(t['c'], depth+1)}x{t['n']}"
        if k == "mat":
            return f"mat{t['n']}x{self.type_str(t['c'], depth+1)}"
        if k == "ptr":
            return f"*{self.type_str(t['pointee'], depth+1) if depth < 2 else '...'}"
        if k == "array":
            ln = self.consts.get(t["l"])
            return f"{self.type_str(t['e'], depth+1)}[{self.const_val(ln) if ln else '?'}]"
        if k == "rarray":
            return f"{self.type_str(t['e'], depth+1)}[]"
        if k == "struct":
            return self.names.get(tid, f"struct{tid}")
        return k

    def const_val(self, c):
        if not c:
            return "?"
        t = self.types.get(c["t"], {})
        v = c["v"]
        if c.get("composite"):
            return "{" + ", ".join(self.const_val(self.consts.get(x)) for x in v) + "}"
        if not v:
            return "zero"
        if t.get("k") == "float":
            if t["w"] == 32:
                return f"{struct.unpack('<f', struct.pack('<I', v[0]))[0]:.9g}f"
            if t["w"] == 64 and len(v) >= 2:
                return f"{struct.unpack('<d', struct.pack('<II', v[0], v[1]))[0]:.17g}"
        if t.get("k") == "int":
            x = v[0]
            if t.get("s") and t["w"] == 32 and x >= 0x80000000:
                x -= 0x100000000
            return str(x)
        if t.get("k") == "bool":
            return "true" if v[0] else "false"
        return " ".join(hex(x) for x in v)


def expr(m: Module, o: list[int], start: int, vals: dict[int, str]) -> str:
    """Render operand ids, substituting known value expressions."""
    out = []
    for x in o[start:]:
        out.append(vals.get(x, f"%{x}"))
    return ", ".join(out)


def render_function(m: Module, fn: dict, verbose: bool) -> list[str]:
    lines: list[str] = []
    vals: dict[int, str] = {}
    # Seed every literal constant first. Without this the listing is unreadable: every
    # constant renders as a bare %id, so an expression like `a * 0.5 + 1.0` shows up as
    # `(%23 * %41)` and the arithmetic cannot be recovered from the output at all.
    # Ids are unique across the module, so nothing is shadowed by doing this up front.
    for cid, c in m.consts.items():
        vals[cid] = m.const_val(c)
    fname = m.names.get(fn["id"], f"%{fn['id']}")
    lines.append(f"; ---- function {fname}  ({len(fn['ops'])} instructions)")

    for op, o, wi in fn["ops"]:
        name = OPS.get(op, f"Op{op}")
        try:
            if op == 198:  # OpLabel
                vals[o[0]] = f"L{o[0]}"
                lines.append(f"L{o[0]}:")
            elif op == 199:
                lines.append(f"    br {vals.get(o[0], '%' + str(o[0]))}")
            elif op == 200:
                lines.append(f"    br_if {vals.get(o[0], '%' + str(o[0]))} ? "
                             f"{vals.get(o[1], '%' + str(o[1]))} : {vals.get(o[2], '%' + str(o[2]))}")
            elif op == 196:
                lines.append(f"    loop_merge {vals.get(o[0], '%' + str(o[0]))}")
            elif op == 197:
                lines.append(f"    selection_merge {vals.get(o[0], '%' + str(o[0]))}")
            elif op == 201:
                lines.append(f"    switch {vals.get(o[0], '%' + str(o[0]))} default "
                             f"{vals.get(o[1], '%' + str(o[1]))}")
            elif op == 195:  # OpPhi
                t = m.type_str(o[0])
                pairs = []
                for k in range(2, len(o), 2):
                    pairs.append(f"{vals.get(o[k], '%' + str(o[k]))}<-{vals.get(o[k+1], '%' + str(o[k+1]))}")
                vals[o[1]] = f"phi({', '.join(pairs)})"
                lines.append(f"    %{o[1]} = phi[{t}] {vals[o[1]]}")
            elif op == 55:  # OpFunctionParameter
                vals[o[1]] = f"arg{o[1]}"
                lines.append(f"    arg{o[1]} : {m.type_str(o[0])}")
            elif op == 61:  # OpVariable
                t = m.types.get(o[0], {})
                st = {0: "Function", 1: "Global", 2: "Workgroup", 3: "CrossWorkgroup",
                      4: "Private", 5: "StorageBuffer"}.get(t.get("store"), "?")
                vals[o[1]] = f"{st.lower()}_{o[1]}"
                lines.append(f"    var {vals[o[1]]} : {m.type_str(o[0])}")
            elif op == 62:  # OpLoad
                vals[o[1]] = f"*{vals.get(o[2], '%' + str(o[2]))}"
                lines.append(f"    %{o[1]} = load {m.type_str(o[0])} {vals.get(o[2], '%' + str(o[2]))}")
            elif op == 63:  # OpStore
                lines.append(f"    store {vals.get(o[0], '%' + str(o[0]))} -> "
                             f"{vals.get(o[1], '%' + str(o[1]))}")
            elif op in (65, 66, 67):  # OpAccessChain
                base = vals.get(o[2], f"%{o[2]}")
                idx = ", ".join(vals.get(x, f"%{x}") for x in o[3:])
                vals[o[1]] = f"{base}[{idx}]"
                lines.append(f"    %{o[1]} = &{vals[o[1]]}  ; {m.type_str(o[0])}")
            elif op == 57:  # OpFunctionCall
                callee = m.names.get(o[2], f"%{o[2]}")
                args = ", ".join(vals.get(x, f"%{x}") for x in o[3:])
                vals[o[1]] = f"{callee}({args})"
                if callee == "handler::fill" or "fill" in callee:
                    lines.append(f"    fill({args})")
                else:
                    lines.append(f"    %{o[1]} = call {callee}({args})")
            elif op == 12:  # OpExtInst
                setid = m.ext_imports.get(o[1], "?")
                num = o[2]
                is_glsl = "GLSL" in str(setid)
                instr = GLSL.get(num, f"ext{num}") if is_glsl else f"{setid}.{num}"
                args = ", ".join(vals.get(x, f"%{x}") for x in o[3:])
                vals[o[1]] = f"{instr}({args})"
                lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op in BINOPS and len(o) >= 3:
                a = vals.get(o[2], f"%{o[2]}")
                if op == 128:  # OpLogicalNot / OpSNegate / OpFNegate
                    vals[o[1]] = f"(!{a})"
                    lines.append(f"    %{o[1]} = {vals[o[1]]}")
                elif op in (104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115,
                            116, 117, 118, 119, 120, 126, 127, 153, 154, 155, 156, 157, 158):
                    b = vals.get(o[3], f"%{o[3]}")
                    sym = BINOPS[op]
                    if sym in SUBSCRIPT:
                        vals[o[1]] = f"({a} {sym} {b})"
                    else:
                        vals[o[1]] = f"{sym}({a}, {b})"
                    lines.append(f"    %{o[1]} = {vals[o[1]]}")
                else:
                    b = vals.get(o[3], f"%{o[3]}")
                    vals[o[1]] = f"{BINOPS[op]}({a}, {b})"
                    lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op in (100, 101):  # OpSNegate / OpFNegate
                a = vals.get(o[2], f"%{o[2]}")
                vals[o[1]] = f"(-{a})"
                lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op == 129:  # OpSelect
                c = vals.get(o[3], f"%{o[3]}")
                a = vals.get(o[4], f"%{o[4]}")
                b = vals.get(o[5], f"%{o[5]}")
                vals[o[1]] = f"({c} ? {a} : {b})"
                lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op == 99:
                a = vals.get(o[2], f"%{o[2]}")
                vals[o[1]] = f"bitcast({a})"
                lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op == 79:  # OpCompositeConstruct
                args = ", ".join(vals.get(x, f"%{x}") for x in o[2:])
                vals[o[1]] = f"{m.type_str(o[0])}({args})"
                lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op == 80:  # OpCompositeExtract
                base = vals.get(o[2], f"%{o[2]}")
                idx = "".join(f"[{x}]" for x in o[3:])
                vals[o[1]] = f"{base}{idx}"
                lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op == 82:
                vals[o[1]] = vals.get(o[2], f"%{o[2]}")
                lines.append(f"    %{o[1]} = copy {vals[o[1]]}")
            elif op in ATOMIC:
                args = ", ".join(vals.get(x, f"%{x}") for x in o[2:])
                vals[o[1]] = f"{ATOMIC[op]}({args})"
                lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op in GROUP:
                args = ", ".join(vals.get(x, f"%{x}") for x in o[3:])
                vals[o[1]] = f"{GROUP[op]}({args})"
                lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op in (263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275,
                        276, 277, 278):
                args = ", ".join(vals.get(x, f"%{x}") for x in o[4:])
                vals[o[1]] = f"{OPS[op]}({args})"
                lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op in (84, 85):  # OpImageSample*
                img = vals.get(o[2], f"%{o[2]}")
                coord = vals.get(o[3], f"%{o[3]}")
                vals[o[1]] = f"tex({img}, {coord})"
                lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op == 95:
                img = vals.get(o[2], f"%{o[2]}")
                coord = vals.get(o[3], f"%{o[3]}")
                vals[o[1]] = f"texelFetch({img}, {coord})"
                lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op == 218:
                img = vals.get(o[2], f"%{o[2]}")
                coord = vals.get(o[3], f"%{o[3]}")
                vals[o[1]] = f"imageRead({img}, {coord})"
                lines.append(f"    %{o[1]} = {vals[o[1]]}")
            elif op == 219:
                lines.append(f"    imageWrite({vals.get(o[0], '%' + str(o[0]))}, "
                             f"{vals.get(o[1], '%' + str(o[1]))}, {vals.get(o[2], '%' + str(o[2]))})")
            elif op == 203:
                lines.append("    return")
            elif op == 204:
                lines.append(f"    return {vals.get(o[0], '%' + str(o[0]))}")
            elif op == 202:
                lines.append("    kill")
            elif op == 205:
                lines.append("    unreachable")
            elif op == 240:
                lines.append("    barrier")
            elif op == 241:
                lines.append("    membarrier")
            elif op == 234:
                lines.append("    copyMemory")
            elif verbose:
                args = " ".join(str(x) for x in o)
                lines.append(f"    ; {name} {args}")
        except Exception as e:
            lines.append(f"    ; <render error {e} on {name}>")
    return lines


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("module")
    ap.add_argument("--list", action="store_true", help="list functions")
    ap.add_argument("--function", help="substring of a function name to disassemble")
    ap.add_argument("--all", action="store_true", help="disassemble every named function")
    ap.add_argument("--verbose", action="store_true", help="include unrendered ops")
    args = ap.parse_args()

    buf = pathlib.Path(args.module).read_bytes()
    base = buf.find(b"\x03\x02\x23\x07")
    if base < 0:
        print("no SPIR-V magic")
        return 1
    m = Module(buf, base)

    named = [(m.names.get(f["id"], f"%{f['id']}"), f) for f in m.functions]
    if args.list or not (args.function or args.all):
        print(f"{args.module}: {len(m.functions)} functions")
        for n, f in sorted(named):
            print(f"  {n}  ({len(f['ops'])} instr)")
        return 0

    sel = [(n, f) for n, f in named if args.all or (args.function and args.function.lower() in n.lower())]
    if not sel:
        print(f"no function matching {args.function!r}")
        return 1
    for n, f in sel:
        print("")
        for line in render_function(m, f, args.verbose):
            print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Extract embedded SPIR-V modules from a Windows PE and list their entry points.

WHY THIS MATTERS MORE THAN GHIDRA
Gaea's SYCL kernels are the only source of true algorithmic parity, and
docs/kernels-inventory.json records that the native libraries were never disassembled.
But `Gaea.oneAPI.dll` embeds SPIR-V, which is a *well-defined IR* with a public
specification — not opaque machine code. Extracting it yields the real kernel bodies
without a disassembler.

SPIR-V encoding used here (from the SPIR-V spec, section 2.3):
  word 0 : magic 0x07230203
  word 1 : version
  word 2 : generator
  word 3 : bound
  word 4 : schema (reserved, 0)
  then a stream of instructions; word 0 of each is
      (wordCount << 16) | opcode
  so the module can be walked exactly to its end.

OpEntryPoint is opcode 15, whose operands are:
      ExecutionModel, EntryPoint <id>, Name (literal string), Interface <ids...>

Usage: python tools/extract_spirv.py "<path to Gaea.oneAPI.dll>" [outdir]
"""
from __future__ import annotations

import pathlib
import struct
import sys
from collections import Counter

MAGIC = 0x07230203
MAGIC_LE = b"\x03\x02\x23\x07"
OP_ENTRY_POINT = 15
OP_NAME = 5
OP_STRING = 7
OP_SOURCE = 3
OP_SOURCE_EXTENSION = 4

EXECUTION_MODELS = {
    0: "Vertex", 1: "TessellationControl", 2: "TessellationEvaluation", 3: "Geometry",
    4: "Fragment", 5: "GLCompute", 6: "Kernel",
}


def read_string(words: list[int], start: int) -> tuple[str, int]:
    """Decode a SPIR-V literal string starting at word index `start`."""
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
        if len(out) > 4096:
            break
    return out.decode("utf-8", "replace"), i


def parse_module(buf: bytes, offset: int) -> dict | None:
    """Walk one SPIR-V module. Returns metadata, or None if it does not parse."""
    if len(buf) - offset < 20:
        return None
    words = struct.unpack_from("<5I", buf, offset)
    if words[0] != MAGIC:
        return None
    version, generator, bound, schema = words[1], words[2], words[3], words[4]
    if schema != 0:
        return None

    # Total size is not stored, so walk instructions until the stream is exhausted or
    # an instruction runs past the buffer. A mis-parse is caught by validating sizes.
    body = buf[offset + 20:]
    n_words = len(body) // 4
    ws = struct.unpack_from(f"<{n_words}I", body, 0)

    entry_points = []
    names = {}
    source_lang = None
    extensions = []
    i = 0
    used = 0
    while i < len(ws):
        w0 = ws[i]
        wc = w0 >> 16
        op = w0 & 0xFFFF
        if wc == 0 or i + wc > len(ws):
            break
        try:
            if op == OP_ENTRY_POINT:
                model = ws[i + 1]
                name, _ = read_string(ws, i + 3)
                entry_points.append((EXECUTION_MODELS.get(model, str(model)), name))
            elif op == OP_NAME:
                nm, _ = read_string(ws, i + 2)
                names[ws[i + 1]] = nm
            elif op == OP_SOURCE:
                source_lang = ws[i + 1]
            elif op == OP_SOURCE_EXTENSION:
                ext, _ = read_string(ws, i + 1)
                extensions.append(ext)
        except Exception:
            pass
        i += wc
        used = i

    return {
        "offset": offset,
        "version": version,
        "generator": generator,
        "bound": bound,
        "byte_length": used * 4 + 20,
        "word_count": used + 5,
        "entry_points": entry_points,
        "names": names,
        "source_language": source_lang,
        "extensions": extensions,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = pathlib.Path(sys.argv[1])
    if not path.is_file():
        print(f"not a file: {path}")
        return 2
    outdir = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path(".build/spirv")
    outdir.mkdir(parents=True, exist_ok=True)

    buf = path.read_bytes()
    print(f"file        : {path}")
    print(f"size        : {len(buf):,} bytes")

    offsets = []
    start = 0
    while True:
        idx = buf.find(MAGIC_LE, start)
        if idx < 0:
            break
        offsets.append(idx)
        start = idx + 1
    print(f"magic hits  : {len(offsets)}")

    modules = []
    for off in offsets:
        m = parse_module(buf, off)
        if m and m["entry_points"]:
            modules.append(m)

    if not modules:
        print("\nno parseable SPIR-V module with entry points found")
        return 1

    print(f"\nparsed      : {len(modules)} module(s) with entry points")
    print("=" * 74)
    for i, m in enumerate(modules):
        print(f"\n[{i}] offset {m['offset']:,}  length {m['byte_length']:,} B"
              f"  version {m['version']:#010x}  generator {m['generator']:#x}"
              f"  bound {m['bound']}")
        if m["extensions"]:
            print(f"    extensions: {', '.join(m['extensions'][:6])}")
        print(f"    entry points ({len(m['entry_points'])}):")
        for model, name in m["entry_points"]:
            print(f"      {model:<8} {name}")
        # Save the module so it can be opened by spirv-dis / spirv-cross later.
        end = m["offset"] + m["byte_length"]
        out = outdir / f"module{i:02d}.spv"
        out.write_bytes(buf[m["offset"]:end])
        print(f"    wrote {out}")

    # Aggregate: which kernel names exist at all?
    all_names = [name for m in modules for _, name in m["entry_points"]]
    print()
    print("=" * 74)
    print(f"DISTINCT ENTRY POINTS: {len(set(all_names))}")
    for n in sorted(set(all_names)):
        print(f"  {n}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Re-carve the embedded SPIR-V modules, stopping at the filler that follows each one.

THE PROBLEM THIS FIXES
The first extraction carved from one magic to the next. Every module then appeared to
contain an impossible opcode at word ~76,000-82,000, and since all thirteen failed on the
SAME opcode the cause was not random garbage: the word there is `0x17171717`, a repeated-byte
fill pattern. The real instruction stream ends before it, and the carve was swallowing the
padding.

Stopping when the walk meets an undefined opcode — rather than treating it as an error —
recovers exactly the module. `0x1717` is not a SPIR-V opcode, and the module's own
(wordCount << 16 | opcode) encoding makes the boundary unambiguous.

This matters because the kernels are only readable if the module is byte-exact: a trailing
region decoded as instructions produces plausible-looking nonsense.
"""
from __future__ import annotations

import argparse
import pathlib
import struct
import sys

MAGIC_LE = b"\x03\x02\x23\x07"

KNOWN_RANGES = [
    (3, 17), (19, 33), (39, 52), (54, 68), (71, 81), (82, 100),
    (100, 169), (171, 205), (207, 280),
]


def known(op: int) -> bool:
    return any(lo <= op <= hi for lo, hi in KNOWN_RANGES)


def carve(buf: bytes, offset: int) -> tuple[int, int, str]:
    """Return (word_count_including_header, instruction_count, stop_reason)."""
    n = (len(buf) - offset) // 4
    ws = struct.unpack_from(f"<{n}I", buf, offset)
    i = 5
    count = 0
    while i < len(ws):
        wc = ws[i] >> 16
        op = ws[i] & 0xFFFF
        if wc == 0:
            return i, count, "zero word count"
        if i + wc > len(ws):
            return i, count, "instruction runs past the buffer"
        if not known(op):
            return i, count, f"opcode {op} (0x{op:04x})"
        i += wc
        count += 1
    return i, count, "end of buffer"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dll")
    ap.add_argument("outdir")
    args = ap.parse_args()

    src = pathlib.Path(args.dll)
    out = pathlib.Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.spv"):
        old.unlink()

    buf = src.read_bytes()
    offsets = []
    start = 0
    while True:
        idx = buf.find(MAGIC_LE, start)
        if idx < 0:
            break
        offsets.append(idx)
        start = idx + 1

    print(f"{src.name}: {len(offsets)} magic occurrence(s)")
    kept = 0
    for k, off in enumerate(offsets):
        words, instr, why = carve(buf, off)
        if instr < 50:
            print(f"  [{k:>2}] offset {off:>10,}  skipped — only {instr} instruction(s) before {why}")
            continue
        end = off + words * 4
        dest = out / f"m{k:02d}.spv"
        dest.write_bytes(buf[off:end])
        kept += 1
        print(f"  [{k:>2}] offset {off:>10,}  {words:>8,} words  {instr:>6} instructions  "
              f"stopped at {why}  -> {dest.name}")

    print(f"\nkept {kept} module(s) in {out}")
    return 0 if kept else 1


if __name__ == "__main__":
    raise SystemExit(main())

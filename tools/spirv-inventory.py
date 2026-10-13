#!/usr/bin/env python3
"""Enumerate every kernel entry point across all SPIR-V modules of a Gaea backend.

This is the foundation for complete replication: Gaea's real kernel surface, read from the
shipped artifacts rather than inferred from node names.

DPC++ mangles the SYCL kernel name into the entry point, so the enclosing C++ namespace is
recoverable from the symbol. Names appear in two shapes:

  _ZTSN4sycl3_V16detail18RoundedRangeKernelI...EZN<ns><Class><method>EUlT_E_EE
      a SYCL range kernel; the interesting part is the lambda's enclosing function
  _ZTSZN<ns><Class><method>EUlT_E_
      the lambda itself

Both are reduced to `namespace::Class::method` so the output is a kernel inventory rather
than a wall of mangled text.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import shutil
import subprocess
from collections import Counter, defaultdict

MAGIC_LE = b"\x03\x02\x23\x07"
OP_ENTRY_POINT = 15
OP_SOURCE_EXTENSION = 4
CXXFILT = [r"D:\msys64\mingw64\bin\c++filt.exe", "c++filt"]


def find_filt() -> str | None:
    for c in CXXFILT:
        p = c if pathlib.Path(c).is_file() else shutil.which(c)
        if p:
            return p
    return None


def read_string(words: list[int], start: int) -> str:
    out = bytearray()
    i = start
    while i < len(words):
        w = words[i]
        i += 1
        for shift in (0, 8, 16, 24):
            b = (w >> shift) & 0xFF
            if b == 0:
                return out.decode("utf-8", "replace")
            out.append(b)
        if len(out) > 8192:
            break
    return out.decode("utf-8", "replace")


def entry_points(buf: bytes, offset: int) -> tuple[list[str], list[str]]:
    """Return (entry point names, source extensions) for one SPIR-V module."""
    import struct
    n = (len(buf) - offset) // 4
    ws = struct.unpack_from(f"<{n}I", buf, offset)
    names: list[str] = []
    exts: list[str] = []
    i = 5
    while i < len(ws):
        wc = ws[i] >> 16
        op = ws[i] & 0xFFFF
        if wc == 0 or i + wc > len(ws):
            break
        try:
            if op == OP_ENTRY_POINT:
                names.append(read_string(ws, i + 3))
            elif op == OP_SOURCE_EXTENSION:
                exts.append(read_string(ws, i + 1))
        except Exception:
            pass
        i += wc
    return names, exts


def simplify(demangled: str) -> str | None:
    """Reduce a demangled SYCL kernel name to namespace::Class::method."""
    s = demangled
    # Strip the SYCL plumbing around the user lambda.
    s = re.sub(r"^.*?sycl::_V1::detail::RoundedRangeKernel<[^>]*>,\s*\d+,\s*", "", s)
    for marker in ("::operator()", "::{lambda", "::{default", "::{unnamed"):
        if marker in s:
            s = s.split(marker)[0]
    s = s.replace("sycl::_V1::", "").replace("sycl::", "")
    s = re.sub(r"<.*$", "", s)
    s = s.strip(": \t")
    if not s or s.startswith("detail::"):
        return None
    # Require at least one namespace separator, else it is SYCL scaffolding.
    if "::" not in s:
        return None
    return s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("modules", help="directory of extracted .spv modules")
    ap.add_argument("--json", help="write the inventory here")
    args = ap.parse_args()

    root = pathlib.Path(args.modules)
    mods = sorted(root.glob("*.spv"))
    if not mods:
        print(f"no .spv files in {root}")
        return 1

    filt = find_filt()
    print(f"modules : {len(mods)} in {root}")
    print(f"demangler: {filt or 'NOT FOUND (raw names will be shown)'}")

    per_module: dict[str, dict] = {}
    all_simple: Counter = Counter()
    all_raw: dict[str, list[str]] = defaultdict(list)

    for m in mods:
        buf = m.read_bytes()
        raw_all: list[str] = []
        exts: list[str] = []
        start = 0
        idx = 0
        while True:
            o = buf.find(MAGIC_LE, start)
            if o < 0:
                break
            names, e = entry_points(buf, o)
            if names:
                raw_all.extend(names)
                exts.extend(e)
                idx += 1
            start = o + 1

        # Demangle in one batch.
        dm: dict[str, str] = {}
        if filt and raw_all:
            p = subprocess.run([filt, "--no-strip-underscore"],
                               input="\n".join(raw_all), capture_output=True, text=True,
                               errors="replace")
            out = [l for l in p.stdout.splitlines() if l.strip()]
            dm = dict(zip(raw_all, out)) if len(out) == len(raw_all) else {r: r for r in raw_all}
        else:
            dm = {r: r for r in raw_all}

        simple = Counter()
        for r in raw_all:
            s = simplify(dm.get(r, r))
            if s:
                simple[s] += 1
                all_simple[s] += 1
                all_raw[s].append(r)

        per_module[m.name] = {
            "modules_in_file": idx,
            "entry_points": len(raw_all),
            "kernels": sorted(simple),
            "extensions": sorted(set(exts)),
        }
        print(f"\n{m.name}: {idx} module(s), {len(raw_all)} entry points, "
              f"{len(simple)} distinct kernel owners")
        for k in sorted(simple):
            print(f"    {k}  (x{simple[k]})")

    print()
    print("=" * 74)
    print(f"TOTAL distinct kernel owners across all modules: {len(all_simple)}")
    for k, c in all_simple.most_common():
        print(f"  x{c:<3} {k}")

    if args.json:
        out = {
            "source": str(root),
            "modules": per_module,
            "distinct_kernels": {k: c for k, c in all_simple.most_common()},
            "raw_names": {k: v for k, v in all_raw.items()},
        }
        pathlib.Path(args.json).write_text(json.dumps(out, indent=2, ensure_ascii=False),
                                           encoding="utf-8")
        print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

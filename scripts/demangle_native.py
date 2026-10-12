#!/usr/bin/env python3
"""Harvest and demangle MSVC-mangled C++ symbols from Gaea native backends.

Uses dbghelp!UnDecorateSymbolName through ctypes (offline, no toolchain).
"""
import ctypes
import os
import re
import sys

WS = r"D:\sgames\gaea-rea"
ROOT = r"D:\Gaea 2"
OUT = os.path.join(WS, "evidence", "kernels", "symbols")

DLLS = [
    "Gaea.Native.dll",
    "Gaea.oneAPI.dll",
    "Gaea.AdaptiveCpp.dll",
    "Gaea.AdaptiveCpp.HIP.dll",
]

BUF = ctypes.create_string_buffer(8192)
_dbg = ctypes.WinDLL("dbghelp")

CAND = re.compile(rb"\?[A-Za-z0-9_$@?<>]{8,}")
ASCII = re.compile(rb"[\x20-\x7e]{8,}")


def demangle(name, flags=0):
    """name: str (ascii mangled). returns str or None."""
    n = _dbg.UnDecorateSymbolName(name.encode("ascii", "ignore"), BUF, 8192, flags)
    if not n:
        return None
    return BUF.value.decode("utf-8", "replace")


def main():
    os.makedirs(OUT, exist_ok=True)
    all_ns = {}
    for dll in DLLS:
        path = os.path.join(ROOT, dll)
        if not os.path.exists(path):
            print("MISSING", path)
            continue
        data = open(path, "rb").read()
        cands = set(m.group(0) for m in CAND.finditer(data))
        print("%-26s %9d bytes  %7d unique mangled" % (dll, len(data), len(cands)), flush=True)
        rows = []
        for c in sorted(cands):
            s = c.decode("ascii", "ignore")
            d = demangle(s, 0) or demangle(s, 0x1000)
            if d:
                rows.append("%s\t%s" % (s, re.sub(r"\s+", " ", d)))
        out = os.path.join(OUT, dll + ".demangled.tsv")
        with open(out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(rows))
        print("   demangled %d -> %s" % (len(rows), out), flush=True)

        # namespace/class census from raw ascii tokens
        nss = {}
        for m in re.finditer(rb"@([a-z][a-z0-9_]{2,})@@", data):
            k = m.group(1).decode()
            nss[k] = nss.get(k, 0) + 1
        all_ns[dll] = nss
    print()
    for dll, nss in all_ns.items():
        top = sorted(nss.items(), key=lambda kv: -kv[1])[:22]
        print("%s: %s" % (dll, ", ".join("%s(%d)" % kv for kv in top)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

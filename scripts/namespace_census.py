#!/usr/bin/env python3
"""Raw namespace-token census of the native backend DLLs (regex only, no demangling).

Counts occurrences of `@<lowercase_namespace>@@` in each shipped DLL, which is the
MSVC mangling of `namespace::`. Output: evidence/kernels/namespace-census.json
"""
import json
import os
import re
import sys

WS = r"D:\sgames\gaea-rea"
ROOT = r"D:\Gaea 2"
OUT = os.path.join(WS, "evidence", "kernels", "namespace-census.json")
DLLS = ["Gaea.Native.dll", "Gaea.oneAPI.dll", "Gaea.AdaptiveCpp.dll",
        "Gaea.AdaptiveCpp.HIP.dll"]
RX = re.compile(rb"@([A-Za-z][A-Za-z0-9_]{2,})@@")


def main():
    out = {}
    for dll in DLLS:
        p = os.path.join(ROOT, dll)
        if not os.path.exists(p):
            continue
        data = open(p, "rb").read()
        c = {}
        for m in RX.finditer(data):
            k = m.group(1).decode()
            c[k] = c.get(k, 0) + 1
        out[dll] = {"bytes": len(data),
                    "namespaces": dict(sorted(c.items(), key=lambda kv: -kv[1]))}
        print("%-26s %d namespaces" % (dll, len(c)))
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())

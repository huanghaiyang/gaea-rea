#!/usr/bin/env python3
"""Re-derive field order for every collected type from the raw GaeaDump dumps.

The aggregated metadata.json merges repeated sections with a set, which loses
declaration order. This script takes the FIRST occurrence of each type in the
per-assembly raw dump, which is the unmerged metadata order.

Output: evidence/kernels/fields-ordered.json
"""
import json
import os
import re
import sys

WS = r"D:\sgames\gaea-rea"
RAW = os.path.join(WS, "evidence", "kernels", "raw")
OUT = os.path.join(WS, "evidence", "kernels", "fields-ordered.json")
HDR = re.compile(r"^=== (.+?) \(([A-Za-z]+)\) ===$")

ASMS = ["Gaea.CE.dll", "Gaea.CS.dll", "Gaea.CW.dll", "Gaea.TS.dll", "Gaea.Engine.dll"]


def main():
    out = {}
    for asm in ASMS:
        path = os.path.join(RAW, asm + ".members.txt")
        recs, cur = {}, None
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                m = HDR.match(line.strip())
                if m:
                    cur = m.group(1)
                    if cur not in recs:
                        recs[cur] = {"kind": m.group(2), "fields": [], "methods": [],
                                     "props": []}
                    else:
                        cur = None  # already captured first (ordered) occurrence
                    continue
                if cur is None:
                    continue
                s = line.strip()
                if s.startswith("field "):
                    recs[cur]["fields"].append(s[6:].strip())
                elif s.startswith("method "):
                    recs[cur]["methods"].append(s[7:].strip())
                elif s.startswith("prop "):
                    recs[cur]["props"].append(s[5:].strip())
        out[asm] = recs
        print("%-18s types=%d" % (asm, len(recs)))
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)
    print("wrote", OUT)

    # sanity: show ordered fields of two key structs
    chk = [("Gaea.Engine.dll", "QuadSpinner.Gaea.Engine.SyclFunctions.Cellular3D.Parameters"),
           ("Gaea.Engine.dll", "QuadSpinner.Gaea.Engine.SyclFunctions.ParallelErosion.Parameters"),
           ("Gaea.Engine.dll", "QuadSpinner.Gaea.Engine.SyclFunctions.MeshRasterizer.Parameters"),
           ("Gaea.Engine.dll", "QuadSpinner.Gaea.Engine.SyclFunctions.ThermalShaper.Parameters"),
           ("Gaea.CE.dll", "QuadSpinner.ErosionWrapper")]
    rep = []
    for asm, t in chk:
        f = out[asm][t]["fields"]
        rep.append("%s :: %s (%d)" % (asm, t.split(".")[-1], len(f)))
        for i, x in enumerate(f):
            rep.append("   %2d %s" % (i + 1, "".join(c if ord(c) < 0xE000 else "[U+%04X]" % ord(c) for c in x)))
    with open(os.path.join(WS, "evidence", "kernels", "_ordered_fields.txt"), "w",
              encoding="utf-8") as fh:
        fh.write("\n".join(rep))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Readable console view of evidence/kernels/native-symbols.json."""
import json
import os
import sys

WS = r"D:\sgames\gaea-rea"
P = os.path.join(WS, "evidence", "kernels", "native-symbols.json")
KERNELS = {
    "parallel_erosion", "parallel_erosion2", "thermal", "thermal_shaper",
    "color_transport", "flow", "median_filter", "mesh_rasterizer",
    "resampling", "lighting", "lighting_x", "stamp_instancer", "texture3d",
    "lake", "ispc_lighting", "interopmesh", "mesh_port", "spline", "arrakis",
}


def main():
    want = sys.argv[1:] or None
    data = json.load(open(P, encoding="utf-8"))
    for dll, blob in data["dlls"].items():
        if want and not any(w in dll for w in want):
            continue
        print("################", dll)
        print("namespaces:", ", ".join("%s(%d)" % kv for kv in blob["namespaces"].items()))
        for name, e in blob["methods"].items():
            if e["namespace"] not in KERNELS:
                continue
            print("  %s::%s" % (e["class"] or e["namespace"], e["method"]))
            print("     bufs=%s dims=%s items=%s vecs=%s" % (
                e["bufferElementTypes"], e["bufferDims"], e["syclItems"], e["vectorTypes"]))
            for o in e["overloads"]:
                if len(o["params"]) > 12:
                    print("     (%d params) %s" % (len(o["params"]), ", ".join(o["params"][:12]) + " ..."))
                else:
                    print("     (%d params) %s" % (len(o["params"]), ", ".join(o["params"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())

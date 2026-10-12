#!/usr/bin/env python3
"""Decode the private-use-area (obfuscated) parameter-struct field names.

Method (every step is observed data, no guesswork):
  1. Field order + types come from evidence/kernels/fields-ordered.json, which
     preserves the first (declaration) occurrence in the GaeaDump raw dump.
  2. evidence/decompiled/Gaea.Nodes.whole.cs is scanned for object initializers
     `new <Kernel>.Parameters { ... }` and for `<var>.<field> = <expr>`
     assignments, keyed by the exact same PUA strings.
  3. Join by exact string. A field's node-facing meaning is the union of the
     expressions that nodes assign to it; different nodes may use the same
     kernel field for different quantities, so usages are recorded per node.

Output: evidence/kernels/obfuscated-field-decoding.json
"""
import json
import os
import re
import sys

WS = r"D:\sgames\gaea-rea"
EV = os.path.join(WS, "evidence", "kernels")
ORDERED = os.path.join(EV, "fields-ordered.json")
SRC = os.path.join(WS, "evidence", "decompiled", "Gaea.Nodes.whole.cs")
OUT = os.path.join(EV, "obfuscated-field-decoding.json")

PUA = re.compile(r"[\ue000-\uf8ff]")
ESC = re.compile(r"\\u([0-9a-fA-F]{4})")


def unesc(s):
    """The decompiled source stores invalid identifier characters as literal
    \\uXXXX escape text; convert back to the real code points so tokens can be
    joined against metadata names."""
    return ESC.sub(lambda m: chr(int(m.group(1), 16)), s)


TARGETS = ["ParallelErosion", "Cellular3D", "MeshRasterizer", "ThermalShaper",
           "MedianFilter", "Flow", "ColorTransport", "Debris", "NativeLighting", "Thermal2"]
NEWPARAM = re.compile(r"new\s+(?:[A-Za-z0-9_.]*\.)?(" + "|".join(TARGETS) + r")\.Parameters")
ASSIGN = re.compile(r"^\s*(\S+?)\s*=\s*(.+?),?\s*$")
CLASS = re.compile(r"^\t*(?:(?:public|internal|private|sealed|abstract|static|partial)\s+)*"
                   r"(?:class|struct)\s+([A-Za-z0-9_]+)")


def split_field(raw):
    m = re.match(r"^(?P<t>[^\s]+(?:<[^>]*>)?(?:\[\]|\*|&)?)\s*(?P<n>.*)$", raw.strip())
    if not m:
        return raw.strip(), ""
    t, n = m.group("t"), m.group("n").strip()
    if t.count("<") != t.count(">"):
        return raw.strip(), ""
    return t, n


def main():
    ordered = json.load(open(ORDERED, encoding="utf-8"))
    eng = ordered["Gaea.Engine.dll"]

    structs = {}
    for tfn, rec in eng.items():
        if not tfn.startswith("QuadSpinner.Gaea.Engine.SyclFunctions."):
            continue
        short = tfn.split("SyclFunctions.")[1]
        if not short.endswith(".Parameters"):
            continue
        kernel = short.split(".")[0]
        fields = []
        for i, raw in enumerate(rec["fields"]):
            t, n = split_field(raw)
            fields.append({"ordinal": i + 1, "type": t, "rawName": n,
                           "obfuscated": bool(PUA.search(n))})
        structs[kernel] = {"typeFullName": tfn, "fields": fields}

    lines = open(SRC, encoding="utf-8", errors="replace").read().splitlines()
    decls = [(i, len(l) - len(l.lstrip("\t")), CLASS.match(l).group(1))
             for i, l in enumerate(lines) if CLASS.match(l)]

    def owner_of(i, myind):
        for (j, ind, name) in reversed(decls):
            if j < i and ind < myind:
                return name
        return None

    usages = {}
    inits = []
    for i, line in enumerate(lines):
        m = NEWPARAM.search(line)
        if not m:
            continue
        kernel = m.group(1)
        owner = owner_of(i, len(line) - len(line.lstrip("\t")))
        n = 0
        depth = 0
        started = False
        for k in range(i, min(i + 80, len(lines))):
            b = lines[k]
            if not started:
                if "{" not in b:
                    continue
                started = True
            depth += b.count("{") - b.count("}")
            am = ASSIGN.match(b.strip())
            if am:
                name, expr = unesc(am.group(1)), am.group(2).rstrip(",")
                if PUA.search(name):
                    usages.setdefault((kernel, name), []).append(
                        {"owner": owner, "line": k + 1, "expr": expr[:160]})
                    n += 1
            if started and depth <= 0:
                break
        inits.append({"kernel": kernel, "owner": owner, "line": i + 1,
                      "fieldsAssigned": n})

    # dotted assignments: <var>.<obfuscatedField> = value
    for i, line in enumerate(lines):
        am = ASSIGN.match(line.strip())
        if not am or "." not in am.group(1):
            continue
        runs = re.findall(r"[\ue000-\uf8ff]+", unesc(am.group(1)))
        if not runs:
            continue
        field = runs[-1]
        for kernel, st in structs.items():
            if any(f["rawName"] == field for f in st["fields"]):
                usages.setdefault((kernel, field), []).append(
                    {"owner": owner_of(i, len(line) - len(line.lstrip("\t"))),
                     "line": i + 1, "expr": am.group(2).rstrip(",")[:160],
                     "lhs": am.group(1)})
                break

    out = {"schema": "gaea-obfuscated-field-decoding/1",
           "method": "metadata field order (fields-ordered.json) joined by exact PUA "
                     "string to decompiled node initializer assignments",
           "structs": {}, "initializers": inits}
    for kernel, st in structs.items():
        rows = []
        for f in st["fields"]:
            u = usages.get((kernel, f["rawName"]), [])
            rows.append({
                "ordinal": f["ordinal"],
                "type": f["type"],
                "obfuscatedName": ("".join("U+%04X" % ord(c) for c in f["rawName"])
                                   if f["obfuscated"] else None),
                "name": None if f["obfuscated"] else f["rawName"],
                "usages": u,
                "observedSemantics": sorted(set(x["expr"] for x in u))[:6],
            })
        out["structs"][kernel] = {"typeFullName": st["typeFullName"], "fields": rows}

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)

    report = []
    for kernel, st in out["structs"].items():
        pua_n = sum(1 for f in st["fields"] if f["obfuscatedName"])
        used = sum(1 for f in st["fields"] if f["usages"])
        report.append("%-18s fields=%-3d obfuscated=%-3d withObservedNodeUsage=%d"
                      % (kernel, len(st["fields"]), pua_n, used))
        for f in st["fields"]:
            label = f["name"] if f["name"] else "<obfuscated>"
            if f["obfuscatedName"]:
                report.append("    #%-3d %-11s %-26s -> %s" % (
                    f["ordinal"], f["type"], f["obfuscatedName"],
                    "; ".join(f["observedSemantics"]) or "<no observed usage>"))
    with open(os.path.join(EV, "_decoding_report.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(report))
    print("wrote", OUT, "| initializers:", len(inits))
    print("\n".join(report[:6]))
    return 0


if __name__ == "__main__":
    sys.exit(main())


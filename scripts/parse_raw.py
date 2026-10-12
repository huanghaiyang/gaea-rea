#!/usr/bin/env python3
"""Parse GaeaDump raw member dumps into structured records.

Usage:
  python parse_raw.py show <asm> [substring...]
  python parse_raw.py json <out.json>
"""
import json
import os
import re
import sys

WS = r"D:\sgames\gaea-rea"
RAW = os.path.join(WS, "evidence", "kernels", "raw")
HDR = re.compile(r"^=== (.+?) \(([A-Za-z]+)\) ===$")


def parse_file(path):
    out = {}
    cur = None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            m = HDR.match(line.strip())
            if m:
                cur = (m.group(1), m.group(2))
                out.setdefault(cur, {"fields": [], "methods": [], "props": []})
                continue
            if cur is None:
                continue
            s = line.strip()
            if s.startswith("field "):
                out[cur]["fields"].append(s[6:].strip())
            elif s.startswith("method "):
                out[cur]["methods"].append(s[7:].strip())
            elif s.startswith("prop "):
                out[cur]["props"].append(s[5:].strip())
    return out


def load_all():
    data = {}
    for fn in sorted(os.listdir(RAW)):
        if not fn.endswith(".members.txt"):
            continue
        asm = fn[: -len(".members.txt")]
        data[asm] = parse_file(os.path.join(RAW, fn))
    return data


def parse_types(path):
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            parts = line.split("\t")
            if len(parts) < 2 or "kind=" not in line:
                continue
            row = {"name": parts[0].strip()}
            for p in parts[1:]:
                if "=" in p:
                    k, v = p.split("=", 1)
                    row[k.strip()] = v.strip()
            rows.append(row)
    return rows


def main():
    cmd = sys.argv[1]
    if cmd == "show":
        asm = sys.argv[2]
        subs = sys.argv[3:]
        data = load_all()
        for (name, kind), rec in sorted(data.get(asm, {}).items()):
            if subs and not any(s in name for s in subs):
                continue
            print("== %s (%s)" % (name, kind))
            for f in rec["fields"]:
                print("   F %s" % f)
            for p in rec["props"]:
                print("   P %s" % p)
            for m in rec["methods"]:
                print("   M %s" % m)
    elif cmd == "json":
        data = load_all()
        ser = {}
        for asm, recs in data.items():
            ser[asm] = [
                {
                    "typeFullName": k[0],
                    "kind": k[1],
                    "fields": v["fields"],
                    "methods": v["methods"],
                    "props": v["props"],
                }
                for k, v in sorted(recs.items())
            ]
        with open(sys.argv[2], "w", encoding="utf-8") as fh:
            json.dump(ser, fh, indent=1, sort_keys=True)
        print("wrote", sys.argv[2], sum(len(v) for v in ser.values()), "types")
    return 0


if __name__ == "__main__":
    sys.exit(main())

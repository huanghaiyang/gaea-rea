#!/usr/bin/env python3
"""Batch-collect managed metadata for Gaea 2 kernel surfaces via GaeaDump.exe.

Writes raw text evidence to evidence/kernels/raw/ and a machine-readable
JSON snapshot to evidence/kernels/metadata.json. Read-only w.r.t. targets.
"""
import json
import os
import re
import subprocess
import sys
import time

WS = r"D:\sgames\gaea-rea"
EXE = os.path.join(WS, "tools", "GaeaDump", "bin", "Release", "net8.0", "GaeaDump.exe")
OUT_RAW = os.path.join(WS, "evidence", "kernels", "raw")
OUT_JSON = os.path.join(WS, "evidence", "kernels", "metadata.json")

ASSEMBLIES = [
    ("Gaea.CE.dll", r"D:\Gaea 2\Gaea.CE.dll"),
    ("Gaea.CS.dll", r"D:\Gaea 2\Gaea.CS.dll"),
    ("Gaea.CW.dll", r"D:\Gaea 2\Gaea.CW.dll"),
    ("Gaea.TS.dll", r"D:\Gaea 2\Gaea.TS.dll"),
    ("Gaea.Engine.dll", r"D:\Gaea 2\Gaea.Engine.dll"),
]

HDR = re.compile(r"^=== (?P<name>.+?) \((?P<kind>[A-Za-z]+)\) ===$")


def run(args, retries=6):
    for attempt in range(retries):
        try:
            p = subprocess.run(
                [EXE] + args,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=300,
            )
            return p.stdout + "\n" + p.stderr
        except OSError as exc:
            if attempt == retries - 1:
                raise
            time.sleep(2)
    return ""


def safe(name):
    return re.sub(r"[^A-Za-z0-9_.+-]", "_", name)


def parse_memb(text):
    """Parse 'memb' output into {typeName: {kind, fields[], methods[], props[]}}."""
    out = {}
    cur = None
    for line in text.splitlines():
        m = HDR.match(line.strip())
        if m:
            cur = m.group("name")
            out[cur] = {
                "typeFullName": cur,
                "kind": m.group("kind"),
                "fields": [],
                "methods": [],
                "props": [],
            }
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


def parse_types(text):
    """Parse 'types' output lines: name\tkind=..\tmethods=..\tfields=.."""
    rows = []
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 2 or "kind=" not in line:
            continue
        row = {"typeFullName": parts[0].strip()}
        for p in parts[1:]:
            if "=" in p:
                k, v = p.split("=", 1)
                row[k.strip()] = v.strip()
        rows.append(row)
    return rows


def main():
    os.makedirs(OUT_RAW, exist_ok=True)
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    result = {"tool": EXE, "assemblies": {}}

    for short, path in ASSEMBLIES:
        if not os.path.exists(path):
            result["assemblies"][short] = {"error": "missing", "path": path}
            continue
        print("=== %s ===" % short, flush=True)
        lsns = run(["lsns", path])
        types_raw = run(["types", path])
        with open(os.path.join(OUT_RAW, short + ".lsns.txt"), "w", encoding="utf-8") as f:
            f.write(lsns)
        with open(os.path.join(OUT_RAW, short + ".types.txt"), "w", encoding="utf-8") as f:
            f.write(types_raw)

        tlist = parse_types(types_raw)
        print("  types: %d" % len(tlist), flush=True)

        # Filters: one per declared type, plus a broad namespace sweep.
        filters = []
        for r in tlist:
            filters.append(r["typeFullName"])
        seen = set()
        members = {}
        agg_path = os.path.join(OUT_RAW, short + ".members.txt")
        with open(agg_path, "w", encoding="utf-8") as agg:
            for i, filt in enumerate(filters):
                if filt in seen:
                    continue
                seen.add(filt)
                txt = run(["memb", path, filt])
                agg.write("#### FILTER: %s\n" % filt)
                agg.write(txt)
                agg.write("\n")
                for name, rec in parse_memb(txt).items():
                    if name in members:
                        # merge (should be identical)
                        members[name]["fields"] = sorted(
                            set(members[name]["fields"]) | set(rec["fields"])
                        )
                        members[name]["methods"] = sorted(
                            set(members[name]["methods"]) | set(rec["methods"])
                        )
                    else:
                        members[name] = rec
                if (i + 1) % 10 == 0:
                    print("  memb %d/%d, collected %d" % (i + 1, len(filters), len(members)), flush=True)

        result["assemblies"][short] = {
            "path": path,
            "namespaces": [
                {"ns": ln.split()[1], "count": int(ln.split()[0])}
                for ln in lsns.splitlines()
                if len(ln.split()) == 2 and ln.split()[0].isdigit()
            ],
            "declaredTypes": tlist,
            "members": members,
        }
        print("  collected member records: %d" % len(members), flush=True)

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1, sort_keys=True)
    print("WROTE", OUT_JSON, flush=True)


if __name__ == "__main__":
    sys.exit(main())

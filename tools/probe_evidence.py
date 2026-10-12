#!/usr/bin/env python3
"""Probe a REA Evidence JSON file and print a structural summary.

Usage: python probe_evidence.py <evidence.json> [top_n]

Prints top-level keys, artifact identity, and the shape of normalized_result
without dumping the whole payload.
"""
import json
import sys
from collections import Counter


def shape(obj, depth=0, max_depth=3, prefix=""):
    """Yield (path, type, detail) lines describing a nested structure."""
    pad = "  " * depth
    if depth > max_depth:
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            t = type(v).__name__
            extra = ""
            if isinstance(v, list):
                extra = f" len={len(v)}"
            elif isinstance(v, str):
                extra = f" len={len(v)}"
            yield f"{pad}{prefix}{k}: {t}{extra}"
            if isinstance(v, (dict, list)) and depth < max_depth:
                yield from shape(v, depth + 1, max_depth, prefix="")
    elif isinstance(obj, list):
        if obj:
            yield f"{pad}[0] sample:"
            yield from shape(obj[0], depth + 1, max_depth)
        else:
            yield f"{pad}(empty list)"


def main():
    path = sys.argv[1]
    top_n = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    # REA writes UTF-16LE with a BOM on Windows; tolerate utf-8 too.
    with open(path, "rb") as raw:
        head = raw.read(4)
    encoding = "utf-16" if head[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8-sig"
    with open(path, "r", encoding=encoding) as fh:
        doc = json.load(fh)

    print("=" * 70)
    print("TOP-LEVEL KEYS")
    print("=" * 70)
    for k, v in doc.items():
        detail = ""
        if isinstance(v, (list, str)):
            detail = f" len={len(v)}"
        print(f"  {k}: {type(v).__name__}{detail}")

    # Evidence records are the useful part.
    for key in ("evidence", "records", "results", "items"):
        if key in doc:
            recs = doc[key]
            if isinstance(recs, list) and recs:
                print(f"\n{'=' * 70}\nRECORDS under '{key}': {len(recs)}\n{'=' * 70}")
                ops = Counter(r.get("operation", "?") for r in recs if isinstance(r, dict))
                for op, n in ops.most_common():
                    print(f"  {op}: {n}")
                if top_n:
                    print(f"\n--- nested shape of records[0] ---")
                    for line in shape(recs[0], max_depth=3):
                        print(line)
                break

    print(f"\n{'=' * 70}\nNESTED SHAPE OF DOCUMENT (depth<=3)\n{'=' * 70}")
    for line in list(shape(doc, max_depth=3))[:120]:
        print(line)


if __name__ == "__main__":
    main()

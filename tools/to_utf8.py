#!/usr/bin/env python3
"""Normalize text artifacts to UTF-8.

Windows PowerShell redirects native-command stdout as UTF-16LE, and the REA CLI
writes UTF-16LE JSON. Mixed encodings make files unreadable to text tools, so
this helper rewrites them as UTF-8 in place (or to a target path).

Usage:
    python to_utf8.py <path> [...]              # normalize files in place
    python to_utf8.py --check <path> [...]      # report encodings only
"""
from __future__ import annotations

import sys
from pathlib import Path

BOMS = (
    (b"\xff\xfe\x00\x00", "utf-32-le"),
    (b"\x00\x00\xfe\xff", "utf-32-be"),
    (b"\xff\xfe", "utf-16-le"),
    (b"\xfe\xff", "utf-16-be"),
    (b"\xef\xbb\xbf", "utf-8-sig"),
)


def detect_and_decode(raw: bytes) -> tuple[str, str]:
    """Return (text, encoding_name)."""
    for bom, enc in BOMS:
        if raw.startswith(bom):
            return raw.decode(enc), enc
    # Heuristic: many NULs at even offsets means UTF-16LE without a BOM.
    sample = raw[:4096]
    if sample:
        even_nuls = sample[0::2].count(0)
        odd_nuls = sample[1::2].count(0)
        if even_nuls > len(sample) // 8 and even_nuls > odd_nuls * 4:
            return raw.decode("utf-16-le", errors="replace"), "utf-16-le(no-bom)"
    return raw.decode("utf-8", errors="replace"), "utf-8"


def process(path: Path, check_only: bool) -> str:
    raw = path.read_bytes()
    try:
        text, enc = detect_and_decode(raw)
    except Exception as exc:  # pragma: no cover - defensive
        return f"{path}: DECODE ERROR {exc}"

    if enc == "utf-8" and not raw.startswith(b"\xef\xbb\xbf"):
        return f"{path}: already utf-8 ({len(raw)} bytes)"

    if check_only:
        return f"{path}: {enc}"

    path.write_text(text, encoding="utf-8", newline="")
    return f"{path}: {enc} -> utf-8 ({len(raw)} -> {len(text.encode('utf-8'))} bytes)"


def main() -> int:
    args = sys.argv[1:]
    check_only = False
    if args and args[0] == "--check":
        check_only = True
        args = args[1:]
    if not args:
        print(__doc__)
        return 2

    targets: list[Path] = []
    for a in args:
        p = Path(a)
        if p.is_dir():
            targets.extend(sorted(f for f in p.rglob("*") if f.is_file()))
        else:
            targets.append(p)

    rc = 0
    for t in targets:
        if not t.exists():
            print(f"{t}: NOT FOUND")
            rc = 1
            continue
        # Skip obvious binaries by extension.
        if t.suffix.lower() in {".dll", ".exe", ".pdb", ".png", ".jpg", ".ico", ".dat", ".unity3d", ".nupkg", ".zip"}:
            continue
        print(process(t, check_only))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())

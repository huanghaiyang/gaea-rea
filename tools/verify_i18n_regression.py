#!/usr/bin/env python3
"""Prove the i18n regression test fails on the original defect.

Temporarily reintroduces the dataset-based memo in web/js/i18n.js, runs the i18n
test, and restores the file. If the test does not fail while the bug is present,
the regression guard is worthless.

Usage:
    python tools/verify_i18n_regression.py
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
I18N = WS / "web" / "js" / "i18n.js"
TEST = WS / "web" / "tests" / "i18n-test.mjs"

# The first fixes: replace the WeakMap-based capture with the buggy dataset memo.
GOOD = """      const key = el.getAttribute(attr);
      const fallback = rememberOriginal(el, prop);"""

BUGGY = """      const key = el.getAttribute(attr);
      const memo = `i18nSrc${prop}`;
      if (el.dataset[memo] === undefined) {
        el.dataset[memo] = el[prop] ?? '';
      }
      const fallback = el.dataset[memo];"""


def run_test() -> tuple[int, str]:
    p = subprocess.run(
        ["node", str(TEST)],
        capture_output=True, text=True, cwd=str(WS), encoding="utf-8", errors="replace",
    )
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def main() -> int:
    src = I18N.read_text(encoding="utf-8")
    if GOOD not in src:
        print("could not locate the fixed capture block; aborting")
        return 2

    backup = src
    print("1. baseline (fixed code)")
    rc, out = run_test()
    m = re.search(r"PASS (\d+)\s+FAIL (\d+)", out)
    print(f"   exit={rc}  {m.group(0) if m else out.strip()[:120]}")
    if rc != 0:
        print("   baseline is already failing; cannot verify")
        return 1

    try:
        I18N.write_text(src.replace(GOOD, BUGGY, 1), encoding="utf-8")
        print("\n2. with the original dataset-based memo reintroduced")
        rc2, out2 = run_test()
        m2 = re.search(r"PASS (\d+)\s+FAIL (\d+)", out2)
        print(f"   exit={rc2}  {m2.group(0) if m2 else ''}")
        hit = "DOMStringMap" in out2
        print(f"   reports the DOMStringMap error: {hit}")
        if not hit:
            for line in out2.splitlines():
                if "i18nSrc" in line or "not a valid property" in line:
                    print(f"   {line.strip()}")
    finally:
        I18N.write_text(backup, encoding="utf-8")
        print("\n3. restored the fixed file")

    ok = rc == 0 and rc2 != 0 and hit
    print("\n" + ("VERIFIED: the test catches the original bug" if ok
                  else "NOT VERIFIED: the test does not catch the bug"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

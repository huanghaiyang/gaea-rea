#!/usr/bin/env python3
"""Make the DOM shim observable enough to test canvas coordinate plumbing.

Additions to web/tests/dom-shim.mjs:

1. The 2D context records transform calls, so a test can assert that a
   devicePixelRatio-sized backing store is paired with ctx.scale(dpr, dpr).
   Previously scale() was a no-op, which hid exactly that class of bug.
2. installDomShim() accepts a devicePixelRatio option, so DPR-dependent code can
   be exercised instead of only ever running at DPR 1.

Idempotent, and refuses to write when any pattern fails, so a partial edit can
never leave the shim inconsistent.
"""
from __future__ import annotations

from pathlib import Path

WS = Path(__file__).resolve().parent.parent
SHIM = WS / "web" / "tests" / "dom-shim.mjs"

# NOTE: dom-shim.mjs is indented with two spaces.
PATCHES: list[tuple[str, str]] = [
    (
        "  const noop = () => {};\n  return {\n    canvas,\n    imageSmoothingEnabled: true,",
        "  const noop = () => {};\n"
        "  // Transform calls are recorded rather than discarded: canvas code that sizes a\n"
        "  // backing store by devicePixelRatio must pair that with ctx.scale(dpr, dpr), and\n"
        "  // a no-op scale() would hide a missing or wrong one.\n"
        "  const transforms = [];\n"
        "  let scaleX = 1;\n"
        "  let scaleY = 1;\n"
        "  return {\n"
        "    canvas,\n"
        "    transforms,\n"
        "    get currentScale() { return [scaleX, scaleY]; },\n"
        "    imageSmoothingEnabled: true,",
    ),
    (
        "    save: noop, restore: noop, scale: noop, translate: noop, rotate: noop,",
        "    save: noop, restore: noop, rotate: noop,\n"
        "    scale(x, y) { scaleX *= x; scaleY *= y; transforms.push(['scale', x, y]); },\n"
        "    translate(x, y) { transforms.push(['translate', x, y]); },\n"
        "    setTransform(a, b, c, d, e, f) {\n"
        "      scaleX = a; scaleY = d;\n"
        "      transforms.push(['setTransform', a, b, c, d, e, f]);\n"
        "    },\n"
        "    resetTransform() { scaleX = 1; scaleY = 1; transforms.push(['resetTransform']); },",
    ),
    (
        "export function installDomShim({ url = 'http://127.0.0.1:8080/', catalog } = {}) {",
        "export function installDomShim({ url = 'http://127.0.0.1:8080/', catalog, "
        "devicePixelRatio = 1 } = {}) {",
    ),
    (
        "    document: doc,\n    devicePixelRatio: 1,",
        "    document: doc,\n"
        "    devicePixelRatio: Number(devicePixelRatio) > 0 ? Number(devicePixelRatio) : 1,",
    ),
]


def main() -> int:
    src = SHIM.read_text(encoding="utf-8")
    original = src
    failures: list[str] = []
    applied = skipped = 0

    for old, new in PATCHES:
        label = old.strip().splitlines()[0][:66]
        if new in src:
            print(f"already applied: {label}")
            skipped += 1
            continue
        n = src.count(old)
        if n != 1:
            failures.append(f"pattern count {n} for: {label}")
            continue
        src = src.replace(old, new, 1)
        print(f"patched: {label}")
        applied += 1

    if failures:
        print("\nFAILED (nothing written):")
        for f in failures:
            print(f"  {f}")
        return 1

    if src == original:
        print("\nno changes needed")
        return 0

    SHIM.write_text(src, encoding="utf-8")
    # Re-read to confirm the write actually landed.
    check = SHIM.read_text(encoding="utf-8")
    if check != src:
        print("\nERROR: file content does not match what was written")
        return 1
    print(f"\napplied {applied}, skipped {skipped}; verified write to {SHIM}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

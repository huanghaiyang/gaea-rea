#!/usr/bin/env python3
"""Static link validator for the zero-build web app.

The web implementation has no bundler, so a wrong module path or a missing asset
only fails at runtime in the browser. This resolves every reference statically:

  * <script src>, <link href>, <img src> in HTML files
  * `import ... from '<spec>'` and dynamic `import('<spec>')` in JS modules

Locale-independent and dependency-free.

Usage:
    python validate_web.py [webRoot]

Exit status 1 when any reference cannot be resolved.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HTML_REF = re.compile(r"""(?:src|href)\s*=\s*["']([^"']+)["']""")
JS_IMPORT = re.compile(
    r"""(?:^|[^\w.])(?:import\s+(?:[\w*{}\s,$]+\s+from\s+)?|import\s*\()\s*["']([^"']+)["']""",
    re.MULTILINE,
)

SKIP_PREFIXES = (
    "http://", "https://", "data:", "mailto:", "#", "//",
    # Node.js built-ins imported by the Node-side tooling (data builder, tests).
    "node:", "fs", "path", "url", "assert",
)


def check_ref(raw: str, base: Path, web_root: Path) -> tuple[str, str]:
    """Return (status, detail) for one reference string."""
    if raw.startswith(SKIP_PREFIXES):
        return "skip", "external"
    # Strip any query/fragment.
    target = raw.split("#", 1)[0].split("?", 1)[0]
    if not target:
        return "skip", "fragment"
    if target.startswith("/"):
        resolved = web_root / target.lstrip("/")
    else:
        resolved = (base / target).resolve()
    try:
        resolved.relative_to(web_root.resolve())
    except ValueError:
        return "fail", f"escapes web root: {raw}"
    return ("ok", str(resolved.relative_to(web_root))) if resolved.exists() else ("fail", f"missing: {raw}")


def main() -> int:
    web_root = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/sgames/gaea-rea/web").resolve()
    if not web_root.is_dir():
        print(f"not a directory: {web_root}")
        return 2

    html_files = sorted(web_root.rglob("*.html"))
    js_files = sorted(list(web_root.rglob("*.js")) + list(web_root.rglob("*.mjs")))
    css_files = sorted(web_root.rglob("*.css"))

    failures: list[str] = []
    checked = skipped = 0

    print(f"web root: {web_root}")
    print(f"html={len(html_files)} js={len(js_files)} css={len(css_files)}")
    print()

    for f in html_files:
        text = f.read_text(encoding="utf-8", errors="replace")
        rel = f.relative_to(web_root)
        for ref in HTML_REF.findall(text):
            status, detail = check_ref(ref, f.parent, web_root)
            if status == "skip":
                skipped += 1
            elif status == "fail":
                failures.append(f"{rel}: {detail}")
            else:
                checked += 1
                print(f"  OK   {rel} -> {detail}")

    for f in js_files:
        text = f.read_text(encoding="utf-8", errors="replace")
        rel = f.relative_to(web_root)
        for ref in JS_IMPORT.findall(text):
            status, detail = check_ref(ref, f.parent, web_root)
            if status == "skip":
                skipped += 1
            elif status == "fail":
                failures.append(f"{rel}: import {detail}")
            else:
                checked += 1

    # CSS url(...) references.
    url_re = re.compile(r"""url\(\s*["']?([^"')]+)["']?\s*\)""")
    for f in css_files:
        text = f.read_text(encoding="utf-8", errors="replace")
        rel = f.relative_to(web_root)
        for ref in url_re.findall(text):
            status, detail = check_ref(ref, f.parent, web_root)
            if status == "fail":
                failures.append(f"{rel}: css url {detail}")
            elif status == "ok":
                checked += 1

    print()
    print(f"references checked: {checked}, external/fragment skipped: {skipped}")
    if failures:
        print(f"\nFAILURES ({len(failures)}):")
        for x in failures:
            print(f"  {x}")
        return 1
    print("all references resolve")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

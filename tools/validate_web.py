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

import json
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

# Third-party code is committed verbatim and is not ours to rewrite; its bare
# specifiers are resolved by the import map in index.html. Scanning it for relative
# paths would only produce noise (a doc comment in OrbitControls mentions
# `three/addons/...`, which is not an import).
VENDOR_DIR = "vendor"

IMPORTMAP = re.compile(r"""<script\s+type=["']importmap["'][^>]*>(.*?)</script>""", re.S | re.I)


def strip_js_comments(text: str) -> str:
    """Remove // and /* */ comments so prose is never mistaken for a real import.

    A regex per comment kind would corrupt the source (stripping line comments first
    also eats `//` inside block comments), so this walks the string once.
    """
    out = []
    i = 0
    n = len(text)
    while i < n:
        two = text[i:i + 2]
        if two == "//":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if two == "/*":
            i += 2
            while i < n and text[i:i + 2] != "*/":
                i += 1
            i += 2
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def read_import_map(html_files: list[Path]) -> set[str]:
    """Bare specifiers declared by any import map on the page."""
    keys: set[str] = set()
    for f in html_files:
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for block in IMPORTMAP.findall(text):
            try:
                data = json.loads(block)
            except json.JSONDecodeError:
                continue
            for k in (data.get("imports") or {}):
                keys.add(k)
    return keys


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

    # Bare specifiers ("three") are resolved by an import map, so collect the declared
    # keys first: a bare import that no map declares would fail at runtime.
    import_map = read_import_map(html_files)

    print(f"web root: {web_root}")
    print(f"html={len(html_files)} js={len(js_files)} css={len(css_files)}")
    if import_map:
        print(f"import map keys: {', '.join(sorted(import_map))}")
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
        rel = f.relative_to(web_root)
        # Vendored third-party code keeps its own specifiers, resolved by the import
        # map; only the import-map coverage is checked below.
        if rel.parts and rel.parts[0] == VENDOR_DIR:
            continue
        text = strip_js_comments(f.read_text(encoding="utf-8", errors="replace"))
        for ref in JS_IMPORT.findall(text):
            # A bare specifier is resolved by the import map, not by a file path.
            if not ref.startswith((".", "/")) and not ref.startswith(SKIP_PREFIXES):
                bare = ref.split("/", 1)[0] if not ref.startswith("@") else "/".join(ref.split("/", 2)[:2])
                if ref in import_map or bare in import_map:
                    checked += 1
                else:
                    failures.append(
                        f"{rel}: bare specifier {ref!r} is not declared in the import map",
                    )
                continue
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

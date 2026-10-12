#!/usr/bin/env python3
"""Apply the remaining i18n display-layer patches to the web JS modules.

These are mechanical text substitutions: each one wraps a hard-coded English
label in t()/term()/desc() so it renders through the dictionary. Doing them here
keeps the change reviewable in one place and avoids hand-editing several files.

Usage:
    python tools/apply_i18n_patches.py [--check]
"""
from __future__ import annotations

import sys
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
WEB = WS / "web" / "js"

# (file, old, new) — old must appear exactly once per file.
PATCHES: list[tuple[str, str, str]] = [
    # ---- library panel
    (
        "library-panel.js",
        "head.textContent = `${group} · ${groups.get(group).length}`;",
        "head.textContent = `${term(group)} · ${groups.get(group).length}`;",
    ),
    (
        "library-panel.js",
        "this.count.textContent = `${shown}/${this.catalog.length} · ${implCount} impl`;",
        "this.count.textContent = `${shown}/${this.catalog.length} · ${implCount} ${t('unit.impl', 'impl')}`;",
    ),
    (
        "library-panel.js",
        "nm.textContent = cat.name;",
        "nm.textContent = term(cat.name);",
    ),
    (
        "library-panel.js",
        "el.title = `${cat.name}${impl ? '' : '  [catalog only]'}\\n${summary}\\n${paramCount} parameters`;",
        "el.title = `${term(cat.name)}${impl ? '' : `  [${t('library.catalogOnlyTag', 'catalog only')}]`}\\n${trDesc(summary)}\\n${paramCount} ${t('unit.params', 'parameters')}`;",
    ),
    # ---- info panel
    (
        "info-panel.js",
        "this.evalTable.innerHTML = '<tr><td>status</td><td>evaluating…</td></tr>';",
        "this.evalTable.innerHTML = `<tr><td>${t('info.status', 'status')}</td><td>${t('info.evaluating', 'evaluating…')}</td></tr>`;",
    ),
    (
        "info-panel.js",
        "this.timings.innerHTML = '<span class=\"muted small\">run an evaluation</span>';",
        "this.timings.innerHTML = `<span class=\"muted small\">${t('info.runEval', 'run an evaluation')}</span>`;",
    ),
    (
        "info-panel.js",
        "this.errors.textContent = 'no errors';",
        "this.errors.textContent = t('info.noErrors', 'no errors');",
    ),
    # ---- params panel: remaining readouts
    (
        "params-panel.js",
        "readout.textContent = opts.length + ' opt';",
        "readout.textContent = `${opts.length} ${t('unit.opt', 'opt')}`;",
    ),
]

# Modules that need the i18n import added.
IMPORTS = {
    "library-panel.js": (
        "import { t, term, desc as trDesc } from './i18n.js';",
        "import { nodeDescription } from './state.js';",
    ),
    "info-panel.js": (
        "import { t } from './i18n.js';",
        None,
    ),
}


def add_import(src: str, line: str, after: str | None) -> str:
    if line in src:
        return src
    if after and after in src:
        return src.replace(after, f"{after}\n{line}", 1)
    # Fall back to appending after the last import line.
    lines = src.splitlines()
    last = max((i for i, l in enumerate(lines) if l.startswith("import ")), default=-1)
    if last < 0:
        return src
    lines.insert(last + 1, line)
    return "\n".join(lines) + ("\n" if src.endswith("\n") else "")


def main() -> int:
    check = "--check" in sys.argv
    failures: list[str] = []
    applied = 0

    for fname, old, new in PATCHES:
        p = WEB / fname
        src = p.read_text(encoding="utf-8")
        count = src.count(old)
        if count == 0:
            failures.append(f"{fname}: pattern not found -> {old[:60]}")
            continue
        if count > 1:
            failures.append(f"{fname}: pattern appears {count}x -> {old[:60]}")
            continue
        if not check:
            p.write_text(src.replace(old, new, 1), encoding="utf-8")
        applied += 1

    for fname, spec in IMPORTS.items():
        line, after = spec
        p = WEB / fname
        src = p.read_text(encoding="utf-8")
        updated = add_import(src, line, after)
        if updated == src and line not in src:
            failures.append(f"{fname}: could not add import")
            continue
        if not check and updated != src:
            p.write_text(updated, encoding="utf-8")
        applied += 1

    print(f"{'checked' if check else 'applied'}: {applied} patches")
    if failures:
        print(f"\nPROBLEMS ({len(failures)}):")
        for f in failures:
            print(f"  {f}")
        return 1
    print("all patterns matched exactly once")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

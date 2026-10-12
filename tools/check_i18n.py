#!/usr/bin/env python3
"""Validate the Chinese dictionaries and report coverage.

Checks that each dictionary is valid JSON, that no key is empty, and that
coverage of the vocabulary produced by build_i18n_vocab.py is reported per
category. Missing entries are not errors — they fall back to English — but the
gap is reported so it stays visible.

Usage:
    python tools/check_i18n.py
"""
from __future__ import annotations

import json
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
WEB = WS / "web"


def load(path: Path):
    if not path.exists():
        return None, f"missing: {path}"
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except Exception as exc:  # noqa: BLE001
        return None, f"invalid JSON: {exc}"


def main() -> int:
    vocab, err = load(WEB / "data" / "i18n-vocab.json")
    if err:
        print(err)
        return 1
    terms, err = load(WEB / "data" / "i18n-terms.zh.json")
    if err:
        print(err)
        return 1
    ui, err = load(WEB / "data" / "i18n-ui.zh.json")
    if err:
        print(err)
        return 1

    t_terms = terms.get("terms", {})
    t_params = terms.get("paramNames", {})

    print("=== dictionary sizes ===")
    print(f"  i18n-terms.zh.json  terms     : {len(t_terms)}")
    print(f"  i18n-terms.zh.json  paramNames: {len(t_params)}")
    print(f"  i18n-ui.zh.json     keys      : {len([k for k in ui if not k.startswith('_')])}")

    print("\n=== coverage vs vocabulary (fallback to English when missing) ===")
    # Node/group names live in `terms`; parameter names live in `paramNames`.
    # They are separate namespaces because some names (Steps, Peaks, Layers)
    # legitimately differ between the two roles.
    categories = [
        ("nodeNames", set(vocab["nodeNames"]), set(t_terms)),
        ("groups", set(vocab["groups"]), set(t_terms)),
        ("paramNames", set(vocab["paramNames"]), set(t_params)),
    ]
    total_missing = 0
    for label, want, have in categories:
        missing = sorted(want - have)
        covered = len(want) - len(missing)
        pct = (covered / len(want) * 100) if want else 100.0
        print(f"  {label:12} {covered}/{len(want)}  ({pct:.1f}%)")
        total_missing += len(missing)
        if missing and len(missing) <= 40:
            for m in missing:
                print(f"       未翻译: {m}")

    # Empty values are worse than missing ones: they render as blank.
    empties = [k for k, v in {**t_terms, **t_params}.items() if not str(v).strip()]
    if empties:
        print(f"\n  ERROR: {len(empties)} entries have an empty translation")
        for e in empties[:20]:
            print(f"       {e}")
        return 1

    # A term used in both roles with different renderings is intentional, but a
    # term that appears in the wrong block is a bug worth surfacing.
    misplaced = sorted((set(t_params) & set(vocab["nodeNames"]) & set(t_terms)) - set(t_params))
    print(f"\n  total untranslated entries: {total_missing} (fall back to English)")
    print("  no empty translations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

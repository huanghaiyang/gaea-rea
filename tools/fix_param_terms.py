#!/usr/bin/env python3
"""Restore parameter-role renderings for terms that are also node/group names.

merge_i18n_terms.py places a key in one namespace only. For the ~44 names that
serve both roles the parameter role needs its own rendering — `Steps` is the node
"阶地" but the parameter "阶数". This adds those entries to `paramNames` so the
two namespaces each carry the correct sense.

Usage:
    python tools/fix_param_terms.py [--check]
"""
from __future__ import annotations

import json
import sys
from collections import OrderedDict
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
TERMS = WS / "web" / "data" / "i18n-terms.zh.json"
VOCAB = WS / "web" / "data" / "i18n-vocab.json"

# Parameter-role renderings for names that also exist as nodes or groups.
PARAM_ROLE: dict[str, str] = {
    "Angle": "角度",
    "Artistic Control": "艺术控制",
    "Autolevel": "自动色阶",
    "Clamp": "钳制",
    "Clip": "裁剪",
    "Color": "颜色",
    "Data": "数据",
    "Debris": "碎屑",
    "Distribution": "分布",
    "Downcutting": "下切",
    "Edge": "边缘",
    "Equalize": "均衡",
    "Erosion": "侵蚀",
    "Extend": "扩展",
    "File": "文件",
    "Flow": "水流",
    "Formation": "成形",
    "Gamma": "伽马",
    "Height": "高度",
    "Information": "信息",
    "Layers": "图层数",
    "Melt": "消融",
    "Pattern": "图案",
    "Peaks": "峰数",
    "Primary": "主",
    "Process": "处理",
    "Quality": "质量",
    "Rivers": "河流",
    "Rotation": "旋转",
    "Scale": "尺度",
    "Sea": "海洋",
    "Shape": "形状",
    "Shaper": "整形器",
    "Slope": "坡度",
    "Soil": "土壤",
    "Steps": "阶数",
    "Sunlight": "日照",
    "Surface": "表面",
    "Terraces": "阶地",
    "Texture": "纹理",
    "Threshold": "阈值",
    "Tilt": "倾斜",
    "Variation": "变化量",
    "Warp": "扭曲",
}


def main() -> int:
    check = "--check" in sys.argv
    doc = json.loads(TERMS.read_text(encoding="utf-8"), object_pairs_hook=OrderedDict)
    vocab = json.loads(VOCAB.read_text(encoding="utf-8"))
    param_names = set(vocab["paramNames"])

    params = doc.get("paramNames", OrderedDict())
    added, wrong = [], []
    for key, val in PARAM_ROLE.items():
        if key not in param_names:
            wrong.append(key)  # not actually a parameter; do not add
            continue
        if key not in params:
            params[key] = val
            added.append(key)
        elif params[key] != val:
            wrong.append(f"{key} (existing {params[key]!r})")

    doc["paramNames"] = OrderedDict(
        (k, params[k]) for k in sorted(params, key=lambda s: s.lower())
    )

    print(f"added {len(added)} parameter-role entries")
    for a in added:
        print(f"  {a} -> {PARAM_ROLE[a]}")
    if wrong:
        print(f"\nskipped {len(wrong)} (not a parameter, or already set):")
        for w in wrong:
            print(f"  {w}")

    if not check:
        TERMS.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"\nwrote {TERMS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

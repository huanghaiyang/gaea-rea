#!/usr/bin/env python3
"""Extract node specifications from decompiled Gaea node classes.

The Gaea node classes carry their full specification in attributes:

    [Name("MultiFractal")]
    [Family("Extended")]
    [Toolbox(NodeCategory.Primitive)]
    [Classification(Classification.Generator)]
    public class MultiFractal : Node
    {
        [Parameter(0.25f, 0f, 1f)]        // default, min, max
        [Name("Damping")]
        public float Damping { get; set; }
        ...
        internal override void Build()
        {
            Map map = Noises.MultiFractal(resolution, NoiseType, Octaves, ...);
        }
    }

This module parses that decompiled C# into structured records. It is the
evidence-backed source for default values and ranges, which Nodes.json lacks.

Usage:
    python extract_node_specs.py <decompiled-dir-or-file> [...] [--json out.json]
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

# Class declarations: attribute lines immediately preceding `class X : Base`.
CLASS_RE = re.compile(
    r"^[ \t]*\[[^\]]*\][ \t]*\n"
    r"(?:^[ \t]*\[[^\]]*\][ \t]*\n)*"
    r"^[ \t]*(?:public|internal)?\s*(?:sealed\s+|abstract\s+)?class\s+"
    r"(?P<name>\w+)\s*:\s*(?P<base>[\w.]+)",
    re.MULTILINE,
)
ATTR_RE = re.compile(r"\[(?P<name>\w+)(?:\((?P<args>.*?)\))?\]", re.DOTALL)

# The attribute block attached to a member is the contiguous run of attribute
# lines immediately above it (no blank line in between). Anchoring the run to a
# statement start avoids swallowing the attributes of the previous member.
ATTR_BLOCK = r"(?P<attrs>(?:^[ \t]*\[[^\]]*\][ \t]*\n)+)"
PROP_RE = re.compile(
    ATTR_BLOCK + r"^[ \t]*public\s+(?P<type>[\w.<>\[\], ]+?)\s+(?P<name>\w+)[ \t]*\{[ \t]*get;[ \t]*set;[ \t]*\}",
    re.MULTILINE,
)
PROP_EXPANDED_RE = re.compile(
    ATTR_BLOCK + r"^[ \t]*public\s+(?P<type>[\w.<>\[\], ]+?)\s+(?P<name>\w+)[ \t]*\n"
    r"[ \t]*\{[ \t]*\n"
    r"[ \t]*get[ \t]*\n?"
    r"(?:[ \t]*\{[^}]*\}[ \t]*\n?)?"
    r"[ \t]*set[ \t]*\n?"
    r"[ \t]*\{[^}]*\}[ \t]*\n?"
    r"[ \t]*\}[ \t]*\n",
    re.MULTILINE,
)
BUILD_RE = re.compile(r"internal\s+override\s+void\s+Build\(\)\s*\{(?P<body>.*?)\n\t\}", re.DOTALL)
ENUM_RE = re.compile(r"public\s+enum\s+(?P<name>\w+)\s*\{(?P<body>[^}]*)\}", re.DOTALL)


@dataclass
class ParameterSpec:
    name: str = ""
    ui_name: str | None = None
    cs_type: str | None = None
    kind: str | None = None           # e.g. Enum, HorizontalList, Seed
    raw_args: list[str] = field(default_factory=list)
    default: str | None = None
    default_kind: str | None = None      # numeric | symbolic
    minimum: str | None = None
    maximum: str | None = None
    group: str | None = None
    confidence: str = "observed"


@dataclass
class NodeSpec:
    class_name: str
    base_class: str
    node_name: str | None = None
    family: str | None = None
    short_code: str | None = None
    toolbox: str | None = None
    classification: str | None = None
    flags: list[str] = field(default_factory=list)
    parameters: list[ParameterSpec] = field(default_factory=list)
    build_call: str | None = None
    evidence_file: str | None = None


def collect_attr_block_upward(text: str, decl_idx: int) -> str:
    """Return the contiguous run of attribute lines directly above a declaration.

    `decl_idx` points at the `class` keyword, so the declaration line itself must
    be skipped before walking upward. After that, lines whose first non-whitespace
    character is `[` are collected; the walk stops at the first line that is
    neither an attribute nor a blank inside the run, which is what keeps a
    preceding class body from leaking in.
    """
    head = text[:decl_idx]
    lines = head.splitlines(keepends=True)
    # Drop the declaration line (everything after the last newline).
    if lines:
        lines = lines[:-1]
    collected: list[str] = []
    for line in reversed(lines):
        stripped = line.strip()
        if stripped.startswith("["):
            collected.append(line)
            continue
        if not stripped and collected:
            continue
        break
    return "".join(reversed(collected))


def split_args(argstr: str | None) -> list[str]:
    """Split an attribute argument list on top-level commas only."""
    if not argstr:
        return []
    out: list[str] = []
    depth = 0
    cur = ""
    for ch in argstr:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def parse_attrs(block: str) -> dict[str, list[list[str]]]:
    """Map attribute name -> list of argument lists."""
    result: dict[str, list[list[str]]] = {}
    for m in ATTR_RE.finditer(block):
        name = m.group("name")
        args = split_args(m.group("args"))
        result.setdefault(name, []).append(args)
    return result


def first_arg(attrs: dict, name: str) -> str | None:
    vals = attrs.get(name)
    if not vals or not vals[0]:
        return None
    raw = vals[0][0].strip()
    # [Name("Damping")] -> Damping
    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        return raw[1:-1]
    # [Toolbox(NodeCategory.Primitive)] -> Primitive
    if "." in raw and not raw[0].isdigit():
        return raw.split(".")[-1]
    return raw


def parse_parameter(args: list[str]) -> ParameterSpec:
    spec = ParameterSpec(raw_args=args)
    if not args:
        return spec
    first = args[0]
    if first.startswith("Parameters."):
        spec.kind = first.split(".", 1)[1]
        rest = args[1:]
    else:
        rest = args

    nums = [a for a in rest if re.fullmatch(r"-?\d+(?:\.\d+)?f?", a)]
    non_nums = [a for a in rest if a not in nums]

    # Enum / HorizontalList / Flags carry the default as a symbolic argument;
    # their trailing numbers are the UI range, not a real bound for the value.
    if spec.kind in ("Enum", "HorizontalList", "Flags") and non_nums:
        spec.default = non_nums[0].split(".")[-1] if "." in non_nums[0] else non_nums[0]
        spec.default_kind = "symbolic"
    elif nums:
        spec.default = nums[0]
        spec.default_kind = "numeric"
    elif non_nums:
        spec.default = non_nums[0]
        spec.default_kind = "symbolic"

    if len(nums) >= 2:
        spec.minimum = nums[1]
    if len(nums) >= 3:
        spec.maximum = nums[2]
    if spec.default_kind == "symbolic" and len(nums) >= 1:
        # First symbolic arg is the default; remaining numbers are the range.
        if len(nums) >= 1:
            spec.minimum = nums[0]
        if len(nums) >= 2:
            spec.maximum = nums[1]
    return spec


def parse_file(path: Path, base_dir: Path) -> tuple[list[NodeSpec], dict[str, list[str]]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    nodes: list[NodeSpec] = []

    # Class-level specs.
    #
    # The attribute block is collected by walking UP from the `class` keyword
    # over contiguous attribute lines. Deriving it from CLASS_RE's match start is
    # unreliable: the engine can begin a match partway through the block after
    # backtracking, which silently dropped [Family]/[Name]/[Toolbox] for classes
    # such as `Cellular` and `Combine`. Anchoring on the declaration instead makes
    # the block exact.
    class_matches = list(CLASS_RE.finditer(text))
    decl_starts: list[int] = []
    for cm in class_matches:
        decl_starts.append(text.find("class", cm.start(), cm.end()))

    for ci, cm in enumerate(class_matches):
        decl_idx = decl_starts[ci]
        attr_text = collect_attr_block_upward(text, decl_idx)
        attrs = parse_attrs(attr_text)
        spec = NodeSpec(
            class_name=cm.group("name"),
            base_class=cm.group("base"),
            node_name=first_arg(attrs, "Name") or cm.group("name"),
            family=first_arg(attrs, "Family"),
            short_code=first_arg(attrs, "ShortCode"),
            toolbox=first_arg(attrs, "Toolbox"),
            classification=first_arg(attrs, "Classification"),
            flags=sorted(a for a in attrs if a not in
                         {"Name", "Family", "ShortCode", "Toolbox", "Classification",
                          "Keywords", "Parameter", "Group", "Description", "Icon"}),
            evidence_file=str(path.relative_to(base_dir)) if base_dir in path.parents else str(path),
        )
        # Property-level parameters: the body runs from this class declaration
        # to the start of the next class's attribute block (or end of file).
        start = cm.end()
        end = class_matches[ci + 1].start() if ci + 1 < len(class_matches) else len(text)
        body = text[start:end]

        # Gather parameter-bearing properties in either emitted form, keeping
        # source order so the spec list follows the class declaration.
        prop_hits: list[tuple[int, re.Match]] = []
        for rx in (PROP_RE, PROP_EXPANDED_RE):
            for pm in rx.finditer(body):
                prop_hits.append((pm.start(), pm))
        prop_hits.sort(key=lambda x: x[0])

        # A given property can match only one form; drop exact duplicate spans.
        seen_spans: set[tuple[int, int]] = set()
        for _, pm in prop_hits:
            span = (pm.start("attrs"), pm.end())
            if span in seen_spans:
                continue
            seen_spans.add(span)

            pattrs = parse_attrs(pm.group("attrs"))
            if "Parameter" not in pattrs:
                continue
            for pargs in pattrs["Parameter"]:
                ps = parse_parameter(pargs)
                ps.name = pm.group("name").strip()
                ps.cs_type = pm.group("type").strip()
                ps.ui_name = first_arg(pattrs, "Name")
                if "Group" in pattrs:
                    ps.group = first_arg(pattrs, "Group")
                spec.parameters.append(ps)

        for bm in BUILD_RE.finditer(body):
            calls = re.findall(r"=\s*([A-Za-z_][\w.]*)\(", bm.group("body"))
            if calls:
                spec.build_call = calls[0]
        nodes.append(spec)

    enums: dict[str, list[str]] = {}
    for em in ENUM_RE.finditer(text):
        vals = [v.strip() for v in em.group("body").split(",") if v.strip()]
        enums[em.group("name")] = vals
    return nodes, enums


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out_json = None
    if "--json" in sys.argv:
        out_json = sys.argv[sys.argv.index("--json") + 1]

    targets: list[Path] = []
    for a in args:
        p = Path(a)
        if p.is_dir():
            targets.extend(sorted(p.rglob("*.cs")))
        elif p.exists():
            targets.append(p)
    if not targets:
        print(__doc__)
        return 2

    base = Path.cwd()
    all_nodes: list[NodeSpec] = []
    all_enums: dict[str, list[str]] = {}
    for t in targets:
        try:
            n, e = parse_file(t, base)
        except Exception as exc:
            print(f"# {t}: parse error {exc}", file=sys.stderr)
            continue
        all_nodes.extend(n)
        all_enums.update(e)

    print(f"# parsed {len(all_nodes)} classes from {len(targets)} files", file=sys.stderr)
    with_params = [n for n in all_nodes if n.parameters]
    print(f"# classes with [Parameter] properties: {len(with_params)}", file=sys.stderr)
    named = [n for n in all_nodes if n.node_name]
    print(f"# classes carrying [Name]: {len(named)}", file=sys.stderr)
    total_params = sum(len(n.parameters) for n in all_nodes)
    print(f"# total parameters: {total_params}", file=sys.stderr)

    payload = {
        "nodes": [asdict(n) for n in all_nodes],
        "enums": all_enums,
    }
    if out_json:
        Path(out_json).write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"# wrote {out_json}", file=sys.stderr)
    else:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

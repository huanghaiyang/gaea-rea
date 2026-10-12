"""Extract C# type records (attributes, base type, properties, ctor ports) from
the whole-module decompilation of Gaea.Nodes.dll."""
import os, re, sys, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gaea_common import readtext, EVD

TYPE_DECL = re.compile(
    r'^(?P<mods>(?:public|internal|private|protected|static|sealed|abstract|unsafe|partial|readonly|ref)\s+)*'
    r'(?P<kind>class|struct|enum|interface|delegate)\s+(?P<name>[^\s:{(<]+)'
)
ATTR_LINE = re.compile(r'^\[(?P<body>.*)\]$')
PROP_DECL = re.compile(
    r'^(?P<mods>(?:public|internal|private|protected|static|virtual|override|sealed|abstract|new|unsafe|readonly)\s+)*'
    r'(?P<type>[A-Za-z_][\w\.<>,\[\]\?]*)\s+(?P<name>[A-Za-z_]\w*)\s*$'
)
FIELD_DECL = re.compile(
    r'^(?P<mods>(?:public|internal|private|protected|static|readonly|const|volatile|new)\s+)*'
    r'(?P<type>[A-Za-z_][\w\.<>,\[\]\?]*)\s+(?P<name>[^\s=;]+)\s*(?:=|;)'
)


def strip_literals(line):
    """Remove string/char literal and comment content so braces can be counted."""
    out = []
    i, n = 0, len(line)
    while i < n:
        c = line[i]
        if c == '"':
            if line.startswith('"""', i):
                i += 3
                while i < n and not line.startswith('"""', i):
                    i += 1
                i += 3
            else:
                i += 1
                while i < n:
                    if line[i] == '\\':
                        i += 2
                        continue
                    if line[i] == '"':
                        i += 1
                        break
                    i += 1
            out.append('""')
            continue
        if c == "'":
            i += 1
            while i < n:
                if line[i] == '\\':
                    i += 2
                    continue
                if line[i] == "'":
                    i += 1
                    break
                i += 1
            out.append("''")
            continue
        if line.startswith('//', i):
            break
        out.append(c)
        i += 1
    return ''.join(out)


def split_args(s):
    """Split an attribute argument list on top-level commas."""
    parts, depth, cur = [], 0, []
    in_str = False
    i = 0
    while i < len(s):
        c = s[i]
        if in_str:
            cur.append(c)
            if c == '\\':
                if i + 1 < len(s):
                    cur.append(s[i + 1])
                    i += 2
                    continue
            elif c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            cur.append(c)
        elif c in '([{<':
            depth += 1
            cur.append(c)
        elif c in ')]}>':
            depth -= 1
            cur.append(c)
        elif c == ',' and depth == 0:
            parts.append(''.join(cur).strip())
            cur = []
        else:
            cur.append(c)
        i += 1
    if ''.join(cur).strip():
        parts.append(''.join(cur).strip())
    return parts


def parse_attr(line):
    """'[Parameter(0.1f, 0f, 2f)]' -> ('Parameter', ['0.1f','0f','2f'])."""
    m = ATTR_LINE.match(line.strip())
    if not m:
        return None
    body = m.group('body').strip()
    # strip a trailing "Attribute" suffix as C# allows both spellings
    mm = re.match(r'^([A-Za-z_]\w*)\s*(?:\((.*)\))?$', body, re.S)
    if not mm:
        return (body, [])
    name = mm.group(1)
    args = split_args(mm.group(2)) if mm.group(2) else []
    return (name, args)


def parse_module(path):
    lines = readtext(path).splitlines()
    # locate namespace blocks: 'namespace X' at col 0
    ns_at = {}
    depth = 0
    type_starts = []          # (line_index, namespace)
    cur_ns = '<global>'
    ns_by_line = {}

    for i, raw in enumerate(lines):
        clean = strip_literals(raw)
        if re.match(r'^namespace\s', clean):
            cur_ns = clean.split(None, 1)[1].strip()
        ns_by_line[i] = cur_ns

    # find type declarations at indentation level 1 (inside a namespace block)
    for i, raw in enumerate(lines):
        if not raw.startswith('\t'):
            continue
        if raw.startswith('\t\t'):
            continue
        clean = strip_literals(raw)
        ind = len(clean) - len(clean.lstrip('\t'))
        if ind != 1:
            continue
        if TYPE_DECL.match(clean[1:]):
            type_starts.append(i)

    records = {}
    for k, start in enumerate(type_starts):
        end = type_starts[k + 1] if k + 1 < len(type_starts) else len(lines)
        # attribute lines immediately above the declaration, at 1-tab indent
        ai = start - 1
        attr_lines = []
        while ai >= 0:
            s = lines[ai]
            if s.startswith('\t') and not s.startswith('\t\t') and ATTR_LINE.match(s.strip()):
                attr_lines.append(s.strip())
                ai -= 1
                continue
            if s.strip() == '':
                break
            break
        attr_lines.reverse()

        decl = strip_literals(lines[start])[1:]
        m = TYPE_DECL.match(decl)
        if not m:
            continue
        ns = ns_by_line[start]
        full = f'{ns}.{m.group("name")}' if ns != '<global>' else m.group('name')

        base = None
        bm = re.search(r':\s*([A-Za-z_][\w\.<>,]*)', decl)
        if bm:
            base = bm.group(1)

        rec = dict(
            full=full, ns=ns, name=m.group('name'), kind=m.group('kind'),
            base=base, line=start,
            attributes=[parse_attr(a) for a in attr_lines],
            properties=[], fields=[], ports_added=0,
        )

        # walk the body
        pending_attrs = []
        in_ctor = False
        ctor_depth = 0
        ctor_ports = 0
        ctor_lines = []
        for j in range(start, end):
            raw2 = lines[j]
            clean2 = strip_literals(raw2)
            ind2 = len(clean2) - len(clean2.lstrip('\t'))
            # NB: parse content from the RAW line; `clean2` only drives indentation,
            # because strip_literals deliberately blanks string literals and would
            # turn [Group("Fractal", ...)] into [Group("", ...)].
            s2 = raw2.strip()
            s2c = clean2.strip()

            if j > start and ind2 == 2 and re.match(
                    r'^(public|internal|private|protected)\s+' + re.escape(m.group('name')) + r'\s*\(', s2c):
                in_ctor = True
                ctor_depth = 0

            if in_ctor and ind2 >= 2:
                ctor_depth += s2c.count('{') - s2c.count('}')
                if 'Ports.Add(' in s2:
                    ctor_ports += s2.count('Ports.Add(')
                    ctor_lines.append(s2)
                if ctor_depth <= 0 and '{' in s2c and ind2 == 2:
                    in_ctor = False

            if j > start and ind2 == 2 and ATTR_LINE.match(s2):
                pending_attrs.append(s2)
                continue
            if j > start and ind2 == 2:
                pm = PROP_DECL.match(s2c)
                if pm and s2c not in ('{', '}'):
                    nm = pm.group('name')
                    if nm not in ('get', 'set', 'init', 'return', 'if', 'while', 'for'):
                        rec['properties'].append(dict(
                            name=nm, csType=pm.group('type'),
                            attributes=[parse_attr(a) for a in pending_attrs],
                            line=j,
                        ))
                fm = FIELD_DECL.match(s2c)
                if fm:
                    rec['fields'].append(dict(name=fm.group('name'), csType=fm.group('type')))
                pending_attrs = []
            if 'Ports.Add(' in s2:
                rec['ports_added'] += s2.count('Ports.Add(')
            if 'AddNewPort' in s2 and 'override' in s2:
                rec['has_addnewport'] = True

        rec['ctor_ports_added'] = ctor_ports
        rec['ctor_port_lines'] = ctor_lines
        rec['commits'] = sum(1 for j in range(start, end)
                             if re.search(r'(?<![\w.])Commit\(', strip_literals(lines[j])))

        records[full] = rec
    return records


if __name__ == '__main__':
    recs = parse_module(os.path.join(EVD, 'Gaea.Nodes.whole.cs'))
    print('type records:', len(recs))
    print('kinds:', collections.Counter(r['kind'] for r in recs.values()))
    for probe in ('QuadSpinner.Gaea.Nodes.Blur', 'QuadSpinner.Gaea.Nodes.Combine',
                  'QuadSpinner.Gaea.Nodes.MultiFractal', 'QuadSpinner.Gaea.Nodes.Erosion'):
        r = recs.get(probe)
        print('=' * 60)
        if not r:
            print('MISSING', probe)
            continue
        print(r['full'], '| base =', r['base'], '| ports_added =', r['ports_added'],
              '| addNewPort =', r.get('has_addnewport'))
        print('  attrs:', r['attributes'])
        for p in r['properties']:
            print(f"   prop {p['csType']} {p['name']}  {p['attributes']}")

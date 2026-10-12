"""Shared helpers: robust text reading, Nodes.json parsing, GaeaDump member parsing."""
import io, json, os, re, collections

ROOT = r'D:\sgames\gaea-rea'
EVD = os.path.join(ROOT, 'evidence', 'gdnodes')
DOCS = os.path.join(ROOT, 'docs')
NODES_JSON = r'D:\Gaea 2\Resources\Nodes.json'
ASM_NODES = r'D:\Gaea 2\Gaea.Nodes.dll'
ASM_ENGINE = r'D:\Gaea 2\Gaea.Engine.dll'
EXE = os.path.join(ROOT, 'tools', 'GaeaDump', 'bin', 'Release', 'net8.0', 'GaeaDump.exe')


def readtext(path):
    raw = open(path, 'rb').read()
    for enc in ('utf-16', 'utf-8-sig', 'latin-1'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', 'replace')


# ---------------------------------------------------------------- Nodes.json
def load_nodes():
    return json.load(io.open(NODES_JSON, encoding='utf-8'))


def flatten_node(node):
    """Return (params, groups) where params is the original ordered flat list and
    each leaf carries the positional group it belongs to.

    Nodes.json stores `Flubs` as a FLAT ordered list.  A child with
    `IsGroup: true` and no `Type` is a UI section header; every following child
    up to the next header belongs to that section.  That attribution is
    positional (inferred), not an explicit field in the file.
    """
    params = []
    cur = None
    for i, prm in enumerate(node.get('Flubs', [])):
        is_group = bool(prm.get('IsGroup'))
        rec = dict(
            index=i,
            name=prm['Name'],
            description=prm.get('Description', ''),
            type=prm.get('Type'),
            isGroup=is_group,
            group=cur,
        )
        if is_group:
            cur = prm['Name']
            rec['enumValues'] = None
        elif prm.get('Type') == 'Enum':
            rec['enumValues'] = [
                dict(name=v['Name'], description=v.get('Description', ''), type=v.get('Type'))
                for v in prm.get('Flubs', [])
            ]
        params.append(rec)
    return params


# ------------------------------------------------------- GaeaDump memb output
_HDR = re.compile(r'^=== (.+?) \((\w+)\) ===$')


def parse_members(path):
    """Parse `GaeaDump memb` output into {fullname: {kind, fields, props, methods}}."""
    txt = readtext(path)
    out = {}
    cur = None
    for line in txt.splitlines():
        m = _HDR.match(line)
        if m:
            cur = dict(kind=m.group(2), fields=[], props=[], methods=[])
            out[m.group(1)] = cur
            continue
        if cur is None:
            continue
        s = line.strip()
        if s.startswith('field '):
            # 'field  Int32 value__' has TWO spaces after the keyword; split with a
            # regex so the type/name pair is not shifted.
            fm = re.match(r'^field\s+(\S+)\s+(\S+)$', s)
            if fm:
                cur['fields'].append((fm.group(1), fm.group(2)))
        elif s.startswith('prop '):
            mm = re.match(r'^prop\s+(\S+)\s+(\S+)\s+\{', s)
            if mm:
                cur['props'].append((mm.group(1), mm.group(2)))
        elif s.startswith('method '):
            cur['methods'].append(s[7:])
    return out


def parse_types(path):
    """Parse `GaeaDump types` output into {fullname: {...}}."""
    out = {}
    for line in readtext(path).splitlines():
        if not line.strip():
            continue
        parts = line.split('\t')
        if len(parts) < 5:
            continue
        out[parts[0]] = dict(
            kind=parts[1].split('=', 1)[1],
            methods=int(parts[2].split('=', 1)[1]),
            fields=int(parts[3].split('=', 1)[1]),
            props=int(parts[4].split('=', 1)[1]),
        )
    return out


# ------------------------------------------------- C# primitive -> Gaea type
CSHARP_TO_GAEA = {
    'float': 'Single', 'Single': 'Single',
    'int': 'Int32', 'Int32': 'Int32',
    'bool': 'Boolean', 'Boolean': 'Boolean',
    'string': 'String', 'String': 'String',
    'byte': 'Byte', 'Byte': 'Byte',
    'Float2': 'Float2',
    'Color': 'Color',
}

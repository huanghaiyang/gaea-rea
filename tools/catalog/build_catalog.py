"""Build docs/nodes-catalog.json from Nodes.json (observed) + Gaea.Nodes.dll (observed)
plus explicitly-labelled inferences."""
import os, re, sys, json, collections, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gaea_common import *
from parse_module import parse_module, split_args

RECS = parse_module(os.path.join(EVD, 'Gaea.Nodes.whole.cs'))
MEMBERS = parse_members(os.path.join(EVD, 'all-members.txt'))
TYPES = parse_types(os.path.join(EVD, 'all-types.txt'))
NODES = load_nodes()

# ---------------------------------------------------------------- enum tables
# Enum type -> ordered member names, from the memb dump (metadata order).
ENUMS = {f: [n for (_t, n) in m['fields'] if n != 'value__']
         for f, m in MEMBERS.items() if m['kind'] == 'Enum'}
# simple name -> [fully qualified enum names]
ENUMS_BY_SIMPLE = collections.defaultdict(list)
for _f in ENUMS:
    ENUMS_BY_SIMPLE[_f.rsplit('.', 1)[-1]].append(_f)


def resolve_enum(simple, owner_ns):
    """Resolve a C# enum type name as written in a property signature."""
    cands = ENUMS_BY_SIMPLE.get(simple) or []
    if not cands:
        return None
    same_ns = [c for c in cands if c.rsplit('.', 1)[0] == owner_ns]
    if len(same_ns) == 1:
        return same_ns[0]
    if len(cands) == 1:
        return cands[0]
    return sorted(cands)[0]



def unq(s):
    return s[1:-1] if isinstance(s, str) and len(s) >= 2 and s[0] == '"' and s[-1] == '"' else s


def attr_map(attrs):
    d = {}
    for a in attrs:
        if a:
            d.setdefault(a[0], []).append(a[1])
    return d


def one(attrs, key, idx=0, default=None):
    for a in attrs:
        if a and a[0] == key:
            return a[1][idx] if len(a[1]) > idx else default
    return default


# ------------------------------------------------- resolve impl type per node
resolved = json.load(io.open(os.path.join(EVD, 'resolved.json'), encoding='utf-8'))
node_of_full = {}
impl_of_node = {}
resolve_note = {}
for n in NODES:
    nm = n['Name']
    cands = resolved[nm]
    with_tb = [c for c in cands if c in RECS and any(a and a[0] == 'Toolbox' for a in RECS[c]['attributes'])]
    if len(with_tb) == 1:
        impl_of_node[nm] = with_tb[0]
        resolve_note[nm] = ('unique', 'exactly one candidate class in Gaea.Nodes.dll declares '
                            '[Toolbox(NodeCategory...)]')
    elif len(with_tb) > 1:
        impl_of_node[nm] = with_tb[0]
        resolve_note[nm] = ('ambiguous', f'{len(with_tb)} candidates carry [Toolbox]: {with_tb}')
    else:
        impl_of_node[nm] = None
        resolve_note[nm] = ('unresolved', f'none of {cands} declares [Toolbox]')

# --------------------------------------------- parameter <-> property linking
def norm(s):
    """Alphanumeric-lowercase key: reconciles 'Scale X' (Nodes.json) with 'ScaleX' (C#)."""
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def link_params(node_json, rec):
    """Return (params, groups) with inferred links to impl properties.

    Matching tiers, strongest first; the tier used is recorded on each link so a
    reader can tell a certain match from a probabilistic one.  Real duplicates
    (e.g. MultiFractal exposes two properties both shown as "Roughness") are
    resolved by the UI group, which Nodes.json encodes positionally.
    """
    raw = flatten_node(node_json)
    props = rec['properties'] if rec else []
    sticky = None
    for p in props:
        p['_display'] = unq(one(p['attributes'], 'Name', 0, p['name']))
        own = one(p['attributes'], 'Group', 0, None)      # one() already returns arg[0]
        # [Group] is STICKY: it opens a UI section that every following member
        # belongs to until the next [Group] attribute (same positional semantics
        # as Nodes.json's IsGroup entries).
        if own is not None:
            sticky = unq(own)
        p['_ownGroup'] = unq(own) if own is not None else None
        p['_group'] = sticky
        p['_norm'] = norm(p['_display'])

    def unique(cands):
        seen, out = set(), []
        for p in cands:
            if p['name'] not in seen:
                seen.add(p['name'])
                out.append(p)
        return out

    params, groups = [], []
    cur_group = None
    occ = {}
    for r in raw:
        if r['isGroup']:
            cur_group = r['name']
            owners = [p['name'] for p in props if p['_group'] == r['name']]
            g = dict(index=r['index'], name=r['name'], description=r['description'],
                     type=None, isGroup=True, group=None, enumValues=None, nested=[],
                     implProperty=dict(kind='group-header', backedByProperties=owners,
                                       match='observed' if owners else 'no-property-declares-this-group'))
            groups.append(g)
            params.append(g)
            continue
        e = dict(index=r['index'], name=r['name'], description=r['description'],
                 type=r['type'], isGroup=False, group=r['group'],
                 enumValues=r.get('enumValues'), nested=None)
        for g in groups:
            if g['name'] == cur_group:
                g['nested'].append(e['index'])

        n_key = norm(r['name'])
        okey = (cur_group, n_key)
        ordinal = occ.get(okey, 0)
        occ[okey] = ordinal + 1
        tiers = [
            ('norm-display+group', [p for p in props if p['_norm'] == n_key and p['_group'] == cur_group]),
            ('exact-name', [p for p in props if p['name'] == r['name']]),
            ('exact-display', [p for p in props if p['_display'] == r['name']]),
            ('norm-display', [p for p in props if p['_norm'] == n_key]),
        ]
        e['implProperty'] = dict(exactMatch=None, match='no-matching-property')
        for tier, cands in tiers:
            cands = unique(cands)
            if len(cands) == 1:
                p = cands[0]
                e['implProperty'] = dict(
                    propertyName=p['name'], csType=p['csType'], tier=tier,
                    match='by-name' if tier in ('exact-name', 'exact-display') else 'by-normalized-name',
                    evidence=(f'[Name("{p["_display"]}")] ' if p['_display'] != p['name'] else '')
                             + (f'[Group("{p["_ownGroup"]}")] ' if p['_ownGroup'] else '')
                             + f'public {p["csType"]} {p["name"]}',
                )
                break
            if len(cands) > 1:
                if tier == 'norm-display+group' and ordinal < len(cands):
                    # Several properties in ONE group share a display name (e.g.
                    # Erosion2's three "Discharge Angle"). Declaration order and
                    # Nodes.json order agree across the whole corpus, so pair the
                    # n-th Nodes.json occurrence with the n-th declaration.
                    p = cands[ordinal]
                    e['implProperty'] = dict(
                        propertyName=p['name'], csType=p['csType'],
                        tier='norm-display+group+ordinal',
                        match='by-ordinal-within-group',
                        ambiguousCandidates=[x['name'] for x in cands],
                        evidence=f'ordinal {ordinal} within [Group("{p["_ownGroup"]}")]; '
                                 f'public {p["csType"]} {p["name"]}',
                    )
                else:
                    e['implProperty'] = dict(exactMatch=None, tier=tier,
                                             ambiguousCandidates=[p['name'] for p in cands],
                                             match='ambiguous')
                break
        params.append(e)
    return params, groups


def build_impl_properties(rec):
    if not rec:
        return []
    out = []
    sticky = None
    for p in rec['properties']:
        a = p['attributes']
        am = attr_map(a)
        disp = unq(one(a, 'Name', 0, p['name']))
        own_grp = one(a, 'Group', 0, None)
        if own_grp is not None:
            sticky = unq(own_grp)
        grp = sticky
        par = None
        for k in ('Parameter',):
            if k in am:
                par = am[k][0]
        entry = dict(
            name=p['name'],
            csType=p['csType'],
            gaeaType=CSHARP_TO_GAEA.get(p['csType'], 'Enum' if p['csType'] in ENUMS else p['csType']),
            displayName=disp,
            displayNameFrom='[Name] attribute' if 'Name' in am else 'C# property name',
            group=grp,
            groupDeclaredHere=own_grp is not None,
            groupKind=one(a, 'Group', 1, None) if own_grp is not None else None,
            groupCollapsed=any('IsCollapsed' in x for x in (one(a, 'Group', 3, '') or '')),
            parameterAttribute=par,
            attributes=[dict(name=x[0], args=x[1]) for x in a if x],
        )
        if p['csType'] in ENUMS or p['csType'] in ENUMS_BY_SIMPLE:
            full_enum = resolve_enum(p['csType'], rec['ns'])
            entry['enumType'] = p['csType']
            entry['enumTypeFull'] = full_enum
            entry['enumMemberCount'] = len(ENUMS[full_enum]) if full_enum else None
        # decode [Parameter(...)]
        if par:
            entry['defaultValue'], entry['min'], entry['max'], entry['parameterKind'], entry['enumDefault'] = decode_param(par)
        out.append(entry)
    return out


def decode_param(args):
    """Decode a [Parameter(...)] argument list against ParameterAttribute's ctors."""
    kind = default = lo = hi = enum_default = None
    parts = [a.strip() for a in args]
    if not parts:
        return (None, None, None, 'Standard', None)
    if parts[0].startswith('Parameters.'):
        kind = parts[0].split('.', 1)[1]
        if kind in ('Command',):
            return (parts[1] if len(parts) > 1 else None, None, None, kind, None)
        rest = parts[1:]
        if kind in ('Seed',):
            return (None, None, None, kind, None)
        if len(rest) == 2:
            # (Parameters, String icon) or (Parameters, Object defaultValue ...)
            return (rest[1] if rest[1][0] == '"' else None, None, None, kind, None)
        if len(rest) == 4:
            # (Parameters, Single d1, Single d2, Single min, Single max)
            return (rest[0], rest[2], rest[3], kind + ' (Float2)', None)
        if len(rest) == 3:
            # (Parameters, Object defaultValue, Single min, Single max)
            v = rest[0]
            if re.match(r'^[A-Za-z_]\w*\.\w+$', v):
                enum_default = v
                dv = v
            else:
                dv = v
            return (dv, rest[1], rest[2], kind, enum_default)
        return (None, None, None, kind, None)
    # non-Parameters overloads
    if len(parts) == 3:
        return (parts[0], parts[1], parts[2], 'Standard', None)
    if len(parts) == 4:
        return (parts[0], parts[2], parts[3], 'Standard (Float2)', None)
    if len(parts) == 2:
        return (parts[0], None, None, 'Standard', None)
    return (None, None, None, 'Standard', None)


def build_port_hint(rec):
    if not rec:
        return dict(confidence='unknown', note='no implementation class resolved')
    maxp = one(rec['attributes'], 'CanCreatePorts', 0, None)
    ev = []
    if rec['ctor_ports_added']:
        ev.append(f"{rec['ctor_ports_added']} Ports.Add(...) call(s) in .ctor")
    if maxp:
        ev.append(f'[CanCreatePorts({maxp})]')
    if rec.get('has_addnewport'):
        ev.append('overrides AddNewPort()')
    if rec.get('commits'):
        ev.append(f'{rec["commits"]} Commit(...) call(s) in body')
    return dict(
        inputs=dict(
            base=1,
            baseEvidence='every node derives from QuadSpinner.Gaea.Engine.Fx.Node, which exposes In/Ins[]',
            extraFromCtorPorts=rec['ctor_ports_added'],
            variable=bool(maxp),
            max=int(maxp) if maxp else None,
            inferredMinimum=1 + rec['ctor_ports_added'],
        ),
        outputs=dict(
            base=1,
            baseEvidence='Node exposes Out/Outs[]; Commit(...) is the emit path',
            inferredCount=1 if rec.get('commits') else None,
        ),
        hasDefaultInOut=True,
        extraInputsInCtor=rec['ctor_ports_added'],
        variableInputs=bool(maxp),
        maxInputs=int(maxp) if maxp else None,
        outputCount=1 if rec.get('commits') else None,
        evidence=ev,
        confidence='inferred',
        unknown=['each port\'s PortType (In/Out) is an obfuscated constant-table value',
                 'port display names are obfuscated constant-table strings',
                 'ports added outside .ctor/AddNewPort are not counted'],
    )


def main():
    catalog_nodes = []
    stats = collections.Counter()
    for n in NODES:
        nm = n['Name']
        full = impl_of_node.get(nm)
        rec = RECS.get(full) if full else None
        params, groups = link_params(n, rec)
        props = build_impl_properties(rec)
        tbl = one(rec['attributes'], 'Toolbox', 0, None) if rec else None

        linked = [p for p in params if not p['isGroup']]
        MATCHED = ('by-name', 'by-normalized-name', 'by-ordinal-within-group')
        matched = [p for p in linked if p['implProperty'].get('match') in MATCHED]
        unmatched = [p for p in linked if p['implProperty'].get('match') == 'no-matching-property']
        ambiguous = [p for p in linked if p['implProperty'].get('match') == 'ambiguous']
        prop_names = {p['name'] for p in props}
        covered = {p['implProperty'].get('propertyName') for p in matched}
        extras = [p for p in props if p['name'] not in covered]

        grp_names_json = [g['name'] for g in groups]
        grp_names_asm = sorted({unq(p['group']) for p in props if p['group'] is not None})
        grp_ok = [g for g in grp_names_json if g in grp_names_asm]
        grp_bad = [g for g in grp_names_json if g not in grp_names_asm]
        grp_extra = [g for g in grp_names_asm if g not in grp_names_json]

        cat = tbl.split('.', 1)[1] if tbl and '.' in tbl else tbl
        catalog_nodes.append(dict(
            name=nm,
            description=n['Description'],
            implType=full,
            implTypeCandidates=resolved[nm],
            implTypeResolution=dict(kind=resolve_note[nm][0], evidence=resolve_note[nm][1]),
            implFound=full is not None,
            category=cat,
            categoryConfidence='observed' if cat else 'unresolved',
            categoryEvidence=(f'[Toolbox({tbl})] on {full}' if tbl else None),
            implMetadata=dict(
                baseType=rec['base'] if rec else None,
                family=unq(one(rec['attributes'], 'Family', 0, None)) if rec else None,
                displayName=unq(one(rec['attributes'], 'Name', 0, None)) if rec else None,
                classification=(one(rec['attributes'], 'Classification', 0, '') or '').split('.')[-1] or None if rec else None,
                keywords=parse_keywords(one(rec['attributes'], 'Keywords', 0, None)) if rec else None,
                shortCode=unq(one(rec['attributes'], 'ShortCode', 0, None)) if rec else None,
                icon=unq(one(rec['attributes'], 'Icon', 0, None)) if rec else None,
                canCreatePorts=int(one(rec['attributes'], 'CanCreatePorts', 0, 0)) if rec and one(rec['attributes'], 'CanCreatePorts') else None,
                allAttributes=[a[0] for a in rec['attributes'] if a] if rec else [],
                confidence='observed',
            ) if rec else None,
            parameters=params,
            implProperties=props,
            portHint=build_port_hint(rec),
            coverage=dict(
                nodesJsonParamCount=len(params),
                nodesJsonLeafCount=len(linked),
                nodesJsonGroupCount=len(groups),
                implPropertyCount=len(props),
                linkedExactly=len(matched),
                linkedAmbiguous=len(ambiguous),
                nodesJsonParamsWithoutImplProperty=len(unmatched),
                implPropertiesWithoutNodesJsonParam=len(extras),
                implPropertiesNotReferencedByNodesJson=[p['name'] for p in extras],
                groupNamesMatched=len(grp_ok),
                groupNamesUnmatchedInAssembly=grp_bad,
                assemblyGroupNamesAbsentFromNodesJson=grp_extra,
            ),
            confidence=dict(
                name='observed', description='observed', parameters='observed',
                groupAttribution='inferred (positional: Nodes.json stores groups FLAT, '
                                 'a section runs until the next IsGroup entry)',
                implType='observed' if full else 'unresolved',
                category='observed' if cat else 'unresolved',
                implProperties='observed', portHint='inferred',
            ),
        ))
        stats['nodes'] += 1
    return catalog_nodes


def parse_keywords(arg):
    if not arg:
        return None
    return re.findall(r'"([^"]*)"', arg)


if __name__ == '__main__':
    nodes = main()
    os.makedirs(DOCS, exist_ok=True)
    doc = dict(
        schema='gaea-nodes-catalog/1',
        generatedBy='tools/catalog/build_catalog.py',
        sources=[
            dict(path=r'D:\Gaea 2\Resources\Nodes.json', encoding='UTF-8',
                 role='node names, descriptions, parameter tree, enum values', authority='observed'),
            dict(path=r'D:\Gaea 2\Gaea.Nodes.dll', role='implementation classes, attributes, '
                 'property types, defaults/ranges, groups, ports', authority='observed'),
            dict(path=r'D:\Gaea 2\Gaea.Engine.dll', role='attribute + enum definitions '
                 '(ToolboxAttribute, ParameterAttribute, GroupAttribute, NodeCategory, PortType)',
                 authority='observed'),
        ],
        method=dict(
            assemblyDecompiler='ICSharpCode.Decompiler 9.1.0 via tools/GaeaDump (mode: whole)',
            paramGroupSemantics='Nodes.json `Flubs` is a FLAT ordered list. Entries with '
                                'IsGroup:true and no `Type` are UI section headers; following '
                                'entries belong to that section. There is NO explicit nesting in '
                                'the file, so `group`/`nested` are positionally inferred.',
            implResolution='candidate = class in Gaea.Nodes.dll whose simple name matches the '
                           'node name; disambiguated by requiring [Toolbox(NodeCategory...)].',
        ),
        counts=dict(
            nodes=len(nodes),
            nodesWithImpl=sum(1 for n in nodes if n['implFound']),
            totalParameters=sum(n['coverage']['nodesJsonParamCount'] for n in nodes),
            totalLeafParameters=sum(n['coverage']['nodesJsonLeafCount'] for n in nodes),
            totalGroups=sum(n['coverage']['nodesJsonGroupCount'] for n in nodes),
            totalImplProperties=sum(n['coverage']['implPropertyCount'] for n in nodes),
            linkedExactly=sum(n['coverage']['linkedExactly'] for n in nodes),
            unmatchedParams=sum(n['coverage']['nodesJsonParamsWithoutImplProperty'] for n in nodes),
            implPropsNotInNodesJson=sum(n['coverage']['implPropertiesWithoutNodesJsonParam'] for n in nodes),
        ),
        categories=sorted({n['category'] for n in nodes if n['category']}),
        nodes=nodes,
    )
    p = os.path.join(DOCS, 'nodes-catalog.json')
    json.dump(doc, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('wrote', p, os.path.getsize(p), 'bytes')
    print(json.dumps(doc['counts'], indent=1))
    print('categories:', collections.Counter(n['category'] for n in nodes))

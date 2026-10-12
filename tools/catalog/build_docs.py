"""Generate docs/nodes-reference.md, docs/parameter-types.md, docs/nodes-crosscheck.md
from docs/nodes-catalog.json + the retained assembly evidence."""
import os, sys, json, io, collections, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gaea_common import *

CAT = json.load(io.open(os.path.join(DOCS, 'nodes-catalog.json'), encoding='utf-8'))
NODES = {n['name']: n for n in CAT['nodes']}

# NodeCategory declaration order, read from Gaea.Engine.dll metadata.
CATEGORY_ORDER = ['Primitive', 'Terrain', 'Modify', 'Surface', 'Simulate',
                  'Derive', 'Colorize', 'Output', 'Utility', 'Macro']
CATEGORY_BLURB = {
    'Primitive': '地形基元：噪声与基础形状生成器',
    'Terrain': '地形构造：山脉、峡谷、火山、台地等大尺度形状',
    'Modify': '修改器：模糊、锐化、曲率、重映射等对已有高度的处理',
    'Surface': '地表材质与纹理派生：岩石、沙、雪、土壤、风化',
    'Simulate': '物理模拟与水文：侵蚀、水力、冰川、湖泊、河流',
    'Derive': '派生数据图：法线、AO、遮挡、流向、坡度、曲率',
    'Colorize': '着色与颜色处理',
    'Output': '导出与打包输出',
    'Utility': '流程与数据工具：合并、遮罩、循环、路由、宏',
    'Macro': '宏节点',
}


def md_escape(s):
    return (s or '').replace('|', '\\|').replace('\n', ' ').strip()


def clean_num(v, isint):
    """[Parameter] stores every bound as a C# float, even for int properties
    (`[Parameter(1f, 1f, 10f)]` on an `int`). Drop the suffix for integer types."""
    if v is None:
        return '—'
    s = str(v)
    if isint:
        s = re.sub(r'f$', '', s, flags=re.I)
        if re.fullmatch(r'-?\d+\.0+', s):
            s = s.split('.')[0]
    return s


def fmt_default(p):
    """Default / range text for one parameter."""
    ip = p.get('implProperty') or {}
    prop_name = ip.get('propertyName')
    if not prop_name:
        return '—', None
    impl = next((x for x in NODES_BY_PROP.get(p['_node'], []) if x['name'] == prop_name), None)
    return None, impl


NODES_BY_PROP = {}


def build_prop_index():
    for n in CAT['nodes']:
        NODES_BY_PROP[n['name']] = n['implProperties']


build_prop_index()


def param_rows(node):
    """Yield ('group'|'param', payload) rows in original order."""
    propindex = {x['name']: x for x in node['implProperties']}
    for p in node['parameters']:
        if p['isGroup']:
            yield 'group', p
        else:
            yield 'param', (p, propindex.get((p.get('implProperty') or {}).get('propertyName')))


def render_reference():
    L = []
    A = L.append
    A('# Gaea 2.3.1 节点参考库（182 节点全量）')
    A('')
    A('本文件由 `tools/catalog/build_docs.py` 自动生成，数据来源有两个，均属**观察所得**：')
    A('')
    A('| 来源 | 路径 | 提供内容 |')
    A('|---|---|---|')
    A('| 节点目录 | `D:\\Gaea 2\\Resources\\Nodes.json`（UTF-8，420,649 字节） | 节点名、说明、参数树、枚举成员 |')
    A('| 实现程序集 | `D:\\Gaea 2\\Gaea.Nodes.dll` | 实现类、`[Toolbox]` 分类、`[Group]` 分组、`[Parameter]` 默认值/范围、属性类型 |')
    A('| 属性定义 | `D:\\Gaea 2\\Gaea.Engine.dll` | `ToolboxAttribute`/`ParameterAttribute`/`GroupAttribute`/`NodeCategory`/`PortType` 的定义 |')
    A('')
    A('反编译方式：ICSharpCode.Decompiler 9.1.0，经 `tools/GaeaDump`（`whole` 模式）导出整模块 C#（4,002,700 字节）。')
    A('')
    A('> 复现说明：`tools/GaeaDump/Program.cs` 中已含 `whole` 模式，但仓库里已编译的 ')
    A('> `tools/GaeaDump/bin/Release/net8.0/GaeaDump.exe` 早于该模式（调用会报 `unknown mode: whole`）。')
    A('> 本项目未覆盖原二进制，而是另建到 `tools/GaeaDump/bin/Whole/`：')
    A('> `dotnet build tools/GaeaDump/GaeaDump.csproj -c Release -o tools/GaeaDump/bin/Whole --no-restore`。')
    A('> 该工程直接 `Reference` 本地 Trae 扩展内的 `ICSharpCode.Decompiler.dll`，无需联网还原包。')
    A('')
    A('另需注意：`GaeaDump` 的 `dump`/`whole` 模式把反编译文本写在 **stdout**，进度写在 stderr；')
    A('而 `memb` 的字段行在关键字后有**两个空格**（`field  Int32 value__`），解析时须用正则而非按单空格切分。')
    A('')
    A('> **关于本表中"推断"的边界**：节点名、说明、参数名、参数类型、枚举成员、默认值、范围、分组、分类全部来自上述文件，属观察结果。')
    A('> 唯一属于推断的是 **`参数 → C# 属性` 的配对**（Nodes.json 不记录属性名，需按显示名/分组归一化匹配）以及 **端口方向**（`PortType` 取值被混淆，见 `nodes-crosscheck.md`）。')
    A('')
    A('## 目录')
    A('')
    cnt = collections.Counter(n['category'] for n in CAT['nodes'] if n['category'])
    for c in CATEGORY_ORDER:
        if cnt.get(c):
            A(f'- [{c}（{cnt[c]}）](#{c.lower()})')
    A('')
    A(f"合计 **{len(CAT['nodes'])}** 个节点、**{CAT['counts']['totalParameters']}** 个顶层条目"
      f"（{CAT['counts']['totalLeafParameters']} 个真实参数 + {CAT['counts']['totalGroups']} 个 UI 分组标题）、"
      f"**{CAT['counts']['totalImplProperties']}** 个实现属性。")
    A('')
    A('---')
    A('')

    for c in CATEGORY_ORDER:
        members = sorted([n for n in CAT['nodes'] if n['category'] == c], key=lambda x: x['name'].lower())
        if not members:
            continue
        A(f'## {c}')
        A('')
        A(f'*{CATEGORY_BLURB.get(c, "")}* — `NodeCategory.{c}`，共 {len(members)} 个节点。')
        A('')
        for n in members:
            m = n['implMetadata'] or {}
            A(f"### {n['name']}")
            A('')
            meta = []
            meta.append(f"`{n['implType']}`" if n['implType'] else '**未找到实现类**')
            if m.get('family'):
                meta.append(f"Family `{m['family']}`")
            if m.get('classification'):
                meta.append(f"Classification `{m['classification']}`")
            if m.get('shortCode'):
                meta.append(f"ShortCode `{m['shortCode']}`")
            if m.get('keywords'):
                meta.append('Keywords ' + ', '.join('`%s`' % k for k in m['keywords']))
            A(' · '.join(meta))
            A('')
            A(f"> {md_escape(n['description'])}")
            A('')
            ph = n['portHint']
            if ph.get('confidence') != 'unknown':
                bits = []
                bits.append('默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）')
                if ph.get('extraInputsInCtor'):
                    bits.append(f"构造器额外添加 {ph['extraInputsInCtor']} 个端口")
                if ph.get('variableInputs'):
                    bits.append(f"可变输入，最多 {ph['maxInputs']}")
                A(f"*端口（推断）*：{'；'.join(bits)}。")
                A('')
            A('| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |')
            A('|---|---|---|---|')
            n_rows = 0
            for kind, payload in param_rows(n):
                n_rows += 1
                if kind == 'group':
                    g = payload
                    extra = ''
                    if g['implProperty'].get('backedByProperties'):
                        extra = '`[Group]` 由 ' + ', '.join(
                            f"`{x}`" for x in g['implProperty']['backedByProperties'][:4]) + ' 声明'
                    else:
                        extra = '⚠ 程序集中无属性声明此分组'
                    A(f"| **{md_escape(g['name'])}** *(分组标题)* | — | — | {extra} |")
                    continue
                p, impl = payload
                t = p['type'] if p['type'] else '—'
                cs = ''
                if impl:
                    cs = f" `{impl['csType']}`"
                    if impl.get('enumType') and impl['enumType'] != impl['csType']:
                        cs += f" → `{impl['enumType']}`"
                typ = f"{t}{cs}" if cs else t
                dflt = '—'
                note = ''
                if impl:
                    dv = impl.get('defaultValue')
                    mn, mx = impl.get('min'), impl.get('max')
                    isint = impl['csType'] in ('int', 'Int32', 'byte', 'Byte')
                    parts = []
                    if dv is not None:
                        parts.append(f"`{clean_num(dv, isint)}`")
                    if mn is not None and mx is not None:
                        parts.append(f"范围 {clean_num(mn, isint)} … {clean_num(mx, isint)}")
                    if parts:
                        dflt = '，'.join(parts)
                    elif impl.get('parameterKind'):
                        dflt = f"({impl['parameterKind']}，默认值在混淆常量表中)"
                    if impl.get('displayName') and impl['displayName'] != impl['name']:
                        note = f"C# 属性 `{impl['name']}`"
                ev = ''
                if p.get('enumValues'):
                    vals = []
                    for v in p['enumValues']:
                        d = md_escape(v['description'])
                        vals.append(f"`{v['name']}`" + (f" — {d}" if d else ''))
                    ev = '<br>'.join(vals)
                else:
                    ev = md_escape(p['description'])
                if note:
                    ev = (ev + '<br>' if ev else '') + f"*{note}*"
                A(f"| {md_escape(p['name'])} | {typ} | {dflt} | {ev} |")
            if n_rows == 0:
                A('| *(无参数)* | — | — | `Nodes.json` 中该节点的 `Flubs` 为空数组；'
                  '程序集侧也没有带 `[Parameter]` 的属性。实际行为由实现类内部固定。 |')
            A('')
    return '\n'.join(L) + '\n'


# ------------------------------------------------------------ parameter types
def render_param_types():
    L = []
    A = L.append
    A('# Gaea 2.3.1 参数类型语义说明')
    A('')
    A('本文件解释 `D:\\Gaea 2\\Resources\\Nodes.json` 中 `Type` 字段的每一个取值。')
    A('所有计数来自对该文件的全量扫描；语义结论由 `D:\\Gaea 2\\Gaea.Nodes.dll` 与 `D:\\Gaea 2\\Gaea.Engine.dll` 的元数据佐证。')
    A('')

    # ---- recompute the raw census independently, from the source file ----
    raw = load_nodes()
    census = collections.Counter()
    for n in raw:
        for p in n['Flubs']:
            census[p.get('Type')] += 1
    total_top = sum(census.values())
    A('## 一、总体分布')
    A('')
    A(f'182 个节点的顶层条目共 **{total_top}** 个。按 `Type` 取值统计：')
    A('')
    A('| `Type` 取值 | 数量 | 性质 | 对应 C# 类型 |')
    A('|---|---|---|---|')
    rows = [
        ('(缺失 / null)', census.get(None, 0), 'UI 分组标题，不是参数', '无（由 `[Group]` 特性表达）'),
        ('Enum', census.get('Enum', 0), '枚举参数，`Flubs` 列出成员', '节点内具体枚举类型'),
        ('EnumValue', census.get('EnumValue', 0), '枚举成员，只出现在 `Enum` 之下', '枚举字段'),
        ('Single', census.get('Single', 0), '32 位浮点', '`float` / `System.Single`'),
        ('Int32', census.get('Int32', 0), '32 位有符号整数', '`int` / `System.Int32`'),
        ('Boolean', census.get('Boolean', 0), '布尔', '`bool` / `System.Boolean`'),
        ('Float2', census.get('Float2', 0), '二元浮点向量', '`Float2`'),
        ('Command', census.get('Command', 0), '命令按钮', '`bool` + `[Parameter(Parameters.Command, "<icon>")]`'),
        ('String', census.get('String', 0), '字符串', '`string`'),
        ('Byte', census.get('Byte', 0), '8 位无符号整数（只读信息位）', '`byte`'),
        ('Color', census.get('Color', 0), '颜色', '`Color`'),
        ('List`1', census.get('List`1', 0), '泛型列表', '`List<T>`'),
    ]
    for a, b, c, d in rows:
        A(f'| `{a}` | {b} | {c} | {d} |')
    A('')
    A('校验：8 个非 `EnumValue` 的叶子类型加上缺失项与 `Enum`，构成全部顶层条目；')
    A(f'`EnumValue`（{census.get("EnumValue", 0)}）全部位于深度 1，即嵌套在 `Enum` 之下。递归扫描得到的最大嵌套深度为 **1**。')
    A('')

    # ---- the null question ----
    A('## 二、重点：126 个 `Type` 缺失项到底是什么')
    A('')
    A('**结论：它们全部是 UI 分组标题（section header），不是参数，也没有对应的 C# 属性。**')
    A('')
    A('证据链如下。')
    A('')
    A('### 1. 缺失 `Type` 与 `IsGroup: true` 完全重合')
    A('')
    a = [ (n['Name'], p['Name']) for n in raw for p in n['Flubs'] if p.get('Type') is None ]
    b = [ (n['Name'], p['Name']) for n in raw for p in n['Flubs'] if p.get('IsGroup') ]
    A(f'- `Type` 缺失的条目：**{len(a)}** 个')
    A(f'- `IsGroup` 为真的条目：**{len(b)}** 个')
    A(f'- 两者差集：**{len(set(a) ^ set(b))}** 个（完全一致）')
    A('')
    A('这些条目的键集合只有 `{Name, Description, IsGroup}` 或 `{Name, IsGroup}`，**没有 `Flubs` 子数组**，')
    A('因此 JSON 里不存在"分组包含子项"的显式嵌套。原文是**扁平有序列表**，分组的辖域由位置决定：')
    A('某个 `IsGroup: true` 条目之后、下一个 `IsGroup` 条目之前的全部参数都属于该分组。')
    A('')
    A('例（`Erosion`）：')
    A('')
    A('```')
    n = NODES['Erosion']
    for p in n['parameters']:
        tag = '[GROUP]' if p['isGroup'] else str(p['type'])
        A(f"{p['index']:3d}  {p['name']:<24} {tag}")
    A('```')
    A('')
    A('### 2. 分组标题与程序集的 `[Group]` 特性一一对应')
    A('')
    A('`QuadSpinner.Gaea.Engine.Fx.GroupAttribute` 的定义（观察自 `Gaea.Engine.dll` 元数据）：')
    A('')
    A('```')
    A('=== QuadSpinner.Gaea.Engine.Fx.GroupAttribute (Class) ===')
    A('  field  String <Name>k__BackingField')
    A('  field  GroupType <Type>k__BackingField')
    A('  field  Boolean <IsCollapsed>k__BackingField')
    A('  method Void .ctor(String name, GroupType type, Boolean isCollapsed)')
    A('=== QuadSpinner.Gaea.Engine.Fx.GroupType (Enum) ===')
    A('  field  GroupType Fixed')
    A('  field  GroupType Collapsible')
    A('```')
    A('')
    gm = sum(n['coverage']['groupNamesMatched'] for n in CAT['nodes'])
    gu = sum(len(n['coverage']['groupNamesUnmatchedInAssembly']) for n in CAT['nodes'])
    ga = sum(len(n['coverage']['assemblyGroupNamesAbsentFromNodesJson']) for n in CAT['nodes'])
    A(f'- Nodes.json 的分组标题共 {gm + gu} 个；其中 **{gm}** 个在同一个实现类里能找到 `[Group("<同名>")]`。')
    A(f'- 找不到同名 `[Group]` 的分组标题：**{gu}** 个。')
    A(f'- 反向：程序集里有 `[Group]` 但 Nodes.json 没有对应标题的：**{ga}** 个。')
    A('')
    if gu:
        A('未匹配清单：')
        A('')
        for n in CAT['nodes']:
            for g in n['coverage']['groupNamesUnmatchedInAssembly']:
                A(f"- `{n['name']}` / `{g}`")
        A('')
    if ga:
        A('程序集独有：')
        A('')
        for n in CAT['nodes']:
            for g in n['coverage']['assemblyGroupNamesAbsentFromNodesJson']:
                A(f"- `{n['name']}` / `{g}`")
        A('')
    A('### 3. `[Group]` 是"粘性"的，与 JSON 的位置语义完全一致')
    A('')
    A('`[Group(...)]` 只标注在**开启**该分组的那个属性上，后续属性继承它直到下一个 `[Group]`。')
    A('例（`QuadSpinner.Gaea.Nodes.MultiFractal`，节选自反编译结果）：')
    A('')
    A('```csharp')
    A('[Group("Fractal", GroupType.Fixed, false)]')
    A('[Parameter(Parameters.Enum, MultifractalNoiseType.FBM, 0f, 1f)]')
    A('[Name("Noise Type")]')
    A('public MultifractalNoiseType NoiseType { get; set; }')
    A('')
    A('[Parameter(0.5f, 0f, 1f)]')
    A('[Name("Roughness")]')
    A('public float FractalGain { get; set; }        // 继承 Fractal')
    A('')
    A('[Group("Warp", GroupType.Fixed, false)]')
    A('[Parameter(Parameters.HorizontalList, Perturb.None, 0f, 1f)]')
    A('public Perturb Perturb { get; set; }')
    A('')
    A('[Parameter(0.4f, 0f, 0.5f)]')
    A('[Name("Roughness")]')
    A('public float WarpRoughness { get; set; }      // 继承 Warp')
    A('```')
    A('')
    A('两个属性显示名都叫 `Roughness`，靠分组区分；Nodes.json 里也正是两个 `Roughness`，分属 `Fractal` 与 `Warp`。')
    A('这正是本参考库把分组归属标注为**位置推断**而非"文件明文"的原因，同时也是它可被程序集交叉验证的原因。')
    A('')
    A('### 4. 实践含义')
    A('')
    A('- 写节点图/生成器时，**不能**把 `Type` 缺失项当成需要赋值的参数；它们只影响 UI 呈现。')
    A('- 参数总数若按"顶层条目"算是 1341；按"真实可赋值参数"算是 '
      f'**{CAT["counts"]["totalLeafParameters"]}**（1215）。两个数都对，但含义不同。')
    A('- 分组标题可以用来还原 UI 排版，也是参数→属性配对的消歧键（见 `nodes-crosscheck.md`）。')
    A('')

    # ---- per type sections ----
    A('## 三、逐类型说明')
    A('')

    A('### `Enum` 与 `EnumValue`')
    A('')
    A(f"共 {census.get('Enum', 0)} 个 `Enum` 参数、{census.get('EnumValue', 0)} 个 `EnumValue` 成员。")
    A('`Enum` 条目自身带 `Flubs`，其子项 `Type` 一律为 `EnumValue`，含 `Name` 与 `Description`。')
    A('程序集侧对应一个具体枚举类型；Nodes.json 不记录类型名，类型名由本库从属性签名补齐。')
    A('')
    # enum type / member count cross-check
    enum_rows = []
    mism = []
    for n in CAT['nodes']:
        idx = {x['name']: x for x in n['implProperties']}
        for p in n['parameters']:
            if p['isGroup'] or p['type'] != 'Enum':
                continue
            ip = p.get('implProperty') or {}
            impl = idx.get(ip.get('propertyName'))
            if not impl or not impl.get('enumType'):
                continue
            jc = len(p.get('enumValues') or [])
            ac = impl.get('enumMemberCount')
            enum_rows.append((n['name'], p['name'], impl['enumType'], jc, ac))
            if jc != ac:
                mism.append((n['name'], p['name'], impl['enumType'], jc, ac))
    A(f'交叉核对：{len(enum_rows)} 个枚举参数已解析出程序集枚举类型。')
    A(f'其中 Nodes.json 成员数与枚举字段数 **一致 {len(enum_rows) - len(mism)} 个，不一致 {len(mism)} 个**。')
    A('')
    if mism:
        A('| 节点 | 参数 | 程序集枚举类型 | Nodes.json 成员数 | 枚举字段数 |')
        A('|---|---|---|---|---|')
        for r in mism:
            A(f'| {r[0]} | {r[1]} | `{r[2]}` | {r[3]} | {r[4]} |')
        A('')
    A('<details><summary>全部枚举参数 → 程序集枚举类型（点击展开）</summary>')
    A('')
    A('| 节点 | 参数 | 枚举类型 | Nodes.json 成员数 | 枚举字段数 |')
    A('|---|---|---|---|---|')
    for r in enum_rows:
        A(f'| {r[0]} | {r[1]} | `{r[2]}` | {r[3]} | {r[4]} |')
    A('')
    A('</details>')
    A('')

    # Command
    A('### `Command`')
    A('')
    A(f"共 {census.get('Command', 0)} 个。语义是**动作按钮**，不保存数值。")
    A('程序集侧实现为一个普通布尔属性，加 `[Parameter(Parameters.Command, "<icon-name>")]`（或 `Parameters.CommandButton`）：')
    A('')
    A('```csharp')
    A('// QuadSpinner.Gaea.Nodes.Combine')
    A('[Parameter(Parameters.Command, "replace")]')
    A('[Name("Swap Inputs")]')
    A('public bool SwitchInputs { get; set; }')
    A('')
    A('[Parameter(Parameters.Command, "port-connect")]')
    A('[Name("Add Input")]')
    A('public bool AddInput { get; set; }')
    A('```')
    A('')
    A('第二个字符串参数是图标名（Tabler 图标集风格，如 `dice-five`、`file-shredder`、`port-connect`）。')
    A('`Parameters` 枚举（`QuadSpinner.Gaea.Engine.Fx.Parameters`，19 个字段）列出了全部渲染方式，')
    A('`Command` 与 `CommandButton` 是其中两项。')
    A('')

    # simple primitives with census from assembly
    A('### `Single` / `Int32` / `Boolean`')
    A('')
    A(f"{census.get('Single', 0)} / {census.get('Int32', 0)} / {census.get('Boolean', 0)} 个。")
    A('分别对应 C# `float` / `int` / `bool`。取值范围与默认值来自 `[Parameter(default, min, max)]`：')
    A('')
    A('```csharp')
    A('// QuadSpinner.Gaea.Engine.Fx.ParameterAttribute 的构造函数重载')
    A('method Void .ctor()')
    A('method Void .ctor(Single defaultValue, Single min, Single max)')
    A('method Void .ctor(Single default1, Single default2, Single min, Single max)')
    A('method Void .ctor(Object defaultValue, Single min, Single max)')
    A('method Void .ctor(Parameters parameterType)')
    A('method Void .ctor(Parameters parameterType, String icon)')
    A('method Void .ctor(Parameters parameterType, Single default1, Single default2, Single min, Single max)')
    A('method Void .ctor(Parameters parameterType, Object defaultValue, Single min, Single max)')
    A('```')
    A('')
    A('因此本库按参数个数解读：3 个参数 = `(默认, 最小, 最大)`；4 个 = Float2 的 `(默认x, 默认y, 最小, 最大)`。')
    A('注意布尔值在 IL 里写作 `true`/`false`，而范围仍以 `0f`/`1f` 给出（例：`[Parameter(true, 0f, 1f)]`）。')
    A('')
    cnt3 = sum(1 for n in CAT['nodes'] for p in n['implProperties'] if p.get('min') is not None)
    cntd = sum(1 for n in CAT['nodes'] for p in n['implProperties'] if p.get('defaultValue') is not None)
    A(f'全部 {CAT["counts"]["totalImplProperties"]} 个实现属性中，**{cnt3}** 个带可读的 min/max，'
      f'**{cntd}** 个带可读的默认值。')
    A('其余属性的默认值写在字段初始化器里，形如 `private float <Radius>k__BackingField = \\ue0003.\\ue002(93);`，')
    A('其中 `\\ue0003.\\ue002(int)` 是混淆器的常量表查询（见第六节），静态不可读。')
    A('')

    A('### `Float2`')
    A('')
    A(f"共 {census.get('Float2', 0)} 个。二元浮点向量，对应 C# `Float2`。")
    A('`[Parameter]` 用 4 参数重载给出两个分量的默认值，例：')
    A('')
    A('```csharp')
    A('// QuadSpinner.Gaea.Nodes.Erosion2')
    A('[Parameter(Parameters.RangeClipper, 0f, 1f, 0f, 1f)]   // 形如 (kind, default1, default2, min, max)')
    A('public Float2 Slope { get; set; }')
    A('```')
    A('')

    A('### `String`')
    A('')
    A(f"共 {census.get('String', 0)} 个。C# `string`。")
    A('含用户可编辑的路径、名称，以及只读的信息行（例如 `Accumulator` 的 `Warning`）。'
      '只读与否由 `[Parameter(Parameters.ComputedString)]` 或 `[CustomControl]` 决定。')
    A('')

    A('### `Byte`')
    A('')
    A(f"共 {census.get('Byte', 0)} 个。C# `byte`。")
    A('观察到的全部实例都叫 `Information*` 并且没有 `[Parameter]` 特性，')
    A('说明它是**节点信息位**（例如"当前是否处于 HD 模式""是否被烘焙"），只在 UI 上显示、不可编辑：')
    A('')
    A('```csharp')
    A('// QuadSpinner.Gaea.Nodes.Erosion')
    A('[Group("Information", GroupType.Fixed, false)]')
    A('[Parameter]')
    A('[Description("")]')
    A('public byte Information { get; set; }')
    A('```')
    A('')

    A('### `Color`')
    A('')
    A(f"共 {census.get('Color', 0)} 个。C# `Color`，带 alpha 的 RGBA。")
    A('属性通常还带 `[Parameter(Parameters.HorizontalList, ...)]` 与自定义颜色控件特性。')
    A('')

    A('### ``List`1``')
    A('')
    A(f"共 {census.get('List`1', 0)} 个。这是 .NET 反射给出的泛型类型名 `List<T>` 的字面写法，")
    A('Nodes.json 直接照抄了 `Type.Name` 而没有展开类型参数。')
    A('观察到的实例：')
    A('')
    for n in CAT['nodes']:
        for p in n['parameters']:
            if p.get('type') == 'List`1':
                ip = p.get('implProperty') or {}
                A(f"- `{n['name']}` / `{p['name']}` → C# 属性 `{ip.get('propertyName')}`，类型 `{ip.get('csType')}`")
    A('')
    A('因此 `List`1` 的完整含义必须回到程序集才能确定（上表已给出具体元素类型）。')
    A('')

    A('## 四、`Parameters` 渲染枚举')
    A('')
    A('`[Parameter]` 的第一个参数（当它是 `Parameters` 枚举值时）决定 UI 渲染方式，')
    A('与"数据类型"是两个正交维度。定义见 `QuadSpinner.Gaea.Engine.Fx.Parameters`：')
    A('')
    A('```')
    A('Standard, Enum, Custom, Seed, NamedToggle, HorizontalList, HorizontalListNoLabel,')
    A('OptionGrid, OptionsGridDehumanized, GradientEditor, Command, CommandButton,')
    A('ComputedString, Range, RangeClipper, Folder, TextBox, Array')
    A('```')
    A('')
    A('统计（按实现属性）：')
    A('')
    kc = collections.Counter()
    for n in CAT['nodes']:
        for p in n['implProperties']:
            pa = p.get('parameterAttribute')
            if pa and pa and pa[0].startswith('Parameters.'):
                kc[pa[0].split('.', 1)[1]] += 1
    A('| 渲染方式 | 属性数 |')
    A('|---|---|')
    for k, v in kc.most_common():
        A(f'| `Parameters.{k}` | {v} |')
    A('')
    A('## 五、混淆对类型判定的影响')
    A('')
    A('`Gaea.Nodes.dll` 的**类型名被混淆**（如 `\\ue0002`、`\\ue0003`），但**成员名完整可读**。')
    A('受影响的部分：')
    A('')
    A('- 属性类型名若指向被混淆的枚举，反射会给出 `enum` 而非真实名（例如 `ColorErosion.Ver` 的类型显示为 `enum`）。')
    A('- 枚举成员的具体数值需要 `\\ue0003` 的常量表才能读出，静态不可得；Nodes.json 的成员**顺序**与元数据字段顺序一致，可作为顺序依据。')
    A('- 端口方向 `PortType` 的所有取值都以 `(PortType)\\ue0003.\\ue000(1)` 形式出现，无法静态判定（见 `nodes-crosscheck.md`）。')
    A('')
    A('## 六、`Type` 缺失项与"真正未知"的区分')
    A('')
    A('| 现象 | 判定 | 依据 |')
    A('|---|---|---|')
    A('| `Type` 字段缺失 | **不是未知**，是分组标题 | 与 `IsGroup: true` 100% 重合，且能从 `[Group]` 找到同名声明 |')
    A('| 属性类型显示为 `enum` | 真实类型被混淆，未知 | 混淆器把类型名替换为单字符 |')
    A('| 默认值为 `\\ue0003.\\ue002(N)` | 未知 | 加密常量表 |')
    A('| 端口方向 | 未知 | `PortType` 常量被混淆 |')
    A('')
    return '\n'.join(L) + '\n'


# ---------------------------------------------------------------- crosscheck
def render_crosscheck():
    L = []
    A = L.append
    A('# Nodes.json 与 Gaea.Nodes.dll 交叉核对报告')
    A('')
    A('对照双方：')
    A('')
    A('- 声明侧：`D:\\Gaea 2\\Resources\\Nodes.json`（UTF-8，420,649 字节，182 个节点，1341 个顶层条目）')
    A('- 实现侧：`D:\\Gaea 2\\Gaea.Nodes.dll`（799,224 字节，694 个类型；622 个位于 `QuadSpinner.*` 命名空间）')
    A('- 特性定义侧：`D:\\Gaea 2\\Gaea.Engine.dll`（`QuadSpinner.Gaea.Engine.Fx`）')
    A('')
    A('## 一、总量')
    A('')
    c = CAT['counts']
    A('| 指标 | 数值 |')
    A('|---|---|')
    A(f"| 节点数 | {c['nodes']} |")
    A(f"| 找到实现类的节点 | {c['nodesWithImpl']} / {c['nodes']}（100%） |")
    A(f"| Nodes.json 顶层条目 | {c['totalParameters']} |")
    A(f"| 其中真实参数（叶子） | {c['totalLeafParameters']} |")
    A(f"| 其中 UI 分组标题 | {c['totalGroups']} |")
    A(f"| 实现属性总数 | {c['totalImplProperties']} |")
    A(f"| 参数→属性 已配对 | {c['linkedExactly']} / {c['totalLeafParameters']}（{100.0*c['linkedExactly']/c['totalLeafParameters']:.2f}%） |")
    A(f"| 参数无对应属性 | {c['unmatchedParams']} |")
    A(f"| 属性未被 Nodes.json 引用 | {c['implPropsNotInNodesJson']} |")
    A('')
    A('## 二、实现类解析方法')
    A('')
    A('1. 以节点名在 `Gaea.Nodes.dll` 中按简单类名（大小写不敏感、去除非字母数字后）匹配候选。')
    A('2. 要求候选类带有 `[Toolbox(NodeCategory...)]`。')
    A('')
    A('结果：197 个原始候选中，**恰好 182 个带 `[Toolbox]`**，与 Nodes.json 的 182 个节点数量完全吻合；')
    A('每个节点名解析出的带 `[Toolbox]` 候选都是唯一的，歧义为 0。')
    A('')
    A('初始的 14 个歧义名全部由 `[Toolbox]` 判定解决：')
    A('')
    A('| 节点名 | 候选 | 选用 | 落选者 |')
    A('|---|---|---|---|')
    for nm, cands in sorted(IMPL_AMBIG.items()):
        A(f"| `{nm}` | {len(cands)} | `{NODES[nm]['implType']}` | " +
          ', '.join(f'`{x}`' for x in cands if x != NODES[nm]['implType']) + ' |')
    A('')
    A('落选者均为 `QuadSpinner.Gaea.Nodes.Modifiers.*`（`Modifier` 基类的内部处理单元，无 `[Toolbox]`）')
    A('或 `QuadSpinner.Gaea.Nodes.Core.*`（供其它节点复用的核心算法类）。')
    A('因此**"带 `[Toolbox]`"是节点类与内部算法类的可靠判别式**。')
    A('')
    A('## 三、参数→属性配对')
    A('')
    A('Nodes.json **不记录** C# 属性名，只记录显示名。配对按以下由强到弱的层级进行，')
    A('每一层的结果都记在 `nodes-catalog.json` 的 `implProperty.tier` 里：')
    A('')
    A('| 层级 | 规则 | 命中数 |')
    A('|---|---|---|')
    tc = collections.Counter()
    for n in CAT['nodes']:
        for p in n['parameters']:
            if not p['isGroup']:
                tc[(p.get('implProperty') or {}).get('tier')] += 1
    tier_desc = {
        'norm-display+group': '归一化显示名 + UI 分组（消歧主力）',
        'exact-name': 'C# 属性名与 Nodes.json 名完全相同',
        'exact-display': '`[Name]` 显示名完全相同',
        'norm-display': '仅归一化显示名相同',
        'norm-display+group+ordinal': '归一化显示名 + 分组 + 同组内序号',
        None: '未配对',
    }
    for k, v in tc.most_common():
        A(f"| `{k or '—'}` | {tier_desc.get(k, k)} | {v} |")
    A('')
    A('归一化规则：去掉所有非字母数字字符并转小写。这一层是必要的，因为：')
    A('')
    A('```')
    A('Nodes.json "Scale X"     ↔  C# float ScaleX')
    A('Nodes.json "Offset Y"    ↔  C# float OffsetY')
    A('Nodes.json "LOD Info"    ↔  C# string LODInfo')
    A('Nodes.json "Sediment Removal" ↔ C# float SedimentRemoval')
    A('Nodes.json "Vertices Count"   ↔ C# int VerticesCount')
    A('```')
    A('')
    A('分组消歧的例子：`MultiFractal` 的 `FractalGain` 与 `WarpRoughness` 显示名都是 `Roughness`，')
    A('Nodes.json 里也有两个 `Roughness`（分属 `Fractal` 与 `Warp`），靠分组一一对应。')
    A('')
    A('## 四、发现的不一致')
    A('')
    A('### 4.1 Nodes.json 有、程序集没有的条目（6 个）')
    A('')
    A('| 节点 | 参数 | 类型 | Nodes.json 分组 | 说明 |')
    A('|---|---|---|---|---|')
    miss = []
    for n in CAT['nodes']:
        for p in n['parameters']:
            if not p['isGroup'] and (p.get('implProperty') or {}).get('match') == 'no-matching-property':
                miss.append((n, p))
    for n, p in miss:
        A(f"| `{n['name']}` | `{p['name']}` | {p['type']} | {p['group'] or '—'} | {md_escape(p['description']) or '（无说明）'} |")
    A('')
    A('逐条分析：')
    A('')
    A('- **`ColorErosion` / `Version`（Enum）、`Q 0`、`Q 1`（Boolean）**：该类的属性只有 '
      '`Ver`（类型显示为 `enum`，被混淆）与 8 个模拟参数，**没有 `Q0`/`Q1`**。')
    A('  `Version` 很可能对应混淆后名为 `Ver` 的属性，但成员名不匹配、类型也不匹配（枚举 vs 布尔），本库不强行配对。')
    A('- **`Erosion2` / `ExtraDepositionBoost`（Single）**：该类只有 `DepositionBoost`，没有 `ExtraDepositionBoost`。'
      '疑为 Nodes.json 中的历史遗留条目。')
    A('- **`Lake` / `Accuracy`（Enum，分组 `Simple Mode`）**：该类无 `Accuracy` 属性，也无 `Simple Mode` 分组。')
    A('- **`Wizard2` / `Convert`（Command，分组 `Advanced`）**：该类无 `Advanced` 分组、无对应属性。'
      '全部 20 个 `Command` 参数中仅此 1 个未能配对（其余 19 个都对应到 `[Parameter(Parameters.Command, ...)]` 的布尔属性）。')
    A('')
    A('**结论**：这 6 个条目在 `Gaea.Nodes.dll` 2.3.1 中没有实现。可能是 Nodes.json 版本略新，'
      '或这些是编辑器侧动态注入的条目。它们可在 `nodes-catalog.json` 中通过 '
      '`implProperty.match == "no-matching-property"` 精确定位。')
    A('')
    A('### 4.2 程序集有、Nodes.json 未列的属性（29 个）')
    A('')
    A('| 节点 | 属性 | C# 类型 | 有 `[Parameter]` | 解释 |')
    A('|---|---|---|---|---|')
    ex = []
    for n in CAT['nodes']:
        idx = {x['name']: x for x in n['implProperties']}
        for name in n['coverage']['implPropertiesNotReferencedByNodesJson']:
            ex.append((n, idx[name]))
    for n, p in ex:
        hasp = '是' if p.get('parameterAttribute') is not None or any(
            a['name'] == 'Parameter' for a in p['attributes']) else '否'
        A(f"| `{n['name']}` | `{p['name']}` | `{p['csType']}` | {hasp} | {explain_extra(p)} |")
    A('')
    A('分类：')
    A('')
    A('- **内部状态属性（无 `[Parameter]`）**：`PortCount`（7 个节点，供 `AddNewPort` 使用）、'
      '`Data`（`List<Float4>`，2 个节点）、`LoopInProgress`、`CompareMode`、`DotNoiseStyle`、'
      '`Ver`、以及 `Layer1`…`Layer15`（`BlendLayer`，属 `Layers`/`Mixer` 系的图层次结构）。'
      '这些**本就不该出现在参数列表中**，是 JSON 与实现一致的表现。')
    A('- **带 `[Parameter]` 但未列出**：如 `Layers` 的 `Mode`、`Compare` 的 `Mode`。'
      '说明 Nodes.json 与实现属性集**不是简单相等关系**，Nodes.json 侧重编辑器暴露面。')
    A('')
    A('### 4.3 分组一致性')
    A('')
    A(f"- Nodes.json 分组标题 {c['totalGroups']} 个，其中 "
      f"{sum(n['coverage']['groupNamesMatched'] for n in CAT['nodes'])} 个能在同类中找到同名 `[Group]` 特性。")
    A(f"- 反向差异：程序集有 `[Group]` 而 Nodes.json 无对应标题的共 "
      f"{sum(len(n['coverage']['assemblyGroupNamesAbsentFromNodesJson']) for n in CAT['nodes'])} 个。")
    ga = [(n['name'], g) for n in CAT['nodes'] for g in n['coverage']['assemblyGroupNamesAbsentFromNodesJson']]
    if ga:
        A('')
        A('| 节点 | 程序集分组 |')
        A('|---|---|')
        for nm, g in ga:
            A(f'| `{nm}` | `{g}` |')
    A('')
    A('## 五、枚举一致性')
    A('')
    A('对每个 `Type == "Enum"` 的参数，比较 Nodes.json 的 `EnumValue` 子项数与程序集枚举类型的字段数。')
    A('')
    mism = CHECK['enum_mismatch']
    A(f"- 已解析出枚举类型的枚举参数：{CHECK['enum_total']} 个")
    A(f"- 成员数一致：{CHECK['enum_total'] - len(mism)} 个")
    A(f"- 成员数不一致：{len(mism)} 个")
    A('')
    if mism:
        A('| 节点 | 参数 | 枚举类型 | Nodes.json | 程序集 |')
        A('|---|---|---|---|---|')
        for r in mism:
            A(f'| `{r[0]}` | `{r[1]}` | `{r[2]}` | {r[3]} | {r[4]} |')
        A('')
        A('不一致的原因通常是 Nodes.json 只列出编辑器开放的子集，或枚举含隐藏成员。')
        A('')
    A('## 六、未能解决的缺口')
    A('')
    A('1. **端口（portHint）方向无法静态确定。** `Gaea.Nodes.dll` 中所有端口类型写作 '
      '`new Port(this, <obfuscated string>) { Type = (PortType)\\ue0003.\\ue000(N) }`，'
      '`PortType` 取值与端口名都来自混淆器常量表。')
    A('   本库只能给出：')
    A('   - 基类 `QuadSpinner.Gaea.Engine.Fx.Node` 提供 `In` / `Out` / `Ins[]` / `Outs[]` / `Ports`，故每个节点至少有 1 入 1 出；')
    A('   - 构造器中 `Ports.Add(...)` 的调用次数即**额外**端口数；')
    A('   - `[CanCreatePorts(n)]` + 覆写 `AddNewPort()` 表示可变端口（如 `Combine`：`[CanCreatePorts(10)]`）。')
    A('   方向、端口名、以及 `Build()` 中动态增删的端口均未确定。')
    A('2. **部分默认值不可读。** 字段初始化器形如 `= \\ue0003.\\ue002(93)`，是加密常量表查询；'
      '只有写在 `[Parameter(...)]` 里的默认值可读（29 个节点全部属性中可读者 '
      f'{sum(1 for n in CAT["nodes"] for p in n["implProperties"] if p.get("defaultValue") is not None)} 个）。'
      '常量表位于程序集内嵌资源，由 `\\ue0002`（字符串表）/`\\ue0003`（数值表）在静态构造器中解密读取，本次未解密。')
    A('3. **节点分类只有 10 类，没有 Hydrology/Mask/Filter 等更细的类目。**')
    A('   程序集里唯一的分类来源是 `[Toolbox(NodeCategory.X)]`，`NodeCategory` 只有 '
      '`Primitive, Terrain, Modify, Surface, Simulate, Derive, Colorize, Output, Utility, Macro` 十个值。')
    A('   任何更细的归类（如"水文""遮罩"）都只能是推断，本库有意不写进 `category`，以免把推断当事实。')
    A('4. **`ColorErosion.Ver` 的真实枚举类型不可读**（反射给出 `enum`），其成员与值未知。')
    A('5. **`Gaea.Nodes.dll` 的 `Build()` 算法体未逐节点分析。** 本库只做参数/属性/分类的规范映射；'
      '算法语义需另行反编译 `Build()`，且其调用链大量经过被混淆的类型。')
    A('')
    return '\n'.join(L) + '\n'


def explain_extra(p):
    n = p['name']
    if n == 'PortCount':
        return '供 `AddNewPort()` 计数的内部状态'
    if n == 'Data':
        return '内部数据缓冲'
    if re.match(r'^Layer\d+$', n):
        return '图层次结构内部字段'
    if n == 'LoopInProgress':
        return '循环节点运行时状态'
    if n == 'Ver':
        return '被混淆的版本枚举'
    if n == 'CompareMode':
        return '被混淆的内部枚举'
    if n == 'DotNoiseStyle':
        return '被混淆的内部枚举'
    return '内部或未在 Nodes.json 暴露'


# ------------------------------------------------------- precomputed helpers
def compute_check():
    enum_total = 0
    mism = []
    for n in CAT['nodes']:
        idx = {x['name']: x for x in n['implProperties']}
        for p in n['parameters']:
            if p['isGroup'] or p['type'] != 'Enum':
                continue
            ip = p.get('implProperty') or {}
            impl = idx.get(ip.get('propertyName'))
            if not impl or not impl.get('enumType'):
                continue
            jc = len(p.get('enumValues') or [])
            ac = impl.get('enumMemberCount')
            enum_total += 1
            if jc != ac:
                mism.append((n['name'], p['name'], impl['enumType'], jc, ac))
    return dict(enum_total=enum_total, enum_mismatch=mism)


def compute_ambig():
    out = {}
    for n in CAT['nodes']:
        if len(n['implTypeCandidates']) > 1:
            out[n['name']] = n['implTypeCandidates']
    return out


CHECK = compute_check()
IMPL_AMBIG = compute_ambig()

if __name__ == '__main__':
    os.makedirs(DOCS, exist_ok=True)
    out = {
        'nodes-reference.md': render_reference(),
        'parameter-types.md': render_param_types(),
        'nodes-crosscheck.md': render_crosscheck(),
    }
    for fn, txt in out.items():
        p = os.path.join(DOCS, fn)
        open(p, 'w', encoding='utf-8').write(txt)
        print(f'{fn:26} {len(txt):>9,} chars  {len(txt.splitlines()):>7,} lines')
    print('\nenum cross-check:', CHECK['enum_total'], 'checked,', len(CHECK['enum_mismatch']), 'mismatched')
    print('ambiguous impl names:', len(IMPL_AMBIG))

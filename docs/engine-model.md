# Gaea 2.0 / 2.3.1 引擎执行模型 —— 图序、数据流、Map、参数、生命周期、缓存、序列化

目标：`D:\Gaea 2\Gaea.Engine.dll`（1 424 888 B，.NET 8，Gaea 2.3.1）
反编译产物：`evidence/decompiled/engine/*.cs`（原始）与 `evidence/decompiled/engine/deob/*.cs`（字符串池已还原）

> 证据标注：**observed** = 反编译代码里直接可见；**inferred** = 推理；**unknown** = 无法确定。
> 引用形式 `Type.Member` 或 `文件:行`。
> 反编译器把混淆标识符输出为 C# 转义文本（如 `\uf55c\uf0ba\ue6cb`），本文原样保留。
>
> 本文件修订了同目录早期版本的若干推断（见文末 §10「对早期版本的更正」）。

---

## 0. 前提修正：Gaea.Engine.dll **被 Eazfuscator.NET 保护**

早期版本写"未混淆，反编译效果良好"——只对了一半。

* **observed** 公开 API 类型/成员名完好（`Node`、`Port`、`Map`、`SaveDefinition`…），类型布局完整，
  类/方法体反编译质量确实高。
* **observed** **internal/private 类型与成员名被替换为私用区字符**（`\uf55c\uf0ba\ue6cb` 等），
  全程序集 454 个此类标识符。`Node.Build()` 等 public/internal 框架成员名保留，故框架层仍可读。
* **observed** **所有整型/浮点字面量被搬进加密常量池**：源码写法是
  `\uf55c\uf0ba\ue713.\uf3e6\uf893\ue6d5(139)`，括号里是**池索引，不是值**。
  `BuildDefinition.Resolution`、`NodeIdleThreshold`、`BuildType` 比较等处的数值**不能**从文本直接读出。
* **observed** **大多数字符串字面量同样加密**（`\uf55c\uf0ba\ue712.<m>(N)`）。
* **observed** 常量池存在**加密的托管资源**中，由 `\uf55c\uf0ba\ue72b.\uf3e6\uf893\ue6d5(Stream)` 运行时解出；
  外壳（XOR + SymmetricAlgorithm + Deflate）已完整还原，见 `engine-dataformats.md` §5。

本次产出（可直接被其它工作流复用）：

| 产物 | 说明 |
| --- | --- |
| `evidence/decompiled/engine/pool_strings.tsv` | **已还原字符串常量池**：`池索引<TAB>字符串`，1020 条；经 152/152 个调用点交叉验证 |
| `evidence/decompiled/engine/deob/*.cs` | 字符串池调用替换为真实字面量的可读版本（31 文件 / 210 处） |
| `tools/GaeaPools` | 常量池离线解码器（外壳解码 / int 池解析 / 字符串池解析 / 整数表达式求值） |
| `tools/GaeaDumpEx` | 索引可选反编译器：解决 `Map` 与 `` Map`1 `` 在 `FullName` 上同名、无法分辨的问题 |

**未解决**：整型常量池（资源 `ZyPox`，1304 B，`flags=0x01`）。外壳解出后在任何偏移都不是标准 deflate；
AES 路径因长度非 16 倍数不成立；`xorIV` / `xorKey` / 自定义 XOR 密码 / reverse 等变换均失败。
下文凡涉及具体数字处一律标注「池索引未解析」。

---

## 1. 组件图

| 类型 | 命名空间 | 角色 |
| --- | --- | --- |
| `Node` | `QuadSpinner.Gaea.Engine.Fx` | 图节点：标识、端口、参数、生命周期钩子 |
| `Port` | 同上 | 命名的入/出插槽，含 `Connection` |
| `PortType` | 同上 | `[Flags]`，端口方向与特性 |
| `Connection` / `ConnectionRecord` | 同上 | 出端口→入端口的边 |
| `Map` / `` Map`1 `` | 同上 | 多通道地形缓冲；`` Map`1 `` 是泛型元素版本 |
| `Map.Channel` | 同上 | 单通道 `float[]` + `Resolution` |
| `Map._RGB` | 同上 | 三通道颜色视图 |
| `MapInfo` | 同上 | struct，只含 `RenderIntent` |
| `Terrain` | 同上 | **文档根对象**：`Nodes`/`Groups`/`Notes`/`Regions`/`GraphTabs`… |
| `NodeMetadata` | 同上 | 每类节点的静态描述 + **原型实例** |
| `BuildContext` | 同上 | `Resolution` + `CacheClusters` + `Bucket` |
| `BuildDefinition` | 同上 | 用户构建设置（分块、分辨率、输出） |
| `Cache` / `CacheCollection` / `CacheOptions` | `QuadSpinner.Gaea.Engine.Fx` / `.Engine` | 内容寻址节点缓存 |
| `CacheKeyAttribute` / `CacheKeyBuilder` | `QuadSpinner.Gaea.Engine.Utilities` | 缓存键 |
| `MetaDictionary` | `QuadSpinner.Gaea.Engine.Fx.Structure.Logic` | Map 缓存元数据的字符串字典 |
| `ParameterAttribute` / `Parameters` | `QuadSpinner.Gaea.Engine.Fx` | 参数标记与控件种类 |
| `ParameterAwareContractResolver` / `Sophia` / `HDService` / `TileVertexBorder` | `QuadSpinner.Gaea.Engine.IO` | JSON 契约解析、网格生成、HD 服务、瓦片补边 |

（observed：以上均来自反编译声明）

---

## 2. 执行图：排序、依赖、缓存失效

### 2.1 `BuildOrder` **不是**执行排序依据

* **observed** `Node.BuildOrder` 是普通自动属性 + 私有后备字段
  `<BuildOrder>k__BackingField`（`Fx.Node.cs:175,619`）。
* **observed** 在 `Gaea.Engine.dll` 全文（`evidence/decompiled/engine/**`）搜索 `BuildOrder`
  只命中声明与读写属性自身，**没有任何写入点**。
  * `inferred`：由 UI/文档层（`Gaea.dll`）写入，或为历史遗留；`unknown` 具体写入方。
  * 早期版本"按 BuildOrder 拓扑排序"的说法**不成立**。

### 2.2 真正的依赖遍历与顺序

* **observed** `\uf55c\uf0ba\ue6cb.\ue6f8\ue1a7\ueff5(Node)` → 私有递归
  `\ue6f8\ue1a7\ueff6(Node currentNode, List<Node>, ref HashSet<Node>)`（`_cls_E6CB.cs:2093-2125`）：
  ```
  对 currentNode.Ins[i].Connection?.Target?.Parent 逐个递归（visited HashSet 去重），
  递归返回后再把 currentNode 加入 list      ⇒ DFS 后序 = 拓扑序（依赖在前）
  ```
* **observed** 构建驱动用的节点列表来自 `\ue6f8\ue1a7\uf003(Node)` → `\ue6f8\ue1a7\uf008(Node, ref state)`
  （`:2258-2265`），在 `\uf004` 内再 `.Distinct()`（`:2275`）。
* **observed** 用于**哈希/一致性**的全图顺序按 `Id`：
  内部 lambda `<>c.\uf801\uec0d\uf7c5(Node x) => x.Id`；使用点 `_cls_E6CB.cs:2166`（节点 parity）
  与 `:2176`（全图 parity）。
* **observed** `Node.Id` 由 `\uf55c\uf0ba\ue6d4.\uef4a\ue355\uf646()` 分配（`_cls_E6D4.cs:105-117`）：
  `Global.Random.<m>(1, Constants.MaxId)`，与既有 `Nodes`/`Groups`/`Notes` 冲突则重取；
  节点数超过 `Constants.MaxId * <pool(0)>` 时 `Constants.MaxId *= <pool(19)>`。
* **observed** 反向（下游）闭包：`\ue6f8\ue1a7\ueffb(Node)`（`:2183-2218`）用显式 `Stack<Node>` +
  `HashSet<Node>` 遍历全图，挑出（传递地）依赖该节点的节点并剔除自身；
  `\ue6f8\ue1a7\uefb7(node)`（`:836-843`）对它们逐个调用 `\uf072\uf1d6\uf6d1()`（失效扩展方法）。

**结论（observed）**：执行顺序 = **端口连接图的后序 DFS**；`Id` 只用于确定性哈希；
`BuildOrder` 在引擎内未参与排序。

### 2.3 parity / Thumbprint

* **observed** `Node.Touch()` = `Thumbprint = Guid.NewGuid()`（`Fx.Node.cs:1045-1048`）。
* **observed** `Node.GetParityString()`（`:950-981`）：
  ```
  "<" + Id + ">"
  + 每个已连接 In 端口: "(" + In端口名 + "-" + 上游端口名 + "-" + 上游节点Id + "-" + 本节点Thumbprint + ")"
    之后全局去掉子串 "In-" / "-In" / "Out-" / "-Out"
  ```
  注意最后一项是**本节点**的 `Thumbprint`。
* **observed** `Node.UpdateParity()`（`:983-988`）：`LastParity = Parity; Parity = <E6CB>.\ueff9(this, true);
  return LastParity == Parity;` —— **返回 true 表示 parity 未变化**。
* **observed** 引擎级 parity `\ue6f8\ue1a7\ueff9(Node, bool)`（`:2161-2171`）：
  取上游闭包（`bool=false` 时再过滤），**按 `.OrderBy(x => x.Id)`** 拼接每个节点的 `GetParityString()`。
  因为闭包含全部上游，上游 `Thumbprint` 通过传递被涵盖。
  `\ue6f8\ue1a7\ueffa()` 是同一逻辑作用于全图。
* **observed** `Node.GetPropertyParityString()`（`:990-1009`）= 所有带 `ParameterAttribute` 属性的
  `GetValue(this).ToString()` 用 `"|"` 连接（末尾去一字符）。
  ⇒ **参数指纹与拓扑指纹是两条独立通道**。
* **observed** 磁盘侧：`Cache.Thumbprint`(Guid) 写入 `.meta` 的 `GUID`；
  `Cache.IsDifferentFromDisk()` 读回比较，不同即视为失效（`Fx.Cache.cs:148-167`）。

---

## 3. 数据流：`Port` / `Connection` / 图容器

### 3.1 `Port`（observed，`Fx.Port.cs`）

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `Name` | string | `"In"` / `"Out"` / `"Mask"` / `"Unmodified"` 等 |
| `DisplayName` | string | UI 名 |
| `Accumulator` | string | 累加器标识 |
| `Type` | `PortType`（`[Flags]`） | 方向/主口/必需/后处理 |
| `Order` | int（`[JsonIgnore]`） | 端口顺序 |
| `Connection` | `Connection`（`[JsonIgnore]`） | **入端口**持有的边 |
| `Record` | `ConnectionRecord` | 可序列化边 `{From,To,FromPort,ToPort}` |
| `IsExporting` | bool | 参与导出 |
| `Parent` | `Node` | 所属节点 |
| `PortalState` | `PortalState` | `None`/`Consuming`/`Publishing`/`Portal` |
| `RenderIntent` | `RenderIntent`（internal） | 该端口的数据语义 |

* **observed** `PortType`：`In=1, Out=2, Primary=4, Required=8, Agnostic=0x10, Collapsed=0x20,
  PostProcess=0x40, CollapsedOut=0x22, CollapsedIN=0x21, PrimaryIn=5, PrimaryOut=0x46`
  （`Fx.Port.cs:266-279`）。`PrimaryOut = Out|Primary|PostProcess`，
  `inferred`：主输出在后处理阶段落盘（字符串池里确有 `"Unmodified"` 中间口）。
* **observed** `Port.IsConnected`（`:127-137`）：入端口看 `Connection?.Target?.Parent != null`；
  出端口**反查全图** `\uf55c\uf0ba\ue6d4.<Nodes>.Any(n => n.Ins.Any(y => y.Connection?.Target == this))`。
  ⇒ **出端口不存连接**。
* **observed** `Port.IsPrimary()/IsOut()/IsIn()` 用 `Type.HasFlag(<pool>(...))`，
  常量来自加密池，数值未知。

### 3.2 `Connection` / `ConnectionRecord`（observed，`Fx.Connection.cs`）

* `Connection { Port Target; Port Parent; }`，`GrandParent => Parent.Parent`，
  `TargetNode() => Target.Parent`，`TargetNodeId()`，`ParentId()`。
  ⇒ 边 = 源节点输出端口 `Parent` → 目标节点输入端口 `Target`。
* 存储位置：**目标节点入端口**的 `Port.Connection`（`[JsonIgnore]`）+ `Port.Record`。
  `Port.ShouldSerializeConnection() => Connection?.Target?.Parent != null`。
* `ConnectionRecord.IsValid` 检查 `\uf55c\uf0ba\ue6d4.<Nodes>.ContainsKey(From)` 与 `...ContainsKey(To)`。
* 全图边集合：`\uf55c\uf0ba\ue6d4.\uef4a\ue355\uf646()` 遍历所有节点 `Ins` 收集非空 `Connection`
  到 `HashSet<Connection>`（`_cls_E6D4.cs:78-94`）。

### 3.3 图容器

* **observed** 文档根对象 = `QuadSpinner.Gaea.Engine.Fx.Terrain`（`Fx.Terrain.cs`）：
  `Guid Id`、`Dictionary<int,Node> Nodes`、`Dictionary<int,Group> Groups`、
  `Dictionary<int,Note> Notes`、`List<GraphTab> GraphTabs`、`float Width/Height/SeaLevel`、
  `Float2 Location`、`List<Region> Regions`、`int PreviewResolution`、`int HDResolution`、
  `int SelectedNode`、`int SelectedTab`、`HashSet<int> NodeBookmarks`、`Viewport Viewport`、
  `int LockedNode`、`int UnderlayNode`、`bool GroupVariablesByNodes`。
* **observed** 静态访问器 `\uf55c\uf0ba\ue6d3.Terrain`（`_cls_E6D4.cs:66-76`）；
  `Nodes`/`Groups`/`Notes` 均以 **int Id** 为键；每个 Node/Group/Note 还有 `GraphIndex`
  （按标签页筛选，`_cls_E6D4.cs:137-156`）。
* **observed** `Node.In`/`Node.Out` = `Ports[0]`/`Ports[1]`（`Fx.Node.cs:432-436`）；
  `Ins`/`Outs`/`Exportables` 由 `Ports` 过滤（`:440-448`）。
* **observed** `Node._p` 是 **`Dictionary<string, Port>`**（`:198`），由 `Node.P` 惰性构建
  `_p ??= Ports.ToDictionary(x => x.Name, x => x)`（`:716`）。
  **它与参数无关**（更正早期版本"缓存参数值"的推断）。
* **observed** `Node()` 构造（`:852-880`）创建 2 个端口：`new Port("In"){Type=<pool>(5)}`、
  `new Port("Out"){Type=<pool>(103)}`；并对非 `Classification.Generator` 的节点
  执行 `In.Type |= <pool>(50)`（即 In 变为 Required）。按 `PortType` 定义，
  `inferred`：`<pool>(5) = PrimaryIn = 5`、`<pool>(50) = Required = 8`；
  `<pool>(103)` 无法从枚举推定（可能非 `PrimaryOut=0x46`），标为 unknown。

---

## 4. `Map` 数据结构

### 4.1 `QuadSpinner.Gaea.Engine.Fx.Map`（非泛型，`float` 通道）

**observed** 字段（`Fx.Map.cs:1094-1122`）：

```
public MapInfo Info = new MapInfo();
private Channel[] _channels;
private float[]? __firstChannelData;      // 通道 0 裸数组
private float[]? __rData, __gData, __bData;
private float[][]? __channelsData;        // 全部通道裸数组
private Channel? __rChannel, __gChannel, __bChannel;
private int _resolutionX, _resolutionY;
private _RGB? _rgb;
private bool _isDisposed;
private static readonly bool _useArrayPool;
```

**observed** 公开面：

| 成员 | 语义 |
| --- | --- |
| `this[int x,int y]` | `__firstChannelData[y*_resolutionX + x]` —— **行主序、y 行优先** |
| `this[int channel,int x,int y]` | `__channelsData[channel][y*_resolutionX + x]` |
| `this[int channel]` | `_channels[channel]` |
| `Data` | `__firstChannelData`（通道 0） |
| `NumberOfChannels` | `_channels.Length` |
| `R`/`G`/`B` | `__rChannel`/`__gChannel`/`__bChannel`（`inferred`：通道 0/1/2） |
| `Resolution` | `new Resolution(_resolutionX, _resolutionY)` |
| `IsDisposed` | `__firstChannelData == null` |
| `RGB` | `_rgb`（`Map._RGB`） |
| `Info` | `MapInfo`（**只有一个字段 `RenderIntent`**，`Fx.Map.cs:3540-3565`） |

* **observed** `Map.Channel`（嵌套类，`:14-60`）= `float[] _data` + `_resolutionX/_resolutionY`，
  `this[x,y]` → `_data[y*_resolutionX + x]`；有拷贝构造、`Resolution` 属性、`Data`；
  含 `InterpolateBilinear(Vector2[, EdgeBehaviour])`、`AtomicAdd(x,y,v)`、`ToArray()`。
* **observed** `Map` 构造 `Map(Resolution, int numberOfChannels = 1)` → 建 `Channel[]` → `InitUtilitaryRefs()`
  填充上述裸数组/通道缓存。
* **observed** 算子完备：一元 `+ -`，二元 `+ - * /`（Map×Map、Map×scalar、scalar×Map），
  `Add/Subtract/Multiply/Divide/Negate`、`Copy()`、`Clear()`、`ToInterleavedArray()`、
  `FromInterleavedArray()`、`CheckResolutionEquality`，以及一批
  `Process(...)` / `Generate(...)`（接受 `Func<...>` 的**并行分块**计算，闭包捕获 `chunkLength`）。
* **observed** `Map.Pool`（泛型版，静态 `allocated`/`returned` 计数）+ `_useArrayPool`
  （静态 ctor 设成 `<pool>(4) != 0`）⇒ 数组池化。
* **observed** `Map.ProcessContext`（struct）、`Map.Utils`（`CopyArray`、`CalculateChunks`）。

### 4.2 `` QuadSpinner.Gaea.Engine.Fx.Map`1 ``（泛型）

* **observed** `public class Map<DataType> : IDisposable`，结构与非泛型一致，元素类型换成 `DataType`
  （`__firstChannelData` → `DataType[]`）。嵌套 `<>c` 里出现
  `Vector <Add>b__57_0(Vector, Vector)` ⇒ 存在 `Map<Vector>` 之类实例化（`inferred`）。
* **observed** 这正是反编译工具里两者 `FullName` 相同、必须用 `ReflectionName`（`` Map`1 ``）区分的根因。

### 4.3 高度场 / mask / color 如何共存

* **observed** 三者**同一个 `Map` 类型**，靠 `MapInfo.RenderIntent` + 通道数区分：
  `Node.Commit(string portname, Map map, RenderIntent portintent)` 入库前写
  `map.Info.RenderIntent`（`Fx.Node.cs:1194-1208`）。
* **observed** 高度场/遮罩 = 单通道（`Map(res,1)`）；颜色 = 三通道且 `R/G/B` 快速引用；
  mask 在单通道上仅以 `RenderIntent = Mask` 区分。
* **observed** `Node.IsColor`：非 Generator 分类时比较 `Out.RenderIntent == <pool>(2)`；
  `Node.IsHeightfield` 结合 `RenderIntentOverride`、`Out.RenderIntent`、`Metadata.IsSoftData`
  （`:557-583`）。
* **observed** 缓存元数据显式记录 `Resolution` / `Channels` / `RenderIntent` / `Min` / `Max` / `GUID`
  （`MetaDictionary.cs:9-109`；默认 `Channels="1"`, `Resolution="-1"`, `RenderIntent="Default"`,
  `Min="0"`, `Max="1"`）。
* **observed** 通道**没有名字**——只有索引。`Accumulator`（端口上的字符串）才是"按语义选择某类输出"
  的机制，而不是通道名。`Map.Allocate/Return`、`MaxNumberOfChannels` 之类**不属于** `Map` 本体
  （早期版本表格把这些归给 `Map`，实为混淆类内部方法，见 §10）。

---

## 5. 参数存储与 nodes.json 映射

### 5.1 两个"字典"

| 成员 | 实际类型 | 作用 |
| --- | --- | --- |
| `Node.Props` | `Dictionary<string, PropertyInfo>`（`Fx.Node.cs:169,545`） | **参数名 → C# 属性** |
| `Node._p` | `Dictionary<string, Port>`（`:198`） | **端口名 → Port**，与参数无关 |

* **observed** `Props` 在 `Node` 构造函数里**未初始化**，`Gaea.Engine.dll` 内**无任何赋值点**
  （全文搜索 `.Props =` 无命中）。
  * `inferred`：由 UI/文档层扫描 `[Parameter]` 属性后填表；`unknown` 精确填充位置。
* **observed** `Node.Metadata`（`:601-614`）：`_metadata ??= Defaults.Metadata[GetType().Name] ?? null`
  ⇒ **`QuadSpinner.Gaea.Engine.Defaults.Metadata` 是 `Dictionary<string,NodeMetadata>`，
  以节点 C# 类名为键**。

### 5.2 `NodeMetadata`（每类节点元数据 + 原型实例）

* **observed** 只读字段：`MaxPorts`, `IsSoftData`, `IsHidden`, `Instance(Node)`, `Name`, `Type(Type)`,
  `Family`, `Toolbox(NodeCategory)`, `Classification`, `Keywords`, `ShortCode`, `SearchString`,
  `SearchWords`, `RequiresBaking`, `UsesAccumulation`, `HasCustomColorization`, `HasCustomUnderlay`,
  `CanCreatePorts`, `OrderedPorts`, `PreventPurge`；可变：`Description`, `FamilyIcon`, `Usage`,
  `SnapIns`, `AccumulationType`（`Fx.Node.cs:1542-1592`）。
* **observed** `NodeMetadata.Instance` = `[JsonIgnore] internal Node`，由
  `NodeMetadata.Create()` = `Activator.CreateInstance(Type) as Node` 产生（`:1781-1783`）。
* **observed** `Node.ToScript()`（`:1375-1398`）对每个 `[Parameter]` 属性，与
  `Metadata.Instance.<lookup>(propertyInfo.Name)` 比较，**不同才输出** `Name: value`。
  ⇒ 默认值来自"该类型原型实例的同名属性"。

### 5.3 `ParameterAttribute`（`QuadSpinner.Gaea.Engine.Fx`）

**observed**（`Fx.Parameter.cs`）：`[AttributeUsage(AttributeTargets.Property)] public sealed class ParameterAttribute`

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `Default` | object（只读） | 默认值 |
| `Min` / `Max` | float（可写） | 范围 |
| `IsVisible` | bool（默认 true） | → `Node.VisibilityTable[属性名]` |
| `IsEnabled` | bool（默认 true） | → `Node.EnableTable[属性名]` |
| `ParameterType` | `Parameters`（只读） | **控件/编辑器种类** |
| `IsUnbindable()` / `static Unbindable(Parameters)` | bool | 不可绑定变量 |

**observed** 构造重载：`()`, `(float defaultValue, float min=0, float max=1)`,
`(Parameters, float d1, float d2, min, max)`, `(float d1, float d2, min, max)`,
`(object defaultValue, min, max)`, `(Parameters, string icon)`, `(Parameters)`,
`(Parameters, object defaultValue, min, max)`。
其中"一对默认值"用 `new Float2(d1, d2)` ⇒ **Float2 型参数**；`(Parameters, string)` 的 `Default` 是图标名。

> **关键结论（observed）**：`ParameterAttribute` **没有名字字段**。
> ⇒ **参数名 = C# 属性名**；`nodes.json` 的键就是属性名。

### 5.4 值类型系统

* **observed** `QuadSpinner.Gaea.Engine.Fx.Parameters`（18 项）是**控件种类**：
  `Standard, Enum, Custom, Seed, NamedToggle, HorizontalList, HorizontalListNoLabel, OptionGrid,
  OptionsGridDehumanized, GradientEditor, Command, CommandButton, ComputedString, Range, RangeClipper,
  Folder, TextBox, Array`。
* **observed** **值类型由 CLR 属性类型决定**：`ParameterAttribute.Default` 覆盖 `float` / `Float2` /
  `object`（bool、枚举、Color、string 都走 `object` 重载）；
  `Node.GetPropertyParityString` 直接 `propertyInfo.GetValue(this).ToString()`。
* **observed** 值类型定义在 `Fx.Numeric.cs`：`Float2/Float3/Float4/FloatN/Int2/Int4/Byte3/Color/XRGBA/Resolution`。
* ⇒ 任务描述里的"Single/Int32/Boolean/EnumValue/Float2/Color/Byte/Command 类型系统"**不是一张引擎枚举**：
  值类型 = CLR 类型，`Command` / `CommandButton` 是 **`Parameters`（控件种类）** 的成员。
  （`docs/parameter-types.md` 由另一工作流负责，请以其中的逐节点清单为准。）

### 5.5 参数名 → 节点属性：完整链路

1. **observed** 节点实现（`Gaea.Nodes.dll`）的参数是**带 `[Parameter]` 的 C# 属性**。
2. **observed** 每类节点的**默认值**来自 `NodeMetadata.Instance`（原型 `Node` 实例）。
3. **observed** `QuadSpinner.Gaea.Engine.IO.ParameterAwareContractResolver : DefaultContractResolver`
   （`IO.cs:383-457`）重写 `CreateProperty`：凡属性上存在**类型名 == `"ParameterAttribute"`** 的
   Attribute，就令 `jsonProperty.DefaultValue =`
   * 声明类型 == `Node` 且 `Defaults.Metadata` 含该类型名 → `Defaults.Metadata[typeName].Instance.GetValue(prop)`
   * 否则 → `Activator.CreateInstance(declaringType).GetValue(prop)`
   ⇒ Newtonsoft 的默认值处理让**等于默认值的属性不写入 JSON**，`.gaea` / `nodes.json` 因此精简。
4. **observed** `Node.Props` 就是这张"名字 → PropertyInfo"表，供绑定/脚本使用。
5. **unknown** `nodes.json` 的物理位置与加载代码**不在** `Gaea.Engine.dll`；
   字符串池中存在 `\nodes.json`（`pool_strings.tsv` 索引 30954）与
   `Failed to parse JSON: `（索引 31217），说明该文件名确实存在。

### 5.6 可见性 / 使能表

* **observed** `Node.CreateVisibilityTable(PropertyInfo[] props = null)`（`:1011-1043`）：
  `VisibilityTable[属性名] = ParameterAttribute.IsVisible`；
  `EnableTable[属性名] = ParameterAttribute.IsEnabled`（两者都只在为 null 时构建一次）。

---

## 6. 生命周期：Build → Commit → PostBuild → Export

### 6.1 入口

* **observed** `\uf55c\uf0ba\ue6cb.\ue6f8\ue1a7\uefb5(Node, bool=false)`（`_cls_E6CB.cs:763-772`）：
  重置上下文；`bool=true` 时先对 node 调 `\uf072\uf1d6\uf6d1()`，再对**所有下游** `\ue6f8\ue1a7\uefb7(node)`；
  最后 `\ue6f8\ue1a7\uefb6(node, new BuildContext())`。
* **observed** `BuildContext`（struct）：`Resolution Resolution`、`CacheClusters Cluster`、`Bucket Tile`
  （`Fx.Build.cs:4-72`）；默认 ctor 用 `PreviewResolution`。

### 6.2 单节点闸门（observed，`:774-834`）

按 `node.StateOverride` 与 `node.State`：

* `StateOverride == <pool>(3)` → 不构建，`State = <pool>(5)`；非 UI 模式下 PostBuild / ExportBucketBin
* `State == IsBuilding` → 结果 `<pool>(5)`
* `State == Built` → 结果 `<pool>(3)`（**不重建**）
* `State == Unbuilt | Error` → **`\ue6f8\ue1a7\uf004(node)`：真正构建**

### 6.3 构建驱动 `\uf004(Node)`（`:2267-2470+`）—— 完整调用顺序

```
list = \uf003(node).Distinct()                        // 依赖序闭包
if State.Engine == <pool>(3):  return <pool>(2)        // 已取消
State.Engine = <pool>(4)
for item in list:
    if item.State == <pool>(6): continue               // 已完成
    if item.StateOverride == <pool>(4):                // 直通
        buildResult = <pool>(6); node.State = <pool>(5)
        if BuildMode == <pool>(4): PostBuild(true) 或 ExportBucketBin()
        continue
    item.LastError = ""
    if 取消条件: throw OperationCanceledException(<pool str 13943>)
    errors = \uf007(item)                                // 校验 → string[]
    if errors.Any(): throw NodeValidationException(...)
    if 取消条件: throw OperationCanceledException(...)
    \ue6f8\ue1a7\ueffc(item)                              // “生成中”事件
    if !\uf55c\uf0ba\ue6d3.\ue157\ueb2d\ue97c(): \ue6f8\ue1a7\uefb9(item)   // 变量绑定 (VarBinding)
    item.State = IsBuilding
    \uf55c\uf0ba\ue6d3.\ue157\ueb2d\ue955(item.Thumbprint)                   // 按 Thumbprint 清缓存
    从 cluster 缓存移除过期键 (<pool str 13697>)
    item.Touch()                                       // 新 Thumbprint
    item.BuildTime = <pool>(3)
    (计时器) item.StartJob();  item.Build();  (计时器)     // ← 节点实现，内部会 Commit(...)
    \ue6f8\ue1a7\uf006()
    item.State = Built
    if !\uf55c\uf0ba\ue6d4.<Nodes>.ContainsKey(item.Id): return <pool>(4)   // 构建中被删除
    if BuildMode == <pool>(4):
        if \uf55c\uf0ba\ue6d3.\ue157\ueb2d\ue95b(): item.PostBuild(true)
        else:                                item.ExportBucketBin()
异常：OperationCanceledException → 失效 + 结果<cancel>
      NodeValidationException   → 失效 + LastError + State=Error + 结果<fail>
      NodeFailedException       → 失效 + LastError + 结果<fail>
```

* **observed** `Node.Build()` 是 `internal virtual void Build() {}`（`Fx.Node.cs:1122-1124`），
  由 `Gaea.Nodes.dll` 覆写；**`Commit(...)` 由节点实现在 `Build()` 内部调用**，驱动不调。
* 同为 `internal virtual`（空实现或默认实现）：`UpdateUI`, `CopyTo`, `Reconstruct`, `CheckValidity`,
  `Migrate`, `AddNewPort`, `GetCustomColorMap`, `GetCustomUnderlay`, `GizmoModified`, `GizmoHit`,
  `Gizmo2DHit`, `ResetToDefaults`, `OnSaving`, `GetExportFilename`, `PostBuild`, `ExportBucketBin`,
  `Export`, `ToScript`（`Fx.Node.cs:882-1375`）。

### 6.4 提交与遮罩（observed，`:1165-1208`）

`Commit(Map map, bool allowMasking = true, bool clamp = true)`：

1. 若 `!Defaults.AllowValuesBeyondRange && clamp` → `\uf55c\uf0ba\ue6d5.\ueb77\uf21d\ue95c(map)`（钳制）
2. 若 `IsMaskable && allowMasking` 且 `"Mask"` 端口已连且 `In` 已连：
   ```
   mask = <Mask 端口的 Map>
   map  = In * (1 - mask) + map * mask
   ```
   （`1` 来自加密池，索引 11，`inferred` 为 `1.0f`）
3. 若 `Modifiers.Count > 0` → `Commit("Unmodified", map)` + `ApplyModifiers()`
   否则 → `Commit("Out", map)`

`Commit(string portname, Map map, RenderIntent portintent = Default)`：
`portintent == Default` 时取该端口 `RenderIntent`，否则取 `Out.RenderIntent`；
写 `map.Info.RenderIntent`；再 `\uf55c\uf0ba\ue6d3.\ue157\ueb2d\ue93a(Id, portname, map, ctx.Cluster)` 入缓存。

`ApplyModifiers()`（`:1136-1163`）：取缓存 `(Id, ctx.Cluster, "Unmodified")`；为空则把 `(Id,"Out")` 的
`Data.Copy()` 作为 `"Unmodified"` 提交后重取；无 `Modifiers` → `Commit("Out", cache.Data.Copy())`；
否则 `map = cache.Data.Copy()`，对 `Modifiers.OrderBy(m => m.Order)` 逐个 `map = m.Process(map.Copy())`，
最后 `Commit("Out", map)`。

### 6.5 PostBuild / Export（observed）

`PostBuild(bool export = true)`（`:1259-1333`）：

1. 若 `Defaults.Cache.OffloadBuildCache && ExportState == WontExport` →
   `\uf55c\uf0ba\ue6d3.\ue157\ueb2d\ue94a(<pool>(4))`（卸载缓存）
2. 若 `!export || \uf55c\uf0ba\ue6d9.\ue05d\uedfb\ue0c8(this)` → 返回
3. 对每个 `Exportables`：
   * 端口名后缀：`Out` 端口在 `Defaults.RemovePrimaryPortName` 时为空，否则 `Defaults.FilenameDelimiter + port.Name`
   * **单图**（`OutputType == SingleImage` 或 `Type == <pool>(50)`）：
     `Export(cache(Id,port).Data.Copy(), GetExportFilename(portName), port)`，
     外面包 `\uf55c\uf0ba\ue6cb.\ue6f8\ue1a7\uf001/\uf002`（导出前/后回调）
   * **分块**：`Transformer.<m>(map, x*TileResolution, y*TileResolution, ...)` 切块，
     可选 `TileVertexBorder.Expand(list, NumberOfTiles, <pool>(4))` 补边，
     再逐块 `GetExportFilename(portName, tile.TileSuffix(build.TilePattern))` + `Export(...)`
4. `ExportState = <pool>(3)`；若 `OffloadBuildCache` 再卸载一次。

`Export(Map, string filename, Port port = null, params object[] extraObjects)`（`:1368-1373`）：

```
map = \uf55c\uf0ba\ue6d5.\ueb77\uf21d\ue95c(map)            // 预处理（钳制/缩放）
map = \uf55c\uf0ba\ue6cb.\ue6f8\ue1a7\uefc4(map)            // 再变换
\uf55c\uf0ba\ue6cb.\ue6f8\ue1a7\uefc3(
    SaveDefinition?.Format ?? <pool>(39),             // FileFormats，默认 TIFF32
    Path.ChangeExtension(filename, null), map)        // 真正的写盘
```

`ExportBucketBin()`（`:1335-1366`）：对每个导出中的 Out 端口取缓存数据 → 钳制 → 变换 →
写 `<BucketDir>\{Id}_{Name}_{port.Name}_y{Bucket.Position.Y}_x{Bucket.Position.X}.bin`
（`BucketDir = \uf55c\uf0ba\ue6cb.\ueb20\uee69\uf029`），写入走 `\uf55c\uf0ba\ue6ec.<m>\uf7a8(path, map)`。
与字符串池恢复的瓦片命名模板 `_y%Y%_x%X%`（索引 22159）一致。

### 6.6 构建配置 `BuildDefinition`

* **observed** 26 字段 / 31 属性：`Type(BuildType)`, `Portion(WorldPortion)`, `Destination`,
  `OverwriteMode`, `Subdivision(HybridSubdivision)`, `Resolution`, `BakeResolution`, `TileResolution`,
  `BucketResolution`, `OutputType`, `NumberOfTiles`, `PreserveTiledCache`, `EdgeBlending`, `FlipY`,
  `OverlappingPixels`, `TilePadDigits`, `TileZeroIndex`, `TilePattern`, `OrganizeFiles`,
  `PersistOnSave`, `MaintainPrimeFolder`, `PostBuildScript`, `OpenFolder`, `CopyTerrain`,
  `RemovePrimaryPortName`, `ColorSpace(Colorspace)`。
* **observed** `[JsonIgnore]` 派生量：`BucketCount = Resolution / BucketResolution`；
  `WorldResolution`（`Type == <pool>(6)` 即分块时 `NumberOfTiles * TileResolution`）；
  `TotalTiles = NumberOfTiles * NumberOfTiles`；
  `BucketSizeWithMargin = BucketResolution + EdgeSize * <pool>(3)`；
  `EdgeSize = (int)(BucketResolution * EdgeBlending)`。
* **observed** `BuildType { Standard = 1, Hybrid = 2, Tiled = 4, Region = 8 }`。
* **observed** `BuildMode`（`QuadSpinner.Gaea.BuildMode`）用于 `BuildMode.UI` 分支；
  `BuildResult` / `BuildResolution` 为枚举，**数值在加密池中**。
* 早期版本对 `BuildDefinition` 的字段列举正确；但**全部默认数值无法从文本读出**。

---

## 7. 缓存与缓存键

* **observed** `QuadSpinner.Gaea.Engine.Fx.Cache`（`IDisposable`）字段：
  `IsStale`, `Thumbprint(Guid)`, `Node(int)`, `Port(string)`, `State(CacheState)`,
  `Cluster(CacheClusters)`, `_data(Map)`, `LastAccess(DateTime)`。
* **observed** `CacheState { Loaded, Offloaded, Empty }`；
  `CacheClusters { Progressive, Primary, Bakes, HD }`。
* **observed** `Cache.Filename`（`Fx.Cache.cs:103-121`）=
  ```
  $"{Cluster}\{<cacheFolder>}_{<project>.Id}\{Node}_{Port}.bin"
  ```
  ⇒ **`<集群>\<目录>_<工程Id>\<节点Id>_<端口名>.bin`**。
* **observed** `Cache.Data` getter：`State == <pool>(4)` 且节点 `StateOverride == <pool>(3)` 时返回 null，
  否则 `Reload(true)`。setter 按 `_data == null` 把 `State` 设为 `<pool>(1)`/`<pool>(3)`。
* **observed** `Cache.Offload()`：写 `.bin` + `.meta`（`GUID = Thumbprint.ToString("N")`），释放 `_data`，
  `State = <pool>(4)`。
* **observed** `Cache.IsDifferentFromDisk()`：`.meta` 的 `GUID != Thumbprint` 即不同。
* **observed** `Cache.Reload(bool deleteCache = true)`：读 `(Map, MetaDictionary)`；回写
  `port.RenderIntent = map.Info.RenderIntent`、`node.Thumbprint = meta.Guid`；
  `Cluster == <pool>(4)` 时删文件。
* **observed** `Cache.GetBakedMap()` → `(Map, MetaDictionary)?`；
  `CacheCollection : Dictionary<string,Cache>` + `CacheId(Guid)`；
  `CacheEventArgs{NodeId, PortName}`；`Cache.MarkStale(bool dispose = true)`。
* **observed** `CacheKeyBuilder.GetHash(object)`（`Util.CacheKey.cs`）：
  1. 取该类型**所有带 `[CacheKey]`（`CacheKeyAttribute`，`AttributeTargets.Property`）、可读、无索引参数**
     的属性；
  2. 按**属性名 `StringComparer.Ordinal`** 排序（`ConcurrentDictionary<Type,PropertyInfo[]>` 缓存）；
  3. `HashCode.Add(type)` 起头，依次 `Add` 每个属性值；`float` 先 `MathF.Round(x, 4)`，
     `double` 先 `Math.Round(x, 6)`；返回 `hashCode.ToHashCode()`（`int`）。
  ⇒ **让某参数参与缓存键 = 给它打 `[CacheKey]`**；浮点按 4/6 位小数归并。
* **observed** `CacheOptions { SmartCache, AlwaysSaveCache, NodeIdleThreshold, OffloadBuildCache }`；
  `[DefaultValue(600)]` 给出 `NodeIdleThreshold` 默认 600（`Engine.CacheMisc.cs:50`）——
  这是少数**能直接读到数值**的默认值（因为特性参数未被搬进池）。
* **observed** `CacheLocation { Portable, Central }`；
  `QuadSpinner.Gaea.CacheOperation` 为枚举。
* **observed** 缓存门面 `\uf55c\uf0ba\ue6d3`（`_cls_E6D3.cs`）：
  `\ue93a(nodeId, port, map, cluster)` 写入、`\ue93d(nodeId, cluster, port="Out")` 取 Cache、
  `\ue93e(nodeId, port="Out")` 取默认集群、`\ue93f/\ue952` 取 `CacheCollection`、
  `\ue941/\ue942/\ue949/\ue94a` 清理与卸载、`\ue953/\ue954/\ue955` 以 `Guid` 存取二进制、
  `\ue93b(nodeId, cluster)` 返回 `long`（字节数，`inferred`）。

---

## 8. 序列化

* **observed** `Node.OnSaving()` 是 `internal virtual` 空实现（`:1250-1252`）。
* **observed** `Node.SaveDefinitions`（`List<SaveDefinition>`）与 `Node.SaveDefinition`（单个）。
  `SaveDefinition`（`Fx.Misc.cs`）：
  `Node:int`, `Filename:string`, `Format:FileFormats = TIFF32`, `IsEnabled:bool = true`,
  `DisabledInProfiles:List<string>`；主构造
  `SaveDefinition(int node, string filename, FileFormats format = FileFormats.TIFF32, bool enabled = true)`。
* **observed** `Node.ShouldSerializeThumbprint()`（`:1079-1082`）条件序列化 `Thumbprint`；
  `Port.ShouldSerializeConnection()` 条件序列化连接。
* **observed** 边序列化为 `ConnectionRecord{From,To,FromPort,ToPort}`，`IsValid` 校验节点存在。
* **observed** `Node.Migrate()`（`:1075-1077`）、`Reconstruct()`（`:890-892`）、`CopyTo(Node)`（`:886-888`）、
  `UpdateUI()`（`:882-884`）、`ResetToDefaults()`（`:1246-1248`）都是 `internal virtual` 空实现
  —— 版本迁移/重建由 `Gaea.Nodes.dll` 覆写；`Node.Version` 字段参与版本判定。
* **observed** 文档根对象 = `Fx.Terrain`（§3.3）。
* **inferred** `.gaea` 为 Newtonsoft JSON：证据是 `ParameterAwareContractResolver`
  （Newtonsoft `DefaultContractResolver` 子类）、`IO.JsonOptions` 枚举、`MetaDictionary` 的 JSON 读写、
  `[Serializable]` + `[JsonIgnore]` 遍布模型。
  **unknown**：容器/文件头的具体写出代码与格式（写出器不在 `Gaea.Engine.dll`）。
* **observed** 关键副作用：`ParameterAwareContractResolver` 把默认值写进 `JsonProperty.DefaultValue`
  ⇒ **与默认值相同的参数不会出现在 JSON 里**；反序列化缺失键时会回落默认值。

---

## 9. 渲染意图 `RenderIntent`

* **observed**（`Fx.RenderIntent.cs`）：
  ```csharp
  public enum RenderIntent {
      [Description("Heightfield")] Default,   // 0
      Heightfield,                            // 1
      Mask,                                   // 2
      Color,                                  // 3
      Raw                                     // 4
  }
  ```
  成员没有显式初始化器 ⇒ 取值 0..4（**observed**：`PortType` 那种非连续枚举反编译器会打印数值，
  这里没有）。`Default` 带 `[Description("Heightfield")]`，即默认按高度场处理。
* **observed** `Node.SetIntent(RenderIntent intent, bool main = true)`：`main` 写 `Out.RenderIntent`，
  否则写所有**非主** Out 端口（`:1099-1115`）。
* **observed** `Node.RenderAsHeightfield()` → `SetIntent(<pool>(4))`；`RenderAsMask()` → `SetIntent(<pool>(3))`；
  `RenderAsColor()` → `SetIntent(<pool>(2))`（`:1084-1097`）。常量来自加密池，**数值未知**；
  按语义 `inferred` 对应 `Heightfield/Mask/Color`。
* **observed** `MapInfo.RenderIntent` 随 `Commit` 写入，随 `Cache.Reload` 回填 `port.RenderIntent`。
* **observed** `MetaDictionary["RenderIntent"]` 默认 `"Default"`，以**枚举名字符串**持久化
  （`MetaDictionary.cs:106`）——缓存元数据用名字，不用数值。
* **observed** `Node.RenderIntentOverride` 是保存到工程的覆盖值；`IsHeightfield`/`IsColor` 两者并用。
* **observed** 无 `Flow` 成员：任务描述里的 "flow" 属于**算法/内核层**（`SyclFunctions.Flow`），
  不是 `RenderIntent` 的取值。

---

## 10. 对早期版本的更正

早期 `docs/engine-model.md`（由并行工作流/更早一轮产出）与本轮实测冲突之处：

| 早期说法 | 实测结论 |
| --- | --- |
| "not obfuscated, decompiles cleanly" | 公开 API 名完好，但 internal/private 名混淆、**全部数值与多数字符串加密**（§0） |
| "order the graph — `BuildOrder` (topological)" | `BuildOrder` 无写入点；顺序来自 `Ins→Connection→Target→Parent` 的后序 DFS（§2.1/2.2） |
| `Node._p` = "cached parameter values" | `_p` 是 `Dictionary<string,Port>`（端口表）；参数表是 `Props`（§5.1） |
| `Map` 的通道有名字（height/mask/colour/flow） | 通道**没有名字**，只有索引；语义靠 `RenderIntent` + `Accumulator`（§4.3） |
| `Map.Allocate/Return`、`MaxNumberOfChannels`、`CalculateEpsilon/SafeRatio/AlmostEqual` 属于 `Map` | 这些是混淆辅助类的成员/`Map.Utils`，不是 `Map` 的属性（§4.1） |
| `UpdateParity()` "if the new parity matches, reuse" | 语义正确，但**返回值为 true 表示未变化**，调用方需取反（§2.3） |
| `.gaea` 存 "parameter dictionaries" | 存的是节点对象属性；**与默认值相同的参数被省略**（§8） |

仍成立并予以保留的早期证据：`MultiFractal.Build()` 的调用形状（节点实现里
`Commit(map, true, true)`）、`PortType` 标志表、门户（`PortalState`）语义、以及
"分块 + 重叠 + 边缘融合是架构级事实"的判断。

---

## 11. 缺口（GAPS）

1. **整型/浮点常量池未还原**（资源 `ZyPox`，1304 B，`flags=0x01`）。影响所有默认数值与枚举数值。
   下一步建议二选一：
   (a) 把 `\uf55c\uf0ba\ue729` 内嵌 inflater（`\ue347`/`\ue348`/`\ue349`）的 IL 与 .NET
       `System.IO.Compression.Inflater` 对照，找出其压缩变体；
   (b) 补齐缺失的 `Babel.Licensing 11.7.0.0`（`Assembly.LoadFrom` 因它失败）后运行
       `tools/GaeaPoolReflect`（**已写好**：用反射驱动目标自身的池加载器，直接读私有数组/字典）。
2. `Node.Props` 的填充点不在 `Gaea.Engine.dll`。
3. `nodes.json` 的物理位置与解析代码不在 `Gaea.Engine.dll`。
4. `.gaea` 的容器/写出代码不在 `Gaea.Engine.dll`（`Sophia` 是网格生成器，见 `engine-dataformats.md`）。
5. `\uf55c\uf0ba\ue6d9.\ue05d\uedfb\ue0c8(node)`（PostBuild 早退条件）只知其签名。
6. `<pool>(103)`（默认 Out 端口 `PortType`）与若干池常量的具体数值。
7. `Node.r1`–`r4`、`Node.Purge`、`Node.NearestHeightfield`、`Node.SeedMemory` 的完整语义。

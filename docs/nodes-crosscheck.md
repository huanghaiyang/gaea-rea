# Nodes.json 与 Gaea.Nodes.dll 交叉核对报告

对照双方：

- 声明侧：`D:\Gaea 2\Resources\Nodes.json`（UTF-8，420,649 字节，182 个节点，1341 个顶层条目）
- 实现侧：`D:\Gaea 2\Gaea.Nodes.dll`（799,224 字节，694 个类型；622 个位于 `QuadSpinner.*` 命名空间）
- 特性定义侧：`D:\Gaea 2\Gaea.Engine.dll`（`QuadSpinner.Gaea.Engine.Fx`）

## 一、总量

| 指标 | 数值 |
|---|---|
| 节点数 | 182 |
| 找到实现类的节点 | 182 / 182（100%） |
| Nodes.json 顶层条目 | 1341 |
| 其中真实参数（叶子） | 1215 |
| 其中 UI 分组标题 | 126 |
| 实现属性总数 | 1238 |
| 参数→属性 已配对 | 1209 / 1215（99.51%） |
| 参数无对应属性 | 6 |
| 属性未被 Nodes.json 引用 | 29 |

## 二、实现类解析方法

1. 以节点名在 `Gaea.Nodes.dll` 中按简单类名（大小写不敏感、去除非字母数字后）匹配候选。
2. 要求候选类带有 `[Toolbox(NodeCategory...)]`。

结果：197 个原始候选中，**恰好 182 个带 `[Toolbox]`**，与 Nodes.json 的 182 个节点数量完全吻合；
每个节点名解析出的带 `[Toolbox]` 候选都是唯一的，歧义为 0。

初始的 14 个歧义名全部由 `[Toolbox]` 判定解决：

| 节点名 | 候选 | 选用 | 落选者 |
|---|---|---|---|
| `Autolevel` | 2 | `QuadSpinner.Gaea.Nodes.Autolevel` | `QuadSpinner.Gaea.Nodes.Modifiers.Autolevel` |
| `Blur` | 2 | `QuadSpinner.Gaea.Nodes.Blur` | `QuadSpinner.Gaea.Nodes.Modifiers.Blur` |
| `Cellular3D` | 2 | `QuadSpinner.Gaea.Nodes.Cellular3D` | `QuadSpinner.Gaea.Nodes.Core.Cellular3D` |
| `Clamp` | 2 | `QuadSpinner.Gaea.Nodes.Clamp` | `QuadSpinner.Gaea.Nodes.Modifiers.Clamp` |
| `Clip` | 2 | `QuadSpinner.Gaea.Nodes.Clip` | `QuadSpinner.Gaea.Nodes.Modifiers.Clip` |
| `Crater` | 3 | `QuadSpinner.Gaea.Nodes.Crater` | `QuadSpinner.Gaea.Nodes.Core.Crater`, `QuadSpinner.Gaea.Nodes.Core.CraterfieldGenerator.Crater` |
| `Equalize` | 2 | `QuadSpinner.Gaea.Nodes.Equalize` | `QuadSpinner.Gaea.Nodes.Modifiers.Equalize` |
| `FractalTerraces` | 2 | `QuadSpinner.Gaea.Nodes.FractalTerraces` | `QuadSpinner.Gaea.Nodes.Core.FractalTerraces` |
| `Height` | 2 | `QuadSpinner.Gaea.Nodes.Height` | `QuadSpinner.Gaea.Nodes.Modifiers.Height` |
| `Shaper` | 2 | `QuadSpinner.Gaea.Nodes.Shaper` | `QuadSpinner.Gaea.Nodes.Modifiers.Shaper` |
| `Slope` | 2 | `QuadSpinner.Gaea.Nodes.Slope` | `QuadSpinner.Gaea.Nodes.Modifiers.Slope` |
| `SlopeBlur` | 2 | `QuadSpinner.Gaea.Nodes.SlopeBlur` | `QuadSpinner.Gaea.Nodes.Core.SlopeBlur` |
| `Threshold` | 2 | `QuadSpinner.Gaea.Nodes.Threshold` | `QuadSpinner.Gaea.Nodes.Modifiers.Threshold` |
| `Warp` | 2 | `QuadSpinner.Gaea.Nodes.Warp` | `QuadSpinner.Gaea.Nodes.Modifiers.Warp` |

落选者均为 `QuadSpinner.Gaea.Nodes.Modifiers.*`（`Modifier` 基类的内部处理单元，无 `[Toolbox]`）
或 `QuadSpinner.Gaea.Nodes.Core.*`（供其它节点复用的核心算法类）。
因此**"带 `[Toolbox]`"是节点类与内部算法类的可靠判别式**。

## 三、参数→属性配对

Nodes.json **不记录** C# 属性名，只记录显示名。配对按以下由强到弱的层级进行，
每一层的结果都记在 `nodes-catalog.json` 的 `implProperty.tier` 里：

| 层级 | 规则 | 命中数 |
|---|---|---|
| `norm-display+group` | 归一化显示名 + UI 分组（消歧主力） | 1195 |
| `norm-display` | 仅归一化显示名相同 | 8 |
| `—` | 未配对 | 6 |
| `norm-display+group+ordinal` | 归一化显示名 + 分组 + 同组内序号 | 3 |
| `exact-name` | C# 属性名与 Nodes.json 名完全相同 | 3 |

归一化规则：去掉所有非字母数字字符并转小写。这一层是必要的，因为：

```
Nodes.json "Scale X"     ↔  C# float ScaleX
Nodes.json "Offset Y"    ↔  C# float OffsetY
Nodes.json "LOD Info"    ↔  C# string LODInfo
Nodes.json "Sediment Removal" ↔ C# float SedimentRemoval
Nodes.json "Vertices Count"   ↔ C# int VerticesCount
```

分组消歧的例子：`MultiFractal` 的 `FractalGain` 与 `WarpRoughness` 显示名都是 `Roughness`，
Nodes.json 里也有两个 `Roughness`（分属 `Fractal` 与 `Warp`），靠分组一一对应。

## 四、发现的不一致

### 4.1 Nodes.json 有、程序集没有的条目（6 个）

| 节点 | 参数 | 类型 | Nodes.json 分组 | 说明 |
|---|---|---|---|---|
| `ColorErosion` | `Version` | Enum | — | （无说明） |
| `ColorErosion` | `Q 0` | Boolean | — | （无说明） |
| `ColorErosion` | `Q 1` | Boolean | — | （无说明） |
| `Erosion2` | `ExtraDepositionBoost` | Single | Sediment Discharge | （无说明） |
| `Lake` | `Accuracy` | Enum | Simple Mode | The accuracy of the water placement and water containment within depressions. |
| `Wizard2` | `Convert` | Command | Advanced | （无说明） |

逐条分析：

- **`ColorErosion` / `Version`（Enum）、`Q 0`、`Q 1`（Boolean）**：该类的属性只有 `Ver`（类型显示为 `enum`，被混淆）与 8 个模拟参数，**没有 `Q0`/`Q1`**。
  `Version` 很可能对应混淆后名为 `Ver` 的属性，但成员名不匹配、类型也不匹配（枚举 vs 布尔），本库不强行配对。
- **`Erosion2` / `ExtraDepositionBoost`（Single）**：该类只有 `DepositionBoost`，没有 `ExtraDepositionBoost`。疑为 Nodes.json 中的历史遗留条目。
- **`Lake` / `Accuracy`（Enum，分组 `Simple Mode`）**：该类无 `Accuracy` 属性，也无 `Simple Mode` 分组。
- **`Wizard2` / `Convert`（Command，分组 `Advanced`）**：该类无 `Advanced` 分组、无对应属性。全部 20 个 `Command` 参数中仅此 1 个未能配对（其余 19 个都对应到 `[Parameter(Parameters.Command, ...)]` 的布尔属性）。

**结论**：这 6 个条目在 `Gaea.Nodes.dll` 2.3.1 中没有实现。可能是 Nodes.json 版本略新，或这些是编辑器侧动态注入的条目。它们可在 `nodes-catalog.json` 中通过 `implProperty.match == "no-matching-property"` 精确定位。

### 4.2 程序集有、Nodes.json 未列的属性（29 个）

| 节点 | 属性 | C# 类型 | 有 `[Parameter]` | 解释 |
|---|---|---|---|---|
| `Bomber` | `PortCount` | `int` | 否 | 供 `AddNewPort()` 计数的内部状态 |
| `ColorErosion` | `Ver` | `enum` | 否 | 被混淆的版本枚举 |
| `Combine` | `PortCount` | `int` | 否 | 供 `AddNewPort()` 计数的内部状态 |
| `Compare` | `CompareMode` | `enum` | 否 | 被混淆的内部枚举 |
| `Compare` | `Mode` | `CompareMode` | 是 | 内部或未在 Nodes.json 暴露 |
| `DotNoise` | `DotNoiseStyle` | `enum` | 否 | 被混淆的内部枚举 |
| `Layers` | `PortCount` | `int` | 否 | 供 `AddNewPort()` 计数的内部状态 |
| `LoopEnd` | `LoopInProgress` | `bool` | 否 | 循环节点运行时状态 |
| `Mixer` | `PortCount` | `int` | 否 | 供 `AddNewPort()` 计数的内部状态 |
| `Mixer` | `Layer1` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer2` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer3` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer4` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer5` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer6` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer7` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer8` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer9` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer10` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer11` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer12` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer13` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer14` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `Mixer` | `Layer15` | `BlendLayer` | 否 | 图层次结构内部字段 |
| `SatMap` | `Data` | `List<Float4>` | 否 | 内部数据缓冲 |
| `SuperColor` | `Data` | `List<Float4>` | 否 | 内部数据缓冲 |
| `TextureBaker` | `PortCount` | `int` | 否 | 供 `AddNewPort()` 计数的内部状态 |
| `Unity` | `PortCount` | `int` | 否 | 供 `AddNewPort()` 计数的内部状态 |
| `Unreal` | `PortCount` | `int` | 否 | 供 `AddNewPort()` 计数的内部状态 |

分类：

- **内部状态属性（无 `[Parameter]`）**：`PortCount`（7 个节点，供 `AddNewPort` 使用）、`Data`（`List<Float4>`，2 个节点）、`LoopInProgress`、`CompareMode`、`DotNoiseStyle`、`Ver`、以及 `Layer1`…`Layer15`（`BlendLayer`，属 `Layers`/`Mixer` 系的图层次结构）。这些**本就不该出现在参数列表中**，是 JSON 与实现一致的表现。
- **带 `[Parameter]` 但未列出**：如 `Layers` 的 `Mode`、`Compare` 的 `Mode`。说明 Nodes.json 与实现属性集**不是简单相等关系**，Nodes.json 侧重编辑器暴露面。

### 4.3 分组一致性

- Nodes.json 分组标题 126 个，其中 122 个能在同类中找到同名 `[Group]` 特性。
- 反向差异：程序集有 `[Group]` 而 Nodes.json 无对应标题的共 0 个。

## 五、枚举一致性

对每个 `Type == "Enum"` 的参数，比较 Nodes.json 的 `EnumValue` 子项数与程序集枚举类型的字段数。

- 已解析出枚举类型的枚举参数：171 个
- 成员数一致：171 个
- 成员数不一致：0 个

## 六、未能解决的缺口

1. **端口（portHint）方向无法静态确定。** `Gaea.Nodes.dll` 中所有端口类型写作 `new Port(this, <obfuscated string>) { Type = (PortType)\ue0003.\ue000(N) }`，`PortType` 取值与端口名都来自混淆器常量表。
   本库只能给出：
   - 基类 `QuadSpinner.Gaea.Engine.Fx.Node` 提供 `In` / `Out` / `Ins[]` / `Outs[]` / `Ports`，故每个节点至少有 1 入 1 出；
   - 构造器中 `Ports.Add(...)` 的调用次数即**额外**端口数；
   - `[CanCreatePorts(n)]` + 覆写 `AddNewPort()` 表示可变端口（如 `Combine`：`[CanCreatePorts(10)]`）。
   方向、端口名、以及 `Build()` 中动态增删的端口均未确定。
2. **部分默认值不可读。** 字段初始化器形如 `= \ue0003.\ue002(93)`，是加密常量表查询；只有写在 `[Parameter(...)]` 里的默认值可读（29 个节点全部属性中可读者 1036 个）。常量表位于程序集内嵌资源，由 `\ue0002`（字符串表）/`\ue0003`（数值表）在静态构造器中解密读取，本次未解密。
3. **节点分类只有 10 类，没有 Hydrology/Mask/Filter 等更细的类目。**
   程序集里唯一的分类来源是 `[Toolbox(NodeCategory.X)]`，`NodeCategory` 只有 `Primitive, Terrain, Modify, Surface, Simulate, Derive, Colorize, Output, Utility, Macro` 十个值。
   任何更细的归类（如"水文""遮罩"）都只能是推断，本库有意不写进 `category`，以免把推断当事实。
4. **`ColorErosion.Ver` 的真实枚举类型不可读**（反射给出 `enum`），其成员与值未知。
5. **`Gaea.Nodes.dll` 的 `Build()` 算法体未逐节点分析。** 本库只做参数/属性/分类的规范映射；算法语义需另行反编译 `Build()`，且其调用链大量经过被混淆的类型。


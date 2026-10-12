# Gaea 2.3.1 主流程：打开工程 → 构建 → 缓存 → 导出

目标：`D:\Gaea 2\Gaea.Engine.dll`（Gaea 2.3.1，.NET 8）。
本文只描述**引擎内核**；UI/文档层（`Gaea.dll`）与节点实现（`Gaea.Nodes.dll`）在图中以虚线标出。

> 标注：**observed** = 反编译代码直接可见；**inferred** = 推理；**unknown** = 未能确定。
> 证据引用形如 `Type.Member` 或 `文件:行`。混淆类保留 `\uf55c\uf0ba\ue6xx` 原名。
> 与图执行模型配套阅读：`docs/engine-model.md`；二进制布局见 `docs/engine-dataformats.md`。

---

## 0. 总览

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  进程内静态状态                                                              │
│    QuadSpinner.Gaea.Engine.Fx.Terrain        当前工程（Nodes/Groups/Notes）   │
│      \uf55c\uf0ba\ue6d3.Terrain  ← 访问器            [observed E6D4:66-76]     │
│    QuadSpinner.Gaea.Engine.Defaults          全局默认（含 Metadata 注册表）   │
│      \uf55c\uf0ba\ue6d0.Metadata[类型名] → NodeMetadata   [observed Node:608]  │
│    \uf55c\uf0ba\ue6cb.\ueb20\uee69\uf028    当前 BuildContext / WorldPortion   │
│    \uf55c\uf0ba\ue6cb.\ueb20\uee69\uf029    Bucket 输出目录                     │
│    Cache 集合（按 CacheClusters 分 4 个集群）                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. 打开工程

```
.gaea (JSON, inferred §engine-model.md:8)
   │
   │  Newtonsoft.Json 反序列化
   │  ┌────────────────────────────────────────────────────────────┐
   │  │ ParameterAwareContractResolver : DefaultContractResolver   │
   │  │   observed  IO.cs:383-457                                  │
   │  │   对每个带 [Parameter] 的属性设 jsonProperty.DefaultValue  │
   │  │     = Defaults.Metadata[typeName].Instance.GetValue(prop)  │
   │  │       或 Activator.CreateInstance(declaringType).GetValue  │
   │  │   ⇒ JSON 里“等于默认值”的键被省略；缺失键回落默认值         │
   │  └────────────────────────────────────────────────────────────┘
   ▼
Terrain { Nodes:Dictionary<int,Node>, Groups, Notes, Regions, GraphTabs,
          Width/Height/SeaLevel/Location, PreviewResolution, HDResolution,
          Viewport, NodeBookmarks, LockedNode, UnderlayNode }
   │                                          observed Fx.Terrain.cs
   ▼
每个 Node 反序列化后：
   ├─ Port.Record (ConnectionRecord{From,To,FromPort,ToPort}) → Port.Connection 重建
   │        observed Fx.Connection.cs ; IsValid 校验两端 Id 在 Nodes 中
   ├─ Node.Reconstruct()      internal virtual，节点实现覆写   observed Node:890
   ├─ Node.Migrate()          internal virtual，版本升级       observed Node:1075
   ├─ Node.UpdateUI()         internal virtual                 observed Node:882
   └─ Node.CreateVisibilityTable()                             observed Node:1011
        VisibilityTable[属性名] = ParameterAttribute.IsVisible
        EnableTable[属性名]     = ParameterAttribute.IsEnabled
   │
   ▼
NodeMetadata 惰性绑定： Node.Metadata
        _metadata ??= Defaults.Metadata[GetType().Name] ?? null
                                                        observed Node:601-614
   ⇒ 默认值来自 NodeMetadata.Instance（该类型的原型 Node 实例）
                                                        observed NodeMetadata.Create()
        （节点参数清单另见 docs/nodes-reference.md / docs/parameter-types.md）
```

**observed** 未在 `Gaea.Engine.dll` 内出现的东西（推测由 UI/文档层完成）：
`Node.Props`（名字→`PropertyInfo`）的填充、`nodes.json` 目录的读取、图标签页/视图状态恢复。

---

## 2. 构建（Build）

### 2.1 触发与顺序

```
用户点 Build
   │
   ▼
\uf55c\uf0ba\ue6cb.\ue6f8\ue1a7\uefb5(node, bool invalidateDependents=false)
                                    observed _cls_E6CB.cs:763-772
   ├─ if invalidateDependents:
   │     node.失效()                              \uf072\uf1d6\uf6d1()
   │     \ue6f8\ue1a7\uefb7(node)                 对**全部下游**逐个失效
   │            ← 下游集合由 \ueffb(node) 得到（Stack 遍历全图）  :2183-2218
   └─ \ue6f8\ue1a7\uefb6(node, new BuildContext())
                                    observed :774-834
        StateOverride / State 闸门：
          Built        → 直接返回（不重建）           <pool>(3)
          IsBuilding   → 返回“忙”                     <pool>(5)
          Unbuilt/Error→ \uf004(node)  ← 真正构建
          StateOverride 直通 → 跳过
```

### 2.2 依赖序（拓扑）

```
\ue6f8\ue1a7\ueff5(Node)  →  \ueff6(node, list, ref visited)
                                        observed _cls_E6CB.cs:2093-2125
   DFS 后序：
     对 node.Ins[i].Connection?.Target?.Parent 递归
     递归返回后把 node 追加到 list
     visited 用 HashSet<Node> 去重（多路汇聚 / 环安全）
   ⇒ list 为“依赖在前”的拓扑序

\ue6f8\ue1a7\uf003(Node) → list（构建驱动使用的集合）  :2258-2265
\uf004(node) 内再 .Distinct()                          :2275

注意：Node.BuildOrder **未参与**；用于哈希的全局序是 Id（.OrderBy(x => x.Id)）
                                        observed :2166 / :2176
```

### 2.3 单节点构建循环（`\uf004(Node)`，observed `_cls_E6CB.cs:2267-2470+`）

```
for item in list:                              # 依赖序
  │
  ├─ item.State == 已完成(<pool>6) ─────────────────────────────► continue
  │
  ├─ item.StateOverride 直通(<pool>4)
  │     buildResult = <pool>(6); node.State = <pool>(5)
  │     if BuildMode == <pool>(4):  PostBuild(true) / ExportBucketBin()
  │     ─────────────────────────────────────────────────────────► continue
  │
  ├─ item.LastError = ""
  ├─ 取消检查?  → throw OperationCanceledException(<pool str 13943>)
  ├─ errors = \uf007(item)                  # 校验 → string[]
  ├─ errors.Any()? → throw NodeValidationException(joined)
  ├─ 取消检查?
  ├─ \ue6f8\ue1a7\ueffc(item)                 # 抛“生成中”事件
  ├─ if !\uf55c\uf0ba\ue6d3.\ue157\ueb2d\ue97c(): \ue6f8\ue1a7\uefb9(item)
  │        # 变量绑定（VarBinding[] / QuadSpinner.Gaea.Engine.Fx.Variable）
  ├─ item.State = IsBuilding
  ├─ \uf55c\uf0ba\ue6d3.\ue157\ueb2d\ue955(item.Thumbprint)   # 按 Thumbprint 清缓存
  ├─ 从集群缓存移除过期键 (<pool str 13697>)
  ├─ item.Touch()                                # Thumbprint = new Guid
  ├─ item.BuildTime = <pool>(3)
  ├─ 计时器重启; item.StartJob();
  ├─ item.Build()   ◄──────────── 节点实现（Gaea.Nodes.dll）
  │        │
  │        │  节点内部典型形状（observed，MultiFractal.Build）：
  │        │     map = Noises.MultiFractal(context.Resolution, ...params);
  │        │     if (In.IsConnected) map *= In.<读入 Map>();
  │        │     Commit(map, true, true);
  │        │
  │        └─► Commit(Map, allowMasking=true, clamp=true)   Node:1165
  │              1) 钳制（除非 Defaults.AllowValuesBeyondRange）
  │              2) 若 IsMaskable && "Mask" 已连 && In 已连：
  │                     map = In*(1-mask) + map*mask
  │              3) Modifiers.Count > 0 ?
  │                     是 → Commit("Unmodified", map) + ApplyModifiers()
  │                     否 → Commit("Out", map)
  │
  │            Commit(string portname, Map map, RenderIntent intent)  Node:1194
  │              map.Info.RenderIntent = 端口/Out 的 RenderIntent
  │              \uf55c\uf0ba\ue6d3.\ue157\ueb2d\ue93a(Id, portname, map, ctx.Cluster)
  │                 └─► 写入集群缓存（内存 Map；必要时 Offload 落盘）
  │
  ├─ 计时器停止; \ue6f8\ue1a7\uf006()
  ├─ item.State = Built
  ├─ 节点已被删除? → return <pool>(4)
  └─ if BuildMode == <pool>(4):                  # 非 UI 模式才落盘
        \uf55c\uf0ba\ue6d3.\ue157\ueb2d\ue95b() ? item.PostBuild(true)
                                            : item.ExportBucketBin()

异常路径：
  OperationCanceledException → 失效 + 结果<cancel>
  NodeValidationException    → 失效 + LastError + State=Error + 结果<fail>
  NodeFailedException        → 失效 + LastError + 结果<fail>
```

### 2.4 后处理与导出（`PostBuild`，observed `Node:1259-1333`）

```
PostBuild(bool export = true)
  ├─ Defaults.Cache.OffloadBuildCache && ExportState == WontExport
  │     → \uf55c\uf0ba\ue6d3.\ue157\ueb2d\ue94a(<pool>(4))          # 先卸载
  ├─ !export || \uf55c\uf0ba\ue6d9.\ue05d\uedfb\ue0c8(this) → return   # 条件语义 unknown
  └─ for port in Exportables (= Outs.Where(IsExporting))
        suffix = (port.Name == "Out" && Defaults.RemovePrimaryPortName)
                   ? "" : Defaults.FilenameDelimiter + port.Name
        │
        ├─ 单图： OutputType == SingleImage || Type == <pool>(50)
        │     f = GetExportFilename(suffix)
        │     \ue6f8\ue1a7\uf001(this, f)                 # 导出前回调
        │     map = 缓存(Id, port).Data.Copy()
        │     Export(map, f, port)                     # 见 §3
        │     \ue6f8\ue1a7\uf002(this, f)                 # 导出后回调
        │
        └─ 分块：
              dir = 拼接(SaveDefinition.Filename, port)
              n   = (Type==<pool>(50)) ? map.Resolution.X / TileResolution
                                       : NumberOfTiles
              tiles[y,x] = Transformer.<m>(map, x*TileResolution, y*TileResolution, ...)
              if <pool>(35) != 0:                      # 补边开关
                  tiles = TileVertexBorder.Expand(list, NumberOfTiles, <pool>(4))
              for each tile:
                  f = GetExportFilename(suffix, tile.TileSuffix(build.TilePattern))
                  Export(tileMap, f, port, [tile])
  ExportState = <pool>(3)                                  # 已导出
  if Defaults.Cache.OffloadBuildCache: 再卸载一次
```

`TilePattern` 的默认值可由字符串池还原为 **`_y%Y%_x%X%`**
（`pool_strings.tsv` 索引 22159，经 152/152 调用点验证）。

### 2.5 分块（Bucket）模式

```
\ue6f8\ue1a7\uefb6 里 BuildMode != UI 时：
    \uf55c\uf0ba\ue6d3.\ue157\ueb2d\ue95b() 为 false → item.ExportBucketBin()
                                                     observed Node:1335-1366
    for port in Outs where IsExporting:
        map = 缓存(Id, port).Data.Copy() → 钳制 → 变换
        文件名 = $"{Id}_{Name}_{port.Name}_y{Bucket.Position.Y}_x{Bucket.Position.X}.bin"
        写 <BucketDir> (= \uf55c\uf0ba\ue6cb.\ueb20\uee69\uf029) \ 文件名
              \uf55c\uf0ba\ue6ec.<m>\uf7a8(path, map)
```

---

## 3. 缓存

```
内存缓存，按 4 个集群分组：  CacheClusters { Progressive, Primary, Bakes, HD }
                                                observed Fx.Cache.cs:360-366
每个 (节点Id, 端口名) → Cache { Thumbprint:Guid, State:CacheState,
                                Cluster, _data:Map, LastAccess }
                                                observed Fx.Cache.cs:11-146
CacheState { Loaded, Offloaded, Empty }          observed :441-446

磁盘路径（Cache.Filename，observed :103-121）：
    <集群>\<cacheFolder>_<工程Id>.Id\<节点Id>_<端口名>.bin
    同目录同名 <...>.meta                            (JSON MetaDictionary)

.meta 内容（observed _cls_E6EF.cs:31-44 + MetaDictionary.cs）：
    Resolution   = map.Resolution.X
    Channels     = map.NumberOfChannels
    RenderIntent = map.Info.RenderIntent   (枚举名，如 "Default"/"Heightfield")
    Min / Max    = 仅当处于特定 portion 时写入（分块缩放范围）
    GUID         = Cache.Thumbprint.ToString("N")   ← 由 Cache.Offload 追加
    （+ 调用方附加的任意 key/value，如 GUID）

判定与流转：
  Cache.IsDifferentFromDisk()   读 .meta，GUID != Thumbprint 即不同   :148-167
  Cache.Offload()               写 .bin + .meta，释放 _data，State=Offloaded  :169-214
  Cache.Reload(deleteCache)     读回 (Map, MetaDictionary)；
                                  回填 port.RenderIntent、node.Thumbprint；
                                  Cluster==<pool>(4) 时删文件                     :232-290
  Cache.Data getter             需要时 Reload                                            :123-138
  Cache.GetBakedMap()           (Map, MetaDictionary)?                                   :292-307
  Cache.DeleteOffloaded()       删 .bin 与 .meta                                          :216-230

失效链（observed）：
  Node.Touch()            → Thumbprint = Guid.NewGuid()             Node:1045
  Node.UpdateParity()     → LastParity=Parity; Parity=<E6CB>.\ueff9(this,true);
                            return LastParity == Parity   (true = 未变化)  Node:983
  Node.GetParityString()  → "<Id>" + 每个已连 In 端口的
                            "(端口-上游端口-上游Id-本节点Thumbprint)"      Node:950
  <E6CB>.\ueff9(node,b)   → 上游闭包 OrderBy(Id) 拼接各自 parity 串    E6CB:2161
  CacheKeyBuilder.GetHash → 该类型 [CacheKey] 属性按名排序后取 HashCode；
                            float 舍入 4 位、double 6 位               Util.CacheKey.cs
```

---

## 4. 导出（Export）

```
Node.Export(Map map, string filename, Port port, params object[] extra)
                                                     observed Node:1368-1373
   1) map = \uf55c\uf0ba\ue6d5.\ueb77\uf21d\ue95c(map)          # 预处理（钳制/缩放）
   2) map = \uf55c\uf0ba\ue6cb.\ue6f8\ue1a7\uefc4(map)          # 再变换
   3) \uf55c\uf0ba\ue6cb.\ue6f8\ue1a7\uefc3(FileFormats, path, map)
          FileFormats = SaveDefinition?.Format ?? <pool>(39)   # 默认 TIFF32
          path        = Path.ChangeExtension(filename, null)

\uf55c\uf0ba\ue6cb.\ue6f8\ue1a7\uefc3 实现在 _cls_E6CB.cs:1150；具体分派在
QuadSpinner.Gaea.Engine.IO.* 与 `\uf55c\uf0ba\ue6ec`（_cls_E6EC.cs）中，按 FileFormats 分流：

  GaeaRaw(.graw) │ HalfRaw(.raw) │ HalfRaw16(.r16) │ UshortRaw(.raw)
  UshortRaw16(.r16) │ FloatRaw(.raw) │ FloatRaw32(.r32)
        → 无头裸数组写： FileStream(Create, Write) + Write(byte[])
             float32: Buffer.BlockCopy(float[] → byte[]) 后整块写出   E6EC:265-273
             float16: MemoryMarshal.AsBytes<Half>(span)               E6EC:345-359
  PNG8/16/64 │ TIFF8/16/32 │ JPEG │ EXR
        → 图像编码器（Magick.NET / TinyExr / BitMiracle.LibTiff，见 engine-dataformats.md §4）
          证据：重载 \uf55c\uf0ba\ue6ec.<m>\uf7a5(string, Map, int, PixelType, CompressionType)  E6EC:426
  OBJ / 网格（Topology + MeshExportOptions）
        → BuildMesh / SaveOBJ / SaveMesh                     IO.cs(Sophia) 与 E6EC:468/692/758/844/968
```

---

## 5. 完整时序（一页 ASCII）

```
open .gaea ──► Terrain{Nodes,Groups,Notes,...}
                 │  Reconstruct/Migrate/UpdateUI/CreateVisibilityTable
                 │  Metadata ← Defaults.Metadata[类型名]
                 ▼
            Port.Record ──► Port.Connection  (边只在入端口上)
                 │
      Build 触发  ▼
   \uefb5(node) ──► (可选) 下游全部失效 \ueffb + \uf072\uf1d6\uf6d1()
                 │
                 ▼
   \uefb6(node, BuildContext)  ── State/StateOverride 闸门 ──► \uf004(node)
                 │
                 ▼
   \uf003(node) = \ueff5(node) 的 DFS 后序闭包（依赖在前）
                 │
   for each item:
       校验 \uf007 ─► 变量绑定 \uefb9 ─► State=IsBuilding
       ─► 清缓存(Guid) ─► Touch() ─► StartJob()
       ─► item.Build()
              └─► Commit(map) ─► map.Info.RenderIntent
                              └─► 缓存 \ue93a(Id, 端口, map, Cluster)
                                     ├─ 内存 Map
                                     └─ Offload → <集群>\<dir>_<项目Id>\<Id>_<端口>.bin
                                                    + 同名 .meta (JSON: Resolution/
                                                      Channels/RenderIntent/Min/Max/GUID)
       ─► State=Built
       ─► BuildMode!=UI ? PostBuild(true) 或 ExportBucketBin()
                            └─► 单图 / 分块切片（Transformer + TileVertexBorder.Expand）
                                 └─► Export(map, file, port)
                                       └─► \uefc3(FileFormats, path, map)
                                             ├─ 裸数组（.r32/.r16/.raw/.graw）
                                             ├─ PNG/TIFF/EXR（编码器）
                                             └─ OBJ/网格（Sophia/MeshExportOptions）
       ─► ExportState = 已导出
```

---

## 6. 本流程图的证据强度

| 环节 | 强度 |
| --- | --- |
| 反序列化 / 默认值省略 / Metadata 注册表 | **observed**（`ParameterAwareContractResolver`、`Node.Metadata`、`NodeMetadata.Create`） |
| 依赖拓扑（DFS 后序） | **observed**（`\ueff5`/`\ueff6` 全文） |
| 单节点构建循环的每一步顺序 | **observed**（`\uf004` 全文） |
| `Commit` 的遮罩公式与 modifier 链 | **observed**（`Commit`/`ApplyModifiers` 全文；常量 1 来自加密池，`inferred`） |
| `PostBuild` 的单图/分块分支与文件命名 | **observed**（`PostBuild` 全文 + `ExportBucketBin`） |
| `Cache.Filename` / `.bin`+`.meta` | **observed**（`Cache` 与 `_cls_E6EF`） |
| `Export` → `\uefc3` → 编码器分派 | 签名 **observed**；编码器内部在其它 dll，**inferred** |
| `.gaea` 容器格式 | **inferred**（Newtonsoft JSON）；写出器不在本 dll，**unknown** |
| `BuildOrder` 的语义 | **unknown**（引擎内无写入点） |
| `\uf55c\uf0ba\ue6d9.\ue05d\uedfb\ue0c8(node)` 早退条件 | **unknown**（仅知签名 `Func<Node,bool>`） |

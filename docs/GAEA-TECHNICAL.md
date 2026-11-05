# Gaea 2.3.1 技术文档（软件本体）

> 对象：本机安装的 **Gaea 2.3.1.0 Community**（`D:\Gaea 2`，Fx 版本 8.0.32）。
> 目的：为「复刻 Gaea」的 Web 实现提供**软件层面的权威事实**：安装结构、进程模型、启动流程、
> 数据目录、文件格式、节点体系、界面结构、命令行/无头能力、已知故障模式。
> 所有结论都有可复现的来源：安装目录清单、`Data/Logs` 启动日志、UI Automation 树
> （`.learn/raw/*.json`）、真实截图（`.learn/steps/*.png`）与项目内既有反编译证据（`docs/` 其余文档）。

---

## 1. 概览

| 项 | 值 |
|---|---|
| 产品 | Gaea（地形生成 / 侵蚀 / 贴图烘焙） |
| 版本 | 2.3.1.0（`Gaea.exe` 文件版本 2.3.1.0，时间戳 0x6a870000） |
| 版本代号 | Fx 8.0.32 |
| 发行版 | Community（`Data\edition.dat`） |
| 运行时 | .NET 8（`Gaea.dll` / `Gaea.Engine.dll` / `Gaea.Nodes.dll` 均为 net8.0 程序集） |
| UI 框架 | WPF（窗口类名 `HwndWrapper[Gaea;;<guid>]`） |
| 计算后端 | CPU + SYCL/AdaptiveCpp（`Gaea.AdaptiveCpp*.dll`、`hipSYCL`、`acpp-*.dll`、`cudart64_12.dll`） |
| 原生依赖 | `Gaea.Native.dll`（原生 blur/侵蚀等 kernel）、`FNSIMD.dll`（FastNoise SIMD） |
| 授权/保护 | 程序集经 Eazfuscator.NET 混淆（名称/常量加密、控制流混淆；详见 `HANDOFF.md`） |

**关键判断**：Gaea **没有**公开的 HTTP/脚本 API。可自动化面只有三处：

1. **Win32 + UI Automation**（本文档第 7 节，也是 `gaea-mcp` 采用的方式）；
2. **命令行参数**（`Gaea.exe` 会解析参数，未知参数仅告警后忽略）；
3. **.NET 程序集反射**（项目内 `tools/gaea-probe` 已用它直接调用 `Gaea.Nodes.dll` 做数值对拍，
   这属于「离线复刻」路线，不是操作 GUI 的路线）。

---

## 2. 安装目录结构（`D:\Gaea 2`）

### 2.1 可执行文件

| 文件 | 作用（实测/推断） |
|---|---|
| `Gaea.exe` | 主程序（WPF GUI）。启动后拉起 `Gaea.Observer.exe` 与 `Gaea.Viewport.exe` |
| `Gaea.Observer.exe` | 主程序的监视/辅助进程（启动即出现，无主窗口） |
| `Gaea.Viewport.exe` | 3D 视口进程（Unity 运行时；启动会打印 `[UnityMemory]` 配置） |
| `Gaea.BuildManager.exe` | 无头构建器；**本机版本与引擎不匹配，运行即 `TypeLoadException: QuadSpinner.Gaea.Engine.Q`**（见 §9） |
| `Gaea.Dt.exe` / `Gaea.Dv.exe` / `Gaea.Nv.exe` | 附属工具（Dt/Dv/Nv：数据/诊断/…；未在 GUI 流程中使用） |
| `Gaea.Server.exe` / `Gaea.Swarm.exe` / `Gaea.SwarmHost.exe` | 本地服务/集群渲染相关（Community 版不参与常规流程） |
| `Diagnostics.exe` | 诊断工具 |
| `unins000.exe` | 卸载器（Inno Setup 风格） |
| `UnityCrashHandler64.exe` | Unity（视口）崩溃处理 |

### 2.2 关键程序集

| 程序集 | 内容 |
|---|---|
| `Gaea.dll` | 应用壳（WPF、菜单、面板、命令） |
| `Gaea.Engine.dll` | 地图/通道模型、变换、节点图执行、引擎常量与服务 |
| `Gaea.Nodes.dll` | 全部节点实现（约 182 个节点）与共享算法 |
| `Gaea.Native.dll` | 原生 kernel（blur、部分侵蚀等 P/Invoke） |
| `FNSIMD.dll` | FastNoise SIMD 噪声库（Perlin/Worley/Gabor/… 的 `[DllImport("FastNoise")]` 目标） |
| `Gaea.Libs.dll`、`Gaea.CE.dll`、`Gaea.CS.dll`、`Gaea.CW.dll` | 第三方/许可/加密相关库封装 |
| `Gaea.AdaptiveCpp*.dll`、`Gaea.Ac.dll`、`Gaea.oneAPI.dll` | SYCL 后端桥接 |
| `DarkNet.dll` | 神经网络推理（部分 AI/生成类功能） |
| `assimp-vc143-mt.dll`、`BitMiracle.LibTiff.NET.dll`、`Magick.NET*` | 网格导入、TIFF 输出、图像 IO |
| `ActiproSoftware.*.Wpf.dll` | 商业 WPF 控件（停靠面板、属性网格） |

### 2.3 目录

| 目录 | 内容 |
|---|---|
| `Data\` | 用户数据根（见 §4） |
| `Examples\` | 官方示例工程（可用于复刻的回归素材） |
| `Presets\` | 节点/图预设 |
| `Resources\` | 图标、模板、内置资源 |
| `D3D12\` | D3D12 编译缓存（视口/后端） |
| `hipSYCL\`、`runtimes\`、`MonoBleedingEdge\` | SYCL/运行时依赖 |
| `Gaea.Viewport_Data\` | Unity 视口进程的资源与运行时（`*_Data` 命名是 Unity 构建特征） |

---

## 3. 进程模型

启动 `Gaea.exe` 后稳定态为 3 个进程：

```
Gaea.exe              主 GUI（窗口标题 "Gaea - <文件名>"，最大化 3862x2110@(-11,-11)）
├─ Gaea.Observer.exe  辅助/监视，无主窗口
└─ Gaea.Viewport.exe  3D 视口（Unity 运行时）
```

- 主窗口类名：`HwndWrapper[Gaea;;<guid>]`（WPF）。
- 启动开始时还会出现一个 **Welcome 对话框**（`Welcome to Gaea 2.3.1.0`，1155x990），自动关闭/可点掉。
- 关闭主窗口会一起结束 Observer/Viewport。

---

## 4. 数据目录（`Data`）

| 路径 | 作用 |
|---|---|
| `Data\Logs\YYYY-MM-DD_HH-mm-ss.txt` | 每次启动一个日志文件（启动流程的权威来源，见 §5） |
| `Data\Settings\User.options` | 用户级选项（窗口布局、最近文件关联等） |
| `Data\Settings\Preferences.options` | 偏好设置（UI/性能/渲染） |
| `Data\Settings\usage.stats` | 使用统计（本地） |
| `Data\Settings\gaea-super.mru` | 最近打开工程列表（"super" = 超级工程/场景？实测为 MRU 列表） |
| `Data\Autosaves\` | 自动保存 |
| `Data\Cache\` | 运行缓存（缩略图/视口缓存） |
| `Data\Macros\` | 宏（Gaea 支持节点图宏） |
| `Data\Thumbnails\` | 节点/工程缩略图 |
| `Data\Updates\`、`Data\update.manifest` | 更新清单与下载 |
| `Data\edition.dat` | 发行版标识（Community） |

**重要**：Gaea 启动时会**写** `Data\Settings`、`Data\Logs`、`Data\Cache`。若进程被文件沙箱限制写安装目录，
表现为**未处理 .NET 异常崩溃**（Windows 事件日志 `APPCRASH`，异常码 `0xe0434352`，模块 `KERNELBASE.dll`），
而不是弹错误框。这是自动化时最容易踩的坑（见 §9）。

---

## 5. 启动流程（来自 `Data\Logs\2026-10-18_17-30-13.txt`）

```
[17:30:13] INF Session: <guid>                # 每次启动的会话 id
[17:30:13] INF Loading options                 # 读取 Settings
[17:30:13] INF QuadSpinner Gaea                # 产品名
[17:30:13] INF Version 2.3.1.0
[17:30:13] INF Data Path D:\Gaea 2\Data
[17:30:13] INF Fx Version 8.0.32
[17:30:13] INF Windows Version Microsoft Windows NT 10.0.26200.0
[17:30:13] INF Machine name is <host>
[17:30:13] INF Process path D:\Gaea 2\Gaea.exe
[17:30:13] INF Executing in D:\Gaea 2
[17:30:13] INF 16 cores
[17:30:13] INF Loading user preferred devices.        # GPU/计算设备枚举
[17:30:14] INF Trying to detect Nahimic injection.    # 音频注入检测（出现两次）
[17:30:16] INF New file                               # 新建空工程
[17:30:19] INF Viewport attachment completed in 3624  # 视口进程挂载耗时(ms)
```
退出时追加 `INF Saving options file` 与 `INF Clean exit.`。

复刻启示：启动序列里**唯一耗时**的是视口挂载（约 3.6s）；UI 在视口就绪前就已可交互。

---

## 6. 节点体系

### 6.1 UI 分类（节点面板，来自 UIA 实测）

左侧面板 9 个分类，顺序固定：

`Primitive`（基础）· `Terrain`（地形）· `Modify`（修改）· `Surface`（表面）· `Simulate`（模拟）·
`Derive`（派生）· `Colorize`（着色）· `Output`（输出）· `Utility`（工具）

### 6.2 机器可读目录

项目内 `web/data/nodes.json` 保存了从程序集提取的 **182 个节点**：名称、分类、参数（类型/默认值/范围）、
端口。`gaea-mcp` 的 `gaea_node_catalog` 工具直接查询该文件；Web 复刻 (`web/js/registry.js`) 也以它为准。

节点实现分三层：

1. **节点壳**（`Gaea.Nodes.dll`）：参数、输入输出、`Build()`；
2. **共享算法**（`Gaea.Nodes.dll` 内的 `Profiles` / `Combiner` / `AspectMaps` / `Mosaic` / `Erosions` …）；
3. **原生/SIMD**（`Gaea.Native.dll` 的 blur/侵蚀、`FNSIMD.dll` 的噪声、SYCL kernel 的 GPU 侵蚀）。

复刻时的关键结论（已在 `HANDOFF.md` 与 `docs/gaea-*.md` 记录）：
- 纯 CPU 的共享算法可用数值 oracle（反射调用真实方法）逐值对齐；
- 原生 blur 已用「冲激响应 + 可分离核数据表」复刻（内部 1.7e-4）；
- FNSIMD 噪声与 SYCL 侵蚀仍是主要缺口，需继续用 oracle 反推。

---

## 7. 界面结构（UI Automation 实测）

主窗口 3862x2110（最大化），UIA 可访问控件 123 个（深度 10）。核心可操作元素：

| 区域 | 控件 | AutomationId / 名称 |
|---|---|---|
| 标题栏 | 产品按钮（打开 About） | `btnGaea` / "GAEA" |
| | 复制/保存 | `copy-plus`、`floppy` |
| | 文件名 | `txbFileName`（"Untitled"） |
| | 最小化/最大化/关闭 | `btnMin`、`btnMax`、`btnClose` |
| | 版本按钮 | `btnAbout`（"Gaea 2.3.1.0 Community"） |
| | 内存指示 | `btnMemory`（"0.0 GB / 0.3 GB"） |
| 菜单栏 | File / Edit / Graph / Node / Preview / Project / Tools / Help | `MenuItem`，部分有 id：`miEdit`/`miGraph`/`miNode`/`miPreview`/`miProject` |
| 视口 | 3D 视口 | `Pane` 名称 "Gaea.Viewport" |
| 节点面板 | 9 个分类 | `MenuItem`：Primitive/Terrain/Modify/Surface/Simulate/Derive/Colorize/Output/Utility |
| 底部 | 图列表 / 属性区 | `Tab`/`TreeItem`：Graph 1 等 |
| 状态栏 | 状态文字 | `AppStatusText`（"Idle"） |

> 注：菜单项是 WPF `MenuItem`，UIA 可 `ExpandCollapse`/`Invoke`；节点分类为 `MenuItem`，展开后其子项为
> 具体节点名。通过 UIA 可以完成「打开菜单 → 选择节点 → 生成图」的完整驱动（见 `gaea-mcp` 的功能测试）。

---

## 7.1 菜单一览（真实截图转写，证据见 .learn/raw/menu-*）

| 菜单 | 条目（实测） |
|---|---|
| **File** | New (Ctrl N) · Open… (Ctrl O) · Open Recent ▸ · Open Examples… · Start Dialog · Save… (Ctrl S) · Save as… (Ctrl Shift S) · Save incremental · Repair File… · Import ▸ · Export ▸ · Share… · Exit (Alt F4) |
| **Edit** | Undo (Ctrl Z) · Redo (Ctrl Y) · Cut (Ctrl X) · Copy (Ctrl C) · Paste (Ctrl V) · Copy Properties · Paste Properties · Rename (F2) · Duplicate (Ctrl D) · Delete (Del) |
| **Graph** | New Graph Tab · Add Note · Zoom ▸ (Extents Ctrl 0 / Reset Zoom Ctrl 1 / Selection Ctrl 2) · Graph Surface · Show Grid · Snap to Grid · Snap to Items ✓ · Bake ▸ · Bookmarks ▸ |
| **Node** | Refresh · Bypass · Lock Preview to Node · Mark for Export · Reset · Mutate · Locked 2D Viewport · Select Upstream · Select Downstream · Group / Ungroup · Combine nodes · Convert port to portals …（共 54 个 MenuItem，详见 UIA 转储） |
| **Preview** | Resolution ▸ (512² / **1024² ✓** / 2048² / 4096²) · Engine Active · Clean Memory · Clear Cache · Rebuild All · Screenshot ▸ (Save Screenshot F9 / Screenshot Options ▸) · Record Turntable Animation |
| **Project** | 工程级命令（最近工程/设置；截图见 .learn/raw/menu-project） |
| **Tools** | Interface Scale (120%) ▸ · Install Plugins ▸ · Run Diagnostics… · Artifact Explorer… · **Console (F12)** · Verbose Logging · Options… (Ctrl Alt O) |
| **Help** | 帮助/关于等（截图见 .learn/raw/menu-help） |

要点：
- **Preview 分辨率默认 1024×1024**（对应复刻工程的渲染分辨率语义）；
- **Tools ▸ Install Plugins** 说明 Gaea 有插件机制（可扩展节点/功能）；
- **Tools ▸ Console (F12)** 是内置调试控制台（见 §12）；
- **Artifact Explorer** 可浏览资源产物（对逆向安装资源有用）。

## 7.2 节点面板的两级结构（实测）

一级分类 9 个：Primitive / Terrain / Modify / Surface / Simulate / Derive / Colorize / Output / Utility。
点击一级分类会弹出 **独立 flyout 窗口**，其中是**二级分类**（例如 Terrain → `LANDSCAPE`、`PRIMITIVE`），
二级分类再展开出具体节点。截图：`.learn/raw/palette-terrain/palette-2.png`（219×110，可清楚看到两个二级分类）。

> 复刻启示：Web 端节点面板若要与原版一致，应采用「分类 → 子分类 → 节点」三层信息架构，
> 而不是单层分类。节点名称全集见 `web/data/nodes.json`（182 个）。

## 8. 文件格式

| 格式 | 说明 |
|---|---|
| `*.terrain` / 工程文件 | Gaea 工程（图 + 参数 + 输出设置）。`Examples\` 下有官方样本 |
| 高度图输出 | `.r32`（32-bit raw）、`.exr`、`.png`/`.tif`（16-bit）、`.tiff` 等，取决于 Output 节点设置 |
| `.options` | 键值/JSON 风格设置文件（User/Preferences） |
| `.mru` | 最近文件列表（文本） |
| `Data\edition.dat` | 发行版标识 |
| `Data\update.manifest` | 更新清单（JSON/文本） |

> 精确的 `.terrain` 结构（序列化字段、节点图 JSON schema）已在 `docs/engine-dataformats.md`、
> `docs/engine-model.md` 中从程序集层面还原，本文不重复。

---

## 9. 命令行 / 无头能力（实测现状）

- `Gaea.exe --help` → `Ignoring unknown argument: --help`，随后正常启动 GUI。说明：**参数解析存在，未知参数被忽略**；
  已知参数集尚未从二进制中完全枚举（`Gaea.dll` 的 `Program.Main` 可继续逆向）。
- `Gaea.BuildManager.exe --help` → **立即崩溃**：
  ```
  System.TypeLoadException: Could not load type 'QuadSpinner.Gaea.Engine.Q'
    from assembly 'Gaea.Engine, Version=2.3.1.0'
  ```
  即该无头构建器与随附引擎程序集版本不匹配（或缺少授权/许可初始化），**本机无法用 BuildManager 做无头构建**。
- `Gaea.Observer.exe` / `Gaea.Viewport.exe` 由主程序按需拉起，单独运行无意义。

结论：当前可靠的自动化路径是 **GUI + UIA + 内置 Console**；无头构建需要修复/替换 BuildManager（后续工作）。
另据 Tools 菜单，Gaea 支持 **插件安装**（Install Plugins），这是后续扩展自动化的潜在方向。

---

## 10. 已知故障模式与规避

| 现象 | 根因 | 规避 |
|---|---|---|
| 启动约 12s 后进程消失，无新日志 | 进程被文件沙箱限制，写 `Data\*` 失败 → .NET 未处理异常（`0xe0434352`，WER APPCRASH） | 以**非沙箱**权限启动；`gaea-mcp` 用 detached spawn |
| 截图全黑/截到别的窗口 | WPF 窗口未前台，`CopyFromScreen` 截到覆盖窗口 | 用 `PrintWindow(hwnd, hdc, 2 /*PW_RENDERFULLCONTENT*/)`；实测 WPF 可返回真实像素 |
| UIA 抛 `Cannot convert "∞" to Int32` | WPF 根元素 `BoundingRectangle` 为无穷 | 转换前判 `IsInfinity/IsNaN`，钳制到 Int32 |
| 窗口匹配到资源管理器 | 标题含 "Gaea 2 - 文件资源管理器" | 按窗口类名 `HwndWrapper[Gaea` 过滤，再按面积取最大 |
| UI 读到错的窗口 | **同时运行了多个 Gaea 实例**（每个实例都有同尺寸主窗） | 驱动/测试前确保单实例；`gaea-win.ps1` 按 `GetForegroundWindow` 优先 |
| BuildManager 崩溃 | 引擎类型不匹配 | 记录为已知限制，勿依赖 |
| 无网络 | 环境无外网（DNS 失败） | 文档/依赖全部本地化；FastNoise 源码不可下载，改用 oracle 反推 |

---

## 12. 内置调试控制台（Gaea Debug Console）

入口：**Tools ▸ Console** 或快捷键 **F12**。它是独立窗口（标题 `Gaea Debug Console`，默认 1200×675），
带命令行提示符 `⟫`。UI Automation 结构：

| 控件 | AutomationId | 类型 | 用途 |
|---|---|---|---|
| 日志区 | `txtLog` | Edit（支持 ValuePattern 读） | 全部控制台输出（可当作文本读取，无需 OCR） |
| 命令输入 | `txtCommand` | Edit（支持 ValuePattern 读写） | 输入命令 |
| 提示符 | `txbPrompt` | Text | `⟫` |

已实测命令（`help` 输出）：`help`、`list`、`stats`、`learn`、`ping`、`addresource`、`cls`/`clear`、
`deactivate`、`uninstall`。这些偏诊断/许可/资源统计，不是节点脚本接口；但**命令输入与输出都可被自动化**：
`gaea-mcp` 的 `gaea_console` 工具会打开控制台、用 ValuePattern 写入命令、回车并读回 `txtLog` 的增量文本。

自动化注意：`SendKeys` 依赖键盘焦点，Windows 可能拒绝前台切换；因此写命令走 **ValuePattern.SetValue**，
只把 `{ENTER}` 用按键发送（实测可稳定执行）。

## 11. 与 Web 复刻的关系

复刻工程（`web/js/`）以「数值一致」为目标，Gaea 本体提供两类输入：

1. **算法事实**：反射 oracle（`tools/gaea-probe`）给出真实节点输出，用于逐值对拍；
2. **界面事实**：本机 UI（截图 + UIA）给出参数名/范围/默认值/分组，以及交互语义（本文档 §7）。

`.learn/` 目录保存了本次自动化过程产生的**每一步截图**与 UIA 原始转储，作为复刻的视觉基准：

- `.learn/steps/NN-*.png`：按顺序的界面快照；
- `.learn/raw/*.json`：UIA 树（可离线分析控件层级/命名/坐标）；
- `.learn/README.md`：步骤索引（由 `gaea_step` 自动维护）。

配套文档：
- `docs/GAEA-MCP.md`：MCP 服务器（自动化接口）的完整参考；
- `docs/HANDOFF.md`：算法复刻进度与后续路线；
- `docs/engine-*.md`、`docs/gaea-*.md`：引擎/格式/侵蚀等深度逆向结论。

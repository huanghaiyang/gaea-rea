# Gaea MCP — 自动化接口参考

`gaea-mcp` 是一个 **stdio MCP 服务器**，让 Agent 直接操作真实的 Gaea 2 桌面程序（WPF）：
启动/查询进程、读取 UI Automation 树、点击控件、发按键、截图到 `.learn/`、查询 182 节点目录、
读取项目文档、尝试无头构建。

- 服务器：`gaea-mcp/server.mjs`（纯 Node，无第三方依赖）
- Win32/UIA 层：`tools/gaea-win.ps1`（唯一接触 Win32/UIA interop 的文件）
- 安装方式：Harness profile 的 bundle（`gaea-mcp/cordis.patch.yml`，serverName = `gaea`）
- 测试：`gaea-mcp/test/unit.test.mjs`、`gaea-mcp/test/functional.test.mjs`
- 视觉证据：每次操作后的截图进入 `.learn/steps/`，索引在 `.learn/README.md`

---

## 1. 架构

```
Agent ──MCP(stdio, JSON-RPC/line)──▶ gaea-mcp/server.mjs
                                        │ execFile
                                        ▼
                              tools/gaea-win.ps1
                                ├─ Win32: EnumWindows/GetWindowRect/PrintWindow/mouse_event
                                └─ UIA:   AutomationElement / Invoke/Toggle/SelectionItem
                                        │
                                        ▼
                             真实 Gaea 窗口 (WPF)
```

**为什么不用 HTTP/CDP**：Gaea 是原生 WPF 桌面程序，没有网络接口，也没有可注入的浏览器上下文；
唯一稳定入口是 Win32 + UI Automation（见 `docs/GAEA-TECHNICAL.md` §7/§9）。

**为什么截图用 PrintWindow**：WPF 未前台时 `CopyFromScreen` 会截到覆盖窗口；实测
`PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT=2)` 能返回真实像素，因此截图不需要抢前台。

---

## 2. 启动与注册

服务器本身不依赖 profile 即可运行：

```powershell
node D:\sgames\gaea-rea\gaea-mcp\server.mjs        # 从 stdin 读 JSON-RPC，一行一条
```

注册到 Harness profile（本仓库已附带 bundle）：

```powershell
# 通过工具调用（需要 Full access 的 profile）
plugin_manager action=install_bundle target=D:\sgames\gaea-rea\gaea-mcp
plugin_manager action=set_bundle  target=@local/gaea-mcp enabled=true
```

安装后 Agent 侧出现 `mcp__gaea__*` 工具（与 `mcp__rea__*`、`mcp__godot-ai__*` 同级）。

环境变量（bundle 里已设置）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `GAEA_WORKSPACE` | `gaea-mcp/..` | 工作区根（截图与文档都限制在其中） |
| `GAEA_DIR` | `D:\Gaea 2` | Gaea 安装目录（launch/build 用） |
| `GAEA_LEARN_DIR` | `<workspace>/.learn` | 步骤截图与 manifest 根 |

**前提**：Gaea 必须在**非受限文件沙箱**下运行（它启动时写自己的 `Data\`）；否则会以
`0xe0434352` 崩溃（见技术文档 §10）。

---

## 3. 工具参考（16 个）

约定：所有工具返回 MCP `text` content；需要结构化数据时，正文末尾附带 ` ```json ` 代码块（测试用
`callToolJson` 解析该块）。失败时 `isError: true`。

### 3.1 生命周期

| 工具 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `gaea_status` | — | `{gaeaDir, workspace, processes[], windows[]}` | 是否在运行、主窗口句柄/标题/矩形 |
| `gaea_launch` | `exe?`, `waitSeconds?` | 窗口信息 | **detached** 启动，等待 `Gaea -` 窗口出现；失败会提示沙箱问题 |

### 3.2 截图与步骤记录

| 工具 | 参数 | 说明 |
|---|---|---|
| `gaea_shot` | `out?`, `title?` | 截主窗口（或标题匹配窗口）到 PNG；`out` 相对工作区，越界写入被拒绝 |
| `gaea_step` | `label`, `note?`, `title?` | 截图 → `.learn/steps/NN-<slug>.png`，并向 `.learn/README.md` 追加一行索引 |
| `gaea_shot_all` | `outDir?`, `prefix?` | 逐窗口截图（主窗 + 菜单/面板 flyout 等独立 HWND），用于弹窗类证据 |

`gaea_step` 是「每一步操作都截图」这条要求的执行入口：编号自动递增、slug 自动规范化。

### 3.3 UI 检查与操作

| 工具 | 参数 | 说明 |
|---|---|---|
| `gaea_windows` | — | 可见 Gaea 窗口列表（标题/类名/句柄/矩形） |
| `gaea_ui_tree` | `depth?`, `types?`, `title?`, `out?`, `limit?` | 扁平 UIA 树（type/name/automationId/bounds/offscreen），`out` 落盘 JSON |
| `gaea_click` | `name?`, `automationId?`, `index?`, `title?` | 依次尝试 Invoke/SelectionItem/Toggle/ExpandCollapse，最后退回鼠标点击中心 |
| `gaea_keys` | `text`, `title?` | SendKeys（`{ESC}`、`^s`…），会先置前台 |
| `gaea_mouse` | `x`, `y`, `button?`, `double?`, `title?` | 窗口相对坐标的真实鼠标点击 |
| `gaea_menu` | `menu`, `item?`, `shot?`, `outDir?` | 单进程内完成「点开菜单 → 截弹窗 → 读 UIA」，返回条目与截图（弹窗关闭前必须同进程处理） |
| `gaea_console` | `command`, `screenshot?`, `timeoutMs?` | 打开 F12 控制台，用 ValuePattern 写命令并回车，读回 `txtLog` 增量文本（内置命令：help/list/stats/learn/ping/addresource/cls…） |

### 3.4 知识与构建

| 工具 | 参数 | 说明 |
|---|---|---|
| `gaea_node_catalog` | `query?`, `limit?`, `full?` | 查询 `web/data/nodes.json`（182 节点）；`full` 带参数表 |
| `gaea_docs` | `read?`, `limit?` | 列/读 `docs/*.md`（含本文件与技术文档），禁止越出 `docs/` |
| `gaea_build` | `exe?`, `args?`, `timeoutSeconds?` | 仅允许 Gaea 自带 CLI；返回退出码与 stdout/stderr（用于记录无头能力现状） |
| `gaea_win` | `args[]` | 低层逃生舱：直接调用 `gaea-win.ps1` 子命令（含 value/setvalue/shotall/menu 等） |

---

## 4. 典型工作流

```text
1. gaea_status                       → 确认进程与主窗口
2. gaea_launch                       → 未运行时启动（detached）
3. gaea_step label="main-window"     → .learn/steps/01-main-window.png
4. gaea_menu menu="File" shot=".learn/steps/02-file-menu.png"
5. gaea_ui_tree types="MenuItem" out=".learn/raw/main-menu.json"
6. gaea_click name="Terrain"         → 展开节点面板分类
7. gaea_step label="terrain-nodes" note="节点面板 Terrain 分类展开"
8. gaea_keys text="{ESC}"            → 收起菜单
9. gaea_node_catalog query="mountain" → 对照节点册
```

---

## 5. 测试

### 5.1 单元测试（不需要 Gaea）

```powershell
node --test gaea-mcp/test/unit.test.mjs
```

覆盖：MCP 握手/能力协商、14 个工具注册与 JSON Schema、未知方法 `-32601`、未知工具错误封装、
目录 182 节点检索、文档列表/读取与路径越界拒绝、截图路径越界拒绝、CLI 白名单、空参数拒绝、
传输层容错（坏 JSON 行不影响后续请求）。

### 5.2 功能测试（需要正在运行的 Gaea）

```powershell
# 先确保 Gaea 已启动（非沙箱）
node --test gaea-mcp/test/functional.test.mjs
```

覆盖真实窗口：`gaea_status` 能看到 Gaea 进程 → `gaea_shot` 产出合法 PNG（PNG 魔数 + 尺寸）→
`gaea_ui_tree` 含 `File/Edit/Node` 菜单 → `gaea_menu File` 能展开并截图 → `gaea_step` 连续编号且
manifest 增长 → `gaea_click` 能展开节点分类 → 目录/文档工具对照真实版本。若检测不到 Gaea 窗口，
套件以 `skip` 结束而不是失败（便于 CI）。

### 5.3 一键跑全部

```powershell
node gaea-mcp/test/run-tests.mjs        # unit + functional（有 Gaea 才跑 functional）
```

---

## 6. 已知限制

1. **UIA 可见性**：Gaea 的部分自绘区域（3D 视口、节点图的边与端口）没有 UIA 节点，
   只能靠坐标鼠标操作；视口内容通过截图理解。
2. **焦点**：`gaea_keys` 依赖前台，Windows 前台锁可能拒绝 `SetForegroundWindow`；本实现用
   `SwitchToThisWindow` + `ShowWindow(SW_RESTORE)` 提高成功率，但 RDP/锁屏下仍可能失败。
3. **多显示器/DPI**：坐标用物理像素（进程已 `SetProcessDPIAware`）；窗口在副屏时 `screen-rect`
   回退需窗口在前台。
4. **无头构建**：`Gaea.BuildManager.exe` 在本机版本直接 `TypeLoadException`，`gaea_build` 只负责
   如实返回，不代表能力可用。
5. **无网络**：环境无外网，MCP 不依赖任何在线资源。

---

## 7. 与复刻工程的关系

- MCP 提供**可控的真实界面**：截图、控件树、菜单结构、参数面板，用于校正 Web 复刻的 UI/参数语义；
- 算法数值对齐仍走 `tools/gaea-probe`（反射 oracle）与 `tools/verify-exact.mjs`；
- `.learn/` 是两者共享的视觉证据库。

---

## 8. 实测记录（2026-10-18，Gaea 2.3.1.0 Community）

**安装与注册**：`plugin_manager install_bundle target=D:\sgames\gaea-rea\gaea-mcp` →
`application: applied`，bundle `@local/gaea-mcp` 已启用；Agent 侧工具命名空间为 `mcp__gaea__*`（16 个工具）。

**测试结果**：

| 套件 | 结果 | 覆盖 |
|---|---|---|
| `node --test gaea-mcp/test/unit.test.mjs` | **10/10 通过** | MCP 握手/能力、16 工具与 Schema、-32601、未知工具、目录 182、文档读写、路径越界、CLI 白名单、坏 JSON 行容错 |
| `node --test gaea-mcp/test/functional.test.mjs` | **7/7 通过**（约 13s） | 真实窗口：进程/主窗、PNG 截图非空、8 个菜单 UIA、File 菜单弹窗截图、`.learn` 步骤连续编号+manifest 增长、节点分类 flyout、文档/目录一致性 |
| `node gaea-mcp/test/run-tests.mjs` | 一键跑两个套件 | 单元 + 功能 |

**巡览产物**：`node gaea-mcp/test/tour.mjs` → `.learn/steps/01..06` + `.learn/raw/{menu-*,palette-terrain,about,console}` + `.learn/tour.json`。

**关键坑（已在驱动中处理）**：
1. Gaea 启动即写安装目录，受限沙箱下会以 `0xe0434352` 崩溃（不是弹窗）；
2. 可能同时有**多个 Gaea 实例**（同尺寸主窗）或一个实例的辅助窗；窗口解析按 `GetForegroundWindow` 优先，功能测试启动时会关闭非主窗；
3. 菜单/面板 flyout 是独立 HWND，且**失去焦点即关闭** → 点击/UIA/截图必须同一 PowerShell 进程；
4. WPF 的 `BoundingRectangle` 可能是 ∞ → 转 Int32 前判 `IsInfinity`；
5. 窗口标题含中文（`Gaea 2 - 文件资源管理器`）会误导匹配 → 改按窗口类名 `HwndWrapper[Gaea` 过滤；
6. 截图必须 `PrintWindow(PW_RENDERFULLCONTENT=2)`，`CopyFromScreen` 会截到覆盖窗口。

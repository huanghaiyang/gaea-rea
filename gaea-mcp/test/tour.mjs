/**
 * Gaea UI tour — produces the ordered visual evidence under `.learn/`.
 *
 * Every action goes through the same MCP tools the agent uses (`gaea_step`, `gaea_menu`, `gaea_click`,
 * `gaea_shot_all`, `gaea_ui_tree`, `gaea_keys`), so the trace doubles as an end-to-end exercise of the
 * server. Run it while Gaea is open: `node gaea-mcp/test/tour.mjs`.
 *
 * Popup note: Gaea renders menus and palette flyouts as separate WPF windows (their own HWNDs). The
 * tour therefore captures popup screenshots into `.learn/raw/<name>/` (via `gaea_menu`/`gaea_shot_all`)
 * and keeps `.learn/steps/` for the ordered main-window trace referenced by the docs.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { McpClient, paths } from './mcp-client.mjs';

const LEARN = path.join(paths.WORKSPACE, '.learn');

async function main() {
  const client = new McpClient();
  await client.initialize();
  const log = [];
  const record = (name, data) => {
    log.push({ at: new Date().toISOString(), step: name, ...data });
    console.log(`• ${name}`, JSON.stringify(data).slice(0, 240));
  };
  const step = async (label, note, title) => {
    const r = await client.callToolJson('gaea_step', title ? { label, note, title } : { label, note });
    record(`step:${label}`, r.data ?? { error: r.text.slice(0, 200) });
    return r.data;
  };

  try {
    const status = await client.callToolJson('gaea_status');
    const running = (status.data?.processes ?? []).some((p) => /^Gaea$/i.test(p.ProcessName ?? p.name ?? ''));
    record('status', { running, processes: (status.data?.processes ?? []).length });
    if (!running) {
      const launched = await client.callToolJson('gaea_launch', { waitSeconds: 40 });
      record('launch', { isError: launched.isError });
      if (launched.isError) throw new Error(launched.text);
    }

    // 1 — baseline ------------------------------------------------------------
    await step('main-window', 'Gaea 2.3.1.0 Community 主窗口：菜单栏 / 节点面板 / 3D 视口 / 状态栏');

    // 2 — File menu -----------------------------------------------------------
    const fileMenu = await client.callToolJson('gaea_menu', { menu: 'File', outDir: '.learn/raw/menu-file' });
    record('menu-file', { popups: fileMenu.data?.popupWindows, shots: fileMenu.data?.screenshots?.map((x) => x.file) });
    await step('file-menu', 'File 菜单展开（New/Open/Save/Import/Export/Exit，详见 raw/menu-file）');

    // 3 — Node menu -----------------------------------------------------------
    const nodeMenu = await client.callToolJson('gaea_menu', { menu: 'Node', outDir: '.learn/raw/menu-node' });
    record('menu-node', { popups: nodeMenu.data?.popupWindows, shots: nodeMenu.data?.screenshots?.map((x) => x.file) });
    await step('node-menu', 'Node 菜单展开（Refresh/Bypass/搜索/分组/端口等，详见 raw/menu-node）');

    // 4 — node palette: Terrain flyout (LANDSCAPE / PRIMITIVE sub-categories)
    const terrainClick = await client.callToolJson('gaea_click', { name: 'Terrain', index: 0 });
    record('click-terrain', { clicked: Boolean(terrainClick.data?.clicked), via: terrainClick.data?.via });
    await new Promise((r) => setTimeout(r, 600));
    const palette = await client.callToolJson('gaea_shot_all', { outDir: '.learn/raw/palette-terrain', prefix: 'palette' });
    const paletteWindows = palette.data ?? [];
    record('palette-windows', paletteWindows.map((w) => ({ handle: w.handle, w: w.width, h: w.height, file: w.file })));
    await step('palette-terrain', '节点面板 Terrain 分类展开为二级 flyout（LANDSCAPE/PRIMITIVE，见 raw/palette-terrain）');
    await client.callToolJson('gaea_keys', { text: '{ESC}' });
    await new Promise((r) => setTimeout(r, 300));

    // 5 — About / version dialog ---------------------------------------------
    const about = await client.callToolJson('gaea_click', { automationId: 'bAbout' });
    record('click-about', { clicked: Boolean(about.data?.clicked) });
    await new Promise((r) => setTimeout(r, 900));
    const aboutShot = await client.callToolJson('gaea_shot_all', { outDir: '.learn/raw/about', prefix: 'about' });
    record('about-windows', (aboutShot.data ?? []).map((w) => ({ handle: w.handle, title: w.title, w: w.width, h: w.height, file: w.file })));
    await step('about-dialog', 'About QuadSpinner Gaea（版本 2.3.1.0 Community / Fx 8.0.32）', 'About');
    const aboutTree = await client.callToolJson('gaea_ui_tree', { title: 'About', depth: 8, out: '.learn/raw/tour-05-about.json' });
    record('about-uia', { nodes: aboutTree.data?.nodes?.length ?? 0 });
    await client.callToolJson('gaea_keys', { text: '{ESC}' });
    await new Promise((r) => setTimeout(r, 500));

    // 6 — final state ---------------------------------------------------------
    await step('final-workspace', '巡览结束回到主窗口；全部步骤由 gaea-mcp 驱动');

    const catalog = await client.callToolJson('gaea_node_catalog', { query: 'mountain', limit: 5, full: true });
    record('catalog-mountain', { names: (catalog.data ?? []).map((n) => n.name) });

    await fs.mkdir(LEARN, { recursive: true });
    await fs.writeFile(path.join(LEARN, 'tour.json'), JSON.stringify({ generatedAt: new Date().toISOString(), steps: log }, null, 2), 'utf8');
    console.log(`\ntour complete: ${log.length} records · steps in .learn/steps · raw popups in .learn/raw · log .learn/tour.json`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('tour failed:', err.message);
  process.exitCode = 1;
});

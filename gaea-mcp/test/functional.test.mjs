/**
 * Functional tests for the Gaea MCP server — these drive the REAL running Gaea window.
 *
 * Preconditions: Gaea 2 is running (started outside any file sandbox). If no Gaea window is found the
 * suite skips itself instead of failing, so it can live in the same command as the unit suite on a
 * machine without the app.
 *
 * Run: node --test gaea-mcp/test/functional.test.mjs
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { McpClient, paths } from './mcp-client.mjs';

const LEARN = path.join(paths.WORKSPACE, '.learn');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function pngInfo(file) {
  const buf = await fs.readFile(file);
  assert.deepEqual(buf.subarray(0, 4), PNG_MAGIC, `${file} must be a PNG`);
  return { bytes: buf.length, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('Gaea MCP server (live desktop)', () => {
  let client;
  let hasWindow = false;

  before(async () => {
    client = new McpClient();
    await client.initialize();
    const status = await client.callToolJson('gaea_status');
    hasWindow = Boolean(status.data?.windows?.some((w) => /^Gaea - /.test(w.title ?? '')));
    if (!hasWindow) console.warn('SKIP: no Gaea main window found (start Gaea outside a sandbox first)');
    // Clean start: auxiliary windows (menus, palette flyouts, the F12 Debug Console) steal foreground
    // and confuse window resolution, which makes the menu/palette assertions flaky. Close everything
    // that is not a main frame before the first test.
    const windows = await client.callToolJson('gaea_windows');
    for (const w of windows.data ?? []) {
      if (w.w * w.h < 600_000) {
        await client.callToolJson('gaea_win', { args: ['closewindow', '-Window', String(w.handle)] }).catch(() => {});
      }
    }
    await client.callToolJson('gaea_keys', { text: '{ESC}' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
  });

  after(async () => {
    await client?.close();
  });

  it('reports the running Gaea process and its main window', async (t) => {
    if (!hasWindow) return t.skip('Gaea not running');
    const status = await client.callToolJson('gaea_status');
    assert.equal(status.isError, false);
    assert.ok(status.data.processes.length >= 1, 'at least the main Gaea process');
    const main = status.data.windows.find((w) => /^Gaea - /.test(w.title ?? ''));
    assert.ok(main, 'main window titled "Gaea - <file>"');
    assert.ok(main.w > 1000 && main.h > 700, 'main window should be a large frame');
  });

  it('captures a real main-window screenshot (PNG, plausible size, not blank)', async (t) => {
    if (!hasWindow) return t.skip('Gaea not running');
    const out = path.join(LEARN, 'raw', 'functional-window.png');
    await fs.mkdir(path.dirname(out), { recursive: true });
    const shot = await client.callToolJson('gaea_shot', { out: '.learn/raw/functional-window.png' });
    assert.equal(shot.isError, false, shot.text);
    const info = await pngInfo(out);
    assert.ok(info.width > 1000 && info.height > 700, `unexpected size ${info.width}x${info.height}`);
    assert.ok(info.bytes > 40_000, `PNG is suspiciously small (${info.bytes} bytes) — likely a blank capture`);
  });

  it('exposes the app menus through UI Automation', async (t) => {
    if (!hasWindow) return t.skip('Gaea not running');
    const tree = await client.callToolJson('gaea_ui_tree', { types: 'MenuItem', depth: 12, limit: 200 });
    const names = (tree.data?.nodes ?? []).map((n) => n.name).filter(Boolean);
    for (const menu of ['File', 'Edit', 'Graph', 'Node', 'Preview', 'Project', 'Tools', 'Help']) {
      assert.ok(names.includes(menu), `menu ${menu} missing from UIA tree (got ${names.slice(0, 12).join(', ')})`);
    }
  });

  it('captures a top-level menu popup with menu items visible', async (t) => {
    if (!hasWindow) return t.skip('Gaea not running');
    await client.callToolJson('gaea_keys', { text: '{ESC}' }).catch(() => {});
    const menu = await client.callToolJson('gaea_menu', { menu: 'File', outDir: '.learn/raw/functional-menu' });
    assert.equal(menu.isError, false, menu.text);
    assert.ok((menu.data.popupWindows ?? 0) >= 1, 'a File-menu popup window must appear');
    assert.ok((menu.data.screenshots ?? []).length >= 1, 'the popup must be screenshotted');
    const file = path.join(paths.WORKSPACE, menu.data.screenshots[0].file);
    const info = await pngInfo(file);
    assert.ok(info.width > 150 && info.height > 150, 'menu popup should have several entries');
  });

  it('records numbered .learn steps and grows the manifest', async (t) => {
    if (!hasWindow) return t.skip('Gaea not running');
    const manifest = path.join(LEARN, 'README.md');
    const before = await fs.readFile(manifest, 'utf8').catch(() => '');
    const first = await client.callToolJson('gaea_step', { label: 'functional-step-a', note: '功能测试步骤 A' });
    const second = await client.callToolJson('gaea_step', { label: 'functional-step-b', note: '功能测试步骤 B' });
    assert.equal(first.isError, false);
    assert.equal(second.isError, false);
    const a = path.join(LEARN, first.data.file);
    const b = path.join(LEARN, second.data.file);
    const na = Number(path.basename(a).split('-')[0]);
    const nb = Number(path.basename(b).split('-')[0]);
    assert.equal(nb, na + 1, 'step numbers must increase by one');
    await pngInfo(a);
    const grown = await fs.readFile(manifest, 'utf8');
    assert.ok(grown.length > before.length, 'manifest must grow');
    assert.match(grown, /functional-step-b/);
  });

  it('clicks a node-palette category and sees its flyout windows', async (t) => {
    if (!hasWindow) return t.skip('Gaea not running');
    const click = await client.callToolJson('gaea_click', { name: 'Terrain', index: 0 });
    assert.equal(click.isError, false, click.text);
    assert.equal(click.data.clicked, true);
    const shots = await client.callToolJson('gaea_shot_all', { outDir: '.learn/raw/functional-palette', prefix: 'pal' });
    const windows = shots.data ?? [];
    assert.ok(windows.length >= 2, 'main frame + at least one flyout');
    // the flyout is a small window that the main frame's screenshot cannot contain
    const flyout = windows.find((w) => w.width < 800 && w.height < 800);
    assert.ok(flyout, `expected a palette flyout window, got ${JSON.stringify(windows.map((w) => [w.width, w.height]))}`);
    await pngInfo(path.join(paths.WORKSPACE, flyout.file));
    await client.callToolJson('gaea_keys', { text: '{ESC}' });
  });

  it('serves docs and catalog consistent with the installed version', async (t) => {
    const tech = await client.callToolJson('gaea_docs', { read: 'GAEA-TECHNICAL.md', limit: 200 });
    assert.match(tech.text, /2\.3\.1/);
    const mcpDoc = await client.callToolJson('gaea_docs', { read: 'GAEA-MCP.md', limit: 170 });
    assert.match(mcpDoc.text, /gaea_step/);
    const catalog = await client.callToolJson('gaea_node_catalog', { limit: 1, full: false });
    assert.match(catalog.text, /of 182/);
  });
});


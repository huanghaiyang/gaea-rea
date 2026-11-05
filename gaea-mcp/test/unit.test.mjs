/**
 * Unit tests for the Gaea MCP server.
 *
 * Scope: protocol conformance, tool registration/schemas, catalog + docs tools, and every guard rail
 * that protects the filesystem and the process allowlist. Nothing here needs the Gaea window, so the
 * suite is safe to run in CI.
 *
 * Run: node --test gaea-mcp/test/unit.test.mjs
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { McpClient, paths } from './mcp-client.mjs';

/** Every tool the MCP promises; a missing entry is a breaking change for the agent-facing API. */
const EXPECTED_TOOLS = [
  'gaea_status',
  'gaea_launch',
  'gaea_windows',
  'gaea_shot',
  'gaea_step',
  'gaea_shot_all',
  'gaea_ui_tree',
  'gaea_click',
  'gaea_console',
  'gaea_keys',
  'gaea_mouse',
  'gaea_menu',
  'gaea_node_catalog',
  'gaea_docs',
  'gaea_build',
  'gaea_win',
];

describe('Gaea MCP server (protocol + pure tools)', () => {
  let client;

  before(async () => {
    client = new McpClient();
    await client.initialize();
  });

  after(async () => {
    await client?.close();
  });

  it('answers initialize with the MCP handshake and a tools capability', () => {
    return client.initialize().then((result) => {
      assert.equal(result.protocolVersion, '2024-11-05');
      assert.ok(result.capabilities.tools, 'tools capability must be advertised');
      assert.equal(result.serverInfo.name, 'gaea-mcp');
      assert.match(result.instructions, /\.learn/);
    });
  });

  it('lists all expected tools with valid JSON schemas', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    for (const expected of EXPECTED_TOOLS) assert.ok(names.includes(expected), `missing tool ${expected}`);
    for (const tool of tools) {
      assert.equal(typeof tool.description, 'string');
      assert.ok(tool.description.length > 20, `${tool.name} needs a useful description`);
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(tool.inputSchema.properties, `${tool.name} schema needs properties`);
    }
  });

  it('rejects an unknown JSON-RPC method with -32601', async () => {
    await assert.rejects(() => client.request('does/not/exist', {}), /Method not found/);
  });

  it('reports an unknown tool as an error result instead of crashing', async () => {
    const result = await client.callTool('nope_not_a_tool', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Unknown tool/);
  });

  it('serves the 182-node catalog and filters by name', async () => {
    const all = await client.callToolJson('gaea_node_catalog', { limit: 500, full: false });
    assert.equal(all.isError, false);
    assert.match(all.text, /of 182$/m);

    const mountains = await client.callToolJson('gaea_node_catalog', { query: 'mountain', limit: 10, full: false });
    const names = mountains.data.map((n) => n.name);
    assert.ok(names.includes('Mountain'));
    assert.ok(names.includes('MountainRange'));

    const gradient = await client.callToolJson('gaea_node_catalog', { query: 'gradient', limit: 10, full: true });
    const lg = gradient.data.find((n) => n.name === 'LinearGradient');
    assert.ok(lg, 'LinearGradient must exist in the catalog');
    assert.ok(Array.isArray(lg.parameters) && lg.parameters.length > 0, 'full=true must include parameters');
    assert.ok(lg.parameters.some((p) => p.name === 'Scale'), 'LinearGradient exposes Scale');
  });

  it('lists and reads project documentation, refusing path escapes', async () => {
    const list = await client.callToolJson('gaea_docs', {});
    assert.ok(Array.isArray(list.data));
    assert.ok(list.data.includes('GAEA-TECHNICAL.md'));
    assert.ok(list.data.includes('GAEA-MCP.md'));

    const doc = await client.callToolJson('gaea_docs', { read: 'GAEA-TECHNICAL.md', limit: 40 });
    assert.match(doc.text, /Gaea/);

    const escape = await client.callToolJson('gaea_docs', { read: '..\\..\\Windows\\win.ini' });
    assert.equal(escape.isError, true);
  });

  it('refuses to write screenshots outside the workspace', async () => {
    const result = await client.callToolJson('gaea_shot', { out: '..\\..\\escape.png' });
    assert.equal(result.isError, true);
    assert.match(result.text, /outside the workspace/);
    await assert.rejects(() => fs.access(path.resolve(paths.WORKSPACE, '..', '..', 'escape.png')));
  });

  it('enforces the CLI allowlist for gaea_build', async () => {
    const bad = await client.callToolJson('gaea_build', { exe: 'cmd.exe', args: ['/c', 'whoami'] });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /Refusing to run/);
  });

  it('rejects an empty gaea_win argument vector', async () => {
    const result = await client.callToolJson('gaea_win', { args: [] });
    assert.equal(result.isError, true);
  });

  it('survives a malformed line on the transport', async () => {
    client.child.stdin.write('this is not json\n');
    const ping = await client.request('ping', {});
    assert.deepEqual(ping, {});
  });
});


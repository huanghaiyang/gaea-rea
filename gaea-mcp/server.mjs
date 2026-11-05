#!/usr/bin/env node
/**
 * Gaea MCP server — drives the real Gaea 2 desktop application for an agent.
 *
 * WHY THIS EXISTS
 * Gaea is a WPF desktop app with no HTTP API, so an agent cannot control it through requests. This
 * server is the adapter: it exposes MCP tools that (a) launch/track the app, (b) inspect and click its
 * real UI through Windows UI Automation, (c) capture screenshots into `.learn/` for the replication
 * project, and (d) serve the machine-readable node catalog and technical docs.
 *
 * TRANSPORT
 * stdio, one JSON-RPC 2.0 message per line (MCP conventions): `initialize`, `notifications/initialized`,
 * `tools/list`, `tools/call`, `ping`. No SDK dependency, so the server starts with plain node in the
 * DSH profile where the bundle is installed.
 *
 * DESIGN NOTES
 * The Win32/UIA interop lives in `tools/gaea-win.ps1`; this file only builds arguments, parses the JSON
 * it prints, and shapes MCP responses. Gaea must be started *outside* a restricted file sandbox because
 * it writes its own install directory on startup (a blocked write crashes the .NET process with
 * 0xe0434352, not a friendly error) — `gaea_launch` therefore uses a detached spawn.
 */
import { spawn, execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = process.env.GAEA_WORKSPACE ?? path.resolve(HERE, '..');
const GAEA_DIR = process.env.GAEA_DIR ?? 'D:\\Gaea 2';
const LEARN_DIR = process.env.GAEA_LEARN_DIR ?? path.join(WORKSPACE, '.learn');
const WIN_PS1 = path.join(WORKSPACE, 'tools', 'gaea-win.ps1');
const CATALOG_PATH = path.join(WORKSPACE, 'web', 'data', 'nodes.json');
const DOCS_DIR = path.join(WORKSPACE, 'docs');
const PS = 'powershell.exe';

/** Run one gaea-win.ps1 command and return its parsed JSON (or throw with stderr). */
function win(args, { timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      PS,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WIN_PS1, ...args],
      { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          reject(new Error(`gaea-win ${args[0]} failed: ${(stderr || err.message).trim()}`));
          return;
        }
        const text = String(stdout ?? '').trim();
        const line = text.split(/\r?\n/).filter(Boolean).pop() ?? '';
        if (!line) {
          reject(new Error(`gaea-win ${args[0]} produced no output. stderr: ${(stderr || '').trim()}`));
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`gaea-win ${args[0]} returned non-JSON: ${line.slice(0, 400)}`));
        }
      },
    );
  });
}

async function readCatalog() {
  const raw = JSON.parse(await fs.readFile(CATALOG_PATH, 'utf8'));
  return Array.isArray(raw) ? raw : raw.nodes ?? [];
}

function textResult(text, data) {
  const payload = data === undefined ? text : `${text}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  return { content: [{ type: 'text', text: payload }] };
}

function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Validate a path stays inside the workspace (screenshots must not escape `.learn`). */
function insideWorkspace(p) {
  const abs = path.resolve(p);
  return abs === WORKSPACE || abs.startsWith(WORKSPACE + path.sep);
}

async function stepPath(label) {
  const stepsDir = path.join(LEARN_DIR, 'steps');
  await fs.mkdir(stepsDir, { recursive: true });
  const existing = (await fs.readdir(stepsDir)).filter((f) => f.endsWith('.png')).sort();
  const next = String(existing.length + 1).padStart(2, '0');
  const slug = String(label || 'step').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'step';
  return path.join(stepsDir, `${next}-${slug}.png`);
}

const TOOLS = [
  {
    name: 'gaea_status',
    description: 'Report whether Gaea is running: processes, main window handle/title/rect, and the install path this server is configured with.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      const [processes, windows] = await Promise.all([win(['processes']), win(['list']).catch(() => [])]);
      return textResult('Gaea process/window status', { gaeaDir: GAEA_DIR, workspace: WORKSPACE, processes, windows });
    },
  },
  {
    name: 'gaea_launch',
    description:
      'Start Gaea detached (survives this server) and wait for its main window. Gaea writes its install directory on startup, so it must not run under a file sandbox.',
    inputSchema: {
      type: 'object',
      properties: {
        exe: { type: 'string', description: 'Executable path (default: <gaeaDir>/Gaea.exe)' },
        waitSeconds: { type: 'number', description: 'How long to wait for the main window (default 30)' },
      },
      additionalProperties: false,
    },
    async handler({ exe, waitSeconds = 30 }) {
      const exePath = exe ?? path.join(GAEA_DIR, 'Gaea.exe');
      const child = spawn(exePath, [], { cwd: path.dirname(exePath), detached: true, stdio: 'ignore' });
      child.unref();
      try {
        const w = await win(['wait', '-Window', 'Gaea -', '-TimeoutSec', String(waitSeconds)], { timeout: (waitSeconds + 15) * 1000 });
        return textResult(`Gaea launched (pid ${child.pid})`, w);
      } catch (err) {
        return errorResult(`Launched pid ${child.pid} (${exePath}) but no window appeared: ${err.message}\nGaea needs write access to its install directory; do not run it under a restricted sandbox.`);
      }
    },
  },
  {
    name: 'gaea_windows',
    description: 'List the visible Gaea windows (title, class, handle, screen rect). The largest visible window is the main application.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      return textResult('Gaea windows', await win(['list']));
    },
  },
  {
    name: 'gaea_shot',
    description:
      'Capture the Gaea main window (or a window matching `title`) to a PNG. Defaults to a numbered file under .learn/steps. Uses PrintWindow(PW_RENDERFULLCONTENT), so the window does not need to be foreground.',
    inputSchema: {
      type: 'object',
      properties: {
        out: { type: 'string', description: 'Absolute or workspace-relative output PNG path' },
        title: { type: 'string', description: 'Window title regex/class filter (default: main window)' },
      },
      additionalProperties: false,
    },
    async handler({ out, title }) {
      const target = out ? path.resolve(WORKSPACE, out) : await stepPath('capture');
      if (!insideWorkspace(target)) return errorResult(`Refusing to write outside the workspace: ${target}`);
      const args = ['shot', '-Out', target];
      if (title) args.push('-Window', title);
      const info = await win(args);
      return textResult(`Screenshot saved: ${path.relative(WORKSPACE, target)} (${info.width}x${info.height}, ${info.method})`, info);
    },
  },
  {
    name: 'gaea_shot_all',
    description:
      'Capture EVERY visible Gaea window separately into a directory: the main frame plus the WPF popups Gaea creates for menus and node-palette category flyouts. Use it when the UI state of interest lives in a popup (a main-window screenshot cannot contain another HWND).',
    inputSchema: {
      type: 'object',
      properties: {
        outDir: { type: 'string', description: 'Workspace-relative output directory (default .learn/raw/windows)' },
        prefix: { type: 'string', description: 'File name prefix (default "window")' },
      },
      additionalProperties: false,
    },
    async handler({ outDir = '.learn/raw/windows', prefix = 'window' }) {
      const dir = path.resolve(WORKSPACE, outDir);
      if (!insideWorkspace(dir)) return errorResult(`Refusing to write outside the workspace: ${dir}`);
      const shots = await win(['shotall', '-Out', dir, '-Name', prefix]);
      const list = Array.isArray(shots) ? shots : [shots];
      return textResult(`Captured ${list.length} Gaea window(s)`, list.map((x) => ({ ...x, file: path.relative(WORKSPACE, x.file) })));
    },
  },
  {
    name: 'gaea_step',
    description:
      'Record one workflow step: capture a screenshot into .learn/steps and append a line to the .learn manifest. Use this for every operation so the replication project keeps an ordered visual trace.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Short step label, e.g. "open-file-menu"' },
        note: { type: 'string', description: 'What the step does / what to observe' },
        title: { type: 'string', description: 'Optional window title filter' },
      },
      required: ['label'],
      additionalProperties: false,
    },
    async handler({ label, note, title }) {
      const target = await stepPath(label);
      const args = ['shot', '-Out', target];
      if (title) args.push('-Window', title);
      const info = await win(args);
      const manifest = path.join(LEARN_DIR, 'README.md');
      const rel = path.relative(LEARN_DIR, target).split(path.sep).join('/');
      const line = `- [${path.basename(target)}](steps/${path.basename(target)}) — ${label}${note ? `: ${note}` : ''} (${info.width}x${info.height})\n`;
      let header = '';
      try {
        header = await fs.readFile(manifest, 'utf8');
      } catch {
        header = '# .learn — Gaea UI evidence\n\nEvery screenshot below is a real capture of the running Gaea 2.3.1.0 application. The trace is ordered; `raw/` holds UIA dumps and experiment artifacts.\n\n## Steps\n\n';
        await fs.writeFile(manifest, header, 'utf8');
      }
      await fs.appendFile(manifest, line, 'utf8');
      return textResult(`Step recorded: ${rel}`, { file: rel, window: info.window, size: [info.width, info.height], method: info.method });
    },
  },
  {
    name: 'gaea_ui_tree',
    description:
      'Dump the UI Automation tree of the Gaea window as a flat list (type/name/automationId/bounds/offscreen). Use it to discover controls before clicking. Persist it with `out`.',
    inputSchema: {
      type: 'object',
      properties: {
        depth: { type: 'number', description: 'Max tree depth (default 10)' },
        types: { type: 'string', description: 'Comma separated control types to keep, e.g. "MenuItem,Button"' },
        title: { type: 'string', description: 'Window title filter' },
        out: { type: 'string', description: 'Optional workspace-relative JSON path to save the dump' },
        limit: { type: 'number', description: 'Max entries returned (default 120)' },
      },
      additionalProperties: false,
    },
    async handler({ depth = 10, types, title, out, limit = 120 }) {
      const args = ['uia', '-Depth', String(depth)];
      if (types) args.push('-Types', types);
      if (title) args.push('-Window', title);
      const rows = await win(args);
      if (out) {
        const target = path.resolve(WORKSPACE, out);
        if (!insideWorkspace(target)) return errorResult(`Refusing to write outside the workspace: ${target}`);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, JSON.stringify(rows, null, 2), 'utf8');
      }
      const list = Array.isArray(rows) ? rows : [rows];
      const visible = list.filter((r) => !r.offscreen && (r.name || r.id));
      return textResult(`UIA: ${list.length} nodes (${visible.length} named & onscreen)`, {
        saved: out ? path.relative(WORKSPACE, path.resolve(WORKSPACE, out)) : undefined,
        nodes: visible.slice(0, limit),
      });
    },
  },
  {
    name: 'gaea_click',
    description:
      'Click a Gaea control by accessible name or automationId (UIA Invoke/SelectionItem/Toggle/ExpandCollapse, falling back to a real mouse click at its centre). `index` picks among same-named elements.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Accessible name, e.g. "File" or "Terrain"' },
        automationId: { type: 'string', description: 'AutomationId, e.g. "miFile"' },
        index: { type: 'number', description: 'Index among matches (default 0)' },
        title: { type: 'string', description: 'Window title filter' },
      },
      additionalProperties: false,
    },
    async handler({ name, automationId, index = 0, title }) {
      const args = ['click'];
      if (name) args.push('-Name', name);
      if (automationId) args.push('-AutomationId', automationId);
      args.push('-Index', String(index));
      if (title) args.push('-Window', title);
      return textResult('Clicked control', await win(args));
    },
  },
  {
    name: 'gaea_keys',
    description: 'Send keystrokes (SendKeys syntax, e.g. "{ESC}", "^s", "abc") to the Gaea window after foregrounding it.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, title: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    async handler({ text, title }) {
      const args = ['keys', '-Text', text];
      if (title) args.push('-Window', title);
      return textResult('Sent keys', await win(args));
    },
  },
  {
    name: 'gaea_mouse',
    description: 'Send a real mouse click at window-relative pixel coordinates (use gaea_ui_tree bounds to find targets, then subtract the window origin).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right'] },
        double: { type: 'boolean' },
        title: { type: 'string' },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
    async handler({ x, y, button = 'left', double = false, title }) {
      const args = ['mouse', '-X', String(x), '-Y', String(y), '-Button', button];
      if (double) args.push('-Double');
      if (title) args.push('-Window', title);
      return textResult('Mouse click sent', await win(args));
    },
  },
  {
    name: 'gaea_menu',
    description:
      'Open a top-level Gaea menu and optionally click one of its items by name, capturing the state. Useful for documenting menus and invoking commands (e.g. File > Save).',
    inputSchema: {
      type: 'object',
      properties: {
        menu: { type: 'string', description: 'Top-level menu name: File, Edit, Graph, Node, Preview, Project, Tools, Help' },
        item: { type: 'string', description: 'Optional item name inside the opened menu' },
        shot: { type: 'string', description: 'Optional workspace-relative PNG path for a screenshot' },
      },
      required: ['menu'],
      additionalProperties: false,
    },
    async handler({ menu, item, shot, outDir }) {
      // WPF popups are separate HWNDs that close when the session loses focus, so the click, the UIA
      // read and the popup screenshots all happen in ONE gaea-win.ps1 run.
      const dir = path.resolve(WORKSPACE, outDir ?? `.learn/raw/menu-${String(menu).toLowerCase()}`);
      if (!insideWorkspace(dir)) return errorResult(`Refusing to write outside the workspace: ${dir}`);
      await fs.mkdir(dir, { recursive: true });
      const out = await win(['menu', '-Name', menu, '-Out', dir]);
      const result = {
        menu,
        via: out.via,
        popupWindows: out.windows,
        items: out.items ?? [],
        screenshots: (out.shots ?? []).map((x) => ({ ...x, file: path.relative(WORKSPACE, x.file) })),
      };
      if (shot) {
        const target = path.resolve(WORKSPACE, shot);
        if (!insideWorkspace(target)) return errorResult(`Refusing to write outside the workspace: ${target}`);
        result.mainShot = await win(['shot', '-Out', target]);
      }
      if (item) {
        result.clicked = await win(['click', '-Name', item, '-Index', '0']);
        await new Promise((r) => setTimeout(r, 250));
      }
      return textResult(`Menu ${menu} captured (${result.screenshots.length} popup screenshot(s), ${result.items.length} UIA item(s))`, result);
    },
  },
  {
    name: 'gaea_node_catalog',
    description: 'Search the machine-readable Gaea node catalog (182 nodes extracted from the shipped assemblies): name, category, parameters, defaults and port info.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive name/id substring; empty lists everything' },
        limit: { type: 'number', description: 'Max nodes returned (default 25)' },
        full: { type: 'boolean', description: 'Include parameter details for each node (default true)' },
      },
      additionalProperties: false,
    },
    async handler({ query = '', limit = 25, full = true }) {
      const nodes = await readCatalog();
      const q = query.toLowerCase();
      const hits = nodes.filter((n) => !q || String(n.name ?? '').toLowerCase().includes(q) || String(n.id ?? '').toLowerCase().includes(q));
      const out = hits.slice(0, limit).map((n) => ({
        name: n.name,
        category: n.category,
        subcategory: n.subcategory,
        summary: n.summary,
        parameters: full ? (n.params ?? []).map((p) => ({ name: p.name, type: p.type, default: p.ilDefault ?? p.def ?? p.default ?? null })) : undefined,
      }));
      return textResult(`Node catalog: ${hits.length} match(es), showing ${out.length} of ${nodes.length}`, out);
    },
  },
  {
    name: 'gaea_docs',
    description: 'List or read the project documentation: MCP reference, Gaea technical documentation, and the reverse-engineering notes.',
    inputSchema: {
      type: 'object',
      properties: {
        read: { type: 'string', description: 'Workspace-relative doc path or bare name (e.g. "GAEA-TECHNICAL.md")' },
        limit: { type: 'number', description: 'Max lines returned when reading (default 400)' },
      },
      additionalProperties: false,
    },
    async handler({ read, limit = 400 }) {
      if (!read) {
        const entries = await fs.readdir(DOCS_DIR).catch(() => []);
        const docs = entries.filter((f) => f.endsWith('.md')).sort();
        return textResult(`Docs (${docs.length})`, docs);
      }
      const candidate = path.resolve(DOCS_DIR, path.basename(read));
      if (!candidate.startsWith(DOCS_DIR + path.sep)) return errorResult(`Refusing to read outside docs/: ${read}`);
      const text = await fs.readFile(candidate, 'utf8');
      const lines = text.split(/\r?\n/);
      return textResult(`# ${path.basename(candidate)} (${lines.length} lines${lines.length > limit ? `, first ${limit}` : ''})\n\n${lines.slice(0, limit).join('\n')}`);
    },
  },
  {
    name: 'gaea_build',
    description:
      'Try a headless Gaea build through the shipped CLI tools and report exactly what happens (output, exit code). Documents the current headless capability rather than pretending it works.',
    inputSchema: {
      type: 'object',
      properties: {
        exe: { type: 'string', description: 'CLI executable basename (default Gaea.BuildManager.exe)' },
        args: { type: 'array', items: { type: 'string' }, description: 'Arguments' },
        timeoutSeconds: { type: 'number', description: 'Default 120' },
      },
      additionalProperties: false,
    },
    async handler({ exe = 'Gaea.BuildManager.exe', args = [], timeoutSeconds = 120 }) {
      const allowed = new Set(['Gaea.BuildManager.exe', 'Gaea.Dt.exe', 'Gaea.Dv.exe', 'Gaea.Nv.exe', 'Gaea.Observer.exe', 'Gaea.exe']);
      if (!allowed.has(exe)) return errorResult(`Refusing to run ${exe}; allowed: ${[...allowed].join(', ')}`);
      const exePath = path.join(GAEA_DIR, exe);
      try {
        const result = await new Promise((resolve) => {
          execFile(exePath, args, { cwd: GAEA_DIR, timeout: timeoutSeconds * 1000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({ exitCode: err?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
          });
        });
        return textResult(`${exe} ${args.join(' ')} → exit ${result.exitCode}`, result);
      } catch (err) {
        return errorResult(`${exe} failed to start: ${err.message}`);
      }
    },
  },
  {
    name: 'gaea_console',
    description:
      'Run a command in Gaea\'s built-in Debug Console (Tools > Console, F12) and return the TEXT output. The console exposes its log and input as UI Automation Edit controls, so this reads output without OCR. Known commands: help, list, stats, learn, ping, addresource, cls/clear, deactivate, uninstall.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Console command line, e.g. "help" or "stats"' },
        screenshot: { type: 'boolean', description: 'Also capture the console window (default false)' },
        timeoutMs: { type: 'number', description: 'Wait for output (default 900)' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    async handler({ command, screenshot = false, timeoutMs = 900 }) {
      const title = 'Gaea Debug Console';
      let open = true;
      try {
        await win(['find', '-Window', title]);
      } catch {
        open = false;
      }
      if (!open) {
        await win(['keys', '-Text', '{F12}']);
        await new Promise((r) => setTimeout(r, 1000));
      }
      const read = async () => (await win(['value', '-Window', title, '-AutomationId', 'txtLog'])).value ?? '';
      const before = await read();
      await win(['setvalue', '-Window', title, '-AutomationId', 'txtCommand', '-Text', command]);
      await win(['keys', '-Window', title, '-Text', '{ENTER}']);
      await new Promise((r) => setTimeout(r, timeoutMs));
      const after = await read();
      // the log is append-only; the new command's output is the suffix
      let output = after.length >= before.length ? after.slice(before.length) : after;
      output = output.replace(/\s*[█▒]\s*$/u, '').trim();
      const result = { command, output, logLength: after.length };
      if (screenshot) {
        const target = await stepPath('console-' + String(command).replace(/[^a-z0-9]+/gi, '-'));
        result.shot = await win(['shot', '-Out', target, '-Window', title]);
        result.shot.file = path.relative(WORKSPACE, target);
      }
      return textResult(`console> ${command}\n${output}`, result);
    },
  },
  {
    name: 'gaea_win',
    description: 'Low-level escape hatch: call tools/gaea-win.ps1 directly with a command and extra args (e.g. ["uia","-Types","Button"]). Prefer the typed tools.',
    inputSchema: {
      type: 'object',
      properties: {
        args: { type: 'array', items: { type: 'string' }, description: 'Full argument vector for gaea-win.ps1' },
      },
      required: ['args'],
      additionalProperties: false,
    },
    async handler({ args }) {
      if (!Array.isArray(args) || args.length === 0) return errorResult('args must be a non-empty array');
      return textResult(`gaea-win.ps1 ${args.join(' ')}`, await win(args));
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

async function handleToolCall(name, args) {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return errorResult(`Unknown tool: ${name}. Known: ${[...TOOLS_BY_NAME.keys()].join(', ')}`);
  try {
    return await tool.handler(args ?? {});
  } catch (err) {
    return errorResult(`${name} failed: ${err.message}`);
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'gaea-mcp', version: '0.1.0' },
        instructions:
          'Drives the real Gaea 2 desktop app. Start with gaea_status, launch with gaea_launch, take screenshots with gaea_step after each operation (they go to .learn/steps and are indexed in .learn/README.md). Gaea needs write access to its install directory.',
      },
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return undefined;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') {
    return send({
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) },
    });
  }
  if (method === 'tools/call') {
    const result = await handleToolCall(params?.name, params?.arguments);
    return send({ jsonrpc: '2.0', id, result });
  }
  return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    process.stderr.write(`gaea-mcp: ignoring non-JSON line: ${trimmed.slice(0, 200)}\n`);
    return;
  }
  void handle(message).catch((err) => {
    process.stderr.write(`gaea-mcp: ${err.stack ?? err.message}\n`);
    if (message.id !== undefined) {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: String(err.message ?? err) } });
    }
  });
});
process.stderr.write(`gaea-mcp ready (workspace=${WORKSPACE}, gaeaDir=${GAEA_DIR})\n`);

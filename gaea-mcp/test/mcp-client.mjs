/**
 * Minimal MCP stdio client used by the Gaea MCP tests.
 *
 * The tests must exercise the real protocol (initialize → tools/list → tools/call), not the handler
 * functions in-process, otherwise a broken transport would still pass. This client spawns
 * `server.mjs` exactly the way the Harness profile does and speaks one JSON-RPC message per line.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..', 'server.mjs');
const WORKSPACE = path.resolve(HERE, '..', '..');

export class McpClient {
  constructor({ env = {} } = {}) {
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.child = spawn(process.execPath, [SERVER], {
      cwd: WORKSPACE,
      env: { ...process.env, GAEA_WORKSPACE: WORKSPACE, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString();
    });
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const entry = this.pending.get(message.id);
      if (entry) {
        this.pending.delete(message.id);
        entry.resolve(message);
      }
    });
  }

  request(method, params, { timeout = 180_000 } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out after ${timeout}ms`));
      }, timeout);
      this.pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          if (message.error) reject(new Error(`${method}: ${message.error.message}`));
          else resolve(message.result);
        },
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'gaea-mcp-tests', version: '1' },
    });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    return result;
  }

  listTools() {
    return this.request('tools/list', {});
  }

  /** Call a tool and return the raw MCP tool result (content + optional isError). */
  callTool(name, args = {}) {
    return this.request('tools/call', { name, arguments: args });
  }

  /** Call a tool and parse the ```json fenced block the server appends, if present. */
  async callToolJson(name, args = {}) {
    const result = await this.callTool(name, args);
    const text = result?.content?.[0]?.text ?? '';
    const match = text.match(/```json\n([\s\S]*?)\n```/);
    return {
      isError: Boolean(result?.isError),
      text,
      data: match ? JSON.parse(match[1]) : undefined,
    };
  }

  async close() {
    try {
      this.rl.close();
      this.child.stdin.end();
      this.child.kill();
    } catch {
      /* already gone */
    }
  }
}

export const paths = { SERVER, WORKSPACE };

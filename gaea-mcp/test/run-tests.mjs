/**
 * Runs the Gaea MCP test suites.
 *
 * Unit tests always run. Functional tests need the real Gaea desktop app; when it is not running they
 * skip themselves, so this script is safe in either state. Exit code is non-zero only for real failures.
 *
 * Usage: node gaea-mcp/test/run-tests.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function run(suite) {
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync(process.execPath, ['--test', path.join(HERE, suite)], {
    stdio: 'inherit',
    cwd: path.resolve(HERE, '..', '..'),
  });
  return result.status ?? 1;
}

const unit = run('unit.test.mjs');
const functional = run('functional.test.mjs');
process.exitCode = unit !== 0 ? unit : functional;

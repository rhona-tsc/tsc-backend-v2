import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('real controller preserves recipient, fee and contact restrictions without live sends', () => {
  const output = execFileSync(process.execPath, ['--experimental-test-module-mocks',
    fileURLToPath(new URL('../scripts/test-fixtures/availabilityDispatchController.fixture.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 20000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test',
      DOTENV_CONFIG_PATH: '/dev/null', SUPPRESS_NO_CONFIG_WARNING: 'true' },
  });
  assert.match(output, /No live messages or database/);
});

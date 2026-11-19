import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Availability from '../models/availabilityModel.js';

test('actual reply handler invites only the phone-matched calendar contact, never a namesake', () => {
  const output = execFileSync(process.execPath, ['--experimental-test-module-mocks',
    fileURLToPath(new URL('../scripts/test-fixtures/availabilityReplyCalendar.fixture.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 20000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test',
      DOTENV_CONFIG_PATH: '/dev/null', SUPPRESS_NO_CONFIG_WARNING: 'true' },
  });
  assert.match(output, /No live messages or database/);
});
test('verified calendar email and a missing-identity hold survive schema validation', () => {
  const value = new Availability({ musicianEmail: 'CORRECT@Example.test',
    calendarInviteIdentityHoldReason: 'No verified contact' }).toObject();
  assert.equal(value.musicianEmail, 'correct@example.test');
  assert.equal(value.calendarInviteIdentityHoldReason, 'No verified contact');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { deputyJobManagerGuard } from '../middleware/deputyJobManager.js';

const id = '507f1f77bcf86cd799439011';
async function check(user, record = { createdBy: 'owner' }, requestedId = id) {
  let passed = false;
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await deputyJobManagerGuard(async () => record)({ params: { id: requestedId }, user }, res, () => { passed = true; });
  return { passed, code: res.code };
}
test('job management blocks anonymous/unrelated accounts and allows verified staff and owners', async () => {
  assert.deepEqual(await check(undefined), { passed: false, code: 403 });
  assert.deepEqual(await check({ id: 'other', role: 'musician' }), { passed: false, code: 403 });
  for (const user of [{ id: 'owner' }, { role: 'admin' }, { role: 'agent' }]) {
    assert.deepEqual(await check(user), { passed: true, code: 200 });
  }
});
test('invalid and missing jobs fail closed', async () => {
  assert.deepEqual(await check({ role: 'admin' }, null), { passed: false, code: 404 });
  assert.deepEqual(await check({ role: 'admin' }, {}, 'invalid'), { passed: false, code: 400 });
});

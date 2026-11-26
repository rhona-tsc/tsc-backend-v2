import test from 'node:test';
import assert from 'node:assert/strict';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';
import { renameOriginalProject, buildOriginalProjectRenamedEmail } from '../controllers/originalsRenameController.js';
import { deliverOriginalProjectEmails } from '../services/originalsProjectEmailService.js';
import Email from '../models/originalProjectEmailModel.js';

const id = '111111111111111111111111', owner = '222222222222222222222222', waiting = '333333333333333333333333';
function setup(t) {
  return originalsTransactionStore(t, {
    projects: [{ _id: id, ownerId: owner, title: 'Woke Up', description: 'Original brief', state: 'role_round_open', moderation: { status: 'approved' } }],
    futures: [{ projectId: id, musicianId: waiting, roleName: 'Guitar', state: 'waiting' }, { projectId: id, musicianId: waiting, roleName: 'Bass', state: 'waiting' }, { projectId: id, musicianId: 'released', state: 'released' }],
    musicians: [{ _id: owner, email: 'owner@example.test', profileDeletedAt: null }, { _id: waiting, email: 'waiting@example.test', profileDeletedAt: null }],
  });
}
async function edit(store, title, description, user = { id: owner }, expected = {}) {
  const project = store.data.projects[0];
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await renameOriginalProject({ params: { id }, user, body: { title, description, expectedTitle: project.title, expectedDescription: project.description, ...expected } }, res);
  return res;
}
test('title and description edits coalesce into one delayed email per person', async t => {
  const store = setup(t);
  let res = await edit(store, 'Wide Awake', 'Original brief');
  assert.equal(res.code, 200); assert.equal(store.data.emails.length, 2);
  assert.ok(+store.data.emails[0].sendAfter >= Date.now() + 899000);
  store.data.emails.forEach(job => { job.sendAfter = new Date(Date.now() + 1000); });
  res = await edit(store, 'Wide Awake', 'New brief');
  assert.equal(res.code, 200); assert.equal(store.data.emails.length, 2);
  assert.ok(store.data.emails.every(job => job.state === 'queued' && +job.sendAfter >= Date.now() + 899000));
  assert.match(store.data.emails[0].text, /Woke Up.*Wide Awake/);
  assert.match(store.data.emails[0].text, /Original brief/); assert.match(store.data.emails[0].text, /New brief/);
});
test('reverting all changes cancels the pending emails', async t => {
  const store = setup(t);
  await edit(store, 'Wide Awake', 'New brief');
  await edit(store, 'Woke Up', 'Original brief');
  assert.ok(store.data.emails.every(job => job.state === 'cancelled'));
});
test('an identical retry creates no additional email or audit entry', async t => {
  const store = setup(t); await edit(store, 'Wide Awake', 'New brief');
  const deadline = +store.data.emails[0].sendAfter;
  await edit(store, 'Wide Awake', 'New brief');
  assert.equal(store.data.emails.length, 2); assert.equal(store.data.events.length, 1);
  assert.equal(+store.data.emails[0].sendAfter, deadline);
});
test('unauthorised and stale updates cannot change details or queue mail', async t => {
  const store = setup(t);
  assert.equal((await edit(store, 'New', 'Brief', { id: waiting })).code, 403);
  assert.equal((await edit(store, 'New', 'Brief', { id: owner }, { expectedDescription: 'Outdated' })).code, 409);
  assert.equal(store.data.projects[0].title, 'Woke Up'); assert.equal(store.data.emails.length, 0);
});
test('queue failure rolls back the project edit', async t => {
  const store = setup(t); t.mock.method(Email, 'updateOne', async () => { throw Error('Queue unavailable'); });
  assert.equal((await edit(store, 'New', 'Brief')).code, 500);
  assert.equal(store.data.projects[0].title, 'Woke Up');
});
test('delivery waits for the quiet window and excludes released advance holders', async t => {
  const store = setup(t); await edit(store, 'Wide Awake', 'New brief');
  let sends = 0;
  await deliverOriginalProjectEmails({ emailSender: async () => { sends++; return { ok: true }; } });
  assert.equal(sends, 0);
  store.data.futures.forEach(item => { item.state = 'released'; });
  await deliverOriginalProjectEmails({ now: new Date(Date.now() + 16 * 60000), emailSender: async () => { sends++; return { ok: true }; } });
  assert.equal(sends, 1);
  assert.equal(store.data.emails.find(job => job.to === 'waiting@example.test').state, 'cancelled');
});
test('update email escapes descriptions and links to the stable project address', () => {
  const email = buildOriginalProjectRenamedEmail({ project: { _id: id, title: 'New', description: '<script>bad</script>' }, oldTitle: 'Old', oldDescription: 'Before' });
  assert.doesNotMatch(email.html, /<script>/); assert.match(email.html, /&lt;script&gt;/); assert.match(email.html, new RegExp(`/originals/${id}`));
});

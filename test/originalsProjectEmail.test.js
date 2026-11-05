import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOriginalProjectModerationEmail, queueOriginalProjectModerationEmail, queueOriginalProjectLaunchEmails, deliverOriginalProjectEmails } from '../services/originalsProjectEmailService.js';

const now = new Date('2026-11-05T12:00:00Z');
const project = () => ({ _id: 'project1', title: '<Original song>', ownerName: 'Example Owner', ownerEmail: 'owner@example.test', description: '<script>alert(1)</script>', requestedRoles: [{ name: 'Bass' }], genres: ['Soul'], state: 'pending_moderation', moderation: { status: 'pending', submittedAt: now } });
const musicianRepository = { find: () => ({ select: () => ({ lean: async () => [{ email: 'outsider@example.test' }, { email: 'tsc-test@gmail.com' }] }) }) };
function repositories(initial = project()) {
  const jobs = new Map(); let current = initial;
  const emailRepository = {
    async updateOne(filter, update) {
      if (update.$setOnInsert) {
        if (!jobs.has(filter.eventKey)) jobs.set(filter.eventKey, { _id: `job${jobs.size}`, state: 'queued', sendAfter: now, attempts: 0, ...update.$setOnInsert });
      } else {
        const job = [...jobs.values()].find(job => job._id === filter._id && job.state === filter.state && job.leaseToken === filter.leaseToken);
        if (job) Object.assign(job, update.$set);
      }
    },
    findOneAndUpdate(filter, update) { return { lean: async () => {
      const time = filter.$or[0].sendAfter.$lte;
      const job = [...jobs.values()].find(job => job.state === 'queued' && job.sendAfter <= time || job.state === 'sending' && job.leaseExpiresAt <= time);
      if (!job) return null;
      Object.assign(job, update.$set); job.attempts++;
      return { ...job };
    } }; },
  };
  const projectRepository = {
    find(filter) { return { lean: async () => current && (filter.state === 'pending_moderation' ? current.state === filter.state && current.moderation.status === 'pending' : current.moderation.status === 'approved' && current.moderation.launchEmailPending) ? [current] : [] }; },
    findById: () => ({ lean: async () => current }),
    async updateOne() { current.moderation.launchEmailPending = false; },
  };
  const submissionRepository = { find: () => ({ limit: () => ({ lean: async () => [] }) }) };
  return { jobs, emailRepository, projectRepository, musicianRepository, submissionRepository, setProject(value) { current = value; } };
}

test('moderation alert contains an escaped brief and a direct review link', () => {
  const message = buildOriginalProjectModerationEmail(project());
  assert.match(message.text, /Bass/); assert.match(message.text, /Soul/); assert.match(message.text, /owner@example.test/);
  assert.match(message.html, /&lt;script&gt;/); assert.doesNotMatch(message.html, /<script>/);
  assert.match(message.html, /originals\/moderation#project-project1/);
});
test('repeated submissions enqueue once, while a genuine resubmission creates a new alert', async () => {
  const repo = repositories(); const p = project();
  await queueOriginalProjectModerationEmail({ project: p, ...repo });
  await queueOriginalProjectModerationEmail({ project: p, ...repo });
  assert.equal(repo.jobs.size, 1);
  p.moderation.submittedAt = new Date(now.getTime() + 1000);
  await queueOriginalProjectModerationEmail({ project: p, ...repo });
  assert.equal(repo.jobs.size, 2);
  assert.ok([...repo.jobs.values()].every(job => job.to === 'hello@thesupremecollective.co.uk'));
});
test('launch queue preserves the preview audience and deduplicates per recipient', async () => {
  const repo = repositories();
  await queueOriginalProjectLaunchEmails({ project: project(), ...repo });
  await queueOriginalProjectLaunchEmails({ project: project(), ...repo });
  assert.equal(repo.jobs.size, 4);
  assert.ok([...repo.jobs.values()].every(job => job.to !== 'outsider@example.test'));
});
test('worker repairs missing submission alerts and does not redeliver sent mail', async () => {
  const repo = repositories(); let sends = 0;
  const emailSender = async message => { assert.equal(message.to, 'hello@thesupremecollective.co.uk'); sends++; return { ok: true }; };
  await deliverOriginalProjectEmails({ ...repo, emailSender, now });
  await deliverOriginalProjectEmails({ ...repo, emailSender, now });
  assert.equal(sends, 1); assert.equal([...repo.jobs.values()][0].state, 'sent');
});
test('SMTP failures retry after five minutes and retain the project decision', async () => {
  const repo = repositories(); let sends = 0;
  const emailSender = async () => ({ ok: ++sends > 1, error: 'Temporarily unavailable' });
  await deliverOriginalProjectEmails({ ...repo, emailSender, now });
  let job = [...repo.jobs.values()][0]; assert.equal(job.state, 'queued'); assert.equal(job.attempts, 1);
  await deliverOriginalProjectEmails({ ...repo, emailSender, now }); assert.equal(sends, 1);
  await deliverOriginalProjectEmails({ ...repo, emailSender, now: new Date(now.getTime() + 300000) });
  job = [...repo.jobs.values()][0]; assert.equal(job.state, 'sent'); assert.equal(job.attempts, 2);
});
test('worker cancels outdated, resolved and deleted project alerts', async () => {
  for (const change of [p => { p.moderation.submittedAt = new Date(now.getTime() + 1000); }, p => { p.state = 'foundation_open'; p.moderation.status = 'approved'; }, () => null]) {
    const repo = repositories(); const p = project();
    await queueOriginalProjectModerationEmail({ project: p, ...repo });
    repo.setProject(change(p) === null ? null : p);
    let sends = 0;
    await deliverOriginalProjectEmails({ ...repo, emailSender: async () => { sends++; return { ok: true }; }, now, limit: 1 });
    assert.equal(sends, 0); assert.equal([...repo.jobs.values()][0].state, 'cancelled');
  }
});
test('worker repairs launch queue interruptions without emailing successful recipients twice', async () => {
  const p = project(); p.state = 'foundation_open'; p.moderation.status = 'approved'; p.moderation.launchEmailPending = true;
  const repo = repositories(p); const recipients = [];
  await deliverOriginalProjectEmails({ ...repo, emailSender: async message => { recipients.push(message.to); return { ok: true }; }, now });
  assert.equal(p.moderation.launchEmailPending, false); assert.equal(recipients.length, 4);
  await deliverOriginalProjectEmails({ ...repo, emailSender: async () => { throw new Error('Should not send again'); }, now });
  assert.equal(repo.jobs.size, 4);
});
test('expired delivery leases are recovered, while active leases cannot be claimed', async () => {
  const repo = repositories(); await queueOriginalProjectModerationEmail({ project: project(), ...repo });
  const job = [...repo.jobs.values()][0]; job.state = 'sending'; job.leaseExpiresAt = new Date(now.getTime() + 1000);
  let sends = 0; const emailSender = async () => { sends++; return { ok: true }; };
  await deliverOriginalProjectEmails({ ...repo, emailSender, now }); assert.equal(sends, 0);
  await deliverOriginalProjectEmails({ ...repo, emailSender, now: new Date(now.getTime() + 1001) }); assert.equal(sends, 1);
});
test('delivery stops retrying after five failed attempts', async t => {
  t.mock.method(console, 'error', () => {});
  const repo = repositories(); let sends = 0;
  for (let attempt = 0; attempt < 6; attempt++) await deliverOriginalProjectEmails({ ...repo, emailSender: async () => { sends++; throw new Error('SMTP failure'); }, now: new Date(now.getTime() + 300000 * attempt) });
  assert.equal(sends, 5); assert.equal([...repo.jobs.values()][0].state, 'failed');
});

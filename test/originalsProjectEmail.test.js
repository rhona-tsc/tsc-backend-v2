import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOriginalProjectModerationEmail, queueOriginalProjectModerationEmail, queueOriginalProjectLaunchEmails, deliverOriginalProjectEmails } from '../services/originalsProjectEmailService.js';

const now = new Date('2026-11-05T12:00:00Z');
const project = () => ({ _id: 'project1', title: '<Original song>', ownerName: 'Example Owner', ownerEmail: 'owner@example.test', description: '<script>alert(1)</script>', requestedRoles: [{ name: 'Bass' }], genres: ['Soul'], state: 'pending_moderation', moderation: { status: 'pending', submittedAt: now } });
const musicians = [{ _id: 'musician1', email: 'ordinary@gmail.com', firstName: 'Sam', role: 'musician', status: 'approved' }, { _id: 'test', email: 'tsc-test@gmail.com', role: 'musician', status: 'approved', privateTestProfile: true }];
const musicianRepository = {
  find: () => ({ select: () => ({ lean: async () => musicians }) }),
  findById: id => ({ select: () => ({ lean: async () => musicians.find(item => item._id === id) }) }),
};
const preferenceRepository = { find: () => ({ lean: async () => [] }) };
function repositories(initial = project()) {
  const jobs = new Map(); let current = initial;
  const assetRepository = { findOne: () => ({ sort: () => ({ lean: async () => null }) }) };
  const emailRepository = {
    async updateMany(_filter, update) { for (const job of jobs.values()) if (job.kind === 'launch' && job.state === 'queued') Object.assign(job, update.$set); },
    async updateOne(filter, update) {
      if (update.$setOnInsert) {
        if (jobs.has(filter.eventKey)) return { upsertedCount: 0 };
        jobs.set(filter.eventKey, { _id: `job${jobs.size}`, state: 'queued', sendAfter: now, attempts: 0, ...update.$setOnInsert });
        return { upsertedCount: 1 };
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
  return { jobs, emailRepository, projectRepository, musicianRepository, preferenceRepository, assetRepository, submissionRepository, setProject(value) { current = value; } };
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
test('launch queue reaches ordinary approved musicians and deduplicates per recipient', async () => {
  const repo = repositories();
  await queueOriginalProjectLaunchEmails({ project: project(), ...repo });
  await queueOriginalProjectLaunchEmails({ project: project(), ...repo });
  assert.equal(repo.jobs.size, 1);
  assert.deepEqual([...repo.jobs.values()].map(job => job.to), ['ordinary@gmail.com']);
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
  assert.equal(p.moderation.launchEmailPending, false); assert.equal(recipients.length, 1);
  await deliverOriginalProjectEmails({ ...repo, emailSender: async () => { throw new Error('Should not send again'); }, now });
  assert.equal(repo.jobs.size, 1);
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

test('launch queue excludes Originals opt-outs and preserves provider receipts', async () => {
  const repo = repositories();
  const { musicianEmailHash } = await import('../utils/musicianEmailPreferences.js');
  await queueOriginalProjectLaunchEmails({ project: project(), ...repo, preferenceRepository: { find: () => ({ lean: async () => [{ emailHash: musicianEmailHash('ordinary@gmail.com'), originalsOpportunities: false }] }) } });
  assert.equal(repo.jobs.size, 0);
  const p = project(); p.state = 'role_round_open'; p.moderation.status = 'approved'; repo.setProject(p);
  await queueOriginalProjectLaunchEmails({ project: p, ...repo });
  await deliverOriginalProjectEmails({ ...repo, now, emailSender: async () => ({ ok: true, messageId: '<provider-receipt>' }) });
  const job = [...repo.jobs.values()][0]; assert.equal(job.messageId, '<provider-receipt>'); assert.ok(job.sentAt);
});
test('an ineligible profile or changed email cancels a queued opportunity at delivery', async () => {
  for (const changed of [{role:'musician',status:'rejected',email:'ordinary@gmail.com'}, {role:'musician',status:'approved',email:'changed@gmail.com'}]) {
    const p = project(); p.state = 'role_round_open'; p.moderation.status = 'approved'; const repo = repositories(p);
    await queueOriginalProjectLaunchEmails({project:p,...repo});
    let sent = 0;
    await deliverOriginalProjectEmails({...repo,now,musicianRepository:{...musicianRepository,findById:()=>({select:()=>({lean:async()=>changed})})},emailSender:async()=>{sent++;return{ok:true};}});
    assert.equal(sent,0); assert.equal([...repo.jobs.values()][0].state,'cancelled');
  }
});
test('the administrator announcement action reuses the queue and cannot resend completed notifications',async()=>{
 const {sendOriginalProjectApprovedNotifications}=await import('../services/originalsNotificationService.js');
 const repo=repositories();const first=await sendOriginalProjectApprovedNotifications({project:project(),...repo});
 assert.equal(first.queued,1);const job=[...repo.jobs.values()][0];job.state='sent';job.messageId='<confirmed>';
 const repeated=await sendOriginalProjectApprovedNotifications({project:project(),...repo});
 assert.equal(repeated.queued,0);assert.equal(repo.jobs.size,1);assert.equal(job.state,'sent');assert.equal(job.messageId,'<confirmed>');
});
test('a Google login throttle stops the batch and defers remaining announcements for an hour',async()=>{
 const p=project();p.state='role_round_open';p.moderation.status='approved';const repo=repositories(p);
 await queueOriginalProjectLaunchEmails({project:p,...repo});let calls=0;
 const result=await deliverOriginalProjectEmails({...repo,now,emailSender:async()=>{calls++;return{ok:false,error:'Invalid login: 454-4.7.0 Too many login attempts, please try again later.'};}});
 assert.equal(calls,1);assert.equal(+result.deferredUntil,+now+3600000);
 const job=[...repo.jobs.values()][0];assert.equal(job.state,'queued');assert.equal(+job.sendAfter,+now+3600000);
 await deliverOriginalProjectEmails({...repo,now,emailSender:async()=>{throw new Error('Cooldown must not be bypassed');}});
 assert.equal(job.attempts,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverOriginalProjectEmails } from '../services/originalsProjectEmailService.js';
import { buildOriginalSubmissionConfirmationEmail } from '../utils/originalsSubmissionConfirmationEmail.js';

const now = new Date('2026-11-05T20:00:00Z');
function fixture() {
  const project = { _id: 'project', ownerId: 'owner', title: '<A song>', state: 'instrument_open', moderation: { status: 'approved' } };
  const submission = { _id: 'take', projectId: 'project', musicianId: 'musician', roleName: 'Drums', category: 'contribution', state: 'submitted', revision: 1, ownerNotificationPending: true, submitterConfirmationPending: true };
  const profiles = { owner: { email: 'owner@example.test' }, musician: { email: 'Musician@Example.test', firstName: '<Sam>' } };
  const jobs = new Map(), sent = [];
  const emailRepository = {
    async updateOne(filter, update) {
      if (update.$setOnInsert) {
        if (!jobs.has(filter.eventKey)) jobs.set(filter.eventKey, { _id: `job${jobs.size}`, state: 'queued', sendAfter: now, attempts: 0, ...update.$setOnInsert });
      } else {
        const job = [...jobs.values()].find(row => row._id === filter._id && row.state === filter.state && row.leaseToken === filter.leaseToken);
        if (job) Object.assign(job, update.$set);
      }
    },
    findOneAndUpdate(filter, update) { return { lean: async () => {
      const time = filter.$or[0].sendAfter.$lte;
      const job = [...jobs.values()].find(row => row.state === 'queued' && row.sendAfter <= time || row.state === 'sending' && row.leaseExpiresAt <= time);
      if (!job) return null;
      Object.assign(job, update.$set); job.attempts++; return { ...job };
    } }; },
  };
  const projectRepository = { find: () => ({ lean: async () => [] }), findById: () => ({ lean: async () => project }) };
  const musicianRepository = { findById: id => ({ select: () => ({ lean: async () => profiles[id] || null }) }) };
  const submissionRepository = {
    find: filter => ({ limit: () => ({ lean: async () => Object.entries(filter).every(([key, value]) => submission[key] === value) ? [{ ...submission }] : [] }) }),
    findById: () => ({ lean: async () => ({ ...submission }) }),
    async updateOne(filter, update) { if (submission.revision === filter.revision) Object.assign(submission, update.$set); },
  };
  const emailSender = async mail => { sent.push(mail); return { ok: true }; };
  return { project, submission, profiles, jobs, sent, emailRepository, projectRepository, musicianRepository, submissionRepository, emailSender };
}

test('confirmation is branded, escaped, clearly a receipt and links to the workspace', () => {
  const f = fixture();
  const mail = buildOriginalSubmissionConfirmationEmail({ project: f.project, submission: f.submission, firstName: '<Sam>' });
  assert.match(mail.subject, /Submission received: Drums/);
  assert.match(mail.html, /&lt;Sam&gt;/); assert.match(mail.html, /&lt;A song&gt;/);
  assert.doesNotMatch(mail.html, /<Sam>|<A song>|href="https:\/\/res\.cloudinary/);
  assert.match(mail.text, /Selection is confirmed separately/);
  assert.match(mail.html, /View the project/); assert.match(mail.text, /\/originals\/project/);
  assert.match(mail.html, /TSC ORIGINALS/); assert.match(mail.text, /16883956/);
  for (const category of ['mix', 'master']) {
    const production = buildOriginalSubmissionConfirmationEmail({ project: f.project, submission: { ...f.submission, category, revision: 2 } });
    assert.match(production.html, new RegExp(`Your updated ${category} has been submitted`));
  }
});

test('successful submissions send separate owner and musician emails exactly once across reconciliations', async () => {
  const f = fixture();
  await Promise.all([deliverOriginalProjectEmails({ ...f, now }), deliverOriginalProjectEmails({ ...f, now })]);
  await deliverOriginalProjectEmails({ ...f, now });
  assert.equal(f.jobs.size, 2); assert.equal(f.sent.length, 2);
  const receipt = f.sent.find(mail => mail.to === 'musician@example.test');
  assert.match(receipt.subject, /Submission received/); assert.doesNotMatch(receipt.text, /owner@example.test/);
  assert.match(f.sent.find(mail => mail.to === 'owner@example.test').subject, /submission to review/);
  assert.equal(f.submission.submitterConfirmationPending, false);
});

test('SMTP failure keeps the take submitted and retries the receipt to the current musician email', async () => {
  const f = fixture(); f.submission.ownerNotificationPending = false;
  await deliverOriginalProjectEmails({ ...f, now, emailSender: async () => ({ ok: false, error: 'SMTP unavailable' }) });
  assert.equal(f.submission.state, 'submitted'); assert.equal([...f.jobs.values()][0].state, 'queued');
  f.profiles.musician.email = 'new-musician@example.test';
  await deliverOriginalProjectEmails({ ...f, now: new Date(+now + 300000) });
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].to, 'new-musician@example.test');
  assert.equal([...f.jobs.values()][0].state, 'sent');
});

test('receipt queue interruptions retain the marker, and owner queue failure does not block the receipt', async t => {
  t.mock.method(console, 'error', () => {});
  const f = fixture(), update = f.emailRepository.updateOne;
  f.emailRepository.updateOne = async () => { throw new Error('Queue unavailable'); };
  await deliverOriginalProjectEmails({ ...f, now });
  assert.equal(f.submission.submitterConfirmationPending, true); assert.equal(f.sent.length, 0);
  f.emailRepository.updateOne = async (filter, change) => {
    if (change.$setOnInsert?.kind === 'submission') throw new Error('Owner queue unavailable');
    return update(filter, change);
  };
  await deliverOriginalProjectEmails({ ...f, now });
  assert.equal(f.submission.ownerNotificationPending, true);
  assert.equal(f.submission.submitterConfirmationPending, false);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].to, 'musician@example.test');
});

test('a fast decision or round advancement still allows the submission receipt', async () => {
  for (const state of ['accepted', 'rejected']) {
    const f = fixture(); f.submission.state = state; f.project.state = 'mix_open';
    await deliverOriginalProjectEmails({ ...f, now });
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0].to, 'musician@example.test');
  }
});

test('replacement receipts supersede stale queued revisions and are deduplicated', async () => {
  const f = fixture(); f.submission.ownerNotificationPending = false;
  await deliverOriginalProjectEmails({ ...f, now, emailSender: async () => ({ ok: false }) });
  f.submission.revision = 2; f.submission.submitterConfirmationPending = true;
  await deliverOriginalProjectEmails({ ...f, now: new Date(+now + 300000) });
  await deliverOriginalProjectEmails({ ...f, now: new Date(+now + 300000) });
  assert.equal(f.jobs.size, 2); assert.equal([...f.jobs.values()][0].state, 'cancelled');
  assert.equal(f.sent.length, 1); assert.match(f.sent[0].subject, /Updated submission received/);
});

test('deleted recipients, changed musician identities and withdrawn takes cancel queued receipts', async () => {
  for (const change of [f => { delete f.profiles.musician; }, f => { f.submission.musicianId = 'other'; }, f => { f.submission.state = 'withdrawn'; }, f => { f.submission.projectId = 'other'; }]) {
    const f = fixture(); f.submission.ownerNotificationPending = false;
    await deliverOriginalProjectEmails({ ...f, now, emailSender: async () => ({ ok: false }) });
    change(f);
    await deliverOriginalProjectEmails({ ...f, now: new Date(+now + 300000) });
    assert.equal(f.sent.length, 0); assert.equal([...f.jobs.values()][0].state, 'cancelled');
  }
});

test('historical submissions are not backfilled with confirmations', async () => {
  const f = fixture(); delete f.submission.submitterConfirmationPending;
  f.submission.ownerNotificationPending = false;
  await deliverOriginalProjectEmails({ ...f, now });
  assert.equal(f.jobs.size, 0); assert.equal(f.sent.length, 0);
});

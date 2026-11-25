import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeputyEscalationService, deputyEscalationEligibility } from '../services/availabilityDeputyEscalationService.js';
import { scheduledDeputyOffer } from '../services/scheduledDeputyOffer.js';

const now = Date.parse('2026-11-25T15:00:00Z'), hour = 3600000;
const lead = overrides => ({
  _id: 'lead-1', enquiryId: 'client-one', actId: 'act-one', lineupId: 'lineup-one',
  dateISO: '2027-01-16', phone: '+447000000001', slotIndex: 0,
  requestId: 'EXACT123', requestKey: 'client-one:exact', messageSidOut: 'SMoriginal',
  outboundSentAt: new Date(now - 3 * hour), createdAt: new Date(now - 3 * hour),
  actName: 'Fixture Band', reply: null, status: 'sent', fee: '310.50',
  duties: 'Lead vocals/acoustic guitar; daytime and evening. Enquiry only.',
  formattedAddress: 'Beckenham BR3', ...overrides,
});
const eq = (a, b) => a instanceof Date || b instanceof Date ? +new Date(a) === +new Date(b) : String(a) === String(b);
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    const actual = row[key];
    if (value === null) return actual == null;
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$exists' in value && (actual !== undefined) !== value.$exists) return false;
      if ('$nin' in value && value.$nin.some(v => actual === v)) return false;
      if ('$in' in value && !value.$in.includes(actual)) return false;
      if ('$lte' in value && !(+new Date(actual) <= +new Date(value.$lte))) return false;
      return true;
    }
    return actual != null && eq(actual, value);
  });
}
function fixture({ rows = [lead()], jobs = [], state, delivery, send } = {}) {
  const sends = [], upserts = [], states = [];
  const list = source => ({ sort() { return this; }, limit() { return this; }, lean: async () => structuredClone(source) });
  const Availability = {
    findById: id => ({ lean: async () => structuredClone(rows.find(r => eq(r._id, id))) }),
    exists: async query => rows.some(row => matches(row, query)),
  };
  const Deferred = {
    findOne: query => ({ lean: async () => structuredClone(jobs.find(j => matches(j, query))) }),
    find: query => list(jobs.filter(j => matches(j, query))),
    findOneAndUpdate: async (query, update, options) => {
      // Reproduce Mongo's conflicting-update rejection from the original bug.
      const inserted = Object.keys(update.$setOnInsert || {});
      assert.equal(Object.keys(update.$set || {}).some(key => inserted.includes(key)), false);
      let job = jobs.find(j => matches(j, query));
      if (!job && options?.upsert) {
        job = { _id: query._id, ...structuredClone(update.$setOnInsert) };
        jobs.push(job); upserts.push(structuredClone(update));
      }
      if (job) Object.assign(job, structuredClone(update.$set || {}));
      return structuredClone(job);
    },
    updateOne: async (query, update) => {
      const job = jobs.find(j => matches(j, query));
      if (job) Object.assign(job, structuredClone(update.$set));
      return { modifiedCount: job ? 1 : 0 };
    },
    updateMany: async (query, update) => {
      const found = jobs.filter(j => matches(j, query));
      found.forEach(j => Object.assign(j, structuredClone(update.$set)));
      return { modifiedCount: found.length };
    },
  };
  const service = createDeputyEscalationService({
    Availability, Deferred,
    getScopeState: async row => { states.push(row); return state ? state(row) : { active: true }; },
    getOriginalDelivery: async row => delivery ? delivery(row) : { status: 'delivered' },
    notifyDeputies: async options => { sends.push(options); return send ? send(options) : { sent: 3 }; },
    logger: { error() {} },
  });
  return { ...service, rows, jobs, sends, upserts, states };
}

test('saves the three-hour job without a conflicting update and anchors to actual send', async () => {
  const f = fixture({ rows: [lead({ outboundSentAt: new Date(now - 2 * hour) })] });
  const result = await f.schedule({ availabilityId: 'lead-1', now });
  assert.equal(result.scheduled, true);
  assert.equal(+result.dueAt, now + hour);
  assert.equal(f.jobs[0].enquiryId, 'client-one');
  assert.equal(f.jobs[0].requestId, 'EXACT123');
  assert.equal(f.jobs[0].messageSidOut, 'SMoriginal');
  assert.equal(f.sends.length, 0);
});

test('repeated/concurrent scheduling preserves one job and never pushes its deadline forward', async () => {
  const f = fixture();
  await Promise.all([f.schedule({ availabilityId: 'lead-1', now }), f.schedule({ availabilityId: 'lead-1', now })]);
  await f.schedule({ availabilityId: 'lead-1', now: now + hour });
  assert.equal(f.jobs.length, 1);
  assert.equal(+f.jobs[0].dueAt, now);
  f.jobs[0].status = 'processed';
  await f.schedule({ availabilityId: 'lead-1', now: now + hour });
  assert.equal(f.jobs[0].status, 'processed');
});

test('never falls back from a missing original document to another client on the same date', async () => {
  const f = fixture();
  assert.equal((await f.schedule({ availabilityId: 'missing', now })).scheduled, false);
  assert.equal((await f.schedule({ now })).scheduled, false);
  assert.equal(f.jobs.length, 0);
});

test('only dispatches at three hours, preserving exact client, lineup, slot and approved offer context', async () => {
  const f = fixture(); await f.schedule({ availabilityId: 'lead-1', now });
  await f.processDue({ now: now - 1 }); assert.equal(f.sends.length, 0);
  const result = await f.processDue({ now });
  assert.equal(result.processed.length, 1);
  assert.equal(f.sends[0].enquiryId, 'client-one');
  assert.equal(f.sends[0].lineupId, 'lineup-one');
  assert.equal(f.sends[0].slotIndex, 0);
  assert.equal(f.sends[0].leadAvailabilityId, 'lead-1');
  assert.equal(f.sends[0].inheritLeadOffer, true);
  assert.equal(f.sends[0].skipDuplicateCheck, false);
});

test('parallel worker ticks claim the same handoff once', async () => {
  const f = fixture(); await f.schedule({ availabilityId: 'lead-1', now });
  await Promise.all([f.processDue({ now }), f.processDue({ now }), f.processDue({ now })]);
  assert.equal(f.sends.length, 1);
  await f.processDue({ now: now + hour }); assert.equal(f.sends.length, 1);
});

test('reply cancellation only cancels its exact original request', async () => {
  const f = fixture({ rows: [lead(), lead({ _id: 'lead-2', enquiryId: 'client-two', requestId: 'OTHER123', requestKey: 'other' })] });
  await f.schedule({ availabilityId: 'lead-1', now });
  await f.schedule({ availabilityId: 'lead-2', now });
  await f.cancel({ availabilityId: 'lead-1' });
  assert.equal(f.jobs[0].status, 'cancelled');
  assert.equal(f.jobs[1].status, 'pending');
  assert.equal((await f.cancel({ actId: 'act-one', dateISO: '2027-01-16', phone: '+447000000001', slotIndex: 0 })).modifiedCount, 0);
});

test('stops for any explicit reply, musician message, pause, failed delivery or calendar ambiguity', async () => {
  for (const change of [
    { reply: 'yes' }, { reply: 'no' }, { reply: 'unavailable' },
    { repliedAt: new Date(now) }, { availabilityRemindersPausedAt: new Date(now) },
    { websiteReplies: [{ senderRole: 'musician', body: 'Need to discuss' }] },
    { confirmedBooking: true }, { calendarStatus: 'declined' }, { calendarStatus: 'tentative' },
    { deliveryStatus: 'undelivered' }, { isDeputy: true },
  ]) {
    const f = fixture(); await f.schedule({ availabilityId: 'lead-1', now });
    Object.assign(f.rows[0], change); await f.processDue({ now });
    assert.equal(f.sends.length, 0, JSON.stringify(change));
  }
});

test('does not automate missing identity, unconfirmed fees, expired requests, or Magnolia deputy pricing', () => {
  for (const change of [{ enquiryId: '' }, { requestId: '' }, { messageSidOut: '' }, { slotIndex: null },
    { outboundSentAt: null }, { fee: '' }, { fee: '0' }, { fee: 'TBC' },
    { outboundSentAt: new Date(now - 8 * 24 * hour) },
    { dateISO: '2026-11-01' }, { actId: '695e637a10134e7eba1993e8' }]) {
    assert.ok(deputyEscalationEligibility(lead(change), now), JSON.stringify(change));
  }
});

test('another enquiry or lineup deputy does not suppress this client’s handoff', async () => {
  for (const change of [{ enquiryId: 'different-client' }, { lineupId: 'different-lineup' }, { slotIndex: 1 }]) {
    const f = fixture({ rows: [lead(), lead({ _id: 'deputy', isDeputy: true, ...change })] });
    await f.schedule({ availabilityId: 'lead-1', now }); await f.processDue({ now });
    assert.equal(f.sends.length, 1, JSON.stringify(change));
  }
});

test('same exact scope already contacted deputies suppress a duplicate handoff; failed preflights do not', async () => {
  for (const outbound of ['SMdeputy', '']) {
    const f = fixture({ rows: [lead(), lead({ _id: 'deputy', isDeputy: true, messageSidOut: outbound })] });
    await f.schedule({ availabilityId: 'lead-1', now }); await f.processDue({ now });
    assert.equal(f.sends.length, outbound ? 0 : 1);
  }
});

test('closed/converted/covered enquiries never dispatch deputies', async () => {
  for (const reason of ['closed', 'converted', 'other-positive', 'missing-board']) {
    const f = fixture({ state: async () => ({ active: false, reason }) });
    await f.schedule({ availabilityId: 'lead-1', now }); await f.processDue({ now });
    assert.equal(f.sends.length, 0);
  }
});

test('a changed request SID, enquiry or lineup cannot reuse an old queued job', async () => {
  for (const change of [{ messageSidOut: 'SMnew' }, { enquiryId: 'new-client' }, { lineupId: 'new-lineup' }, { requestId: 'NEW123' },
    { fee: '900' }, { duties: 'A different full-day offer' }, { formattedAddress: 'Another county' }]) {
    const f = fixture(); await f.schedule({ availabilityId: 'lead-1', now }); Object.assign(f.rows[0], change);
    await f.processDue({ now }); assert.equal(f.sends.length, 0);
  }
});

test('a reply or closure arriving while delivery is checked wins before dispatch', async () => {
  const f = fixture({ delivery: async () => { f.rows[0].reply = 'yes'; return { status: 'delivered' }; } });
  await f.schedule({ availabilityId: 'lead-1', now }); await f.processDue({ now }); assert.equal(f.sends.length, 0);
  let calls = 0;
  const g = fixture({ state: async () => ({ active: ++calls === 1 }) });
  await g.schedule({ availabilityId: 'lead-1', now }); await g.processDue({ now }); assert.equal(g.sends.length, 0);
});

test('original recipient/delivery must be verified, not a blank provider callback', async () => {
  for (const status of ['sent', 'queued', 'undelivered', 'failed', 'recipient-mismatch', '']) {
    const f = fixture({ delivery: async () => ({ status }) });
    await f.schedule({ availabilityId: 'lead-1', now }); await f.processDue({ now }); assert.equal(f.sends.length, 0, status);
  }
});

test('London quiet hours defer the handoff and dry runs do not claim or dispatch', async () => {
  const f = fixture(); await f.schedule({ availabilityId: 'lead-1', now });
  for (const date of ['2026-11-25T21:00:00Z', '2026-11-26T08:59:00Z']) await f.processDue({ now: Date.parse(date) });
  assert.equal(f.sends.length, 0); assert.equal(f.jobs[0].status, 'pending');
  const preview = await f.processDue({ now, dryRun: true });
  assert.equal(preview.eligible.length, 1); assert.equal(f.jobs[0].status, 'pending'); assert.equal(f.sends.length, 0);
});

test('a partial/ambiguous dispatch stays held rather than being automatically replayed', async () => {
  const f = fixture({ send: async () => { throw new Error('Timeout after provider accepted first deputy'); } });
  await f.schedule({ availabilityId: 'lead-1', now }); await f.processDue({ now });
  assert.equal(f.jobs[0].status, 'error'); await f.processDue({ now: now + hour }); assert.equal(f.sends.length, 1);
});

test('scheduled offers preserve the exact all-in fee including pence and material duties', () => {
  const offer = scheduledDeputyOffer(lead(), { id: 'deputy-1', phoneNumber: '07000 000002' });
  assert.equal(offer.automaticDeputy, false); assert.equal(offer.inheritedFee, 310.50);
  assert.equal(offer.approvedOffer.total, 310.50); assert.equal(offer.inheritedFeeIncludesTravel, true);
  assert.match(offer.inheritedDuties, /daytime and evening/);
});

test('scheduled deputies retain Emma’s tour contact restriction', () => {
  const emma = { id: '6920b022cddfe7353a7806a6', phone: '+447000000002' };
  assert.throws(() => scheduledDeputyOffer(lead({ dateISO: '2027-01-16' }), emma), { code: 'AVAILABILITY_CONTACT_RESTRICTED' });
  assert.ok(scheduledDeputyOffer(lead({ dateISO: '2026-12-31' }), emma));
});

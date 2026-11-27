import assert from 'node:assert/strict';
import { mock } from 'node:test';

const sends = [], reservations = [], prices = [], updates = [];
const foxGuitarScenario = process.env.FOX_GUITAR_FIXTURE === '1';
let failHistory = false;
let duringPricing = () => {};
const query = value => ({ select() { return this; }, sort() { return this; }, lean: async () => value });
const richard = { _id: '692ebcf6e7dfeac14dc2168b', musicianId: '692ebcf6e7dfeac14dc2168b',
  firstName: 'Richard', lastName: 'Fixture', phone: '+447000000001', email: 'richard@example.test',
  status: 'Approved', vocals: { type: ['Lead Vocal'] } };
const alternatives = [2, 3, 4, 5].map(n => ({ ...richard,
  _id: `692ebcf6e7dfeac14dc2168${n}`, musicianId: `692ebcf6e7dfeac14dc2168${n}`,
  firstName: `Singer${n}`, phone: `+44700000000${n}`, email: `singer${n}@example.test`,
  instrumentation: [{ instrument: 'Acoustic Guitar' }] }));
const people = [richard, ...alternatives];
const lineup = { _id: '6984e203d245d0c771406d30', bandMembers: [
  { firstName: 'Primary', instrument: foxGuitarScenario ? 'Vocalist-Bassist' : 'Lead vocals/guitar', fee: 300,
    phoneNumber: '+447000000009', deputies: people },
  { instrument: 'Bass' }, { instrument: 'Drums' },
] };
const act = { _id: foxGuitarScenario ? '681de07addc311a32c271fd9' : '68541b25e47bb51c79b98121',
  tscName: 'Fixture Band', lineups: [lineup] };
let history = [{ _id: 'earlier-no', musicianId: richard._id, phone: richard.phone,
  dateISO: '2027-09-04', enquiryId: 'DIFFERENT-ENQUIRY', actId: 'DIFFERENT-ACT',
  reply: 'unavailable', messageSidOut: 'SIMULATED-OLD', requestId: 'EARLIERNO' }];
const availability = {
  find: () => { if (failHistory) throw new Error('History unavailable'); return query(history); },
  aggregate: async () => [], findOne: () => query(null),
  findOneAndUpdate: async (filter, update) => {
    reservations.push({ filter, update }); return { _id: `fixture-${reservations.length}`, ...update.$setOnInsert, ...update.$set };
  }, updateOne: async (...args) => { updates.push(args); return {}; },
};
mock.module('../../models/actModel.js', { defaultExport: { findById: () => query(structuredClone(act)) } });
const canonicalFor = filter => {
  if (typeof filter === 'string') return people.find(p => p._id === filter) || null;
  return people.find(p => filter?.email === p.email || filter?.$or?.some(part =>
    [part.phone, part.phoneNumber, part.phoneNormalized].includes(p.phone))) || null;
};
mock.module('../../models/musicianModel.js', { defaultExport: {
  findOne: filter => query(canonicalFor(filter)), findById: id => query(canonicalFor(String(id))),
} });
mock.module('../../models/availabilityModel.js', { defaultExport: availability });
mock.module('../../models/EnquiryMessage.js', { defaultExport: { find: () => query([]) } });
mock.module('../../models/bookingModel.js', { defaultExport: { find: () => query([]) } });
mock.module('../../models/deferredAvailabilityModel.js', { defaultExport: {
  findOneAndUpdate: async () => { throw new Error('Deputies must not schedule primary escalations'); },
} });
mock.module('../../services/rosterEligibilityService.js', { namedExports: {
  getRosterPolicy: async () => null,
} });
mock.module('../../services/automaticDeputyPricing.js', { namedExports: {
  resolveAutomaticDeputyPrice: async ({ musician }) => { prices.push(musician._id); duringPricing(musician); return { total: 390 }; },
  performanceLineupSize: () => 3,
} });
const noExternal = () => { throw new Error('Unexpected external side effect in isolated routing fixture'); };
mock.module('../../utils/sendEmail.js', { defaultExport: noExternal });
mock.module('../../utils/twilioClient.js', { defaultExport: {}, namedExports: {
  sendWhatsAppMessage: async data => { sends.push(data); return { sid: 'SIMULATED-NO-PROVIDER-CALL' }; },
  sendSMSMessage: noExternal, sendWhatsAppText: noExternal, fetchInboundMessageTime: noExternal,
  fetchTwilioConversation: noExternal, sendDeputyAllocationWhatsApp: noExternal,
  sendDeputyAllocationDeclinedWhatsApp: noExternal, toE164: value => value,
  fetchWhatsAppMessageStatus: noExternal,
} });
const report = console.log;
if (!process.env.ROUTING_FIXTURE_DEBUG) console.log = console.warn = console.error = () => {};
const { notifyDeputies, triggerAvailabilityRequest } = await import('../../controllers/availabilityController.js');
const scope = { actId: act._id, lineupId: lineup._id, dateISO: '2027-09-04',
  enquiryId: 'NEW-ENQUIRY', formattedAddress: 'New venue, Devon TQ12 4RR', slotIndex: 0 };

// This is the exact hosted automatic path that bypassed the private assistant wrapper.
await notifyDeputies(scope);
assert.equal(sends.length, 3);
assert.deepEqual(sends.map(s => s.to), alternatives.slice(0, 3).map(p => p.phone));
assert.equal(reservations.length, 3);
assert.equal(prices.includes(richard._id), false);
assert.equal(reservations.some(r => r.update.$set.musicianId === richard._id), false);
assert.deepEqual(sends.map(s => s.variables.fee), ['390', '390', '390']);
if (foxGuitarScenario) {
  assert.deepEqual(sends.map(s => s.variables.role), Array(3).fill('Lead vocals / acoustic guitar'));
  assert.deepEqual(sends.map(s => s.opportunityDetails.duties), Array(3).fill('Lead vocals / acoustic guitar'));
  assert.deepEqual(reservations.map(r => r.update.$set.duties), Array(3).fill('Lead vocals / acoustic guitar'));
}
assert.equal(history[0].reply, 'unavailable'); // No manufactured replies or rewritten evidence.

const before = sends.length;
for (const flags of [{}, { skipDuplicateCheck: true }, { automaticDeputy: false }]) {
  const result = await triggerAvailabilityRequest({ ...scope, ...flags, isDeputy: true,
    automaticDeputy: true, deputy: { ...richard } });
  assert.equal(result.code, 'AVAILABILITY_PRIOR_DECLINE');
  assert.equal(result.sent, 0);
}
assert.equal(sends.length, before);
assert.equal(reservations.length, 3);

failHistory = true;
const failed = await triggerAvailabilityRequest({ ...scope, isDeputy: true,
  automaticDeputy: true, deputy: { ...alternatives[3] } });
assert.equal(failed.success, false);
assert.equal(sends.length, before);
assert.equal(reservations.length, 3);

failHistory = false;
duringPricing = musician => { history.push({ ...history[0], musicianId: musician._id,
  phone: musician.phone, requestId: 'ARRIVED-DURING-PRICING' }); };
const lateDecline = await triggerAvailabilityRequest({ ...scope, isDeputy: true,
  automaticDeputy: true, deputy: { ...alternatives[3] } });
assert.equal(lateDecline.code, 'AVAILABILITY_PRIOR_DECLINE');
assert.equal(sends.length, before);
assert.equal(reservations.length, 3);
duringPricing = () => {};

// Pending requests on another band must not chase a person who has since said NO.
failHistory = false;
mock.module('../../controllers/allocationController.js', { namedExports: {
  escalateToNextDeputy: noExternal, reconcilePendingRoleOffer: noExternal, sanitizeFee: value => value,
} });
const { availabilityReminderScopeState } = await import('../../cron/chaseAndEscalate.js');
const state = await availabilityReminderScopeState({ ...scope, musicianId: richard._id, phone: richard.phone });
assert.deepEqual(state, { active: false, reason: 'musician-declined-date-or-location' });
assert.equal(sends.length, before);
const { notifyDeputyOneShot } = await import('../../controllers/availabilityHelpers.js');
await assert.rejects(notifyDeputyOneShot({ ...scope, act, deputy: richard,
  finalFee: 390, duties: 'Lead vocals/guitar' }), { code: 'AVAILABILITY_PRIOR_DECLINE' });
assert.equal(sends.length, before);
assert.equal(reservations.length, 3);
report('Actual automatic routing excludes prior cross-enquiry/date declines, ignores bypass flags, and contacts three other eligible singers. No live messages or database.');

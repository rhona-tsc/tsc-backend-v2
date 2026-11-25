import assert from 'node:assert/strict';
import { mock } from 'node:test';

const sends = [], reservations = [], prices = [], updates = [];
let failHistory = false;
let scheduledLead;
let scopeActive = true;
let duringPricing = () => {};
const query = value => ({ select() { return this; }, sort() { return this; }, lean: async () => value });
const richard = { _id: '692ebcf6e7dfeac14dc2168b', musicianId: '692ebcf6e7dfeac14dc2168b',
  firstName: 'Richard', lastName: 'Fixture', phone: '+447000000001', email: 'richard@example.test',
  status: 'Approved', vocals: { type: ['Lead Vocal'] } };
const alternatives = [2, 3, 4, 5].map(n => ({ ...richard,
  _id: `692ebcf6e7dfeac14dc2168${n}`, musicianId: `692ebcf6e7dfeac14dc2168${n}`,
  firstName: `Singer${n}`, phone: `+44700000000${n}`, email: `singer${n}@example.test` }));
const people = [richard, ...alternatives];
const lineup = { _id: '6984e203d245d0c771406d30', bandMembers: [
  { firstName: 'Primary', instrument: 'Lead vocals/guitar', fee: 300,
    phoneNumber: '+447000000009', deputies: people },
  { instrument: 'Bass' }, { instrument: 'Drums' },
] };
const act = { _id: '68541b25e47bb51c79b98121', tscName: 'Fixture Band', lineups: [lineup] };
let history = [{ _id: 'earlier-no', musicianId: richard._id, phone: richard.phone,
  dateISO: '2027-09-04', enquiryId: 'DIFFERENT-ENQUIRY', actId: 'DIFFERENT-ACT',
  reply: 'unavailable', messageSidOut: 'SIMULATED-OLD', requestId: 'EARLIERNO' }];
const availability = {
  findById: () => query(structuredClone(scheduledLead)),
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
mock.module('../../services/availabilityEnquiryScope.js', { namedExports: { availabilityEnquiryScopeState: async () => ({active:scopeActive}) } });
const { notifyDeputies, triggerAvailabilityRequest } = await import('../../controllers/availabilityController.js');
const scope = { actId: act._id, lineupId: lineup._id, dateISO: '2027-09-04',
  enquiryId: 'NEW-ENQUIRY', formattedAddress: 'New venue, Devon TQ12 4RR', slotIndex: 0 };


scheduledLead = { _id:'original-lead', ...scope, phone:'+447000000009',
 requestId:'EXACT-LEAD', requestKey:'exact-key', messageSidOut:'SIMULATED-ORIGINAL',
 actName:'Fixture Band', outboundSentAt:new Date(), fee:'310.50',
 duties:'Lead vocals/guitar; ceremony plus evening. Enquiry only.', reply:null, status:'sent' };
await notifyDeputies({...scope, leadAvailabilityId:'original-lead',inheritLeadOffer:true});
assert.equal(sends.length,3);
assert.deepEqual(sends.map(s=>s.variables.fee),['310.5','310.5','310.5']);
assert.equal(prices.length,0); // No substituted personal fee or added travel.
assert.ok(sends.every(s=>s.opportunityDetails.duties.includes('ceremony plus evening')));
assert.ok(reservations.every(r=>(r.update.$set.enquiryId || r.update.$setOnInsert.enquiryId)===scope.enquiryId));
assert.ok(sends.every(s=>s.to!==richard.phone)); // Earlier other-enquiry NO still wins.
const previous=sends.length;
scopeActive=false;
await notifyDeputies({...scope,leadAvailabilityId:'original-lead',inheritLeadOffer:true});
assert.equal(sends.length,previous);
scopeActive=true;
scheduledLead.reply='yes';
await notifyDeputies({...scope,leadAvailabilityId:'original-lead',inheritLeadOffer:true});
assert.equal(sends.length,previous);
report('Scheduled handoff preserves exact approved all-in fee, pence, duties, prior date declines and live scope checks. No live messages or database.');

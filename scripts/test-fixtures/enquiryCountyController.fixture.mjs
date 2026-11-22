import assert from 'node:assert/strict';
import { mock } from 'node:test';

const sends = [], reservations = [], queues = [];
let earlierReplies = [];
const query = value => ({ select() { return this; }, sort() { return this; }, lean: async () => value });
const kedesha = { _id: 'roster-k', musicianId: '6943ec66d9fa061f2fcd3fb7', firstName: 'Kedesha', lastName: 'Charles',
  instrument: 'Lead Female Vocal', fee: 355, email: 'k@example.test', phoneNumber: '+447000000001' };
const emma = { _id: 'roster-e', musicianId: '6920b022cddfe7353a7806a6', firstName: 'Emma May', lastName: 'Osei-Lah',
  instrument: 'Lead Female Vocal/Rapper', fee: 400, email: 'emma_osei_lah@hotmail.com', phoneNumber: '+447000000002' };
const lineup = { _id: '6984e203d245d0c771406d30', bandMembers: [emma, { instrument: 'Bass' },
  { instrument: 'Guitar' }, { instrument: 'Drums' }, { instrument: 'Sax' }, kedesha] };
const act = { enquiryLocationMode:'county', _id: '68541b25e47bb51c79b98121', tscName: 'Soul Allegiance', lineups: [lineup] };
const canonical = { ...kedesha, _id: kedesha.musicianId };
const availability = {
  find: () => query(earlierReplies), findOne: () => query(null),
  findOneAndUpdate: async (filter, update) => {
    reservations.push({ filter, update }); return { _id: 'fixture-request', ...update.$setOnInsert, ...update.$set };
  }, updateOne: async () => ({}),
};
mock.module('../../models/actModel.js', { defaultExport: { findById: () => query(structuredClone(act)) } });
mock.module('../../models/musicianModel.js', { defaultExport: { findOne: () => query(canonical), findById: () => query(canonical) } });
mock.module('../../models/availabilityModel.js', { defaultExport: availability });
mock.module('../../models/EnquiryMessage.js', { defaultExport: { find: () => query([]) } });
mock.module('../../models/bookingModel.js', { defaultExport: { find: () => query([]) } });
mock.module('../../models/deferredAvailabilityModel.js', { defaultExport: {
  findOneAndUpdate: async (...args) => { queues.push(args); return {}; },
} });
const unexpected = () => { throw new Error('Unexpected external side effect in isolated fixture'); };
mock.module('../../utils/sendEmail.js', { defaultExport: unexpected });
mock.module('../../utils/twilioClient.js', { defaultExport: {}, namedExports: {
  sendWhatsAppMessage: async options => { sends.push(options); return { sid: 'SIMULATED-NO-PROVIDER-CALL' }; },
  sendSMSMessage: unexpected, sendWhatsAppText: unexpected, fetchInboundMessageTime: unexpected,
  fetchTwilioConversation: unexpected, sendDeputyAllocationWhatsApp: unexpected,
  sendDeputyAllocationDeclinedWhatsApp: unexpected, toE164: value => value,
} });

const log = console.log;
console.log = console.warn = console.error = () => {};
const { triggerAvailabilityRequest, countyFromAddress } = await import('../../controllers/availabilityController.js');
const base = { source: 'manual_enquiry_board', enquiryId: 'fixture-enquiry', actId: act._id,
  lineupId: lineup._id, dateISO: '2027-09-04', formattedAddress: 'Hearn Field, Devon TQ12 4RR',
  targetMember: kedesha, slotIndex: 0, approvedOffer: { musicianId: kedesha.musicianId,
    phone: kedesha.phoneNumber, total: 823, includesTravel: true },
  inheritedDuties: 'Lead vocals, 5pm–midnight; 2x60 with breaks' };
const reset = () => { sends.length = reservations.length = queues.length = 0; earlierReplies = []; };

lineup.bandMembers = [kedesha];
kedesha.countyTravelFees = { Gwynedd: 68 }; kedesha.fee = 200;
reset();
const result = await triggerAvailabilityRequest({ ...base, formattedAddress: '', county: 'Gwynedd', inheritedFee: null });
assert.equal(result.success,true,JSON.stringify(result));assert.equal(result.sent,1);assert.equal(sends.length,1);
assert.equal(sends[0].variables.location,'Gwynedd');assert.equal(sends[0].variables.fee,'268');assert.equal(reservations[0].update.$set.formattedAddress,'Gwynedd');
reset();delete kedesha.countyTravelFees;
const held = await triggerAvailabilityRequest({ ...base, formattedAddress:'Gwynedd', county:'Gwynedd' });
assert.equal(held.success,false,JSON.stringify(held));assert.equal(sends.length,0);assert.equal(reservations.length,0);
log('County-only actual controller sends exact 268 and Gwynedd, no postcode invented; missing price held before writes. No live messages or database.');

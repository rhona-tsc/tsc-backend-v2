import assert from 'node:assert/strict';
import { mock } from 'node:test';

const invites = [], acknowledgements = [], updates = [];
let canonical = null;
const wrongSophia = { _id: 'wrong-sophia', firstName: 'Sophia', lastName: 'Romaine',
  email: 'wrong@example.test', phone: '+447000000002' };
const request = { _id: 'request', enquiryId: 'fixture-enquiry', actId: 'act', lineupId: 'six',
  phone: '+447000000001', musicianName: 'Sophia Pozzobone', reply: 'yes', fee: '270',
  dateISO: '2027-08-20', clientName: 'Claire', slotIndex: 0, isDeputy: false };
const act = { _id: 'act', name: 'Afrodeziacs', tscName: 'Afrodeziacz', lineups: [{ _id: 'six',
  bandMembers: [{ firstName: 'Sophia', lastName: 'Pozzobone', phoneNumber: request.phone,
    email: 'correct@example.test', instrument: 'Lead Female Vocal' }] }] };
const query = value => ({ select() { return this; }, sort() { return this; }, lean: async () => value });
const noExternal = () => { throw new Error('Unexpected external side effect in isolated calendar fixture'); };
mock.module('../../models/actModel.js', { defaultExport: { findById: () => query(act) } });
mock.module('../../models/musicianModel.js', { defaultExport: {
  findOne: filter => query(filter.$or?.some(part => part.firstName || part.lastName || part.name) ? wrongSophia : canonical),
  findById: () => query(canonical),
} });
mock.module('../../models/availabilityModel.js', { defaultExport: {
  exists: async () => true,
  updateOne: async (filter, update) => { updates.push({ filter, update }); return {}; },
  find: () => query([]),
} });
mock.module('../../models/deferredAvailabilityModel.js', { defaultExport: { updateMany: async () => ({}) } });
mock.module('../../controllers/googleController.js', { namedExports: {
  createCalendarInvite: async input => { invites.push(input); return { id: 'simulated-calendar-only' }; },
  cancelCalendarInvite: noExternal,
} });
mock.module('../../utils/sendEmail.js', { defaultExport: noExternal });
mock.module('../../utils/twilioClient.js', { defaultExport: {}, namedExports: {
    fetchWhatsAppMessageStatus: () => { throw new Error("No provider calls allowed in calendar fixture"); },
  sendWhatsAppMessage: noExternal, sendSMSMessage: noExternal,
  sendWhatsAppText: async (phone, body) => { acknowledgements.push({ phone, body }); },
  fetchInboundMessageTime: noExternal, fetchTwilioConversation: noExternal,
  sendDeputyAllocationWhatsApp: noExternal, sendDeputyAllocationDeclinedWhatsApp: noExternal,
  toE164: value => value,
} });
const report = console.log;
console.log = console.warn = console.error = () => {};
const { processAvailabilityReplyFlow } = await import('../../controllers/availabilityController.js');
global.availabilityNotify = null;
await processAvailabilityReplyFlow({ updated: { ...request }, reply: 'yes', fromRaw: request.phone });
assert.equal(invites.length, 1);
assert.equal(invites[0].email, 'correct@example.test');
assert.equal(invites[0].fee, '270');
assert.equal(invites[0].enquiryId, request.enquiryId);
assert.equal(invites[0].summary, "Enquiry Only | Claire's Event | Afrodeziacz");
assert.equal(acknowledgements[0].phone, request.phone);
assert.ok(updates.some(x => x.update.$set?.calendarInviteEmail === 'correct@example.test'));

invites.length = acknowledgements.length = updates.length = 0;
canonical = wrongSophia;
await processAvailabilityReplyFlow({ updated: { ...request }, reply: 'yes', fromRaw: request.phone });
assert.equal(invites.length, 0);
assert.match(acknowledgements[0].body, /logged your availability/);
assert.ok(updates.some(x => x.update.$set?.calendarInviteIdentityHoldReason));
report('Actual reply handler keeps the two Sophias separate, preserves the positive reply and fee, and holds conflicting identities. No live messages or database.');

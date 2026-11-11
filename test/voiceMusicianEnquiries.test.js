import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnquiryToolHandler, normalizeVoiceEnquiry, buildVoiceBoardRecord } from '../services/incomingEnquiryAssistant.js';
import EnquiryBoardItem from '../models/enquiryBoardItem.js';

const now = new Date('2026-11-11T12:00:00Z');
const contact = { clientName: 'Example musician', clientPhone: '+447700900123', clientEmail: 'musician@example.invalid', confirmed: true,
 styles: [], preferredSize: '', mustHaveInstruments: [], selectedBands: [], selectedBandsConfirmed: false };

test('posted-job and joining calls save as labelled callbacks without client event requirements or booking actions', async () => {
 const saved = new Map();
 const handler = createEnquiryToolHandler({ lookupBands: () => assert.fail('musician callbacks do not search bands'),
  saveBoardRecord: async record => { const doc = new EnquiryBoardItem(record); await doc.validate(); saved.set(record.websiteKey, doc.toObject()); },
  prepareAvailability: () => assert.fail('musician questions never create availability requests'), now: () => now });
 for (const topic of ['musician_job', 'musician_joining']) {
  const input = { ...contact, enquiryTopic: topic, musicianRole: 'Saxophone', jobReference: topic === 'musician_job' ? 'Posted role, caller reference EXAMPLE-1' : '',
   callbackReason: topic === 'musician_job' ? 'Asks which set times apply to the posted job' : 'Asks how to submit a saxophone profile' };
  const result = await handler({ callId: topic, name: 'request_callback', arguments: input });
  assert.equal(result.kind, 'callback_request'); assert.equal(result.enquiryTopic, topic);
  assert.equal(result.bookingConfirmed, false); assert.equal(result.messagesSent, false);
  const row = saved.get(`phone:${topic}`);
  assert.equal(row.enquiryTopic, topic); assert.equal(row.musicianRole, 'Saxophone'); assert.equal(row.eventDateISO, '');
  assert.match(row.notes, /Musician (job question|joining enquiry)/);
  assert.match(row.notes, /No job application, allocation, profile approval or booking/);
  assert.equal(row.actId, undefined); assert.deepEqual(row.selectedBands, []);
  await assert.rejects(handler({ callId: topic, name: 'request_band_availability', arguments: { confirmed: true } }));
 }
});

test('musician questions require read-back, contact and question, and cannot become qualified event leads', () => {
 const input = { ...contact, enquiryTopic: 'musician_job', callbackReason: 'A question about a posted role' };
 for (const patch of [{ confirmed: false }, { clientPhone: '', clientEmail: '' }, { callbackReason: '' }, { selectedBands: [{ actId: '111111111111111111111111' }] }, { mustHaveInstruments: ['Saxophone'] }]) {
  assert.throws(() => normalizeVoiceEnquiry({ ...input, ...patch }, { now, callbackOnly: true }));
 }
 for (const enquiryTopic of ['musician_job', 'musician_joining', 'human_callback']) assert.throws(() => normalizeVoiceEnquiry({ ...input, enquiryTopic, eventDateISO: '2027-06-05', address: 'Surrey', requirements: 'Band' }, { now }), /callback/);
 const normalized = normalizeVoiceEnquiry(input, { now, callbackOnly: true });
 assert.equal(normalized.qualified, false);
 assert.match(buildVoiceBoardRecord('example', normalized, now).notes, /Caller-supplied|Musician job/);
});

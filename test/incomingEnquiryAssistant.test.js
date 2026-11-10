import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVoiceEnquiry, normalizeCallbackPhone, buildVoiceBoardRecord, createEnquiryToolHandler, voiceAssistantReadiness, ENQUIRY_ASSISTANT_INSTRUCTIONS } from '../services/incomingEnquiryAssistant.js';

const now = new Date('2026-11-10T15:00:00Z');
const enquiry = { clientName: 'Example caller', clientEmail: 'example@example.com', clientPhone: '07700 900123', eventDateISO: '2027-06-05', address: 'Surrey', requirements: 'Soul and Motown band for a wedding', decisionWindow: 'Within two weeks', confirmed: true };

test('genuine enquiries require confirmed contact, date, location and requirements', () => {
  assert.equal(normalizeVoiceEnquiry(enquiry, { now }).qualified, true);
  for (const patch of [{ confirmed: false }, { clientEmail: '', clientPhone: '' }, { address: '' }, { requirements: '' }, { eventDateISO: '' }, { eventDateISO: '2027-02-30' }, { eventDateISO: '2025-06-05' }]) {
    assert.throws(() => normalizeVoiceEnquiry({ ...enquiry, ...patch }, { now }));
  }
});

test('callbacks can be incomplete but still require a confirmed contact', () => {
  assert.equal(normalizeVoiceEnquiry({ clientName: 'Example', clientPhone: '07700 900123', confirmed: true }, { now, callbackOnly: true }).qualified, false);
  assert.throws(() => normalizeVoiceEnquiry({ clientName: 'Example', confirmed: true }, { now, callbackOnly: true }));
  assert.equal(normalizeCallbackPhone('07700 900123'), '+447700900123');
  assert.equal(normalizeCallbackPhone('not a number'), '');
});

test('board record keeps booking decision window separate and never invents Google Ads attribution', () => {
  const record = buildVoiceBoardRecord('CAexample', normalizeVoiceEnquiry(enquiry, { now }), now);
  assert.equal(record.eventDateISO, '2027-06-05');
  assert.match(record.notes, /Hoping to book: Within two weeks/);
  assert.equal(record.marketingSource, 'Phone — source unverified');
  assert.equal(record.status, 'open');
  assert.equal(record.actId, undefined);
});

test('tool retries upsert the same call reference and have no booking or messaging side effects', async () => {
  const rows = new Map();
  const handler = createEnquiryToolHandler({ lookupBands: async () => [], saveBoardRecord: async row => rows.set(row.websiteKey, row), now: () => now });
  const result = await handler({ callId: 'CAexample', name: 'save_enquiry', arguments: enquiry });
  await handler({ callId: 'CAexample', name: 'save_enquiry', arguments: JSON.stringify(enquiry) });
  assert.equal(rows.size, 1);
  assert.deepEqual([result.saved, result.bookingConfirmed, result.messagesSent], [true, false, false]);
  await assert.rejects(handler({ callId: 'CAexample', name: 'make_payment', arguments: enquiry }));
});

test('lookup returns at most three public choices without claiming availability', async () => {
  const handler = createEnquiryToolHandler({ lookupBands: async () => Array.from({ length: 5 }, (_, i) => ({ name: `Example ${i}` })), saveBoardRecord: async () => assert.fail('lookup must not save') });
  const result = await handler({ callId: 'CAexample', name: 'lookup_bands', arguments: { query: 'Soul' } });
  assert.equal(result.bands.length, 3);
  assert.equal(result.availabilityChecked, false);
});

test('storage failure cannot be reported as a saved enquiry', async () => {
  const handler = createEnquiryToolHandler({ lookupBands: async () => [], saveBoardRecord: async () => { throw new Error('unavailable'); }, now: () => now });
  await assert.rejects(handler({ callId: 'CAexample', name: 'save_enquiry', arguments: enquiry }), /unavailable/);
});

test('unconfigured assistant is disabled and does not expose secrets', () => {
  const result = voiceAssistantReadiness({ OPENAI_API_KEY: 'secret-example' });
  assert.equal(result.enabled, false);
  assert.equal(result.liveRoutingConfigured, false);
  assert.equal(JSON.stringify(result).includes('secret-example'), false);
  assert.match(ENQUIRY_ASSISTANT_INSTRUCTIONS, /Never claim to be Rhona or a human/);
});

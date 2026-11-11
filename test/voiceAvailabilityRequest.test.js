import test from 'node:test';
import assert from 'node:assert/strict';
import { interceptAvailabilityTest, prepareVoiceAvailabilityBatch, voicePreviewKey, voicePreviewSnapshot } from '../services/availabilityRequestTestPreview.js';
import { createEnquiryToolHandler, ENQUIRY_ASSISTANT_TOOLS } from '../services/incomingEnquiryAssistant.js';
import { matchVoiceBands } from '../services/voiceBandMatching.js';
import EnquiryBoardItem from '../models/enquiryBoardItem.js';

const now = new Date('2026-11-11T12:00:00Z');
const act = { _id: '111111111111111111111111', tscName: 'Test Soul Band', status: 'approved', genre: ['Soul & Motown'],
  lineups: [{ lineupId: 'trio', actSize: '3-piece', bandMembers: ['Lead Vocal', 'Keyboard', 'Saxophone'].map(instrument => ({ instrument })) },
    { lineupId: 'duo', actSize: '2-piece', bandMembers: ['Lead Vocal', 'Keyboard'].map(instrument => ({ instrument })) }] };
const criteria = { styles: ['Soul'], styleMatch: 'any', preferredSize: 'trio', mustHaveInstruments: ['Saxophone'] };
const enquiry = { ...criteria, clientName: 'Example caller', clientPhone: '+447700900123', eventDateISO: '2027-06-05', address: 'Guildford, Surrey', requirements: 'Wedding band', confirmed: true, selectedBandsConfirmed: true, selectedBands: [{ actId: act._id, lineupId: 'trio' }] };
const payload = { actId: act._id, lineupId: 'trio', dateISO: '2027-06-05', address: 'Guildford, Surrey', clientName: 'Example', clientPhone: '+447700900123', enquiryId: 'PHONE-EXAMPLE', source: 'voice_enquiry_test', dryRun: true };
const lookup = (input, selection) => Promise.resolve(matchVoiceBands([act], input, selection));
const preview = input => interceptAvailabilityTest(input, { loadAct: async () => act, now });

test('voice requests cannot enter live delivery, even without dryRun; ordinary website requests are unchanged', async () => {
  let reads = 0;
  for (const source of ['voice_enquiry_test', 'voice-live', 'VOICE_INBOUND']) {
    for (const dryRun of [false, undefined, 'true']) {
      const result = await interceptAvailabilityTest({ ...payload, source, dryRun }, { loadAct: () => { reads++; assert.fail(); } });
      assert.equal(result.sent, 0);
      assert.equal(result.success, false);
    }
  }
  assert.equal(reads, 0);
  assert.equal(await interceptAvailabilityTest({ source: 'manual_enquiry_board' }), null);
});

test('dry run requires exact lineup, future valid date, real location and confirmed contact', async () => {
  const result = await preview(payload);
  assert.equal(result.testMode, true);
  assert.equal(result.sent, 0);
  assert.equal(result.request.vocalistRoles, 1);
  assert.equal(result.deliveryChecksPending, true);
  assert.equal(result.availabilityChecked, false);
  for (const change of [{ lineupId: '' }, { lineupId: 'missing' }, { dateISO: '2027-02-30' }, { dateISO: '2025-06-05' }, { address: 'TBC' }, { clientPhone: '', clientEmail: '' }, { enquiryId: '' }]) {
    assert.equal((await preview({ ...payload, ...change })).success, false);
  }
  const resultPrivate = await interceptAvailabilityTest(payload, { loadAct: async () => ({ ...act, privateFee: 999, email: 'PRIVATE', lineups: act.lineups.map(item => ({ ...item, bandMembers: item.bandMembers.map(member => ({ ...member, phone: 'PRIVATE', firstName: 'PRIVATE' })) })) }), now });
  assert.doesNotMatch(JSON.stringify(resultPrivate), /PRIVATE|999|clientPhone/);
});

test('only chosen bands are prepared; repeated requests have stable identity and no delivery queue', async () => {
  const rows = new Map(); const calls = [];
  const handler = createEnquiryToolHandler({ lookupBands: lookup, saveBoardRecord: async row => rows.set(row.websiteKey, row), now: () => now,
    prepareAvailability: async record => {
      const batch = await prepareVoiceAvailabilityBatch(record, { lookupBands: lookup, trigger: async args => { calls.push(args); return preview(args); }, now });
      rows.get(record.websiteKey).availabilityRequestTest = batch;
      return batch;
    } });
  const invoke = (name, args, callId = 'test_call') => handler({ callId, name, arguments: args });
  await assert.rejects(invoke('request_band_availability', { confirmed: true }), /First save/);
  await invoke('lookup_bands', criteria);
  await invoke('save_enquiry', enquiry);
  await assert.rejects(invoke('request_band_availability', { confirmed: false }), /Confirm/);
  const first = await invoke('request_band_availability', { confirmed: true, actId: '222222222222222222222222', dryRun: false });
  const key = rows.get('phone:test_call').availabilityRequestTest.key;
  const second = await invoke('request_band_availability', { confirmed: true });
  assert.equal(rows.size, 1);
  assert.equal(rows.get('phone:test_call').availabilityRequestTest.key, key);
  assert.deepEqual(first, second);
  assert.deepEqual([first.prepared, first.testMode, first.sent, first.messagesSent], [true, true, 0, false]);
  assert.equal(first.requests[0].bandName, act.tscName);
  assert.ok(calls.every(item => item.actId === act._id && item.lineupId === 'trio' && item.dryRun === true && item.source === 'voice_enquiry_test'));
  await assert.rejects(invoke('request_band_availability', { confirmed: true }, 'other_call'), /First save/);
  await assert.rejects(invoke('save_enquiry', { ...enquiry, confirmed: false }));
  await assert.rejects(invoke('request_band_availability', { confirmed: true }), /First save/);
  await invoke('save_enquiry', enquiry);
  await invoke('lookup_bands', criteria);
  await assert.rejects(invoke('request_band_availability', { confirmed: true }), /First save/);
  const schema = ENQUIRY_ASSISTANT_TOOLS.find(tool => tool.name === 'request_band_availability').parameters;
  assert.deepEqual(Object.keys(schema.properties), ['confirmed']);
  assert.equal(schema.additionalProperties, false);
});

test('callbacks and unselected suggestions never prepare band requests', async () => {
  const handler = createEnquiryToolHandler({ lookupBands: lookup, saveBoardRecord: async () => {}, prepareAvailability: () => assert.fail(), now: () => now });
  await handler({ callId: 'callback', name: 'lookup_bands', arguments: criteria });
  await handler({ callId: 'callback', name: 'request_callback', arguments: enquiry });
  await assert.rejects(handler({ callId: 'callback', name: 'request_band_availability', arguments: { confirmed: true } }));
  await handler({ callId: 'none', name: 'lookup_bands', arguments: criteria });
  await handler({ callId: 'none', name: 'save_enquiry', arguments: { ...enquiry, selectedBands: [] } });
  await assert.rejects(handler({ callId: 'none', name: 'request_band_availability', arguments: { confirmed: true } }));
});

test('ambiguous lineups block preparation; a unique fresh match can be resolved without first-lineup fallback', async () => {
  const record = { ...enquiry, websiteKey: 'phone:test', enquiryRef: 'PHONE-TEST', selectedBands: [{ actId: act._id, name: act.tscName, lineupId: '' }] };
  let calls = 0;
  const trigger = async args => { calls++; return preview(args); };
  const ambiguous = await prepareVoiceAvailabilityBatch({ ...record, preferredSize: 'flexible', mustHaveInstruments: [] }, { lookupBands: lookup, trigger, now });
  assert.equal(ambiguous.status, 'needs_details');
  assert.equal(calls, 0);
  const unique = await prepareVoiceAvailabilityBatch(record, { lookupBands: lookup, trigger, now });
  assert.equal(unique.requests[0].lineupId, 'trio');
  assert.equal(calls, 1);
  const changed = await prepareVoiceAvailabilityBatch(record, { lookupBands: async () => ({ bands: [] }), trigger, now });
  assert.equal(changed.requests.length, 0);
  assert.equal(changed.status, 'needs_details');
  assert.equal(calls, 1);
});

test('snapshot fingerprints change with event, preferences, contact, or selected lineup; preview remains an inert field', () => {
  const base = { ...enquiry, websiteKey: 'phone:test' };
  for (const change of [{ address: 'London' }, { clientPhone: '+447700900456' }, { eventDateISO: '2027-06-06' }, { styleMatch: 'all' }, { selectedBands: [{ actId: act._id, lineupId: 'duo' }] }]) {
    assert.notEqual(voicePreviewKey({ ...base, ...change }), voicePreviewKey(base));
    assert.notEqual(voicePreviewSnapshot({ ...base, ...change }), voicePreviewSnapshot(base));
  }
  const doc = new EnquiryBoardItem({ ...base, availabilityRequestTest: { testMode: true, sent: 0, requests: [{ bandName: act.tscName }] } });
  assert.equal(doc.toObject().availabilityRequestTest.sent, 0);
  assert.equal(doc.actId, undefined); // not a live request record
});

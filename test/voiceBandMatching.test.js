import test from 'node:test';
import assert from 'node:assert/strict';
import { matchVoiceBands, parsePreferredSize } from '../services/voiceBandMatching.js';
import { createEnquiryToolHandler } from '../services/incomingEnquiryAssistant.js';

const members = instruments => instruments.map(instrument => ({ instrument, firstName: 'PRIVATE NAME', phoneNumber: 'PRIVATE PHONE', fee: 999 }));
const lineup = (id, size, instruments) => ({ lineupId: id, actSize: `${size}-Piece`, bandMembers: members(instruments) });
const small = { _id: '111111111111111111111111', tscName: 'Example Soul Trio', slug: 'example-trio', status: 'approved', genre: ['RnB, HipHop & Garage', 'Soul & Motown'],
  lineups: [lineup('trio-sax', 3, ['Lead Vocal', 'Keyboard', 'Saxophone'])] };
const varied = { _id: '222222222222222222222222', tscName: 'Example Party Band', status: 'live', genre: ['Pop & Classic Pop', 'Soul & Motown'],
  lineups: [lineup('four-sax', 4, ['Lead Vocal', 'Bass Guitar', 'Drums', 'Saxophone']), lineup('five-no-sax', 5, ['Lead Vocal', 'Electric Guitar', 'Bass Guitar', 'Drums', 'Keyboard']),
    lineup('six-horns', 6, ['Lead Vocal', 'Bass Guitar', 'Drums', 'Keyboard', 'Saxophone', 'Trumpet'])] };

test('R&B and trio match catalogue genres and performer counts without leaking private fields', () => {
  const result = matchVoiceBands([small, varied], { styles: ['R&B'], preferredSize: 'trio', mustHaveInstruments: ['sax'] });
  assert.deepEqual(result.bands.map(band => band.actId), [small._id]);
  assert.equal(result.bands[0].lineups[0].size, 3);
  assert.deepEqual(result.constraints.styles, ['RnB']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|999|phoneNumber|firstName|fee/);
  assert.equal(result.availabilityChecked, false);
  assert.equal(result.pricesQuoted, false);
});

test('size and instruments must match the same lineup, without silently dropping constraints', () => {
  assert.equal(matchVoiceBands([varied], { styles: ['Soul'], preferredSize: '5-piece', mustHaveInstruments: ['Saxophone'] }).bands.length, 0);
  assert.equal(matchVoiceBands([varied], { styles: ['Soul'], preferredSize: '4-piece', mustHaveInstruments: ['Saxophone'] }).bands[0].lineups[0].lineupId, 'four-sax');
  assert.equal(matchVoiceBands([varied], { styles: ['RnB'], preferredSize: '6-piece', mustHaveInstruments: ['Brass section'] }).bands.length, 0);
});

test('a brass section needs two players and one multi-instrumentalist cannot fill two horn roles at once', () => {
  assert.equal(matchVoiceBands([small], { styles: ['Soul'], mustHaveInstruments: ['Brass section'] }).bands.length, 0);
  assert.equal(matchVoiceBands([varied], { styles: ['Soul'], mustHaveInstruments: ['Brass section'] }).bands[0].lineups[0].size, 6);
  const oneHornPlayer = { ...small, lineups: [lineup('single-horn', 3, ['Lead Vocal', 'Drums', 'Trumpet/Trombone/Rapper'])] };
  assert.equal(matchVoiceBands([oneHornPlayer], { styles: ['Soul'], mustHaveInstruments: ['Brass section'] }).bands.length, 0);
  assert.equal(matchVoiceBands([oneHornPlayer], { styles: ['Soul'], mustHaveInstruments: ['Trumpet', 'Trombone'] }).bands.length, 0);
});

test('all requested styles differ from acceptable alternatives, and draft/test bands stay excluded', () => {
  assert.equal(matchVoiceBands([varied], { styles: ['Soul', 'Rock'], styleMatch: 'all' }).bands.length, 0);
  assert.equal(matchVoiceBands([varied], { styles: ['Soul', 'Rock'], styleMatch: 'any' }).bands.length, 1);
  assert.equal(matchVoiceBands([{ ...small, status: 'draft' }, { ...varied, isTest: true }], { styles: ['Soul'] }).bands.length, 0);
});

test('unknown requirements need clarification and managers do not become performers', () => {
  for (const input of [{ styles: ['Blues'] }, { styles: ['Soul'], mustHaveInstruments: ['brass'] }, { preferredSize: '5-piece plus a DJ' }]) assert.equal(matchVoiceBands([small, varied], input).needsClarification, true);
  const inconsistent = { ...small, lineups: [lineup('manager', 4, ['Lead Vocal', 'Keyboard', 'Saxophone', 'Manager'])] };
  assert.equal(matchVoiceBands([inconsistent], { styles: ['Soul'], preferredSize: '4-piece' }).bands.length, 0);
  const flexible = matchVoiceBands([inconsistent], { styles: ['Soul'], preferredSize: 'flexible' });
  assert.equal(flexible.bands[0].lineups[0].size, null);
  assert.equal(flexible.bands[0].lineups[0].sizeNeedsReview, true);
  const withUnusedRow = { ...small, lineups: [{ ...small.lineups[0], bandMembers: [...small.lineups[0].bandMembers, { instrument: '' }] }] };
  assert.equal(matchVoiceBands([withUnusedRow], { styles: ['RnB'], preferredSize: 'trio' }).bands[0].lineups[0].size, 3);
});

test('size alternatives, ranges and bounds retain their meaning', () => {
  assert.deepEqual(parsePreferredSize('3 or 5-piece').values, [3, 5]);
  assert.deepEqual(parsePreferredSize('5–7 piece').values, [5, 6, 7]);
  assert.deepEqual(parsePreferredSize('Trio / 3-piece').values, [3]);
  for (const bad of ['0-piece', '999999999-piece', '8-5 piece', 'large']) assert.equal(parsePreferredSize(bad).unknown, true);
});

const now = new Date('2026-11-11T12:00:00Z');
const details = { clientName: 'Test caller', clientPhone: '+447700900123', eventDateISO: '2027-06-05', address: 'Surrey', requirements: 'RnB trio with sax',
  styles: ['RnB'], preferredSize: 'trio', mustHaveInstruments: ['Saxophone'], confirmed: true };
const choice = { actId: small._id, lineupId: 'trio-sax' };
function tools() {
  const saved = new Map();
  const handler = createEnquiryToolHandler({ lookupBands: (input, selection) => matchVoiceBands([small, varied], input, selection), saveBoardRecord: record => saved.set(record.websiteKey, record), now: () => now });
  return { handler, saved };
}

test('caller-confirmed preferences and catalogue selections save once to the four board fields', async () => {
  const { handler, saved } = tools();
  await handler({ callId: 'test-call', name: 'lookup_bands', arguments: details });
  const request = { callId: 'test-call', name: 'save_enquiry', arguments: { ...details, selectedBands: [choice], selectedBandsConfirmed: true } };
  const result = await handler(request); await handler(request);
  assert.equal(saved.size, 1);
  const row = [...saved.values()][0];
  assert.deepEqual(row.styles, ['RnB']); assert.equal(row.preferredSize, 'trio'); assert.deepEqual(row.mustHaveInstruments, ['Saxophone']);
  assert.equal(row.selectedBands[0].name, small.tscName); assert.equal(String(row.selectedBands[0].actId), small._id); assert.equal(row.selectedBands[0].lineupId, 'trio-sax');
  assert.equal(row.bandSize, undefined);
  assert.deepEqual([result.saved, result.messagesSent, result.bookingConfirmed], [true, false, false]);
});

test('search suggestions are not selections; confirmation, same-call provenance and matching are enforced', async () => {
  const { handler, saved } = tools();
  await handler({ callId: 'call-one', name: 'lookup_bands', arguments: details });
  const save = patch => handler({ callId: 'call-one', name: 'save_enquiry', arguments: { ...details, selectedBands: [choice], selectedBandsConfirmed: true, ...patch } });
  await assert.rejects(save({ selectedBandsConfirmed: false }), /Confirm/);
  await assert.rejects(save({ selectedBands: [{ ...choice, actId: varied._id }] }), /Look up/);
  await assert.rejects(save({ preferredSize: '5-piece' }), /does not match/);
  await assert.rejects(save({ selectedBands: [{ ...choice, lineupId: 'invented' }] }), /specific lineup/);
  await assert.rejects(handler({ callId: 'call-two', name: 'save_enquiry', arguments: { ...details, selectedBands: [choice], selectedBandsConfirmed: true } }), /Look up/);
  assert.equal(saved.size, 0);
  const withoutChoice = await handler({ callId: 'call-one', name: 'save_enquiry', arguments: details });
  assert.equal(withoutChoice.saved, true); assert.equal([...saved.values()][0].selectedBands, undefined);
});

test('an unmatched enquiry can still save preferences for staff without invented bands', async () => {
  const { handler, saved } = tools();
  await handler({ callId: 'unmatched', name: 'save_enquiry', arguments: { ...details, styles: ['Blues'], selectedBands: [] } });
  assert.deepEqual([...saved.values()][0].styles, ['Blues']); assert.deepEqual([...saved.values()][0].selectedBands, []);
});

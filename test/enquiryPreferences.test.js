import test from 'node:test';
import assert from 'node:assert/strict';
import EnquiryBoardItem from '../models/enquiryBoardItem.js';
import { normalizeEnquiryPreferences, resolveSelectedBands, enquiryPreferenceSearchValues } from '../services/enquiryPreferences.js';

const actId = '6802679720c1fc5d211f4304';
test('enquiry preferences survive persistence independently of the quoted band size', async () => {
  const preferences = normalizeEnquiryPreferences({ styles: [' Soul ', 'RnB', 'soul'], preferredSize: ' Trio or 5-piece ', mustHaveInstruments: ['Saxophone', 'Saxophone'], selectedBands: [{ actId, name: 'Example band', lineupId: 'five' }] });
  const row = new EnquiryBoardItem({ ...preferences, bandSize: 8 });
  await row.validate();
  const saved = row.toObject();
  assert.deepEqual(saved.styles, ['soul', 'RnB']);
  assert.equal(saved.preferredSize, 'Trio or 5-piece');
  assert.equal(saved.bandSize, 8);
  assert.equal(String(saved.selectedBands[0].actId), actId);
  assert.equal(saved.selectedBands[0].lineupId, 'five');
  assert.deepEqual(saved.mustHaveInstruments, ['Saxophone']);
  assert.ok(enquiryPreferenceSearchValues(saved).includes('Example band'));
});

test('partial changes preserve omitted fields and explicit empty values clear preferences', () => {
  assert.deepEqual(normalizeEnquiryPreferences({ notes: 'ordinary note' }), {});
  assert.deepEqual(normalizeEnquiryPreferences({ styles: [], preferredSize: '', selectedBands: [] }), { styles: [], preferredSize: '', selectedBands: [] });
  for (const bad of [{ styles: 'Soul' }, { mustHaveInstruments: [null] }, { preferredSize: 'x'.repeat(81) }, { selectedBands: [{ actId: 'invalid', name: 'Band' }] }, { selectedBands: [{}] }]) assert.throws(() => normalizeEnquiryPreferences(bad));
});

test('selected bands use real catalogue names and reject missing bands or mismatched lineups', async () => {
  const input = normalizeEnquiryPreferences({ selectedBands: [{ actId, name: 'Untrusted label', lineupId: 'five' }] }).selectedBands;
  const load = async () => [{ _id: actId, tscName: 'Catalogue name', lineups: [{ lineupId: 'five' }] }];
  assert.equal((await resolveSelectedBands(input, load))[0].name, 'Catalogue name');
  await assert.rejects(resolveSelectedBands(input, async () => []), /could not be found/);
  await assert.rejects(resolveSelectedBands([{ ...input[0], lineupId: 'eight' }], load), /no longer belongs/);
});

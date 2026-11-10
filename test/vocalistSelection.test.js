import test from 'node:test';
import assert from 'node:assert/strict';
import { availableVocalistsForLineup } from '../utils/enquiryAvailability.js';
import { validateVocalistSelection, loadVocalistChoices } from '../services/vocalistChoiceService.js';
const lineup = { _id: 'lineup', bandMembers: [{ instrument: 'Lead Female Vocal' }, { instrument: 'Lead Male Vocal' }] };
const lead = (slot, reply = 'unavailable') => ({ slotIndex: slot, musicianId: `lead${slot}`, isDeputy: false, reply });
const deputy = (slot, id) => ({ slotIndex: slot, musicianId: id, isDeputy: true, reply: 'yes' });
test('mixed usual and deputy coverage sends one band-level readiness signal only after every role is filled', () => {
  assert.equal(availableVocalistsForLineup([lead(0, 'yes')], lineup).readyToNotify, false);
  const ready = availableVocalistsForLineup([lead(0, 'yes'), deputy(1, 'alex')], lineup);
  assert.equal(ready.readyToNotify, true); assert.equal(ready.deputyOnly, false);
});
test('deputy-only email waits for all regular singers to decline and two distinct choices per role', () => {
  const choices = [deputy(0, 'a'), deputy(0, 'b'), deputy(1, 'c'), deputy(1, 'd')];
  assert.equal(availableVocalistsForLineup(choices, lineup).readyToNotify, false);
  assert.equal(availableVocalistsForLineup([lead(0), lead(1, null), ...choices], lineup).readyToNotify, false);
  assert.equal(availableVocalistsForLineup([lead(0), lead(1), ...choices.slice(0, 3)], lineup).readyToNotify, false);
  const ready = availableVocalistsForLineup([lead(0), lead(1), ...choices], lineup);
  assert.equal(ready.readyToNotify, true); assert.equal(ready.deputyOnly, true);
});
test('a person cannot cover two simultaneous roles; matching finds a valid distinct combination', () => {
  assert.equal(availableVocalistsForLineup([deputy(0, 'a'), deputy(1, 'a')], lineup).complete, false);
  const ready = availableVocalistsForLineup([deputy(0, 'a'), deputy(0, 'b'), deputy(1, 'a')], lineup);
  assert.deepEqual(ready.selected.map(row => row.musicianId), ['b', 'a']);
  assert.equal(validateVocalistSelection(ready, ['a', 'a']), null);
  assert.equal(validateVocalistSelection(ready, ['a']), null);
  assert.equal(validateVocalistSelection(ready, ['a', 'unknown']), null);
  assert.deepEqual(validateVocalistSelection(ready, ['a', 'b']).map(row => row.musicianId), ['b', 'a']);
});
test('withdrawals supersede previous yes replies, and duplicate yes rows never count as two options', () => {
  const rows = [lead(0), lead(1), deputy(0, 'a'), deputy(0, 'a'), deputy(1, 'c'), deputy(1, 'd')];
  assert.equal(availableVocalistsForLineup(rows, lineup).readyToNotify, false);
  const withdrawn = availableVocalistsForLineup([deputy(0, 'a'), { ...deputy(0, 'a'), reply: 'no', updatedAt: '2027-01-01' }, deputy(1, 'c')], lineup);
  assert.equal(withdrawn.complete, false);
});
test('cart choices are scoped to selected lineup and venue; later confirmed bookings supersede cached yes replies', async () => {
  const query = data => ({ lean: async () => data, select: () => query(data) });
  const responses = [deputy(0, 'a'), deputy(0, 'b'), deputy(1, 'c')].map(row => ({ ...row, formattedAddress: 'Venue, London' }));
  const summary = await loadVocalistChoices({ actId: 'act', lineupId: 'lineup', dateISO: '2027-06-05', address: 'Venue, London' }, {
    ActModel: { findById: () => query({ lineups: [lineup] }) },
    AvailabilityModel: { find: filter => { assert.equal(filter.lineupId, 'lineup'); return query([...responses, { ...deputy(0, 'outside'), formattedAddress: 'Different venue' }]); } },
    MusicianModel: { find: () => query(['a', 'b', 'c'].map(_id => ({ _id, firstName: _id, status: 'approved', vocals: { type: ['Lead Vocalist'] } }))) },
    BookingModel: { find: () => query([{ actsSummary: [{ chosenVocalists: [{ musicianId: 'a' }] }] }]) },
  });
  assert.deepEqual(summary.roles[0].candidates.map(row => row.musicianId), ['b']);
  assert.equal(summary.complete, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { originalRoleProgress } from '../services/originalsRoleProgressService.js';
import { presentOriginalWorkspace } from '../services/originalsAccessService.js';

const now = new Date('2026-11-05T13:00:00Z');
const owner = '111111111111111111111111', viewer = '222222222222222222222222';
const snapshot = () => ({
  project: { _id: 'project', ownerId: owner, state: 'foundation_open', currentRoundId: 'round', requestedRoles: [{ name: 'Vocal' }, { name: 'Keys' }, { name: 'Bass' }] },
  rounds: [{ _id: 'round', type: 'foundation', eligibleRoles: ['Vocal', 'Keys'], state: 'open', slotLimit: 3 }],
  reservations: [], submissions: [], futureReservations: [], assets: [], notifications: [], invitations: [], creditVersions: [], issues: [], messages: [],
});
const reservation = (extra = {}) => ({ _id: 'vocal-1', musicianId: viewer, roundId: 'round', roleName: 'Vocal', state: 'active', seatNumber: 1,
  reservedAt: new Date('2026-11-05T12:00:00Z'), expiresAt: new Date('2026-11-06T12:00:00Z'), ...extra });

test('each instrument exposes its own current slot deadlines without confusing the round closing time', () => {
  const data = snapshot(); data.viewerId = viewer;
  data.rounds[0].closesAt = new Date('2026-11-12T12:00:00Z');
  data.reservations = [reservation(), reservation({ _id: 'keys', musicianId: 'other', roleName: 'Keys', seatNumber: 2, expiresAt: new Date('2026-11-06T15:00:00Z') }),
    reservation({ _id: 'vocal-2', musicianId: 'third', seatNumber: 3, expiresAt: new Date('2026-11-06T17:00:00Z') })];
  const [vocal, keys, bass] = originalRoleProgress(data, now);
  assert.deepEqual(vocal.slots, [
    { slotNumber: 1, state: 'active', expectedBy: '2026-11-06T12:00:00.000Z', isOwn: true },
    { slotNumber: 3, state: 'active', expectedBy: '2026-11-06T17:00:00.000Z', isOwn: false },
  ]);
  assert.equal(keys.slots[0].expectedBy, '2026-11-06T15:00:00.000Z');
  assert.equal(bass.timingState, 'future_round');
  assert.deepEqual(bass.slots, []);
});
test('approved extensions use the actual new expiry; a pending request cannot move the expected date', () => {
  const data = snapshot();
  data.reservations = [reservation({ extensionRequest: { status: 'pending', hours: 24 } })];
  assert.equal(originalRoleProgress(data, now)[0].slots[0].expectedBy, '2026-11-06T12:00:00.000Z');
  data.reservations[0].expiresAt = new Date('2026-11-07T12:00:00Z');
  data.reservations[0].extensionRequest.status = 'approved';
  assert.equal(originalRoleProgress(data, now)[0].slots[0].expectedBy, '2026-11-07T12:00:00.000Z');
});
test('released, cancelled, expired, failed, unheld and previous-round slots do not appear as expected recordings', () => {
  const data = snapshot();
  data.reservations = [reservation({ state: 'released' }), reservation({ state: 'cancelled' }), reservation({ state: 'expired' }),
    reservation({ expiresAt: new Date('2026-11-05T12:00:00Z') }), reservation({ roundId: 'old' }), reservation({ slotHeld: false }),
    reservation({ _id: 'failed' }), reservation({ expiresAt: 'invalid' })];
  data.submissions = [{ reservationId: 'failed', state: 'rejected', roleName: 'Vocal' }];
  const vocal = originalRoleProgress(data, now)[0];
  assert.deepEqual(vocal.slots, []);
  assert.equal(vocal.timingState, 'awaiting_reservation');
});
test('submitted or approved recordings are not presented as outstanding recording deadlines', () => {
  const data = snapshot(); data.reservations = [reservation({ state: 'submitted' })];
  data.submissions = [{ roleName: 'Vocal', reservationId: 'vocal-1', roundId: 'round', state: 'submitted' }];
  const vocal = originalRoleProgress(data, now)[0];
  assert.equal(vocal.timingState, 'review');
  assert.equal(vocal.slots[0].expectedBy, null);
  data.submissions[0].state = 'accepted';
  assert.deepEqual(originalRoleProgress(data, now)[0].slots, []);
  assert.equal(originalRoleProgress(data, now)[0].timingState, 'complete');
});
test('advance places and unreserved roles have no invented date or newly started countdown', () => {
  const data = snapshot(); data.futureReservations = [{ roleName: 'Bass', state: 'waiting' }];
  const before = JSON.stringify(data);
  const [vocal, , bass] = originalRoleProgress(data, now);
  assert.equal(vocal.timingState, 'awaiting_reservation');
  assert.equal(bass.timingState, 'future_round');
  assert.equal(bass.advanceCount, 1);
  assert.deepEqual(bass.slots, []);
  assert.equal(JSON.stringify(data), before);
});
test('legacy reservations receive stable unused round seat numbers', () => {
  const data = snapshot(); data.reservations = [reservation({ _id: 'legacy', seatNumber: undefined }), reservation({ _id: 'numbered', roleName: 'Keys', seatNumber: 1 })];
  const result = originalRoleProgress(data, now);
  assert.equal(result[0].slots[0].slotNumber, 2);
  assert.equal(result[1].slots[0].slotNumber, 1);
});
test('participants can see anonymous timing for another musician without receiving their private reservation', () => {
  const data = snapshot();
  data.reservations = [reservation({ musicianId: 'another-musician', anonymous: true, creditName: 'Private credit', agreementAcceptanceId: 'private-agreement', expiresAt: new Date('2099-01-01T12:00:00Z') })];
  const result = presentOriginalWorkspace(data, { id: viewer, role: 'musician' });
  assert.deepEqual(result.reservations, []);
  assert.deepEqual(result.roleProgress[0].slots, [{ slotNumber: 1, state: 'active', expectedBy: '2099-01-01T12:00:00.000Z', isOwn: false }]);
  const publicTiming = JSON.stringify(result.roleProgress);
  for (const privateValue of ['another-musician', 'Private credit', 'private-agreement', 'vocal-1']) assert.ok(!publicTiming.includes(privateValue));
});

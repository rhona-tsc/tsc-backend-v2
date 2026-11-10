import test from 'node:test';
import assert from 'node:assert/strict';
import Future from '../models/originalRoleReservationModel.js';
import { originalPreferredPlaces, originalAvailableSeat } from '../services/originalsPreferredPlacesService.js';
import { createOriginalProject } from '../controllers/originalsController.js';
import { releaseFutureOriginalRole } from '../controllers/originalsReservationsController.js';
import { getOriginalOwnerAgreement } from '../services/originalsAgreementService.js';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';

const owner = '111111111111111111111111', player = '222222222222222222222222';
const roles = [{ name: 'Bass', foundationEligible: true }, { name: 'Keys', foundationEligible: true }];
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const body = () => ({ title: 'New groove', description: 'A new original', genres: ['Soul'], requestedRoles: roles, preferredMusicians: [{ roleName: 'Bass', musicianId: player }], ownerAgreementAccepted: true, ownerAgreementDisplayName: 'Project Owner', ownerAgreement: getOriginalOwnerAgreement() });
const profiles = [{ _id: owner, firstName: 'Project', lastName: 'Owner', email: 'owner@example.test', profileDeletedAt: null }, { _id: player, profileDeletedAt: null }];

test('preferred selections must match real project roles, with one musician per foundation place', () => {
  assert.deepEqual(originalPreferredPlaces(body().preferredMusicians, roles), [{ roleName: 'Bass', roleKey: 'bass', musicianId: player }]);
  for (const input of [[{ roleName: 'Missing', musicianId: player }], [{ roleName: 'Bass', musicianId: 'bad' }], [...body().preferredMusicians, ...body().preferredMusicians], [{ roleName: 'Bass', musicianId: player }, { roleName: 'Keys', musicianId: player }]]) assert.throws(() => originalPreferredPlaces(input, roles), error => error.status === 400);
});

test('creating a project holds the preferred place atomically without accepting an agreement or starting a clock', async t => {
  const store = originalsTransactionStore(t, { musicians: profiles });
  const res = response(); await createOriginalProject({ user: { id: owner }, body: body() }, res);
  assert.equal(res.code, 201); assert.equal(store.data.projects.length, 1); assert.equal(store.data.futures.length, 1);
  const hold = store.data.futures[0];
  assert.equal(hold.projectId, store.data.projects[0]._id); assert.equal(hold.musicianId, player); assert.equal(hold.assignedByOwner, true); assert.equal(hold.state, 'waiting');
  assert.equal(hold.agreementAcceptanceId, undefined); assert.equal(hold.expiresAt, undefined); assert.equal(store.data.reservations.length, 0); assert.equal(store.data.acceptances.length, 0);
});

test('a failed preferred hold leaves no partially created project', async t => {
  const store = originalsTransactionStore(t, { musicians: profiles });
  t.mock.method(Future, 'create', async () => { throw Object.assign(new Error('Preferred place could not be saved'), { status: 409 }); });
  const res = response(); await createOriginalProject({ user: { id: owner }, body: body() }, res);
  assert.equal(res.code, 409); assert.equal(store.data.projects.length, 0); assert.equal(store.data.futures.length, 0);
});

test('deleted or private test musicians cannot be assigned by ordinary owners', async t => {
  const store = originalsTransactionStore(t, { musicians: [profiles[0], { ...profiles[1], privateTestProfile: true }] });
  const res = response(); await createOriginalProject({ user: { id: owner }, body: body() }, res);
  assert.equal(res.code, 400); assert.equal(store.data.projects.length, 0);
});

test('other applicants cannot consume a preferred seat, including during activation and interrupted linkage', () => {
  const preferred = [{ _id: 'hold', musicianId: player }];
  assert.equal(originalAvailableSeat({ occupied: [], preferred, slotLimit: 3, musicianId: 'other' }), 2);
  const occupied = [{ seatNumber: 2 }, { seatNumber: 3 }];
  assert.equal(originalAvailableSeat({ occupied, preferred, slotLimit: 3, musicianId: 'other' }), undefined);
  assert.equal(originalAvailableSeat({ occupied, preferred, slotLimit: 3, musicianId: player, futureReservationId: 'hold' }), 1);
  assert.equal(originalAvailableSeat({ occupied: [{ seatNumber: 1, futureReservationId: 'hold' }], preferred, slotLimit: 3, musicianId: 'other' }), 2);
});

test('the owner can release an unactivated assigned place but cannot release another musician’s self-reserved place', async t => {
  const projectId = '333333333333333333333333', futureId = '444444444444444444444444';
  const store = originalsTransactionStore(t, { projects: [{ _id: projectId, ownerId: owner }], futures: [{ _id: futureId, projectId, musicianId: player, state: 'waiting', assignedByOwner: true }] });
  const req = { user: { id: owner }, params: { id: projectId, futureId } };
  const res = response(); await releaseFutureOriginalRole(req, res); assert.equal(res.code, 200); assert.equal(store.data.futures[0].state, 'released');
  store.data.futures[0].state = 'waiting'; store.data.futures[0].assignedByOwner = false;
  const refused = response(); await releaseFutureOriginalRole(req, refused); assert.equal(refused.code, 409); assert.equal(store.data.futures[0].state, 'waiting');
});

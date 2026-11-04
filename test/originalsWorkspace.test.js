import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageOriginalProject, getOriginalRoundDeadline, isOriginalRoundExpired } from '../services/originalsPolicyService.js';
import { presentOriginalWorkspace } from '../services/originalsAccessService.js';
import { prepareOriginalRoundClock, startOriginalRoundClock } from '../services/originalsRoundClockService.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Project from '../models/originalProjectModel.js';
import Invitation from '../models/originalInvitationModel.js';
import { searchOriginalMusicians, inviteOriginalMusician, openNextOriginalRound, decideOriginalSubmission, decideReservationExtension } from '../controllers/originalsWorkflowController.js';
import { createOriginalCreditVersion, finaliseOriginalCreditsAsAdmin } from '../controllers/originalsCreditsController.js';

const owner = '111111111111111111111111';
const participant = '222222222222222222222222';
const projectId = '333333333333333333333333';
const project = { _id: projectId, ownerId: owner, ownerName: 'Veronica Downie', ownerEmail: 'private@example.test', currentRoundId: 'round' };
const response = () => ({ code: 200, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } });

test('project management is determined by ownership/admin status, not preview membership', () => {
  assert.equal(canManageOriginalProject(project, { id: owner }), true);
  assert.equal(canManageOriginalProject(project, { id: participant, email: 'rhonagdownie@gmail.com' }), false);
  assert.equal(canManageOriginalProject(project, { id: participant, role: 'agent' }), true);
  assert.equal(canManageOriginalProject({}, {}), false);
});

test('participant workspace omits private invitations, notifications and other pending takes', () => {
  const input = {
    project, rounds: [], reservations: [{ musicianId: owner }, { musicianId: participant }],
    submissions: [{ _id: 'other', musicianId: owner, state: 'submitted' }, { _id: 'mine', musicianId: participant, state: 'submitted' }],
    assets: [{ _id: 'secret', ownerId: owner, state: 'active', kind: 'take_stem' }, { _id: 'guide', state: 'active', kind: 'guide_track' }, { _id: 'mine', ownerId: participant, state: 'active', kind: 'take_stem' }],
    notifications: [{ secret: true }], invitations: [{ message: 'private invitation' }], creditVersions: [], issues: [], messages: [],
  };
  const result = presentOriginalWorkspace(input, { id: participant });
  assert.equal(result.permissions.canManage, false);
  assert.equal(result.project.ownerName, 'Veronica D.');
  assert.equal(result.project.ownerEmail, '');
  assert.deepEqual(result.invitations, []);
  assert.deepEqual(result.notifications, []);
  assert.deepEqual(result.assets.map(item => item._id), ['guide', 'mine']);
  assert.equal(result.reservations.length, 1);
  assert.equal(result.submissions.length, 1);
  assert.equal(presentOriginalWorkspace(input, { id: owner }).invitations.length, 1);
});

test('null round deadlines stay open, while started deadlines expire after seven days', () => {
  assert.equal(isOriginalRoundExpired({ closesAt: null }), false);
  const from = new Date('2026-11-04T12:00:00Z');
  assert.equal(getOriginalRoundDeadline(from).toISOString(), '2026-11-11T12:00:00.000Z');
  assert.equal(isOriginalRoundExpired({ closesAt: getOriginalRoundDeadline(from) }, new Date('2026-11-11T12:00:00Z')), true);
});

test('idle rounds left expired by the old publication clock recover without consuming their window', async t => {
  t.mock.method(Reservation, 'findOne', () => ({ sort: () => ({ lean: async () => null }) }));
  t.mock.method(Submission, 'exists', async () => false);
  let patch;
  t.mock.method(Round, 'findOneAndUpdate', async (_query, update) => { patch = update.$set; return { _id: 'round', ...patch }; });
  const mirror = t.mock.method(Project, 'updateOne', async () => ({}));
  const result = await prepareOriginalRoundClock({ _id: 'round', projectId, type: 'foundation', state: 'review', closeReason: 'seven_day_window_ended', closesAt: new Date(0) });
  assert.equal(result.state, 'open');
  assert.equal(patch.closesAt, null);
  assert.equal(mirror.mock.callCount(), 1);
});

test('manual closures and already-started clocks are not reset', async t => {
  const lookup = t.mock.method(Reservation, 'findOne', () => { throw new Error('must not reset this round'); });
  const closed = { state: 'closed', closeReason: 'next_round_opened' };
  const active = { state: 'open', clockStartedAt: new Date(), closesAt: new Date() };
  assert.equal(await prepareOriginalRoundClock(closed), closed);
  assert.equal(await prepareOriginalRoundClock(active), active);
  assert.equal(lookup.mock.callCount(), 0);
});

test('the first successful reservation starts one clock; later racers cannot extend it', async t => {
  let stored;
  t.mock.method(Round, 'findOneAndUpdate', async (query, update) => {
    assert.equal(query.clockStartedAt, null);
    if (stored) return null;
    stored = { _id: 'round', ...update.$set }; return stored;
  });
  t.mock.method(Round, 'findOne', async () => stored);
  const invitations = t.mock.method(Invitation, 'updateMany', async () => ({}));
  const first = new Date('2026-11-04T12:00:00Z');
  await Promise.all([startOriginalRoundClock('round', first), startOriginalRoundClock('round', new Date('2026-11-05T12:00:00Z'))]);
  assert.equal(stored.clockStartedAt, first);
  assert.equal(stored.closesAt.toISOString(), '2026-11-11T12:00:00.000Z');
  assert.equal(invitations.mock.callCount(), 1);
});

test('participant cannot call owner-only actions even by bypassing the UI', async t => {
  const projectDoc = { ...project, requestedRoles: [], lean: async () => project };
  t.mock.method(Project, 'findById', () => projectDoc);
  t.mock.method(Round, 'findOne', async () => ({ _id: 'round', projectId }));
  t.mock.method(Submission, 'findById', async () => ({ projectId, state: 'submitted' }));
  t.mock.method(Reservation, 'findById', async () => ({ projectId, extensionRequest: { status: 'pending' } }));
  const req = { params: { id: projectId, roundId: 'round', submissionId: 'submission', reservationId: 'reservation' }, query: { projectId, q: 'Veronica' }, body: { type: 'instrument' }, user: { id: participant } };
  for (const handler of [searchOriginalMusicians, inviteOriginalMusician, openNextOriginalRound, decideOriginalSubmission, decideReservationExtension, createOriginalCreditVersion, finaliseOriginalCreditsAsAdmin]) {
    const res = response(); await handler(req, res); assert.equal(res.code, 403, handler.name);
  }
});

test('an idle round is not closed by the automation before its first reservation', async t => {
  const { runOriginalsAutomation } = await import('../services/originalsAutomationService.js');
  t.mock.method(Reservation, 'find', async () => []);
  t.mock.method(Reservation, 'findOne', () => ({ sort: () => ({ lean: async () => null }) }));
  t.mock.method(Submission, 'exists', async () => false);
  t.mock.method(Submission, 'countDocuments', async () => 0);
  t.mock.method(Round, 'find', async () => [{ _id: 'round', projectId, state: 'open', closesAt: null, slotLimit: 3 }]);
  const result = await runOriginalsAutomation({ now: new Date('2030-01-01T12:00:00Z') });
  assert.equal(result.roundsClosed, 0);
});

test('a failed reservation never starts the round clock; a successful one keeps its own 24 hours', async t => {
  const { reserveOriginalRound } = await import('../controllers/originalsWorkflowController.js');
  const { default: Event } = await import('../models/originalEventModel.js');
  const round = { _id: '444444444444444444444444', projectId, type: 'foundation', eligibleRoles: ['Keys'], state: 'open', closesAt: null, clockStartedAt: null, slotLimit: 3 };
  t.mock.method(Project, 'findById', () => ({ lean: async () => ({ ...project, currentRoundId: round._id }) }));
  t.mock.method(Round, 'findById', async () => round);
  t.mock.method(Reservation, 'findOne', () => ({ sort: () => ({ lean: async () => null }) }));
  t.mock.method(Submission, 'exists', async () => false);
  t.mock.method(Reservation, 'updateMany', async () => ({}));
  t.mock.method(Reservation, 'countDocuments', async () => 0);
  let fail = true;
  t.mock.method(Reservation, 'create', async data => { if (fail) throw Object.assign(new Error('duplicate'), { code: 11000 }); return { _id: '555555555555555555555555', ...data }; });
  const start = t.mock.method(Round, 'findOneAndUpdate', async (_query, update) => ({ ...round, ...update.$set }));
  t.mock.method(Invitation, 'updateMany', async () => ({}));
  t.mock.method(Event, 'create', async () => ({}));
  const req = { params: { roundId: round._id }, body: { roleName: 'Keys' }, user: { id: participant } };
  const failed = response(); await reserveOriginalRound(req, failed);
  assert.equal(failed.code, 409); assert.equal(start.mock.callCount(), 0);
  fail = false;
  const success = response(); await reserveOriginalRound(req, success);
  assert.equal(success.code, 201);
  assert.equal(start.mock.callCount(), 1);
  assert.equal(success.body.reservation.expiresAt - success.body.reservation.reservedAt, 24 * 3600000);
  assert.equal(success.body.round.closesAt - success.body.reservation.reservedAt, 7 * 24 * 3600000);
});

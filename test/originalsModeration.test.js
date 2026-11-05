import test from 'node:test';
import assert from 'node:assert/strict';
import { submitOriginalProjectForModeration, listOriginalsModeration, decideOriginalProjectModeration } from '../controllers/originalsController.js';
import { getOriginalOwnerAgreement, originalOwnerAgreementAcceptance } from '../services/originalsAgreementService.js';
import Project from '../models/originalProjectModel.js';
import Round from '../models/originalRoundModel.js';
import Event from '../models/originalEventModel.js';
import Email from '../models/originalProjectEmailModel.js';
import Musician from '../models/musicianModel.js';

const owner = '111111111111111111111111', id = '222222222222222222222222';
const user = { id: owner, role: 'admin' };
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const fixture = () => ({ _id: id, ownerId: owner, ownerName: 'Example Owner', title: 'New original', description: 'Project brief', genres: ['Soul'], sourceType: 'none', requestedRoles: [{ name: 'Vocal', foundationEligible: true }], originalWorkConfirmed: true, ownerAgreement: originalOwnerAgreementAcceptance({ ownerAgreementAccepted: true, ownerAgreementDisplayName: 'Example Owner', ownerAgreement: getOriginalOwnerAgreement() }), state: 'pending_moderation', moderation: { status: 'pending', submittedAt: new Date('2026-11-05T12:00:00Z') } });
function setup(t, project = fixture()) {
  const writes = [], queued = [], rounds = [], events = [];
  t.mock.method(Project, 'findById', async () => project);
  t.mock.method(Project, 'findOneAndUpdate', async (filter, update) => { writes.push({ filter, update }); return { ...project, ...update.$set }; });
  t.mock.method(Project, 'updateOne', async () => ({}));
  t.mock.method(Event, 'create', async event => { events.push(event); });
  t.mock.method(Email, 'updateOne', async (filter, update) => { queued.push(update.$setOnInsert); });
  t.mock.method(Musician, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(Round, 'findOneAndUpdate', async (filter, update) => { rounds.push({ ...update.$setOnInsert, ...update.$set }); return { _id: '333333333333333333333333', ...update.$setOnInsert, ...update.$set }; });
  return { project, writes, queued, rounds, events };
}

test('moderation submission queues a single alert to TSC after saving the project', async t => {
  const state = setup(t); state.project.state = 'draft'; let saves = 0;
  state.project.save = async () => { saves++; };
  const res = response();
  await submitOriginalProjectForModeration({ user, params: { id } }, res);
  assert.equal(res.code, 200); assert.equal(saves, 1);
  assert.equal(state.project.state, 'pending_moderation');
  assert.equal(state.queued.length, 1); assert.equal(state.queued[0].to, 'hello@thesupremecollective.co.uk');
  assert.match(state.queued[0].text, /originals\/moderation#project-/);
  assert.equal(state.events[0].type, 'project_submitted_for_moderation');
});

test('invalid or unauthorized submissions do not queue alerts', async t => {
  const state = setup(t); state.project.state = 'draft'; state.project.originalWorkConfirmed = false;
  let res = response(); await submitOriginalProjectForModeration({ user, params: { id } }, res);
  assert.equal(res.code, 400);
  res = response(); await submitOriginalProjectForModeration({ user: { id: 'another-owner' }, params: { id } }, res);
  assert.equal(res.code, 403); assert.equal(state.queued.length, 0);
});

test('the decision queue includes only pending submissions, not projects awaiting owner changes', async t => {
  let query;
  t.mock.method(Project, 'find', filter => { query = filter; return { sort: () => ({ lean: async () => [] }) }; });
  const res = response(); await listOriginalsModeration({ user }, res);
  assert.deepEqual(query, { state: 'pending_moderation', 'moderation.status': 'pending' });
  assert.equal(res.code, 200);
});

test('approval saves the decision and queues announcements without invoking SMTP or starting the round clock', async t => {
  const state = setup(t); const res = response();
  await decideOriginalProjectModeration({ user, params: { id }, body: { decision: 'approve' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.project.state, 'foundation_open');
  assert.equal(res.body.project.moderation.status, 'approved');
  assert.equal(state.rounds.length, 1); assert.equal(state.rounds[0].closesAt, null); assert.equal(state.rounds[0].clockStartedAt, null);
  assert.equal(state.writes[0].filter['moderation.status'], 'pending');
  assert.equal(state.queued.length, 3); assert.equal(res.body.notification.queued, 3);
  assert.equal(state.events[0].type, 'moderation_approve');
});

test('an incomplete project returns its actionable validation errors without creating a round', async t => {
  const state = setup(t); state.project.ownerAgreement.accepted = false;
  const res = response(); await decideOriginalProjectModeration({ user, params: { id }, body: { decision: 'approve' } }, res);
  assert.equal(res.code, 400); assert.match(res.body.errors.join(' '), /owner agreement/);
  assert.equal(state.writes.length, 0); assert.equal(state.rounds.length, 0); assert.equal(state.queued.length, 0);
});

test('approval can recover an already-created initial round after an interrupted request', async t => {
  const state = setup(t);
  t.mock.method(Round, 'findOneAndUpdate', async (filter, update, options) => {
    if (options.upsert) throw Object.assign(new Error('duplicate'), { code: 11000 });
    assert.deepEqual(update.$set.eligibleRoles, ['Vocal']);
    return { _id: '333333333333333333333333', sequence: 0, clockStartedAt: null };
  });
  const res = response(); await decideOriginalProjectModeration({ user, params: { id }, body: { decision: 'approve' } }, res);
  assert.equal(res.code, 200); assert.equal(String(res.body.project.currentRoundId), '333333333333333333333333');
  assert.equal(state.queued.length, 3);
});

test('concurrent or repeated decisions cannot publish or announce a second time', async t => {
  const state = setup(t); t.mock.method(Project, 'findOneAndUpdate', async () => null);
  let res = response(); await decideOriginalProjectModeration({ user, params: { id }, body: { decision: 'approve' } }, res);
  assert.equal(res.code, 409); assert.equal(state.queued.length, 0); assert.equal(state.events.length, 0);
  state.project.moderation.status = 'approved';
  res = response(); await decideOriginalProjectModeration({ user, params: { id }, body: { decision: 'approve' } }, res);
  assert.equal(res.code, 409); assert.equal(state.queued.length, 0);
});

test('requesting changes and rejecting require a reason and remove the project from pending state', async t => {
  const state = setup(t);
  let res = response(); await decideOriginalProjectModeration({ user, params: { id }, body: { decision: 'request_changes' } }, res);
  assert.equal(res.code, 400); assert.equal(state.writes.length, 0);
  res = response(); await decideOriginalProjectModeration({ user, params: { id }, body: { decision: 'request_changes', reason: 'Please provide an original guide' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.project.state, 'changes_requested'); assert.equal(state.queued.length, 0);
  state.project.moderation.status = 'pending'; state.project.state = 'pending_moderation';
  res = response(); await decideOriginalProjectModeration({ user, params: { id }, body: { decision: 'reject', reason: 'Not original work' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.project.state, 'cancelled'); assert.equal(state.rounds.length, 0);
});

test('moderation endpoints deny ordinary musicians', async t => {
  const state = setup(t); const res = response();
  await decideOriginalProjectModeration({ user: { id: owner, role: 'musician' }, params: { id }, body: { decision: 'approve' } }, res);
  assert.equal(res.code, 403); assert.equal(state.writes.length, 0);
});


test('an audit-write failure after the decision is saved does not report a failed approval', async t => {
  setup(t); t.mock.method(console, 'error', () => {});
  t.mock.method(Event, 'create', async () => { throw new Error('Temporary event write failure'); });
  const res = response(); await decideOriginalProjectModeration({ user, params: { id }, body: { decision: 'approve' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.project.moderation.status, 'approved');
  assert.equal(res.body.notification.queued, 3);
});

test('a queue outage cannot undo approval and leaves a durable launch retry marker', async t => {
  setup(t); t.mock.method(console, 'error', () => {});
  t.mock.method(Email, 'updateOne', async () => { throw new Error('Email queue unavailable'); });
  const res = response(); await decideOriginalProjectModeration({ user, params: { id }, body: { decision: 'approve' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.project.moderation.status, 'approved');
  assert.equal(res.body.project.moderation.launchEmailPending, true); assert.equal(res.body.notification.failed, 1);
});

test('a project with an initial stem opens its first explicitly preferred instrument', async t => {
  const state = setup(t);
  state.project.sourceType = 'final_eligible_stem'; state.project.hasInitialStem = true;
  state.project.initialAssetIds = ['444444444444444444444444'];
  state.project.requestedRoles = [{ name: 'Vocal', order: 0, recordingOrder: 2 }, { name: 'Drums', order: 1, recordingOrder: 1 }];
  const res = response(); await decideOriginalProjectModeration({ user, params: { id }, body: { decision: 'approve' } }, res);
  assert.equal(res.code, 200); assert.equal(state.rounds[0].roleName, 'Drums'); assert.equal(state.rounds[0].closesAt, null);
});

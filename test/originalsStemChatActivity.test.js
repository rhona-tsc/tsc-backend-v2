import test from 'node:test';
import assert from 'node:assert/strict';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';
import { originalStemChatActivity, originalStemActivityKey, originalStemActivityBody } from '../services/originalsStemChatActivityService.js';
import { originalSubmissionCommit } from '../services/originalsSubmissionCommitService.js';
import { submitOriginalTakes, decideOriginalSubmission, postOriginalMessage } from '../controllers/originalsWorkflowController.js';
import { originalChatUnreadQuery } from '../services/originalsChatReadService.js';
import Message from '../models/originalMessageModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Musician from '../models/musicianModel.js';
import Notification from '../models/originalNotificationModel.js';

const projectId = '111111111111111111111111', owner = '222222222222222222222222', musicianId = '333333333333333333333333';
const roundId = '444444444444444444444444', reservationId = '555555555555555555555555', stem = '666666666666666666666666', submissionId = '777777777777777777777777', takeId = '888888888888888888888888';
const project = { _id: projectId, ownerId: owner, ownerName: 'Rhona Downie', state: 'foundation_open', currentRoundId: roundId, requestedRoles: [{ name: 'Click' }] };
const at = new Date('2026-11-05T16:00:00.000Z');
const submission = { _id: submissionId, projectId, roundId, reservationId, musicianId, roleName: 'Click', category: 'contribution', state: 'submitted', submittedAt: at, submittedChatPending: true, takes: [{ _id: takeId, stemAssetId: stem }], notes: 'Private owner review notes' };
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
function setup(t, submissions = [submission]) {
  return originalsTransactionStore(t, {
    projects: [project], musicians: [{ _id: musicianId, firstName: 'Britney', lastName: 'Spears', email: 'private@example.test' }], submissions,
    rounds: [{ _id: roundId, projectId, type: 'foundation', state: 'open', sequence: 0 }],
    reservations: [{ _id: reservationId, projectId, roundId, musicianId, roleName: 'Click', state: 'active', expiresAt: new Date('2030-01-01') }],
    assets: [{ _id: stem, projectId, ownerId: musicianId, reservationId, kind: 'take_stem', state: 'active', originalName: 'Private filename.mp3' }],
  });
}

test('a successful foundation submit posts one public-credit chat update, without sharing files or review notes', async t => {
  const state = setup(t, []), res = response();
  await submitOriginalTakes({ params: { reservationId }, user: { id: musicianId }, body: { songwritingChoice: 'master_only', takes: [{ stemAssetId: stem }] } }, res);
  assert.equal(res.code, 201);
  assert.equal(state.data.messages.length, 1);
  const message = state.data.messages[0];
  assert.equal(message.messageType, 'stem_submitted');
  assert.equal(message.body, 'Britney S. submitted a stem for Click. Ready for owner review.');
  assert.equal(message.chatNotificationsQueued, false);
  assert.deepEqual(message.attachmentIds, []);
  assert.equal(message.voiceAssetId, null);
  assert.doesNotMatch(JSON.stringify(message), /Spears|private@example|Private filename|Private owner review/);
  assert.equal(state.data.submissions[0].submittedChatPending, false);
});

test('approval posts a distinct update after the decision, and a repeated approval cannot post twice', async t => {
  const state = setup(t);
  await originalStemChatActivity.publish(state.data.submissions[0]);
  const req = { params: { submissionId }, user: { id: owner }, body: { decision: 'accept', selectionMode: 'whole_take', selectedTakeId: takeId } };
  let res = response(); await decideOriginalSubmission(req, res);
  assert.equal(res.code, 200); assert.equal(state.data.submissions[0].state, 'accepted');
  assert.deepEqual(state.data.messages.map(message => message.messageType), ['stem_submitted', 'stem_approved']);
  assert.equal(state.data.messages[1].body, 'Click stem approved — Britney S.’s contribution has been selected.');
  assert.equal(state.data.messages[1].authorId, owner);
  assert.equal(state.data.submissions[0].approvedChatPending, false);
  res = response(); await decideOriginalSubmission(req, res);
  assert.equal(res.code, 404); assert.equal(state.data.messages.length, 2);
});

test('failed validation and rejection do not announce a new stem or an approval', async t => {
  const state = setup(t); state.data.submissions[0].submittedChatPending = false;
  const invalid = response();
  await submitOriginalTakes({ params: { reservationId }, user: { id: musicianId }, body: { songwritingChoice: 'master_only', takes: [] } }, invalid);
  assert.equal(invalid.code, 400); assert.equal(state.data.messages.length, 0);
  const rejected = response();
  await decideOriginalSubmission({ params: { submissionId }, user: { id: owner }, body: { decision: 'reject', note: 'Please try a different rhythm' } }, rejected);
  assert.equal(rejected.code, 200); assert.equal(state.data.messages.length, 0);
});

test('failed chat writes cannot undo the submission; a later recovery posts it once', async t => {
  const state = setup(t, []), res = response();
  const update = Message.updateOne;
  t.mock.method(Message, 'updateOne', async () => { throw new Error('Chat temporarily unavailable'); });
  t.mock.method(console, 'error', () => {});
  await submitOriginalTakes({ params: { reservationId }, user: { id: musicianId }, body: { songwritingChoice: 'master_only', takes: [{ stemAssetId: stem }] } }, res);
  assert.equal(res.code, 201); assert.equal(state.data.submissions[0].submittedChatPending, true); assert.equal(state.data.messages.length, 0);
  t.mock.method(Message, 'updateOne', update);
  await originalStemChatActivity.reconcile(); await originalStemChatActivity.reconcile();
  assert.equal(state.data.messages.length, 1); assert.equal(state.data.submissions[0].submittedChatPending, false);
  assert.ok(new Date(state.data.messages[0].createdAt) > at, 'A recovered entry uses posting time so it is not hidden behind an existing read cursor');
});

test('retry after posting but before acknowledgement and parallel publishers reuse the same activity key', async t => {
  const state = setup(t), pending = structuredClone(state.data.submissions[0]);
  const update = Submission.updateOne;
  t.mock.method(Submission, 'updateOne', async () => { throw new Error('Acknowledgement failed'); });
  await assert.rejects(originalStemChatActivity.publish(pending), /Acknowledgement failed/);
  assert.equal(state.data.messages.length, 1); assert.equal(state.data.submissions[0].submittedChatPending, true);
  t.mock.method(Submission, 'updateOne', update);
  await Promise.all([originalStemChatActivity.publish(pending), originalStemChatActivity.publish(pending)]);
  assert.equal(state.data.messages.length, 1); assert.equal(state.data.submissions[0].submittedChatPending, false);
  assert.equal(state.data.messages[0].clientMessageId, originalStemActivityKey(submissionId, 'stem_submitted'));
  assert.notEqual(originalStemActivityKey(submissionId, 'stem_submitted'), originalStemActivityKey(submissionId, 'stem_approved'));
});

test('a saved approval survives a failed chat write and recovery posts the approval once', async t => {
  const state = setup(t); state.data.submissions[0].submittedChatPending = false;
  const update = Message.updateOne;
  t.mock.method(Message, 'updateOne', async () => { throw new Error('Chat offline'); });
  t.mock.method(console, 'error', () => {});
  const res = response();
  await decideOriginalSubmission({ params: { submissionId }, user: { id: owner }, body: { decision: 'accept', selectionMode: 'whole_take', selectedTakeId: takeId } }, res);
  assert.equal(res.code, 200); assert.equal(state.data.submissions[0].state, 'accepted');
  assert.equal(state.data.submissions[0].approvedChatPending, true); assert.equal(state.data.messages.length, 0);
  t.mock.method(Message, 'updateOne', update);
  await originalStemChatActivity.reconcile(); await originalStemChatActivity.reconcile();
  assert.equal(state.data.messages.length, 1); assert.equal(state.data.messages[0].messageType, 'stem_approved');
  assert.equal(state.data.submissions[0].approvedChatPending, false);
});

test('anonymous contributors and owners use only their chosen credit, without a profile lookup', async t => {
  const state = setup(t); const lookup = t.mock.method(Musician, 'findById', () => assert.fail('Anonymous profile must not be queried'));
  state.data.submissions[0].anonymous = true; state.data.submissions[0].creditName = 'Midnight Drummer';
  await originalStemChatActivity.publish(state.data.submissions[0]);
  assert.match(state.data.messages[0].body, /^Midnight Drummer submitted/); assert.equal(lookup.mock.callCount(), 0);
  assert.match(originalStemActivityBody({ submission: { ...submission, musicianId: owner, creditName: 'Unused credit' }, project: { ...project, ownerAnonymous: true, ownerCreditName: 'Anonymous artist' }, profile: { firstName: 'Private' }, type: 'stem_approved' }), /Anonymous artist’s/);
  assert.match(originalStemActivityBody({ submission, project, profile: null, type: 'stem_submitted' }), /^Project participant submitted/);
});

test('multiple stems produce one group update; production outputs and legacy submissions do not create activity', async t => {
  const state = setup(t);
  state.data.submissions[0].takes.push({ stemAssetId: 'another' });
  await originalStemChatActivity.publish(state.data.submissions[0]);
  assert.match(state.data.messages[0].body, /submitted 2 stems/);
  await originalStemChatActivity.publish({ ...submission, _id: 'legacy', submittedChatPending: false });
  await originalStemChatActivity.publish({ ...submission, _id: 'production', category: 'mix' });
  assert.equal(state.data.messages.length, 1);
});

test('the activity marker is committed with a submission and an aborted transaction leaves no pending activity', async t => {
  const state = setup(t, []), payload = { projectId, roundId, reservationId, musicianId, roleName: 'Click', category: 'contribution', takes: [{ stemAssetId: stem }] };
  const saved = await originalSubmissionCommit.run({ reservationId, musicianId, payload, now: at });
  assert.equal(saved.submittedChatPending, true); assert.equal(state.data.submissions[0].submittedChatPending, true);
  await assert.rejects(originalSubmissionCommit.run({ reservationId, musicianId, payload, now: at }), /Reopen your recording session/);
  assert.equal(state.data.submissions.length, 1);
});

test('activity uses ordinary chat unread rules and users cannot spoof a Project update message type', async t => {
  setup(t);
  assert.deepEqual(originalChatUnreadQuery({ projectId, musicianId }), { projectId, authorId: { $ne: musicianId } });
  // The controller constructs the allowed fields rather than accepting messageType.
  const create = t.mock.method(Message, 'create', async data => ({ _id: 'saved', ...data }));
  // This assertion checks the server-selected payload before any email/audit work.
  t.mock.method(Message, 'findOne', async () => null);
  t.mock.method(Message, 'updateOne', async () => ({}));
  t.mock.method(Notification, 'bulkWrite', async () => ({}));
  // Disable email delivery in this test, using the existing feature gate.
  const previous = process.env.ORIGINALS_ENABLED; process.env.ORIGINALS_ENABLED = 'false';
  try {
    const res = response(); await postOriginalMessage({ params: { id: projectId }, user: { id: musicianId }, body: { body: 'Hello', messageType: 'stem_approved' } }, res);
    assert.equal(res.code, 201); assert.equal(create.mock.callCount(), 1);
    assert.equal(create.mock.calls[0].arguments[0].messageType, undefined);
    const spoof = response();
    await postOriginalMessage({ params: { id: projectId }, user: { id: musicianId }, body: { body: 'Pretend approval', clientMessageId: originalStemActivityKey(submissionId, 'stem_approved') } }, spoof);
    assert.equal(spoof.code, 400); assert.equal(create.mock.callCount(), 1);
  } finally { if (previous === undefined) delete process.env.ORIGINALS_ENABLED; else process.env.ORIGINALS_ENABLED = previous; }
});

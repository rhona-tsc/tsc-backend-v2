import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOriginalRecordingOrder, orderedOriginalRoles, originalRecordingPlan } from '../services/originalsRecordingPlanService.js';
import { normaliseRequestedRoles } from '../services/originalsPolicyService.js';
import Project from '../models/originalProjectModel.js';

const roles = [{ name: 'Guitar', order: 0 }, { name: 'Vocal', order: 1, recordingOrder: 3 }, { name: 'Click', order: 2, recordingOrder: 1 }, { name: 'Bass', order: 3, recordingOrder: 2 }];
const snapshot = () => ({ project: { currentRoundId: 'round', requestedRoles: roles }, rounds: [{ _id: 'round', type: 'instrument', roleName: 'Click' }], submissions: [] });
test('optional numbered preferences are validated, persisted and independent from array order', () => {
  assert.deepEqual(orderedOriginalRoles(roles).map(role => role.name), ['Click', 'Bass', 'Vocal', 'Guitar']);
  const normalised = normaliseRequestedRoles(roles);
  assert.equal(normalised[2].order, 2); assert.equal(normalised[2].recordingOrder, 1);
  assert.equal(normalised[0].recordingOrder, undefined);
  assert.equal(validateOriginalRecordingOrder([{ name: 'Guitar', recordingOrder: '' }])[0].recordingOrder, null);
  for (const recordingOrder of [true, {}, [], 'bad', 0, 31, 1.5]) assert.throws(() => validateOriginalRecordingOrder([{ recordingOrder }]), { status: 400 });
  assert.throws(() => normaliseRequestedRoles([{ name: 'Bass', recordingOrder: 1 }, { name: 'Vocal', recordingOrder: '1' }]), { status: 400 });
  const schema = Project.schema.path('requestedRoles').schema.path('recordingOrder');
  assert.equal(schema.options.default, null); assert.equal(schema.options.validate(1.5), false);
});
test('approved and disputed retained roles are skipped; current instrument is never suggested again', () => {
  const value = snapshot();
  assert.deepEqual(originalRecordingPlan(value).nextRound, { type: 'instrument', roleName: 'Bass', fromPreference: true, recordingOrder: 2 });
  value.submissions.push({ category: 'contribution', state: 'accepted', roleName: 'Bass' }, { category: 'contribution', state: 'retraction_requested', roleName: 'Vocal' });
  assert.deepEqual(originalRecordingPlan(value).nextRound, { type: 'instrument', roleName: 'Guitar', fromPreference: false, recordingOrder: null });
  value.submissions.push({ category: 'contribution', state: 'accepted', roleName: 'Guitar' });
  assert.equal(originalRecordingPlan(value).nextRound.type, 'mix');
  value.rounds[0].type = 'mix'; assert.equal(originalRecordingPlan(value).nextRound.type, 'master');
});
test('legacy projects have no invented preference and sorting never mutates their roles', () => {
  const value = snapshot(); value.project.requestedRoles = [{ name: 'Guitar' }, { name: 'Bass' }];
  assert.equal(originalRecordingPlan(value).nextRound.fromPreference, false);
  assert.equal(originalRecordingPlan(value).nextRound.roleName, 'Guitar');
  orderedOriginalRoles(roles); assert.equal(roles[0].name, 'Guitar');
});
test('review deadline is seven days after latest submission in current round, including revisions', () => {
  const value = snapshot();
  value.submissions = [{ roundId: 'round', state: 'submitted', submittedAt: '2026-11-01T10:00:00Z' }, { roundId: 'round', state: 'submitted', submittedAt: '2026-11-03T12:00:00Z' }, { roundId: 'old', state: 'submitted', submittedAt: '2026-11-05T12:00:00Z' }];
  assert.equal(originalRecordingPlan(value).reviewDueAt, '2026-11-10T12:00:00.000Z');
  value.submissions[1].submittedAt = '2026-11-04T14:00:00Z'; assert.equal(originalRecordingPlan(value).reviewDueAt, '2026-11-11T14:00:00.000Z');
  value.submissions[0].state = 'accepted'; value.submissions[1].state = 'rejected'; assert.equal(originalRecordingPlan(value).reviewDueAt, null);
  value.submissions = [{ roundId: 'round', state: 'submitted', submittedAt: null }]; assert.equal(originalRecordingPlan(value).reviewDueAt, null);
});

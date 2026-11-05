import { originalSubmissionCommit } from '../services/originalsSubmissionCommitService.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { submitOriginalTakes, replaceOriginalSubmission } from '../controllers/originalsWorkflowController.js';
import { originalTakeAssetIds, originalTakeKindsValid, originalTakeNeedsListeningMix } from '../services/originalsTakeFilesService.js';
import { getOriginalAgreement } from '../services/originalsAgreementService.js';
import Round from '../models/originalRoundModel.js';
import Reservation from '../models/originalReservationModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Asset from '../models/originalAssetModel.js';
import Event from '../models/originalEventModel.js';

const projectId = '111111111111111111111111', musicianId = '222222222222222222222222', roundId = '333333333333333333333333', reservationId = '444444444444444444444444';
const stems = ['555555555555555555555551', '555555555555555555555552', '555555555555555555555553'], mix = '666666666666666666666666';
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
function setup(t, type = 'foundation', uploads = stems.map(_id => ({ _id, kind: 'take_stem' }))) {
  const state = { saved: null, reservationSaved: 0, assetQueries: [] };
  t.mock.method(Round, 'findById', () => ({ lean: async () => ({ _id: roundId, projectId, type, state: 'open', sequence: 0 }) }));
  t.mock.method(Reservation, 'findOne', async () => ({ _id: reservationId, roundId, projectId, musicianId, roleName: 'Keys', save: async () => { state.reservationSaved++; } }));
  t.mock.method(Asset, 'find', filter => { state.assetQueries.push(filter); return { lean: async () => uploads.filter(asset => filter._id.$in.includes(asset._id)) }; });
  t.mock.method(Submission, 'create', async record => { const doc = new Submission(record); await doc.validate(); state.saved = doc.toObject(); return doc; });
  t.mock.method(Event, 'create', async () => ({}));
  t.mock.method(originalSubmissionCommit, 'run', async ({ payload }) => { const saved = await Submission.create(payload); state.reservationSaved++; return saved; });
  return state;
}
async function submit(takes, extra = {}) {
  const res = response();
  await submitOriginalTakes({ user: { id: musicianId }, params: { reservationId }, body: { songwritingChoice: 'master_only', takes, ...extra } }, res);
  return res;
}
test('all recording rounds accept optional listening mixes while legacy validation remains explicit', () => {
  assert.equal(originalTakeNeedsListeningMix({ type: 'foundation' }), false);
  for (const round of [undefined, {}, { type: 'instrument' }, { type: 'mix' }, { type: 'master' }]) assert.equal(originalTakeNeedsListeningMix(round), false);
  const takes = [{ stemAssetId: stems[0] }], assets = [{ _id: stems[0], kind: 'take_stem' }];
  assert.deepEqual(originalTakeAssetIds(takes), [stems[0]]);
  assert.equal(originalTakeKindsValid(takes, assets), false);
  assert.equal(originalTakeKindsValid(takes, assets, { listeningMixRequired: false }), true);
  assert.equal(originalTakeKindsValid([{ stemAssetId: stems[0], mixdownAssetId: stems[0] }], assets, { listeningMixRequired: false }), false);
});
test('three foundation stems persist without mixdowns as three separate review options', async t => {
  const state = setup(t); const res = await submit(stems.map(stemAssetId => ({ stemAssetId })));
  assert.equal(res.code, 201); assert.equal(state.reservationSaved, 1);
  assert.equal(state.saved.ownerNotificationPending, true); assert.equal(state.saved.listeningMixRequired, false); assert.equal(state.saved.takes.length, 3);
  assert.equal(state.saved.submitterConfirmationPending, true);
  assert.ok(state.saved.takes.every(take => take.mixdownAssetId === null));
  assert.deepEqual(state.assetQueries[0]._id.$in, stems);
  assert.equal(String(state.assetQueries[0].ownerId), musicianId);
  assert.equal(String(state.assetQueries[0].reservationId), reservationId);
});
test('foundation musicians may still attach an optional mix and it is validated', async t => {
  const state = setup(t, 'foundation', [{ _id: stems[0], kind: 'take_stem' }, { _id: mix, kind: 'take_mixdown' }]);
  const res = await submit([{ stemAssetId: stems[0], mixdownAssetId: mix }]);
  assert.equal(res.code, 201); assert.equal(String(state.saved.takes[0].mixdownAssetId), mix);
});
test('later rounds accept stems without a separate listening mix using server policy', async t => {
  const state = setup(t, 'instrument');
  const res = await submit([{ stemAssetId: stems[0] }], { listeningMixRequired: false });
  assert.equal(res.code, 201); assert.equal(state.saved.listeningMixRequired, false);
  assert.equal(state.reservationSaved, 1);
});
test('unavailable, foreign, malformed and wrong-kind optional mixdowns are refused', async t => {
  const state = setup(t);
  for (const mixdownAssetId of [mix, 'invalid-id', stems[1]]) {
    const res = await submit([{ stemAssetId: stems[0], mixdownAssetId }]);
    assert.equal(res.code, 400); assert.equal(state.saved, null);
  }
});
test('a missing or foreign round cannot grant an exemption', async t => {
  setup(t); t.mock.method(Round, 'findById', () => ({ lean: async () => ({ type: 'foundation', projectId: 'other-project' }) }));
  const res = await submit([{ stemAssetId: stems[0] }]); assert.equal(res.code, 409);
});
test('schema permits missing mixdowns only for server-recorded foundation submissions', async () => {
  const base = { projectId, roundId, reservationId, musicianId, roleName: 'Keys', songwritingChoice: 'master_only', takes: [{ stemAssetId: stems[0] }] };
  await new Submission({ ...base, listeningMixRequired: false }).validate();
  await assert.rejects(new Submission(base).validate(), /mixdownAssetId/);
  await assert.rejects(new Submission({ ...base, listeningMixRequired: true }).validate(), /mixdownAssetId/);
});
test('foundation and later instrument replacements both accept a stem alone', async t => {
  const state = setup(t); let saves = 0;
  const doc = new Submission({ projectId, roundId, reservationId, musicianId, roleName: 'Keys', state: 'submitted', songwritingChoice: 'master_only', takes: [{ stemAssetId: stems[1], mixdownAssetId: mix }] });
  doc.save = async () => { await doc.validate(); saves++; };
  t.mock.method(Submission, 'findById', async () => doc);
  t.mock.method(Round, 'exists', async () => false);
  t.mock.method(Asset, 'updateMany', async () => ({}));
  doc.submittedAt = new Date('2026-01-01T00:00:00Z');
  const replacedAfter = Date.now();
  let res = response(); await replaceOriginalSubmission({ user: { id: musicianId }, params: { submissionId: String(doc._id) }, body: { takes: [{ stemAssetId: stems[0] }] } }, res);
  assert.equal(res.code, 200); assert.equal(saves, 1); assert.equal(doc.ownerNotificationPending, true); assert.equal(doc.listeningMixRequired, false); assert.equal(doc.takes[0].mixdownAssetId, null); assert.ok(doc.submittedAt.getTime() >= replacedAfter);
  assert.equal(doc.submitterConfirmationPending, true);
  t.mock.method(Round, 'findById', () => ({ lean: async () => ({ _id: roundId, projectId, type: 'instrument', state: 'open', sequence: 0 }) }));
  res = response(); await replaceOriginalSubmission({ user: { id: musicianId }, params: { submissionId: String(doc._id) }, body: { takes: [{ stemAssetId: stems[0] }] } }, res);
  assert.equal(res.code, 200); assert.equal(saves, 2); assert.equal(state.reservationSaved, 0);
});
test('new contributor terms describe browser alignment review without changing production terms', () => {
  const agreement = getOriginalAgreement();
  assert.equal(agreement.version, 'originals-contributor-v0.6');
  assert.match(agreement.sections[0].text, /separate listening mix is optional/);
  assert.match(agreement.sections[0].text, /Review each newly uploaded stem.*zero point.*before submitting/);
  assert.equal(getOriginalAgreement('mix').version, 'originals-mix-v0.3');
  assert.equal(getOriginalAgreement('master').version, 'originals-master-v0.3');
});

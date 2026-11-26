import test from 'node:test';
import assert from 'node:assert/strict';
import { originalsTransactionStore } from './helpers/originalsTransactionStore.js';
import { removeOriginalGuide } from '../controllers/originalsGuideController.js';
import { authoriseOriginalAsset } from '../services/originalsAssetAccessService.js';
import Event from '../models/originalEventModel.js';

const projectId = '111111111111111111111111', owner = '222222222222222222222222', guideId = '333333333333333333333333';
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
function setup(t) {
  return originalsTransactionStore(t, {
    projects: [{ _id: projectId, ownerId: owner, state: 'role_round_open', initialAssetIds: [guideId] }],
    assets: [{ _id: guideId, projectId, ownerId: owner, kind: 'guide_track', state: 'active', originalName: 'First guide.wav' }, { _id: 'second', projectId, kind: 'guide_track', state: 'active' }],
  });
}
test('owner removes only the chosen guide and playback access is revoked', async t => {
  const store = setup(t), res = response();
  await removeOriginalGuide({ params: { assetId: guideId }, user: { id: owner } }, res);
  assert.equal(res.code, 200);
  assert.equal(store.data.assets[0].state, 'hidden');
  assert.equal(store.data.assets[1].state, 'active');
  assert.equal(store.data.events[0].type, 'project_guide_removed');
  await assert.rejects(authoriseOriginalAsset({ params: { assetId: guideId }, user: { id: owner } }), error => error.status === 404);
});
test('ordinary participants cannot remove guides, but administrators can', async t => {
  const store = setup(t);
  let res = response();
  await removeOriginalGuide({ params: { assetId: guideId }, user: { id: 'other' } }, res);
  assert.equal(res.code, 403); assert.equal(store.data.assets[0].state, 'active');
  res = response();
  await removeOriginalGuide({ params: { assetId: guideId }, user: { id: owner, role: 'admin' } }, res);
  assert.equal(res.code, 200);
});
test('production stems and contributor recordings cannot be removed through guide controls', async t => {
  const store = setup(t);
  for (const fields of [{ kind: 'initial_stem' }, { kind: 'take_stem' }, { kind: 'guide_track', reservationId: 'recording' }]) {
    Object.assign(store.data.assets[0], fields);
    const res = response();
    await removeOriginalGuide({ params: { assetId: guideId }, user: { id: owner } }, res);
    assert.equal(res.code, 409); assert.equal(store.data.assets[0].state, 'active');
  }
});
test('audit failure rolls back guide removal', async t => {
  const store = setup(t); t.mock.method(Event, 'create', async () => { throw Error('Audit unavailable'); });
  const res = response();
  await removeOriginalGuide({ params: { assetId: guideId }, user: { id: owner } }, res);
  assert.equal(res.code, 500); assert.equal(store.data.assets[0].state, 'active');
});
test('temporary starting stems can also be removed without touching approved stems', async t => {
  const store = setup(t); store.data.assets[0].kind = 'temporary_stem';
  const res = response();
  await removeOriginalGuide({ params: { assetId: guideId }, user: { id: owner } }, res);
  assert.equal(res.code, 200); assert.equal(store.data.assets[0].state, 'hidden');
});

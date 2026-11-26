import test from 'node:test';
import assert from 'node:assert/strict';
import { findMusicianByIdOrSlug, resolveMergedMusician } from '../services/musicianIdentityService.js';
import Musician from '../models/musicianModel.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const oldId = '111111111111111111111111';
const newId = '222222222222222222222222';
const primary = { _id: newId, musicianSlug: 'player-d', profilePhoto: 'clean.jpg' };
const old = { _id: oldId, musicianSlug: 'player-d-legacy', profileDeletedAt: new Date(), mergedIntoMusicianId: newId };
function modelFor(rows) {
  return {
    findById: id => ({ lean: async () => rows.find(row => row._id === String(id)) || null }),
    findOne: query => ({ lean: async () => rows.find(row => query.musicianSlug
      ? row.musicianSlug === query.musicianSlug
      : query.mergedProfileIds ? row.mergedProfileIds?.includes(query.mergedProfileIds)
      : row.mergedProfileSlugs?.includes(query.mergedProfileSlugs)) || null }),
  };
}
test('old ID, old slug and canonical URL resolve to the same active profile', async () => {
  const model = modelFor([old, primary]);
  for (const key of [oldId, old.musicianSlug, newId, primary.musicianSlug]) {
    assert.equal(await findMusicianByIdOrSlug(key, model), primary);
  }
});
test('previously removed aliases can resolve without publishing archived private data', async () => {
  const active = { ...primary, mergedProfileSlugs: ['older-alias'] };
  assert.equal(await findMusicianByIdOrSlug('OLDER-ALIAS', modelFor([active])), active);
  assert.equal(await findMusicianByIdOrSlug('', modelFor([active])), null);
});
test('ordinary deletion, a missing target and cycles fail closed', async () => {
  const deleted = { ...primary, profileDeletedAt: new Date() };
  assert.equal(await resolveMergedMusician(deleted, modelFor([deleted])), null);
  assert.equal(await resolveMergedMusician(old, modelFor([])), null);
  const cycle = { ...primary, mergedIntoMusicianId: oldId };
  assert.equal(await resolveMergedMusician(old, modelFor([old, cycle])), null);
});

test('public aliases return only canonical public data, including retained gallery photos', async t => {
  process.env.STRIPE_SECRET_KEY ||= 'sk_test_profile_merge';
  const target = { ...primary, email: 'private@example.test', password: 'secret', mergedProfileContacts: [{ phone: 'private' }], digitalWardrobeBlackTie: ['stage.jpg'] };
  const model = modelFor([old, target]);
  t.mock.method(Musician, 'findById', model.findById);
  t.mock.method(Musician, 'findOne', model.findOne);
  const { default: router } = await import('../routes/musicianRoute.js');
  for (const path of ['/profile/:idOrSlug', '/get/:idOrSlug', '/:idOrSlug']) {
    const handler = router.stack.find(layer => layer.route?.path === path && layer.route.methods.get).route.stack.at(-1).handle;
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ params: { idOrSlug: old.musicianSlug } }, res);
    assert.equal(String(res.body._id), newId);
    assert.equal(res.body.canonicalPath, '/musician/player-d');
    assert.equal(res.body.shouldRedirectToSlug, true);
    assert.deepEqual(res.body.digitalWardrobeBlackTie, ['stage.jpg']);
    assert.equal(res.body.email, undefined);
    assert.equal(res.body.password, undefined);
    assert.equal(res.body.mergedProfileContacts, undefined);
  }
});

test('legacy login requires its own password, then issues canonical credentials', async t => {
  process.env.STRIPE_SECRET_KEY ||= 'sk_test_profile_merge';
  const previousSecret = process.env.JWT_SECRET;
  const previousRefresh = process.env.JWT_REFRESH_SECRET;
  process.env.JWT_SECRET = 'merge-test-only';
  process.env.JWT_REFRESH_SECRET = 'merge-refresh-test-only';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
    if (previousRefresh === undefined) delete process.env.JWT_REFRESH_SECRET; else process.env.JWT_REFRESH_SECRET = previousRefresh;
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const login = { ...old, email: 'legacy@example.test', password: await bcrypt.hash('legacy-password', 4) };
  const target = { ...primary, email: 'current@example.test', role: 'musician' };
  t.mock.method(Musician, 'findOne', async () => login);
  t.mock.method(Musician, 'findById', () => ({ lean: async () => target }));
  const { loginMusician } = await import('../controllers/musicianController.js');
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, cookie() {} });
  const wrong = response();
  await loginMusician({ body: { email: login.email, password: 'wrong' } }, wrong);
  assert.equal(wrong.code, 401);
  assert.equal(wrong.body.token, undefined);
  const correct = response();
  await loginMusician({ body: { email: login.email, password: 'legacy-password' } }, correct);
  assert.equal(correct.body.userId, newId);
  assert.equal(jwt.verify(correct.body.token, process.env.JWT_SECRET).id, newId);
  assert.equal(correct.body.email, target.email);
  assert.equal(correct.body.password, undefined);
});

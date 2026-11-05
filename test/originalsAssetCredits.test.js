import test from 'node:test';
import assert from 'node:assert/strict';
import Musician from '../models/musicianModel.js';
import { addOriginalAssetCredits } from '../services/originalsAssetCreditService.js';

const owner = '111111111111111111111111', player = '222222222222222222222222';
const project = { ownerId: owner, ownerName: 'Veronica Downie' };
const asset = (id, extra = {}) => ({ _id: id, ownerId: player, kind: 'take_stem', reservationId: 'reservation', ...extra });
const submission = extra => ({ musicianId: player, reservationId: 'reservation', category: 'contribution', state: 'accepted', takes: [{ stemAssetId: 'stem', stemAssetIds: ['stem', 'harmony'], wetStemAssetId: 'wet', mixdownAssetId: 'mix' }], ...extra });
function profiles(t, records) {
  return t.mock.method(Musician, 'find', query => ({ select(fields) {
    assert.equal(fields, 'firstName lastName basicInfo.firstName basicInfo.lastName musicianSlug privateTestProfile');
    return { lean: async () => records.filter(record => query._id.$in.includes(record._id)) };
  } }));
}

test('approved recordings show a first name and last initial with the musician profile slug', async t => {
  profiles(t, [{ _id: player, firstName: 'Ewan', lastName: 'McIntosh', musicianSlug: 'ewan-mcintosh', email: 'private@example.test', phone: 'private' }]);
  const [result] = await addOriginalAssetCredits({ project, assets: [asset('stem')], submissions: [submission({})] });
  assert.deepEqual(result.submittedBy, { displayName: 'Ewan M.', anonymous: false, profilePath: '/musician/ewan-mcintosh' });
  assert.doesNotMatch(JSON.stringify(result.submittedBy), /email|phone|private|firstName|lastName/);
});

test('anonymous accepted submissions use their artistic name without querying or linking a real profile', async t => {
  const find = profiles(t, [{ _id: player, firstName: 'Private', lastName: 'Name', musicianSlug: 'private-profile' }]);
  const result = await addOriginalAssetCredits({ project, assets: ['stem', 'harmony', 'wet', 'mix'].map(id => asset(id)), submissions: [submission({ anonymous: true, creditName: 'Midnight Keys' })] });
  assert.ok(result.every(item => item.submittedBy.displayName === 'Midnight Keys' && item.submittedBy.anonymous === true && item.submittedBy.profilePath === null));
  assert.equal(find.mock.callCount(), 0);
});

test('reservation anonymity protects uploaded files before submission and legacy submission defaults', async t => {
  const find = profiles(t, []);
  for (const submissions of [[], [submission({ anonymous: false })]]) {
    const [result] = await addOriginalAssetCredits({ project, assets: [asset('stem')], submissions, reservations: [{ _id: 'reservation', musicianId: player, anonymous: true, creditName: 'The Drummer' }] });
    assert.deepEqual(result.submittedBy, { displayName: 'The Drummer', anonymous: true, profilePath: null });
  }
  assert.equal(find.mock.callCount(), 0);
});

test('owner anonymity applies to starting stems, guides, samples and videos', async t => {
  const find = profiles(t, []);
  const result = await addOriginalAssetCredits({ project: { ...project, ownerAnonymous: true, ownerCreditName: 'Velvet' }, assets: ['initial_stem', 'guide_track', 'demo', 'video_submission', 'click_track'].map(kind => asset(kind, { kind, ownerId: owner, reservationId: null })) });
  assert.ok(result.every(item => item.submittedBy.displayName === 'Velvet' && item.submittedBy.profilePath === null));
  assert.equal(find.mock.callCount(), 0);
});

test('missing anonymous aliases remain Anonymous rather than falling back to a real name', async t => {
  const find = profiles(t, []);
  const [result] = await addOriginalAssetCredits({ project, assets: [asset('stem')], submissions: [submission({ anonymous: true, creditName: '' })] });
  assert.deepEqual(result.submittedBy, { displayName: 'Anonymous', anonymous: true, profilePath: null });
  assert.equal(find.mock.callCount(), 0);
});

test('legacy profile names, multiword first names and ID-based public profiles work', async t => {
  profiles(t, [{ _id: player, basicInfo: { firstName: 'Mary Jane', lastName: 'Smith' } }]);
  const [result] = await addOriginalAssetCredits({ project, assets: [asset('stem')] });
  assert.deepEqual(result.submittedBy, { displayName: 'Mary Jane S.', anonymous: false, profilePath: `/musician/${player}` });
});

test('deleted or missing profiles get a safe display name with no broken profile link', async t => {
  profiles(t, []);
  const result = await addOriginalAssetCredits({ project, assets: [asset('stem'), asset('guide', { ownerId: owner, kind: 'guide_track' })] });
  assert.equal(result[0].submittedBy.displayName, 'Project participant');
  assert.equal(result[1].submittedBy.displayName, 'Veronica D.');
  assert.ok(result.every(item => item.submittedBy.profilePath === null));
});

test('production output credits respect submission anonymity and only public IDs are looked up', async t => {
  const find = profiles(t, [{ _id: owner, firstName: 'Veronica', lastName: 'Downie', musicianSlug: 'veronica' }]);
  const result = await addOriginalAssetCredits({ project, assets: [asset('master', { kind: 'master' }), asset('guide', { ownerId: owner, kind: 'guide_track' })], submissions: [submission({ category: 'master', outputAssetId: 'master', takes: [], anonymous: true, creditName: 'Studio X' })] });
  assert.deepEqual(find.mock.calls[0].arguments[0]._id.$in, [owner]);
  assert.equal(result[0].submittedBy.displayName, 'Studio X'); assert.equal(result[0].submittedBy.profilePath, null);
  assert.equal(result[1].submittedBy.displayName, 'Veronica D.'); assert.equal(result[1].submittedBy.profilePath, '/musician/veronica');
});

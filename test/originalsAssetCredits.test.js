import test from 'node:test';
import assert from 'node:assert/strict';
import Musician from '../models/musicianModel.js';
import { addOriginalAssetCredits, addOriginalRoleCredits } from '../services/originalsAssetCreditService.js';

const owner = '111111111111111111111111', player = '222222222222222222222222';
const project = { ownerId: owner, ownerName: 'Veronica Downie' };
const asset = (id, extra = {}) => ({ _id: id, ownerId: player, kind: 'take_stem', reservationId: 'reservation', ...extra });
const submission = extra => ({ musicianId: player, reservationId: 'reservation', category: 'contribution', state: 'accepted', takes: [{ stemAssetId: 'stem', stemAssetIds: ['stem', 'harmony'], wetStemAssetId: 'wet', mixdownAssetId: 'mix' }], ...extra });
function profiles(t, records) {
  return t.mock.method(Musician, 'find', query => ({ select(fields) {
    assert.equal(fields, 'firstName lastName basicInfo.firstName basicInfo.lastName musicianSlug privateTestProfile profilePhoto');
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


test('approved credits expose only public HTTP profile photos', async t => {
  const record = { _id: player, firstName: 'Ewan', lastName: 'McIntosh', musicianSlug: 'ewan', profilePhoto: 'https://photos.example.test/ewan.jpg' };
  profiles(t, [record]);
  const getCredit = async () => (await addOriginalAssetCredits({ project, assets: [asset('stem')] }))[0].submittedBy;
  assert.equal((await getCredit()).profilePhoto, record.profilePhoto);
  record.privateTestProfile = true;
  assert.deepEqual(await getCredit(), { displayName: 'Ewan M.', anonymous: false, profilePath: null });
  record.privateTestProfile = false;
  record.profilePhoto = 'javascript:private';
  assert.equal((await getCredit()).profilePhoto, undefined);
});

test('completed roles show approved contributors once each, including when source files are absent', async t => {
  const find = profiles(t, [
    { _id: player, firstName: 'Ewan', lastName: 'McIntosh', musicianSlug: 'ewan', profilePhoto: 'https://photos.example.test/ewan.jpg' },
    { _id: owner, firstName: 'Veronica', lastName: 'Downie', musicianSlug: 'veronica' },
  ]);
  const pending = { name: 'Drums', timingState: 'reserved' };
  const roles = await addOriginalRoleCredits({ project, roles: [{ name: 'Bass', timingState: 'complete' }, pending], submissions: [
    submission({ roleName: 'bass', takes: [] }),
    submission({ roleName: 'Bass' }),
    submission({ roleName: 'BASS', musicianId: owner }),
    submission({ roleName: 'Drums', state: 'submitted' }),
    submission({ roleName: 'Bass', state: 'rejected', musicianId: 'private-rejected-musician' }),
  ] });
  assert.equal(roles[0].approvedContributors.length, 2);
  assert.deepEqual(roles[0].approvedContributors[0], { displayName: 'Ewan M.', anonymous: false, profilePath: '/musician/ewan', profilePhoto: 'https://photos.example.test/ewan.jpg' });
  assert.equal(roles[0].approvedContributors[1].displayName, 'Veronica D.');
  assert.strictEqual(roles[1], pending);
  assert.deepEqual(find.mock.calls[0].arguments[0]._id.$in, [player, owner]);
  assert.doesNotMatch(JSON.stringify(roles), /McIntosh|musicianId|ownerId|private-rejected/);
});

test('anonymous approved roles use aliases without any real profile lookup, even without files or reservations', async t => {
  const find = profiles(t, [{ _id: player, firstName: 'Private', lastName: 'Name', profilePhoto: 'https://photos.example.test/private.jpg' }]);
  const [role] = await addOriginalRoleCredits({ project, roles: [{ name: 'Bass', timingState: 'complete' }], submissions: [submission({ roleName: 'Bass', takes: [], reservationId: null, anonymous: true, creditName: 'Midnight Keys' })] });
  assert.deepEqual(role.approvedContributors, [{ displayName: 'Midnight Keys', anonymous: true, profilePath: null }]);
  assert.equal(find.mock.callCount(), 0);
});

test('approved role credits respect anonymous reservations and owner credit settings', async t => {
  const find = profiles(t, []);
  const roles = await addOriginalRoleCredits({
    project: { ...project, ownerAnonymous: true, ownerCreditName: 'Velvet' },
    roles: [{ name: 'Bass', timingState: 'complete' }, { name: 'Click', timingState: 'complete' }],
    submissions: [submission({ roleName: 'Bass' }), submission({ roleName: 'Click', musicianId: owner, reservationId: null })],
    reservations: [{ _id: 'reservation', anonymous: true, creditName: 'The Drummer' }],
  });
  assert.deepEqual(roles.map(role => role.approvedContributors), [
    [{ displayName: 'The Drummer', anonymous: true, profilePath: null }],
    [{ displayName: 'Velvet', anonymous: true, profilePath: null }],
  ]);
  assert.equal(find.mock.callCount(), 0);
});

test('pending roles do not look up or disclose contributor identities', async t => {
  const find = profiles(t, []);
  const roles = [{ name: 'Bass', timingState: 'submitted' }, { name: 'Drums', timingState: 'future_round' }];
  assert.deepEqual(await addOriginalRoleCredits({ project, roles, submissions: [submission({ roleName: 'Bass', state: 'submitted' }), submission({ roleName: 'Other role' })] }), roles);
  assert.equal(find.mock.callCount(), 0);
});


test('workspace API includes public approved role credits while keeping anonymous profile details absent', async t => {
  const { originalsTransactionStore } = await import('./helpers/originalsTransactionStore.js');
  const { getOriginalProjectWorkspace } = await import('../controllers/originalsWorkflowController.js');
  const projectId = '333333333333333333333333';
  originalsTransactionStore(t, {
    projects: [{ ...project, _id: projectId, title: 'A song', state: 'role_round_open', requestedRoles: [{ name: 'Bass' }, { name: 'Keys' }, { name: 'Drums' }] }],
    submissions: [
      submission({ _id: 'bass', projectId, roleName: 'Bass', musicianId: owner, reservationId: null, takes: [] }),
      submission({ _id: 'keys', projectId, roleName: 'Keys', anonymous: true, creditName: 'Midnight Keys', takes: [] }),
      submission({ _id: 'drums', projectId, roleName: 'Drums', state: 'submitted', takes: [] }),
    ],
    musicians: [
      { _id: owner, firstName: 'Ewan', lastName: 'McIntosh', musicianSlug: 'ewan', profilePhoto: 'https://photos.example.test/ewan.jpg' },
      { _id: player, firstName: 'Private', lastName: 'Name', musicianSlug: 'private', profilePhoto: 'https://photos.example.test/private.jpg' },
    ],
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await getOriginalProjectWorkspace({ params: { id: projectId }, user: { id: owner } }, res);
  assert.equal(res.code, 200);
  const roles = res.body.roleProgress;
  assert.deepEqual(roles.find(role => role.name === 'Bass').approvedContributors, [{ displayName: 'Ewan M.', anonymous: false, profilePath: '/musician/ewan', profilePhoto: 'https://photos.example.test/ewan.jpg' }]);
  assert.deepEqual(roles.find(role => role.name === 'Keys').approvedContributors, [{ displayName: 'Midnight Keys', anonymous: true, profilePath: null }]);
  assert.equal(roles.find(role => role.name === 'Drums').approvedContributors, undefined);
  assert.doesNotMatch(JSON.stringify(roles), /McIntosh|Private Name|musicianId|private\.jpg/);
});

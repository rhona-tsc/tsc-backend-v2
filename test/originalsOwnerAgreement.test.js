import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getOriginalAgreement, getOriginalOwnerAgreement, originalOwnerAgreementAcceptance, hasCurrentOriginalOwnerAgreement, hasRecordedOriginalOwnerAgreement } from '../services/originalsAgreementService.js';
import { createOriginalProject, updateOriginalProject, getOriginalOwnerAgreementTerms } from '../controllers/originalsController.js';
import { presentOriginalWorkspace } from '../services/originalsAccessService.js';
import Project from '../models/originalProjectModel.js';
import Musician from '../models/musicianModel.js';
import Event from '../models/originalEventModel.js';

const owner = '111111111111111111111111', other = '222222222222222222222222', projectId = '333333333333333333333333';
const body = () => ({ title: 'An original song', description: 'A new project', genres: ['Soul'], requestedRoles: [{ name: 'Vocal', foundationEligible: true }], originalWorkConfirmed: true,
  ownerAgreementAccepted: true, ownerAgreementDisplayName: 'Example Owner', ownerAgreement: getOriginalOwnerAgreement() });
const response = () => ({ code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const profile = t => t.mock.method(Musician, 'findById', () => ({ select: () => ({ lean: async () => ({ firstName: 'Example', lastName: 'Owner', email: 'private@example.test' }) }) }));

test('full owner document reuses the fleshed-out financial, permission and contributor protections', () => {
  const contributor = getOriginalAgreement(), before = JSON.stringify(contributor), agreement = getOriginalOwnerAgreement();
  for (const title of ['Permission to work on the project', 'Confidentiality and restricted use', 'Master income and deductions', 'Royalty collection and accounts', 'Songwriting claims and proposed splits', 'Final confirmation and performer royalties']) {
    assert.deepEqual(agreement.sections.find(section => section.title === title), contributor.sections.find(section => section.title === title));
  }
  assert.match(agreement.text, /The Supreme Collective Ltd, company number 16883956/);
  assert.match(agreement.text, /within seven days after you are notified/);
  assert.match(agreement.text, /must not deduct or recoup/);
  assert.doesNotMatch(agreement.text, /provisional|pilot|after any contractually permitted direct costs/i);
  assert.equal(JSON.stringify(getOriginalAgreement()), before);
});
test('owner hash covers precisely all displayed section text and the checkbox acknowledgement', () => {
  const agreement = getOriginalOwnerAgreement();
  const text = [...agreement.sections.flatMap(section => [section.title, section.text]), agreement.acknowledgement].join('\n\n');
  assert.equal(agreement.text, text);
  assert.equal(agreement.textHash, createHash('sha256').update(text).digest('hex'));
});
test('acceptance stores server text and the actual version, name and timestamp instead of client-supplied wording', () => {
  const input = body(); input.ownerAgreement.text = 'Not the real terms'; input.ownerAgreementDisplayName = '  Example   Owner  ';
  const now = new Date('2026-11-05T14:00:00Z'), saved = originalOwnerAgreementAcceptance(input, now);
  assert.equal(saved.text, getOriginalOwnerAgreement().text);
  assert.equal(saved.displayName, 'Example Owner');
  assert.equal(saved.acceptedAt, now);
  assert.equal(hasCurrentOriginalOwnerAgreement(saved), true);
});
test('an unchecked box, missing signature or mismatched document cannot acknowledge the current owner terms', () => {
  assert.equal(hasCurrentOriginalOwnerAgreement(originalOwnerAgreementAcceptance({})), false);
  assert.equal(hasCurrentOriginalOwnerAgreement(null), false);
  for (const key of ['version', 'textHash', 'acknowledgement']) {
    const input = body(); input.ownerAgreement[key] = 'outdated';
    assert.throws(() => originalOwnerAgreementAcceptance(input), error => error.status === 409 && error.code === 'ORIGINALS_AGREEMENT_REQUIRED');
  }
  for (const name of ['', '  ', 'Bad\nName', 'x'.repeat(161)]) {
    assert.throws(() => originalOwnerAgreementAcceptance({ ...body(), ownerAgreementDisplayName: name }), error => error.status === 400);
  }
  const saved = originalOwnerAgreementAcceptance(body());
  for (const patch of [{ text: 'different' }, { acceptedAt: 'invalid' }, { displayName: '' }]) assert.equal(hasCurrentOriginalOwnerAgreement({ ...saved, ...patch }), false);
});
test('project schema retains the exact new acceptance and earlier acceptance records', () => {
  const acceptance = originalOwnerAgreementAcceptance(body());
  const doc = Project.hydrate({ _id: projectId, ownerId: owner, ownerAgreement: acceptance, ownerAgreementHistory: [{ version: 'legacy', accepted: true, displayName: 'Earlier Name' }] });
  assert.equal(doc.ownerAgreement.text, acceptance.text);
  assert.equal(doc.ownerAgreement.textHash, acceptance.textHash);
  assert.equal(doc.ownerAgreement.acknowledgement, acceptance.acknowledgement);
  assert.equal(doc.ownerAgreementHistory[0].version, 'legacy');
  assert.equal(doc.ownerAgreementHistory[0].displayName, 'Earlier Name');
});
test('owner agreement endpoint serves the current source with no cache', () => {
  const res = response(); getOriginalOwnerAgreementTerms({}, res);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.body.agreement, getOriginalOwnerAgreement());
});
test('creating a project records the agreement shown against the signed-in owner', async t => {
  profile(t); let saved;
  t.mock.method(Project, 'create', async record => { saved = record; return { _id: projectId, ...record }; });
  t.mock.method(Event, 'create', async () => ({}));
  const res = response(); await createOriginalProject({ user: { id: owner }, body: body() }, res);
  assert.equal(res.code, 201);
  assert.equal(String(saved.ownerId), owner);
  assert.equal(saved.ownerAgreement.textHash, getOriginalOwnerAgreement().textHash);
  assert.equal(saved.ownerAgreement.displayName, 'Example Owner');
  assert.equal(saved.ownerAgreement.receiptPending, true);
  assert.equal(saved.ownerAgreement.projectTitle, 'An original song');
});
test('stale owner terms cannot create a project or write an acceptance', async t => {
  profile(t); let writes = 0;
  t.mock.method(Project, 'create', async () => { writes++; });
  t.mock.method(Event, 'create', async () => { writes++; });
  const input = body(); input.ownerAgreement.textHash = 'old';
  const res = response(); await createOriginalProject({ user: { id: owner }, body: input }, res);
  assert.equal(res.code, 409); assert.equal(writes, 0);
});
test('fresh owner acceptance preserves the earlier signed version and does not rewrite unrelated project edits', async t => {
  const earlier = { version: 'originals-owner-v0.1-legal-review', accepted: true, acceptedAt: new Date('2026-11-01'), displayName: 'Earlier Name' };
  let saves = 0;
  const project = { _id: projectId, ownerId: owner, state: 'draft', title: 'Existing title', ownerAgreement: earlier, ownerAgreementHistory: [{ version: 'even-earlier', accepted: true }], save: async () => { saves++; } };
  t.mock.method(Project, 'findById', async () => project); t.mock.method(Event, 'create', async () => ({}));
  const { title, description, genres, requestedRoles, ...input } = body();
  const res = response(); await updateOriginalProject({ params: { id: projectId }, user: { id: owner }, body: input }, res);
  assert.equal(res.code, 200); assert.equal(saves, 1);
  assert.equal(project.title, 'Existing title');
  assert.equal(project.ownerAgreementHistory.length, 2);
  assert.deepEqual(project.ownerAgreementHistory[1], earlier);
  assert.equal(project.ownerAgreement.text, getOriginalOwnerAgreement().text);
});
test('ordinary edits and failed acknowledgement attempts leave existing acceptance records unchanged', async t => {
  const earlier = { version: 'legacy', accepted: true, displayName: 'Earlier Name' }; let saves = 0;
  const project = { _id: projectId, ownerId: owner, state: 'draft', ownerAgreement: earlier, save: async () => { saves++; } };
  t.mock.method(Project, 'findById', async () => project); t.mock.method(Event, 'create', async () => ({}));
  const ordinary = response(); await updateOriginalProject({ params: { id: projectId }, user: { id: owner }, body: { title: 'New title' } }, ordinary);
  assert.equal(project.ownerAgreement, earlier); assert.equal(project.ownerAgreementHistory, undefined);
  const input = body(); input.ownerAgreement.version = 'stale';
  const stale = response(); await updateOriginalProject({ params: { id: projectId }, user: { id: owner }, body: input }, stale);
  assert.equal(stale.code, 409); assert.equal(saves, 1); assert.equal(project.ownerAgreement, earlier);
});
test('staff managing another project cannot sign the owner acknowledgement for its owner', async t => {
  let saves = 0;
  const project = { _id: projectId, ownerId: owner, state: 'draft', save: async () => { saves++; } };
  t.mock.method(Project, 'findById', async () => project);
  const res = response(); await updateOriginalProject({ params: { id: projectId }, user: { id: other, role: 'admin' }, body: body() }, res);
  assert.equal(res.code, 403); assert.equal(saves, 0);
});
test('private owner signatures and earlier acceptance records are not included in participant workspace data', () => {
  const ownerAgreement = originalOwnerAgreementAcceptance(body());
  const input = { project: { _id: projectId, ownerId: owner, ownerAnonymous: true, ownerCreditName: 'Public alias', requestedRoles: [], ownerAgreement, ownerAgreementHistory: [ownerAgreement] }, rounds: [], reservations: [], submissions: [], assets: [], notifications: [], invitations: [], creditVersions: [], issues: [], messages: [] };
  const participant = presentOriginalWorkspace(input, { id: other });
  assert.equal(participant.project.ownerAgreement, undefined); assert.equal(participant.project.ownerAgreementHistory, undefined);
  assert.ok(!JSON.stringify(participant).includes('Example Owner'));
  const manager = presentOriginalWorkspace(input, { id: owner });
  assert.equal(manager.project.ownerAgreement.displayName, 'Example Owner');
  assert.equal(input.project.ownerAgreement, ownerAgreement);
});

test('existing signed legacy owner agreements stay valid without being rewritten or attributed new wording', () => {
  const legacy = { version: 'originals-owner-v0.1-legal-review', accepted: true, acceptedAt: new Date('2026-11-01'), displayName: 'Earlier Owner' };
  const before = JSON.stringify(legacy);
  assert.equal(hasRecordedOriginalOwnerAgreement(legacy), true);
  assert.equal(hasCurrentOriginalOwnerAgreement(legacy), false);
  assert.equal(hasRecordedOriginalOwnerAgreement({ ...legacy, version: 'unknown-version' }), false);
  assert.equal(hasRecordedOriginalOwnerAgreement({ ...legacy, acceptedAt: null }), false);
  assert.equal(JSON.stringify(legacy), before);
});

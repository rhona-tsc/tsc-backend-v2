import test from 'node:test';
import assert from 'node:assert/strict';
import { v2 as cloudinary } from 'cloudinary';
import Project from '../models/originalProjectModel.js';
import Asset from '../models/originalAssetModel.js';
import Reservation from '../models/originalReservationModel.js';
import Event from '../models/originalEventModel.js';
import Round from '../models/originalRoundModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Notification from '../models/originalNotificationModel.js';
import Invitation from '../models/originalInvitationModel.js';
import Credit from '../models/originalCreditVersionModel.js';
import Issue from '../models/originalIssueModel.js';
import Message from '../models/originalMessageModel.js';
import Future from '../models/originalRoleReservationModel.js';
import Musician from '../models/musicianModel.js';
import { uploadOriginalAsset, getOriginalProjectWorkspace } from '../controllers/originalsWorkflowController.js';

const owner = '111111111111111111111111', player = '222222222222222222222222';
const projectId = '333333333333333333333333', assetId = '444444444444444444444444', reservationId = '555555555555555555555555';
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const project = () => ({ _id: projectId, ownerId: owner, requestedRoles: [], initialAssetIds: { addToSet() {} }, save: async () => {} });
const request = (kind, declaration) => ({ params: { id: projectId }, user: { id: ['take_stem', 'take_mixdown'].includes(kind) ? player : owner }, body: { kind, ...(['take_stem', 'take_mixdown'].includes(kind) ? { reservationId } : {}), ...(declaration === undefined ? {} : { createdEntirelyWithAi: declaration }) }, file: { originalname: 'Stem.wav', mimetype: 'audio/wav', size: 4, buffer: Buffer.from('stem') } });

function setupUpload(t) {
  t.mock.method(Project, 'findById', async () => project());
  t.mock.method(Reservation, 'findOne', async query => {
    assert.equal(query.musicianId, player); assert.equal(query.projectId, projectId);
    return { _id: reservationId, state: 'active', expiresAt: new Date(Date.now() + 60_000) };
  });
  const uploads = t.mock.method(cloudinary.uploader, 'upload_stream', (options, callback) => {
    assert.equal(options.type, 'authenticated'); assert.equal(options.resource_type, 'video');
    return { end(buffer) { assert.equal(buffer.toString(), 'stem'); callback(null, { public_id: 'private/stem', resource_type: 'video', format: 'wav' }); } };
  });
  const saves = t.mock.method(Asset, 'create', async value => ({ _id: assetId, ...value }));
  const events = t.mock.method(Event, 'create', async value => value);
  return { uploads, saves, events };
}

test('stem uploads persist explicit true and false declarations with the original file and audit record', async t => {
  const { saves, events } = setupUpload(t);
  for (const kind of ['initial_stem', 'take_stem', 'click_track']) {
    for (const declaration of [true, false, 'true', 'false']) {
      const expected = declaration === true || declaration === 'true';
      const res = response(); await uploadOriginalAsset(request(kind, declaration), res);
      assert.equal(res.code, 201); assert.equal(res.body.asset.createdEntirelyWithAi, expected);
      const saved = saves.mock.calls.at(-1).arguments[0];
      assert.equal(saved.createdEntirelyWithAi, expected); assert.equal(saved.kind, kind);
      assert.equal(saved.cloudinaryPublicId, 'private/stem'); assert.equal(saved.deliveryType, 'authenticated');
      assert.equal(events.mock.calls.at(-1).arguments[0].metadata.createdEntirelyWithAi, expected);
    }
  }
});

test('omitted declarations remain unknown, including older clients and documents', async t => {
  const { saves } = setupUpload(t);
  const res = response(); await uploadOriginalAsset(request('take_stem'), res);
  assert.equal(res.code, 201); assert.equal(saves.mock.calls[0].arguments[0].createdEntirelyWithAi, null);
  assert.equal(new Asset({ kind: 'take_stem' }).createdEntirelyWithAi, null);
  assert.equal(new Asset({ kind: 'take_stem', createdEntirelyWithAi: false }).createdEntirelyWithAi, false);
});

test('malformed declarations are rejected before uploading or saving', async t => {
  const { uploads, saves } = setupUpload(t);
  for (const value of ['', null, 'yes', 'FALSE', 0, 1, [], {}, ['true']]) {
    const res = response(); await uploadOriginalAsset(request('take_stem', value), res);
    assert.equal(res.code, 400); assert.match(res.body.message, /true or false/);
  }
  assert.equal(uploads.mock.callCount(), 0); assert.equal(saves.mock.callCount(), 0);
});

test('non-stem uploads do not accept a stem AI declaration and remain unchanged when omitted', async t => {
  const { uploads, saves } = setupUpload(t);
  for (const kind of ['guide_track', 'demo', 'voice_note', 'take_mixdown', 'mix', 'master', 'chat_attachment']) {
    const res = response(); await uploadOriginalAsset(request(kind, 'true'), res); assert.equal(res.code, 400);
  }
  assert.equal(uploads.mock.callCount(), 0);
  const res = response(); await uploadOriginalAsset(request('take_mixdown'), res);
  assert.equal(res.code, 201); assert.equal(saves.mock.calls[0].arguments[0].createdEntirelyWithAi, null);
});

test('reservation ownership and expiry still protect AI-declared stem uploads', async t => {
  const { uploads } = setupUpload(t);
  t.mock.method(Reservation, 'findOne', async () => null);
  const res = response(); await uploadOriginalAsset(request('take_stem', 'true'), res);
  assert.equal(res.code, 409); assert.equal(uploads.mock.callCount(), 0);
});

test('workspace includes saved AI metadata in owner review without exposing other private assets to participants', async t => {
  t.mock.method(Musician, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  const records = [
    { _id: assetId, kind: 'take_stem', state: 'active', ownerId: player, createdEntirelyWithAi: true },
    { _id: 'legacy', kind: 'take_stem', state: 'active', ownerId: owner },
  ];
  t.mock.method(Project, 'findById', () => ({ lean: async () => ({ ...project(), initialAssetIds: [] }) }));
  for (const Model of [Round, Reservation, Submission, Notification, Invitation, Credit, Issue, Message, Future]) {
    t.mock.method(Model, 'find', () => { const query = { sort: () => query, select: () => query, populate: () => query, limit: () => query, lean: async () => [] }; return query; });
  }
  t.mock.method(Asset, 'find', () => {
    const query = { select(fields) { assert.ok(fields.split(' ').includes('createdEntirelyWithAi')); return query; }, sort: () => query, lean: async () => records };
    return query;
  });
  const ownerRes = response(); await getOriginalProjectWorkspace({ params: { id: projectId }, user: { id: owner } }, ownerRes);
  assert.equal(ownerRes.code, 200); assert.equal(ownerRes.body.assets.length, 2); assert.equal(ownerRes.body.assets[0].createdEntirelyWithAi, true);
  assert.equal(ownerRes.body.assets[1].createdEntirelyWithAi, undefined);
  const playerRes = response(); await getOriginalProjectWorkspace({ params: { id: projectId }, user: { id: player } }, playerRes);
  assert.equal(playerRes.body.assets.length, 1); assert.equal(playerRes.body.assets[0].createdEntirelyWithAi, true);
});

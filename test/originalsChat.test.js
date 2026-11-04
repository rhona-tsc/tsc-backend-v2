import test from 'node:test';
import { v2 as cloudinary } from 'cloudinary';
import assert from 'node:assert/strict';
import Project from '../models/originalProjectModel.js';
import Message from '../models/originalMessageModel.js';
import Asset from '../models/originalAssetModel.js';
import Musician from '../models/musicianModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Reservation from '../models/originalReservationModel.js';
import Notification from '../models/originalNotificationModel.js';
import Event from '../models/originalEventModel.js';
import Round from '../models/originalRoundModel.js';
import Invitation from '../models/originalInvitationModel.js';
import { postOriginalMessage, accessOriginalAsset, getOriginalMessages, uploadOriginalAsset } from '../controllers/originalsWorkflowController.js';
import { presentOriginalWorkspace } from '../services/originalsAccessService.js';
import { chatUploadError, chatDisplayName, CHAT_FILE_LIMIT } from '../services/originalsChatService.js';
const owner = '111111111111111111111111', author = '222222222222222222222222', projectId = '333333333333333333333333', assetId = '444444444444444444444444';
const project = { _id: projectId, ownerId: owner, ownerName: 'Veronica Downie', initialAssetIds: [] };
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, set() {}, json(body) { this.body = body; return this; } });
const request = body => ({ params: { id: projectId }, user: { id: author }, body });
function setup(t) {
  t.mock.method(Project, 'findById', () => ({ lean: async () => project }));
  t.mock.method(Musician, 'findById', () => ({ select: () => ({ lean: async () => ({ firstName: 'Rhona', lastName: 'Downie' }) }) }));
  t.mock.method(Message, 'findOne', async () => null);
  t.mock.method(Message, 'updateOne', async () => ({}));
  t.mock.method(Message, 'find', () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }));
  t.mock.method(Submission, 'distinct', async () => []);
  t.mock.method(Reservation, 'distinct', async () => []);
  t.mock.method(Reservation, 'findOne', () => ({ sort: () => ({ lean: async () => null }) }));
  for (const Model of [Round, Reservation, Submission, Invitation]) t.mock.method(Model, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(Notification, 'bulkWrite', async () => ({}));
  t.mock.method(Notification, 'findOneAndUpdate', () => ({ lean: async () => null }));
  t.mock.method(Event, 'create', async () => ({}));
  return t.mock.method(Message, 'create', async value => ({ _id: 'saved', ...value }));
}
test('saved text message remains successful if notification delivery fails', async t => {
  const create = setup(t);
  t.mock.method(Notification, 'bulkWrite', async () => { throw new Error('notification unavailable'); });
  t.mock.method(console, 'error', () => {});
  const res = response(); await postOriginalMessage(request({ body: 'Hello', clientMessageId: 'retry-key' }), res);
  assert.equal(res.code, 201); assert.equal(create.mock.callCount(), 1);
  assert.equal(res.body.message.authorCreditName, 'Rhona D.');
});
test('retry returns the saved message without sending duplicate notifications', async t => {
  const create = setup(t);
  t.mock.method(Message, 'findOne', async () => ({ _id: 'saved', body: 'Hello' }));
  const res = response(); await postOriginalMessage(request({ body: 'Hello', clientMessageId: 'retry-key' }), res);
  assert.equal(res.code, 200); assert.equal(create.mock.callCount(), 0);
});
test('simultaneous retry resolves a duplicate key to the existing message', async t => {
  setup(t); let calls = 0;
  t.mock.method(Message, 'findOne', async () => ++calls === 1 ? null : ({ _id: 'saved' }));
  t.mock.method(Message, 'create', async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); });
  const res = response(); await postOriginalMessage(request({ body: 'Hello', clientMessageId: 'race-key' }), res);
  assert.equal(res.code, 200); assert.equal(res.body.message._id, 'saved');
});
test('rejects oversized messages and invalid or foreign attachments before saving', async t => {
  const create = setup(t);
  t.mock.method(Asset, 'countDocuments', async query => { assert.equal(query.ownerId, author); assert.equal(query.projectId, projectId); return 0; });
  for (const body of [{ body: 'x'.repeat(3001) }, { attachmentIds: ['invalid'] }, { attachmentIds: [assetId] }, { body: '' }]) {
    const res = response(); await postOriginalMessage(request(body), res); assert.equal(res.code, 400);
  }
  assert.equal(create.mock.callCount(), 0);
});
test('attachment-only and voice-only messages require active uploads owned by the sender', async t => {
  setup(t); t.mock.method(Asset, 'countDocuments', async () => 1);
  t.mock.method(Asset, 'findOne', async query => { assert.equal(query.ownerId, author); assert.equal(query.kind, 'voice_note'); return { _id: assetId }; });
  for (const body of [{ attachmentIds: [assetId] }, { voiceAssetId: assetId }]) {
    const res = response(); await postOriginalMessage(request(body), res); assert.equal(res.code, 201);
  }
});
test('shared attachments become visible to other participants, unsent files stay private', () => {
  const input = { project, rounds: [], reservations: [], submissions: [], notifications: [], invitations: [], creditVersions: [], issues: [], assets: [{ _id: assetId, ownerId: owner, kind: 'chat_attachment', state: 'active' }, { _id: 'draft', ownerId: owner, kind: 'chat_attachment', state: 'active' }], messages: [{ attachmentIds: [{ _id: assetId }] }] };
  assert.deepEqual(presentOriginalWorkspace(input, { id: author }).assets.map(asset => asset._id), [assetId]);
});
test('secure asset access checks posted chat membership and denies an unsent private upload', async t => {
  setup(t);
  t.mock.method(Asset, 'findById', () => ({ lean: async () => ({ _id: assetId, projectId, ownerId: owner, kind: 'chat_attachment', state: 'active' }) }));
  const shared = t.mock.method(Message, 'exists', async query => { assert.equal(query.projectId, projectId); return false; });
  t.mock.method(Submission, 'exists', async () => false);
  const res = response(); await accessOriginalAsset({ params: { assetId }, user: { id: author } }, res);
  assert.equal(res.code, 403); assert.equal(shared.mock.callCount(), 1);
});
test('chat refresh returns latest 500 messages in chronological order', async t => {
  t.mock.method(Project, 'exists', async () => true);
  t.mock.method(Message, 'find', () => ({ sort: sort => { assert.equal(sort.createdAt, -1); return { limit: limit => { assert.equal(limit, 500); return { populate: () => ({ lean: async () => [{ _id: 'new' }, { _id: 'old' }] }) }; } }; } }));
  const res = response(); await getOriginalMessages(request({}), res);
  assert.deepEqual(res.body.messages.map(item => item._id), ['old', 'new']);
});
test('chat uploads allow common attachments but exclude executables and over-limit files', () => {
  assert.equal(chatUploadError('chat_attachment', { mimetype: 'application/pdf', size: 100 }), '');
  assert.equal(chatUploadError('voice_note', { mimetype: 'audio/webm;codecs=opus', size: 100 }), '');
  assert.match(chatUploadError('chat_attachment', { mimetype: 'text/html', size: 100 }), /Choose/);
  assert.match(chatUploadError('voice_note', { mimetype: 'video/mp4', size: 100 }), /Choose/);
  assert.match(chatUploadError('chat_attachment', { mimetype: 'image/png', size: CHAT_FILE_LIMIT + 1 }), /10 MB/);
  assert.equal(chatDisplayName('Veronica Downie'), 'Veronica D.');
});

test('chat respects existing anonymous credit preferences', async t => {
  setup(t);
  t.mock.method(Reservation, 'findOne', () => ({ sort: () => ({ lean: async () => ({ anonymous: true, creditName: 'Stage Name' }) }) }));
  const res = response(); await postOriginalMessage(request({ body: 'Hello' }), res);
  assert.equal(res.body.message.authorAnonymous, true);
  assert.equal(res.body.message.authorCreditName, 'Stage Name');
});

test('chat documents use authenticated raw storage and never become project stems or references', async t => {
  setup(t);
  t.mock.method(Project, 'findById', async () => project);
  let uploadedOptions, saved;
  t.mock.method(cloudinary.uploader, 'upload_stream', (options, callback) => {
    uploadedOptions = options;
    return { end: buffer => { assert.equal(buffer.toString(), 'example'); callback(null, { public_id: 'private/document.pdf', resource_type: 'raw' }); } };
  });
  t.mock.method(Asset, 'create', async value => { saved = value; return { _id: assetId, ...value }; });
  const res = response();
  await uploadOriginalAsset({ ...request({ kind: 'chat_attachment' }), file: { originalname: 'notes.pdf', mimetype: 'application/pdf', size: 7, buffer: Buffer.from('example') } }, res);
  assert.equal(res.code, 201); assert.equal(uploadedOptions.resource_type, 'raw'); assert.equal(uploadedOptions.type, 'authenticated');
  assert.match(uploadedOptions.public_id, /\.pdf$/); assert.equal(saved.finalEligible, false); assert.equal(saved.reservationId, null);
});
test('posted chat files can receive a short-lived secure link; unsent uploads remain private', async t => {
  setup(t);
  t.mock.method(Asset, 'findById', () => ({ lean: async () => ({ _id: assetId, projectId, ownerId: owner, kind: 'chat_attachment', state: 'active', cloudinaryPublicId: 'private/document.pdf', cloudinaryResourceType: 'raw' }) }));
  t.mock.method(Message, 'exists', async () => true);
  t.mock.method(cloudinary.utils, 'private_download_url', (publicId, _format, options) => {
    assert.equal(publicId, 'private/document.pdf'); assert.equal(options.resource_type, 'raw'); assert.equal(options.type, 'authenticated');
    assert.ok(options.expires_at <= Math.floor(Date.now() / 1000) + 300);
    return 'https://example.test/secure-file';
  });
  const res = response(); await accessOriginalAsset({ params: { assetId }, user: { id: author } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.expiresInSeconds, 300);
});

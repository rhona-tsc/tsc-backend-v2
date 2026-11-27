import test from 'node:test';
import assert from 'node:assert/strict';
import Musician from '../models/musicianModel.js';
import { addOriginalChatProfiles } from '../services/originalsChatProfileService.js';

const publicId = '111111111111111111111111', anonymousId = '222222222222222222222222';
test('existing chat messages use the current public profile slug, with one lookup per author', async t => {
  let lookup;
  t.mock.method(Musician, 'find', filter => { lookup = filter; return { select: () => ({ lean: async () => [{ _id: publicId, musicianSlug: 'jack-a' }] }) }; });
  const messages = [{ authorId: publicId, authorCreditName: 'Jack A.' }, { authorId: publicId }, { authorId: anonymousId, authorAnonymous: true, authorCreditName: 'Sleepless' }];
  const result = await addOriginalChatProfiles(messages);
  assert.deepEqual(lookup._id.$in, [publicId]);
  assert.equal(result[0].authorProfilePath, '/musician/jack-a');
  assert.equal(result[1].authorProfilePath, '/musician/jack-a');
  assert.equal(result[2].authorProfilePath, null);
  assert.equal(result[2].authorCreditName, 'Sleepless');
  assert.equal(messages[0].authorProfilePath, undefined);
});
test('anonymous and system messages never look up identities or retain supplied profile paths', async t => {
  t.mock.method(Musician, 'find', () => { throw Error('No profile lookups allowed'); });
  const result = await addOriginalChatProfiles([{ authorId: anonymousId, authorAnonymous: true, authorProfilePath: '/musician/private' }, { authorId: publicId, messageType: 'stem_approved' }]);
  assert.ok(result.every(message => message.authorProfilePath === null));
});
test('private, removed and missing profiles stay unlinked; public profiles without slugs use their public ID route', async t => {
  for (const profile of [null, { _id: publicId, privateTestProfile: true }, { _id: publicId, profileDeletedAt: new Date() }, { _id: publicId }]) {
    t.mock.method(Musician, 'find', () => ({ select: () => ({ lean: async () => profile ? [profile] : [] }) }));
    const [result] = await addOriginalChatProfiles([{ authorId: publicId }]);
    assert.equal(result.authorProfilePath, profile && !profile.privateTestProfile && !profile.profileDeletedAt ? `/musician/${publicId}` : null);
  }
});

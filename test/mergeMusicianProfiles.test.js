import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeProfileValues, removeRejectedImage } from '../utils/mergeMusicianProfiles.js';

test('fills missing profile data and combines unique repertoire, gear and photographs', () => {
  const old = { photo: 'portrait.jpg', equipment: { mic: 'SM58' }, images: ['portrait.jpg', 'stage.jpg'], instruments: [{ instrument: 'Acoustic Drums', skill_level: 'Expert', _id: 'old' }], credits: [{ name: '', _id: 'placeholder' }, { name: 'Festival' }] };
  const main = { photo: null, equipment: { mic: null, pedal: 'Current pedal' }, images: ['portrait.jpg'], instruments: [{ instrument: 'Drums', skill_level: 'Expert' }], bio: 'Current bio' };
  const merged = mergeProfileValues(main, old);
  assert.equal(merged.photo, old.photo);
  assert.deepEqual(merged.equipment, { mic: 'SM58', pedal: 'Current pedal' });
  assert.deepEqual(merged.images, ['portrait.jpg', 'stage.jpg']);
  assert.equal(merged.instruments.length, 1);
  assert.equal(merged.instruments[0].instrument, 'Drums');
  assert.deepEqual(merged.credits.map(row => row.name), ['Festival']);
  assert.equal(merged.bio, main.bio);
  assert.equal(main.photo, null);
});
test('removes rejected contact image from cover, gallery and transformed variants only', () => {
  const bad = 'acts/rejected';
  const doc = { cover: `https://image/upload/${bad}.jpg`, images: [`https://image/upload/c_fill/${bad}.jpg`, 'clean.jpg'], nested: { image: 'keep.jpg' } };
  assert.deepEqual(removeRejectedImage(doc, bad), { cover: null, images: ['clean.jpg'], nested: { image: 'keep.jpg' } });
});

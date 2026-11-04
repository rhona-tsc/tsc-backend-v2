import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudinaryImage } from './cloudinaryImage.js';
const base = 'https://res.cloudinary.com/dvcgr3fyd/image/upload/';

test('limits delivery after saved crops and keeps asset identity, query and fragment', () => {
  const source = base + 'c_crop,g_north_west,x_10,y_20,w_900,h_600/v123/acts/band.png?test=1#photo';
  assert.equal(cloudinaryImage(source, 480), base + 'c_crop,g_north_west,x_10,y_20,w_900,h_600/c_limit,w_480/q_auto/f_auto/v123/acts/band.png?test=1#photo');
});
test('idempotent, with replaceable delivery sizes for responsive candidates', () => {
  const source = base + 'v123/acts/band.png';
  const result = cloudinaryImage(source, 960);
  assert.equal(cloudinaryImage(result, 960), result);
  assert.equal(cloudinaryImage(result, 480), cloudinaryImage(source, 480));
  assert.equal(cloudinaryImage(base + 'c_limit,w_960,f_auto,q_auto/v123/acts/band.png', 480), cloudinaryImage(source, 480));
});
test('keeps existing aspect, gravity, effects and named transformations', () => {
  const prefix = 'c_fill,g_auto,ar_3:1,w_1500/e_sharpen/t_brand/';
  assert.equal(cloudinaryImage(base + prefix + 'v123/band.jpg', 1200), base + prefix + 'c_limit,w_1200/q_auto/f_auto/v123/band.jpg');
});
test('leaves other hosts, resource types, documents, signed URLs and attachments intact', () => {
  for (const source of [undefined, null, '', '/logo.png', 'blob:preview', 'data:image/png;base64,abc', 'https://example.com/image/upload/a.png', 'https://res.cloudinary.com.evil.test/dvcgr3fyd/image/upload/a.png', base.replace('/image/', '/video/') + 'a.mp4', base.replace('/image/', '/video/') + 'a.mp3', base.replace('/image/', '/raw/') + 'a.pdf', base + 'v123/a.pdf', base + 'v123/a.mp3', base + 'v123/a.mp4', base + 'v123/a.svg', base + 's--abcdef--/v123/a.png', base + 'fl_attachment:original/v123/a.png']) assert.equal(cloudinaryImage(source, 320), source);
});
test('transparent logos remain negotiable without flattening or forced JPEG', () => {
  const result = cloudinaryImage(base + 'v123/logo.png', 320);
  assert.ok(result.endsWith('/c_limit,w_320/q_auto/f_auto/v123/logo.png'));
  assert.ok(!result.includes('b_white') && !result.includes('f_jpg'));
});
test('works with unversioned folders and validates dimensions', () => {
  assert.equal(cloudinaryImage(base + 'acts/my_band.png', 320), base + 'c_limit,w_320/q_auto/f_auto/acts/my_band.png');
  assert.equal(cloudinaryImage(base + 'a.png', -1), cloudinaryImage(base + 'a.png', 1200));
});

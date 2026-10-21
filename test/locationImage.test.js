import test from 'node:test';
import assert from 'node:assert/strict';
import { locationImageUrl } from '../services/locationImage.js';
import Act from '../models/actModel.js';
const url = 'https://res.cloudinary.com/example/image/upload/v123/band.jpg';
test('custom card crops preserve the source and add bounded delivery sizes', () => {
  const act = { images: [{ url, locationCrop: { x: 10, y: 20, width: 900, height: 600 } }] };
  assert.equal(locationImageUrl(act), url.replace('/upload/', '/upload/c_crop,g_north_west,x_10,y_20,w_900,h_600/c_limit,w_960,f_auto,q_auto/'));
  assert.equal(act.images[0].url, url);
  assert.ok(!locationImageUrl({ images: [{ url, locationCrop: { x: -1, width: 900, height: 600 } }] }).includes('c_crop'));
  assert.equal(locationImageUrl({ images: [{ url: 'https://example.com/photo.jpg' }] }), 'https://example.com/photo.jpg');
});
test('crop survives schema serialization without changing other image fields', () => {
  const doc = new Act({ images: [{ url, title: 'Band photo', locationCrop: { x: 0, y: 10, width: 900, height: 600 } }] });
  const image = doc.toObject().images[0];
  assert.equal(image.locationCrop.height, 600);
  assert.equal(image.url, url);
  assert.equal(image.title, 'Band photo');
});

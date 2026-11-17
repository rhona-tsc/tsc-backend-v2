import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';
import { buildMerchantFeed } from '../services/merchantFeed.js';

const act = { _id: 'existing-google-product-id', tscName: 'Example & Friends',
  slug: 'example-and-friends', status: 'approved', minDisplayPrice: 1831,
  tscDescription: '<p>A "live" band\twith music\nfor weddings &amp; events.</p>',
  coverImage: [{ url: 'https://example.com/band.jpg' }],
  supplierPricing: { privateFee: 'PRIVATE' }, lineups: [{ bandMembers: [{ email: 'PRIVATE', accountNumber: 'PRIVATE' }] }] };
const rows = acts => parse(buildMerchantFeed(acts), { delimiter: '\t', columns: true });

test('website price changes reach the feed without a second markup or new product identity', () => {
  const before = rows([act])[0];
  const after = rows([{ ...act, minDisplayPrice: 1999 }])[0];
  assert.equal(before.price, '1831.00 GBP');
  assert.equal(after.price, '1999.00 GBP');
  assert.equal(after.id, before.id);
  assert.equal(after.link, 'https://thesupremecollective.co.uk/act/example-and-friends/');
  assert(!buildMerchantFeed([act]).includes('PRIVATE'));
});

test('approved amendments stay listed; shelved, test and unpriced records do not', () => {
  const records = [act,
    { ...act, _id: 'pending-amendment', status: 'Approved, changes pending' },
    { ...act, _id: 'live', status: 'live' },
    ...['draft', 'pending', 'trashed'].map(status => ({ ...act, _id: status, status })),
    { ...act, _id: 'test-flag', isTest: true }, { ...act, _id: 'test-slug', slug: 'test-example' },
    { ...act, _id: 'test-name', tscName: 'Test Example' },
    { ...act, _id: 'unpriced', minDisplayPrice: null },
    { ...act, _id: 'invalid-price', minDisplayPrice: Infinity },
    { ...act, _id: 'missing-description', tscDescription: '' }];
  assert.deepEqual(rows(records).map(row => row.id), ['existing-google-product-id', 'pending-amendment', 'live']);
});

test('text stays in one product row and quoted descriptions round-trip correctly', () => {
  const products = rows([act, { ...act, _id: 'other', coverImage: [], images: act.coverImage }]);
  assert.equal(products.length, 2);
  assert.equal(products[0].description, 'A "live" band with music for weddings & events.');
  assert.equal(products[1].image_link, 'https://example.com/band.jpg');
  assert.throws(() => buildMerchantFeed([]), /No publishable products/);
  assert.throws(() => buildMerchantFeed([{ ...act, status: 'draft' }]), /No publishable products/);
});


test('Google uses the current direct website saving even if a display cache is still old', () => {
  const priced = { ...act, minDisplayPrice: 3671, supplierPricing: { lineups: {
    six: { counties: { London: 2760, Kent: 2900 } }
  } } };
  assert.equal(rows([priced])[0].price, '3571.00 GBP');
  priced.supplierPricing.lineups.six.counties.London = 2800;
  assert.equal(rows([priced])[0].price, '3624.00 GBP');
  assert.equal(priced.minDisplayPrice, 3671);
});

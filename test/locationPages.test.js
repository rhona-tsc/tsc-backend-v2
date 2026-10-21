import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationPages, canonicalCounty, reviewCounty } from '../services/locationPageService.js';
test('county aliases combine London without guessing missing locations', () => {
  assert.equal(canonicalCounty('South west London'), 'London');
  assert.equal(canonicalCounty(' Greater London '), 'London');
  assert.equal(canonicalCounty(''), '');
  assert.equal(reviewCounty('London Road, Essex'), '');
});
test('only confirmed originals affect ranking, not deputies or shared admin contacts', () => {
  const musicians = [{ _id: 'm1', email: 'a@example.test', firstName: 'Alice', lastName: 'Smith', address: { county: 'Essex', postcode: 'PRIVATE' } }];
  const make = (id, member) => ({ _id: id, slug: id, tscName: id, lineups: [{ bandMembers: [member] }] });
  const acts = [make('a', { email: 'a@example.test', firstName: 'Wrong', lastName: 'Name', postCode: 'CM19' }), make('b', { firstName: 'Alice', lastName: 'Smith', email: 'a@example.test' }), make('c', { deputies: [{ musicianId: 'm1' }] }), make('d', { musicianId: 'm1' })];
  const data = buildLocationPages(acts, musicians, []);
  assert.deepEqual(data.essex.bands.filter(b => b.hasLocalOriginal).map(b => b.id), ['b', 'd']);
  assert.ok(!JSON.stringify(data).includes('a@example.test'));
  assert.ok(!JSON.stringify(data).includes('PRIVATE'));
});
test('reviews require verification and a county match; duplicates and emails are excluded', () => {
  const review = { verified: true, eventLocation: 'Kent', comment: 'Wonderful band and evening.', clientFirstName: 'Sam', clientEmail: 'private@example.test' };
  const acts = [{ _id: 'a', tscName: 'Band', slug: 'band', lineups: [], reviews: [review, review, { ...review, verified: false, comment: 'Not approved' }, { ...review, comment: 'Contact private@example.test' }] }];
  const data = buildLocationPages(acts, [], [{ _id: 'v', name: 'Example Hall', county: 'Kent' }, { _id: 'p', name: 'Private home', county: 'Kent' }]);
  assert.equal(data.kent.reviews.length, 1);
  assert.equal(data.kent.venues.length, 1);
  assert.ok(!JSON.stringify(data).includes('private@example.test'));
  assert.equal(data.essex.reviews.length, 0);
});

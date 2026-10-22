import test from 'node:test';
import assert from 'node:assert/strict';
import { createActNameResolver } from '../services/actNameMatching.js';
import { buildPublicPerformanceHistory } from '../services/publicPerformanceHistory.js';
import { venueEveningExamples } from '../data/venueEveningExamples.js';
import { reviewCounty, countyForReview } from '../services/locationMatching.js';

const acts = [
  { _id: 'a', name: 'Motown Magic', tscName: 'Dancefloor Magic', slug: 'dancefloor-magic', reviews: [] },
  { _id: 'b', name: 'Funk Royale', tscName: 'Funk Royale', slug: 'funk-royale', reviews: [] },
  { _id: 'c', name: 'All Nighters', tscName: 'All Nighters', slug: 'all-nighters', reviews: [] },
];
test('AKA names resolve to the canonical act but shared aliases never guess', () => {
  const resolve = createActNameResolver(acts);
  assert.equal(resolve('Rhythm Mystique').slug, 'dancefloor-magic');
  assert.equal(resolve('Capital Funk').slug, 'funk-royale');
  assert.equal(resolve('Night Moves').slug, 'all-nighters');
  assert.equal(resolve('Hot Rox'), null);
  assert.equal(resolve('The Premonitions'), null);
  assert.equal(resolve('Unknown'), null);
  assert.equal(resolve('Hot Rox', 'c').slug, 'all-nighters');
});
test('history combines aliases, deduplicates months and excludes future/private records', () => {
  const venues = [{ _id: 'v', name: 'Example Hall', county: 'Essex', clientName: 'SECRET', visits: [
    { actName: 'Rhythm Mystique', eventDate: '2025-01-02', clientName: 'SECRET' },
    { actName: 'Motown Magic', eventDate: '2025-01-02' },
    { actName: 'Dancefloor Magic', eventDate: '2025-06-02' },
    { actName: 'Capital Funk', eventDate: '2030-06-02' },
    { actName: 'Hot Rox', eventDate: '2025-06-02' },
  ] }, { _id: 'p', name: 'Private home', county: 'Essex', visits: [{ actName: 'Capital Funk', eventDate: '2025-01-02' }] }];
  const result = buildPublicPerformanceHistory(acts, venues, new Date('2026-10-22'));
  assert.equal(result.histories['dancefloor-magic'].venues.length, 1);
  assert.deepEqual(result.histories['dancefloor-magic'].venues[0].months, ['2025-06', '2025-01']);
  assert.equal(result.histories['funk-royale'].venues.length, 0);
  assert.equal(result.histories['all-nighters'].venues.length, 0);
  assert.equal(result.venueHistories.v.performances[0].name, 'Dancefloor Magic');
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('review county metadata never rewrites or exposes review text and leaves ambiguous text unresolved', () => {
  const reviews = [
    { _id: 'r1', eventLocation: 'Essex', comment: 'Loved it', clientEmail: 'SECRET' },
    { _id: 'r2', comment: 'A wonderful wedding in Kent.' },
    { _id: 'r3', comment: 'Our guests came from London and Essex.' },
    { _id: 'r4', eventLocation: 'Example Hall', comment: 'Loved it' },
  ];
  const copy = JSON.stringify(reviews);
  const result = buildPublicPerformanceHistory([{ ...acts[0], reviews }], [{ _id: 'v', name: 'Example Hall', county: 'Surrey' }]);
  assert.deepEqual(result.histories['dancefloor-magic'].reviewCounties.map(r=>r.county), ['Essex', 'Kent', 'Surrey']);
  assert.equal(JSON.stringify(reviews), copy);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.equal(reviewCounty('London Road, Essex'), '');
  assert.equal(reviewCounty('NotExample Hallway', [{ name: 'Example Hall', county: 'Surrey' }]), '');
  assert.equal(countyForReview({ comment: 'A lovely band based in Essex.' }), '');
  assert.equal(countyForReview({ comment: 'They travelled from Kent to our wedding.' }), '');
});
test('five checked public examples are data-minimised and only attach to the matching venue and approved band', () => {
  assert.equal(new Set(venueEveningExamples.map(e=>e.county)).size, 5);
  assert.equal(venueEveningExamples.length, 5);
  assert.ok(!/docs.google|clientName|"phone"|sourceUrl|@/.test(JSON.stringify(venueEveningExamples)));
  const result = buildPublicPerformanceHistory(acts, [{ _id:'v', name:'Allington Castle', county:'Kent' }]);
  assert.equal(result.venueHistories.v.examples[0].actName, 'Funk Royale');
  assert.equal(result.histories['funk-royale'].examples.length, 1);
  assert.ok(!result.venueHistories.v.examples[0].rows.some(row=>/Soundcheck/.test(row[1])));
});
test('evening backgrounds use the matching band photo and saved crop, with a safe empty fallback', () => {
  const bands = acts.map(act => act.slug === 'funk-royale' ? { ...act, images: [{ url: 'https://res.cloudinary.com/example/image/upload/v1/funk.jpg', locationCrop: { x: 10, y: 20, width: 600, height: 400 } }] } : act);
  const venues = [{ _id: 'v', name: 'Allington Castle', county: 'Kent' }];
  const result = buildPublicPerformanceHistory(bands, venues);
  const example = result.venueHistories.v.examples[0];
  assert.match(example.image, /c_crop,g_north_west,x_10,y_20,w_600,h_400\/c_limit,w_960,f_auto,q_auto/);
  assert.equal(result.histories['funk-royale'].examples[0].image, example.image);
  assert.equal(buildPublicPerformanceHistory(acts, venues).venueHistories.v.examples[0].image, '');
});

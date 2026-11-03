import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCard } from '../services/buildActFilterCard.js';

test('act browse cards carry the stored setlist-control level', () => {
  const card = buildCard({
    _id: '6803a715d851b68a61832b06',
    tscName: 'The Dreamers',
    setlist: 'largeTailoring',
    lineups: [],
  });

  assert.equal(card.setlist, 'largeTailoring');
});

test('unknown setlist-control values are not exposed on browse cards', () => {
  const card = buildCard({
    _id: '6803a715d851b68a61832b06',
    tscName: 'The Dreamers',
    setlist: 'unexpected-value',
    lineups: [],
  });

  assert.equal(card.setlist, '');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteActView } from './websiteLineups.js';
import { buildCard } from '../services/buildActFilterCard.js';

test('unpublished lineups leave public profiles and cards while source records stay intact', () => {
  const act = { tscName: 'Example', hiddenWebsiteLineupIds: ['solo', 'old-five'], lineups: [
    { lineupId: 'six', actSize: '6-Piece', bandMembers: Array.from({length:6},()=>({fee:200})) },
    { lineupId: 'solo', actSize: '1-Piece', bandMembers: [{fee:200}] },
    { lineupId: 'five', _id: {toString:()=>'old-five'}, actSize: '5-Piece', bandMembers: Array.from({length:5},()=>({fee:200})) },
  ] };
  const visible = websiteActView(act);
  assert.deepEqual(visible.lineups.map(l=>l.lineupId), ['six']);
  assert.equal(act.lineups.length, 3);
  assert.deepEqual(buildCard(act).lineupSizes, ['6-Piece']);
  assert.equal(buildCard(act).smallestLineupSize, 6);
  assert.equal(buildCard(act).basePrice, 1200);
});

test('existing acts and administratively loaded lineups retain their data', () => {
  const act = {lineups:[{lineupId:'existing'}]};
  assert.equal(websiteActView(act), act);
  assert.equal(websiteActView(null), null);
});

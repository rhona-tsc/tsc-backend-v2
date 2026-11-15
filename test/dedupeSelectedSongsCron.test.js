import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectedSongsDedupeJob } from '../cron/dedupeSelectedSongsCron.js';
const quiet = { info() {}, warn() {} };
const song = (title, artist = 'Artist', extra = {}) => ({ title, artist, ...extra });
function fixture(rows, { update = async () => ({ modifiedCount: 1 }), iterateError } = {}) {
  const writes = []; const events = []; let closes = 0;
  const cursor = {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) { events.push(`read:${row._id}`); yield row; }
      if (iterateError) throw iterateError;
    },
    async close() { closes++; },
  };
  const Model = {
    find(filter) {
      assert.deepEqual(filter, { selectedSongs: { $type: 'array' } });
      return {
        select(projection) {
          assert.deepEqual(projection, { _id: 1, selectedSongs: 1 });
          return { lean() { return { cursor(options) { assert.deepEqual(options, { batchSize: 1 }); return cursor; } }; } };
        },
        then() { assert.fail('must stream rather than materialise all profiles'); },
      };
    },
    collection: { async updateOne(filter, patch) { events.push(`write:${filter._id}`); writes.push({ filter, patch }); return update(filter, patch); } },
  };
  const run = createSelectedSongsDedupeJob({ Model, logger: quiet, sampleMemory: async () => {} });
  return { run, writes, events, get closes() { return closes; } };
}

test('streams one projected song list at a time and preserves first occurrence and metadata', async () => {
  const first = song('A & B', 'Singer feat. Friend', { genre: 'Pop', year: null, _id: 'song-1', legacy: true });
  const unique = song('Different', 'Singer');
  const original = [first, song('a and b', 'singer ft friend'), unique];
  const f = fixture([{ _id: 'one', selectedSongs: original }, { _id: 'two', selectedSongs: [song('C'), song('C')] }]);
  const result = await f.run();
  assert.deepEqual(result, { scanned: 2, musiciansUpdated: 2, totalRemoved: 2, concurrentEditsSkipped: 0 });
  assert.deepEqual(f.events, ['read:one', 'write:one', 'read:two', 'write:two']);
  assert.deepEqual(f.writes[0].filter, { _id: 'one', selectedSongs: { $eq: original } });
  assert.deepEqual(f.writes[0].patch.$set.selectedSongs, [first, unique]);
  assert.ok(f.writes[0].patch.$set.profileLastEditedAt instanceof Date);
  assert.deepEqual(Object.keys(f.writes[0].patch.$set).sort(), ['profileLastEditedAt', 'selectedSongs']);
  assert.equal(original.length, 3);
  assert.equal(f.closes, 1);
});

test('unique and empty lists are never written', async () => {
  const f = fixture([{ _id: 'one', selectedSongs: [] }, { _id: 'two', selectedSongs: [song('One'), song('Two'), song('One', 'Other')] }]);
  const result = await f.run();
  assert.equal(result.scanned, 2); assert.equal(f.writes.length, 0); assert.equal(f.closes, 1);
});

test('a changed list is skipped rather than overwriting a concurrent edit', async () => {
  const f = fixture([{ _id: 'one', selectedSongs: [song('One'), song('One')] }], { update: async () => ({ modifiedCount: 0 }) });
  const result = await f.run();
  assert.equal(result.musiciansUpdated, 0); assert.equal(result.totalRemoved, 0); assert.equal(result.concurrentEditsSkipped, 1);
});

for (const phase of ['read', 'write']) {
  test(`closes its cursor and permits retry after a ${phase} failure`, async () => {
    let fail = true;
    const f = fixture([{ _id: 'one', selectedSongs: [song('One'), song('One')] }], {
      ...(phase === 'read' ? { iterateError: new Error('read failed') } : { update: async () => { if (fail) { fail = false; throw new Error('write failed'); } return { modifiedCount: 1 }; } }),
    });
    await assert.rejects(f.run(), /failed/); assert.equal(f.closes, 1);
    if (phase === 'write') { await f.run(); assert.equal(f.closes, 2); }
  });
}

test('overlapping manual and scheduled runs share one job', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const f = fixture([{ _id: 'one', selectedSongs: [song('One'), song('One')] }], { update: async () => { await gate; return { modifiedCount: 1 }; } });
  const first = f.run(); const second = f.run(); release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b); assert.equal(f.writes.length, 1); assert.equal(f.closes, 1);
});

test('synthetic large inventory is streamed without fetching full musician profiles', async () => {
  const rows = { *[Symbol.iterator]() { for (let i = 0; i < 10000; i++) yield { _id: i, selectedSongs: [song('Unique')] }; } };
  const f = fixture(rows);
  const result = await f.run();
  assert.equal(result.scanned, 10000); assert.equal(f.writes.length, 0); assert.equal(f.closes, 1);
});

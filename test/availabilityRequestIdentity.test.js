import test from 'node:test';
import assert from 'node:assert/strict';
import { availabilityRequestEnquiryRef, availabilityRequestEnquiryScope, reserveAvailabilityRequest } from '../services/availabilityRequestIdentity.js';
import { migrateAvailabilityEnquiryIndex } from '../services/availabilityIndexMigration.js';

test('every explicit enquiry reference isolates requests, regardless of source or venue', () => {
  for (const source of ['encore_enquiry_board', 'manual_enquiry_board', 'website', undefined]) {
    assert.deepEqual(availabilityRequestEnquiryScope({ source, enquiryId: ' A ' }), { enquiryId: 'A' });
  }
  for (const key of ['shortlistId', 'requestId', 'parentKey']) {
    assert.equal(availabilityRequestEnquiryRef({ [key]: ' B ' }), 'B');
  }
  assert.equal(availabilityRequestEnquiryRef({ enquiryId: ' ', requestId: 'B' }), 'B');
  assert.notDeepEqual(availabilityRequestEnquiryScope({ enquiryId: 'A' }), availabilityRequestEnquiryScope({ enquiryId: 'B' }));
  assert.deepEqual(availabilityRequestEnquiryScope({}), { enquiryId: { $in: [null, ''] } });
});

test('a concurrent duplicate preserves the existing request instead of sending again', async () => {
  const existing = { _id: 'a', requestId: 'ORIGINAL', status: 'delivered' };
  const Model = {
    findOneAndUpdate: async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); },
    findOne: query => ({ lean: async () => { assert.deepEqual(query, { enquiryId: 'A' }); return existing; } }),
  };
  const result = await reserveAvailabilityRequest(Model, { enquiryId: 'A' }, {}, { requestId: 'RETRY' });
  assert.equal(result.reserved, false);
  assert.equal(result.doc.requestId, 'ORIGINAL');
});

test('an unrelated index conflict remains an error requiring reconciliation', async () => {
  const error = Object.assign(new Error('another index'), { code: 11000 });
  await assert.rejects(reserveAvailabilityRequest({
    findOneAndUpdate: async () => { throw error; },
    findOne: () => ({ lean: async () => null }),
  }, { enquiryId: 'B' }, {}, {}), err => err === error);
});

test('migration builds replacement protection before dropping only the known old constraints', async () => {
  const calls = [];
  const collection = {
    indexes: async () => [
      { name: '_id_', key: { _id: 1 }, unique: true },
      { name: 'old', key: { actId: 1, lineupId: 1, dateISO: 1, phone: 1, v2: 1, slotIndex: 1 }, unique: true },
      { name: 'unrelated_unique', key: { other: 1 }, unique: true },
    ],
    aggregate: () => ({ toArray: async () => [] }), countDocuments: async () => 4,
    createIndex: async () => { calls.push('create'); },
    dropIndex: async name => { calls.push(`drop:${name}`); },
  };
  const plan = await migrateAvailabilityEnquiryIndex(collection);
  assert.deepEqual(plan.replaceIndexes, ['old']);
  assert.deepEqual(calls, []);
  await migrateAvailabilityEnquiryIndex(collection, { apply: true });
  assert.deepEqual(calls, ['create', 'drop:old']);
});

test('index build failure or duplicate data leaves old constraints intact', async () => {
  let drops = 0;
  const collection = {
    indexes: async () => [{ name: 'old', key: { actId: 1, lineupId: 1, dateISO: 1, phone: 1, v2: 1, slotIndex: 1 }, unique: true }],
    aggregate: () => ({ toArray: async () => [] }), countDocuments: async () => 2,
    createIndex: async () => { throw new Error('build failed'); }, dropIndex: async () => { drops++; },
  };
  await assert.rejects(migrateAvailabilityEnquiryIndex(collection, { apply: true }), /build failed/);
  collection.aggregate = () => ({ toArray: async () => [{ duplicateGroups: 1 }] });
  await assert.rejects(migrateAvailabilityEnquiryIndex(collection, { apply: true }), err => err.code === 'AVAILABILITY_DUPLICATE_SCOPE');
  assert.equal(drops, 0);
});

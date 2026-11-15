import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Availability from '../models/availabilityModel.js';
import { availabilityRequestEnquiryScope, availabilityAttemptFilter, reserveAvailabilityRequest } from '../services/availabilityRequestIdentity.js';
import { migrateAvailabilityEnquiryIndex } from '../services/availabilityIndexMigration.js';

if (!process.argv.includes('--run')) throw new Error('Pass --run to exercise an isolated temporary collection. No messages are sent.');
const collectionName = `codex_availability_scope_test_${randomUUID().replaceAll('-', '')}`;
let collection;
try {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { autoCreate: false, autoIndex: false });
  const Test = mongoose.model('AvailabilityRequestIsolationTest', Availability.schema.clone(), collectionName);
  await mongoose.connection.db.createCollection(collectionName);
  collection = mongoose.connection.db.collection(collectionName);
  await collection.createIndex({ actId: 1, lineupId: 1, dateISO: 1, phone: 1, v2: 1, slotIndex: 1 }, { unique: true, name: 'old_day_unique' });
  await collection.createIndex({ actId: 1, requestKey: 1, lineupId: 1, dateISO: 1, phone: 1, v2: 1, slotIndex: 1 }, { unique: true, name: 'old_address_unique' });
  await collection.createIndex({ requestId: 1 }, { name: 'keep_request_lookup' });
  const common = { actId: new mongoose.Types.ObjectId(), lineupId: new mongoose.Types.ObjectId(), dateISO: '2050-01-01', phone: '+440000000000', v2: true, slotIndex: 0 };
  const original = { ...common, enquiryId: 'client-a', requestKey: 'a-venue', requestId: 'RID-A', status: 'delivered', reply: null, messageSidOut: 'TEST-SID-A', fee: '300' };
  await collection.insertOne(original);
  await assert.rejects(collection.insertOne({ ...common, enquiryId: 'client-b', requestKey: 'b-venue' }), error => error.code === 11000);
  const before = await collection.findOne({ enquiryId: 'client-a' });
  const plan = await migrateAvailabilityEnquiryIndex(collection);
  assert.equal(plan.applied, false);
  assert.equal(plan.replaceIndexes.length, 2);
  await migrateAvailabilityEnquiryIndex(collection, { apply: true });
  assert.deepEqual(await collection.findOne({ enquiryId: 'client-a' }), before);
  assert.ok((await collection.indexes()).some(index => index.name === 'keep_request_lookup'));

  const reserve = (ref, requestId, extra = {}) => reserveAvailabilityRequest(Test,
    { ...common, ...availabilityRequestEnquiryScope({ enquiryId: ref }) },
    { ...common, enquiryId: ref, reply: null }, { requestId, requestKey: `${ref}-venue`, fee: '362', ...extra });
  const b = await reserve('client-b', 'RID-B');
  assert.equal(b.reserved, true);
  assert.notEqual(String(b.doc._id), String(before._id));
  assert.equal((await reserve('client-b', 'DO-NOT-SEND', { requestKey: 'changed-address' })).reserved, false);
  assert.equal((await collection.findOne({ enquiryId: 'client-b' })).requestId, 'RID-B');
  const race = await Promise.all([reserve('client-c', 'RID-C1'), reserve('client-c', 'RID-C2')]);
  assert.equal(race.filter(result => result.reserved).length, 1);
  assert.equal(await collection.countDocuments({ enquiryId: 'client-c' }), 1);
  assert.equal((await Test.findOne({ ...common, enquiryId: 'client-a', ...availabilityAttemptFilter() }).lean()).requestId, 'RID-A');

  await collection.insertOne({ ...common, enquiryId: 'failed-local', requestKey: 'd', status: 'failed', reply: null });
  assert.equal((await reserve('failed-local', 'RID-D')).reserved, true);
  await collection.insertOne({ ...common, enquiryId: 'failed-outbound', requestKey: 'e', requestId: 'RID-E', status: 'failed', reply: null, messageSidOut: 'TEST-SID-E' });
  assert.equal((await reserve('failed-outbound', 'NO-RESEND')).reserved, false);
  await collection.updateOne({ enquiryId: 'client-b' }, { $set: { reply: 'yes', messageSidOut: 'TEST-SID-B' } });
  assert.deepEqual(await collection.findOne({ enquiryId: 'client-a' }), before);
  assert.equal((await collection.findOne({ enquiryId: 'client-b' })).reply, 'yes');
  assert.equal((await collection.findOne({ enquiryId: 'client-b' })).fee, '362');
  assert.equal(await Test.countDocuments({ ...common, ...availabilityRequestEnquiryScope({}) }), 0);
  const repeat = await migrateAvailabilityEnquiryIndex(collection, { apply: true });
  assert.deepEqual(repeat.replaceIndexes, []);
  console.log(JSON.stringify({ passed: true, checks: ['legacy collision reproduced', 'replacement-before-drop migration', 'old row untouched', 'two separate enquiries same date/person', 'same enquiry/address-change deduplicated', 'concurrent duplicate deduplicated', 'delivered request not resent', 'local unsent failure retryable', 'failed actual outbound not resent', 'reply and fee isolation', 'legacy scope isolated', 'migration idempotent'] }));
} finally {
  if (collection) await collection.drop();
  await mongoose.disconnect();
}

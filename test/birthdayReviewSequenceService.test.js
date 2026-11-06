import test from 'node:test';
import assert from 'node:assert/strict';
import { enableBirthdayReviewSequence } from '../services/birthdayReviewSequenceService.js';

const fixture = row => {
  const updates = [];
  const model = {
    findById: () => ({lean: async () => row}),
    findOneAndUpdate: (filter, update, options) => ({lean: async () => {updates.push({filter,update,options}); return {...row,...update.$set};}}),
  };
  return {model,updates};
};
test('explicit setup stores only the reusable plan and cannot change billing or other booking details', async () => {
  const f=fixture({_id:'booking',eventType:'Birthday Party',grossValue:2615});
  const row=await enableBirthdayReviewSequence({bookingModel:f.model,bookingId:'booking'});
  assert.deepEqual(row.reviewRequestPlan.items.map(item=>item.automationNumber),[13,15,41]);
  assert.deepEqual(Object.keys(f.updates[0].update.$set),['reviewRequestPlan']);
  assert.equal(f.updates[0].filter['reviewRequestPlan.enabled'].$ne,true);
  assert.equal(f.updates[0].filter.eventType,'Birthday Party');
  assert.equal(f.updates[0].options.runValidators,true);
});
test('setup rejects missing bookings, corporate events and existing plans without writing', async () => {
  for (const row of [null,{eventType:'Corporate Event'},{eventType:'Birthday Party',reviewRequestPlan:{enabled:true}}]) {
    const f=fixture(row);
    await assert.rejects(enableBirthdayReviewSequence({bookingModel:f.model,bookingId:'booking'}));
    assert.equal(f.updates.length,0);
  }
});
test('a concurrent event or sequence change is rejected', async () => {
  const f=fixture({eventType:'Birthday Party'});
  f.model.findOneAndUpdate=()=>({lean:async()=>null});
  await assert.rejects(enableBirthdayReviewSequence({bookingModel:f.model,bookingId:'booking'}),error=>error.status===409);
});

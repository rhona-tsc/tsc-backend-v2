import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveVoicePilotCall } from '../services/voiceEnquiryPilotLimit.js';

test('pilot allowance survives handler restarts, refuses retries, expiry and storage failure', async () => {
  let document;
  const collection = {
    async updateOne(filter, update) { document ||= { _id: filter._id, ...update.$setOnInsert }; },
    async findOneAndUpdate(filter, update) {
      if (document.acceptedCalls >= filter.acceptedCalls.$lt || document.callHashes.includes(filter.callHashes.$ne)) return null;
      document.acceptedCalls += update.$inc.acceptedCalls;
      document.callHashes.push(update.$push.callHashes);
      return { ...document };
    },
  };
  const config = { collection, projectId: 'proj_test', endsAt: Date.now() + 3600000 };
  assert.equal(await reserveVoicePilotCall({ ...config, callSid: 'call1' }), true);
  assert.equal(await reserveVoicePilotCall({ ...config, callSid: 'call1' }), false);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => reserveVoicePilotCall({ ...config, callSid: `other${i}` })));
  assert.equal(results.filter(Boolean).length, 4);
  assert.equal(await reserveVoicePilotCall({ ...config, callSid: 'after-restart' }), false);
  assert.equal(await reserveVoicePilotCall({ ...config, endsAt: 1, callSid: 'expired' }), false);
  assert.equal(await reserveVoicePilotCall({ ...config, callSid: 'offline', collection: { updateOne: async () => { throw new Error('offline'); } } }), false);
  assert.equal(document.acceptedCalls, 5);
});

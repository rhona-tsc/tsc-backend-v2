import crypto from 'node:crypto';
import mongoose from 'mongoose';

export const VOICE_PILOT_MAX_CALLS = 5;

// One allowance per project, across restarts/replicas. Keep this meter after expiry.
export async function reserveVoicePilotCall({ projectId, callSid, endsAt, now = Date.now(), collection }) {
  if (!Number.isFinite(endsAt) || now >= endsAt || typeof callSid !== 'string' || !callSid || callSid.length > 80) return false;
  const meter = collection || mongoose.connection.db?.collection('voice_enquiry_pilot_limits');
  if (!meter) return false;
  const id = `pilot:${projectId}`;
  const hash = crypto.createHash('sha256').update(callSid).digest('hex');
  try {
    await meter.updateOne({ _id: id }, { $setOnInsert: { acceptedCalls: 0, callHashes: [] } }, { upsert: true, maxTimeMS: 3000 });
    const result = await meter.findOneAndUpdate({ _id: id, acceptedCalls: { $lt: VOICE_PILOT_MAX_CALLS }, callHashes: { $ne: hash } }, {
      $inc: { acceptedCalls: 1 }, $push: { callHashes: hash }, $set: { lastReservedAt: new Date(now), endsAt: new Date(endsAt) },
    }, { returnDocument: 'after', includeResultMetadata: false, maxTimeMS: 3000 });
    return !!result;
  } catch { return false; } // Fail closed when the allowance cannot be verified.
}

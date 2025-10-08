// backend/controllers/helpers.js
import OutboundQueue from "../models/outboundQueue.js";
import AvailabilityModel from "../models/availabilityModel.js";
import { sendWhatsAppMessage, sendSMSMessage, toE164 } from "../utils/twilioClient.js";

// In-process per-phone locks (sufficient for single instance / dev)
const phoneLocks = new Map(); // phone -> boolean (locked)

function addressShortOf(address = "") {
  return String(address || "")
    .split(",")
    .slice(-2)
    .join(",")
    .replace(/,\s*UK$/i, "")
    .trim();
}

/**
 * Enqueue a unique message per phone/kind/(actId+dateISO+addressShort).
 * Prevents duplicates when shortlist + addToCart both fire.
 * Now enforced at DB layer via `dedupeKey` unique index.
 */
export async function enqueueUnique({ phone, kind, payload }) {
  const e164 = toE164(phone);
  if (!e164 || !kind || !payload) {
    return { enqueued: false, skippedReason: "invalid" };
  }

  const { actId, dateISO } = payload || {};
  if (!actId || !dateISO) {
    return { enqueued: false, skippedReason: "missing_keys" };
  }

  const normalizedAddressShort =
    payload.addressShort || addressShortOf(payload.address || "");
  const dedupeKey = `${e164}|${kind}|${actId}|${dateISO}|${normalizedAddressShort}`;

  try {
    const doc = {
      phone: e164,
      kind,
      payload: { ...payload, addressShort: normalizedAddressShort },
      dedupeKey,
    };

    // Use upsert on dedupeKey to eliminate race duplicates
    const res = await OutboundQueue.updateOne(
      { dedupeKey },
      { $setOnInsert: doc },
      { upsert: true }
    );

    const enqueued =
      // If upserted, res.upsertedCount=1 (Mongoose 7+), or res.upsertedId present
      (res.upsertedCount && res.upsertedCount > 0) ||
      !!res.upsertedId ||
      // some drivers return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: ... }
      (res.matchedCount === 0 && res.modifiedCount === 0);

    if (!enqueued) {
      return { enqueued: false, skippedReason: "duplicate" };
    }

    console.log("[queue] enqueued", { phone: e164, kind, actId, dateISO, addressShort: normalizedAddressShort });
    return { enqueued: true };
  } catch (err) {
    // Any unique index conflict → duplicate
    if (err?.code === 11000) {
      return { enqueued: false, skippedReason: "duplicate" };
    }
    console.warn("[queue] enqueue error:", err?.message || err);
    return { enqueued: false, skippedReason: "error" };
  }
}

/**
 * Process next queued message for a phone (respects in-process lock).
 * Sends WA first, then SMS fallback, then removes the queue item.
 */
export async function kickQueue(phone) {
  const e164 = toE164(phone);
  if (!e164) return;
  if (phoneLocks.get(e164)) return; // already draining

  phoneLocks.set(e164, true);
  try {
    // FIFO by insertedAt
    let item = await OutboundQueue.findOne({ phone: e164 }).sort({ insertedAt: 1 }).lean();
    while (item) {
      const { kind, payload } = item;
      const { contentSid, variables, smsBody } = payload || {};

      // IMPORTANT: pass pre-built slot variables as `variables` (NOT templateParams)
      // Passing as templateParams would map named keys and blank out your "1..6" slots.
      console.log("[queue] sending", {
        phone: e164,
        kind,
        hasVars: !!variables && typeof variables === "object",
        hasSmsFallback: !!smsBody,
      });

      // try WA
      let waOk = false;
      try {
        await sendWhatsAppMessage({
          to: e164,
          variables,     // << correct field for slot-map "1".."6"
          contentSid,    // optional override
          smsBody,       // cached for potential status-based fallback (if you implement)
        });
        waOk = true;
      } catch (waErr) {
        console.warn("[queue] WA send failed; falling back to SMS:", waErr?.message || waErr);
      }

      if (!waOk && smsBody) {
        try {
          await sendSMSMessage(e164, smsBody);
        } catch (smsErr) {
          console.warn("[queue] SMS fallback failed:", smsErr?.message || smsErr);
        }
      }

      // Remove the item regardless (we attempted delivery)
      try {
        await OutboundQueue.deleteOne({ _id: item._id });
      } catch (delErr) {
        console.warn("[queue] delete item failed:", delErr?.message || delErr);
      }

      // Stamp last-outbound status on Availability row if keys exist
      if (payload?.actId && payload?.dateISO) {
        try {
          await AvailabilityModel.updateOne(
            { phone: e164, actId: payload.actId, dateISO: payload.dateISO, v2: true },
            { $set: { updatedAt: new Date(), status: waOk ? "sent" : "queued" } }
          );
        } catch {}
      }

      // fetch next
      item = await OutboundQueue.findOne({ phone: e164 }).sort({ insertedAt: 1 }).lean();
    }
  } finally {
    phoneLocks.delete(e164);
  }
}

/**
 * Release the lock for a phone (after inbound reply) and immediately
 * process the next queued message, if any.
 */
export async function releaseLockAndProcessNext(phone) {
  const e164 = toE164(phone);
  if (!e164) return;
  // ensure lock is cleared, then kick
  phoneLocks.delete(e164);
  await kickQueue(e164);
}
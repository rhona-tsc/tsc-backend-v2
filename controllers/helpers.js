// backend/controllers/helpers.js
import OutboundQueue from "../models/outboundQueue.js";
import AvailabilityModel from "../models/availabilityModel.js";
import { sendWhatsAppMessage, sendSMSMessage, toE164 } from "../utils/twilioClient.js";

// In-process per-phone locks (sufficient for single instance / dev)
const phoneLocks = new Map(); // phone -> boolean (locked)

/* -------------------------------------------------------------------------- */
/*                             addressShortOf                                 */
/* -------------------------------------------------------------------------- */
function addressShortOf(address = "") {
  console.log(`🐔 (controllers/helpers.js) addressShortOf called at`, new Date().toISOString(), { address });
  return String(address || "")
    .split(",")
    .slice(-2)
    .join(",")
    .replace(/,\s*UK$/i, "")
    .trim();
}

/* -------------------------------------------------------------------------- */
/*                             enqueueUnique                                  */
/* -------------------------------------------------------------------------- */
/**
 * Enqueue a unique message per phone/kind/(actId+dateISO+addressShort).
 * Prevents duplicates when shortlist + addToCart both fire.
 * Now enforced at DB layer via `dedupeKey` unique index.
 */
export async function enqueueUnique({ phone, kind, payload }) {
  console.log(`🐔 (controllers/helpers.js) enqueueUnique called at`, new Date().toISOString(), { phone, kind, hasPayload: !!payload });

  const e164 = toE164(phone);
  if (!e164 || !kind || !payload) {
    console.warn(`🐔 enqueueUnique skipped: invalid`, { e164, kind, payloadExists: !!payload });
    return { enqueued: false, skippedReason: "invalid" };
  }

  const { actId, dateISO } = payload || {};
  if (!actId || !dateISO) {
    console.warn(`🐔 enqueueUnique skipped: missing_keys`, { actId, dateISO });
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

    const res = await OutboundQueue.updateOne(
      { dedupeKey },
      { $setOnInsert: doc },
      { upsert: true }
    );

    const enqueued =
      (res.upsertedCount && res.upsertedCount > 0) ||
      !!res.upsertedId ||
      (res.matchedCount === 0 && res.modifiedCount === 0);

    if (!enqueued) {
      console.log(`🐔 enqueueUnique skipped: duplicate`, { phone: e164, kind, actId, dateISO });
      return { enqueued: false, skippedReason: "duplicate" };
    }

    console.log(`🐔 enqueueUnique success`, {
      phone: e164,
      kind,
      actId,
      dateISO,
      addressShort: normalizedAddressShort,
    });
    return { enqueued: true };
  } catch (err) {
    if (err?.code === 11000) {
      console.warn(`🐔 enqueueUnique duplicate key`, { dedupeKey });
      return { enqueued: false, skippedReason: "duplicate" };
    }
    console.warn(`🐔 enqueueUnique error`, err?.message || err);
    return { enqueued: false, skippedReason: "error" };
  }
}

/* -------------------------------------------------------------------------- */
/*                                  kickQueue                                 */
/* -------------------------------------------------------------------------- */
/**
 * Process next queued message for a phone (respects in-process lock).
 * Sends WA first, then SMS fallback, then removes the queue item.
 */
export async function kickQueue(phone) {
  console.log(`🐔 (controllers/helpers.js) kickQueue called at`, new Date().toISOString(), { phone });
  const e164 = toE164(phone);
  if (!e164) {
    console.warn(`🐔 kickQueue aborted: invalid phone`, { phone });
    return;
  }
  if (phoneLocks.get(e164)) {
    console.log(`🐔 kickQueue skipped: already locked`, { e164 });
    return;
  }

  phoneLocks.set(e164, true);
  try {
    let item = await OutboundQueue.findOne({ phone: e164 }).sort({ insertedAt: 1 }).lean();
    while (item) {
      console.log(`🐔 kickQueue processing item`, {
        e164,
        kind: item.kind,
        itemId: item._id?.toString?.(),
      });

      const { kind, payload } = item;
      const { contentSid, variables, smsBody } = payload || {};

      console.log(`🐔 kickQueue sending`, {
        phone: e164,
        kind,
        hasVars: !!variables && typeof variables === "object",
        hasSmsFallback: !!smsBody,
      });

      let waOk = false;
      try {
        await sendWhatsAppMessage({
          to: e164,
          variables,
          contentSid,
          smsBody,
        });
        waOk = true;
        console.log(`🐔 kickQueue WhatsApp sent`, { e164, kind });
      } catch (waErr) {
        console.warn(`🐔 kickQueue WA send failed; fallback to SMS`, waErr?.message || waErr);
      }

      if (!waOk && smsBody) {
        try {
          await sendSMSMessage(e164, smsBody);
          console.log(`🐔 kickQueue SMS fallback sent`, { e164 });
        } catch (smsErr) {
          console.warn(`🐔 kickQueue SMS fallback failed`, smsErr?.message || smsErr);
        }
      }

      try {
        await OutboundQueue.deleteOne({ _id: item._id });
        console.log(`🐔 kickQueue deleted queue item`, { id: item._id?.toString?.() });
      } catch (delErr) {
        console.warn(`🐔 kickQueue delete item failed`, delErr?.message || delErr);
      }

      if (payload?.actId && payload?.dateISO) {
        try {
          await AvailabilityModel.updateOne(
            { phone: e164, actId: payload.actId, dateISO: payload.dateISO, v2: true },
            { $set: { updatedAt: new Date(), status: waOk ? "sent" : "queued" } }
          );
          console.log(`🐔 kickQueue updated availability status`, {
            e164,
            status: waOk ? "sent" : "queued",
          });
        } catch (updateErr) {
          console.warn(`🐔 kickQueue failed to update availability`, updateErr?.message || updateErr);
        }
      }

      item = await OutboundQueue.findOne({ phone: e164 }).sort({ insertedAt: 1 }).lean();
    }
  } catch (err) {
    console.error(`🐔 kickQueue error`, err?.message || err);
  } finally {
    phoneLocks.delete(e164);
    console.log(`🐔 kickQueue released lock`, { e164 });
  }
}

/* -------------------------------------------------------------------------- */
/*                         releaseLockAndProcessNext                          */
/* -------------------------------------------------------------------------- */
/**
 * Release the lock for a phone (after inbound reply) and immediately
 * process the next queued message, if any.
 */
export async function releaseLockAndProcessNext(phone) {
  console.log(`🐔 (controllers/helpers.js) releaseLockAndProcessNext called at`, new Date().toISOString(), { phone });
  const e164 = toE164(phone);
  if (!e164) {
    console.warn(`🐔 releaseLockAndProcessNext aborted: invalid phone`, { phone });
    return;
  }

  phoneLocks.delete(e164);
  console.log(`🐔 releaseLockAndProcessNext lock cleared`, { e164 });

  await kickQueue(e164);
  console.log(`🐔 releaseLockAndProcessNext kicked queue`, { e164 });
}
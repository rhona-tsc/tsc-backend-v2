// backend/utils/twilioClient.js
import 'dotenv/config';
import Twilio from 'twilio';
import AvailabilityModel from "../models/availabilityModel.js";
import { computeFinalFeeForMember, formatNiceDate } from "../controllers/availabilityController.js";

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_API_KEY,
  TWILIO_WA_SENDER,
  TWILIO_SMS_FROM,
  TWILIO_MESSAGING_SERVICE_SID,
  TWILIO_ENQUIRY_SID,
  BACKEND_URL,
} = process.env;

// -------------------- Twilio client (lazy init, never crash app) --------------------
let _twilioClient = null;
function getTwilioClient() {
  console.log(`🩵 (utils/twilioClient.js) getTwilioClient START at ${new Date().toISOString()}`, {});
  if (_twilioClient) return _twilioClient;

  try {
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      _twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      return _twilioClient;
    }
    if (TWILIO_API_KEY && TWILIO_API_SECRET && TWILIO_ACCOUNT_SID) {
      _twilioClient = Twilio(TWILIO_API_KEY, TWILIO_API_SECRET, {
        accountSid: TWILIO_ACCOUNT_SID,
      });
      return _twilioClient;
    }
    console.warn("🔕 Twilio not configured (missing envs). SMS/WA features disabled.");
    return null;
  } catch (e) {
    console.warn("🔕 Twilio init error. Disabling Twilio. Reason:", e?.message || e);
    return null;
  }
}

// -------------------- Helpers --------------------
/** Normalize to E.164 (+44…) and strip any whatsapp: prefix */
export const toE164 = (raw = '') => {
  console.log(`🩵 (utils/twilioClient.js) toE164 START at ${new Date().toISOString()}`, {});
  let s = String(raw).replace(/^whatsapp:/i, '').replace(/\s+/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('07')) return s.replace(/^0/, '+44');
  if (s.startsWith('44')) return `+${s}`;
  return s;
};

/** Only send status callbacks when we have an HTTPS public URL */
const statusCallback =
  BACKEND_URL && /^https:\/\//i.test(BACKEND_URL)
    ? `${BACKEND_URL.replace(/\/$/, '')}/api/availability/twilio/status`
    : undefined;

// Short-lived cache so the status webhook can send SMS if WA is undelivered
export const WA_FALLBACK_CACHE = new Map(); // sid -> { to, smsBody }

// -------------------- Public API --------------------
/**
 * Send a WhatsApp message via Content Template.
 */
export async function sendWhatsAppMessage(opts = {}) {
  console.log(`🩵 sendWhatsAppMessage START at ${new Date().toISOString()}`);

  const client = getTwilioClient();
  if (!client) throw new Error("Twilio disabled");

  const {
    to,
    actData = null,
    lineup = null,
    member = null,
    address = "",
    dateISO = "",
    role = "",
    templateParams = {},
    variables = undefined,
    contentSid,
    smsBody = "",
  } = opts;

  const toE = toE164(to);
  const fromE = toE164(TWILIO_WA_SENDER || "");
  if (!toE || !fromE) throw new Error("Missing WA to/from");

  /* -------------------------------------------------------------------------- */
  /* 🧮 Calculate fee + format address and date                                 */
  /* -------------------------------------------------------------------------- */

  const shortAddress = address
    ? address.split(",").slice(0, 2).join(", ").trim()
    : "TBC";

  const formattedDate = dateISO ? formatNiceDate(dateISO) : "TBC";

  let formattedFee = "TBC";
  try {
   if (!opts.skipFeeCompute && actData && member && address && dateISO && lineup) {
  const feeValue = await computeFinalFeeForMember(
    actData,
    member,
    address,
    dateISO,
    lineup
  );
  formattedFee = `£${feeValue}`;
} else if (opts.finalFee) {
  formattedFee = `£${opts.finalFee}`;
}
  } catch (err) {
    console.warn("⚠️ Failed to compute final fee for member:", err.message);
  }

  // 🎭 Merge all into named content variables (for Twilio {{firstName}}, {{date}}, etc.)
  const enrichedVars = {
    firstName: member?.firstName || member?.name || "Musician",
    date: formattedDate,
    location: shortAddress,
    fee: formattedFee.replace(/[^0-9.]/g, ''),
    role: role || member?.instrument || "Musician",
    actName: actData?.tscName || actData?.name || "TSC Act",
  };

  console.log("📦 Enriched content variables:", enrichedVars);
  console.log("🟦 Using TWILIO_ENQUIRY_SID =", process.env.TWILIO_ENQUIRY_SID);

  /* -------------------------------------------------------------------------- */
  /* ✉️ Send via Twilio                                                        */
  /* -------------------------------------------------------------------------- */
  const payload = {
    from: `whatsapp:${fromE}`,
    to: `whatsapp:${toE}`,
    contentSid: contentSid || TWILIO_ENQUIRY_SID,
    contentVariables: JSON.stringify(enrichedVars),
    ...(statusCallback ? { statusCallback } : {}),
  };

  console.log("📤 Twilio WA create()", {
    to: payload.to,
    from: payload.from,
    contentSid: payload.contentSid,
    contentVariables: payload.contentVariables,
  });
  console.log("🟦 Final payload Content SID:", payload.contentSid);

  const msg = await client.messages.create(payload);

  /* -------------------------------------------------------------------------- */
  /* 💾 Fallback persist (unchanged)                                           */
  /* -------------------------------------------------------------------------- */
  try {
    const twilioSid = msg?.sid;
    const toE = toE164(to);
    if (twilioSid && toE && smsBody && !contentSid) {
      await AvailabilityModel.updateOne(
        { phone: toE, v2: true },
        {
          $set: {
            "outbound.sid": twilioSid,
            "outbound.smsBody": smsBody,
            updatedAt: new Date(),
          },
        }
      );
      WA_FALLBACK_CACHE.set(twilioSid, { to: toE, smsBody });
    }
  } catch (e) {
    console.warn("[twilio] failed to persist WA fallback arm:", e?.message || e);
  }

  return msg;
}

/**
 * Send a plain SMS (used for fallback or reminders).
 */
export const sendSMSMessage = async (to, body) => {
  console.log(`🩵 (utils/twilioClient.js) sendSMSMessage START at ${new Date().toISOString()}`, {});

  const client = getTwilioClient();
  if (!client) throw new Error("Twilio disabled");

  let dest = String(to || '').replace(/^whatsapp:/i, '').replace(/\s+/g, '');
  if (!dest.startsWith('+')) {
    if (dest.startsWith('07')) dest = dest.replace(/^0/, '+44');
    else if (dest.startsWith('44')) dest = `+${dest}`;
  }

  const payload = {
    to: dest,
    body: String(body || ''),
    ...(statusCallback ? { statusCallback } : {}),
    ...(process.env.TWILIO_MESSAGING_SERVICE_SID
      ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
      : { from: toE164(process.env.TWILIO_SMS_FROM || '') }),
  };

  console.log('📤 Twilio SMS create()', {
    to: payload.to,
    via: payload.messagingServiceSid ? 'service' : payload.from,
  });

  return client.messages.create(payload);
};

/**
 * Try WA first; if creation fails, fallback to SMS (requires smsBody).
 */
export async function sendWAOrSMS(opts = {}) {
  console.log(`🩵 (utils/twilioClient.js) sendWAOrSMS START at ${new Date().toISOString()}`, {});

  const { to, templateParams, variables, contentSid, smsBody = '' } = opts;

  try {
    const wa = await sendWhatsAppMessage({ to, templateParams, variables, contentSid, smsBody });
    return wa;
  } catch (err) {
    console.warn('⚠️ WA creation failed, falling back to SMS:', err?.message || err);
    if (!smsBody) throw new Error('SMS fallback requested but no smsBody provided');
    const sms = await sendSMSMessage(to, smsBody);
    return { sid: sms.sid, status: sms.status, channel: 'sms', to: toE164(to) };
  }
}

/**
 * Send a plain WhatsApp text (no template/content).
 */
export async function sendWhatsAppText(to, body) {
  console.log(`🩵 (utils/twilioClient.js) sendWhatsAppText START at ${new Date().toISOString()}`, {});

  const client = getTwilioClient();
  if (!client) throw new Error('Twilio disabled');

  const toE = toE164(to);
  const fromE = toE164(TWILIO_WA_SENDER || '');
  if (!toE || !fromE) throw new Error('Missing WA to/from');

  const payload = {
    from: `whatsapp:${fromE}`,
    to: `whatsapp:${toE}`,
    body: String(body || ''),
    ...(statusCallback ? { statusCallback } : {}),
  };

  console.log('📤 Twilio WA text create()', { to: payload.to });
  return client.messages.create(payload);
}

export default {
  sendWhatsAppMessage,
  sendSMSMessage,
  sendWAOrSMS,
  sendWhatsAppText,
  toE164,
};
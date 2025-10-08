// backend/utils/twilioClient.js
import 'dotenv/config';
import Twilio from 'twilio';
import AvailabilityModel from "../models/availabilityModel.js";

const {
  TWILIO_ACCOUNT_SID,            // ACxxxxxxxx...
  TWILIO_AUTH_TOKEN,             // (with AC path)
  TWILIO_API_KEY,                // SKxxxxxxxx... (optional alt path)
  TWILIO_API_SECRET,             // secret for SK
  TWILIO_WA_SENDER,
  TWILIO_SMS_FROM,
  TWILIO_MESSAGING_SERVICE_SID,
  TWILIO_CONTENT_SID,            // default WA template SID
  BACKEND_URL,
} = process.env;

// -------------------- Twilio client (lazy init, never crash app) --------------------
let _twilioClient = null;
function getTwilioClient() {
  if (_twilioClient) return _twilioClient;

  try {
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      _twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      return _twilioClient;
    }
    // API Key auth also requires the account SID
    if (TWILIO_API_KEY && TWILIO_API_SECRET && TWILIO_ACCOUNT_SID) {
      _twilioClient = Twilio(TWILIO_API_KEY, TWILIO_API_SECRET, {
        accountSid: TWILIO_ACCOUNT_SID,
      });
      return _twilioClient;
    }
    console.warn('🔕 Twilio not configured (missing envs). SMS/WA features disabled.');
    return null;
  } catch (e) {
    console.warn('🔕 Twilio init error. Disabling Twilio. Reason:', e?.message || e);
    return null;
  }
}

// -------------------- Helpers --------------------
/** Normalize to E.164 (+44…) and strip any whatsapp: prefix */
export const toE164 = (raw = '') => {
  let s = String(raw).replace(/^whatsapp:/i, '').replace(/\s+/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('07')) return s.replace(/^0/, '+44');
  if (s.startsWith('44')) return `+${s}`;
  return s; // assume already valid for your region if not UK
};

/** `whatsapp:+NN…` wrapper from E.164 (or raw) */
const toWhatsAppAddr = (raw = '') => `whatsapp:${toE164(raw)}`;

/** Only send status callbacks when we have an HTTPS public URL */
const statusCallback = (BACKEND_URL && /^https:\/\//i.test(BACKEND_URL))
  ? `${BACKEND_URL.replace(/\/$/, '')}/api/availability-v2/twilio/status`
  : undefined;

/**
 * Build a minimal, *exact* variables object for a 6-slot template.
 * Returns only "1".."6" keys; NO extra meta keys to avoid 21656.
 */
const buildVarsFromTemplateParams = (p = {}) => {
  const pickFee = p.Fee ?? p.fee ?? p.Rate ?? p.rate ?? '';
  let fee = '';
  if (pickFee !== undefined && pickFee !== null) {
    let f = String(pickFee).trim();
    if (!['tbc', 'undefined', 'null'].includes(f.toLowerCase())) {
      f = f.replace(/^\s*[£$]/, '').replace(/,/g, '');
      fee = f;
    } else {
      fee = f.toUpperCase();
    }
  }

  return {
    '1': String(p.FirstName ?? ''),
    '2': String(p.FormattedDate ?? ''),
    '3': String(p.FormattedAddress ?? ''),
    '4': String(fee ?? ''),
    '5': String(p.Duties ?? ''),
    '6': String(p.ActName ?? ''),
  };
};

/**
 * Ensure we send *only* the keys the template expects.
 * If caller passes `variables`, we trust it *as-is* (after stringifying non-null values).
 * Otherwise we derive the standard 6-slot map from `templateParams`.
 */
const makeContentVariables = ({ variables, templateParams } = {}) => {
  let obj;
  if (variables && typeof variables === 'object') {
    obj = {};
    for (const [k, v] of Object.entries(variables)) {
      if (v !== undefined && v !== null) obj[String(k)] = String(v);
    }
  } else {
    obj = buildVarsFromTemplateParams(templateParams);
  }
  return JSON.stringify(obj);
};

// Short-lived cache so the status webhook can send SMS if WA is undelivered
export const WA_FALLBACK_CACHE = new Map(); // sid -> { to, smsBody }

// -------------------- Public API --------------------
/**
 * Send a WhatsApp message via Content Template.
 */
export async function sendWhatsAppMessage(opts = {}) {
  const client = getTwilioClient();
  if (!client) throw new Error('Twilio disabled');

  const {
    to,
    templateParams = {},
    variables = undefined,
    contentSid,
    smsBody = '',
  } = opts;

  const toE = toE164(to);
  const fromE = toE164(TWILIO_WA_SENDER || '');
  if (!toE || !fromE) throw new Error('Missing WA to/from');

  const payload = {
    from: `whatsapp:${fromE}`,
    to: `whatsapp:${toE}`,
    contentSid: contentSid || TWILIO_CONTENT_SID,
    contentVariables: makeContentVariables({ variables, templateParams }),
    ...(statusCallback ? { statusCallback } : {}),
  };

  console.log('📤 Twilio WA create()', {
    to: payload.to,
    from: payload.from,
    contentSid: payload.contentSid,
    contentVariables: payload.contentVariables,
  });

  const msg = await client.messages.create(payload);

  // 👉 Arm fallback
  try {
    const twilioSid = msg?.sid;
    const toE = toE164(to);
    if (twilioSid && toE && smsBody) {
      await AvailabilityModel.updateOne(
        { phone: toE, v2: true },
        { $set: { "outbound.sid": twilioSid, "outbound.smsBody": smsBody, updatedAt: new Date() } }
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
export async function sendSMSMessage(to, body) {
  const client = getTwilioClient();
  if (!client) throw new Error('Twilio disabled');

  const toE = toE164(to);
  if (!toE) throw new Error('Bad SMS destination');

  const payload = {
    to: toE,
    body: String(body || ''),
    ...(statusCallback ? { statusCallback } : {}),
  };

  if (TWILIO_MESSAGING_SERVICE_SID) {
    payload.messagingServiceSid = TWILIO_MESSAGING_SERVICE_SID;
  } else if (TWILIO_SMS_FROM) {
    payload.from = toE164(TWILIO_SMS_FROM);
  } else {
    throw new Error('No SMS sender configured');
  }

  console.log('📤 Twilio SMS create()', {
    to: payload.to,
    via: payload.messagingServiceSid ? 'service' : payload.from,
  });

  const msg = await client.messages.create(payload);
  return msg; // { sid, status, ... }
}

/**
 * Try WA first; if creation fails, fallback to SMS (requires smsBody).
 */
export async function sendWAOrSMS(opts = {}) {
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
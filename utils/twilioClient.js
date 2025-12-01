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
/* ========================================================================== */
/* 💬 sendWhatsAppMessage                                                      */
/* ========================================================================== */
export async function sendWhatsAppMessage(opts = {}) {
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
    templateParams = {}, // unused here; kept for compatibility
    variables = undefined, // preferred input for Twilio variables
    contentSid,
    smsBody = "",
    finalFee,            // optional: if you want to pass a computed fee directly
    skipFeeCompute = false,
  } = opts;

  const toE = toE164(to);
  const fromE = toE164(TWILIO_WA_SENDER || "");
  if (!toE || !fromE) throw new Error("Missing WA to/from");

  const shortAddress = address
    ? address.split(",").slice(0, 2).join(", ").trim()
    : "TBC";

  const formattedDate = dateISO ? formatNiceDate(dateISO) : "TBC";

  // Determine fee string
  let formattedFee = "TBC";
  if (variables?.fee) {
    formattedFee = variables.fee; // trust upstream
  } else if (finalFee != null) {
    formattedFee = `£${finalFee}`;
  } else if (!skipFeeCompute && actData && member && address && dateISO && lineup) {
    try {
      const feeValue = await computeFinalFeeForMember(actData, member, address, dateISO, lineup);
      formattedFee = `£${feeValue}`;
      console.log("🧮 [sendWhatsAppMessage] Computed fallback fee", { formattedFee });
    } catch (err) {
      console.warn("⚠️ [sendWhatsAppMessage] Fee compute failed:", err?.message);
    }
  }
    // ── name helpers (drop these in once, before any usage of firstLast) ───────────
const firstLast = (nameLike) => {
  const s = (nameLike ?? "").toString().trim();
  if (!s) return { first: "", last: "", firstName: "", lastName: "", displayName: "" };
  const parts = s.split(/\s+/);
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return { first, last, firstName: first, lastName: last, displayName: s };
};

const logIdentity = (label, obj = {}) => {
  const firstName =
    obj.firstName ||
    obj.fn ||
    obj.givenName ||
    obj.selectedVocalistName?.split?.(" ")?.[0] ||
    "";
  const lastName =
    obj.lastName ||
    obj.ln ||
    obj.familyName ||
    (obj.selectedVocalistName?.includes?.(" ")
      ? obj.selectedVocalistName.split(" ").slice(1).join(" ")
      : "") ||
    "";
  const displayName =
    obj.displayName ||
    obj.musicianName ||
    obj.resolvedName ||
    `${firstName} ${lastName}`.trim();
  const vocalistDisplayName =
    obj.vocalistDisplayName ||
    obj.vocalistName ||
    obj.selectedVocalistName ||
    displayName;

  console.log(`👤 ${label}`, {
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    displayName: displayName || undefined,
    vocalistDisplayName: vocalistDisplayName || undefined,
    address: obj.address || undefined,
    formattedAddress: obj.formattedAddress || undefined,
    profileUrl: obj.profileUrl || obj.tscProfileUrl || undefined,
    photoUrl:
      obj.photoUrl ||
      obj.profilePicture ||
      obj.profilePhoto ||
      obj.imageUrl ||
      undefined,
    isDeputy: Boolean(obj.isDeputy),
    slotIndex: obj.slotIndex ?? undefined,
    musicianId: obj.musicianId ? String(obj.musicianId) : undefined,
    phone: obj.phone || obj.phoneNormalized || undefined,
    reply: obj.reply || obj.state || undefined,
  });
};


 const displayNameOf = (p = {}, log = true, label = "displayNameOf") => {
  const fn = (p.firstName || p.name || "").trim();
  const ln = (p.lastName || "").trim();
  const dn = (fn && ln) ? `${fn} ${ln}` : (fn || ln || "");
  if (log) {
    logIdentity(label, { ...p, displayName: dn });
  }
  return dn;
};


function pickPic(mus) {
  const url =
    mus?.profilePicture ||
    mus?.musicianProfileImage ||
    mus?.profileImage ||
    mus?.photoUrl ||
    mus?.imageUrl ||
    "";
  return (typeof url === "string" && url.trim().startsWith("http")) ? url.trim() : "";
}
const buildProfileUrl = (id) =>
  id ? `${PUBLIC_SITE_BASE}/musician/${id}` : "";


  const memberNames = firstLast(member || {});
  const memberDisplayName = displayNameOf(member || {});
  const memberPhotoUrl = pickPic(member || {});
  const memberProfileUrl = buildProfileUrl(member?._id || member?.musicianId);

  // Attempt to infer deputy flag from member
  const isDeputy =
    (member && (member.isDeputy === true || member?.role === "deputy")) ||
    (typeof opts.isDeputy === "boolean" ? opts.isDeputy : undefined);

  const enrichedVars = {
    firstName: member?.firstName || member?.name || "Musician",
    date: formattedDate,
    location: shortAddress,
    fee: String(formattedFee).replace(/[^0-9.]/g, ""), // Twilio expects raw number
    role: role || member?.instrument || "Musician",
    actName: actData?.tscName || actData?.name || "TSC Act",
  };

  console.log("📨 [sendWhatsAppMessage] PRE-SEND", {
    to: toE,
    from: fromE,
    actName: actData?.tscName || actData?.name || "",
    lineupId: lineup?._id || lineup?.lineupId || null,
    address,
    formattedAddress: opts.formattedAddress || null, // if caller passed it
    dateISO,
    ...memberNames,
    displayName: memberDisplayName,
    vocalistDisplayName: memberDisplayName,
    profileUrl: memberProfileUrl,
    photoUrl: memberPhotoUrl,
    isDeputy,
    variables: enrichedVars,
    contentSid: contentSid || TWILIO_ENQUIRY_SID,
  });

  const payload = {
    from: `whatsapp:${fromE}`,
    to: `whatsapp:${toE}`,
    contentSid: contentSid || TWILIO_ENQUIRY_SID,
    contentVariables: JSON.stringify(enrichedVars),
    ...(statusCallback ? { statusCallback } : {}),
  };

  const msg = await client.messages.create(payload);

  console.log("✅ [sendWhatsAppMessage] SENT", {
    sid: msg?.sid,
    status: msg?.status,
    to: toE,
  });

  // Persist fallback SMS body if relevant
  try {
    const twilioSid = msg?.sid;
    const dest = toE164(to);
    if (twilioSid && dest && smsBody && !contentSid) {
      await AvailabilityModel.updateOne(
        { phone: dest, v2: true },
        {
          $set: {
            "outbound.sid": twilioSid,
            "outbound.smsBody": smsBody,
            updatedAt: new Date(),
          },
        }
      );
      WA_FALLBACK_CACHE.set(twilioSid, { to: dest, smsBody });
      console.log("💾 [sendWhatsAppMessage] Fallback persisted", { twilioSid });
    }
  } catch (e) {
    console.warn("[sendWhatsAppMessage] Persist fallback failed:", e?.message || e);
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

  return client.messages.create(payload);
}

export default {
  sendWhatsAppMessage,
  sendSMSMessage,
  sendWAOrSMS,
  sendWhatsAppText,
  toE164,
};
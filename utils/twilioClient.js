// backend/utils/twilioClient.js
import "dotenv/config";
import Twilio from "twilio";
import AvailabilityModel from "../models/availabilityModel.js";
import {
  computeFinalFeeForMember,
  formatNiceDate,
} from "../controllers/availabilityController.js";

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_API_KEY,
  TWILIO_API_SECRET,
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
    console.warn(
      "🔕 Twilio not configured (missing envs). SMS/WA features disabled."
    );
    return null;
  } catch (e) {
    console.warn(
      "🔕 Twilio init error. Disabling Twilio. Reason:",
      e?.message || e
    );
    return null;
  }
}

// -------------------- Helpers --------------------
/** Normalize to E.164 (+44…) and strip any whatsapp: prefix */
export const toE164 = (raw = "") => {
  let s = String(raw)
    .replace(/^whatsapp:/i, "")
    .replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
};

/** Only send status callbacks when we have an HTTPS public URL */
const statusCallback =
  BACKEND_URL && /^https:\/\//i.test(BACKEND_URL)
    ? `${BACKEND_URL.replace(/\/$/, "")}/api/availability/twilio/status`
    : undefined;

// Short-lived cache so the status webhook can send SMS if WA is undelivered
export const WA_FALLBACK_CACHE = new Map(); // sid -> { to, smsBody }

export async function sendWhatsAppMessage(opts = {}) {
  const client = getTwilioClient();
  if (!client) throw new Error("Twilio disabled");

  const statusCallback =
    process.env.TWILIO_STATUS_CALLBACK_URL ||
    `${process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL}/api/twilio/status`;

  const {
    to,
    actData = null,
    lineup = null,
    member = null,
    address = "",
    dateISO = "",
    role = "",
    templateParams = {},              // kept for compatibility
    variables = undefined,            // preferred input for Twilio variables
    contentSid,                       // optional override (defaults to TWILIO_ENQUIRY_SID if set)
    smsBody = "",
    finalFee,                         // optional: pass a computed fee directly
    skipFeeCompute = false,

    // 🔗 Correlation + interactive buttons (NEW)
    requestId = null,                 // e.g. "7F3K9QX"
    buttons = null,                   // [{ id, title }, ...]
    isDeputy: isDeputyFromOpts,       // allow explicit override
  } = opts;

  // E.164 helpers
  const toE = toE164(to);
  const fromE = toE164(
    ((typeof TWILIO_WA_SENDER !== "undefined" && TWILIO_WA_SENDER) ||
      process.env.TWILIO_WA_SENDER ||
      "")
  );
  if (!toE || !fromE) throw new Error("Missing WA to/from");

  const shortAddress = address ? address.split(",").slice(0, 2).join(", ").trim() : "TBC";
  const formattedDate = dateISO ? formatNiceDate(dateISO) : "TBC";

  // ── fee string ────────────────────────────────────────────────────────────────
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

  // ── name / identity helpers ──────────────────────────────────────────────────
  const firstLast = (nameLike) => {
    const s = (nameLike ?? "").toString().trim();
    if (!s) return { first: "", last: "", firstName: "", lastName: "", displayName: "" };
    const parts = s.split(/\s+/);
    const first = parts[0] || "";
    const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
    return { first, last, firstName: first, lastName: last, displayName: s };
  };

  const getFirstName = (person = {}) =>
    String(
      person?.firstName ||
      person?.firstname ||
      person?.basicInfo?.firstName ||
      person?.name ||
      ""
    )
      .trim()
      .split(/\s+/)[0] || "there";

  const getLastName = (person = {}) =>
    String(
      person?.lastName ||
      person?.lastname ||
      person?.basicInfo?.lastName ||
      ""
    ).trim();

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
      obj.vocalistDisplayName || obj.vocalistName || obj.selectedVocalistName || displayName;

    console.log(`👤 ${label}`, {
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      displayName: displayName || undefined,
      vocalistDisplayName: vocalistDisplayName || undefined,
      address: obj.address || undefined,
      formattedAddress: obj.formattedAddress || undefined,
      profileUrl: obj.profileUrl || obj.tscProfileUrl || undefined,
      photoUrl:
        obj.photoUrl || obj.profilePicture || obj.profilePhoto || obj.imageUrl || undefined,
      isDeputy: Boolean(obj.isDeputy),
      slotIndex: obj.slotIndex ?? undefined,
      musicianId: obj.musicianId ? String(obj.musicianId) : undefined,
      phone: obj.phone || obj.phoneNormalized || undefined,
      reply: obj.reply || obj.state || undefined,
    });
  };

  const displayNameOf = (p = {}, log = true, label = "displayNameOf") => {
    const fn = getFirstName(p);
    const ln = getLastName(p);
    const dn = [fn === "there" ? "" : fn, ln].filter(Boolean).join(" ") || String(p?.name || "").trim();
    if (log) logIdentity(label, { ...p, displayName: dn });
    return dn;
  };

  function pickPic(mus) {
    const url =
      mus?.profilePhoto ||
      mus?.profilePicture ||
      mus?.musicianProfileImage ||
      mus?.profileImage ||
      mus?.photoUrl ||
      mus?.imageUrl ||
      "";
    return typeof url === "string" && url.trim().startsWith("http") ? url.trim() : "";
  }

  const PUBLIC_SITE_BASE = (
    process.env.PUBLIC_SITE_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5174"
  ).replace(/\/$/, "");
  const buildProfileUrl = (musicianLike) => {
    if (!musicianLike) return "";

    if (typeof musicianLike === "string") {
      const raw = musicianLike.trim();
      return raw ? `${PUBLIC_SITE_BASE}/musician/${raw}` : "";
    }

    const slug = String(musicianLike?.musicianSlug || "").trim();
    const id = String(
      musicianLike?._id || musicianLike?.musicianId || ""
    ).trim();

    if (slug) return `${PUBLIC_SITE_BASE}/musician/${slug}`;
    if (id) return `${PUBLIC_SITE_BASE}/musician/${id}`;
    return "";
  };

const memberDisplayName = displayNameOf(member || {}, false);
const memberNames = firstLast(memberDisplayName);
  const memberPhotoUrl = pickPic(member || {});
  const memberProfileUrl = buildProfileUrl(member);

  const isDeputy =
    (member && (member.isDeputy === true || member?.role === "deputy")) ||
    (typeof isDeputyFromOpts === "boolean" ? isDeputyFromOpts : undefined);

  // Prefer caller-provided location (from triggerAvailabilityRequest) → county + postcode
  const effectiveLocation = (variables && variables.location) || shortAddress;
  console.log("📨 [sendWhatsAppMessage] location going to Content", {
    effectiveLocation,
    fromVariables: Boolean(variables?.location),
    computedShort: shortAddress,
    addressRaw: address,
  });

  const resolvedFirstName = getFirstName(member);

  let enrichedVars = {
    firstName: resolvedFirstName,
    date: formattedDate,
    location: effectiveLocation,
    fee: String(formattedFee).replace(/[^0-9.]/g, ""),
    role: role || member?.instrument || "Musician",
    actName: actData?.tscName || actData?.name || "TSC Act",
    ...(variables || {}),
  };
  enrichedVars.firstName = String(enrichedVars.firstName || resolvedFirstName || "there").trim() || "there";
  enrichedVars.fee = String(enrichedVars.fee ?? "").replace(/[^0-9.]/g, "");

  // add correlation variables so templates can show them
  const requestCode = requestId ? `#${requestId}` : "";
  enrichedVars = {
    ...enrichedVars,
    requestId: requestId || "",
    requestCode,
  };

  // REQUIRED for Quick Reply button IDs (YES{{7}} etc.)
  if (requestId) {
    enrichedVars["7"] = requestId;
  }

  console.log("📨 [sendWhatsAppMessage] PRE-SEND", {
    to: toE,
    from: fromE,
    actName: actData?.tscName || actData?.name || "",
    lineupId: lineup?._id || lineup?.lineupId || null,
    address,
    formattedAddress: opts.formattedAddress || null,
    dateISO,
    ...memberNames,
    displayName: memberDisplayName,
    vocalistDisplayName: memberDisplayName,
    profileUrl: memberProfileUrl,
    photoUrl: memberPhotoUrl,
    isDeputy,
    variables: enrichedVars,
    contentSid: contentSid || (typeof TWILIO_ENQUIRY_SID !== "undefined" ? TWILIO_ENQUIRY_SID : undefined),
    requestId,
    buttonsCount: Array.isArray(buttons) ? buttons.length : 0,
  });

  /* ────────────────────────────────────────────────────────────────────────────
   * ⬇️ SEND VIA TWILIO, THEN PERSIST outboundSid FOR INBOUND MATCHING
   * ──────────────────────────────────────────────────────────────────────────── */
  const useContent = !!(
    (contentSid || process.env.TWILIO_ENQUIRY_SID) &&
    (!buttons || buttons.length === 0 || requestId)
  );
  let result = null;

  try {
    if (useContent) {
      // ✅ Preferred: Content API with variables (supports quick replies)
      result = await client.messages.create({
        to: `whatsapp:${toE}`,
        from: `whatsapp:${fromE}`,
        contentSid: contentSid || process.env.TWILIO_ENQUIRY_SID,
        contentVariables: JSON.stringify(enrichedVars),
        statusCallback,
      });
    } else {
      // Fallback plain text (no template)
      const defaultBody =
        smsBody && smsBody.trim()
          ? smsBody.trim()
          : `Are you available for ${actData?.tscName || actData?.name || "this act"} on ${formattedDate} at ${effectiveLocation}? Reply YES or UNAVAILABLE ${requestCode}`;
      result = await client.messages.create({
        to: `whatsapp:${toE}`,
        from: `whatsapp:${fromE}`,
        body: defaultBody,
        statusCallback,
      });
    }

    const sid = result?.sid;
    console.log("✅ [sendWhatsAppMessage] Twilio sent", { sid, useContent });

    // ⛳️ PERSIST THE OUTBOUND SID FOR DETERMINISTIC INBOUND MATCHING
    if (sid && requestId) {
      await AvailabilityModel.updateOne(
        { requestId },
        { $set: { outboundSid: sid } }
      );
      console.log("🧷 [sendWhatsAppMessage] outboundSid stored on Availability row", {
        requestId,
        outboundSid: sid,
      });
    }
  } catch (err) {
    console.error("❌ [sendWhatsAppMessage] Twilio send failed:", err?.message || err);
    throw err;
  }

  return result;
}

/**
 * Send a plain SMS (used for fallback or reminders).
 */
export const sendDeputyAllocationWhatsApp = async ({
  to,
  job,
  musician,
}) => {
  const formattedDate = job?.eventDate
    ? formatNiceDate(job.eventDate)
    : "TBC";

  const locationParts = [
    job?.venue || job?.locationName || "",
    job?.county || "",
    job?.postcode || "",
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  const location = locationParts.length
    ? Array.from(new Set(locationParts)).join(", ")
    : job?.location || "Location TBC";

  const fee = String(Number(job?.fee || 0) || "");
  const firstName =
    musician?.firstName ||
    musician?.firstname ||
    musician?.basicInfo?.firstName ||
    musician?.name ||
    "there";

  const roleLabel =
    job?.instrument ||
    "Deputy";

  const actName =
    job?.title ||
    job?.instrument ||
    "Deputy opportunity";

  const smsBody = [
    `Hi ${firstName},`,
    `You've been selected for a booking on ${formattedDate} in ${location} for the role of ${roleLabel} for the job titled \"${actName}\", at a fee of £${fee || "TBC"}.`,
    "As you applied for this gig, please confirm whether you'd like to accept the booking.",
    "🤍 TSC",
  ].join("\n");

  const allocationContentSid = String(
  process.env.TWILIO_JOB_ALLOCATION_REQUEST_SID || ""
).trim();

if (!allocationContentSid) {
  throw new Error("Missing TWILIO_JOB_ALLOCATION_REQUEST_SID");
}

return sendWhatsAppMessage({
  to,
  member: musician,
  dateISO: job?.eventDate || "",
  address: location,
  role: roleLabel,
  finalFee: Number(job?.fee || 0),
  skipFeeCompute: true,
  smsBody: smsBody,
  contentSid: allocationContentSid,
  allowContentSidFallback: false,
  variables: {
    "1": String(firstName || "there").trim() || "there",
    "2": formattedDate,
    "3": location,
    "4": roleLabel,
    "5": actName,
    "6": fee || "TBC",
    firstName: String(firstName || "there").trim() || "there",
    date: formattedDate,
    location,
    role: roleLabel,
    actName,
    fee: fee || "TBC",
  },
});
};

export const sendDeputyAllocationDeclinedWhatsApp = async ({
  to,
  job,
  musician,
}) => {
  const formattedDate = job?.eventDate
    ? formatNiceDate(job.eventDate)
    : "TBC";

  const location =
    job?.venue ||
    job?.locationName ||
    job?.location ||
    "Location TBC";

  const fee = String(Number(job?.fee || 0) || "");
  const firstName =
    musician?.firstName ||
    musician?.firstname ||
    musician?.basicInfo?.firstName ||
    musician?.name ||
    "there";

  const actName =
    job?.title ||
    job?.instrument ||
    "Deputy opportunity";

  const body = [
    `Hi ${firstName},`,
    `Thanks for letting us know. We have marked you as declined for ${actName}.`,
    `Date: ${formattedDate}`,
    `Location: ${location}`,
    fee ? `Fee: £${fee}` : "Fee: TBC",
    "No problem at all — we’ll move on to the next available deputy.",
  ].join("\n");

  return sendWhatsAppText(to, body);
};

export const sendSMSMessage = async (to, body) => {
  console.log(
    `🩵 (utils/twilioClient.js) sendSMSMessage START at ${new Date().toISOString()}`,
    {}
  );

  const client = getTwilioClient();
  if (!client) throw new Error("Twilio disabled");

  let dest = String(to || "")
    .replace(/^whatsapp:/i, "")
    .replace(/\s+/g, "");
  if (!dest.startsWith("+")) {
    if (dest.startsWith("07")) dest = dest.replace(/^0/, "+44");
    else if (dest.startsWith("44")) dest = `+${dest}`;
  }

  const payload = {
    to: dest,
    body: String(body || ""),
    ...(statusCallback ? { statusCallback } : {}),
    ...(process.env.TWILIO_MESSAGING_SERVICE_SID
      ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
      : { from: toE164(process.env.TWILIO_SMS_FROM || "") }),
  };

  console.log("📤 Twilio SMS create()", {
    to: payload.to,
    via: payload.messagingServiceSid ? "service" : payload.from,
  });

  return client.messages.create(payload);
};



/**
 * Send a plain WhatsApp text (no template/content).
 */
export async function sendWhatsAppText(to, body) {
  const client = getTwilioClient();
  if (!client) throw new Error("Twilio disabled");

  const toE = toE164(to);
  const fromE = toE164(TWILIO_WA_SENDER || "");
  if (!toE || !fromE) throw new Error("Missing WA to/from");

  const payload = {
    from: `whatsapp:${fromE}`,
    to: `whatsapp:${toE}`,
    body: String(body || ""),
    ...(statusCallback ? { statusCallback } : {}),
  };

  return client.messages.create(payload);
}

export default {
  sendWhatsAppMessage,
  sendDeputyAllocationWhatsApp,
  sendDeputyAllocationDeclinedWhatsApp,
  sendSMSMessage,
  sendWhatsAppText,
  toE164,
};

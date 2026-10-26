// backend/utils/twilioClient.js
import "dotenv/config";
import Twilio from "twilio";
import AvailabilityModel from "../models/availabilityModel.js";
import TwilioMessageDelivery from "../models/twilioMessageDeliveryModel.js";
import sendEmail from "./sendEmail.js";
import { validateOpportunityDetails } from "./outboundOpportunityValidation.js";
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
// Public site base (for profile links in messages)
const PUBLIC_SITE_BASE = (
  process.env.PUBLIC_SITE_URL ||
  process.env.FRONTEND_URL ||
  "http://localhost:5174"
).replace(/\/$/, "");

// Build a public musician profile URL (accepts musician doc or id/slug string)
const buildProfileUrl = (musicianLike) => {
  if (!musicianLike) return "";

  if (typeof musicianLike === "string") {
    const raw = musicianLike.trim();
    return raw ? `${PUBLIC_SITE_BASE}/musician/${raw}` : "";
  }

  const slug = String(musicianLike?.musicianSlug || "").trim();
  const id = String(musicianLike?._id || musicianLike?.musicianId || "").trim();

  if (slug) return `${PUBLIC_SITE_BASE}/musician/${slug}`;
  if (id) return `${PUBLIC_SITE_BASE}/musician/${id}`;
  return "";
};
/** Normalize to E.164 (+44…) and strip any whatsapp: prefix */
export const toE164 = (raw = "") => {
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  let s = String(raw)
    .replace(/^whatsapp:/i, "")
    .replace(/[\s()-]+/g, "");
  if (!s) return "";
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("07")) s = s.replace(/^0/, "+44");
  else if (s.startsWith("44")) s = `+${s}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : "";
};

/**
 * Read the Twilio message history for one phone number. This is used by the
 * admin Messages screen to recover older outbound messages which pre-date our
 * local message logging.
 */
export async function fetchTwilioConversation(phone, { limit = 250 } = {}) {
  const client = getTwilioClient();
  if (!client) throw new Error("Twilio disabled");

  const person = toE164(phone);
  if (!person) return [];

  const addresses = [person, `whatsapp:${person}`];
  const queries = addresses.flatMap((address) => [
    client.messages.list({ to: address, limit }),
    client.messages.list({ from: address, limit }),
  ]);

  const results = await Promise.allSettled(queries);
  const bySid = new Map();

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const message of result.value || []) {
      if (!message?.sid || bySid.has(message.sid)) continue;

      const from = String(message.from || "");
      const to = String(message.to || "");
      const fromPerson = toE164(from) === person;
      const channel = /^whatsapp:/i.test(from) || /^whatsapp:/i.test(to)
        ? "whatsapp"
        : "sms";

      bySid.set(message.sid, {
        _id: `twilio-${message.sid}`,
        sid: message.sid,
        senderRole: fromPerson ? "musician" : "agent",
        senderName: fromPerson ? "Musician" : "System",
        body: String(message.body || "").trim() || "WhatsApp template message",
        channel,
        status: message.status || "",
        createdAt: message.dateSent || message.dateCreated || new Date(),
        source: "twilio-history",
      });
    }
  }

  return Array.from(bySid.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

/** Only send status callbacks when we have an HTTPS public URL */
const statusCallback =
  BACKEND_URL && /^https:\/\//i.test(BACKEND_URL)
    ? `${BACKEND_URL.replace(/\/$/, "")}/api/availability/twilio/status`
    : undefined;

const deliveryFailureEmail = () =>
  String(
    process.env.WHATSAPP_FAILURE_EMAIL ||
      process.env.ALLOCATION_FAILURE_EMAIL ||
      process.env.ADMIN_EMAIL ||
      "rhona@thesupremecollective.co.uk",
  ).trim();

const defaultFailureEmail = ({ to, source = "whatsapp-message", body = "" } = {}) => ({
  to: deliveryFailureEmail(),
  subject: `WhatsApp delivery failed — ${source}`,
  text: [
    "A WhatsApp message could not be delivered. No SMS fallback was sent.",
    `Recipient: ${toE164(to) || "Not recorded"}`,
    `Message type: ${source}`,
    body ? `Message: ${body}` : "",
  ].filter(Boolean).join("\n"),
});

async function alertImmediateWhatsAppFailure({ failureEmail, error }) {
  const alert = failureEmail || {};
  if (!alert.to) return;
  try {
    await sendEmail({
      to: alert.to,
      subject: alert.subject || "WhatsApp send failed — no SMS was sent",
      text: [
        alert.text || "A WhatsApp message could not be sent. No SMS fallback was sent.",
        `Immediate error: ${error?.message || error || "Unknown error"}`,
      ].join("\n\n"),
    });
  } catch (emailError) {
    console.warn("WhatsApp failure alert email could not be sent:", emailError?.message || emailError);
  }
}

async function rememberWhatsAppDelivery({
  messageSid,
  to,
  smsBody,
  allowSmsFallback: _allowSmsFallback = false,
  failureEmail = null,
  status = "queued",
  source = "",
}) {
  const sid = String(messageSid || "").trim();
  const destination = toE164(to);
  const fallbackBody = String(smsBody || "").trim();
  if (!sid || !destination) return;

  const failureEmailTo = String(failureEmail?.to || "").trim();
  // SMS fallbacks are deliberately disabled. A WhatsApp failure is recorded
  // and emailed to the admin instead of sending different copy on another
  // channel.
  const smsFallbackRequired = false;

  try {
    await TwilioMessageDelivery.findOneAndUpdate(
      { messageSid: sid },
      {
        $set: {
          to: destination,
          channel: "whatsapp",
          body: fallbackBody,
          source,
          status: String(status || "queued"),
          smsFallbackStatus: smsFallbackRequired ? "pending" : "not_required",
          failureEmailTo,
          failureEmailSubject: String(failureEmail?.subject || "").trim(),
          failureEmailText: String(failureEmail?.text || "").trim(),
          failureEmailStatus: failureEmailTo ? "pending" : "not_required",
          expiresAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    // Delivery logging must never turn a successful Twilio send into a failure.
    console.warn("Twilio delivery record could not be stored:", error?.message || error);
  }
}

export async function sendWhatsAppMessage(opts = {}) {
  const client = getTwilioClient();
  if (!client) throw new Error("Twilio disabled");

  const callbackBase = String(
    process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || "",
  ).replace(/\/$/, "");
  const configuredCallback = String(
    process.env.TWILIO_STATUS_CALLBACK_URL || "",
  ).trim();
  const deliveryStatusCallback = /^https:\/\//i.test(configuredCallback)
    ? configuredCallback
    : /^https:\/\//i.test(callbackBase)
      ? `${callbackBase}/api/twilio/status`
      : statusCallback;

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
    allowSmsFallback = false,
    failureEmail = null,
    source = "whatsapp-template",
    requireTemplate = true,
    allowDefaultContentSid = true,
    requireOpportunityDetails = false,
    opportunityDetails = null,

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

  const selectedContentSid =
    contentSid || (allowDefaultContentSid ? process.env.TWILIO_ENQUIRY_SID : "");
  const resolvedFailureEmail =
    failureEmail || defaultFailureEmail({ to: toE, source, body: smsBody });

  if (requireOpportunityDetails) {
    try {
      validateOpportunityDetails(opportunityDetails || {
        actName: enrichedVars.actName,
        date: enrichedVars.date,
        address: enrichedVars.location,
        duties: enrichedVars.role,
        fee: enrichedVars.fee,
      });
    } catch (validationError) {
      await alertImmediateWhatsAppFailure({
        failureEmail: resolvedFailureEmail,
        error: validationError,
      });
      throw validationError;
    }
  }

  if (requireTemplate && !selectedContentSid) {
    const templateError = new Error(
      "WhatsApp message blocked: no approved Content SID is configured. No message was sent.",
    );
    await alertImmediateWhatsAppFailure({
      failureEmail: resolvedFailureEmail,
      error: templateError,
    });
    throw templateError;
  }
  const suppliedNumberedVars = Object.fromEntries(
    Object.entries(variables || {}).filter(([key]) => /^\d+$/.test(key)),
  );
  let contentVariables = Object.keys(suppliedNumberedVars).length
    ? suppliedNumberedVars
    : enrichedVars;

  // The approved instrumentalist booking template has exactly six slots.
  // Twilio rejects the whole request when extra named variables or a seventh
  // slot are supplied, even if slots 1-6 are valid.
  if (
    selectedContentSid &&
    selectedContentSid === process.env.TWILIO_INSTRUMENTALIST_BOOKING_REQUEST_SID
  ) {
    contentVariables = Object.fromEntries(
      Object.entries(contentVariables).filter(([key]) => /^[1-6]$/.test(key)),
    );
  }
  contentVariables = Object.fromEntries(
    Object.entries(contentVariables).map(([key, value]) => [
      key,
      String(value ?? "").trim() || "TBC",
    ]),
  );

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
    variables: contentVariables,
    contentSid: selectedContentSid,
    requestId,
    buttonsCount: Array.isArray(buttons) ? buttons.length : 0,
  });

  /* ────────────────────────────────────────────────────────────────────────────
   * ⬇️ SEND VIA TWILIO, THEN PERSIST outboundSid FOR INBOUND MATCHING
   * ──────────────────────────────────────────────────────────────────────────── */
  const useContent = !!(
    selectedContentSid &&
    (!buttons || buttons.length === 0 || requestId)
  );
  let result = null;

  if (requireTemplate && !useContent) {
    const templateError = new Error(
      "WhatsApp message blocked: the approved template could not be used safely. No message was sent.",
    );
    await alertImmediateWhatsAppFailure({
      failureEmail: resolvedFailureEmail,
      error: templateError,
    });
    throw templateError;
  }

  try {
    if (useContent) {
      // ✅ Preferred: Content API with variables (supports quick replies)
      result = await client.messages.create({
        to: `whatsapp:${toE}`,
        from: `whatsapp:${fromE}`,
        contentSid: selectedContentSid,
        contentVariables: JSON.stringify(contentVariables),
        ...(deliveryStatusCallback ? { statusCallback: deliveryStatusCallback } : {}),
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
        ...(deliveryStatusCallback ? { statusCallback: deliveryStatusCallback } : {}),
      });
    }

    const sid = result?.sid;
    console.log("✅ [sendWhatsAppMessage] Twilio sent", { sid, useContent });

    await rememberWhatsAppDelivery({
      messageSid: sid,
      to: toE,
      smsBody,
      allowSmsFallback,
      failureEmail: resolvedFailureEmail,
      status: result?.status,
      source: source || (useContent ? "content-template" : "plain-text"),
    });

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
    await alertImmediateWhatsAppFailure({
      failureEmail: resolvedFailureEmail,
      error: err,
    });
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
  const isEnquiryJob = String(job?.jobType || "").toLowerCase() === "enquiry";

  if (isEnquiryJob) {
    throw new Error(
      "sendDeputyAllocationWhatsApp should not be used for enquiry jobs"
    );
  }

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

  const grossFee = Number(job?.fee || job?.grossAmount || 0);
  const storedNetFee = Number(job?.deputyNetAmount || 0);
  const stripeFee = Number(job?.stripeFeeAmount || 0);

  const netFeeValue =
    storedNetFee > 0
      ? storedNetFee
      : grossFee > 0 && stripeFee > 0
        ? grossFee - stripeFee
        : grossFee;

  const fee = netFeeValue > 0 ? String(Math.round(netFeeValue)) : "";

  const firstName =
    musician?.firstName ||
    musician?.firstname ||
    musician?.basicInfo?.firstName ||
    musician?.name ||
    "there";

  const roleLabel = job?.instrument || "Deputy";
  const actName = job?.title || job?.instrument || "Deputy opportunity";

  const bookingIntroLine = `You've been selected for a booking on ${formattedDate} at ${location} for the role of ${roleLabel}, at a fee of £${fee || "TBC"}.`;

  const bookingFollowUpLine =
    "As you applied for this gig, please confirm whether you'd like to accept the booking.";

  const bookingSmsBody = [
    `Hi ${firstName},`,
    bookingIntroLine,
    bookingFollowUpLine,
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
    finalFee: netFeeValue,
    skipFeeCompute: true,
    smsBody: bookingSmsBody,
    contentSid: allocationContentSid,
    allowDefaultContentSid: false,
    allowSmsFallback: false,
    source: "deputy-allocation-request",
    requireOpportunityDetails: true,
    opportunityDetails: {
      actName,
      date: formattedDate,
      address: location,
      duties: roleLabel,
      fee: netFeeValue,
    },
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

  const dest = toE164(to);
  const messageBody = String(body || "").trim();
  if (!dest) throw new Error("Invalid SMS recipient");
  if (!messageBody) throw new Error("SMS message body is empty");

  const payload = {
    to: dest,
    body: messageBody,
    ...(statusCallback ? { statusCallback } : {}),
    ...(process.env.TWILIO_MESSAGING_SERVICE_SID
      ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
      : { from: toE164(process.env.TWILIO_SMS_FROM || "") }),
  };

  if (!payload.messagingServiceSid && !payload.from) {
    throw new Error("Missing or invalid Twilio SMS sender");
  }

  console.log("📤 Twilio SMS create()", {
    to: payload.to,
    via: payload.messagingServiceSid ? "service" : payload.from,
  });

  return client.messages.create(payload);
};



/**
 * Send a plain WhatsApp text (no template/content).
 */
export async function sendWhatsAppText(to, body, options = {}) {
  const client = getTwilioClient();
  if (!client) throw new Error("Twilio disabled");

  const toE = toE164(to);
  const fromE = toE164(TWILIO_WA_SENDER || "");
  const messageBody = String(body || "").trim();
  if (!toE) throw new Error("Invalid WhatsApp recipient");
  if (!fromE) throw new Error("Missing WhatsApp sender");
  if (!messageBody) throw new Error("WhatsApp message body is empty");

  const payload = {
    from: `whatsapp:${fromE}`,
    to: `whatsapp:${toE}`,
    body: messageBody,
    ...(statusCallback ? { statusCallback } : {}),
  };

  const failureEmail =
    options.failureEmail ||
    defaultFailureEmail({
      to: toE,
      source: String(options.source || "whatsapp-session-message"),
      body: messageBody,
    });
  let result;
  try {
    result = await client.messages.create(payload);
  } catch (error) {
    await alertImmediateWhatsAppFailure({ failureEmail, error });
    throw error;
  }
  await rememberWhatsAppDelivery({
    messageSid: result?.sid,
    to: toE,
    smsBody: messageBody,
    allowSmsFallback: false,
    failureEmail,
    status: result?.status,
    source: String(options.source || "plain-text"),
  });
  return result;
}

export default {
  sendWhatsAppMessage,
  sendDeputyAllocationWhatsApp,
  sendDeputyAllocationDeclinedWhatsApp,
  sendSMSMessage,
  sendWhatsAppText,
  fetchTwilioConversation,
  toE164,
};

import AvailabilityModel from "../models/availabilityModel.js";
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import { cancelCalendarInvite } from "../controllers/googleController.js";
import { sendWhatsAppText } from "../utils/twilioClient.js";
import DeferredAvailability from "../models/deferredAvailabilityModel.js";
import { sendWhatsAppMessage } from "../utils/twilioClient.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";
import { postcodes } from "../utils/postcodes.js"; // <-- ensure this path is correct in backend
import { sendEmail } from "../utils/sendEmail.js";
import mongoose from "mongoose";
import calculateActPricing from "../utils/calculateActPricing.js";
import { createCalendarInvite } from "./googleController.js";
import userModel from "../models/userModel.js";
import { computeMemberMessageFee } from "./helpersForCorrectFee.js";
import { makeShortId } from "../utils/makeShortId.js";
import crypto from "crypto"; // at top of file if not already

// Debugging: log AvailabilityModel structure at runtime
console.log("📘 [twilioInbound] AvailabilityModel inspection:");
if (AvailabilityModel?.schema?.paths) {
  const fieldNames = Object.keys(AvailabilityModel.schema.paths);
  console.log("📋 Fields:", fieldNames);
  console.log("📦 Collection name:", AvailabilityModel.collection?.name);
  console.log("🧱 Indexes:", AvailabilityModel.schema._indexes);
} else {
  console.warn("⚠️ AvailabilityModel missing schema.paths — check import");
}

// Deffered Availability Request (if lead take longer than 3 hours to reply ping next deputy)

// ───────────────────────────────────────────────────────────────────────────────
// 3h escalation helpers
// ───────────────────────────────────────────────────────────────────────────────
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/** Upsert a "ping deputies in 3h if no reply" job for a LEAD vocalist */
export async function scheduleDeputyEscalation({
  availabilityId,
  actId,
  lineupId,
  dateISO,
  phone,
  slotIndex = 0,
  formattedAddress = "TBC",
  clientName = "",
  clientEmail = "",
}) {
  try {
    const dueAt = new Date(Date.now() + THREE_HOURS_MS);

    await DeferredAvailability.findOneAndUpdate(
      {
        reason: "no-reply-3h",
        actId,
        dateISO,
        phone,
        slotIndex,
        status: { $in: ["pending", "processing"] },
      },
      {
        $setOnInsert: {
          availabilityId,
          lineupId,
          formattedAddress,
          clientName,
          clientEmail,
          dueAt,
          status: "pending",
        },
        $set: {
          // if it already exists as pending/processing, refresh the dueAt forward
          dueAt,
        },
      },
      { new: true, upsert: true },
    );

    console.log("⏱️ [scheduleDeputyEscalation] job scheduled for", {
      actId,
      dateISO,
      slotIndex,
      phone,
      dueAt,
    });
  } catch (e) {
    console.warn("⚠️ [scheduleDeputyEscalation] failed:", e.message);
  }
}

/** Cancel any pending 3h escalation for a LEAD row (call on any reply) */
export async function cancelDeputyEscalation({
  actId,
  dateISO,
  phone,
  slotIndex = 0,
}) {
  try {
    const res = await DeferredAvailability.updateMany(
      {
        reason: "no-reply-3h",
        actId,
        dateISO,
        phone,
        slotIndex,
        status: { $in: ["pending", "processing"] },
      },
      { $set: { status: "cancelled", processedAt: new Date() } },
    );
    if (res.modifiedCount) {
      console.log("🧯 [cancelDeputyEscalation] cancelled", {
        actId,
        dateISO,
        slotIndex,
        phone,
        cancelled: res.modifiedCount,
      });
    }
  } catch (e) {
    console.warn("⚠️ [cancelDeputyEscalation] failed:", e.message);
  }
}

/** Worker: processes due jobs and calls notifyDeputies if the lead hasn't replied */
export async function processDueDeputyEscalations({ maxBatch = 20 } = {}) {
  const now = new Date();

  for (let i = 0; i < maxBatch; i++) {
    // atomically claim one job
    const job = await DeferredAvailability.findOneAndUpdate(
      { status: "pending", dueAt: { $lte: now } },
      { $set: { status: "processing", processingStartedAt: new Date() } },
      { sort: { dueAt: 1 }, new: true },
    );

    if (!job) break; // nothing due

    try {
      // Try to fetch the original availability row (most accurate)
      const row = job.availabilityId
        ? await AvailabilityModel.findById(job.availabilityId).lean()
        : await AvailabilityModel.findOne({
            actId: job.actId,
            dateISO: job.dateISO,
            phone: job.phone,
            slotIndex: job.slotIndex,
            v2: true,
          })
            .sort({ createdAt: -1 })
            .lean();

      // If lead already replied, or deputies were already contacted, do nothing
      if (row?.reply) {
        await DeferredAvailability.updateOne(
          { _id: job._id },
          {
            $set: {
              status: "processed",
              processedAt: new Date(),
              error: "lead_already_replied",
            },
          },
        );
        continue;
      }

      const deputiesExist = await AvailabilityModel.exists({
        actId: job.actId,
        dateISO: job.dateISO,
        slotIndex: job.slotIndex,
        isDeputy: true,
      });

      if (deputiesExist) {
        await DeferredAvailability.updateOne(
          { _id: job._id },
          {
            $set: {
              status: "processed",
              processedAt: new Date(),
              error: "already_escalated",
            },
          },
        );
        continue;
      }

      // Call your existing helper – we pass slotIndex so the right vocalist's deputies are pinged
      await notifyDeputies({
        actId: job.actId,
        lineupId: row?.lineupId || job.lineupId || null,
        dateISO: job.dateISO,
        formattedAddress:
          row?.formattedAddress || job.formattedAddress || "TBC",
        clientName: row?.clientName || job.clientName || "",
        clientEmail: row?.clientEmail || job.clientEmail || "",
        slotIndex: typeof job.slotIndex === "number" ? job.slotIndex : null,
        skipDuplicateCheck: true,
        skipIfUnavailable: false,
      });

      await DeferredAvailability.updateOne(
        { _id: job._id },
        { $set: { status: "processed", processedAt: new Date() } },
      );

      console.log(
        "📣 [processDueDeputyEscalations] deputies pinged (no reply in 3h)",
        {
          actId: job.actId,
          dateISO: job.dateISO,
          slotIndex: job.slotIndex,
        },
      );
    } catch (e) {
      console.error("❌ [processDueDeputyEscalations] job failed", e);
      await DeferredAvailability.updateOne(
        { _id: job._id },
        {
          $set: { status: "error", error: e.message, processedAt: new Date() },
        },
      );
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Helper: consistent identity logging
// ───────────────────────────────────────────────────────────────────────────────
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

/** Normalise stringy names from any source */
const normalizeNameBits = (nameLike) => {
  const s = (nameLike ?? "").toString().trim();
  if (!s)
    return {
      first: "",
      last: "",
      firstName: "",
      lastName: "",
      displayName: "",
      vocalistDisplayName: "",
    };
  const parts = s.split(/\s+/);
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return {
    first,
    last,
    firstName: first,
    lastName: last,
    displayName: s,
    vocalistDisplayName: s,
  };
};

/** Build a complete "primary" record for the badge slot */
function presentBadgePrimary({ row = {}, musicianDoc = {}, leadBits = {} }) {
  const id = String(row.musicianId || musicianDoc?._id || "");
  const nameBits = normalizeNameBits({
    firstName: musicianDoc.firstName ?? leadBits.firstName ?? row.firstName,
    lastName: musicianDoc.lastName ?? leadBits.lastName ?? row.lastName,
    displayName: musicianDoc.displayName ?? leadBits.displayName,
    vocalistDisplayName:
      leadBits.vocalistDisplayName ??
      row.vocalistName ??
      musicianDoc.vocalistDisplayName,
  });

  const photoUrl =
    leadBits.photoUrl || musicianDoc.photoUrl || row.photoUrl || null;
  const profileUrl =
    leadBits.profileUrl || musicianDoc.profileUrl || row.profileUrl || "";

  return {
    musicianId: id || null,
    ...nameBits,
    photoUrl,
    profileUrl,
    isDeputy: !!row.isDeputy,
    phone: row.phone || musicianDoc.phone || null,
    setAt: row.updatedAt || new Date().toISOString(),
    available: row.reply === "yes",
    slotIndex: typeof row.slotIndex === "number" ? row.slotIndex : null,
  };
}

const SMS_FALLBACK_LOCK = new Set(); // key: WA MessageSid; prevents duplicate SMS fallbacks
const normCountyKey = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "_");

function classifyReply(text) {
  console.log(
    `🟢 (availabilityController.js) classifyReply  START at ${new Date().toISOString()}`,
    {
      actId: req.query?.actId,
      dateISO: req.query?.dateISO,
    },
  );
  const v = String(text || "")
    .trim()
    .toLowerCase();

  if (!v) return null;

  // YES variants
  if (
    /^(yes|y|yeah|yep|sure|ok|okay)$/i.test(v) ||
    /\bi am available\b/i.test(v) ||
    /\bi'm available\b/i.test(v) ||
    /\bavailable\b/i.test(v)
  )
    return "yes";

  // NO variants
  if (
    /^(no|n|nope|nah)$/i.test(v) ||
    /\bi am not available\b/i.test(v) ||
    /\bi'm not available\b/i.test(v) ||
    /\bunavailable\b/i.test(v)
  )
    return "no";

  return null;
}
const toE164 = (raw = "") => {
  let s = String(raw || "")
    .replace(/^whatsapp:/i, "")
    .replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
};

const normalize44 = (raw = "") =>
  String(raw)
    .replace(/\s+/g, "")
    .replace(/^(\+44|44|0)/, "+44");

/* ========================================================================== */
/* 👤 findCanonicalMusicianByPhone                                            */
/* ========================================================================== */
export async function findCanonicalMusicianByPhone(phoneLike) {
  if (!phoneLike) return null;
  const p = normalize44(phoneLike);

  console.log("🔎 [findCanonicalMusicianByPhone] Lookup by phone", {
    phoneLike,
    normalized: p,
  });

  const mus = await Musician.findOne({
    $or: [
      { phoneNormalized: p },
      { phone: p },
      { phoneNumber: p },
      { "contact.phone": p },
      { whatsappNumber: p },
    ],
  })
    .select(
      "_id firstName lastName email profilePicture musicianProfileImage profileImage photoUrl imageUrl phoneNormalized",
    )
    .lean();

  if (!mus) {
    console.log(
      "ℹ️ [findCanonicalMusicianByPhone] No canonical musician found",
    );
    return null;
  }

  // ── name helpers (drop these in once, before any usage of firstLast) ───────────
  const firstLast = (nameLike) => {
    const s = (nameLike ?? "").toString().trim();
    if (!s)
      return {
        first: "",
        last: "",
        firstName: "",
        lastName: "",
        displayName: "",
      };
    const parts = s.split(/\s+/);
    const first = parts[0] || "";
    const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
    return { first, last, firstName: first, lastName: last, displayName: s };
  };

  const names = firstLast(mus);
  const displayName = displayNameOf(mus);
  const profileUrl = buildProfileUrl(mus?._id);
  const photoUrl = pickPic(mus);

  console.log("✅ [findCanonicalMusicianByPhone] Canonical found", {
    ...names,
    displayName,
    vocalistDisplayName: displayName,
    profileUrl,
    photoUrl,
    isDeputy: mus?.isDeputy ?? undefined,
    email: mus?.email || "",
    phoneNormalized: mus?.phoneNormalized || "",
    _id: String(mus?._id || ""),
  });

  return mus;
}

function pickPic(mus) {
  const url =
    mus?.profilePicture ||
    mus?.musicianProfileImage ||
    mus?.profileImage ||
    mus?.photoUrl ||
    mus?.imageUrl ||
    "";
  return typeof url === "string" && url.trim().startsWith("http")
    ? url.trim()
    : "";
}

/**
 * Compute a member's total fee (base + travel) given act, member, and address.
 */
export async function computeFinalFeeForMember(
  act,
  member,
  address,
  dateISO,
  lineup,
) {
  const baseFee = Number(member?.fee ?? 0);
  const lineupTotal = Number(lineup?.base_fee?.[0]?.total_fee ?? 0);
  const membersCount = Math.max(
    1,
    Array.isArray(lineup?.bandMembers) ? lineup.bandMembers.length : 1,
  );

  const perHead = lineupTotal > 0 ? Math.ceil(lineupTotal / membersCount) : 0;
  const base = baseFee > 0 ? baseFee : perHead;

  const { county: selectedCounty } = countyFromAddress(address);
  let travelFee = 0;
  let usedCountyRate = false;

  if (act?.useCountyTravelFee && act?.countyFees && selectedCounty) {
    const raw = getCountyFeeValue(act.countyFees, selectedCounty);
    const val = Number(raw);
    if (Number.isFinite(val) && val > 0) {
      usedCountyRate = true;
      travelFee = Math.ceil(val);
    }
  }

  if (!usedCountyRate) {
    travelFee = await computeMemberTravelFee({
      act,
      member,
      selectedCounty,
      selectedAddress: address,
      selectedDate: dateISO,
    });
    travelFee = Math.max(0, Math.ceil(Number(travelFee || 0)));
  }

  return Math.max(0, Math.ceil(Number(base || 0) + Number(travelFee || 0)));
}

/**
 * Returns a friendly "Tuesday, 22nd March 2027" date string
 */
export function formatNiceDate(dateISO) {
  const dateObj = new Date(dateISO);
  const day = dateObj.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  const weekday = dateObj.toLocaleString("en-GB", { weekday: "long" });
  const month = dateObj.toLocaleString("en-GB", { month: "long" });
  const year = dateObj.getFullYear();
  return `${weekday}, ${day}${suffix} ${month} ${year}`;
}

/**
 * Send a client-facing email about act availability.
 * Falls back to hello@thesupremecollective.co.uk if no client email found.
 */
// ───────────────────────────────────────────────────────────────────────────────
// sendClientEmail — with identity and URL logging
// ───────────────────────────────────────────────────────────────────────────────
// Resolves recipient from a User id or an email, and always CCs hello@
// Safe to keep in the same file; it lazily imports deps.
export async function sendClientEmail({
  actId,
  to,
  userId = null,
  name,
  subject,
  html,
  allowHello = false,
}) {
  console.log("✉️ sendClientEmail START", { actId, to, userId, name, subject });

  const HELLO = "hello@thesupremecollective.co.uk";

  // Normalize SMTP envs (prevents app-password whitespace/newline issues)
  // Never log secrets – only safe metadata.
  if (process.env.GMAIL_AVAIL_USER) {
    process.env.GMAIL_AVAIL_USER = String(process.env.GMAIL_AVAIL_USER)
      .trim()
      .toLowerCase();
  }

  // app passwords often get pasted as "xxxx xxxx xxxx xxxx"
  if (process.env.GMAIL_AVAIL_PASS) {
    process.env.GMAIL_AVAIL_PASS = String(process.env.GMAIL_AVAIL_PASS).replace(
      /\s+/g,
      "",
    );
  }

  console.log("🔐 sendClientEmail SMTP env snapshot", {
    smtpUser:
      process.env.GMAIL_AVAIL_USER || process.env.EMAIL_USER || undefined,
    smtpPassLen:
      String(process.env.GMAIL_AVAIL_PASS || process.env.EMAIL_PASS || "")
        .length || 0,
    defaultFrom: process.env.DEFAULT_FROM || undefined,
  });

  try {
    // Lazy-load deps so we don't juggle top-level imports or risk circulars
    const [SendMod, UserMod] = await Promise.all([
      import("../utils/sendEmail.js"),
      import("../models/userModel.js").catch(() => null),
    ]);

    const sendEmail =
      (SendMod && (SendMod.sendEmail || SendMod.default)) || null;
    const User =
      UserMod && (UserMod.default || UserMod.User || UserMod.user || null);

    if (typeof sendEmail !== "function") {
      console.error("❌ sendClientEmail: sendEmail() not available");
      return { success: false, error: "sendEmail_not_available" };
    }

    const isObjectId = (s) =>
      typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s);
    const isEmail = (s) =>
      typeof s === "string" && /\S+@\S+\.\S+/.test(String(s).trim());

    const requestedTo = String(to || "")
      .trim()
      .toLowerCase();

    const act = await Act.findById(actId).lean();

    // ── Resolve the true recipient ────────────────────────────────────────────
    let resolvedEmail = null;

    // 1) explicit userId
    if (!resolvedEmail && userId && isObjectId(userId) && User) {
      try {
        const u = await User.findById(userId).select("email").lean();
        if (u?.email) resolvedEmail = String(u.email).trim().toLowerCase();
      } catch (e) {
        console.warn(
          "⚠️ sendClientEmail: lookup by userId failed:",
          e?.message || e,
        );
      }
    }

    // 2) if "to" looks like an ObjectId, treat it as a userId
    if (!resolvedEmail && isObjectId(to) && User) {
      try {
        const u = await User.findById(to).select("email").lean();
        if (u?.email) resolvedEmail = String(u.email).trim().toLowerCase();
      } catch (e) {
        console.warn(
          "⚠️ sendClientEmail: lookup by 'to' (objectId) failed:",
          e?.message || e,
        );
      }
    }

    // 3) plain email in "to"
    if (!resolvedEmail && isEmail(to)) {
      resolvedEmail = String(to).trim().toLowerCase();
    }

    // 4) act contact email fallback (avoid using hello@ as the sole "to")
    if (
      !resolvedEmail &&
      isEmail(act?.contactEmail) &&
      String(act.contactEmail).trim().toLowerCase() !== HELLO
    ) {
      resolvedEmail = String(act.contactEmail).trim().toLowerCase();
    }

    // 5) final fallback from env (may still be hello@)
    const envFallback = (process.env.NOTIFY_EMAIL || "").trim().toLowerCase();
    const finalRecipient = resolvedEmail || envFallback;

    const isHelloRecipient = finalRecipient === HELLO;

    // ✅ Allow hello@ if:
    // - caller explicitly passed allowHello
    // - OR the request is explicitly targeting hello@ (your testing case)
    // - OR you opt-in via env
    // - OR you're not in production (handy for dev/staging)
    const allowHelloEffective =
      allowHello === true ||
      requestedTo === HELLO ||
      process.env.ALLOW_HELLO_EMAILS === "true" ||
      process.env.NODE_ENV !== "production";

    console.log("📨 sendClientEmail recipient decision", {
      requestedTo,
      userId,
      actContactEmail: act?.contactEmail,
      finalRecipient,
      allowHello,
      allowHelloEffective,
      sendEmailsFlag: process.env.SEND_EMAILS,
    });

    // Guard: don't send *only* to hello@ unless explicitly allowed
    if (
      !finalRecipient ||
      !isEmail(finalRecipient) ||
      (!allowHelloEffective && isHelloRecipient)
    ) {
      console.warn(
        "⚠️ No valid client recipient (or only hello@). Skipping sendEmail.",
        {
          requestedTo,
          finalRecipient,
          allowHelloEffective,
        },
      );
      return {
        success: false,
        skipped: true,
        reason: "no_valid_client_recipient",
      };
    }

    const fromAddr = (process.env.DEFAULT_FROM || HELLO).trim();

    const result = await sendEmail({
      to: [finalRecipient],
      bcc: [HELLO],
      subject,
      html,
      // This can be the alias address — SMTP auth should still be rhona@
      from: fromAddr,
      replyTo: HELLO,
    });

    // ── Interpret low-level result explicitly ────────────────────────────────
    if (result?.skipped) {
      console.warn("🟠 sendClientEmail SKIPPED", {
        reason: result.reason || "unknown",
        finalRecipient,
        subject,
      });
      return {
        success: false,
        skipped: true,
        reason: result.reason || "skipped",
      };
    }

    if (result?.dryRun) {
      console.log("✉️ sendClientEmail DRY-RUN OK", {
        recipients: result.recipients,
        bccRecipients: result.bccRecipients,
        subject,
      });
      return { success: true, dryRun: true };
    }

    if (!result?.ok) {
      console.error("❌ sendClientEmail FAILED", {
        finalRecipient,
        subject,
        accepted: result?.accepted,
        rejected: result?.rejected,
        response: result?.response,
      });
      return {
        success: false,
        error: "send_failed",
        accepted: result?.accepted || [],
        rejected: result?.rejected || [],
      };
    }

    console.log("✅ sendClientEmail SENT", {
      actName: act?.tscName || act?.name,
      recipient: finalRecipient,
      subject,
      messageId: result?.messageId,
    });

    return { success: true, messageId: result?.messageId };
  } catch (err) {
    console.error("❌ sendClientEmail failed:", err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

function parsePayload(payload = "") {
  console.log(
    `🟢 (availabilityController.js) parsePayload START at ${new Date().toISOString()}`,
    {},
  );
  // Trim, uppercase, and match "YES<id>" / "NOLOC<id>" / "UNAVAILABLE<id>"
  const match = payload
    .trim()
    .match(/^(YES|NOLOC|UNAVAILABLE)([A-Za-z0-9]+)?$/i);
  if (!match) return { reply: null, enquiryId: null };
  return {
    reply: match[1].toLowerCase(),
    enquiryId: match[2] || null,
  };
}
const normalizeFrom = (from) => {
  console.log(
    `🟢 (availabilityController.js) normalizeFrom START at ${new Date().toISOString()}`,
    {},
  );
  const v = String(from || "")
    .replace(/^whatsapp:/i, "")
    .trim();
  if (!v) return [];
  const plus = v.startsWith("+") ? v : v.startsWith("44") ? `+${v}` : v;
  const uk07 = plus.replace(/^\+44/, "0");
  const ukNoPlus = plus.replace(/^\+/, "");
  return Array.from(new Set([plus, uk07, ukNoPlus]));
};
// Module-scope E.164 normalizer (also strips "whatsapp:" prefix)
const normalizeToE164 = (raw = "") => {
  let s = String(raw || "")
    .trim()
    .replace(/^whatsapp:/i, "")
    .replace(/\s+/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("07")) return s.replace(/^0/, "+44");
  if (s.startsWith("44")) return `+${s}`;
  return s;
};
/* ========================================================================== */
/* 💷 getCountyFeeValue                                                        */
/* ========================================================================== */
export function getCountyFeeValue(countyFees, countyName) {
  console.log("🟢 [getCountyFeeValue] START", {
    at: new Date().toISOString(),
    hasFees: !!countyFees,
    countyName,
  });
  if (!countyFees || !countyName) return undefined;

  const want = normCountyKey(countyName);

  // Map
  if (typeof countyFees.get === "function") {
    for (const [k, v] of countyFees) {
      if (normCountyKey(k) === want) {
        console.log("✅ [getCountyFeeValue] Match (Map)", { key: k, value: v });
        return v;
      }
    }
    return undefined;
  }

  // Object fast paths
  if (countyFees[countyName] != null) return countyFees[countyName];
  if (countyFees[want] != null) return countyFees[want];
  const spaced = countyName.replace(/_/g, " ");
  if (countyFees[spaced] != null) return countyFees[spaced];

  // Case-insensitive scan
  for (const [k, v] of Object.entries(countyFees)) {
    if (normCountyKey(k) === want) {
      console.log("✅ [getCountyFeeValue] Match (scan)", { key: k, value: v });
      return v;
    }
  }
  console.log("ℹ️ [getCountyFeeValue] No match");
  return undefined;
}

const _waFallbackSent = new Set(); // remember WA SIDs we've already fallen back for

// Normalise first-name display so we never fall back to "there" when we actually have a name
const safeFirst = (s) => {
  console.log(
    `🟢 (availabilityController.js) safeFirst START at ${new Date().toISOString()}`,
  );
  const v = String(s || "").trim();
  return v ? v.split(/\s+/)[0] : "there";
};

function extractOutcode(address = "") {
  console.log(
    `🟢 (availabilityController.js) extractOutcode  START at ${new Date().toISOString()}`,
    {},
  );
  // Typical UK outcode patterns e.g. SL6, W1, SW1A, B23
  const s = String(address || "").toUpperCase();
  // Prefer the first token that looks like a postcode piece
  // Full PC can be "SL6 8HN". Outcode is "SL6".
  const m = s.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b/); // full PC
  if (m) return m[1];
  const o = s.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/); // fallback: any outcode-like token
  return o ? o[1] : "";
}

/* ========================================================================== */
/* 🗺️ countyFromAddress                                                       */
/* ========================================================================== */
export function countyFromAddress(address = "") {
  console.log("🟢 [countyFromAddress] START", {
    at: new Date().toISOString(),
    addressSample: String(address).slice(0, 140),
  });

  const outcode = (extractOutcode(address) || "").toUpperCase();
  if (!outcode) {
    console.warn("⚠️ [countyFromAddress] No outcode extracted");
    return { outcode: "", county: "" };
  }

  const table = Array.isArray(postcodes) ? postcodes[0] || {} : postcodes || {};
  let found = "";

  for (const [countyKey, list] of Object.entries(table)) {
    if (Array.isArray(list) && list.includes(outcode)) {
      found = countyKey.replace(/_/g, " ").trim();
      break;
    }
  }

  console.log("✅ [countyFromAddress] Resolved", { outcode, county: found });
  return { outcode, county: found };
}

function getPictureUrlFrom(obj) {
  if (!obj || typeof obj !== "object") return "";

  // ✅ your current schema field
  const direct =
    obj.profilePhoto ||
    obj.profilePicture || // older
    obj.photoUrl || // older
    obj.imageUrl || // older
    "";

  if (typeof direct === "string" && direct.trim()) return direct.trim();

  // Some of your other models used arrays like [{url}]
  const arrUrl =
    (Array.isArray(obj.profileImage) && obj.profileImage[0]?.url) ||
    (Array.isArray(obj.images) && obj.images[0]?.url) ||
    (Array.isArray(obj.coverImage) && obj.coverImage[0]?.url) ||
    "";

  if (typeof arrUrl === "string" && arrUrl.trim()) return arrUrl.trim();

  // Some older nested keys you were selecting
  const legacy =
    obj.musicianProfileImageUpload || obj.musicianProfileImage || "";

  return typeof legacy === "string" ? legacy.trim() : "";
}

// controllers/notifyDeputies.js
export async function notifyDeputies({
  actId,
  lineupId,
  dateISO,
  formattedAddress,
  clientName,
  clientEmail,
  slotIndex = null,
  skipDuplicateCheck = false,
  skipIfUnavailable = true, // currently unused in this snippet
}) {
  console.log("📢 [notifyDeputies] START", {
    actId,
    lineupId,
    dateISO,
    formattedAddress,
    clientName,
    clientEmail,
    slotIndex,
    skipDuplicateCheck,
  });

  const normalizePhone = (raw = "") => {
    let v = String(raw || "")
      .replace(/\s+/g, "")
      .replace(/^whatsapp:/i, "");
    if (!v) return "";
    if (v.startsWith("+")) return v;
    if (v.startsWith("07")) return v.replace(/^0/, "+44");
    if (v.startsWith("44")) return `+${v}`;
    return v;
  };

  const firstLast = (o = {}) => {
    const s = String(o?.name || "").trim();
    const fn = String(
      o?.firstName || (s ? s.split(/\s+/)[0] : "") || "",
    ).trim();
    const ln = String(
      o?.lastName ||
        (s && s.includes(" ") ? s.split(/\s+/).slice(1).join(" ") : "") ||
        "",
    ).trim();
    return { firstName: fn, lastName: ln };
  };

  const displayNameOf = (p = {}) => {
    const fn = (p.firstName || p.name || "").trim();
    const ln = (p.lastName || "").trim();
    return fn && ln ? `${fn} ${ln}` : fn || ln || "";
  };

  const pickPic = (m = {}) =>
    m.photoUrl ||
    m.imageUrl ||
    m.profilePicture ||
    m.musicianProfileImage ||
    m.profileImage ||
    null;

  const buildProfileUrl = (id) => {
    const base = (
      process.env.PUBLIC_SITE_URL ||
      process.env.FRONTEND_URL ||
      "http://localhost:5174"
    ).replace(/\/$/, "");
    return id ? `${base}/musician/${id}` : "";
  };

  const act = await Act.findById(actId).lean();
  if (!act) return console.warn("⚠️ [notifyDeputies] No act found");

  const lineup =
    act?.lineups?.find((l) => String(l._id) === String(lineupId)) ||
    act?.lineups?.find((l) => String(l.lineupId) === String(lineupId)) ||
    null;
  if (!lineup) return console.warn("⚠️ [notifyDeputies] No lineup found");

  const vocalists =
    lineup.bandMembers?.filter((m) =>
      ["vocal", "vocalist"].some((v) =>
        (m.instrument || "").toLowerCase().includes(v),
      ),
    ) || [];

  if (!vocalists.length) {
    console.warn("⚠️ [notifyDeputies] No vocalists in lineup");
    return;
  }

  const targetVocalists =
    slotIndex !== null && vocalists[slotIndex]
      ? [vocalists[slotIndex]]
      : vocalists;

  console.log("🎯 [notifyDeputies] Target vocalists", {
    count: targetVocalists.length,
    slotIndex,
  });

  // ✅ Inherit context from the lead row for this slot (fee + client identity + enquiryId)
  let inheritedFee = null;
  let inheritedClientName = clientName || "";
  let inheritedClientEmail = clientEmail || "";
  let inheritedEnquiryId = null;
  let inheritedClientUserId = null;

  try {
    const leadRow = await AvailabilityModel.findOne({
      actId,
      dateISO,
      isDeputy: { $ne: true },
      ...(slotIndex !== null ? { slotIndex } : {}),
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    if (leadRow) {
      inheritedEnquiryId = leadRow.enquiryId || null;
      inheritedClientUserId = leadRow.clientUserId || leadRow.userId || null;

      // Only fill if missing
      if (!inheritedClientName && leadRow.clientName)
        inheritedClientName = leadRow.clientName;
      if (!inheritedClientEmail && leadRow.clientEmail)
        inheritedClientEmail = leadRow.clientEmail;

      // Fee inherit (avoid lead rows that already said no/unavailable)
      if (
        leadRow.reply !== "unavailable" &&
        leadRow.reply !== "no" &&
        leadRow.fee
      ) {
        inheritedFee = Number(leadRow.fee);
        console.log("💾 [notifyDeputies] Inherited lead row context", {
          inheritedFee,
          inheritedClientName,
          inheritedClientEmail,
          inheritedEnquiryId,
          inheritedClientUserId,
        });
      } else {
        console.log(
          "ℹ️ [notifyDeputies] Lead row found but fee not inherited (reply/no fee)",
          {
            reply: leadRow.reply,
            fee: leadRow.fee,
          },
        );
      }
    }
  } catch (err) {
    console.warn(
      "⚠️ [notifyDeputies] Lead context lookup failed:",
      err?.message,
    );
  }

  // Fallback fee from act data if still missing
  if (!inheritedFee && targetVocalists[0]?.fee) {
    inheritedFee = Number(targetVocalists[0].fee);
    console.log("💾 [notifyDeputies] Fallback fee from act data", {
      inheritedFee,
    });
  }

  // Build exclusion set (already YES/unavailable)
  const existingPhonesAgg = await AvailabilityModel.aggregate([
    { $match: { actId, dateISO, reply: { $in: ["yes", "unavailable"] } } },
    { $group: { _id: "$phone" } },
  ]);
  const existingSet = new Set(
    existingPhonesAgg.map((p) => (p._id || "").replace(/\s+/g, "")),
  );

  let totalSent = 0;

  for (const vocalist of targetVocalists) {
    const vocalistNames = firstLast(vocalist);
    const vocalistDisplayName = displayNameOf(vocalist);

    for (const deputy of vocalist.deputies || []) {
      const cleanPhone = normalizePhone(
        deputy.phoneNumber || deputy.phone || "",
      );
      if (!/^\+?\d{10,15}$/.test(cleanPhone)) continue;
      if (existingSet.has(cleanPhone)) continue;

      const deputyNames = firstLast(deputy);
      const deputyDisplayName = displayNameOf(deputy);

      console.log("🎯 [notifyDeputies] Triggering deputy", {
        isDeputy: true,
        deputy: {
          ...deputyNames,
          displayName: deputyDisplayName,
          profileUrl: buildProfileUrl(deputy?.musicianId || deputy?._id),
          photoUrl: pickPic(deputy),
          phone: cleanPhone,
          email: deputy?.email || "",
        },
        vocalist: {
          ...vocalistNames,
          vocalistDisplayName,
          profileUrl: buildProfileUrl(vocalist?.musicianId || vocalist?._id),
          photoUrl: pickPic(vocalist),
        },
        address: null,
        formattedAddress: formattedAddress || null,
        lineupId,
        slotIndex,
        inheritedFee,
      });

      await triggerAvailabilityRequest({
        actId,
        lineupId,
        dateISO,
        slotIndex,
        formattedAddress,

        // ✅ ALWAYS pass client context to deputy rows
        clientName: inheritedClientName,
        clientEmail: inheritedClientEmail,

        // ✅ Ensure deputy rows get linked to the same enquiry/slot thread
        enquiryId: inheritedEnquiryId,

        // ✅ Helps triggerAvailabilityRequest enrichment if email missing
        userId: inheritedClientUserId,

        isDeputy: true,
        selectedVocalistName: deputyDisplayName || vocalistDisplayName || "",
        vocalistName: vocalistDisplayName || "",

        deputy: {
          id: deputy.id || deputy.musicianId || deputy._id || null,
          musicianId: deputy.musicianId || deputy.id || deputy._id || null,
          firstName: deputy.firstName || deputy.name || "",
          lastName: deputy.lastName || "",
          phone: cleanPhone,
          email: deputy.email || "",
          imageUrl:
            deputy.imageUrl || deputy.photoUrl || pickPic(deputy) || null,
          displayName: deputyDisplayName || "",
        },

        inheritedFee,
        inheritedDuties: vocalist.instrument || "Vocalist",
        skipDuplicateCheck,
      });

      existingSet.add(cleanPhone);
      totalSent++;
      if (totalSent >= 3) {
        console.log("🛑 [notifyDeputies] Limit reached — contacted 3 deputies");
        return;
      }
    }
  }

  console.log("✅ [notifyDeputies] COMPLETE", { deputiesContacted: totalSent });
}

export async function triggerNextDeputy({
  actId,
  lineupId,
  dateISO,
  excludePhones = [],
  slotIndex = null, // 🆕 added for per-slot progression
}) {
  console.log("🎯 [triggerNextDeputy] START", { actId, dateISO, slotIndex });

  const act = await Act.findById(actId).lean();
  if (!act) return console.warn("⚠️ No act found for triggerNextDeputy");

  const lineup = act.lineups?.find((l) => String(l._id) === String(lineupId));
  if (!lineup) return console.warn("⚠️ No lineup found for triggerNextDeputy");

  // 🧩 Identify vocalists in this lineup
  const allVocalists =
    lineup.bandMembers?.filter((m) =>
      ["vocal", "vocalist"].some((v) =>
        (m.instrument || "").toLowerCase().includes(v),
      ),
    ) || [];

  if (!allVocalists.length)
    return console.warn("⚠️ No vocalists found for triggerNextDeputy");

  // 🎤 Pick correct vocalist slot (default to 0 if unspecified)
  const vocalist =
    typeof slotIndex === "number"
      ? allVocalists[slotIndex] || allVocalists[0]
      : allVocalists[0];

  if (!vocalist)
    return console.warn("⚠️ No vocalist found for slotIndex", slotIndex);

  console.log(
    `🎤 Slot ${slotIndex}: evaluating deputies for ${vocalist.firstName || vocalist.name}`,
  );

  // 🧹 Filter deputies that haven’t been contacted yet
  const remaining = (vocalist.deputies || []).filter((d) => {
    const phone = (d.phoneNumber || d.phone || "").replace(/\s+/g, "");
    return phone && !excludePhones.includes(phone);
  });

  if (!remaining.length) {
    console.log(
      `🚫 No remaining deputies to trigger for vocalist slot ${slotIndex}`,
    );
    return;
  }

  const nextDeputy = remaining[0];
  console.log(
    `📨 Triggering next deputy for slot ${slotIndex}: ${nextDeputy.name}`,
  );

  // 🧠 Notify this deputy only (pass along slotIndex)
  await notifyDeputies({
    actId,
    lineupId,
    dateISO,
    formattedAddress: "TBC",
    clientName: "Auto-triggered",
    clientEmail: "hello@thesupremecollective.co.uk",
    skipDuplicateCheck: true,
    skipIfUnavailable: false,
    customDeputyList: [nextDeputy],
    slotIndex, // 🆕 ensures deputies triggered for correct slot only
  });

  console.log(`✅ [triggerNextDeputy] Deputy triggered for slot ${slotIndex}`);
}

// === Booking-request wave (uses the SAME fee logic as enquiries) ===

// Compute a per-member final fee exactly like the enquiry flow:
// - explicit member.fee if set, else per-head from lineup.base_fee
// - plus county travel fee (if enabled) OR distance-based travel
async function _finalFeeForMember({
  act,
  lineup,
  members,
  member,
  address,
  dateISO,
}) {
  console.log(
    `🟢 (availabilityController.js) _finalFeeForMember START at ${new Date().toISOString()}`,
    {},
  );
  const lineupTotal = Number(lineup?.base_fee?.[0]?.total_fee ?? 0);
  const membersCount = Math.max(1, Array.isArray(members) ? members.length : 1);
  const perHead = lineupTotal > 0 ? Math.ceil(lineupTotal / membersCount) : 0;
  const base = Number(member?.fee ?? 0) > 0 ? Number(member.fee) : perHead;
  // 🧩 If deputy fee missing, inherit from matching essential member (e.g. same instrument)
  if (
    (!member?.fee || Number(member.fee) === 0) &&
    Array.isArray(lineup.bandMembers)
  ) {
    const matching = lineup.bandMembers.find(
      (m) =>
        m.isEssential &&
        m.instrument &&
        member?.instrument &&
        m.instrument.toLowerCase() === member.instrument.toLowerCase(),
    );
    if (matching?.fee) {
      console.log(
        `🎯 Inheriting fee £${matching.fee} from ${matching.instrument}`,
      );
      base = Number(matching.fee);
    }
  }
  const { county: selectedCounty } = countyFromAddress(address);

  // County-rate (if enabled) wins; otherwise distance-based
  let travelFee = 0;
  let usedCounty = false;

  if (act?.useCountyTravelFee && act?.countyFees && selectedCounty) {
    const raw = getCountyFeeValue(act.countyFees, selectedCounty);
    const val = Number(raw);
    if (Number.isFinite(val) && val > 0) {
      usedCounty = true;
      travelFee = Math.ceil(val);
    }
  }

  if (!usedCounty) {
    travelFee = await computeMemberTravelFee({
      act,
      member,
      selectedCounty,
      selectedAddress: address,
      selectedDate: dateISO,
    });
    travelFee = Math.max(0, Math.ceil(Number(travelFee || 0)));
  }

  return Math.max(0, Math.ceil(Number(base || 0) + Number(travelFee || 0)));
}

const isVocalRoleGlobal = (role = "") => {
  const r = String(role || "").toLowerCase();
  return [
    "lead male vocal",
    "lead female vocal",
    "lead vocal",
    "vocalist-guitarist",
    "vocalist-bassist",
    "mc/rapper",
    "lead male vocal/rapper",
    "lead female vocal/rapper",
    "lead male vocal/rapper & guitarist",
    "lead female vocal/rapper & guitarist",
  ].includes(r);
};

// --- New helpers for badge rebuilding ---

const normalizePhoneE164 = (raw = "") => {
  let v = String(raw || "")
    .replace(/^whatsapp:/i, "")
    .replace(/\s+/g, "");
  if (!v) return "";
  if (v.startsWith("+")) return v;
  if (v.startsWith("07")) return v.replace(/^0/, "+44");
  if (v.startsWith("44")) return `+${v}`;
  return v;
};

export const clearavailabilityBadges = async (req, res) => {
  console.log(
    `🟢 (availabilityController.js) cleadavailabilityBadges START at ${new Date().toISOString()}`,
    {},
  );
  try {
    const { actId } = req.body;
    if (!actId)
      return res.status(400).json({ success: false, message: "Missing actId" });

    await Act.findByIdAndUpdate(actId, {
      $set: { "availabilityBadges.active": false },
      $unset: {
        "availabilityBadges.vocalistName": "",
        "availabilityBadges.inPromo": "",
        "availabilityBadges.dateISO": "",
        "availabilityBadges.musicianId": "",
        "availabilityBadges.address": "",
        "availabilityBadges.setAt": "",
      },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ clearavailabilityBadges error", err);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
};

// -------------------- Utilities --------------------

const mapTwilioToEnquiryStatus = (s) => {
  console.log(
    `🟢  (availabilityController.js) mapTwilioToEnquiryStatus START at ${new Date().toISOString()}`,
    {},
  );
  const v = String(s || "").toLowerCase();
  if (v === "accepted" || v === "queued" || v === "scheduled") return "queued";
  if (v === "sending") return "sent";
  if (v === "sent") return "sent";
  if (v === "delivered") return "delivered";
  if (v === "read") return "read";
  if (v === "undelivered") return "undelivered";
  if (v === "failed") return "failed";
  return "queued";
};

const BASE_URL = (
  process.env.BACKEND_PUBLIC_URL ||
  process.env.BACKEND_URL ||
  process.env.INTERNAL_BASE_URL ||
  "http://localhost:4000"
).replace(/\/$/, "");
const NORTHERN_COUNTIES = new Set([
  "ceredigion",
  "cheshire",
  "cleveland",
  "conway",
  "cumbria",
  "denbighshire",
  "derbyshire",
  "durham",
  "flintshire",
  "greater manchester",
  "gwynedd",
  "herefordshire",
  "lancashire",
  "leicestershire",
  "lincolnshire",
  "merseyside",
  "north humberside",
  "north yorkshire",
  "northumberland",
  "nottinghamshire",
  "rutland",
  "shropshire",
  "south humberside",
  "south yorkshire",
  "staffordshire",
  "tyne and wear",
  "warwickshire",
  "west midlands",
  "west yorkshire",
  "worcestershire",
  "wrexham",
  "rhondda cynon taf",
  "torfaen",
  "neath port talbot",
  "bridgend",
  "blaenau gwent",
  "caerphilly",
  "cardiff",
  "merthyr tydfil",
  "newport",
  "aberdeen city",
  "aberdeenshire",
  "angus",
  "argyll and bute",
  "clackmannanshire",
  "dumfries and galloway",
  "dundee city",
  "east ayrshire",
  "east dunbartonshire",
  "east lothian",
  "east renfrewshire",
  "edinburgh",
  "falkirk",
  "fife",
  "glasgow",
  "highland",
  "inverclyde",
  "midlothian",
  "moray",
  "na h eileanan siar",
  "north ayrshire",
  "north lanarkshire",
  "orkney islands",
  "perth and kinross",
  "renfrewshire",
  "scottish borders",
  "shetland islands",
  "south ayrshire",
  "south lanarkshire",
  "stirling",
  "west dunbartonshire",
  "west lothian",
]);

// Availability controller: robust travel fetch that supports both API shapes
const fetchTravel = async (origin, destination, dateISO) => {
  console.log(
    `🟢 (availabilityController.js) fetchTravel START at ${new Date().toISOString()}`,
    {},
  );
  const BASE = (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BACKEND_URL ||
    process.env.INTERNAL_BASE_URL ||
    "http://localhost:4000"
  ).replace(/\/+$/, "");

  const url =
    `${BASE}/api/v2/travel` +
    `?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}` +
    `&date=${encodeURIComponent(dateISO)}`;

  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!res.ok) throw new Error(`travel http ${res.status}`);

  // --- Normalize shapes ---
  // Legacy: { rows:[{ elements:[{ distance, duration, fare? }] }] }
  const firstEl = data?.rows?.[0]?.elements?.[0];

  // Prefer new shape if present; otherwise build outbound from legacy element
  const outbound =
    data?.outbound ||
    (firstEl?.distance && firstEl?.duration
      ? {
          distance: firstEl.distance,
          duration: firstEl.duration,
          fare: firstEl.fare,
        }
      : undefined);

  // returnTrip only exists in the new shape
  const returnTrip = data?.returnTrip;

  // Return normalized plus raw for callers that need details
  return { outbound, returnTrip, raw: data };
};

const computeMemberTravelFee = async ({
  act,
  member,
  selectedCounty,
  selectedAddress,
  selectedDate,
}) => {
  console.log(
    `🟢 (availabilityController.js) computeMemberTravelFee START at ${new Date().toISOString()}`,
    { selectedCounty, selectedAddress, memberName: member?.firstName },
  );

  // 🧭 1️⃣ Determine origin (musician postcode)
  const origin =
    member?.postCode ||
    member?.postcode ||
    member?.post_code ||
    member?.addressPostcode ||
    "";

  // 🧭 2️⃣ Determine destination (event address)
  let destination = "";
  if (typeof selectedAddress === "string" && selectedAddress.trim() !== "") {
    destination = selectedAddress.trim();
  } else if (typeof selectedAddress === "object") {
    destination =
      selectedAddress?.postcode ||
      selectedAddress?.address ||
      selectedAddress?.formattedAddress ||
      "";
  } else {
    destination =
      act?.formattedAddress || act?.venueAddress || act?.eventAddress || "";
  }

  // 🧭 3️⃣ Clean & normalize
  const cleanOrigin = origin?.trim()?.toUpperCase() || "";
  const cleanDestination = destination?.trim() || "";

  // 🧩 4️⃣ Guard against missing data
  if (!cleanOrigin || !cleanDestination || cleanDestination === "TBC") {
    console.warn(
      "⚠️ computeMemberTravelFee missing valid origin or destination",
      {
        origin: cleanOrigin || "(none)",
        destination: cleanDestination || "(none)",
      },
    );
    return 0;
  }

  // 🧩 5️⃣ Branch 1 — County fee per member
  if (act.useCountyTravelFee && act.countyFees) {
    const key = String(selectedCounty || "").toLowerCase();
    const feePerMember =
      Number(act.countyFees?.[key] ?? act.countyFees?.get?.(key) ?? 0) || 0;
    console.log(`📍 County-based travel fee (${key}): £${feePerMember}`);
    return feePerMember;
  }

  // 🧩 6️⃣ Branch 2 — Cost-per-mile
  if (Number(act.costPerMile) > 0) {
    try {
      const data = await fetchTravel(
        cleanOrigin,
        cleanDestination,
        selectedDate,
      );
      const distanceMeters = data?.outbound?.distance?.value || 0;
      const distanceMiles = distanceMeters / 1609.34;
      const fee = distanceMiles * Number(act.costPerMile) * 25; // per-member multiplier
      console.log(
        `🚗 Cost-per-mile travel: ${distanceMiles.toFixed(1)}mi @ £${act.costPerMile}/mi → £${fee.toFixed(2)}`,
      );
      return fee;
    } catch (err) {
      console.warn("⚠️ Cost-per-mile fetchTravel failed:", err.message);
      return 0;
    }
  }

  // 🧩 7️⃣ Branch 3 — MU-style calculation
  try {
    const data = await fetchTravel(cleanOrigin, cleanDestination, selectedDate);
    const outbound = data?.outbound;
    const returnTrip = data?.returnTrip;

    if (!outbound || !returnTrip) {
      console.warn("⚠️ MU-style: Missing outbound/return trip data", {
        origin: cleanOrigin,
        destination: cleanDestination,
      });
      return 0;
    }

    const totalDistanceMiles =
      (outbound.distance.value + returnTrip.distance.value) / 1609.34;
    const totalDurationHours =
      (outbound.duration.value + returnTrip.duration.value) / 3600;

    const fuelFee = totalDistanceMiles * 0.56; // MU mileage
    const timeFee = totalDurationHours * 13.23; // MU hourly rate
    const lateFee = returnTrip.duration.value / 3600 > 1 ? 136 : 0;
    const tollFee = (outbound.fare?.value || 0) + (returnTrip.fare?.value || 0);

    const total = fuelFee + timeFee + lateFee + tollFee;

    console.log(
      `🎶 MU-style travel fee: distance=${totalDistanceMiles.toFixed(
        1,
      )}mi, hours=${totalDurationHours.toFixed(2)}, total=£${total.toFixed(2)}`,
    );

    return total;
  } catch (err) {
    console.error("❌ MU-style computeMemberTravelFee failed:", err.message);
    return 0;
  }
};

const PUBLIC_SITE_BASE = (
  process.env.PUBLIC_SITE_URL ||
  process.env.FRONTEND_URL ||
  "http://localhost:5174"
).replace(/\/$/, "");

const buildProfileUrl = (id) =>
  id ? `${PUBLIC_SITE_BASE}/musician/${id}` : "";

const displayNameOf = (p = {}) => {
  const fn = (p.firstName || p.name || "").trim();
  const ln = (p.lastName || "").trim();
  return fn && ln ? `${fn} ${ln}` : fn || ln || "";
};

// 🆕 When you need structured pieces for templates/variables
export const nameBitsOf = (
  x = {},
  { log = true, label = "nameBitsOf" } = {},
) => {
  const firstName = (x.firstName || x.first || "").toString().trim();
  const lastName = (x.lastName || x.last || "").toString().trim();
  const displayName = (
    x.displayName ||
    x.vocalistDisplayName ||
    x.selectedVocalistName ||
    x.vocalistName ||
    x.musicianName ||
    [firstName, lastName].filter(Boolean).join(" ")
  )
    .toString()
    .trim();
  const vocalistDisplayName = (
    x.vocalistDisplayName ||
    x.selectedVocalistName ||
    x.vocalistName ||
    displayName
  )
    .toString()
    .trim();

  const bits = { firstName, lastName, displayName, vocalistDisplayName };
  if (log && typeof logIdentity === "function") logIdentity(label, bits);
  return bits;
};

const firstLast = (p = {}) => ({
  firstName: (p.firstName || p.name || "").trim() || undefined,
  lastName: (p.lastName || "").trim() || undefined,
});

/* ========================================================================== */
/* 🎤 findVocalistPhone                                                        */
/* ========================================================================== */
export function findVocalistPhone(actData, lineupId) {
  console.log("🐠 [findVocalistPhone] START", {
    at: new Date().toISOString(),
    lineupId,
    totalLineups: actData?.lineups?.length || 0,
    actName: actData?.tscName || actData?.name || "",
  });

  if (!actData?.lineups?.length) {
    console.warn("⚠️ [findVocalistPhone] No lineups on act");
    return null;
  }

  const lineup = lineupId
    ? actData.lineups.find(
        (l) => String(l._id || l.lineupId) === String(lineupId),
      )
    : actData.lineups[0];

  if (!lineup?.bandMembers?.length) {
    console.warn("⚠️ [findVocalistPhone] Lineup has no bandMembers");
    return null;
  }

  // Lead (or first) vocalist
  const vocalist = lineup.bandMembers.find((m) =>
    String(m.instrument || "")
      .toLowerCase()
      .includes("vocal"),
  );

  if (!vocalist) {
    console.warn("⚠️ [findVocalistPhone] No vocalist found in lineup", {
      lineupId,
    });
    return null;
  }

  let phone =
    vocalist.phoneNormalized || vocalist.phoneNumber || vocalist.phone || "";

  // If lead has no phone, try a deputy’s
  if (!phone && Array.isArray(vocalist.deputies) && vocalist.deputies.length) {
    const deputyWithPhone = vocalist.deputies.find(
      (d) => d.phoneNormalized || d.phoneNumber || d.phone,
    );
    if (deputyWithPhone) {
      phone =
        deputyWithPhone.phoneNormalized ||
        deputyWithPhone.phoneNumber ||
        deputyWithPhone.phone ||
        "";
      console.log("🎯 [findVocalistPhone] Using deputy phone", {
        deputyFirstName:
          deputyWithPhone.firstName || deputyWithPhone.name || "",
        deputyLastName: deputyWithPhone.lastName || "",
        forVocalist: displayNameOf(vocalist),
      });
    }
  }

  // Normalize (expects your existing helper)
  phone = toE164(phone);

  if (!phone) {
    console.warn(
      "⚠️ [findVocalistPhone] No valid phone for vocalist/deputies",
      {
        vocalistFirstName: vocalist.firstName || "",
        vocalistLastName: vocalist.lastName || "",
        lineup: lineup.actSize,
        act: actData.tscName || actData.name,
      },
    );
    return null;
  }

  const vNames = firstLast(vocalist);
  const vDisplayName = displayNameOf(vocalist);

  console.log("🎤 [findVocalistPhone] Lead vocalist resolved", {
    ...vNames,
    displayName: vDisplayName,
    vocalistDisplayName: vDisplayName,
    instrument: vocalist.instrument,
    fee: vocalist.fee,
    // These are unknown in this function; include as nulls for consistency
    address: null,
    formattedAddress: null,
    profileUrl: buildProfileUrl(vocalist?.musicianId || vocalist?._id),
    photoUrl: pickPic(vocalist),
    isDeputy: false,
    phone,
    lineupSize: lineup?.actSize || "",
  });

  return { vocalist, phone };
}

async function getDeputyDisplayBits(dep) {
  const PUBLIC_SITE_BASE = (
    process.env.PUBLIC_SITE_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5174"
  ).replace(/\/$/, "");

  // Same normaliser shape as your schema
  const normE164 = (raw = "") => {
    let v = String(raw || "")
      .trim()
      .replace(/^whatsapp:/i, "")
      .replace(/\s+/g, "");
    if (!v) return "";
    if (v.startsWith("+")) return v;
    if (/^44\d+$/.test(v)) return `+${v}`;
    if (/^0\d{10}$/.test(v)) return `+44${v.slice(1)}`;
    if (/^\d{10,13}$/.test(v))
      return v.startsWith("44") ? `+${v}` : `+44${v.replace(/^0?/, "")}`;
    return v;
  };

  const FALLBACK_PHOTO =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1761313694/profile_placeholder_rcdly4.png";

  const initialMusicianId =
    (dep?.musicianId && String(dep.musicianId)) ||
    (dep?._id && String(dep._id)) ||
    "";

  let resolvedMusicianId = initialMusicianId;
  let photoUrl = getPictureUrlFrom(dep);

  console.log("🔍 getDeputyDisplayBits START", {
    initialMusicianId,
    directPhoto: photoUrl || "❌ none",
    phone: dep?.phone || dep?.phoneNumber || null,
    phoneNormalized: dep?.phoneNormalized || null,
    email: dep?.email || dep?.emailAddress || null,
  });

  let mus = null;

  // Step 2: lookup by id
  if ((!photoUrl || !/^https?:\/\//i.test(photoUrl)) && initialMusicianId) {
    console.log("🆔 Step 2: Looking up musician by ID →", initialMusicianId);

    mus = await Musician.findById(initialMusicianId)
      .select(
        [
          "firstName",
          "lastName",
          "displayName",
          "preferredName",
          "name",
          "email",
          "phone",
          "phoneNormalized",
          "phoneNumber",
          // ✅ IMPORTANT: your actual schema field
          "profilePhoto",
          // other legacy fields (keep for backwards compat)
          "profilePicture",
          "photoUrl",
          "imageUrl",
          "musicianProfileImageUpload",
          "musicianProfileImage",
          "profileImage",
        ].join(" "),
      )
      .lean();

    if (mus) {
      resolvedMusicianId = String(mus._id || initialMusicianId);
      photoUrl = getPictureUrlFrom(mus);
      console.log("📸 Step 2 result: From musicianId →", photoUrl || "❌ none");
    } else {
      console.warn("⚠️ Step 2: No musician found by ID", initialMusicianId);
    }
  }

  // Step 2.5: lookup by phoneNormalized if no photo yet
  if (!photoUrl || !/^https?:\/\//i.test(photoUrl)) {
    const possiblePhone =
      dep?.phoneNormalized ||
      dep?.phoneNumber ||
      dep?.phone ||
      mus?.phoneNormalized ||
      mus?.phoneNumber ||
      mus?.phone ||
      "";

    const normalizedPhone = normE164(possiblePhone);

    if (normalizedPhone) {
      console.log("📞 Step 2.5: Looking up by phone →", normalizedPhone);

      const musByPhone = await Musician.findOne({
        $or: [
          { phoneNormalized: normalizedPhone },
          { phone: normalizedPhone },
          { phoneNumber: normalizedPhone },
        ],
      })
        .select(
          [
            "firstName",
            "lastName",
            "displayName",
            "preferredName",
            "name",
            "email",
            "phone",
            "phoneNormalized",
            "phoneNumber",
            "profilePhoto",
            "profilePicture",
            "photoUrl",
            "imageUrl",
            "musicianProfileImageUpload",
            "musicianProfileImage",
            "profileImage",
          ].join(" "),
        )
        .lean();

      if (musByPhone) {
        mus = musByPhone;
        resolvedMusicianId = String(musByPhone._id || resolvedMusicianId);
        photoUrl = getPictureUrlFrom(musByPhone);
        console.log(
          "📸 Step 2.5 result: Found by phone →",
          photoUrl || "❌ none",
        );
      } else {
        console.warn(
          "⚠️ Step 2.5: No musician found by phone",
          normalizedPhone,
        );
      }
    } else {
      console.log("ℹ️ Step 2.5 skipped — no phone available");
    }
  }

  // Step 3: lookup by email if still no photo
  let resolvedEmail = dep?.email || dep?.emailAddress || mus?.email || "";

  if ((!photoUrl || !/^https?:\/\//i.test(photoUrl)) && resolvedEmail) {
    console.log("📧 Step 3: Lookup by email →", resolvedEmail);

    const musByEmail = await Musician.findOne({ email: resolvedEmail })
      .select(
        [
          "firstName",
          "lastName",
          "displayName",
          "preferredName",
          "name",
          "email",
          "phone",
          "phoneNormalized",
          "phoneNumber",
          "profilePhoto",
          "profilePicture",
          "photoUrl",
          "imageUrl",
          "musicianProfileImageUpload",
          "musicianProfileImage",
          "profileImage",
        ].join(" "),
      )
      .lean();

    if (musByEmail) {
      mus = musByEmail;
      resolvedMusicianId = String(musByEmail._id || resolvedMusicianId);
      resolvedEmail = musByEmail.email || resolvedEmail;
      photoUrl = getPictureUrlFrom(musByEmail);
      console.log("📸 Step 3 result: Found by email →", photoUrl || "❌ none");
    } else {
      console.warn("⚠️ Step 3: No musician found for email", resolvedEmail);
    }
  }

  const finalMusicianId = String(
    resolvedMusicianId || dep?.musicianId || initialMusicianId || "",
  );
  const profileUrl = finalMusicianId
    ? `${PUBLIC_SITE_BASE}/musician/${finalMusicianId}`
    : "";

  if (!photoUrl || !/^https?:\/\//i.test(photoUrl)) {
    console.log("🪄 No valid photo found — using fallback");
    photoUrl = FALLBACK_PHOTO;
  }

  // resolvedName for badge / emails
  const firstName = (mus?.firstName || dep?.firstName || "").trim();
  const lastName = (mus?.lastName || dep?.lastName || "").trim();

  const display =
    String(mus?.displayName || mus?.preferredName || mus?.name || "").trim() ||
    `${firstName} ${lastName}`.trim() ||
    "";

  const finalBits = {
    musicianId: finalMusicianId,
    photoUrl,
    profileUrl,
    resolvedEmail,
    firstName,
    lastName,
    resolvedName: display || `${firstName} ${lastName}`.trim(),
  };

  console.log("🎯 FINAL getDeputyDisplayBits result:", finalBits);
  return finalBits;
}

const normalizePhone = (raw = "") => {
  let v = String(raw || "")
    .replace(/\s+/g, "")
    .replace(/^whatsapp:/i, "");
  if (!v) return "";
  if (v.startsWith("+")) return v;
  if (v.startsWith("07")) return v.replace(/^0/, "+44");
  if (v.startsWith("44")) return `+${v}`;
  return v;
};
const extractUKPostcode = (s = "") => {
  const m = String(s)
    .toUpperCase()
    .match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return m ? m[1].replace(/\s+/, " ") : "";
};

async function findDateLevelUnavailable({ dateISO, canonicalId, phone }) {
  const or = [];
  if (canonicalId) or.push({ musicianId: canonicalId });
  if (phone) or.push({ phone });

  if (!or.length) return null;

  return AvailabilityModel.findOne({
    v2: true,
    dateISO,
    reply: "unavailable",
    $or: or,
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();
}

export const triggerAvailabilityRequest = async (reqOrArgs, maybeRes) => {
  const isExpress = !!maybeRes;
  const body = isExpress ? reqOrArgs.body : reqOrArgs;
  const res = isExpress ? maybeRes : null;

  const normalizeAddrStrict = (s = "") =>
    String(s || "")
      .toLowerCase()
      .replace(/\buk\b/g, "")
      .replace(/\s+/g, " ")
      .replace(/,\s*/g, ",")
      .trim();

  const makeRequestKey = ({ scope, actId, dateISO, address }) => {
    const raw = [
      String(scope || "anon").trim(),
      String(actId || "").trim(),
      String(dateISO || "").trim(),
      normalizeAddrStrict(address || ""),
    ].join("|");

    return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
  };

  // Normalize request object (this function is called both as an Express handler and as an internal helper)
  const reqObj = isExpress ? reqOrArgs : {};

  // Prefer auth-derived userId when available; fall back to body
  const authUserIdRaw = reqObj?.user?._id || reqObj?.userId || null;
  const bodyUserIdRaw =
    body?.userId ||
    body?.user?._id ||
    body?.user?.id ||
    body?.userIdFromToken ||
    null;

  const authUserId = authUserIdRaw ? String(authUserIdRaw) : null;
  const bodyUserId = bodyUserIdRaw ? String(bodyUserIdRaw) : null;
  const clientUserId = authUserId || bodyUserId || null;

  const hasAuthHeader = isExpress ? !!reqObj?.headers?.authorization : false;

  try {
    const {
      actId,
      lineupId, // optional
      date,
      dateISO: dISO,
      address,
      formattedAddress,
      clientName,
      clientEmail,
      isDeputy = false,
      deputy = null,
      inheritedFee = null, // optional
      skipDuplicateCheck = false,
      selectedVocalistName = "",
      vocalistName = "",
    } = body;

    const PUBLIC_SITE_BASE = (
      process.env.PUBLIC_SITE_URL ||
      process.env.FRONTEND_URL ||
      "http://localhost:5174"
    ).replace(/\/$/, "");

    console.log("🧾 [triggerAvailabilityRequest] identity snapshot", {
      isExpress,
      bodyUserId,
      authUserId,
      clientUserId,
      hasAuthHeader,
    });

    /* -------------------------------------------------------------- */
    /* 🔢 Enquiry + slotIndex base                                    */
    /* -------------------------------------------------------------- */
    const enquiryId =
      body.enquiryId ||
      body.shortlistId ||
      body.requestId ||
      body.parentKey ||
      null;

    if (!enquiryId) {
      console.warn("⚠️ No enquiryId provided — slotIndex grouping may fail");
    }

    const existingForEnquiry = enquiryId
      ? await AvailabilityModel.find({ enquiryId }).lean()
      : [];
    const slotIndexBase = existingForEnquiry.length; // just FYI
    const slotIndexFromBody =
      typeof body.slotIndex === "number" ? body.slotIndex : null;

    /* -------------------------------------------------------------- */
    /* 🧭 Enrich clientName/email                                     */
    /* -------------------------------------------------------------- */
    let resolvedClientName = clientName || "";
    let resolvedClientEmail = clientEmail || "";

    const userIdForEnrichment = clientUserId;

    if (!resolvedClientEmail && userIdForEnrichment) {
      try {
        const userDoc = await userModel
          .findById(userIdForEnrichment)
          .select("firstName surname email")
          .lean();

        if (userDoc) {
          resolvedClientName =
            `${userDoc.firstName || ""} ${userDoc.surname || ""}`.trim();
          resolvedClientEmail = userDoc.email || "";
          console.log(
            `📧 Enriched client details from userId: ${resolvedClientName} <${resolvedClientEmail}>`,
            { userIdForEnrichment, source: authUserId ? "auth" : "body" },
          );
        }
      } catch (err) {
        console.warn("⚠️ Failed to enrich client from userId:", err.message);
      }
    }

    /* -------------------------------------------------------------- */
    /* 📅 Basic act + date resolution                                 */
    /* -------------------------------------------------------------- */
    const dateISO =
      dISO || (date ? new Date(date).toISOString().slice(0, 10) : null);
    if (!actId || !dateISO) throw new Error("Missing actId or dateISO");

    const act = await Act.findById(actId).lean();
    if (!act) throw new Error("Act not found");

    // Title-case helper tuned for UK place names
    function toTitleCaseCounty(s = "") {
      const exceptions = new Set([
        "of",
        "and",
        "the",
        "upon",
        "on",
        "by",
        "in",
      ]);
      const fixups = {
        "east riding of yorkshire": "East Riding of Yorkshire",
        "city of london": "City of London",
        "isle of wight": "Isle of Wight",
        "na h-eileanan siar": "Na h-Eileanan Siar",
      };

      const raw = String(s || "").trim();
      if (!raw) return "";

      const lower = raw.toLowerCase();
      if (fixups[lower]) return fixups[lower];

      // keep spaces, hyphens, and apostrophes as separators but preserved
      return (
        lower
          .split(/([\s\-’'])/)
          .map((part, idx) => {
            if (/^[\s\-’']$/.test(part)) return part; // keep separator
            if (idx !== 0 && exceptions.has(part)) return part; // small words
            return part.charAt(0).toUpperCase() + part.slice(1);
          })
          // Mc/Mac prefixes (simple pass)
          .join("")
          .replace(/\bMc([a-z])/g, (_, c) => "Mc" + c.toUpperCase())
          .replace(/\bMac([a-z])/g, (_, c) => "Mac" + c.toUpperCase())
      );
    }

    // derive addresses
    const fullFormattedAddress =
      formattedAddress ||
      address ||
      act?.formattedAddress ||
      act?.venueAddress ||
      "TBC";

    const { county: derivedCountyRaw } =
      countyFromAddress(fullFormattedAddress) || {};
    const derivedCounty = toTitleCaseCounty(derivedCountyRaw);
    const derivedPostcode = extractUKPostcode(fullFormattedAddress);

    const shortAddress =
      [derivedCounty, derivedPostcode].filter(Boolean).join(", ") || "TBC";

    console.log("📍 [triggerAvailabilityRequest] shortAddress for template", {
      shortAddress,
      derivedCounty,
      derivedPostcode,
      fullFormattedAddress,
    });

    const metaAddress = fullFormattedAddress || shortAddress || "TBC";

    const formattedDate = new Date(dateISO).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    // 🔍 Entry summary
    console.log("🟣 [triggerAvailabilityRequest] ENTRY", {
      actId,
      lineupId,
      dateISO,
      isDeputy,
      clientUserId,
      selectedVocalistName,
      vocalistName,
      address: address || null,
      formattedAddress: formattedAddress || null,
      fullFormattedAddress,
      shortAddress,
      metaAddress,
      enquiryId,
      slotIndexFromBody,
    });

    /* -------------------------------------------------------------- */
    /* Guard to de-dupe availability requests                       */
    /* -------------------------------------------------------------- */

    // ✅ requestKey scope: enquiryId first (best), else clientUserId, else anon
    const requestScope = enquiryId || clientUserId || "anon";

    const requestKey = makeRequestKey({
      scope: requestScope,
      actId,
      dateISO,
      address: fullFormattedAddress,
    });

    console.log("🔑 [triggerAvailabilityRequest] requestKey", {
      requestKey,
      requestScope,
      actId,
      dateISO,
      fullFormattedAddress,
    });

    // ✅ EARLY DUPLICATE GUARD (prevents re-trigger on shortlist/cart browsing)
    if (!skipDuplicateCheck) {
      const existingRequest = await AvailabilityModel.findOne({
        actId,
        dateISO,
        v2: true,
        requestKey,
        status: { $in: ["sent", "queued"] }, // adjust if you use other statuses
      })
        .select("_id status createdAt updatedAt enquiryId clientUserId")
        .lean();

      if (existingRequest) {
        console.log(
          "🛑 [triggerAvailabilityRequest] already requested — skipping",
          {
            requestKey,
            existingId: String(existingRequest._id),
            status: existingRequest.status,
            createdAt: existingRequest.createdAt,
          },
        );

        if (res) {
          return res.json({
            success: true,
            sent: 0,
            skipped: "already_requested_for_date_location",
            requestKey,
          });
        }
        return {
          success: true,
          sent: 0,
          skipped: "already_requested_for_date_location",
          requestKey,
        };
      }
    }

    /* -------------------------------------------------------------- */
    /* 🎵 Lineup + members                                            */
    /* -------------------------------------------------------------- */
    const lineups = Array.isArray(act?.lineups) ? act.lineups : [];
    const lineup = lineupId
      ? lineups.find(
          (l) =>
            String(l._id) === String(lineupId) ||
            String(l.lineupId) === String(lineupId),
        )
      : lineups[0];

    if (!lineup) {
      console.warn(
        "⚠️ No valid lineup found — defaulting to first available or skipping lineup-specific logic.",
      );
    }

    const members = Array.isArray(lineup?.bandMembers)
      ? lineup.bandMembers
      : [];

    /* -------------------------------------------------------------- */
    /* 🔎 Address compare helpers                                     */
    /* -------------------------------------------------------------- */
    const normalizeAddr = (s = "") =>
      String(s || "")
        .toLowerCase()
        .replace(/\buk\b/g, "")
        .replace(/\s+/g, " ")
        .replace(/,\s*/g, ",")
        .trim();

    const lastTwoParts = (s = "") =>
      normalizeAddr(s).split(",").slice(-2).join(",");

    const addressesRoughlyEqual = (a = "", b = "") => {
      if (!a || !b) return false;
      const A = normalizeAddr(a);
      const B = normalizeAddr(b);
      if (A === B) return true;
      const A2 = lastTwoParts(a);
      const B2 = lastTwoParts(b);
      return A2 && B2 && (A2 === B2 || A2.includes(B2) || B2.includes(A2));
    };

    /* -------------------------------------------------------------- */
    /* 💰 Fee calculation helper                                      */
    /* -------------------------------------------------------------- */
    const feeForMember = async (member) => {
      const baseFee = Number(member?.fee ?? 0);

      const essentialExtras = Array.isArray(member?.additionalRoles)
        ? member.additionalRoles
            .filter((r) => r?.isEssential && Number(r?.additionalFee) > 0)
            .reduce((sum, r) => sum + Number(r.additionalFee), 0)
        : 0;

      const { county: selectedCounty } =
        countyFromAddress(fullFormattedAddress);
      const selectedDate = dateISO;
      let travelFee = 0;
      let travelSource = "none";

      if (act?.useCountyTravelFee && act?.countyFees && selectedCounty) {
        const raw = getCountyFeeValue(act.countyFees, selectedCounty);
        const val = Number(raw);
        if (Number.isFinite(val) && val > 0) {
          travelFee = Math.ceil(val);
          travelSource = "county";
        }
      }

      if (travelSource === "none") {
        const computed = await computeMemberTravelFee({
          act,
          member,
          selectedCounty,
          selectedAddress: fullFormattedAddress,
          selectedDate,
        });
        travelFee = Math.max(0, Math.ceil(Number(computed || 0)));
        travelSource = "computed";
      }

      const total = baseFee + essentialExtras + travelFee;
      return total;
    };

    /* -------------------------------------------------------------- */
    /* 🎤 MULTI-VOCALIST HANDLING (Lead only)                         */
    /* -------------------------------------------------------------- */
    const vocalists = members.filter((m) =>
      (m.instrument || "").toLowerCase().includes("vocal"),
    );

    if (!isDeputy && vocalists.length > 1) {
      const results = [];

      for (let i = 0; i < vocalists.length; i++) {
        const vMember = vocalists[i];
        const slotIndexForThis = i;

        const phone = normalizePhone(vMember.phone || vMember.phoneNumber);
        if (!phone) {
          console.warn(
            `⚠️ Skipping vocalist ${vMember.firstName} — no phone number`,
          );
          continue;
        }

        // ✅ BULLETPROOF TDZ FIX:
        // Pre-declare realMusicianId so it can never be referenced before init.
        let musicianDoc = null;
        let realMusicianId = vMember?.musicianId || vMember?._id || null;

        try {
          if (vMember.musicianId) {
            musicianDoc = await Musician.findById(vMember.musicianId).lean();
          }
          if (!musicianDoc) {
            musicianDoc = await Musician.findOne({
              $or: [
                { phoneNormalized: phone },
                { phone: phone },
                { phoneNumber: phone },
              ],
            }).lean();
          }
        } catch (err) {
          console.warn("⚠️ Failed to fetch real musician:", err.message);
        }

        realMusicianId = musicianDoc?._id || realMusicianId;

        // ✅ NOW safe to use realMusicianId anywhere below
        const dateLevelUnavailable = await findDateLevelUnavailable({
          dateISO,
          canonicalId: realMusicianId,
          phone,
        });

        if (dateLevelUnavailable) {
          console.log(
            "🚫 Date-level UNAVAILABLE (multi) — skip WA, escalate deputies",
            {
              slotIndex: slotIndexForThis,
              dateISO,
              phone,
              realMusicianId: String(realMusicianId || ""),
            },
          );

          await notifyDeputies({
            actId,
            lineupId: lineup?._id || lineupId || null,
            dateISO,
            formattedAddress: fullFormattedAddress,
            clientName: resolvedClientName || "",
            clientEmail: resolvedClientEmail || "",
            slotIndex: slotIndexForThis,
            skipDuplicateCheck: true,
            skipIfUnavailable: false,
          });

          results.push({
            name: vMember.firstName,
            slotIndex: slotIndexForThis,
            phone,
            reusedExisting: true,
            existingReply: "unavailable (date-level)",
          });

          continue;
        }

        let enriched = musicianDoc
          ? { ...musicianDoc, ...vMember }
          : { ...vMember };
        try {
          if (vMember?.musicianId) {
            const mus = await Musician.findById(vMember.musicianId).lean();
            if (mus) enriched = { ...mus, ...enriched };
          }
        } catch (err) {
          console.warn(
            `⚠️ Failed to enrich vocalist ${vMember.firstName}:`,
            err.message,
          );
        }

        // 🧯 PRIOR-REPLY CHECK (per-slot)
        try {
          const prior = await AvailabilityModel.findOne({
            actId,
            dateISO,
            phone,
            v2: true,
            slotIndex: slotIndexForThis,
            reply: { $in: ["yes", "no", "unavailable"] },
          })
            .sort({ updatedAt: -1, createdAt: -1 })
            .lean();

          if (
            prior &&
            addressesRoughlyEqual(
              prior.formattedAddress || prior.address || "",
              fullFormattedAddress,
            )
          ) {
            console.log(
              "ℹ️ Using existing reply (multi-vocalist) — skipping WA send",
              {
                slotIndex: slotIndexForThis,
                reply: prior.reply,
                phone,
              },
            );

            if (prior.reply === "unavailable" || prior.reply === "no") {
              await notifyDeputies({
                actId,
                lineupId: lineup?._id || lineupId || null,
                dateISO,
                formattedAddress: fullFormattedAddress,
                clientName: resolvedClientName || "",
                clientEmail: resolvedClientEmail || "",
                slotIndex: slotIndexForThis,
                skipDuplicateCheck: true,
                skipIfUnavailable: false,
              });
            }

            if (prior.reply === "yes") {
              try {
                const badgeRes = await rebuildAndApplyAvailabilityBadge({
                  actId,
                  dateISO,
                  __fromExistingReply: true,
                });
                if (global.availabilityNotify && badgeRes?.badge) {
                  global.availabilityNotify.badgeUpdated({
                    type: "availability_badge_updated",
                    actId,
                    actName: act?.tscName || act?.name,
                    dateISO,
                    badge: badgeRes.badge,
                    isDeputy: false,
                  });
                }
              } catch (e) {
                console.warn(
                  "⚠️ Badge refresh (existing YES) failed:",
                  e?.message || e,
                );
              }
            }

            results.push({
              name: vMember.firstName,
              slotIndex: slotIndexForThis,
              phone,
              reusedExisting: true,
              existingReply: prior.reply,
            });
            continue;
          }
        } catch (e) {
          console.warn("⚠️ Prior-reply check (multi) failed:", e?.message || e);
        }

        const finalFee = await feeForMember(vMember);

        const now = new Date();
        const query = {
          actId,
          dateISO,
          phone,
          slotIndex: slotIndexForThis,
          requestKey,
        };
        // 🔗 correlation id
        const requestId = makeShortId();

        // ⛳ INSERT-ONLY META — keep clean
        const setOnInsert = {
          actId,
          clientUserId: clientUserId || null,
          lineupId: lineup?._id || null,
          dateISO,
          phone,
          requestKey,
          v2: true,
          enquiryId,
          slotIndex: slotIndexForThis,
          createdAt: now,
          status: "sent",
          reply: null,
        };

        const displayNameForLead =
          `${enriched.firstName || vMember.firstName || ""} ${
            enriched.lastName || vMember.lastName || ""
          }`.trim();

        // 🔁 ALWAYS-UPDATE FIELDS (requestId ONLY HERE → avoids $setOnInsert conflict)
        const setAlways = {
          isDeputy: false,
          musicianId: realMusicianId,
          musicianName: displayNameForLead,
          musicianEmail: enriched.email || "",
          clientUserId: clientUserId || null,
          photoUrl: enriched.photoUrl || enriched.profilePicture || "",
          address: fullFormattedAddress,
          formattedAddress: fullFormattedAddress,
          formattedDate,
          clientName: resolvedClientName || "",
          clientEmail: resolvedClientEmail || "",
          actName: act?.tscName || act?.name || "",
          duties: vMember.instrument || "Vocalist",
          fee: String(finalFee),
          updatedAt: now,
          selectedVocalistName: displayNameForLead,
          selectedVocalistId: realMusicianId || null,
          vocalistName: displayNameForLead,
          profileUrl: realMusicianId
            ? `${PUBLIC_SITE_BASE}/musician/${realMusicianId}`
            : "",
          requestId, // ← set here (no $setOnInsert duplicate)
        };

        console.log("🔎 [triggerAvailabilityRequest/multi] PERSON", {
          role: "LEAD",
          firstName: (enriched.firstName || vMember.firstName || "").trim(),
          lastName: (enriched.lastName || vMember.lastName || "").trim(),
          selectedVocalistName: displayNameForLead,
          vocalistName: displayNameForLead,
          address: fullFormattedAddress,
          shortAddress,
          photoUrl: setAlways.photoUrl || "",
          profileUrl: setAlways.profileUrl || "",
          musicianId: realMusicianId || null,
          phone,
          slotIndex: slotIndexForThis,
          requestId,
        });

        console.log(
          "🧾 [triggerAvailabilityRequest/multi] about to upsert availability row",
          {
            actId,
            dateISO,
            slotIndex: slotIndexForThis,
            phone,
            willStoreUserId: clientUserId || null,
            willStoreClientEmail: resolvedClientEmail || null,
            willStoreClientName: resolvedClientName || null,
          },
        );

        const savedLead = await AvailabilityModel.findOneAndUpdate(
          query,
          { $setOnInsert: setOnInsert, $set: setAlways },
          { new: true, upsert: true },
        );

        console.log("✅ Upserted LEAD row", {
          slot: slotIndexForThis,
          isDeputy: savedLead?.isDeputy,
          musicianId: String(savedLead?.musicianId || ""),
          requestId,
        });

        // Build interactive buttons (carry requestId)
        const buttons = [
          { id: `YES:${requestId}`, title: "Yes" },
          { id: `NO:${requestId}`, title: "No" },
          { id: `UNAVAILABLE:${requestId}`, title: "Unavailable" },
        ];

        const nameBits = normalizeNameBits(displayNameOf(vMember));

        // Send interactive WA (variables use shortAddress)
        const msg = await sendWhatsAppMessage({
          to: phone,
          actData: act,
          lineup: lineup || {},
          member: vMember,
          address: metaAddress,
          dateISO,
          role: vMember.instrument,
          variables: {
            firstName: nameBits.firstName || "Musician",
            date: formattedDate,
            location: shortAddress,
            fee: String(finalFee),
            role: vMember.instrument,
            actName: act.tscName || act.name,
          },
          requestId, // 🔗
          buttons, // 🔗
          smsBody: `Hi ${
            vMember.firstName || "there"
          }, you've received an enquiry for a gig on ${formattedDate} in ${shortAddress} at a rate of £${finalFee} for ${
            vMember.instrument
          } duties with ${act.tscName || act.name}. Please indicate your availability 💫`,
        });

        // persist Twilio SID (requestId already set above)
        try {
          await AvailabilityModel.updateOne(
            { _id: savedLead._id },
            { $set: { messageSidOut: msg?.sid || null } },
          );
        } catch (e) {
          console.warn(
            "⚠️ Could not persist messageSidOut (multi):",
            e?.message || e,
          );
        }

        // ⏰ Schedule deputy escalation for THIS lead vocalist (inside loop scope)
        await scheduleDeputyEscalation({
          availabilityId: savedLead?._id || null,
          actId,
          lineupId: lineup?._id || lineupId || null,
          dateISO,
          phone,
          slotIndex: slotIndexForThis,
          formattedAddress: fullFormattedAddress,
          clientName: resolvedClientName || "",
          clientEmail: resolvedClientEmail || "",
        });

        results.push({
          name: vMember.firstName,
          slotIndex: slotIndexForThis,
          phone,
          requestId,
          sid: msg?.sid || null,
        });
      }

      console.log(`✅ Multi-vocalist availability triggered for:`, results);
      if (res)
        return res.json({
          success: true,
          sent: results.length,
          details: results,
        });
      return { success: true, sent: results.length, details: results };
    } // ✅ CLOSES: if (!isDeputy && vocalists.length > 1)

    /* -------------------------------------------------------------- */
    /* 🎤 SINGLE VOCALIST / DEPUTY PATH                               */
    /* -------------------------------------------------------------- */
    const targetMember = isDeputy
      ? deputy
      : findVocalistPhone(act, lineup?._id || lineupId)?.vocalist;

    if (!targetMember) throw new Error("No valid member found");

    let enrichedMember = { ...targetMember };
    try {
      if (targetMember?.musicianId) {
        const mus = await Musician.findById(targetMember.musicianId).lean();
        if (mus) enrichedMember = { ...mus, ...enrichedMember };
      } else {
        const cleanPhone = normalizePhone(
          targetMember.phone || targetMember.phoneNumber || "",
        );
        if (cleanPhone) {
          const mus = await Musician.findOne({
            $or: [{ phoneNormalized: cleanPhone }, { phone: cleanPhone }],
          }).lean();
          if (mus) enrichedMember = { ...mus, ...enrichedMember };
        }
      }
    } catch (err) {
      console.warn("⚠️ Enrich failed:", err.message);
    }

    if (isDeputy && deputy?.id && !targetMember.musicianId) {
      targetMember.musicianId = deputy.id;
    }

    targetMember.email = enrichedMember.email || targetMember.email || null;
    targetMember.musicianId =
      enrichedMember._id || targetMember.musicianId || null;

    const phone = normalizePhone(
      targetMember.phone || targetMember.phoneNumber,
    );
    if (!phone) throw new Error("Missing phone");

    // 🔎 Canonical musician from Musicians collection (by phone)
    const canonical = await findCanonicalMusicianByPhone(phone);

    // ✅ Resolve a real musicianId BEFORE date-level checks (aligns with multi-vocalist path)
    const realMusicianId =
      canonical?._id || enrichedMember?._id || targetMember?.musicianId || null;

    const canonicalName = canonical
      ? `${canonical.firstName || ""} ${canonical.lastName || ""}`.trim()
      : `${targetMember.firstName || ""} ${targetMember.lastName || ""}`.trim();

    const canonicalPhoto =
      pickPic(canonical) ||
      enrichedMember?.photoUrl ||
      enrichedMember?.profilePicture ||
      "";

    const selectedName = String(
      selectedVocalistName ||
        canonicalName ||
        `${targetMember?.firstName || ""} ${targetMember?.lastName || ""}`,
    ).trim();

    const singleSlotIndex =
      typeof body.slotIndex === "number" ? body.slotIndex : 0;

    // ✅ Date-level block: if already unavailable for this date, skip lead WhatsApp and go deputies
    if (!isDeputy) {
      const dateLevelUnavailable = await findDateLevelUnavailable({
        dateISO,
        canonicalId: realMusicianId, // ✅ use realMusicianId
        phone,
      });

      if (dateLevelUnavailable) {
        console.log(
          "🚫 Date-level UNAVAILABLE found — skipping lead WhatsApp, escalating to deputies",
          {
            dateISO,
            phone,
            canonicalId: String(realMusicianId || ""),
            priorId: String(dateLevelUnavailable._id || ""),
          },
        );

        await notifyDeputies({
          actId,
          lineupId: lineup?._id || lineupId || null,
          dateISO,
          formattedAddress: fullFormattedAddress,
          clientName: resolvedClientName || "",
          clientEmail: resolvedClientEmail || "",
          slotIndex: singleSlotIndex,
          skipDuplicateCheck: true,
          skipIfUnavailable: false,
        });

        if (res)
          return res.json({
            success: true,
            sent: 0,
            skipped: "date-level-unavailable",
          });
        return { success: true, sent: 0, skipped: "date-level-unavailable" };
      }
    }

    /* -------------------------------------------------------------- */
    /* 🛡️ Prior-reply check (same date + same location)               */
    /* -------------------------------------------------------------- */
    const priorReplyQuery = {
      actId,
      dateISO,
      phone,
      v2: true,
      ...(isDeputy && slotIndexFromBody !== null
        ? { slotIndex: slotIndexFromBody }
        : {}),
      reply: { $in: ["yes", "no", "unavailable"] },
    };

    const prior = await AvailabilityModel.findOne(priorReplyQuery)
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    if (
      prior &&
      addressesRoughlyEqual(
        prior.formattedAddress || prior.address || "",
        fullFormattedAddress,
      )
    ) {
      console.log("ℹ️ Using existing reply (single path) — skipping WA send", {
        isDeputy,
        reply: prior.reply,
        phone,
      });

      if (prior.reply === "yes") {
        try {
          const badgeRes = await rebuildAndApplyAvailabilityBadge({
            actId,
            dateISO,
            __fromExistingReply: true,
          });
          if (global.availabilityNotify && badgeRes?.badge) {
            global.availabilityNotify.badgeUpdated({
              type: "availability_badge_updated",
              actId,
              actName: act?.tscName || act?.name,
              dateISO,
              badge: badgeRes.badge,
              isDeputy,
            });
          }
        } catch (e) {
          console.warn(
            "⚠️ Badge refresh (existing YES) failed:",
            e?.message || e,
          );
        }
      }

      if (
        !isDeputy &&
        (prior.reply === "unavailable" || prior.reply === "no")
      ) {
        await notifyDeputies({
          actId,
          lineupId: lineup?._id || lineupId || null,
          dateISO,
          formattedAddress: fullFormattedAddress,
          clientName: resolvedClientName || "",
          clientEmail: resolvedClientEmail || "",
          slotIndex: typeof body.slotIndex === "number" ? body.slotIndex : null,
          skipDuplicateCheck: true,
          skipIfUnavailable: false,
        });
      }

      if (res)
        return res.json({ success: true, sent: 0, usedExisting: prior.reply });
      return { success: true, sent: 0, usedExisting: prior.reply };
    }

    /* -------------------------------------------------------------- */
    /* 🔐 Refined duplicate guard                                     */
    /* -------------------------------------------------------------- */
    const strongGuardQuery = {
      actId,
      dateISO,
      phone,
      v2: true,
      ...(isDeputy && slotIndexFromBody !== null
        ? { slotIndex: slotIndexFromBody }
        : {}),
    };
    const existingAny =
      await AvailabilityModel.findOne(strongGuardQuery).lean();

    if (existingAny && !skipDuplicateCheck) {
      console.log(
        "⚠️ Duplicate availability request detected — skipping WhatsApp send",
        strongGuardQuery,
      );
      if (res)
        return res.json({
          success: true,
          sent: 0,
          skipped: "duplicate-strong",
        });
      return { success: true, sent: 0, skipped: "duplicate-strong" };
    }

    /* -------------------------------------------------------------- */
    /* 🧮 Final Fee Logic (including deputy inheritedFee)             */
    /* -------------------------------------------------------------- */
    let finalFee;

    if (isDeputy && inheritedFee != null) {
      const parsedBase =
        parseFloat(String(inheritedFee).replace(/[^\d.]/g, "")) || 0;

      const inheritedFeeIncludesTravel =
        body?.inheritedFeeIncludesTravel === true;

      let travelFee = 0;
      let travelSource = "none";

      if (!inheritedFeeIncludesTravel) {
        const { county: selectedCounty } =
          countyFromAddress(fullFormattedAddress);
        const selectedDate = dateISO;

        if (act?.useCountyTravelFee && act?.countyFees && selectedCounty) {
          const raw = getCountyFeeValue(act.countyFees, selectedCounty);
          const val = Number(raw);
          if (Number.isFinite(val) && val > 0) {
            travelFee = Math.ceil(val);
            travelSource = "county";
          }
        }

        if (travelSource === "none") {
          const computed = await computeMemberTravelFee({
            act,
            member: targetMember, // ✅ deputy's own postcode travel
            selectedCounty,
            selectedAddress: fullFormattedAddress,
            selectedDate,
          });
          travelFee = Math.max(0, Math.ceil(Number(computed || 0)));
          travelSource = "computed";
        }
      }

      finalFee = Math.round(parsedBase + travelFee);

      console.log("💷 Deputy fee (inherit + travel)", {
        parsedBase,
        inheritedFeeIncludesTravel,
        travelFee,
        travelSource,
        finalFee,
      });
    } else {
      finalFee = await feeForMember(targetMember);
    }

    /* -------------------------------------------------------------- */
    /* 🛡️ Skip if already replied unavailable / no                    */
    /* -------------------------------------------------------------- */
    const existing = await AvailabilityModel.findOne({
      actId,
      dateISO,
      phone,
      v2: true,
    }).lean();

    if (
      existing &&
      !skipDuplicateCheck &&
      ["unavailable", "no"].includes(existing.reply)
    ) {
      console.log("🚫 Skipping — musician already unavailable/no", {
        actId,
        dateISO,
        phone: existing.phone,
        reply: existing.reply,
      });
      if (res)
        return res.json({ success: true, sent: 0, skipped: existing.reply });
      return { success: true, sent: 0, skipped: existing.reply };
    }

    if (existing && !skipDuplicateCheck && !isDeputy) {
      console.log("⚠️ Duplicate availability request detected — skipping", {
        actId,
        dateISO,
        phone: existing.phone,
      });
      if (res)
        return res.json({ success: true, sent: 0, skipped: "duplicate" });
      return { success: true, sent: 0, skipped: "duplicate" };
    }

    /* -------------------------------------------------------------- */
    /* ✅ Upsert availability record (single lead / deputy)           */
    /* -------------------------------------------------------------- */
    const now = new Date();
    const query = {
      actId,
      dateISO,
      phone,
      slotIndex: singleSlotIndex,
      requestKey,
    };
    // 🔗 correlation id
    const requestId = makeShortId();

    // ⛳ INSERT-ONLY META — keep clean of duplicates on same op
    const setOnInsert = {
      actId,
      lineupId: lineup?._id || null,
      dateISO,
      clientUserId: clientUserId || null,
      phone,
      requestKey,
      v2: true,
      enquiryId,
      slotIndex: singleSlotIndex,
      createdAt: now,
      status: "sent",
      reply: null,
    };

    // 🔁 ALWAYS-UPDATE FIELDS (requestId ONLY HERE → avoids conflict)
    const setAlways = {
      isDeputy: !!isDeputy,
      musicianId: realMusicianId, // ✅ use realMusicianId
      musicianName: canonicalName,
      musicianEmail: canonical?.email || targetMember.email || "",
      photoUrl: canonicalPhoto,
      address: fullFormattedAddress,
      formattedAddress: fullFormattedAddress,
      formattedDate,
      clientName: resolvedClientName || "",
      clientEmail: resolvedClientEmail || "",
      clientUserId: clientUserId || null,
      actName: act?.tscName || act?.name || "",
      duties: body?.inheritedDuties || targetMember.instrument || "Performance",
      fee: String(finalFee),
      updatedAt: now,
      profileUrl: realMusicianId
        ? `${PUBLIC_SITE_BASE}/musician/${realMusicianId}`
        : "",
      selectedVocalistName: selectedName,
      selectedVocalistId: realMusicianId || null, // ✅ use realMusicianId
      vocalistName: vocalistName || selectedName || "",
      requestId, // ← here (not in $setOnInsert)
    };

    const resolvedFirstName = (
      canonical?.firstName ||
      targetMember.firstName ||
      enrichedMember.firstName ||
      ""
    ).trim();
    const resolvedLastName = (
      canonical?.lastName ||
      targetMember.lastName ||
      enrichedMember.lastName ||
      ""
    ).trim();

    console.log("🔎 [triggerAvailabilityRequest/single] PERSON", {
      role: isDeputy ? "DEPUTY" : "LEAD",
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      selectedVocalistName: setAlways.selectedVocalistName,
      vocalistName: setAlways.vocalistName,
      address: fullFormattedAddress,
      shortAddress,
      photoUrl: setAlways.photoUrl || "",
      profileUrl: setAlways.profileUrl || "",
      musicianId: realMusicianId || null,
      phone,
      slotIndex: singleSlotIndex,
      requestId,
    });

    console.log(
      "🧾 [triggerAvailabilityRequest/single] about to upsert availability row",
      {
        actId,
        dateISO,
        slotIndex: singleSlotIndex,
        phone,
        willStoreUserId: clientUserId || null,
        willStoreClientEmail: resolvedClientEmail || null,
        willStoreClientName: resolvedClientName || null,
        isDeputy: !!isDeputy,
      },
    );

    const saved = await AvailabilityModel.findOneAndUpdate(
      query,
      { $setOnInsert: setOnInsert, $set: setAlways },
      { new: true, upsert: true },
    );

    console.log(`✅ Upserted ${isDeputy ? "DEPUTY" : "LEAD"} row`, {
      slot: singleSlotIndex,
      isDeputy: saved?.isDeputy,
      musicianId: String(saved?.musicianId || ""),
      requestId,
    });

    /* -------------------------------------------------------------- */
    /* 💬 Send WhatsApp (interactive buttons with requestId)          */
    /* -------------------------------------------------------------- */
    const roleStr =
      body?.inheritedDuties || targetMember.instrument || "Performance";
    const feeStr = finalFee > 0 ? `£${finalFee}` : "TBC";

    const person = targetMember || {};
    const nameBits = normalizeNameBits(displayNameOf(person));

    console.log("📤 [WA SEND] Summary", {
      to: phone,
      role: roleStr,
      fee: feeStr,
      date: formattedDate,
      shortAddress,
      actName: act.tscName || act.name,
      isDeputy,
      selectedVocalistName: setAlways.selectedVocalistName,
      vocalistName: setAlways.vocalistName,
      photoUrl: setAlways.photoUrl,
      profileUrl: setAlways.profileUrl,
      requestId,
    });

    const buttons = [
      { id: `YES:${requestId}`, title: "Yes" },
      { id: `NO:${requestId}`, title: "No" },
      { id: `UNAVAILABLE:${requestId}`, title: "Unavailable" },
    ];

    const msg = await sendWhatsAppMessage({
      to: phone,
      actData: act,
      lineup: lineup || {},
      member: person,
      address: metaAddress,
      dateISO,
      role: roleStr,
      variables: {
        firstName: nameBits.firstName || nameBits.displayName || "Musician",
        date: formattedDate,
        location: shortAddress, // ✅ COUNTY + POSTCODE
        fee: String(finalFee),
        role: roleStr,
        actName: act.tscName || act.name,
      },
      requestId, // 🔗 correlation
      buttons, // 🔗 interactive quick replies
      smsBody: `Hi ${
        targetMember.firstName || "there"
      }, you've received an enquiry for a gig on ${formattedDate} in ${shortAddress} at a rate of ${feeStr} for ${roleStr} duties with ${
        act.tscName || act.name
      }. Please indicate your availability 💫`,
    });

    // Persist Twilio SID (requestId already stored above)
    try {
      await AvailabilityModel.updateOne(
        { _id: saved._id },
        { $set: { messageSidOut: msg?.sid || null } },
      );
    } catch (e) {
      console.warn(
        "⚠️ Could not persist messageSidOut (single):",
        e?.message || e,
      );
    }

    if (!isDeputy) {
      await scheduleDeputyEscalation({
        availabilityId: saved?._id || null,
        actId,
        lineupId: lineup?._id || lineupId || null,
        dateISO,
        phone,
        slotIndex: singleSlotIndex,
        formattedAddress: fullFormattedAddress,
        clientName: resolvedClientName || "",
        clientEmail: resolvedClientEmail || "",
      });
    }

    console.log(`📲 WhatsApp sent successfully — ${feeStr}`);
    if (res) return res.json({ success: true, sent: 1 });
    return { success: true, sent: 1 };
  } catch (err) {
    console.error("❌ triggerAvailabilityRequest error:", err);
    if (res)
      return res.status(500).json({ success: false, message: err.message });
    return { success: false, error: err.message };
  }
};

// -------------------- Delivery/Read Receipts --------------------
// module-scope guard so we don't double-fallback on Twilio retries
export const twilioStatus = async (req, res) => {
  console.log(
    `🟢 (availabilityController.js) twilioStatus START ${new Date().toISOString()}`,
  );
  try {
    const {
      MessageSid,
      MessageStatus, // delivered, failed, undelivered, read, sent, queued...
      SmsStatus, // sometimes used
      To,
      From,
      ErrorCode,
      ErrorMessage,
    } = req.body || {};

    const status = String(
      req.body?.MessageStatus ??
        req.body?.SmsStatus ??
        req.body?.message_status ??
        "",
    ).toLowerCase();

    console.log("📡 Twilio status:", {
      sid: MessageSid,
      status,
      to: To,
      from: From,
      err: ErrorCode || null,
      errMsg: ErrorMessage || null,
    });

    // 🔗 Optional: reflect outbound status on the availability row
    if (MessageSid) {
      const update = {
        $set: {
          "outbound.status": status,
          "outbound.lastEventAt": new Date(),
        },
      };
      if (status === "read") update.$set["outbound.readAt"] = new Date();
      if (ErrorCode) {
        update.$set["outbound.errorCode"] = ErrorCode;
        update.$set["outbound.errorMessage"] = ErrorMessage || "";
      }

      await AvailabilityModel.updateOne({ messageSidOut: MessageSid }, update);
    }

    return res.status(200).send("OK"); // Twilio needs 2xx
  } catch (e) {
    console.error("❌ twilioStatus error:", e);
    return res.status(200).send("OK"); // still 200 to stop retries
  }
};

export async function notifyDeputyOneShot(req, res) {
  try {
    const { actId, lineupId, dateISO, deputy, clientName, clientEmail } =
      req.body;

    const act = await Act.findById(actId).lean();
    if (!act)
      return res.status(404).json({ success: false, message: "Act not found" });

    const formattedAddress = act.formattedAddress || act.venueAddress || "TBC";

    await triggerAvailabilityRequest({
      actId,
      lineupId,
      dateISO,
      formattedAddress,
      clientName,
      clientEmail,
      isDeputy: true,
      deputy,
    });

    res.json({ success: true, message: "Deputy notified successfully" });
  } catch (err) {
    console.error("❌ notifyDeputyOneShot failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ✅ Drop-in replacement: Twilio inbound handler with robust identity resolution,
// badge rebuilds on YES/UNAVAILABLE, and single clean SSE broadcast.
// Assumes AvailabilityModel, Musician, Act, notifyDeputies, rebuildAndApplyAvailabilityBadge,
// getDeputyDisplayBits, findCanonicalMusicianByPhone, normalizeToE164, normalizeFrom,
// seenInboundOnce, parsePayload, classifyReply, sendWhatsAppText are available in scope.

export const twilioInbound = async (req, res) => {
  console.log(`🟢 [twilioInbound] START at ${new Date().toISOString()}`);

  // ✅ Immediately acknowledge Twilio to prevent retries
  res.status(200).send("OK");

  // --- local helpers (self-contained, no external deps required) ---
  const FRONTEND_BASE =
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_SITE_BASE ||
    "https://meek-biscotti-8d5020.netlify.app";

  const pickPicLocal = (m = {}) =>
    m.photoUrl ||
    m.musicianProfileImageUpload ||
    m.profileImage ||
    m.imageUrl ||
    m.profilePicture ||
    m.musicianProfileImage ||
    null;

  const resolveDisplayName = (row, musician) => {
    const fromRow = (
      row?.selectedVocalistName ||
      row?.vocalistName ||
      row?.musicianName ||
      ""
    ).trim();
    if (fromRow) return fromRow;
    const fromMus =
      `${musician?.firstName || ""} ${musician?.lastName || ""}`.trim();
    return fromMus || "Vocalist";
  };

  // tiny safe getter for odd webhook keys (with bracket names)
  const pick = (obj, ...keys) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return null;
  };

  // E.164 normalizer for WaId/From
  const normE164 = (raw = "") => {
    let v = String(raw || "")
      .trim()
      .replace(/^whatsapp:/i, "")
      .replace(/\s+/g, "");
    if (!v) return "";
    if (v.startsWith("+")) return v;
    if (/^44\d+$/.test(v)) return `+${v}`;
    if (/^0\d{10}$/.test(v)) return `+44${v.slice(1)}`;
    if (/^\d{10,13}$/.test(v))
      return v.startsWith("44") ? `+${v}` : `+44${v.replace(/^0?/, "")}`;
    return v;
  };

  const classifyReply = (s = "") => {
    const t = String(s || "")
      .trim()
      .toLowerCase();
    if (!t) return null;
    if (/^y(es)?$/.test(t)) return "yes";
    if (/^un/.test(t)) return "unavailable";
    if (/^n(o)?$/.test(t)) return "no";
    return null;
  };

  // Covers Content API & non-Content interactive payloads (legacy)
  function parseInteractive(body) {
    const id =
      pick(
        body,
        "ButtonResponse[Id]",
        "ButtonPayload",
        "ListResponse[Id]",
        "ListId",
      ) || null;
    const title =
      pick(
        body,
        "ButtonResponse[Text]",
        "ButtonText",
        "ListResponse[Title]",
        "ListTitle",
      ) || null;

    if (!id) return { requestId: null, reply: null, source: null, title: null };

    // Expect "YES:RID" / "NO:RID" / "UNAVAILABLE:RID" on non-Content
    const [raw, rid] = String(id).split(":");
    const reply = raw?.toLowerCase().startsWith("yes")
      ? "yes"
      : raw?.toLowerCase().startsWith("un")
        ? "unavailable"
        : raw?.toLowerCase().startsWith("no")
          ? "no"
          : null;

    return {
      requestId: (rid || "").toUpperCase() || null,
      reply,
      source: "button",
      title,
    };
  }

  function parseText(body) {
    const text = String(body?.Body || "").trim();
    if (!text) return { requestId: null, reply: null, source: null };

    // allow inline "#ABC123" anywhere in text
    const m = text.match(/#([A-Z0-9]{5,12})/i);
    const requestId = m ? m[1].toUpperCase() : null;

    const t = text.replace(/#\w+/g, "").trim().toLowerCase();
    const reply = t.startsWith("y")
      ? "yes"
      : t.startsWith("un")
        ? "unavailable"
        : t.startsWith("n")
          ? "no"
          : null;

    return { requestId, reply, source: "text" };
  }
  // --- end helpers ---

  setImmediate(() => {
    (async () => {
      try {
        const bodyObj = req.body || {};

        // detect empty payloads
        const noContent =
          !String(bodyObj?.ButtonPayload || "") &&
          !String(bodyObj?.ButtonText || "") &&
          !String(bodyObj?.Body || "") &&
          !bodyObj["ButtonResponse[Id]"] &&
          !bodyObj["ButtonResponse[Text]"] &&
          !bodyObj["ListResponse[Id]"] &&
          !bodyObj["ListResponse[Title]"];
        const inboundSid = String(
          bodyObj?.MessageSid || bodyObj?.SmsMessageSid || "",
        );
        const fromRaw = String(bodyObj?.WaId || bodyObj?.From || "");
        if (noContent)
          return console.log("🪵 Ignoring empty inbound message", {
            From: fromRaw,
          });

        if (
          typeof seenInboundOnce === "function" &&
          seenInboundOnce(inboundSid)
        ) {
          console.log("🪵 Duplicate inbound — already handled", {
            MessageSid: inboundSid,
          });
          return;
        }

        // snapshot for debugging
        const bodyText = String(bodyObj?.Body || "");
        const btnText =
          pick(
            bodyObj,
            "ButtonText",
            "ButtonResponse[Text]",
            "Interactive[ButtonReply][Title]",
          ) || "";
        const btnId =
          pick(
            bodyObj,
            "ButtonPayload", // Content quick reply → ID (static, from template)
            "ButtonResponse[Id]", // non-Content interactive
            "ListResponse[Id]", // list id
            "Interactive[ButtonReply][Id]", // alternative shape
          ) || "";

        // Deterministic join to the exact outbound message we sent
        const repliedSid =
          pick(
            bodyObj,
            "OriginalRepliedMessageSid",
            "InReplyToSid",
            "QuotedMessageSid",
          ) || null;

        // First-pass reply classification
        let reply =
          classifyReply(btnText) ||
          classifyReply(btnId) ||
          classifyReply(bodyText) ||
          null;

        // Accept: "YES:RID", "YES RID", "YES-RID", "YESRID" (no delimiter), or just "RID"
        const tryExtractRid = (s) => {
          if (!s) return null;
          const t = String(s).trim();

          // 1) YES/NO/UNAVAILABLE with optional delimiter + RID
          const m1 = t.match(
            /^(?:YES|NO|UNAVAILABLE)[:\s-]?([A-Z0-9]{5,12})$/i,
          );
          if (m1) return m1[1].toUpperCase();

          // 2) plain RID alone
          const m2 = t.match(/^([A-Z0-9]{5,12})$/i);
          if (m2) return m2[1].toUpperCase();

          return null;
        };

        // RID extraction from multiple carriers
        let requestId =
          tryExtractRid(btnId) ||
          tryExtractRid(btnText) ||
          (String(bodyText || "").match(/#([A-Z0-9]{5,12})/i) || [])[1] ||
          null;

        // Legacy parsers as soft fallback (do NOT shadow vars)
        const iParse = parseInteractive(bodyObj);
        if (!requestId && iParse.requestId) requestId = iParse.requestId;
        if (!reply && iParse.reply) reply = iParse.reply;

        const tParse = parseText(bodyObj);
        if (!requestId && tParse.requestId) requestId = tParse.requestId;
        if (!reply && tParse.reply) reply = tParse.reply;

        // Legacy payload JSON (safe try)
        try {
          const parsedPayload = parsePayload ? parsePayload(btnId) : null;
          if (!reply && parsedPayload?.reply) reply = parsedPayload.reply;
        } catch {}

        if (requestId) requestId = requestId.toUpperCase();
        if (!reply) reply = "no"; // very defensive default

        const sender = normE164(fromRaw);

        console.log("📥 [twilioInbound] RAW SNAPSHOT", {
          keys: Object.keys(bodyObj),
          Body_preview: bodyText.slice(0, 120),
          ButtonText: btnText,
          ButtonPayload: btnId,
          WaId: bodyObj?.WaId,
          From: bodyObj?.From,
          sender_norm: sender,
          MessageSid: inboundSid,
          OriginalRepliedMessageSid: repliedSid,
        });

        console.log("🧷 [twilioInbound] Parsed intent", {
          reply,
          requestId,
          repliedSid,
        });

        /* ---------------------------------------------------------------------- */
        /* 🎯 Locate the Availability row to update                               */
        /*   1) Strict: requestId                                                 */
        /*   2) Deterministic: repliedSid → outboundSid                           */
        /*   3) Fallback: latest row by phone, v2, awaiting reply                 */
        /* ---------------------------------------------------------------------- */
        let updated = null;

        if (requestId) {
          updated = await AvailabilityModel.findOneAndUpdate(
            { requestId },
            {
              $set: {
                reply,
                repliedAt: new Date(),
                "inbound.sid": inboundSid || null,
                "inbound.repliedSid": repliedSid || null,
                "inbound.body": bodyText || "",
                "inbound.buttonText": btnText || null,
                "inbound.buttonPayload": btnId || null,
                "inbound.source": "button-or-text",
                "inbound.requestId": requestId,
              },
            },
            { new: true },
          );
          if (!updated) {
            console.log(
              "⚠️ requestId not found, will try repliedSid/phone fallbacks",
              { requestId },
            );
          }
        }

        if (!updated && repliedSid) {
          updated = await AvailabilityModel.findOneAndUpdate(
            { outboundSid: repliedSid },
            {
              $set: {
                reply,
                repliedAt: new Date(),
                "inbound.sid": inboundSid || null,
                "inbound.repliedSid": repliedSid,
                "inbound.body": bodyText || "",
                "inbound.buttonText": btnText || null,
                "inbound.buttonPayload": btnId || null,
                "inbound.source": "button-or-text",
                ...(requestId
                  ? { requestId, "inbound.requestId": requestId }
                  : {}),
              },
            },
            { new: true },
          );
          if (!updated) {
            console.log("⚠️ repliedSid did not match any row by outboundSid", {
              repliedSid,
            });
          }
        }

        if (!updated && sender) {
          updated = await AvailabilityModel.findOneAndUpdate(
            {
              phone: sender,
              v2: true,
              $or: [
                { reply: { $exists: false } },
                { reply: null },
                { reply: "" },
              ],
            },
            {
              $set: {
                reply,
                repliedAt: new Date(),
                "inbound.sid": inboundSid || null,
                "inbound.repliedSid": repliedSid || null,
                "inbound.body": bodyText || "",
                "inbound.buttonText": btnText || null,
                "inbound.buttonPayload": btnId || null,
                "inbound.source": "button-or-text",
                ...(requestId
                  ? { requestId, "inbound.requestId": requestId }
                  : {}),
              },
            },
            { new: true, sort: { createdAt: -1 } },
          );
        }

        if (!updated) {
          const candidateCount = await AvailabilityModel.countDocuments({
            phone: sender,
            v2: true,
          });
          console.warn(
            "⚠️ No matching AvailabilityModel found for inbound reply.",
            {
              sender,
              candidateCount,
              hint: "With Content quick replies, some payloads lack RID. We now try requestId, then OriginalRepliedMessageSid→outboundSid, then latest 'awaiting reply' by phone.",
            },
          );
          return; // bail early like before
        }

        // 🔎 Resolve canonical Musician by phone (preferred) or by row's musicianId
        const byPhone = await findCanonicalMusicianByPhone(updated.phone);
        let musician =
          byPhone ||
          (updated?.musicianId
            ? await Musician.findById(updated.musicianId).lean()
            : null);

        // If deputy row is carrying ACT collection id, re-point to canonical Musician id
        if (
          updated.isDeputy &&
          musician &&
          String(updated.musicianId) !== String(musician._id)
        ) {
          await AvailabilityModel.updateOne(
            { _id: updated._id },
            {
              $set: {
                musicianId: musician._id,
                musicianName:
                  `${musician.firstName || ""} ${musician.lastName || ""}`.trim(),
                musicianEmail: musician.email || updated.musicianEmail || "",
                photoUrl: pickPicLocal(musician),
                profileUrl: `${FRONTEND_BASE}/musician/${musician._id}`,
              },
            },
          );

          // keep in-memory copy in sync for the rest of this handler
          updated.musicianId = musician._id;
          updated.musicianName =
            `${musician.firstName || ""} ${musician.lastName || ""}`.trim();
          updated.musicianEmail = musician.email || updated.musicianEmail;
          updated.photoUrl = pickPicLocal(musician) || updated.photoUrl;
          updated.profileUrl = `${FRONTEND_BASE}/musician/${musician._id}`;
        }

        const displayName = resolveDisplayName(updated, musician);

        // 📛 Ensure the row carries a stable vocalistName for downstream badge/name use
        if (displayName && updated?.vocalistName !== displayName) {
          await AvailabilityModel.updateOne(
            { _id: updated._id },
            {
              $set: {
                vocalistName: displayName,
                musicianName: updated?.musicianName || displayName, // keep old field too
              },
            },
          );
          updated.vocalistName = displayName; // in-memory
          if (!updated.musicianName) updated.musicianName = displayName;
        }

        // 🧩 Slot + deputy flags
        const slotIndex =
          typeof updated.slotIndex === "number" ? updated.slotIndex : null;
        console.log("🎯 [twilioInbound] Matched slotIndex:", slotIndex);

        const isDeputy = Boolean(updated?.isDeputy);
        if (isDeputy && updated?.isDeputy !== true) {
          await AvailabilityModel.updateOne(
            { _id: updated._id },
            { $set: { isDeputy: true } },
          );
          updated.isDeputy = true;
        }

        // 🔍 Ensure we have a musician doc when possible (fallbacks preserved)
        if (!musician && updated?.musicianId) {
          musician = await Musician.findById(updated.musicianId).lean();
        }
        if (!musician && updated?.musicianName) {
          const parts = String(updated.musicianName).trim().split(/\s+/);
          musician = await Musician.findOne({
            $or: [
              { name: updated.musicianName },
              { firstName: new RegExp(parts[0] || "", "i") },
              { lastName: new RegExp(parts.slice(-1)[0] || "", "i") },
            ],
          })
            .select(
              "email firstName lastName musicianProfileImageUpload musicianProfileImage profileImage profilePicture photoUrl imageUrl _id",
            )
            .lean();
        }

        // 🔹 Enrich identity bits (email/photo/profile) from either row or musician
        const bits = await getDeputyDisplayBits({
          ...((musician && musician.toObject
            ? musician.toObject()
            : musician) || {}),
          ...((updated && updated.toObject ? updated.toObject() : updated) ||
            {}),
        });

        const emailForInvite =
          bits?.resolvedEmail ||
          musician?.email ||
          updated?.musicianEmail ||
          updated?.email ||
          "hello@thesupremecollective.co.uk";

        console.log("📧 [twilioInbound] Using emailForInvite:", emailForInvite);

        const actId = String(updated.actId);
        const dateISO = updated.dateISO;
        const toE164 = normE164(updated.phone || fromRaw);

        // 🧭 Resolve Act reliably
        let act = null;
        try {
          const actIdValue = updated?.actId?._id || updated?.actId;
          if (actIdValue) {
            act = await Act.findById(actIdValue).lean();
            console.log(
              "📡 Act resolved for notifyDeputies:",
              act?.tscName || act?.name,
            );
          }
        } catch (err) {
          console.warn(
            "⚠️ Failed to resolve act from updated.actId:",
            err.message,
          );
        }

        // ──────────────────────────────────────────────────────────────
        console.log("──────────────────────────────────────────────");
        console.log(
          `📩 Twilio Inbound (${reply?.toUpperCase?.() || "UNKNOWN"}) for ${act?.tscName || "Unknown Act"}`,
        );
        console.log(
          `👤 ${musician?.firstName || updated?.musicianName || "Unknown Musician"}`,
        );
        console.log(`📅 ${updated?.dateISO || "Unknown Date"}`);
        console.log(`📧 ${emailForInvite}`);
        console.log("──────────────────────────────────────────────");

        /* ---------------------------------------------------------------------- */
        /* ✅ YES BRANCH (Lead or Deputy)                                         */
        /* ---------------------------------------------------------------------- */
        if (reply === "yes") {
          console.log(
            `✅ YES reply received via WhatsApp (${isDeputy ? "Deputy" : "Lead"})`,
          );

          const { createCalendarInvite, cancelCalendarInvite } =
            await import("./googleController.js");

          // 1️⃣ Create/refresh calendar invite
          console.log(
            "📧 [Calendar Debug] emailForInvite=",
            emailForInvite,
            "act=",
            !!act,
            "dateISO=",
            dateISO,
          );
          if (emailForInvite && act && dateISO) {
            const formattedDateString = new Date(dateISO).toLocaleDateString(
              "en-GB",
              {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              },
            );

            const fee =
              updated?.fee ||
              act?.lineups?.[0]?.bandMembers?.find((m) => m.isEssential)?.fee ||
              null;

            try {
              // 🧹 Cancel prior event if it exists, then create a fresh one
              if (updated?.calendarEventId && emailForInvite) {
                try {
                  console.log(
                    "🗓️ Cancelling old calendar event before new YES invite",
                  );
                  await cancelCalendarInvite({
                    eventId: updated.calendarEventId,
                    actId: act?._id || updated.actId,
                    dateISO: updated.dateISO,
                    email: emailForInvite,
                  });
                } catch (err) {
                  console.warn(
                    "⚠️ Failed to cancel old calendar event:",
                    err.message,
                  );
                }
              }

              const event = await createCalendarInvite({
                enquiryId: updated.enquiryId || `ENQ_${Date.now()}`,
                actId,
                dateISO,
                email: emailForInvite,
                summary: `TSC: ${act.tscName || act.name} enquiry`,
                description: [
                  `Event Date: ${formattedDateString}`,
                  `Act: ${act.tscName || act.name}`,
                  `Role: ${updated.duties || ""}`,
                  `Address: ${updated.formattedAddress || "TBC"}`,
                  `Fee: £${fee || "TBC"}`,
                ].join("\n"),
                startTime: `${dateISO}T17:00:00Z`,
                endTime: `${dateISO}T23:59:00Z`,
                fee,
              });

              console.log("📅 Calendar invite sent:", emailForInvite, {
                eventId: event?.id || event?.data?.id,
              });

              await AvailabilityModel.updateOne(
                { _id: updated._id },
                {
                  $set: {
                    calendarEventId: event?.id || event?.data?.id || null,
                    calendarInviteEmail: emailForInvite,
                    calendarInviteSentAt: new Date(),
                    calendarStatus: "needsAction",
                  },
                },
              );
            } catch (err) {
              console.error("❌ Calendar invite failed:", err.message);
            }
          }

          console.log(
            "🟦 About to sendWhatsAppMessage using content SID:",
            process.env.TWILIO_ENQUIRY_SID,
          );
          await sendWhatsAppText(
            toE164,
            "Super — we’ll send a diary invite to log the enquiry for your records.",
          );

          // 2️⃣ Mark as read + (if deputy) persist flag
          await AvailabilityModel.updateOne(
            { _id: updated._id },
            {
              $set: { status: "read", ...(isDeputy ? { isDeputy: true } : {}) },
            },
          );
          // ✅ On YES, cancel any pending escalations for this slot/lead
          await cancelDeputyEscalation({
            actId,
            dateISO,
            phone: updated.phone,
            slotIndex,
          });
          // 3️⃣ Rebuild badge NOW (prevents flicker/drops)
          let badgeResult = null;
          try {
            badgeResult = await rebuildAndApplyAvailabilityBadge({
              actId,
              dateISO,
              __fromYesFlow: true,
            });
          } catch (e) {
            console.warn("⚠️ Badge rebuild failed:", e?.message || e);
          }

          // 4️⃣ SSE broadcast (single clean event + badgeUpdated)
          if (global.availabilityNotify) {
            const payload = {
              actId,
              actName: act?.tscName || act?.name,
              musicianName: displayName,
              dateISO,
              musicianId: musician?._id || updated?.musicianId || null,
            };

            if (isDeputy && global.availabilityNotify.deputyYes) {
              global.availabilityNotify.deputyYes(payload);
            }
            if (!isDeputy && global.availabilityNotify.leadYes) {
              global.availabilityNotify.leadYes(payload);
            }
            if (badgeResult?.badge && global.availabilityNotify.badgeUpdated) {
              global.availabilityNotify.badgeUpdated({
                actId,
                actName: act?.tscName || act?.name,
                dateISO,
                badge: badgeResult.badge,
              });
            }
          }

          console.log("📡 SSE broadcasted: availability_badge_updated");
          return;
        } // ← YES branch

        /* ---------------------------------------------------------------------- */
        /* 🚫 NO / UNAVAILABLE / NOLOC / NOLOCATION BRANCH                         */
        /* ---------------------------------------------------------------------- */
        if (["no", "unavailable", "noloc", "nolocation"].includes(reply)) {
          console.log("🚫 UNAVAILABLE reply received via WhatsApp");

          // 🔎 Only send cancellation email if they previously confirmed YES for THIS enquiry (date + location)
          const addressKey = (s = "") =>
            String(s || "")
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim();

          const thisAddr =
            addressKey(updated.formattedAddress || "") ||
            addressKey(act?.formattedAddress || "") ||
            "tbc";

          // identify the musician consistently
          const identity = {
            actId: updated.actId?._id || updated.actId,
            dateISO: updated.dateISO,
            v2: true,
            $or: [
              ...(updated?.musicianId
                ? [{ musicianId: updated.musicianId }]
                : []),
              ...(sender ? [{ phone: sender }] : []),
              ...(emailForInvite
                ? [{ musicianEmail: String(emailForInvite).toLowerCase() }]
                : []),
            ],
          };

          // find a prior "confirmed" row for SAME location
          const previouslyConfirmedRow = await AvailabilityModel.findOne({
            ...identity,
            // same location where possible (exact match on formattedAddress; we also do a key compare below)
            ...(updated.formattedAddress
              ? { formattedAddress: updated.formattedAddress }
              : {}),
            $or: [
              { reply: "yes" },
              { calendarEventId: { $exists: true, $ne: null } },
              { calendarInviteSentAt: { $exists: true, $ne: null } },
              {
                calendarStatus: {
                  $in: ["needsAction", "accepted", "tentative"],
                },
              },
            ],
          })
            .sort({ repliedAt: -1, updatedAt: -1, createdAt: -1 })
            .lean();

          // if formattedAddress wasn’t present / exact match didn’t hit, do a looser match:
          let shouldSendCancellationEmail = false;
          let cancelEventId = null;

          if (previouslyConfirmedRow) {
            // if we *can* compare address keys, enforce it
            const prevAddr = addressKey(
              previouslyConfirmedRow.formattedAddress || "",
            );
            const addrMatches = !prevAddr || prevAddr === thisAddr;

            if (addrMatches) {
              shouldSendCancellationEmail = true;
              cancelEventId = previouslyConfirmedRow.calendarEventId || null;
            }
          }

          // If THIS row itself already has a calendar event id, that's enough to justify cancel+email
          if (!shouldSendCancellationEmail && updated?.calendarEventId) {
            shouldSendCancellationEmail = true;
            cancelEventId = updated.calendarEventId;
          }

          console.log("📧 [twilioInbound] Cancellation email gate", {
            shouldSendCancellationEmail,
            thisAddr,
            matchedRowId: previouslyConfirmedRow?._id
              ? String(previouslyConfirmedRow._id)
              : null,
            cancelEventId,
          });

          await AvailabilityModel.updateMany(
            {
              musicianEmail: (emailForInvite || "").toLowerCase(),
              dateISO: updated.dateISO,
            },
            {
              $set: {
                status: "unavailable",
                reply: "unavailable",
                repliedAt: new Date(),
                calendarStatus: "cancelled",
              },
            },
          );
          console.log(
            `🚫 Marked all enquiries for ${emailForInvite} on ${updated.dateISO} as unavailable`,
          );

          // 🗓️ Cancel calendar event (ONLY if they previously confirmed / had invite)
          if (shouldSendCancellationEmail && cancelEventId) {
            try {
              const { cancelCalendarInvite } =
                await import("./googleController.js");
              await cancelCalendarInvite({
                eventId: cancelEventId,
                dateISO: updated.dateISO,
                email: emailForInvite,
              });
              console.log("🗓️ Cancelled calendar invite", {
                cancelEventId,
                emailForInvite,
              });
            } catch (err) {
              console.error("❌ Failed to cancel shared event:", err.message);
            }
          }

          // 🔔 Rebuild badge immediately
          let rebuilt = null;
          try {
            rebuilt = await rebuildAndApplyAvailabilityBadge({
              actId,
              dateISO,
              __fromUnavailable: true,
            });
          } catch (e) {
            console.warn(
              "⚠️ Badge rebuild (unavailable) failed:",
              e?.message || e,
            );
          }

          // 🗑️ Clear legacy badge keys in Act (tbc/non-tbc map keys)
          try {
            const unset = {
              [`availabilityBadges.${dateISO}_tbc`]: "",
            };
            await Act.updateOne({ _id: actId }, { $unset: unset });
            console.log("🗑️ Cleared legacy TBC badge key for:", dateISO);
          } catch (err) {
            console.error(
              "❌ Failed to $unset legacy TBC badge key:",
              err.message,
            );
          }

          await sendWhatsAppText(
            toE164,
            "Thanks for letting us know — we've updated your availability.",
          );

          // ✅ Trigger deputies when LEAD replies negative
          const shouldTriggerDeputies =
            !isDeputy &&
            ["unavailable", "no", "noloc", "nolocation"].includes(reply);

          if (act?._id && shouldTriggerDeputies) {
            console.log(
              `📢 Triggering deputy notifications for ${act?.tscName || act?.name} — ${dateISO}`,
            );
            await notifyDeputies({
              actId: act._id,
              lineupId: updated.lineupId || act.lineups?.[0]?._id || null,
              dateISO,
              formattedAddress:
                updated.formattedAddress || act.formattedAddress || "TBC",
              clientName: updated.clientName || "",
              clientEmail: updated.clientEmail || "",
              slotIndex, // keep grouping aligned
              skipDuplicateCheck: true,
              skipIfUnavailable: false,
            });
            console.log(
              "📤 notifyDeputies triggered with slotIndex:",
              slotIndex,
            );
          } else if (isDeputy && reply === "unavailable") {
            console.log("📨 Deputy unavailable — trigger next deputy in queue");
            await triggerNextDeputy({
              actId: act._id,
              lineupId: updated.lineupId || act.lineups?.[0]?._id || null,
              dateISO,
              excludePhones: [
                updated.phone,
                updated.whatsappNumber,
                ...(await AvailabilityModel.distinct("phone", {
                  actId,
                  dateISO,
                  reply: { $in: ["unavailable", "yes"] },
                })),
              ],
            });
          }

          await cancelDeputyEscalation({
            actId,
            dateISO,
            phone: updated.phone,
            slotIndex,
          });

          // 📨 Courtesy cancellation email (ONLY if they previously confirmed / had invite)
          if (shouldSendCancellationEmail) {
            try {
              const { sendEmail } = await import("../utils/sendEmail.js");

              const subject = `${act?.tscName || act?.name}: Diary Invite Cancelled for ${new Date(dateISO).toLocaleDateString("en-GB")}`;
              const html = `
      <p><strong>${updated?.musicianName || musician?.firstName || "Musician"}</strong>,</p>
      <p>Thanks for letting us know — we’ve updated your availability.</p>
      <p>Your diary invite for <b>${act?.tscName || act?.name}</b> on <b>${new Date(dateISO).toLocaleDateString("en-GB")}</b> has been cancelled.</p>
      <p>If your availability changes, just reply to the WhatsApp message to re-confirm.</p>
      <br/>
      <p>– The Supreme Collective Team</p>
    `;

              const leadEmail = (emailForInvite || "").trim();
              const recipients = [leadEmail].filter(
                (e) => e && e.includes("@"),
              );

              if (recipients.length) {
                await sendEmail({
                  to: recipients,
                  bcc: ["hello@thesupremecollective.co.uk"],
                  subject,
                  html,
                });
                console.log("✅ Cancellation email sent", { to: recipients });
              } else {
                console.warn(
                  "⚠️ Skipping cancellation email — no valid recipient",
                );
              }
            } catch (emailErr) {
              console.error(
                "❌ Failed to send cancellation email:",
                emailErr.message,
              );
            }
          } else {
            console.log(
              "📭 Skipping cancellation email (no prior YES/invite for this enquiry).",
            );
          }

          // 🔒 Lock meta so lead badge stays cleared if appropriate
          const update = {
            $unset: {
              [`availabilityBadges.${dateISO}`]: "",
              [`availabilityBadges.${dateISO}_tbc`]: "",
            },
          };
          if (
            !isDeputy &&
            ["unavailable", "no", "noloc", "nolocation"].includes(reply)
          ) {
            update.$set = {
              [`availabilityBadgesMeta.${dateISO}.lockedByLeadUnavailable`]: true,
            };
          }
          await Act.updateOne({ _id: actId }, update);
          console.log(
            "🔒 Lead marked UNAVAILABLE — badge locked for date:",
            dateISO,
          );

          // 📡 SSE: push rebuilt badge to clients
          if (rebuilt?.badge && global.availabilityNotify?.badgeUpdated) {
            global.availabilityNotify.badgeUpdated({
              actId,
              actName: act?.tscName || act?.name,
              dateISO,
              badge: rebuilt.badge,
            });
          }

          return;
        } // ← UNAVAILABLE branch

        // If we reach here, reply type wasn’t handled (e.g., "maybe")
        console.log(
          "ℹ️ Inbound reply ignored (not YES/NO/UNAVAILABLE/NOL0C):",
          reply,
        );
      } catch (err) {
        console.error("❌ Error in twilioInbound background task:", err);
      }
    })(); // async IIFE
  }); // setImmediate
};

const INBOUND_SEEN = new Map();
const INBOUND_TTL_MS = 10 * 60 * 1000;

function seenInboundOnce(sid) {
  console.log(
    `🟢 (availabilityController.js) seenInboundOnce START at ${new Date().toISOString()}`,
    {},
  );
  if (!sid) return false;
  const now = Date.now();
  for (const [k, t] of INBOUND_SEEN) {
    if (now - t > INBOUND_TTL_MS) INBOUND_SEEN.delete(k);
  }
  if (INBOUND_SEEN.has(sid)) return true;
  INBOUND_SEEN.set(sid, now);
  return false;
}

// Format date like "Saturday, 5th Oct 2025"
const formatWithOrdinal = (dateLike) => {
  console.log(
    `🟢 (availabilityController.js) formatWithOrdinal START at ${new Date().toISOString()}`,
    {},
  );
  const d = new Date(dateLike);
  if (isNaN(d)) return String(dateLike);
  const day = d.getDate();
  const j = day % 10,
    k = day % 100;
  const suffix =
    j === 1 && k !== 11
      ? "st"
      : j === 2 && k !== 12
        ? "nd"
        : j === 3 && k !== 13
          ? "rd"
          : "th";
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const month = d.toLocaleDateString("en-GB", { month: "short" }); // Oct
  const year = d.getFullYear();
  return `${weekday}, ${day}${suffix} ${month} ${year}`;
};

const firstNameOf = (p) => {
  console.log(
    `🟢 (availabilityController.js) firstNameOf START at ${new Date().toISOString()}`,
    {},
  );
  if (!p) return "there";

  // If it's a string like "Miça Townsend"
  if (typeof p === "string") {
    const parts = p.trim().split(/\s+/);
    return parts[0] || "there";
  }

  // Common first-name keys
  const direct =
    p.firstName ||
    p.FirstName ||
    p.first_name ||
    p.firstname ||
    p.givenName ||
    p.given_name ||
    "";

  if (direct && String(direct).trim()) {
    return String(direct).trim().split(/\s+/)[0];
  }

  // Fall back to splitting a full name
  const full = p.name || p.fullName || p.displayName || "";
  if (full && String(full).trim()) {
    return String(full).trim().split(/\s+/)[0];
  }

  return "there";
};
// -------------------- Outbound Trigger --------------------

// ✅ Unified version ensuring correct photoUrl vs profileUrl distinction

// -------------------- SSE Broadcaster --------------------

// availabilityNotify.js (or wherever you define global.availabilityNotify / broadcast helpers)
const recentEvents = new Map(); // module-scope TTL cache

function dedupeAndBroadcast(key, emitFn) {
  if (recentEvents.has(key)) return;
  recentEvents.set(key, Date.now());
  setTimeout(() => recentEvents.delete(key), 2000);
  emitFn();
}

// Example wiring with socket.io `io.emit` (adjust to your emitter)
global.availabilityNotify = {
  leadYes: (p) =>
    dedupeAndBroadcast(`${p.actId}:${p.dateISO}:leadYes:${p.musicianId}`, () =>
      io.emit("lead_yes", p),
    ),
  deputyYes: (p) =>
    dedupeAndBroadcast(
      `${p.actId}:${p.dateISO}:deputyYes:${p.musicianId}`,
      () => io.emit("deputy_yes", p),
    ),
  badgeUpdated: (p) =>
    dedupeAndBroadcast(`${p.actId}:${p.dateISO}:badgeUpdated`, () =>
      io.emit("availability_badge_updated", p),
    ),
};

// If you don't wrap global, you can inline this exactly before any broadcast:
///
/// const key = `${actId}:${dateISO}:leadYes:${musicianId}`;
// if (recentEvents.has(key)) return;
// recentEvents.set(key, Date.now());
// setTimeout(() => recentEvents.delete(key), 2000);
// io.emit('lead_yes', payload);

// ───────────────────────────────────────────────────────────────────────────────
// makeAvailabilityBroadcaster — with identity-focused console logging
// ───────────────────────────────────────────────────────────────────────────────
export const makeAvailabilityBroadcaster = (broadcastFn) => {
  /* ------------------------------- helpers ------------------------------- */
  const toStr = (v) => (typeof v === "string" ? v : "");
  const norm = (s) => toStr(s).trim().toLowerCase();

  const splitName = (name) => {
    const n = toStr(name).trim();
    if (!n) return { first: "", last: "" };
    const parts = n.split(/\s+/);
    const first = parts[0] || "";
    const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
    return { first, last };
  };

  const logIdentity = (label, obj = {}) => {
    const { first = "", last = "" } = splitName(
      obj.displayName || obj.vocalistDisplayName || obj.musicianName,
    );

    console.log(`📡 [SSE] ${label}`, {
      actId: obj.actId,
      actName: obj.actName,
      dateISO: obj.dateISO,
      firstName: obj.firstName || first || undefined,
      lastName: obj.lastName || last || undefined,
      displayName:
        obj.displayName ||
        obj.musicianName ||
        obj.vocalistDisplayName ||
        undefined,
      vocalistDisplayName:
        obj.vocalistDisplayName || obj.displayName || undefined,
      profileUrl: obj.profileUrl || undefined,
      photoUrl: obj.photoUrl || undefined,
      address: obj.address || undefined,
      formattedAddress: obj.formattedAddress || undefined,
      isDeputy: obj.isDeputy === true,
      musicianId: obj.musicianId ? String(obj.musicianId) : undefined,
      slotIndex: obj.slotIndex ?? undefined,
      slotsCount: Array.isArray(obj.badge?.slots)
        ? obj.badge.slots.length
        : undefined,
    });
  };

  // Prefer badge.slots[*].primary as the single source of truth
  const snapshotFromSlot = (slot = {}) => {
    const primary = slot.primary || {};
    const dn =
      slot.vocalistName ||
      primary.vocalistDisplayName ||
      primary.displayName ||
      primary.musicianName ||
      "";

    const { first, last } = splitName(dn);

    return {
      firstName: first,
      lastName: last,
      displayName: dn || undefined,
      vocalistDisplayName: dn || undefined,
      profileUrl: primary.profileUrl || undefined,
      photoUrl: primary.photoUrl || undefined,
      isDeputy: Boolean(primary.isDeputy),
      musicianId: primary.musicianId || primary.id || slot.musicianId || null,
      slotIndex: slot.slotIndex,
      available: slot.available,
      covering: slot.covering,
    };
  };

  // Find the slot that corresponds to the deputy who replied YES
  const findSlotForDeputyYes = ({ badge, musicianId, musicianName }) => {
    const slots = Array.isArray(badge?.slots) ? badge.slots : [];
    if (!slots.length) return null;

    const mid = musicianId ? String(musicianId) : null;
    const mname = norm(musicianName);

    // 1) Strong match: musicianId against slot.primary.musicianId
    if (mid) {
      const byId = slots.find((s) => {
        const pid = s?.primary?.musicianId || s?.primary?.id;
        return pid && String(pid) === mid;
      });
      if (byId) return byId;
    }

    // 2) Name match against slot vocalist/primary names
    if (mname) {
      const byName = slots.find((s) => {
        const cand =
          norm(s?.vocalistName) ||
          norm(s?.primary?.vocalistDisplayName) ||
          norm(s?.primary?.displayName) ||
          norm(s?.primary?.musicianName);
        return cand && cand === mname;
      });
      if (byName) return byName;
    }

    // 3) Best-effort fallback: an "available deputy" slot
    const byDeputyAvailable =
      slots.find((s) => s?.covering === "deputy" && s?.available === true) ||
      slots.find((s) => Boolean(s?.primary?.isDeputy)) ||
      slots[0];

    return byDeputyAvailable || null;
  };

  return {
    /* ------------------------------ lead YES ------------------------------ */
    leadYes: ({
      actId,
      actName,
      musicianName,
      dateISO,
      musicianId,
      slotIndex,
    }) => {
      const { first, last } = splitName(musicianName);

      logIdentity("leadYes (pre-broadcast)", {
        actId,
        actName,
        dateISO,
        firstName: first,
        lastName: last,
        displayName: musicianName,
        vocalistDisplayName: musicianName,
        isDeputy: false,
        musicianId,
        slotIndex,
      });

      broadcastFn({
        type: "availability_yes", // frontend normalizes to "leadYes"
        actId,
        actName,
        musicianName: musicianName || "Lead Vocalist",
        musicianId: musicianId || null,
        dateISO,
        slotIndex: slotIndex ?? undefined, // harmless if frontend ignores
      });

      console.log("📤 [SSE] leadYes broadcast dispatched", {
        actId,
        actName,
        dateISO,
        musicianId: musicianId || null,
        slotIndex: slotIndex ?? undefined,
      });
    },

    /* ----------------------------- deputy YES ----------------------------- */
    deputyYes: ({
      actId,
      actName,
      musicianName,
      dateISO,
      badge,
      musicianId,
    }) => {
      // ✅ NEW: resolve identity from the correct slot.primary
      const slot = findSlotForDeputyYes({ badge, musicianId, musicianName });
      const snap = slot ? snapshotFromSlot(slot) : null;

      const deputyName =
        musicianName || snap?.vocalistDisplayName || "Deputy Vocalist";

      const { first, last } = splitName(deputyName);

      const profileUrl = snap?.profileUrl;
      const photoUrl = snap?.photoUrl;
      const resolvedMusicianId = musicianId || snap?.musicianId || null;
      const slotIndex = snap?.slotIndex;

      logIdentity("deputyYes (pre-broadcast)", {
        actId,
        actName,
        dateISO,
        firstName: first,
        lastName: last,
        displayName: deputyName,
        vocalistDisplayName: deputyName,
        profileUrl,
        photoUrl,
        isDeputy: true,
        musicianId: resolvedMusicianId,
        slotIndex,
        badge, // for slotsCount
      });

      broadcastFn({
        type: "availability_deputy_yes",
        actId,
        actName,
        musicianName: deputyName,
        musicianId: resolvedMusicianId,
        dateISO,
        slotIndex: slotIndex ?? undefined, // ✅ lets frontend update correct slot if desired
      });

      console.log("📤 [SSE] deputyYes broadcast dispatched", {
        actId,
        actName,
        dateISO,
        musicianId: resolvedMusicianId,
        slotIndex: slotIndex ?? undefined,
      });
    },

    /* --------------------------- full badge update -------------------------- */
    badgeUpdated: ({ actId, actName, dateISO, badge }) => {
      if (!badge) {
        console.log("🔕 [SSE] badge was null/undefined – skipping broadcast", {
          actId,
          dateISO,
        });
        return;
      }

      // Prefer a slot with a primary + a real musicianId if possible
      const slots = Array.isArray(badge.slots) ? badge.slots : [];
      const primarySlot =
        slots.find((s) => s?.primary?.musicianId || s?.primary?.id) ||
        slots.find((s) => s?.primary) ||
        slots[0];

      if (primarySlot) {
        const snap = snapshotFromSlot(primarySlot);
        logIdentity("badgeUpdated (primary slot snapshot)", {
          ...snap,
          actId,
          actName,
          dateISO,
          address: badge.address || undefined,
          formattedAddress:
            badge.formattedAddress || badge.address || undefined,
          badge,
        });
      } else {
        console.log("🟡 [SSE] badgeUpdated: no slots available to snapshot", {
          actId,
          actName,
          dateISO,
        });
      }

      broadcastFn({
        type: "availability_badge_updated",
        actId,
        actName,
        dateISO,
        badge,
      });

      console.log("📤 [SSE] badgeUpdated broadcast dispatched", {
        actId,
        actName,
        dateISO,
        slots: slots.length,
      });
    },
  };
};

export async function buildAvailabilityBadgeFromRows({
  actId,
  dateISO,
  hasLineups = true,
}) {
  console.log("🟣 buildAvailabilityBadgeFromRows START", {
    actId,
    dateISO,
    hasLineups,
  });

  const rows = await AvailabilityModel.find({
    actId,
    dateISO,
    reply: { $in: ["yes", "no", "unavailable", null] },
    v2: true,
  })
    .select(
      [
        "musicianId",
        "slotIndex",
        "reply",
        "updatedAt",
        "repliedAt",
        "isDeputy",
        "photoUrl",
        "profileUrl", // ✅ you referenced this later but weren't selecting it
        "phone",
        "musicianEmail",
        "formattedAddress",
        "vocalistName",
        "musicianName",
        "selectedVocalistName",
      ].join(" "),
    )
    .lean();

  console.log(
    "📥 buildBadge: availability rows (identity snapshot):",
    rows.map((r) => ({
      slotIndex: r.slotIndex,
      reply: r.reply,
      updatedAt: r.updatedAt,
      isDeputy: r.isDeputy,
      musicianId: r.musicianId,
      vocalistName: r.vocalistName,
      photoUrl: r.photoUrl,
      profileUrl: r.profileUrl,
      phone: r.phone,
      formattedAddress: r.formattedAddress,
    })),
  );

  if (!rows.length) return null;

  // ---------- helpers ----------
  const normaliseUrl = (u) => {
    if (typeof u !== "string") return null;
    const s = u.trim();
    if (!s) return null;
    if (s.startsWith("//")) return `https:${s}`;
    if (/^res\.cloudinary\.com\//i.test(s)) return `https://${s}`;
    return s;
  };

  const isHttp = (u) => {
    const s = normaliseUrl(u);
    return typeof s === "string" && /^https?:\/\//i.test(s);
  };

  const pickDisplayName = (m) => {
    if (!m) return "";
    const s = m.displayName || m.preferredName || m.name || "";
    if (typeof s === "string" && s.trim()) return s.trim();
    const fn = (m.firstName || "").trim();
    const ln = (m.lastName || "").trim();
    return `${fn} ${ln}`.trim();
  };

  const firstLast = (s = "") => {
    const str = String(s || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!str) return { firstName: "", lastName: "", displayName: "" };
    const parts = str.split(" ");
    const firstName = parts[0] || "";
    const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
    const displayName = lastName
      ? `${firstName} ${String(lastName[0] || "").toUpperCase()}`
      : firstName;
    return { firstName, lastName, displayName };
  };
  // ---------- end helpers ----------

  // Cache musician docs for name fallbacks
  const ids = [
    ...new Set(rows.map((r) => String(r.musicianId)).filter(Boolean)),
  ];
  const musDocs = await Musician.find({ _id: { $in: ids } })
    .select("firstName lastName displayName preferredName name")
    .lean();
  const musById = Object.fromEntries(musDocs.map((m) => [String(m._id), m]));

  const groupedBySlot = rows.reduce((acc, row) => {
    const key = String(row.slotIndex ?? 0);
    (acc[key] ||= []).push(row);
    return acc;
  }, {});

  console.log(
    "📦 buildBadge: rows grouped by slot:",
    Object.keys(groupedBySlot),
  );

  const slots = [];
  const orderedKeys = Object.keys(groupedBySlot).sort(
    (a, b) => Number(a) - Number(b),
  );

  for (const slotKey of orderedKeys) {
    const slotRows = groupedBySlot[slotKey];
    console.log(`🟨 SLOT ${slotKey} — raw rows:`, slotRows.length);

    const leadRows = slotRows.filter((r) => r.isDeputy !== true);
    const deputyRows = slotRows.filter((r) => r.isDeputy === true);

    const leadReply =
      leadRows
        .filter((r) => ["yes", "no", "unavailable"].includes(r.reply))
        .sort(
          (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
        )[0] || null;

    // Resolve lead display bits (photo/profile) if possible
    let leadDisplayBits = null;
    if (leadReply?.musicianId) {
      try {
        leadDisplayBits = await getDeputyDisplayBits({
          musicianId: leadReply.musicianId,
        });
      } catch (e) {
        console.warn("getDeputyDisplayBits (lead) failed:", e?.message);
      }
    }

    const leadPhoto = normaliseUrl(
      leadDisplayBits?.photoUrl || leadReply?.photoUrl || null,
    );
    const leadProfile =
      leadDisplayBits?.profileUrl || leadReply?.profileUrl || "";

    const leadBits = leadReply
      ? {
          musicianId: String(
            leadDisplayBits?.musicianId || leadReply?.musicianId || "",
          ),
          photoUrl: isHttp(leadPhoto) ? leadPhoto : null,
          profileUrl: leadProfile || "",
          setAt: leadReply?.updatedAt || null,
          state: leadReply?.reply || "pending",
          available: leadReply?.reply === "yes",
          isDeputy: false,
        }
      : null;

    // Deputies (sorted latest first)
    const deputyRowsSorted = deputyRows.sort(
      (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
    );

    const deputies = [];
    for (const r of deputyRowsSorted) {
      try {
        const bits = await getDeputyDisplayBits({
          musicianId: r.musicianId,
          phone: r.phone,
          email: r.musicianEmail,
        });

        // ✅ FIX: depPhoto computed INSIDE loop, using the bits/r that exist here
        const depPhoto = normaliseUrl(bits?.photoUrl || r?.photoUrl || null);
        const depProfile = bits?.profileUrl || r?.profileUrl || "";

        deputies.push({
          slotIndex: Number(slotKey),
          isDeputy: true,
          musicianId: String(bits?.musicianId || r.musicianId || ""),
          photoUrl: isHttp(depPhoto) ? depPhoto : null,
          profileUrl: depProfile || "",
          vocalistName: String(
            bits?.resolvedName ||
              r?.selectedVocalistName ||
              r?.vocalistName ||
              pickDisplayName(musById[String(r.musicianId)]) ||
              r?.musicianName ||
              "" ||
              "",
          ).trim(),
          state: r.reply ?? null,
          available: r.reply === "yes",
          setAt: r.updatedAt || null,
          repliedAt: r.repliedAt || r.updatedAt || null,
        });
      } catch (e) {
        console.warn(
          "getDeputyDisplayBits (deputy) failed:",
          e?.message,
          r?.musicianId,
        );
      }
    }

    console.log("🖼️ PHOTO CHECK", {
      slotKey,
      lead_from_bits: leadDisplayBits?.photoUrl,
      lead_from_row: leadReply?.photoUrl,
      lead_final: leadPhoto,
      lead_isHttp: isHttp(leadPhoto),
      deputies_with_photos: deputies.filter((d) => isHttp(d.photoUrl)).length,
    });

    const leadAvailable = leadBits?.available === true;

    // Prefer a deputy who said YES and has a photo if lead not available
    const coveringYesDeputy = deputies.find(
      (d) => d.available && isHttp(d.photoUrl),
    );
    const firstDeputyWithPhoto = deputies.find((d) => isHttp(d.photoUrl));

    // Primary visual for badge
    let primary = null;
    if (!leadAvailable && coveringYesDeputy) primary = coveringYesDeputy;
    else if (leadAvailable && isHttp(leadBits?.photoUrl)) primary = leadBits;
    else if (!leadAvailable && firstDeputyWithPhoto)
      primary = firstDeputyWithPhoto;
    else if (isHttp(leadBits?.photoUrl)) primary = leadBits;

    // Choose lead name for slot label
    const leadMus = leadReply?.musicianId
      ? musById[String(leadReply.musicianId)] || null
      : null;

    const chosenName = String(
      leadReply?.selectedVocalistName ||
        leadReply?.vocalistName ||
        leadReply?.musicianName ||
        pickDisplayName(leadMus) ||
        "" ||
        "",
    ).trim();

    if (leadBits) leadBits.vocalistName = chosenName;

    const slotObj = {
      slotIndex: Number(slotKey),

      // legacy top-level fields (kept because your downstream uses them)
      isDeputy: false,
      vocalistName: chosenName,
      musicianId:
        leadBits?.musicianId ??
        (leadReply ? String(leadReply.musicianId) : null),
      photoUrl: leadBits?.photoUrl || null,
      profileUrl: leadBits?.profileUrl || "",

      // new/structured data
      deputies,
      setAt: leadReply?.updatedAt || null,
      state: leadReply?.reply || "pending",
      available: Boolean(
        leadAvailable || (coveringYesDeputy && coveringYesDeputy.available),
      ),
      covering: primary?.isDeputy ? "deputy" : "lead",
      primary: primary
        ? {
            musicianId: primary.musicianId || null,
            photoUrl: primary.photoUrl || null,
            profileUrl: primary.profileUrl || "",
            setAt: primary.setAt || null,
            isDeputy: Boolean(primary.isDeputy),
            available: Boolean(primary.available),
          }
        : null,
    };

    const idSnap = firstLast(slotObj.vocalistName);
    console.log("👤 SlotSummary", {
      musicianId: slotObj.musicianId,
      firstName: idSnap.firstName,
      lastName: idSnap.lastName,
      displayName: idSnap.displayName,
      vocalistDisplayName: slotObj.vocalistName,
      photoUrl: slotObj.photoUrl,
      profileUrl: slotObj.profileUrl,
      available: slotObj.available,
      covering: slotObj.covering,
      slotIndex: slotObj.slotIndex,
    });

    slots.push(slotObj);
  }

  const anyAddress =
    rows.find((r) => r.formattedAddress)?.formattedAddress || "TBC";
  const badge = { dateISO, address: anyAddress, active: true, slots };

  console.log("💜 FINAL BADGE (identity snapshot):", {
    dateISO: badge.dateISO,
    address: badge.address,
    slots: badge.slots.map((s) => ({
      slotIndex: s.slotIndex,
      vocalistName: s.vocalistName,
      available: s.available,
      covering: s.covering,
      primary: s.primary ? { musicianId: s.primary.musicianId } : null,
    })),
  });

  return badge;
}

export async function rebuildAndApplyAvailabilityBadge({ actId, dateISO }) {
  console.log("🟦 [rebuildAndApplyAvailabilityBadge] START", {
    actId,
    dateISO,
  });

  if (!actId || !dateISO) {
    console.error("❌ rebuildAndApplyAvailabilityBadge missing actId/dateISO", {
      actId,
      dateISO,
    });
    return null;
  }

  const actDoc = await Act.findById(actId)
    .select(
      "+availabilityBadgesMeta lineups tscName name formattedAddress venueAddress " +
        "coverImage images profileImage description tscDescription paSystem lightingSystem " +
        "extras numberOfSets lengthOfSets repertoire tscRepertoire selectedSongs repertoireByYear " +
        "setlist offRepertoireRequests useCountyTravelFee countyFees travelModel costPerMile",
    )
    .lean();

  console.log("📘 [rebuildAndApplyAvailabilityBadge] actDoc fetched", {
    actName: actDoc?.tscName || actDoc?.name,
    actId: String(actId),
    hasLineups: Array.isArray(actDoc?.lineups),
    hasMetaForDate: !!actDoc?.availabilityBadgesMeta?.[dateISO],
  });

  if (!actDoc) return { success: false, message: "Act not found" };

  let badge = await buildAvailabilityBadgeFromRows({
    actId,
    dateISO,
    hasLineups: Array.isArray(actDoc?.lineups),
  });

  /* ------------------------------- helpers ------------------------------- */

  const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

  const reserveClientEmailSend = async ({ actId, dateISO, slotIdx, kind }) => {
    const path = `availabilityBadgesMeta.${dateISO}.clientEmailsSent.${slotIdx}.${kind}`;
    const cutoff = new Date(Date.now() - COOLDOWN_MS);

    // Reserve if not sent, or last sent is older than cutoff
    const updated = await Act.findOneAndUpdate(
      {
        _id: actId,
        $or: [{ [path]: { $exists: false } }, { [path]: { $lt: cutoff } }],
      },
      { $set: { [path]: new Date() } },
      { new: false }, // we just need to know if we got the lock
    )
      .select("_id")
      .lean();

    return !!updated; // true = you own the send
  };

  const rollbackClientEmailReservation = async ({
    actId,
    dateISO,
    slotIdx,
    kind,
  }) => {
    const path = `availabilityBadgesMeta.${dateISO}.clientEmailsSent.${slotIdx}.${kind}`;
    await Act.updateOne({ _id: actId }, { $unset: { [path]: "" } });
  };

  const normaliseUrl = (u) => {
    if (typeof u !== "string") return "";
    const s = u.trim();
    if (!s) return "";
    if (s.startsWith("//")) return `https:${s}`;
    if (/^res\.cloudinary\.com\//i.test(s)) return `https://${s}`;
    return s;
  };

  const shortDisplayName = (nameLike = "") => {
    const s = String(nameLike || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!s) return "";
    const parts = s.split(" ");
    const first = parts[0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1] : "";
    const initial = last ? `${last[0].toUpperCase()}` : "";
    return initial ? `${first} ${initial}` : first;
  };

  const isHttpUrl = (u) => /^https?:\/\//i.test(normaliseUrl(u));

  /** Normalise a good display name from a musician doc */
  const pickDisplayName = (m) => {
    if (!m) return "";
    const s =
      m.displayName || m.preferredName || m.vocalistName || m.name || "";
    if (typeof s === "string" && s.trim()) return s.trim();
    const fn = String(m.firstName || m.first_name || "").trim();
    const ln = String(m.lastName || m.last_name || "").trim();
    return `${fn} ${ln}`.trim();
  };

  const toNameString = (v) =>
    typeof v === "string" && v.trim() ? v.trim() : pickDisplayName(v) || "";

  const safeFirstLast = (s = "") => {
    const str = String(s || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!str) return { firstName: "", lastName: "", displayName: "" };
    const parts = str.split(" ");
    const firstName = parts[0];
    const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
    const displayName = lastName
      ? `${firstName} ${lastName[0].toUpperCase()}`
      : firstName;
    return { firstName, lastName, displayName };
  };

  const dedupeByUrl = (arr) =>
    arr.filter((v, i, a) => a.findIndex((x) => x.url === v.url) === i);

  const buildApprovedVideos = (m) => {
    const fn = Array.isArray(m?.tscApprovedFunctionBandVideoLinks)
      ? m.tscApprovedFunctionBandVideoLinks
      : [];
    const orig = Array.isArray(m?.tscApprovedOriginalBandVideoLinks)
      ? m.tscApprovedOriginalBandVideoLinks
      : [];

    return dedupeByUrl(
      [...fn, ...orig]
        .map((v) => ({
          title: String(v?.title || "").trim(),
          url: normaliseUrl(String(v?.url || "").trim()),
        }))
        .filter((v) => isHttpUrl(v.url)),
    );
  };

  const renderVideoList = (whoName, videos = []) => {
    if (!Array.isArray(videos) || !videos.length) return "";
    return `
      <div style="margin:10px 0 0;">
        <p style="margin:0 0 6px; color:#555; font-weight:600;">Watch ${whoName}:</p>
        <ul style="margin:0; padding-left:18px;">
          ${videos
            .slice(0, 4)
            .map(
              (v, i) => `
              <li style="margin:4px 0;">
                <a href="${v.url}" style="color:#ff6667; text-decoration:none;">
                  ${v.title || `Video ${i + 1}`}
                </a>
              </li>
            `,
            )
            .join("")}
        </ul>
      </div>
    `;
  };

  const SITE_RAW =
    process.env.FRONTEND_URL || "https://thesupremecollective.co.uk/";
  const SITE = SITE_RAW.endsWith("/") ? SITE_RAW : `${SITE_RAW}/`;

  const buildMusicianProfileCard = async ({
    musicianId,
    fallbackName = "",
    fallbackPhotoUrl = "",
    fallbackProfileUrl = "",
  }) => {
    let photoUrl = normaliseUrl(fallbackPhotoUrl);
    let profileUrl = fallbackProfileUrl || "";
    let name = String(fallbackName || "").trim();
    let videos = [];

    if (musicianId) {
      const m = await Musician.findById(musicianId)
        .select(
          "firstName lastName displayName preferredName name " +
            "profilePicture photoUrl tscProfileUrl " +
            "tscApprovedFunctionBandVideoLinks tscApprovedOriginalBandVideoLinks",
        )
        .lean();

      if (m) {
        name =
          String(m.displayName || m.preferredName || m.name || "").trim() ||
          `${String(m.firstName || "").trim()} ${String(m.lastName || "").trim()}`.trim() ||
          name;

        if (!photoUrl)
          photoUrl = normaliseUrl(m.profilePicture || m.photoUrl || "");
        if (!profileUrl)
          profileUrl = m.tscProfileUrl || `${SITE}musician/${m._id}`;

        videos = buildApprovedVideos(m);
      }
    }

    return {
      name,
      photoUrl: isHttpUrl(photoUrl) ? photoUrl : "",
      profileUrl,
      videos, // [{title,url}]
    };
  };

  /* ---------------------- backfill missing vocalistName ---------------------- */

  const missingIds = [];
  for (const slot of badge?.slots || []) {
    if (slot?.primary?.musicianId && !slot.primary.vocalistName) {
      missingIds.push(String(slot.primary.musicianId));
    }
    for (const d of slot?.deputies || []) {
      if (d?.musicianId && !d.vocalistName) {
        missingIds.push(String(d.musicianId));
      }
    }
  }

  if (missingIds.length && badge?.slots?.length) {
    const uniqIds = [...new Set(missingIds)];
    const musDocs = await Musician.find({ _id: { $in: uniqIds } })
      .select("firstName lastName displayName preferredName name")
      .lean();
    const musById = Object.fromEntries(musDocs.map((m) => [String(m._id), m]));

    for (const slot of badge.slots || []) {
      if (slot?.primary && !slot.primary.vocalistName) {
        const m = musById[String(slot.primary.musicianId)];
        slot.primary.vocalistName = pickDisplayName(m);
      }
      if (Array.isArray(slot?.deputies)) {
        slot.deputies = slot.deputies.map((d) => {
          if (d.vocalistName && String(d.vocalistName).trim()) return d;
          const m = musById[String(d.musicianId)];
          return { ...d, vocalistName: pickDisplayName(m) };
        });
      }
    }
  }

  console.log("🎨 [rebuildAndApplyAvailabilityBadge] Raw badge", {
    hasBadge: !!badge,
    address: badge?.address,
    formattedAddress: actDoc?.formattedAddress,
    profileUrl:
      badge?.slots?.find((s) => s?.primary)?.primary?.profileUrl || "",
    photoUrl: badge?.slots?.find((s) => s?.primary)?.primary?.photoUrl || null,
    slotsCount: badge?.slots?.length || 0,
  });

  // Pull rows for optional email + safe summaries
  const availRows = await AvailabilityModel.find({ actId, dateISO }).lean();
  console.log(
    "📥 Availability rows FULL identity snapshot:",
    (availRows || []).map((r) => ({
      id: String(r._id),
      slotIndex: r.slotIndex,
      reply: r.reply,
      userId: r.userId || r.clientUserId || null,
      clientEmail: r.clientEmail || null,
      clientName: r.clientName || null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  );

  /* --------------------------- handle badge clear --------------------------- */

  if (!badge) {
    console.log("🟠 No badge returned — attempting CLEAR operation");

    const stillActive = await AvailabilityModel.exists({
      actId,
      dateISO,
      reply: "yes",
    });
    if (stillActive) {
      console.log("🟡 CLEAR skipped — active YES rows still present");
      return { success: true, skipped: true };
    }

    // legacy clear (older key shape)
    await Act.updateOne(
      { _id: actId },
      { $unset: { [`availabilityBadges.${dateISO}`]: "" } },
    );
    console.log("🧹 CLEARED legacy key", { actId, dateISO });

    return { success: true, cleared: true };
  }

  /* ------------------------------ persist badge ----------------------------- */

  const addressForKey =
    badge.address || actDoc?.formattedAddress || actDoc?.venueAddress || "TBC";
  const shortAddress = String(addressForKey)
    .replace(/\b(united_kingdom|uk)\b/gi, "")
    .replace(/\W+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();

  const key = `${dateISO}_${shortAddress}`;

  // (Optional) safe primary summary
  const idxPrimarySlot = (badge.slots || []).findIndex((s) => !!s?.primary);
  const primaryRef =
    idxPrimarySlot >= 0 ? badge.slots[idxPrimarySlot].primary : null;

  const primaryName =
    idxPrimarySlot >= 0
      ? badge.slots[idxPrimarySlot]?.primary?.vocalistName ||
        badge.slots[idxPrimarySlot]?.vocalistName ||
        ""
      : "";

  const nameSnap = safeFirstLast(toNameString(primaryName));

  console.log("👤 PrimaryChosen", {
    musicianId: primaryRef?.musicianId || null,
    firstName: nameSnap.firstName,
    lastName: nameSnap.lastName,
    displayName: nameSnap.displayName,
    vocalistDisplayName: primaryName,
    photoUrl: primaryRef?.photoUrl || null,
    profileUrl: primaryRef?.profileUrl || "",
    isDeputy: !!primaryRef?.isDeputy,
    phone: null,
    setAt: primaryRef?.setAt || null,
    available: !!primaryRef?.available,
    slotIndex: idxPrimarySlot >= 0 ? idxPrimarySlot : null,
  });

  await Act.updateOne(
    { _id: actId },
    { $set: { [`availabilityBadges.${key}`]: badge } },
  );
  console.log(`✅ Applied badge for ${actDoc.tscName || actDoc.name}`, { key });

  // SSE broadcast
  if (global.availabilityNotify?.badgeUpdated) {
    console.log("📡 SSE badgeUpdated fired", {
      actId,
      dateISO,
      slots: badge?.slots?.length || 0,
    });
    global.availabilityNotify.badgeUpdated({
      type: "availability_badge_updated",
      actId: String(actId),
      actName: actDoc?.tscName || actDoc?.name,
      dateISO,
      badge,
    });
  }

  /* ===================== Client emails block ===================== */
  try {
    const allRows = Array.isArray(availRows) ? availRows : [];

    const availabilityRecord = allRows
      .slice()
      .sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      )[0];

    // Prefer any real client email/name on any row; fallback to hello@
    let clientEmail =
      allRows.find((r) => r.clientEmail && String(r.clientEmail).includes("@"))
        ?.clientEmail || "hello@thesupremecollective.co.uk";
    let clientName = allRows.find((r) => r.clientName)?.clientName || "there";

    const selectedAddress =
      badge?.address ||
      availabilityRecord?.formattedAddress ||
      actDoc?.formattedAddress ||
      actDoc?.venueAddress ||
      "TBC";

    const profileUrl = `${SITE}act/${actDoc._id}`;
    const cartUrl = `${SITE}act/${actDoc._id}?date=${dateISO}&address=${encodeURIComponent(
      selectedAddress,
    )}`;

    const normKey = (s = "") =>
      s
        .toString()
        .toLowerCase()
        .replace(/[^a-z]/g, "");
    const paMap = { smallpa: "small", mediumpa: "medium", largepa: "large" };
    const lightMap = {
      smalllight: "small",
      mediumlight: "medium",
      largelight: "large",
    };
    const paSize = paMap[normKey(actDoc.paSystem)];
    const lightSize = lightMap[normKey(actDoc.lightingSystem)];

    const setsA = Array.isArray(actDoc.numberOfSets)
      ? actDoc.numberOfSets
      : [actDoc.numberOfSets].filter(Boolean);
    const lensA = Array.isArray(actDoc.lengthOfSets)
      ? actDoc.lengthOfSets
      : [actDoc.lengthOfSets].filter(Boolean);

    const setsLine =
      setsA.length && lensA.length
        ? `Up to ${setsA[0]}×${lensA[0]}-minute or ${setsA[1] || setsA[0]}×${
            lensA[1] || lensA[0]
          }-minute live sets`
        : `Up to 3×40-minute or 2×60-minute live sets`;

    const complimentaryExtras = [];
    if (actDoc?.extras && typeof actDoc.extras === "object") {
      for (const [k, v] of Object.entries(actDoc.extras)) {
        if (v && v.complimentary) {
          complimentaryExtras.push(
            k
              .replace(/_/g, " ")
              .replace(/\s+/g, " ")
              .replace(/^\w/, (c) => c.toUpperCase()),
          );
        }
      }
    }

    const lineupQuotes = await Promise.all(
      (actDoc.lineups || []).map(async (lu) => {
        try {
          const name =
            lu?.actSize ||
            `${(lu?.bandMembers || []).filter((m) => m?.isEssential).length}-Piece`;

          let travelTotal = "price TBC";
          try {
            const { county: selectedCounty } =
              countyFromAddress(selectedAddress);
            const { total } = await calculateActPricing(
              actDoc,
              selectedCounty,
              selectedAddress,
              dateISO,
              lu,
            );
            if (total && !isNaN(total)) {
              travelTotal = `£${Math.round(Number(total)).toLocaleString("en-GB")}`;
            }
          } catch (err) {
            console.warn(
              "⚠️ [rebuildAndApplyAvailabilityBadge] Price calc failed:",
              err.message,
            );
          }

          const instruments = (lu?.bandMembers || [])
            .filter((m) => m?.isEssential)
            .map((m) => m?.instrument)
            .filter(Boolean)
            .join(", ");

          return {
            html: `<strong>${name}</strong>: ${instruments} — <strong>${travelTotal}</strong>`,
          };
        } catch (err) {
          console.warn(
            "⚠️ [rebuildAndApplyAvailabilityBadge] Lineup formatting failed:",
            err.message,
          );
          return { html: "<em>Lineup unavailable</em>" };
        }
      }),
    );

    const tailoringExact = (() => {
      const songCount = (() => {
        if (Array.isArray(actDoc?.selectedSongs) && actDoc.selectedSongs.length)
          return actDoc.selectedSongs.length;
        if (
          actDoc?.repertoireByYear &&
          typeof actDoc.repertoireByYear === "object"
        ) {
          return Object.values(actDoc.repertoireByYear).reduce(
            (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
            0,
          );
        }
        if (Array.isArray(actDoc?.repertoire) && actDoc.repertoire.length)
          return actDoc.repertoire.length;
        if (Array.isArray(actDoc?.tscRepertoire) && actDoc.tscRepertoire.length)
          return actDoc.tscRepertoire.length;
        return 0;
      })();

      const setlistTail = songCount
        ? ` — drawn from over ${songCount} songs`
        : "";

      if (actDoc.setlist === "smallTailoring")
        return `A signature setlist curated by the band — guaranteed crowd-pleasers that they know work every time${setlistTail}`;
      if (actDoc.setlist === "mediumTailoring")
        return `A collaborative setlist blending your top picks with our tried-and-tested favourites for the perfect party balance${setlistTail}`;
      if (actDoc.setlist === "largeTailoring")
        return `A fully tailored setlist made up almost entirely of your requests — a truly personalised music experience${setlistTail}`;
      return null;
    })();

    const offRepCount = Number(actDoc?.offRepertoireRequests || 0);
    const offRepLine =
      offRepCount > 0
        ? offRepCount === 1
          ? "One additional ‘off-repertoire’ song request (e.g. often the first dance or your favourite song)"
          : `${offRepCount} additional ‘off-repertoire’ song requests (e.g. often the first dance or your favourite songs)`
        : "";

    const heroImg =
      (Array.isArray(actDoc.coverImage) && actDoc.coverImage[0]?.url) ||
      (Array.isArray(actDoc.images) && actDoc.images[0]?.url) ||
      (Array.isArray(actDoc.profileImage) && actDoc.profileImage[0]?.url) ||
      actDoc.coverImage?.url ||
      "";

    console.log("🖼️ Email assets", {
      heroImg,
      hasTscDescription: !!actDoc.tscDescription,
      hasDescription: !!actDoc.description,
      offRepertoireRequests: actDoc?.offRepertoireRequests,
    });

    // Compute event date once for both branches
    const eventDatePretty = (() => {
      const d = new Date(dateISO);
      if (isNaN(d)) return String(dateISO || "");
      const day = d.getDate();
      const j = day % 10,
        k = day % 100;
      const suffix =
        j === 1 && k !== 11
          ? "st"
          : j === 2 && k !== 12
            ? "nd"
            : j === 3 && k !== 13
              ? "rd"
              : "th";
      const month = d.toLocaleDateString("en-GB", { month: "long" });
      const year = d.getFullYear();
      return `${day}${suffix} ${month} ${year}`;
    })();

    // Try to discover the client user id
    const clientUserId =
      availabilityRecord?.userId ||
      availabilityRecord?.clientUserId ||
      allRows.find((r) => r?.userId)?.userId ||
      allRows.find((r) => r?.clientUserId)?.clientUserId ||
      null;

    console.log("🧠 [rebuild] resolved client identity", {
      availabilityRecordId: availabilityRecord?._id
        ? String(availabilityRecord._id)
        : null,
      resolvedClientUserId: clientUserId || null,
      resolvedClientEmail: clientEmail || null,
      resolvedClientName: clientName || null,
    });

    /* ===================== per-slot sending + idempotency ===================== */

    // Determine lead/deputy availability per slot (no longer requires photoUrl)
    const slotIsLeadAvailable = (s) => {
      const leadSaysYes = s?.state === "yes" && s?.covering !== "deputy";
      const primaryIsLead =
        s?.primary &&
        s.primary.isDeputy === false &&
        (s.primary.available === true || s?.state === "yes");
      return !!(leadSaysYes || primaryIsLead);
    };

    const slotIsDeputyCovering = (s) => {
      const primaryDeputyCover =
        s?.covering === "deputy" &&
        s?.primary?.isDeputy === true &&
        (s?.primary?.available === true || s?.state === "yes");

      const yesDeputy =
        Array.isArray(s?.deputies) &&
        s.deputies.some((d) => d?.state === "yes" || d?.available === true);

      return !!(primaryDeputyCover || yesDeputy);
    };

    const slotsArr = Array.isArray(badge?.slots) ? badge.slots : [];

    // Pick a "primary" person for the email from a slot (lead or deputy)
    const presentBadgePrimary = (slot = null) => {
      if (!slot || typeof slot !== "object") return null;

      let candidate = null;
      let isDeputy = false;

      if (slot.covering === "deputy") {
        // Prefer a YES deputy (even if photo missing; we can fetch later)
        if (Array.isArray(slot.deputies)) {
          const yesDep = slot.deputies.find(
            (d) => d?.state === "yes" || d?.available === true,
          );
          if (yesDep) {
            candidate = yesDep;
            isDeputy = true;
          }
        }
        // Fallback to primary deputy
        if (!candidate && slot?.primary?.isDeputy) {
          candidate = slot.primary;
          isDeputy = true;
        }
        // Any deputy as last resort
        if (
          !candidate &&
          Array.isArray(slot.deputies) &&
          slot.deputies.length
        ) {
          candidate = slot.deputies[0];
          isDeputy = true;
        }
      }

      // Lead case
      if (!candidate) {
        if (slot?.primary && slot.primary.isDeputy === false) {
          candidate = slot.primary;
          isDeputy = false;
        } else {
          candidate = slot; // last fallback
          isDeputy = false;
        }
      }

      if (!candidate) return null;

      const rawName =
        candidate.vocalistName ||
        candidate.displayName ||
        candidate.preferredName ||
        candidate.name ||
        "";

      const nameStr =
        typeof rawName === "string" && rawName.trim()
          ? rawName.trim()
          : pickDisplayName(candidate);

      const { firstName, lastName, displayName } = safeFirstLast(nameStr);

      return {
        musicianId: candidate.musicianId || null,
        firstName,
        lastName,
        displayName,
        vocalistDisplayName: nameStr,
        photoUrl: candidate.photoUrl || null,
        profileUrl: candidate.profileUrl || "",
        isDeputy,
        phone: null,
        setAt: candidate.setAt || slot.setAt || null,
        available:
          candidate.available === true ||
          candidate.state === "yes" ||
          slot.state === "yes",
        slotIndex: slot.slotIndex ?? null,
      };
    };

    for (const slot of slotsArr) {
      const slotIdx =
        typeof slot?.slotIndex === "number" ? slot.slotIndex : null;
      if (slotIdx === null) continue;

      /* --------------------------- LEAD AVAILABLE --------------------------- */
      if (slotIsLeadAvailable(slot)) {
        const leadInfo = presentBadgePrimary(slot);

        if (leadInfo?.available && leadInfo?.isDeputy === false) {
          const canSend = await reserveClientEmailSend({
            actId,
            dateISO,
            slotIdx,
            kind: "lead",
          });

          if (!canSend) {
            console.log(
           
  "✉️ [rebuild] Skipping LEAD email (sent within 7 days)",
  { slotIdx },
);
          } else {
            try {
              const vocalistCard = await buildMusicianProfileCard({
                musicianId: leadInfo?.musicianId,
                fallbackName:
                  leadInfo?.vocalistDisplayName ||
                  leadInfo?.displayName ||
                  leadInfo?.firstName ||
                  "Lead Vocalist",
                fallbackPhotoUrl: leadInfo?.photoUrl || "",
                fallbackProfileUrl: leadInfo?.profileUrl || "",
              });

              const vocalistShort =
                shortDisplayName(vocalistCard.name) || "our lead vocalist";

              console.log("📧 Sending LEAD-available email (per slot)", {
                slotIdx,
                vocalistShort,
                to: clientEmail,
              });

              await sendClientEmail({
                actId: String(actId),
                userId: clientUserId,
                to: clientEmail,
                name: clientName,
                allowHello: true,
                bcc: ["hello@thesupremecollective.co.uk"],
                subject: `Good news — ${actDoc.tscName || actDoc.name}'s Lead Vocalist is available for ${eventDatePretty}`,
                html: `
                <div style="font-family: Arial, sans-serif; color:#333; line-height:1.6; max-width:700px; margin:0 auto;">
                  <p>Hi ${(clientName || "there").split(" ")[0]},</p>
                  <p>Thank you for shortlisting <strong>${actDoc.tscName || actDoc.name}</strong>!</p>
                  <p>
                    We’re delighted to confirm that <strong>${actDoc.tscName || actDoc.name}</strong> is available with
                    <strong>${vocalistShort}</strong> on lead vocals, and they’d love to perform for you and your guests.
                  </p>

                  ${
                    vocalistCard.profileUrl || vocalistCard.photoUrl
                      ? `
                        <div style="margin:20px 0; border-top:1px solid #eee; padding-top:15px;">
                          <h3 style="color:#111; margin-bottom:10px;">Meet ${vocalistShort}</h3>
                         ${
                           vocalistCard.photoUrl
                             ? vocalistCard.profileUrl
                               ? `
        <a href="${vocalistCard.profileUrl}" style="text-decoration:none;">
          <img
            src="${vocalistCard.photoUrl}"
            alt="${vocalistCard.name}"
            style="width:160px; height:160px; border-radius:50%; object-fit:cover; margin-bottom:10px; display:block;"
          />
        </a>
      `
                               : `
        <img
          src="${vocalistCard.photoUrl}"
          alt="${vocalistCard.name}"
          style="width:160px; height:160px; border-radius:50%; object-fit:cover; margin-bottom:10px; display:block;"
        />
      `
                             : ""
                         }
                          ${
                            vocalistCard.profileUrl
                              ? `<p style="margin:6px 0 0;"><a href="${vocalistCard.profileUrl}" style="color:#ff6667; font-weight:600; text-decoration:none;">View ${vocalistShort}'s profile →</a></p>`
                              : ""
                          }
                          ${renderVideoList(vocalistShort, vocalistCard.videos)}
                        </div>
                      `
                      : ""
                  }

                  ${
                    heroImg
                      ? `<img src="${heroImg}" alt="${actDoc.tscName || actDoc.name}" style="width:100%; height:auto; border-radius:8px; margin:20px 0;" />`
                      : ""
                  }

                  <h3 style="color:#111;">${actDoc.tscName || actDoc.name}</h3>
                  <p style="margin:6px 0 14px; color:#555;">${(actDoc.tscDescription || actDoc.description || "").toString()}</p>
                  <p><a href="${profileUrl}" style="color:#ff6667; font-weight:600; text-decoration:none;">View Profile →</a></p>

                  ${
                    lineupQuotes.length
                      ? `<h4 style="margin-top:20px;">Lineup options:</h4><ul>${lineupQuotes
                          .map((l) => `<li>${l.html}</li>`)
                          .join("")}</ul>`
                      : ""
                  }

                  <h4 style="margin-top:25px;">Included in your quote:</h4>
                  <ul>
                    <li>${setsLine}</li>
                    ${paSize ? `<li>A ${paSize} PA system${lightSize ? ` and a ${lightSize} lighting setup` : ""}</li>` : ""}
                    <li>Band arrival from 5pm and finish by midnight as standard</li>
                    <li>Or up to 7 hours on site if earlier arrival is needed</li>
                    ${offRepLine ? `<li>${offRepLine}</li>` : ""}
                    ${tailoringExact ? `<li>${tailoringExact}</li>` : ""}
                    ${complimentaryExtras.map((x) => `<li>${x}</li>`).join("")}
                    <li>Travel to ${selectedAddress || "TBC"}</li>
                  </ul>

                  <div style="margin-top:30px;">
                    <a href="${cartUrl}" style="display:inline-block; background-color:#ff6667; color:white; padding:12px 28px; text-decoration:none; border-radius:6px; font-weight:600; line-height:1;">Book Now →</a>
                  </div>

                  <p style="margin-top:16px;">We operate on a first-booked-first-served basis, so we recommend securing your band quickly to avoid disappointment.</p>
                  <p>If you have any questions, just reply — we’re always happy to help.</p>
                  <p>Warmest wishes,<br/><strong>The Supreme Collective ✨</strong><br/><a href="https://www.thesupremecollective.co.uk" style="color:#888; text-decoration:none;">www.thesupremecollective.co.uk</a></p>
                </div>
              `,
              });
              console.log("✅ Client email sent (lead available, per slot).", {
                slotIdx,
              });
            } catch (err) {
              console.warn(
                "❌ LEAD send failed, rolling back reservation",
                err?.message || err,
              );
              await rollbackClientEmailReservation({
                actId,
                dateISO,
                slotIdx,
                kind: "lead",
              });
            }
          }
        }

        continue; // slot handled
      }

      /* -------------------------- DEPUTY AVAILABLE -------------------------- */
      if (slotIsDeputyCovering(slot)) {
        const depInfo = presentBadgePrimary(slot);

        if (depInfo?.available && depInfo?.isDeputy === true) {
          const canSend = await reserveClientEmailSend({
            actId,
            dateISO,
            slotIdx,
            kind: "deputy",
          });

          if (!canSend) {
            console.log(
              "✉️ [rebuild] Skipping DEPUTY email (sent within 7 days)",
              { slotIdx },
            );
          } else {
            try {
              const deputyCard = await buildMusicianProfileCard({
                musicianId: depInfo?.musicianId,
                fallbackName:
                  depInfo?.vocalistDisplayName ||
                  depInfo?.displayName ||
                  depInfo?.firstName ||
                  "Deputy Vocalist",
                fallbackPhotoUrl: depInfo?.photoUrl || "",
                fallbackProfileUrl: depInfo?.profileUrl || "",
              });

              const deputyNameFull =
                deputyCard.name ||
                depInfo.vocalistDisplayName ||
                depInfo.displayName ||
                depInfo.firstName ||
                "one of our vocalists";

              const deputyShort =
                shortDisplayName(deputyNameFull) || deputyNameFull;

              // 🔎 DEBUG: why is deputyShort not shortened?
              {
                const raw = String(deputyNameFull || "");
                const cleaned = raw.trim().replace(/\s+/g, " ");
                const parts = cleaned ? cleaned.split(" ") : [];
                console.log("🧩 [DEPUTY NAME DEBUG]", {
                  slotIdx,
                  deputyNameFull_raw: raw,
                  deputyNameFull_cleaned: cleaned,
                  parts,
                  partsCount: parts.length,
                  firstToken: parts[0] || "",
                  lastToken: parts[parts.length - 1] || "",
                  shortDisplayName_result: shortDisplayName(deputyNameFull),
                  deputyShort_final: deputyShort,
                  sourcePicked: deputyCard.name
                    ? "deputyCard.name"
                    : depInfo.vocalistDisplayName
                      ? "depInfo.vocalistDisplayName"
                      : depInfo.displayName
                        ? "depInfo.displayName"
                        : depInfo.firstName
                          ? "depInfo.firstName"
                          : "fallback",
                  deputyCard: {
                    name: deputyCard?.name || "",
                    profileUrl: deputyCard?.profileUrl || "",
                    hasPhoto: !!deputyCard?.photoUrl,
                  },
                  depInfo: {
                    vocalistDisplayName: depInfo?.vocalistDisplayName || "",
                    displayName: depInfo?.displayName || "",
                    firstName: depInfo?.firstName || "",
                    lastName: depInfo?.lastName || "",
                  },
                });
              }

              console.log("📧 Sending DEPUTY-available email (per slot)", {
                slotIdx,
                deputyShort,
                to: clientEmail,
                hasPhoto: !!deputyCard.photoUrl,
                hasVideos: !!(deputyCard.videos && deputyCard.videos.length),
              });

              const isVocalistMember = (m = {}) =>
                /vocal|singer/i.test(String(m.instrument || m.role || ""));
              const smallestLineup =
                Array.isArray(actDoc?.lineups) && actDoc.lineups.length
                  ? actDoc.lineups.slice().sort((a, b) => {
                      const ca = Array.isArray(a?.bandMembers)
                        ? a.bandMembers.filter(
                            (x) => x && x.isEssential !== false,
                          ).length
                        : 0;
                      const cb = Array.isArray(b?.bandMembers)
                        ? b.bandMembers.filter(
                            (x) => x && x.isEssential !== false,
                          ).length
                        : 0;
                      return ca - cb;
                    })[0]
                  : null;

              const vocalistCount =
                smallestLineup && Array.isArray(smallestLineup.bandMembers)
                  ? smallestLineup.bandMembers.filter(
                      (m) => m?.isEssential !== false && isVocalistMember(m),
                    ).length
                  : 1;

              const unavailableVocalistPrefix =
                vocalistCount > 1
                  ? "One of the band's regular vocalists isn’t available for your date, but we’re delighted to confirm that"
                  : "The band's regular vocalist isn’t available for your date, but we’re delighted to confirm that";

              await sendClientEmail({
                actId: String(actId),
                userId: clientUserId,
                to: clientEmail,
                name: clientName,
                bcc: ["hello@thesupremecollective.co.uk"],
                subject: `${deputyShort} is available to perform for you with ${actDoc.tscName || actDoc.name} on ${eventDatePretty}`,
                html: `
                <div style="font-family: Arial, sans-serif; color:#333; line-height:1.6; max-width:700px; margin:0 auto;">
                  <p>Hi ${(clientName || "there").split(" ")[0]},</p>
                  <p>Thank you for shortlisting <strong>${actDoc.tscName || actDoc.name}</strong>!</p>
                  <p>
                    ${unavailableVocalistPrefix} <strong>${deputyShort}</strong> — one of the band's trusted deputy vocalists — is available to perform instead.
                  </p>

                  ${
                    deputyCard.profileUrl || deputyCard.photoUrl
                      ? `
                        <div style="margin:20px 0; border-top:1px solid #eee; padding-top:15px;">
                          <h3 style="color:#111; margin-bottom:10px;">Introducing ${deputyShort}</h3>
                         ${
                           deputyCard.photoUrl
                             ? deputyCard.profileUrl
                               ? `
        <a href="${deputyCard.profileUrl}" style="text-decoration:none;">
          <img
            src="${deputyCard.photoUrl}"
            alt="${deputyCard.name}"
            style="width:160px; height:160px; border-radius:50%; object-fit:cover; margin-bottom:10px; display:block;"
          />
        </a>
      `
                               : `
        <img
          src="${deputyCard.photoUrl}"
          alt="${deputyCard.name}"
          style="width:160px; height:160px; border-radius:50%; object-fit:cover; margin-bottom:10px; display:block;"
        />
      `
                             : ""
                         }
                          ${
                            deputyCard.profileUrl
                              ? `<p style="margin:6px 0 0;"><a href="${deputyCard.profileUrl}" style="color:#ff6667; font-weight:600; text-decoration:none;">View ${deputyShort}'s profile →</a></p>`
                              : ""
                          }
                          ${renderVideoList(deputyShort, deputyCard.videos)}
                          <p style="margin:8px 0 0; color:#555;">
                            Please note: when a deputy vocalist is booked, the band will tailor the setlist to that vocalist’s repertoire.
                            There’s a large overlap with ${actDoc.tscName || actDoc.name}’s core repertoire and ${deputyShort}’s repertoire, so you’ll still get the band’s signature crowd-pleasers.
                          </p>
                        </div>
                      `
                      : ""
                  }

                  ${
                    heroImg
                      ? `<img src="${heroImg}" alt="${actDoc.tscName || actDoc.name}" style="width:100%; height:auto; border-radius:8px; margin:20px 0;" />`
                      : ""
                  }

                  <h3 style="color:#111;">${actDoc.tscName || actDoc.name}</h3>
                  <p style="margin:6px 0 14px; color:#555;">${(actDoc.tscDescription || actDoc.description || "").toString()}</p>
                  <p><a href="${deputyCard.profileUrl || profileUrl}" style="color:#ff6667; font-weight:600; text-decoration:none;">View Profile →</a></p>

                  ${
                    lineupQuotes.length
                      ? `<h4 style="margin-top:20px;">Lineup options:</h4><ul>${lineupQuotes
                          .map((l) => `<li>${l.html}</li>`)
                          .join("")}</ul>`
                      : ""
                  }

                  <h4 style="margin-top:25px;">Included in your quote:</h4>
                  <ul>
                    <li>${setsLine}</li>
                    ${paSize ? `<li>A ${paSize} PA system${lightSize ? ` and a ${lightSize} lighting setup` : ""}</li>` : ""}
                    <li>Band arrival from 5pm and finish by midnight as standard</li>
                    <li>Or up to 7 hours on site if earlier arrival is needed</li>
                    ${offRepLine ? `<li>${offRepLine}</li>` : ""}
                    ${tailoringExact ? `<li>${tailoringExact}</li>` : ""}
                    ${complimentaryExtras.map((x) => `<li>${x}</li>`).join("")}
                    <li>Travel to ${selectedAddress || "TBC"}</li>
                  </ul>

                  <div style="margin-top:30px;">
                    <a href="${cartUrl}" style="display:inline-block; background-color:#ff6667; color:white; padding:12px 28px; text-decoration:none; border-radius:6px; font-weight:600; line-height:1;">Book Now →</a>
                  </div>

                  <p style="margin-top:16px;">We operate on a first-booked-first-served basis, so we recommend securing your band quickly to avoid disappointment.</p>
                  <p>If you have any questions, just reply — we’re always happy to help.</p>
                  <p>Warmest wishes,<br/><strong>The Supreme Collective ✨</strong><br/><a href="https://www.thesupremecollective.co.uk" style="color:#888; text-decoration:none;">www.thesupremecollective.co.uk</a></p>
                </div>
              `,
              });

              console.log("✅ Deputy-available client email sent (per slot).", {
                slotIdx,
              });
            } catch (err) {
              console.warn(
                "❌ DEPUTY send failed, rolling back reservation",
                err?.message || err,
              );
              await rollbackClientEmailReservation({
                actId,
                dateISO,
                slotIdx,
                kind: "deputy",
              });
            }
          }
        }

        continue; // slot handled
      }
    }
  } catch (e) {
    console.warn(
      "⚠️ [rebuildAndApplyAvailabilityBadge] Client email block failed:",
      e?.message || e,
    );
  }

  return { success: true, updated: true, badge };
}

export async function getAvailabilityBadge(req, res) {
  try {
    const { actId, dateISO } = req.params;

    console.log("🎯 [getAvailabilityBadge] Fetching badge for:", {
      actId,
      dateISO,
    });

    if (!actId || !dateISO) {
      return res.status(400).json({ error: "Missing actId or dateISO" });
    }

    // Fetch once (we need meta lock + hasLineups)
    const actDoc = await Act.findById(actId)
      .select("+availabilityBadgesMeta formattedAddress lineups hasLineups")
      .lean();

    if (!actDoc) {
      return res.status(404).json({ error: "Act not found" });
    }

    // 🚫 Skip rebuild if lead marked unavailable
    if (actDoc?.availabilityBadgesMeta?.[dateISO]?.lockedByLeadUnavailable) {
      console.log(
        `⏭️ Skipping rebuild — lead unavailable lock active for ${dateISO}`,
      );
      return res.json({
        badge: null,
        skipped: true,
        reason: "lead_unavailable_lock",
      });
    }

    const badge = await buildAvailabilityBadgeFromRows({
      actId,
      dateISO,
      hasLineups: actDoc?.hasLineups ?? true,
    });

    if (!badge) {
      console.log("🪶 No badge found for act/date:", { actId, dateISO });
      return res.json({ badge: null });
    }

    console.log("✅ [getAvailabilityBadge] Returning badge:", {
      actId,
      dateISO,
      slots: badge?.slots?.length || 0,
      address: badge?.address,
    });

    return res.json({ badge });
  } catch (err) {
    console.error("❌ [getAvailabilityBadge] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// controllers/bookingController.js
import Stripe from 'stripe';
import Order from '../models/bookingModel.js';
import ejs from 'ejs';
import puppeteer from 'puppeteer';
import nodemailer from 'nodemailer';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import Act from "../models/actModel.js";
import bookingModel from "../models/bookingModel.js";
import Booking from "../models/bookingModel.js";
import Musician from "../models/musicianModel.js";
import BookingNotifications from "../utils/BookingNotifications.js";
import crypto from 'crypto';
import EnquiryBoardItem from "../models/enquiryBoardItem.js";
// 🔹 NEW: to find the existing enquiry event (if any)
import AvailabilityModel from '../models/availabilityModel.js';
// 🔹 NEW: update or create calendar events
import { updateCalendarEvent, createCalendarInvite } from '../controllers/googleController.js';
import BookingBoardItem from "../models/bookingBoardItem.js";
import axios from "axios";
import { differenceInCalendarDays, startOfDay, subDays } from "date-fns";
import { postcodes } from "../utils/postcodes.js";
import { logStart } from "../utils/logger.js";
import { setSharedIVR } from "../utils/proxySetup.js";
import { sendSMSMessage, sendWhatsAppMessage } from "../utils/twilioClient.js"; // WA → SMS fallback sender (used in Availability controller)
import userModel from '../models/userModel.js';
import { sendBookingConfirmationToLeadVocalist, sendBookingRequestsToLineup } from './booking/helpers.js';
import { createSharedBookingEvent } from '../utils/createSharedBookingEvent.js';
import { normalize } from "../utils/phoneUtils.js";
import chromium from "@sparticuz/chromium";
import { updateOrCreateBookingEvent } from '../utils/updateOrCreateBookingEvent.js';


/**
 * Lookup a musician’s full name by ID.
 * Returns "Unknown Musician" if not found or on error.
 */
export async function lookupMusicianName(musicianId) {
  try {
    if (!musicianId) return null;
    const m = await Musician.findById(musicianId).lean();
    if (!m) return "Unknown Musician";

    const fn = m.firstName || "";
    const ln = m.lastName || "";
    return `${fn} ${ln}`.trim() || "Musician";
  } catch (err) {
    console.warn("⚠️ lookupMusicianName failed:", err);
    return "Unknown Musician";
  }
}

// bookingController.js (top-level, near other consts)
const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL || "https://g.page/r/CUYlq-https://www.google.com/search?q=the+supreme+collective&oq=the+supreme&gs_lcrp=EgZjaHJvbWUqBggAEEUYOzIGCAAQRRg7MgYIARBFGDkyBggCEEUYOzIGCAMQRRg7MgYIBBBFGEEyBggFEEUYQTIGCAYQRRhBMgYIBxBFGD3SAQgxMjU5ajBqMagCALACAA&sourceid=chrome&ie=UTF-8&sei=3c_baMnlI4_vhbIPiOS9yQE#lrd=0x751df2ff4f2e30d:0xb1f44d25caa515eb,1,,,,"; // <- put your real review link
const SITE_URL = process.env.SITE_URL || "https://thesupremecollective.co.uk";
const WHATSAPP_URL = process.env.WHATSAPP_URL || "https://api.whatsapp.com/send/?phone=7594223200&text&type=phone_number&app_absent=0";

// --- small helpers reused from availability controller ---
const firstNameOf = (p = {}) => {
  const direct = p.firstName || p.first_name || p.firstname || p.givenName || "";
  if (direct && String(direct).trim()) return String(direct).trim();
  const full = p.name || p.fullName || "";
  if (full && String(full).trim()) return String(full).trim().split(/\s+/)[0];
  return "";
};


export async function launchBrowser() {
  return await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),  // <-- note: this IS async
    headless: chromium.headless
  });
}

// (optional) tiny helper to mirror contactRouting -> eventSheet.emergencyContact
function mirrorEmergencyContact(contactRouting = {}) {
  console.log(`🐣 (controllers/bookingController.js) mirrorEmergencyContact called at`, new Date().toISOString(), { contactRouting });
  const number = contactRouting?.proxyNumber || "";
  const ivrCode = contactRouting?.ivrCode || "";
  let activeWindowSummary = "";
  try {
    const from = contactRouting?.activeFrom ? new Date(contactRouting.activeFrom) : null;
    const until = contactRouting?.activeUntil ? new Date(contactRouting.activeUntil) : null;
    if (from && until && !isNaN(from) && !isNaN(until)) {
      const left = from.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
      const right = until.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
      activeWindowSummary = `${left} → ${right}`;
    }
  } catch {}

  return {
    number,
    ivrCode,
    note:
      "Emergency contact active from 5pm the day before and on the event day.",
    activeWindowSummary,
  };
}

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // true if 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});



// Resolve the signature GIF on disk (frontend during dev; allow override via env)
function resolveSignatureGifPath() {
    console.log(`🐣 (controllers/bookingController.js) resolveSignatureGifPath called at`, new Date().toISOString());
  // 1) explicit override (e.g. when deployed and assets live elsewhere)
  if (process.env.SIGNATURE_GIF_PATH && fs.existsSync(process.env.SIGNATURE_GIF_PATH)) {
    return process.env.SIGNATURE_GIF_PATH;
  }
  // 2) dev convenience: use the file in frontend/assets
  const devGuess = path.join(__dirname, "..", "..", "frontend", "assets", "TSC_Signature.gif");
  if (fs.existsSync(devGuess)) return devGuess;

  // 3) final fallback: return empty → we’ll skip attaching if not found
  return "";
}


// default signature HTML (can be overridden by EMAIL_SIGNATURE_HTML)
const signature = process.env.EMAIL_SIGNATURE_HTML || `
  <hr style="border:none;border-top:1px solid #eee;margin:20px 0" />
  <table cellpadding="0" cellspacing="0" role="presentation" style="font-family:Arial,Helvetica,sans-serif;color:#333">
    <tr>
      <td style="vertical-align:top;padding-right:16px">
        <!-- Will be replaced with cid:sig_gif if attached -->
        <img src="cid:signature.gif" alt="The Supreme Collective" width="140" style="display:block;border:0;outline:none;text-decoration:none" />
      </td>
      <td style="font-size:13px;line-height:1.5">
        <div style="margin-bottom:4px"><a href="${SITE_URL}" style="color:#111;text-decoration:none;"><strong>thesupremecollective.co.uk</strong></a></div>

        <div style="margin:8px 0">
          <a href="${GOOGLE_REVIEW_URL}" style="text-decoration:none;">
            <img src="https://res.cloudinary.com/dvcgr3fyd/image/upload/v1746015511/google_5star_badge.png" alt="Google 5.0 ★★★★★" width="180" style="border:0;display:block" />
          </a>
        </div>

        <div style="margin-top:12px">
          <a href="${WHATSAPP_URL}"
             style="background:#25D366;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">
            Chat on WhatsApp
          </a>
        </div>
      </td>
    </tr>
  </table>
`;

const formatWithOrdinal = (dateLike) => {
  const d = new Date(dateLike);
  if (isNaN(d)) return String(dateLike);
  const day = d.getDate();
  const j = day % 10, k = day % 100;
  const suffix = j === 1 && k !== 11 ? "st" : j === 2 && k !== 12 ? "nd" : j === 3 && k !== 13 ? "rd" : "th";
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const month = d.toLocaleDateString("en-GB", { month: "short" });
  const year = d.getFullYear();
  return `${weekday}, ${day}${suffix} ${month} ${year}`;
};
const normalizePhone = (raw = "") => {
  let v = String(raw || "").replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!v) return "";
  if (v.startsWith("+")) return v;
  if (v.startsWith("07")) return v.replace(/^0/, "+44");
  if (v.startsWith("44")) return `+${v}`;
  return v;
};

// ---- Fee helpers (mirror availability logic) ----
function countPerformers(lineup) {
    console.log(`🐣 (controllers/bookingController.js) countPerformers called at`, new Date().toISOString(), { lineupId: lineup?._id });
    logStart("countPerformers", );

  const members = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];
  return members.filter(m => {
    const role = String(m?.instrument || "").trim().toLowerCase();
    return role && role !== "manager" && role !== "admin";
  }).length;
}

function computePerMemberFee({ lineup, booking }, debugLabel = "") {
    console.log(`🐣 (controllers/bookingController.js) computePerMemberFee called at`, new Date().toISOString(), { lineupId: lineup?._id, bookingId: booking?.bookingId, debugLabel });
    logStart("computePerMemberFee", );


  const lineupTotal = Number(lineup?.base_fee?.[0]?.total_fee ?? 0);
  const bookingGross = Number(booking?.totals?.fullAmount ?? booking?.amount ?? 0);
  const gross = lineupTotal > 0 ? lineupTotal : bookingGross;
  const performers = countPerformers(lineup);

  if (process.env.DEBUG_FEE_LOGS === "1") {
    const members = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];
    console.log("[fee] inputs", {
      tag: debugLabel,
      bookingId: booking?.bookingId,
      lineupId: lineup?._id || lineup?.lineupId,
      lineupTotal,
      bookingGross,
      chosenGross: gross,
      performers,
      membersRoles: members.map(m => m?.instrument || "").filter(Boolean),
      baseFeeRaw: lineup?.base_fee,
    });
  }

  const fee = (!gross || !performers) ? 0 : Math.ceil(gross / performers);

  if (process.env.DEBUG_FEE_LOGS === "1") {
    console.log("[fee] result", { tag: debugLabel, perMember: fee });
  }
  return fee;
}

// --- messaging helpers ---
async function sendClientBookingConfirmation({ booking, actName }) {
  console.log(`🐣 (controllers/bookingController.js) sendClientBookingConfirmation called at`, new Date().toISOString(), { bookingId: booking?.bookingId, actName });
  try {
    const user = booking?.userAddress || {};
    const to = normalizePhone(
      user?.phone ||
      user?.mobile ||
      booking?.clientPhone ||
      ""
    );
    if (!to) return; // no phone – skip silently

    // Names
    const clientFirstName = firstNameOf(user);
    const firstName = clientFirstName; // matches your SMS template var
    const act = actName || booking?.actTscName || booking?.actName || "the band";

    // Date / venue
    const eventDateText = formatWithOrdinal(booking?.date || booking?.eventDate || new Date());
    const venueName = (booking?.venueAddress || booking?.venue || booking?.address || "")
      .split(",")
      .slice(-2)
      .join(",")
      .replace(/,\s*UK$/i, "")
      .trim();

    // Fee (prefer totals.fullAmount, fall back to fee)
    const fullAmount =
      Number(booking?.totals?.fullAmount ?? booking?.fee ?? 0);
    const feeText = fullAmount > 0 ? `£${fullAmount.toFixed(2)}` : "TBC";

    // Duties (no clear source on booking for client SMS; set a sensible default)
    const duties =
      booking?.primaryDuty ||
      booking?.duty ||
      "performance";

    // Build the exact SMS copy you asked for, wiring in the derived vars
    const smsBody =
      `Hi ${firstName}, ${clientFirstName} would like to book you with ${act} on ${eventDateText} ` +
      `at ${venueName} at a rate of ${feeText} for ${duties} duties. Are you able to accept the booking? ` +
      `Reply YES or NO. Thanks!`;

    // Template params for WA (kept in sync with the above)
    const params = {
      FirstName: firstName,
      ClientFirstName: clientFirstName,
      ActName: act,
      FormattedDate: eventDateText,
      FormattedAddress: venueName,
      Fee: feeText,
      Duties: duties,
    };

    await sendWhatsAppMessage({ to, templateParams: params, smsBody });
  } catch (e) {
    console.warn("⚠️ sendClientBookingConfirmation failed:", e?.message || e);
  }
}

async function pingLineupForAllocation({ actId, lineupId, dateISO, venueShort, dutiesOverride, perMemberFee }) {
  console.log(`🐣 (controllers/bookingController.js) pingLineupForAllocation called at`, new Date().toISOString(), { actId, lineupId, dateISO, venueShort });
  try {
    const act = await Act.findById(actId).lean();
    if (!act) { console.warn("[pingLineupForAllocation] no act", { actId }); return; }

    const allLineups = Array.isArray(act?.lineups) ? act.lineups : [];
    const lineup = allLineups.find(l => String(l._id) === String(lineupId) || String(l.lineupId) === String(lineupId)) || allLineups[0];
    if (!lineup) { console.warn("[pingLineupForAllocation] no lineup", { actId, lineupId }); return; }

    const membersRaw = Array.isArray(lineup.bandMembers) ? lineup.bandMembers : [];
    const formattedDate = formatWithOrdinal(dateISO);
    const shortAddress = String(venueShort || "");

    const normalize = (raw = "") => {
      let v = String(raw || "").replace(/^whatsapp:/i, "").replace(/\s+/g, "");
      if (!v) return "";
      if (v.startsWith("+")) return v;
      if (v.startsWith("07")) return v.replace(/^0/, "+44");
      if (v.startsWith("44")) return `+${v}`;
      return v;
    };

    let sentCount = 0;
    for (const m of membersRaw) {
      // Skip non-performers (e.g., Manager/Admin rows) so we don't message agents or blanks
      const roleLower = String(m?.instrument || "").trim().toLowerCase();
      if (!roleLower || roleLower === "manager" || roleLower === "admin") {
        continue;
      }
      // prefer phone on lineup member; else look up the Musician doc
      let phone = normalize(m?.phoneNumber || m?.phone || "");
      if (!phone && (m?.musicianId || m?._id)) {
        try {
          const mus = await Musician.findById(m.musicianId || m._id).select("phone phoneNumber firstName lastName email").lean();
          phone = normalize(mus?.phone || mus?.phoneNumber || "");
        } catch {}
      }
      if (!phone) {
        console.warn("[pingLineupForAllocation] skip: no phone for member", { name: `${m?.firstName || ""} ${m?.lastName || ""}`.trim(), instrument: m?.instrument || dutiesOverride || "" });
        continue;
      }

      const duties = m.instrument || dutiesOverride || "performance";

      // Create/update availability row (tracking + idempotency)
      try {
        const enquiryId = `${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        await AvailabilityModel.findOneAndUpdate(
          { actId, dateISO, phone },
          {
            $setOnInsert: {
              enquiryId,
              actId,
              lineupId: lineup?._id || lineup?.lineupId || null,
              musicianId: m?._id || m?.musicianId || null,
              phone,
              duties,
              formattedDate,
              formattedAddress: shortAddress,
              fee: "",
              reply: null,
              dateISO,
              createdAt: new Date(),
            },
            $set: { updatedAt: new Date() },
          },
          { new: true, upsert: true }
        );
      } catch (e) {
        console.warn("[pingLineupForAllocation] availability upsert failed", e?.message || e);
      }

      try {
        // WhatsApp ONLY here to avoid dual WA+SMS; SMS fallback handled elsewhere if needed
       const smsBody =
   `Hi ${m?.firstName}, you have a booking request for ${formattedDate} in ${shortAddress} ` +
   `with ${act.tscName || act.name || "the band"} for ${duties} at a rate of ` +
   `${perMemberFee ? `£${Number(perMemberFee).toFixed(0)}` : "TBC"}. ` +
   `Please reply YES or NO. 🤍 TSC`;
 await sendWhatsAppMessage({
   to: `whatsapp:${phone}`,
   templateParams: {
     FirstName: (m?.firstName),
     FormattedDate: formattedDate,
     FormattedAddress: shortAddress,
     Fee: perMemberFee ? `£${Number(perMemberFee).toFixed(0)}` : "TBC",
     Duties: duties,
     ActName: act.tscName || act.name || "the band",
   },
   smsBody,
 });
        sentCount++;
        console.log("[pingLineupForAllocation] ✓ WA sent", { to: phone, name: `${m?.firstName || ""} ${m?.lastName || ""}`.trim(), duties });
      } catch (e) {
        console.warn("[pingLineupForAllocation] send failed", { to: phone, err: e?.message || e });
      }
    }

    console.log("[pingLineupForAllocation] done", { actId, lineupId, members: membersRaw.length, sent: sentCount });
  } catch (e) {
    console.warn("⚠️ pingLineupForAllocation failed:", e?.message || e);
  }
}

const stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY_V2);


// ---------------- helpers ----------------

// Normalise and validate contact routing payloads for IVR/call forwarding
function normalizeContactRouting(src = {}) {
  console.log(`🐣 (controllers/bookingController.js) normalizeContactRouting called at`, new Date().toISOString());
  if (!src || typeof src !== "object") return null;
  const cleanPhone = (v) => (typeof v === "string" ? v.trim() : "");
  const cleanDigits = (v) => String(v || "").replace(/\D+/g, "");

  const out = {
    provider: src.provider || "twilio",
    mode: src.mode && ["pooled", "dedicated", "shared_ivr"].includes(src.mode) ? src.mode : undefined,
    proxyNumber: cleanPhone(src.proxyNumber || src.number || ""),
    ivrCode: cleanDigits(src.ivrCode || src.code || ""),
    ivrPin: src.ivrPin ? cleanDigits(src.ivrPin) : undefined,
    activeFrom: src.activeFrom ? new Date(src.activeFrom) : undefined,
    activeUntil: src.activeUntil ? new Date(src.activeUntil) : undefined,
    recordingEnabled: !!src.recordingEnabled,
    voicemail: src.voicemail
      ? {
          enabled: !!src.voicemail.enabled,
          emailForwardTo: src.voicemail.emailForwardTo || undefined,
          transcription: src.voicemail.transcription != null ? !!src.voicemail.transcription : true,
        }
      : undefined,
    ringStrategy: src.ringStrategy && ["simul", "hunt"].includes(src.ringStrategy) ? src.ringStrategy : "hunt",
    targets: Array.isArray(src.targets)
      ? src.targets
          .filter(Boolean)
          .map((t) => ({
            musicianId: t.musicianId || undefined,
            name: t.name || "",
            role: t.role || "",
            phone: cleanPhone(t.phone || t.number || ""),
            priority: Number.isFinite(Number(t.priority)) ? Number(t.priority) : 1,
          }))
      : undefined,
    webhookToken: src.webhookToken || undefined,
    active: src.active != null ? !!src.active : undefined,
    note: src.note || undefined,
  };

  // Strip unset keys so mongoose doesn't create empty subdocs
  Object.keys(out).forEach((k) => (out[k] === undefined || out[k] === "" ? delete out[k] : null));
  return Object.keys(out).length ? out : null;
}

// Human-friendly booking reference e.g. 250917-DOWNIE-19435
function makeBookingRef({ date, eventDate, clientName, userAddress } = {}) {
  console.log(`🐣 (controllers/bookingController.js) makeBookingRef called at`, new Date().toISOString(), { clientName });
  const d = new Date(date || eventDate || Date.now());
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const last =
    (clientName?.split(" ").pop() ||
      userAddress?.lastName ||
      "CLIENT")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `${yy}${mm}${dd}-${last}-${rand}`;
}

function buildEmergencyMirror(contactRouting) {
  console.log(`🐣 (controllers/bookingController.js) buildEmergencyMirror called at`, new Date().toISOString());
  if (!contactRouting) return null;
  const number = contactRouting.proxyNumber || "";
  const ivrCode = contactRouting.ivrCode || "";
  let activeWindowSummary = "";
  try {
    const from = contactRouting.activeFrom ? new Date(contactRouting.activeFrom) : null;
    const until = contactRouting.activeUntil ? new Date(contactRouting.activeUntil) : null;
    if (from && until && !isNaN(from) && !isNaN(until)) {
      const left = from.toLocaleString("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit" });
      const right = until.toLocaleString("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit" });
      activeWindowSummary = `${left} → ${right}`;
    }
  } catch {}
  return {
    number,
    ivrCode,
    note:
      "This number will put you in direct contact with the band on the day. It will cycle through band member phones until someone answers. Please take note of the code to enter upon calling.",
    activeWindowSummary,
  };
}

function daysUntil(dateStr) {
  console.log(`🐣 (controllers/bookingController.js) daysUntil called at`, new Date().toISOString(), { dateStr });
  if (!dateStr) return null;
  const now = new Date();
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ev = new Date(dateStr);
  const d1 = new Date(ev.getFullYear(), ev.getMonth(), ev.getDate());
  return Math.ceil((d1 - d0) / (1000 * 60 * 60 * 24));
}

function calcDeposit(totalGross) {
    console.log(`🐣 (controllers/bookingController.js) calcDeposit called at`, new Date().toISOString(), { totalGross });
  if (!totalGross || totalGross <= 0) return 0;
return Math.round(Number(totalGross) * 0.25);}

const makeBookingId = (dateStr = new Date().toISOString(), lastName = 'TSC') => {
  console.log(`🐣 (controllers/bookingController.js) makeBookingId called at`, new Date().toISOString(), { dateStr, lastName });
  try {
    const d = new Date(dateStr);
    const yymmdd = d.toISOString().slice(2,10).replace(/-/g,'');
    const rand = crypto.randomInt(10000, 99999);
    return `${yymmdd}-${String(lastName || 'TSC').toUpperCase()}-${rand}`;
  } catch {
    const rand = crypto.randomInt(10000, 99999);
    return `TSC-${rand}`;
  }
};

// keep controller self-contained
function ensureHasScheme(urlLike) {
  console.log(`🐣 (controllers/bookingController.js) ensureHasScheme called at`, new Date().toISOString(), { urlLike });
  if (!urlLike) return '';
  if (/^https?:\/\//i.test(urlLike)) return urlLike;
  return `http://${urlLike.replace(/^\/+/, '')}`;
}
function getFrontendOrigin(req) {
  console.log(`🐣 (controllers/bookingController.js) getFrontendOrigin called at`, new Date().toISOString(), { originHeader: req.headers?.origin });
  const fromEnv = process.env.FRONTEND_URL;
  const envNormalized = fromEnv ? ensureHasScheme(fromEnv) : null;
  const fromHeader = req.headers?.origin;
  const headerNormalized = fromHeader ? ensureHasScheme(fromHeader) : null;
  const fallback = 'http://localhost:5174';
  try {
    const chosen = envNormalized || headerNormalized || fallback;
    const u = new URL(chosen);
    return `${u.protocol}//${u.host}`;
  } catch {
    return fallback;
  }
}
function requireAbsoluteUrl(u) {
  console.log(`🐣 (controllers/bookingController.js) requireAbsoluteUrl called at`, new Date().toISOString(), { u });
  const parsed = new URL(u);
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  return u;
}

// ---------------- Enquiry Board helpers ----------------

async function upsertEnquiryRowFromShortlist(src = {}) {
  console.log(`🐣 (controllers/bookingController.js) upsertEnquiryRowFromShortlist called at`, new Date().toISOString(), { actName: src.actName, actTscName: src.actTscName });
  try {
    const {
      actId,
      actName,
      actTscName,
      lineup,
      userId,
      budget,
      eventDateISO,
      address,
      county,
      enquiryRef,
      agent,
    } = src;

    const todayISO = new Date().toISOString().slice(0, 10);

    // calculate potential gross + commission (25% margin assumption)
    const grossValue = Number(budget) || 0;
    const netCommission = grossValue > 0 ? Math.round(grossValue * 0.25) : 0;

    // derive band size
    const bandSize = Array.isArray(lineup?.bandMembers)
      ? lineup.bandMembers.filter(m => String(m.instrument || "").toLowerCase() !== "manager").length
      : 0;

    const filter = { enquiryRef: enquiryRef || `${actTscName || actName}-${todayISO}` };

    const update = {
      $setOnInsert: { createdAt: new Date() },
      $set: {
        enquiryRef: enquiryRef || `${actTscName || actName}-${todayISO}`,
        enquiryDateISO: todayISO,
        eventDateISO: eventDateISO || null,
        actName: actName || "",
        actTscName: actTscName || "",
        agent: agent || "TSC Direct",
        address: address || "",
        county: county || "",
        grossValue,
        netCommission,
        bandSize,
        maxBudget: budget || null,
        updatedAt: new Date(),
      },
    };

    await EnquiryBoardItem.findOneAndUpdate(filter, update, { upsert: true, new: true });
    console.log("✅ upsertEnquiryRowFromShortlist OK", { actTscName, grossValue, netCommission });
  } catch (e) {
    console.error("❌ upsertEnquiryRowFromShortlist failed:", e);
  }
}
export const listEnquiryBoardRows = async (req, res) => {
  console.log(`🐣 (controllers/bookingController.js) listEnquiryBoardRows called at`, new Date().toISOString(), { query: req.query });
  try {
    const { q, sortBy = "enquiryDateISO", sortDir = "asc" } = req.query;
    const query = {};

    if (q) {
      query.$or = [
        { enquiryRef: new RegExp(q, "i") },
        { actName: new RegExp(q, "i") },
        { actTscName: new RegExp(q, "i") },
        { county: new RegExp(q, "i") },
        { address: new RegExp(q, "i") },
      ];
    }

    const rows = await EnquiryBoardItem.find(query)
      .sort({ [sortBy]: sortDir === "asc" ? 1 : -1 })
      .limit(500);

    res.json({ success: true, rows });
  } catch (e) {
    console.error("listEnquiryBoardRows error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ---------------- calendar helpers (NEW) ----------------

/**
 * Build attendee list either from a lineupId on the Act, or from musician IDs (bandLineup).
 * Returns [{email}, ...].
 */
async function buildAttendees({ actId, lineupId, bandLineup }) {
  console.log(`🐣 (controllers/bookingController.js) buildAttendees called at`, new Date().toISOString(), { actId, lineupId, bandLineupCount: bandLineup?.length });
  const act = await Act.findById(actId).lean();
  if (!act) return [];

  // Prefer emails from the chosen lineup (band members)
  if (lineupId) {
    const lineup = (act.lineups || []).find(
      l => String(l._id) === String(lineupId) || String(l.lineupId) === String(lineupId)
    );
    if (lineup) {
      return (lineup.bandMembers || [])
        .map(m => m.email || m.emailAddress)
        .filter(Boolean)
        .map(email => ({ email }));
    }
  }

  // Fallback: resolve musician docs from bandLineup (array of musician IDs)
  if (Array.isArray(bandLineup) && bandLineup.length) {
    const docs = await Musician.find({ _id: { $in: bandLineup } })
      .select({ email: 1 })
      .lean();
    return docs
      .map(d => d?.email)
      .filter(Boolean)
      .map(email => ({ email }));
  }

  return [];
}

async function upsertCalendarForConfirmedBooking({
  
  booking,                // Booking document (lean or doc)
  actId,                  // string
  lineupId,               // string | null
  bandLineup,             // array of musicianIds (fallback)
  venue,                  // string
}) {
  console.log(`🐣 (controllers/bookingController.js) upsertCalendarForConfirmedBooking called at`, new Date().toISOString(), { actId, lineupId, venue });
  const dateISO = new Date(booking.date).toISOString().slice(0,10);

  // find an existing availability YES event if any
  const avail = await AvailabilityModel.findOne({
    actId,
    dateISO,
    reply: 'yes',
    calendarEventId: { $ne: null }
  }).sort({ updatedAt: -1 }).lean();

  const attendees = await buildAttendees({ actId, lineupId, bandLineup });

  if (avail?.calendarEventId) {
    await updateCalendarEvent({
      eventId: avail.calendarEventId,
      addAttendees: attendees
    });
    // also mirror the eventId onto the booking for convenience
    await Booking.updateOne(
      { _id: booking._id },
      { $set: { calendarEventId: avail.calendarEventId } }
    );
    return { updatedEventId: avail.calendarEventId, createdEventId: null };
  }

  // Create fresh event if none exists
  const start = new Date(`${dateISO}T17:00:00Z`);
  const end   = new Date(`${dateISO}T22:59:00Z`);

  const act = await Act.findById(actId).lean();
  const created = await createCalendarInvite({
    enquiryId: booking._id?.toString?.() || `BOOK_${Date.now()}`,
    email: attendees[0]?.email || undefined, // seed with at least one
    summary: `TSC: Booking — ${act?.tscName || act?.name || 'Act'}`,
    description: `Confirmed booking: ${venue || ''}`,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    attendees
  });

  await Booking.updateOne(
    { _id: booking._id },
    { $set: { calendarEventId: created?.id || null } }
  );

  return { updatedEventId: null, createdEventId: created?.id || null };
}

// ---------------- Stripe checkout → pending booking ----------------

export const createCheckoutSession = async (req, res) => {
  console.log(`🐣 (controllers/bookingController.js) createCheckoutSession called at`, new Date().toISOString(), { bodyKeys: Object.keys(req.body || {}) });
  try {
    const {
      cartDetails,
      actsSummary,
      eventType,
      date,
      venue,
      venueAddress,
      customer,
      signature,
      paymentMode,
      userId: bodyUserId,
    } = req.body;

    const authUserId = req.user?._id || req.user?.id || null;
    const userId = bodyUserId || authUserId || null;
    const userEmail = customer?.email || req.user?.email || null;

    if (!Array.isArray(cartDetails) || cartDetails.length === 0) {
      return res.status(400).json({ error: "No cartDetails provided." });
    }
    if (!customer) {
      return res.status(400).json({ error: "Missing customer info." });
    }
    if (!signature) {
      return res.status(400).json({ error: "Missing signature image." });
    }

    console.log("🧾 createCheckoutSession body:", {
      items: cartDetails?.length,
      hasActsSummary: Array.isArray(actsSummary),
      eventType,
      date,
      venue,
      paymentMode,
      userId,
      userEmail,
    });

    // Detect test acts
const isTestActName = (name = "") => {
  const n = name.toLowerCase();
  return (
    n.includes("test dancefloor magic") ||
    n.includes("test soul allegiance") ||
    n.includes("test motown magic")
  );
};

// Detect test act lineup in Stripe-friendly item name
const extractActName = (fullName = "") => {
  // Example: "Booking: Test Dancefloor Magic - 4-Piece"
  return fullName.replace("Booking:", "").split("-")[0].trim();
};

    const safeItems = cartDetails
      .map((it) => ({
        name: String(it?.name || "").trim(),
        price: Number(it?.price || 0),
        quantity: Number(it?.quantity || 1),
      }))
      .filter(
        (it) =>
          it.name &&
          Number.isFinite(it.price) &&
          it.price > 0 &&
          Number.isFinite(it.quantity) &&
          it.quantity > 0
      );

      // 🔧 Force minimum 50p for test acts
safeItems.forEach((it) => {
  const actName = extractActName(it.name);

  if (isTestActName(actName)) {
    if (it.price < 0.50) {
      console.log("⚠️ Test act uplift: price", it.price, "→ 0.50");
      it.price = 0.50; // Convert to 50p
    }
  }
});

    if (safeItems.length === 0) {
      return res.status(400).json({ error: "No payable items found in cartDetails." });
    }

// After applying test-act uplifts on safeItems:
let grossTotal = safeItems.reduce((sum, it) => sum + it.price * it.quantity, 0);

// ⛑️ Safety: ensure grossTotal is never below 0.50 for test acts
const isTestBooking = safeItems.some(it =>
  isTestActName(extractActName(it.name))
);

if (isTestBooking && grossTotal < 0.50) {
  console.log("⚠️ Uplifting grossTotal", grossTotal, "→ 0.50 minimum");
  grossTotal = 0.50;   // ✔️ Now allowed
}

let depositGross = calcDeposit(grossTotal);

// Stripe min charge 50p
if (isTestBooking && depositGross < 0.50) {
  console.log("⚠️ Uplifting deposit", depositGross, "→ 0.50 minimum");
  depositGross = 0.50;
}

    const dte = daysUntil(date);
    const requiresFull = dte != null && dte <= 28;
    const clientHint = paymentMode === "full" || paymentMode === "deposit" ? paymentMode : null;
    const finalMode = requiresFull ? "full" : clientHint || "deposit";
const chargeGross = finalMode === "full" ? grossTotal : depositGross;

// Stripe hard safety rule:
if (!Number.isFinite(chargeGross) || chargeGross < 0.50) {
  return res.status(400).json({ error: "Calculated charge amount is invalid." });
}

    const pretty = (n) =>
      Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const bits = [];
    if (eventType) bits.push(eventType);
    if (date) bits.push(new Date(date).toDateString());
    if (venue) bits.push(venue);
    const suffix = bits.length ? ` – ${bits.join(" / ")}` : "";

    const lineItemName =
      finalMode === "full"
        ? `Booking – Full Amount${suffix}`
        : `Booking Deposit (${pretty(grossTotal)} total)${suffix}`;

    const unitAmountMinor = Math.round(chargeGross * 100);

    const origin = getFrontendOrigin(req);
    const success_url = requireAbsoluteUrl(
      `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}`
    );
    const cancel_url = requireAbsoluteUrl(`${origin}/cart`);

    console.log("🧮 Charge decision", {
      grossTotal,
      depositGross,
      daysUntilEvent: dte,
      requiresFull,
      clientHint,
      finalMode,
      chargeGross,
      origin,
      success_url,
      cancel_url,
    });

        const bookingId = makeBookingId(date, customer?.lastName || "TSC");


    const session = await stripeInstance.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      success_url,
      cancel_url,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            product_data: { name: lineItemName },
            unit_amount: unitAmountMinor,
          },
        },
      ],
      metadata: {
        booking_ref: bookingId, 
        booking_mode: finalMode,
        gross_total_major: String(grossTotal),
        deposit_major: String(depositGross),
        event_type: eventType || "",
        event_date: date || "",
        venue: venue || "",
      },
    });

    // ---- ALWAYS normalize performanceTimes and mirror to actsSummary ----
    const normalizePerf = (src = {}) => ({
      arrivalTime: String(src.arrivalTime || ""),
      setupAndSoundcheckedBy: String(src.setupAndSoundcheckedBy || ""),
      startTime: String(src.startTime || ""),
      finishTime: String(src.finishTime || ""),
      finishDayOffset: Number(src.finishDayOffset || 0) || 0,
      paLightsFinishTime: String(src.paLightsFinishTime || ""),
      paLightsFinishDayOffset: Number(src.paLightsFinishDayOffset || 0) || 0,
    });

    const performanceTimes = normalizePerf(
      (req.body.performanceTimes && typeof req.body.performanceTimes === "object")
        ? req.body.performanceTimes
        : {}
    );

const actsSummaryWithPerf = Array.isArray(actsSummary)
  ? await Promise.all(
      actsSummary.map(async (it) => {
        const selectedVocalist = it.selectedVocalist || null;

        let selectedVocalistName = null;
        if (selectedVocalist?.musicianId) {
          selectedVocalistName = await lookupMusicianName(
            selectedVocalist.musicianId
          );
        }

        return {
          ...it,
          performance: normalizePerf(it.performance || performanceTimes),

          // carry over vocalist info
          selectedVocalist,
          selectedVocalistName,
        };
      })
    )
  : [];


    // ✅ Adjust deposit logic for full payments
    const fixedDeposit = finalMode === "full" ? 0 : depositGross;

    await Booking.create({
      bookingId,

      // per-item perf block (patched)
      actsSummary: actsSummaryWithPerf || actsSummary || [],

      // top-level canonical performance times (always present)
      performanceTimes,

      venueAddress: venueAddress || venue || "",
      eventType,
      venue,
      date,
      status: "pending",
      sessionId: session.id,
      userAddress: customer,
      signatureUrl: signature,
      amount: chargeGross,
      userId,
      userEmail,
      totals: {
        fullAmount: grossTotal,
        depositAmount: fixedDeposit, // ✅ fixes £41 issue
        chargedAmount: chargeGross,
        chargeMode: finalMode,
      },
    });

    console.log(`✅ Booking created: ${bookingId}`);
    return res.json({ url: session.url });
  } catch (err) {
    console.error("🔥 createCheckoutSession error:", err);
    return res.status(500).json({
      error: err?.message || "Server error while creating checkout session.",
    });
  }
};

// ---------------- contract + email PDF ----------------

cloudinary.config({
  cloud_name: process.env.REACT_APP_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.REACT_APP_CLOUDINARY_API_KEY,
  api_secret: process.env.REACT_APP_CLOUDINARY_API_SECRET,
});

const completeBooking = async (req, res) => {
 console.log(`🐣 (controllers/bookingController.js) completeBooking called at`, new Date().toISOString(), {
    query: req.query,
    body: req.body,
  });
  // Deep, step-by-step logging to trace failures in PDF + email + board mirror
  const t0 = Date.now();
  try {
    const { session_id } = req.query;
    console.log("[completeBooking] ▶ start", { session_id });

    const order = await Order.findOne({ sessionId: session_id });
    if (!order) {
      console.error("[completeBooking] ✖ no order for session", { session_id });
      return res.status(404).json({ message: 'Booking not found.' });
    }
    console.log("[completeBooking] ✓ order loaded", {
      bookingId: order.bookingId,
      hasActsSummary: Array.isArray(order?.actsSummary),
      totals: order?.totals,
      amount: order?.amount,
      userEmail: order?.userAddress?.email,
    });

    // ✅ mark confirmed (idempotent) + upsert board row
    if (order.status !== 'confirmed') {
      order.status = 'confirmed';
      await order.save();
      console.log("[completeBooking] ✓ order marked confirmed");
    } else {
      console.log("[completeBooking] ℹ already confirmed");
    }

    try {
      await upsertBoardRowFromBooking(order);
      console.log("[completeBooking] ✓ upsertBoardRowFromBooking done");
    } catch (e) {
      console.warn('⚠️ upsertBoardRowFromBooking failed in completeBooking:', e?.message || e);
    }

    // --- Messaging: confirm to client and ping lineup for allocation
    try {
      const confirmedActName = (order?.actsSummary?.[0]?.actTscName || order?.actsSummary?.[0]?.actName);
      await sendClientBookingConfirmation({ booking: order, actName: confirmedActName });
      console.log("[completeBooking] ✓ sendClientBookingConfirmation queued", { confirmedActName });
    } catch (e) { console.warn("⚠️ client confirm (completeBooking) failed:", e?.message || e); }

    // ---- NEW: compute per-member fee and notify confirmed performers ----
    try {
      // 1) Load the act + lineup to count performer members (exclude manager/admin)
      const actIdForCalc = order?.actsSummary?.[0]?.actId || order?.act;
      const lineupIdForCalc = order?.actsSummary?.[0]?.lineupId || order?.lineupId;
      const dateISOForCalc = new Date(order?.date || order?.eventDate).toISOString().slice(0,10);
      const shortAddrForCalc = (order?.venueAddress || order?.venue || "").split(',').slice(-2).join(',').replace(/,\s*UK$/i, '').trim();
     
     
     
      let performerCount = 0;
      let actNameForCalc = "";
      let dutiesLookup = {};
      let actDoc;              // ← hoisted
      let lineupDoc;

      if (actIdForCalc && lineupIdForCalc) {
        actDoc = await Act.findById(actIdForCalc).lean();
        actNameForCalc = actDoc?.tscName || actDoc?.name || "";
        const allLineups = Array.isArray(actDoc?.lineups) ? actDoc.lineups : [];
        lineupDoc = allLineups.find(l =>
          String(l._id) === String(lineupIdForCalc) || String(l.lineupId) === String(lineupIdForCalc)
        ) || allLineups[0];

      }
      const perMemberFeeComputed = computePerMemberFee({ lineup: lineupDoc, booking: order }, "completeBooking");

      // Log breakdown so we can see where 225 vs 370 might be coming from
      const lineupTotal = Number(lineupDoc?.base_fee?.[0]?.total_fee ?? 0);
      const bookingGross = Number(order?.totals?.fullAmount ?? order?.amount ?? 0);
      const performersCount = countPerformers(lineupDoc);
      console.log("[fee] breakdown", {
        bookingId: order?.bookingId,
        lineupId: lineupIdForCalc,
        lineupTotal,
        bookingGross,
        chosenGross: lineupTotal > 0 ? lineupTotal : bookingGross,
        performers: performersCount,
        perMemberFeeComputed,
      });

      // 2) Compute per-member fee (availability-logic)
      const perMemberFee = perMemberFeeComputed;

      // --- PATCHED LOGIC for safe logging ---
      try {
        const actId = actIdForCalc;
        const lineupId = lineupIdForCalc;
        await upsertCalendarForConfirmedBooking({
          booking: order,
          actId: actId,
          lineupId: lineupId || null,
          bandLineup: [], // unknown here
          venue: order?.venue || order?.venueAddress || ''
        });
        console.log("[completeBooking] ✓ calendar upsert for confirmed booking");
      } catch (e) {
        console.warn("[completeBooking] ⚠️ calendar upsert failed:", e?.message || e);
      }
    } catch (e) { console.warn("⚠️ lineup allocation ping (completeBooking) failed:", e?.message || e); }

    // ---------------- Render contract HTML ----------------
    const templatePath = path.join(__dirname, '..', 'views', 'contractTemplate.ejs');
    console.log("[completeBooking] ▶ render EJS", { templatePath });
    let html;
    try {
      html = await ejs.renderFile(templatePath, {
        bookingId: order.bookingId,
        userAddress: order.userAddress,
        actsSummary: order.actsSummary,
        total: order.totals?.fullAmount ?? order.amount,
        deposit: order.totals?.depositAmount ?? order.amount,
        signatureUrl: order.signatureUrl,
        logoUrl: `https://res.cloudinary.com/dvcgr3fyd/image/upload/v1746015511/TSC_logo_u6xl6u.png`,
      });
      console.log("[completeBooking] ✓ EJS rendered", { htmlLen: html?.length || 0 });
    } catch (e) {
      console.error('[completeBooking] ✖ EJS render failed:', e?.message || e);
      return res.status(500).json({ message: 'Failed to render contract.' });
    }

    // ---------------- Generate PDF via Puppeteer ----------------
    let pdfBuffer;
    try {
      console.log("[completeBooking] ▶ puppeteer launch");
      const browser = await launchBrowser({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      pdfBuffer = await page.pdf({ format: 'A4' });
      await browser.close();
      console.log("[completeBooking] ✓ PDF generated", { bytes: pdfBuffer?.length || 0 });
    } catch (e) {
      console.error('[completeBooking] ✖ PDF generation failed:', e?.message || e);
      return res.status(500).json({ message: 'Failed to create contract PDF.' });
    }

    // ✅ ESM-safe stream import (no require in ESM)
    const { PassThrough } = await import('stream');
    const bufferStream = new PassThrough();
    bufferStream.end(pdfBuffer);

    // Log Cloudinary configuration presence (not secrets)
    console.log('[completeBooking] cloudinary config present?', {
      cloud: !!process.env.REACT_APP_CLOUDINARY_CLOUD_NAME,
      key: !!process.env.REACT_APP_CLOUDINARY_API_KEY,
      sec: !!process.env.REACT_APP_CLOUDINARY_API_SECRET,
    });

    console.log('[completeBooking] ▶ upload to cloudinary');
    const cloudStream = cloudinary.uploader.upload_stream(
      { resource_type: 'raw', public_id: `contracts/${order.bookingId}` },
      async (error, result) => {
        if (error) {
          console.error('[completeBooking] ✖ Cloudinary upload failed:', error);
          // Even if upload fails, still try emailing PDF directly.
        }

        if (result?.secure_url) {
          order.pdfUrl = result.secure_url;
          try {
            await order.save();
            console.log('[completeBooking] ✓ order.pdfUrl saved', { pdfUrl: order.pdfUrl });
          } catch (e) {
            console.warn('[completeBooking] ⚠️ failed saving order with pdfUrl:', e?.message || e);
          }

          // Mirror onto booking board (use upsert true in case row was not created yet)
          try {
            const mirrorRes = await BookingBoardItem.updateOne(
              { bookingRef: order.bookingId },
              { $set: { contractUrl: order.pdfUrl, pdfUrl: order.pdfUrl } },
              { upsert: true }
            );
            console.log('[completeBooking] ✓ mirrored pdf to board', { matched: mirrorRes?.matchedCount, modified: mirrorRes?.modifiedCount, upserted: mirrorRes?.upsertedId });
          } catch (e) {
            console.warn('[completeBooking] ⚠️ Failed to mirror contractUrl to board:', e?.message || e);
          }
        } else {
          console.warn('[completeBooking] ⚠️ No secure_url from cloudinary result');
        }

        // ---------------- Send email with PDF attached ----------------
   // ---------------- Send email with PDF + inline signature ----------------
try {
  const tscName =
    (order?.actsSummary?.[0]?.tscName) ||
    (order?.actsSummary?.[0]?.actName) ||
    "the band";

  const eventDate = new Date(order?.date || order?.eventDate || Date.now());
  const fmt = (d) =>
    d.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  const fourWeeksBefore = new Date(eventDate.getTime());
  fourWeeksBefore.setDate(fourWeeksBefore.getDate() - 28);
  const twoWeeksBefore = new Date(eventDate.getTime());
  twoWeeksBefore.setDate(twoWeeksBefore.getDate() - 14);

  const eventSheetUrl = `${
    process.env.FRONTEND_BASE_URL || "http://localhost:5174"
  }/event-sheet/${order.bookingId}`;

  // Your main body (unchanged), with signature appended
  const bodyHtml = `
    <p>Hi ${order?.userAddress?.firstName || ""},</p>

    <p>Thank you for booking <strong>${tscName}</strong>! They’re very much looking forward to performing for you and your guests, and we’re excited to make sure we’ve got all the fine details so ${tscName} can put on a stellar show for you.</p>

    <p>When you’re ready, please click through to your <a href="${eventSheetUrl}"><strong>Event Sheet</strong></a> and kindly fill in the blanks — you can check things off as you go, and it will auto-save.</p>

    <p>Also, please feel free to email or WhatsApp us if you have any urgent questions or requests. Or, you can schedule a call directly in our calendar:
      <a href="https://calendly.com/thesupremecollective/call">https://calendly.com/thesupremecollective/call</a>
    </p>

    <p>The invoice for the balance, which is due 2 weeks before the performance, can be found on the Event Sheet.</p>

    <p><strong>Key dates for your diary</strong>:</p>
    <ul>
      <li>Song suggestions and First Dance (if Wedding) / Off-repertoire request (if not a wedding) due by <strong>${fmt(
        fourWeeksBefore
      )}</strong></li>
      <li>Completed Event Sheet (including playlists) and balance due by <strong>${fmt(
        twoWeeksBefore
      )}</strong></li>
    </ul>

    <p>You’ll also receive a few emails from us in the run-up to the performance date as reminders to submit information on the Event Sheet, just to keep everything on track for you and ${tscName}.</p>

    <p>Hopefully everything makes sense — but any questions, don’t hesitate!</p>

    <p>Warmest wishes,<br/><strong>The Supreme Collective</strong> 💫</p>

        ${signature}
  `;

  // Inline GIF via cid
  const sigPath = resolveSignatureGifPath();
  const signatureAttachment = sigPath
    ? [
        {
          filename: "signature.gif",
          path: sigPath,
          cid: "signature.gif", // MUST match the HTML: cid:signature.gif
          contentDisposition: "inline",
        },
      ]
    : []; // skip if not found (prevents crash)

  // Build recipients
  const toList = [order?.userAddress?.email].filter(Boolean).join(", ");

  const mailOptions = {
    from: '"The Supreme Collective" <hello@thesupremecollective.co.uk>',
    to: toList,
    bcc: '"The Supreme Collective" <hello@thesupremecollective.co.uk>',
    subject: `Booking Confirmation – ${order.bookingId}`,
    html: bodyHtml,
    attachments: [
      // PDF contract
      { filename: `Booking_${order.bookingId}.pdf`, content: pdfBuffer },
      // Inline signature GIF
      ...signatureAttachment,
    ],
  };

  const info = await transporter.sendMail(mailOptions);
  console.log("[completeBooking] ✓ email sent", {
    messageId: info?.messageId,
    accepted: info?.accepted,
    rejected: info?.rejected,
  });
} catch (mailErr) {
  console.error("[completeBooking] ✖ Email send failed:", mailErr?.message || mailErr);
  // still continue (page success already shown)
}
        const ms = Date.now() - t0;
        console.log(`[completeBooking] ✓ done in ${ms}ms`);
        return res.send('<h2>Thank you! Your booking has been confirmed and a copy of the contract emailed to you.</h2>');
      }
    );

    bufferStream.pipe(cloudStream);
  } catch (err) {
    console.error('[completeBooking] FATAL:', err);
    res.status(500).json({ message: 'Failed to complete booking.' });
  }
};

// ---------------- admin/listing endpoints ----------------

const allBookings = async (req,res) => {
  console.log(`🐣 (controllers/bookingController.js) allBookings called at`, new Date().toISOString());
  try {
    const bookings = await bookingModel.find({});
    res.json({success:true,bookings});
  } catch (error) {
    console.log(error);
    res.json({success:false,message:error.message});
  }
};

const userBookings = async (req, res) => {
  console.log(`🐣 (controllers/bookingController.js) userBookings called at`, new Date().toISOString(), {
    params: req.params,
  });
  try {
    const userId = req.params.userId || req.body.userId;
    if (!userId) return res.status(400).json({ success:false, message:"Missing userId" });

    const bookings = await Booking.find({ userId }).sort({ createdAt: -1 });
    res.json({ success:true, bookings });
  } catch (error) {
    console.error(error);
    res.json({ success:false, message:error.message });
  }
};

export const getBookingByRef = async (req, res) => {
  console.log(`🐣 (controllers/bookingController.js) getBookingByRef called at`, new Date().toISOString(), {
    params: req.params,
  });
  try {
    const { ref } = req.params;
    if (!ref) return res.status(400).json({ success:false, message:"Missing ref" });

    let booking = await Booking.findOne({ bookingId: ref });
    if (!booking && ref.match(/^[0-9a-fA-F]{24}$/)) {
      booking = await Booking.findById(ref);
    }
    if (!booking) return res.status(404).json({ success:false, message:"Not found" });

    res.json({ success:true, booking });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success:false, message:"Server error" });
  }
};

// ---------------- status update (admin) ----------------

const updateStatus = async (req,res) => {
  console.log(`🐣 (controllers/bookingController.js) updateStatus called at`, new Date().toISOString(), {
    body: req.body,
  });
  try {
    const { bookingId, status, lineupId, bandLineup } = req.body;
    const updated = await bookingModel.findByIdAndUpdate(
      bookingId,
      { status },
      { new: true }
    );

    if (!updated) {
      return res.json({success:false,message:'Booking not found'});
    }

    // 🔹 If an admin flips to confirmed, sync calendar now
    if (String(status).toLowerCase() === 'confirmed') {
      try {
        await upsertCalendarForConfirmedBooking({
          booking: updated,
          actId: updated.act || updated.actsSummary?.[0]?.actId, // try both shapes
          lineupId: lineupId || updated.lineupId || updated.actsSummary?.[0]?.lineupId || null,
          bandLineup: bandLineup || updated.bandLineup || [],
          venue: updated.venue || updated.venueAddress || ''
        });
      } catch (e) {
        console.warn('⚠️ Calendar sync on status change failed:', e?.message || e);
      }
    }

    res.json({success:true,message:'Status Updated', booking: updated});
  } catch (error) {
    console.log(error);
    res.json({success:false,message:error.message});
  }
};

// ---------------- manual creates & API create ----------------


const manualCreateBooking = async (req, res) => {
  console.log(`🐣 (controllers/bookingController.js) manualCreateBooking called at`, new Date().toISOString(), {
    body: req.body,
  });
  try {
    const {
      actId,
      lineup,
      eventDate,
      venue,
      clientName,
      clientEmail,
      clientPhone,
      feeDetails,
      notes,
      contactRouting,

      // ⬇️ NEW: allow admins to pass these when creating manually
      performanceTimes,
      actsSummary,
    } = req.body;

    const act = await Act.findById(actId);
    if (!act) {
      return res.status(404).json({ success: false, message: "Act not found" });
    }

    // ⬇️ normalize perf & patch items (mirrors the other flows)
    const normalizedPerf = (performanceTimes && typeof performanceTimes === 'object')
      ? {
          arrivalTime: performanceTimes.arrivalTime || undefined,
          setupAndSoundcheckedBy: performanceTimes.setupAndSoundcheckedBy || undefined,
          startTime: performanceTimes.startTime || undefined,
          finishTime: performanceTimes.finishTime || undefined,
          finishDayOffset: Number(performanceTimes.finishDayOffset || 0) || 0,
          paLightsFinishTime: performanceTimes.paLightsFinishTime || undefined,
          paLightsFinishDayOffset: Number(performanceTimes.paLightsFinishDayOffset || 0) || 0,
        }
      : null;

    const actsSummaryPatched = Array.isArray(actsSummary)
      ? actsSummary.map(it => ({
          ...it,
          performance: it.performance || normalizedPerf || undefined,
        }))
      : [];

    const newBooking = new Booking({
      act: actId,
      lineup,
      eventDate,
      venue,
      clientName,
      clientEmail,
      clientPhone,
      feeDetails,
      notes,
      createdManually: true,
      status: "confirmed",

      // ✅ store the normalized block + patched items
      performanceTimes: normalizedPerf || undefined,
      actsSummary: actsSummaryPatched.length ? actsSummaryPatched : undefined,
    });

    newBooking.bookingId = newBooking.bookingId || makeBookingRef({
      date: eventDate,
      clientName,
      userAddress: newBooking.userAddress,
    });

 

    // Optional: wire in IVR/call forwarding data if provided
    if (contactRouting) {
      const cr = normalizeContactRouting(contactRouting);
      if (cr) {
        newBooking.contactRouting = cr;
        // Mirror minimal emergency info for client-facing event sheet
        newBooking.eventSheet = newBooking.eventSheet || {};
        newBooking.eventSheet.emergencyContact = buildEmergencyMirror(cr);
      }
    }

    await newBooking.save();

    // ✅ board upsert
    try {
      await upsertBoardRowFromBooking(newBooking);
    } catch (e) {
      console.warn('⚠️ upsertBoardRowFromBooking failed (manualCreateBooking):', e?.message || e);
    }

    // 🔹 calendar sync for manual confirmed
    try {
      await upsertCalendarForConfirmedBooking({
        booking: newBooking,
        actId,
        lineupId: lineup?._id || lineup?.lineupId || null,
        bandLineup: [], // unknown here
        venue
      });
    } catch (e) {
      console.warn('⚠️ Calendar sync (manual) failed:', e?.message || e);
    }

    res.status(201).json({ success: true, message: "Booking created", booking: newBooking });
  } catch (err) {
    console.error("Manual booking error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


export const createBooking = async (req, res) => {
  console.log(`🐣 (controllers/bookingController.js) createBooking called at`, new Date().toISOString(), {
    bodyKeys: Object.keys(req.body || {}),
  });
  try {
    const {
      act,            // actId
      date,           // event date (ISO)
      venue,
      fee,            // gross £ for the act (what client owes in total)
      bandLineup,     // array of musician IDs who said Yes
      notes,
      clientName,
      clientEmail,
      clientPhone,
      performanceTimes,
      lineupId,       // preferred for attendee build
      totals,         // OPTIONAL: if front-end sends fullAmount/deposit/charged/etc
      sessionId,      // OPTIONAL: Stripe session id from checkout
      amount,         // OPTIONAL: last Stripe charge major £ (deposit or full)
      paymentMethod,  // OPTIONAL
      contactRouting,
    } = req.body;

    if (!act || !date || !venue || !fee || !bandLineup?.length) {
      return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    // ── Compute if this is a full payment case (≤ 28 days) ─────────────────────
    const eventDate = new Date(date);
    const daysOut = differenceInCalendarDays(startOfDay(eventDate), startOfDay(new Date()));
    const requiresFullPayment = Number.isFinite(daysOut) && daysOut <= 28;

    // What was charged now?
    const chargedAmountMajor = typeof amount === "number"
      ? amount
      : (requiresFullPayment ? fee : Math.round(fee * 0.2)); // fallback: 20% deposit if caller didn’t send totals

    const safeTotals = {
      fullAmount: Number(totals?.fullAmount ?? fee) || 0,
      depositAmount: Number(totals?.depositAmount ?? Math.round(fee * 0.2)) || 0,
      chargedAmount: Number(totals?.chargedAmount ?? chargedAmountMajor) || 0,
      chargeMode: requiresFullPayment ? "full" : "deposit",
      isLessThanFourWeeks: requiresFullPayment,
      currency: totals?.currency || "GBP",
    };

         
    const normalizedPerf = (performanceTimes && typeof performanceTimes === 'object')
  ? {
      arrivalTime: performanceTimes.arrivalTime || '',
      setupAndSoundcheckedBy: performanceTimes.setupAndSoundcheckedBy || '',
      startTime: performanceTimes.startTime || '',
      finishTime: performanceTimes.finishTime || '',
      finishDayOffset: Number(performanceTimes.finishDayOffset || 0) || 0,
      paLightsFinishTime: performanceTimes.paLightsFinishTime || '',
      paLightsFinishDayOffset: Number(performanceTimes.paLightsFinishDayOffset || 0) || 0,
    }
  : null;

// ensure every item has a performance block
const actsSummaryPatched = Array.isArray(req.body.actsSummary)
  ? req.body.actsSummary.map(it => ({
      ...it,
      performance: it.performance || normalizedPerf || undefined,
    }))
  : [];



    // ── Create and save booking ────────────────────────────────────────────────
const newBooking = new Booking({
  act,
  date: eventDate,
  venue,
  fee,
  bandLineup,
  notes,
  clientName,
  clientEmail,
  clientPhone,
  chosenVocalists: act.chosenVocalists || [],

  // ✅ use normalized block, not the raw input
  performanceTimes: normalizedPerf || undefined,

  // ✅ if caller sent actsSummary, persist the patched one
  actsSummary: actsSummaryPatched.length ? actsSummaryPatched : undefined,

  lineupId: lineupId || null,
  sessionId: sessionId || undefined,
  amount: chargedAmountMajor || 0,
  paymentMethod: paymentMethod || undefined,
  totals: safeTotals,
  status: "confirmed",
});


    newBooking.bookingId = newBooking.bookingId || makeBookingRef({
  date: eventDate,
  clientName,
  userAddress: newBooking.userAddress,
  performanceTimes: normalizedPerf || undefined,     // ← top-level mirror
  actsSummary: actsSummaryPatched,                   // ← items now carry performance
   });

    // Optional: wire in IVR/call forwarding data if provided
    if (contactRouting) {
      const cr = normalizeContactRouting(contactRouting);
      if (cr) {
        newBooking.contactRouting = cr;
        // Mirror minimal emergency info for client-facing event sheet
        newBooking.eventSheet = newBooking.eventSheet || {};
        newBooking.eventSheet.emergencyContact = buildEmergencyMirror(cr);
      }
    }

    // If deposit flow, compute balance fields now (stored on booking for boards/ops)
    if (!requiresFullPayment) {
      const balanceDueAt = startOfDay(subDays(eventDate, 14)); // 00:00 local day 14 days before
      const balanceAmountPence =
        Math.max(0, Math.round((safeTotals.fullAmount - safeTotals.chargedAmount) * 100));

      newBooking.balanceStatus = "scheduled";         // add to schema (see below)
      newBooking.balanceDueAt = balanceDueAt;         // add to schema (see below)
      newBooking.balanceAmountPence = balanceAmountPence; // add to schema (see below)
    }

    await newBooking.save();

    // ✅ board upsert (immediately after save)
    try {
      await upsertBoardRowFromBooking(newBooking);
    } catch (e) {
      console.warn("⚠️ upsertBoardRowFromBooking failed (createBooking):", e?.message || e);
    }

    // 🔔 optional: notify booked musicians
    try {
      await BookingNotifications?.notifyMusicians?.(newBooking, bandLineup);
    } catch (e) {
      console.warn("⚠️ notifyMusicians failed (non-fatal):", e?.message || e);
    }

    // --- Messaging: confirm to client and ping lineup for allocation
    try {
      await sendClientBookingConfirmation({ booking: newBooking, actName: undefined });
    } catch (e) { console.warn("⚠️ client confirm (createBooking) failed:", e?.message || e); }

    try {
      const actId   = newBooking?.act;
      const lineupId= lineupId || newBooking?.lineupId;
      const dateISO = new Date(newBooking?.date).toISOString().slice(0,10);
      const shortAddress = (newBooking?.venue || "").split(',').slice(-2).join(',').replace(/,\s*UK$/i, '').trim();
      await pingLineupForAllocation({ actId, lineupId, dateISO, venueShort: shortAddress });
    } catch (e) { console.warn("⚠️ lineup allocation ping (createBooking) failed:", e?.message || e); }

    // Ensures Google event exists and adds all lineup emails as attendees (calendar invites to band)
    try {
      await upsertCalendarForConfirmedBooking({
        booking: newBooking,
        actId: act,
        lineupId: lineupId || null,
        bandLineup,
        venue,
      });
    } catch (e) {
      console.warn("⚠️ Calendar sync (createBooking) failed:", e?.message || e);
    }

    // ── Schedule balance invoice + reminders (only if deposit flow) ────────────
    if (!requiresFullPayment) {
      try {
        // Prefer your internal route so everything is standardized in one place:
        await axios.post(
          `${backendUrl || process.env.BACKEND_URL || ""}/api/invoices/schedule-balance`,
          {
            bookingId: newBooking.bookingId || String(newBooking._id),
            actId: act,
            customerId: null, // fill if you map clients to Stripe Customers
            eventDateISO: eventDate.toISOString(),
            currency: "GBP",
            amountPence: newBooking.balanceAmountPence,
            metadata: {
              createdBy: newBooking.userId || "system",
              clientEmail: clientEmail || "",
              bookingMongoId: String(newBooking._id),
            },
          },
          { timeout: 10_000 }
        );
      } catch (e) {
        console.warn("⚠️ schedule-balance failed (non-fatal):", e?.response?.data || e?.message || e);
      }
    }

    return res.status(201).json({
      success: true,
      message: "Booking created, musicians notified, calendar updated, and balance scheduled when applicable.",
      booking: newBooking,
    });
  } catch (err) {
    console.error("Create booking error:", err);
    return res.status(500).json({ success: false, message: "Server error while creating booking." });
  }
};

// ---------------- musician payout flag ----------------

const markMusicianAsPaid = async (req, res) => {
  console.log(`🐣 (controllers/bookingController.js) markMusicianAsPaid called at`, new Date().toISOString(), {
    body: req.body,
  });
  try {
    const { bookingId, musicianId } = req.body;

    if (!bookingId || !musicianId) {
      return res.status(400).json({ success: false, message: "Missing bookingId or musicianId" });
    }

    const booking = await bookingModel.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    const musician = booking.musicians?.find?.(
      (m) => String(m.musicianId) === String(musicianId)
    );

    if (!musician) {
      return res.status(404).json({ success: false, message: "Musician not found in booking" });
    }

    musician.paid = true;
    await booking.save();

    return res.status(200).json({ success: true, message: "Musician marked as paid", booking });
  } catch (error) {
    console.error("Error marking musician as paid:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ---------------- event sheet ----------------

export const updateEventSheet = async (req, res) => {
  console.log(`🐣 (controllers/bookingController.js) updateEventSheet called at`, new Date().toISOString(), {
    body: req.body,
  });
  try {
    const { _id, bookingId, eventSheet } = req.body;
    if (!_id && !bookingId) {
      return res.status(400).json({ success: false, message: "Missing _id or bookingId" });
    }

    const update = { $set: { eventSheet, "eventSheet.updatedAt": new Date() } };
    let booking = null;

    if (_id && /^[0-9a-fA-F]{24}$/.test(String(_id))) {
      booking = await Booking.findByIdAndUpdate(_id, update, { new: true });
    } else if (bookingId) {
      booking = await Booking.findOneAndUpdate({ bookingId }, update, { new: true });
    }

    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    return res.json({ success: true, booking });
  } catch (err) {
    console.error("updateEventSheet error", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

async function upsertBoardRowFromBooking(booking) {
  console.log(`🐣 (controllers/bookingController.js) upsertBoardRowFromBooking called at`, new Date().toISOString(), {
    bookingId: booking?.bookingId,
    actName: booking?.actName,
  });
  if (!booking) return;

  // --- identifiers (use human ref) ---
  const bookingRef =
    booking.bookingId ||                  // e.g. 251101-DOWNIE-19435
    booking.bookingRef ||
    (booking._id ? String(booking._id).slice(-6) : "");

  // --- act + lineup ---
  const actFromSummary = Array.isArray(booking?.actsSummary)
    ? (booking.actsSummary[0] || {})
    : {};
  const actId    = actFromSummary?.actId || booking?.act || null;
  const lineup   = booking?.selectedLineup || booking?.lineup || actFromSummary?.lineup || {};
  const members  = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];
  const bandSize = members.filter(m => String(m.instrument || "").toLowerCase() !== "manager").length;

  // --- lineup composition ---
  const composition = Array.isArray(lineup?.bandMembers)
    ? lineup.bandMembers
        .filter(m => m.isEssential)
        .map(m => m.instrument)
        .filter(Boolean)
    : [];

  // --- dates ---
  const rawDate      = booking?.eventDate || booking?.date || booking?.eventDateISO;
  const eventDateISO = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : null;

  const enquiryDateISO =
    booking?.enquiryDateISO ||
    (booking?.createdAt ? new Date(booking.createdAt).toISOString().slice(0,10) : null);

  const bookingDateISO =
    booking?.bookingDateISO ||
    (booking?.confirmedAt ? new Date(booking.confirmedAt).toISOString().slice(0,10)
     : booking?.updatedAt ? new Date(booking.updatedAt).toISOString().slice(0,10)
     : null);

  // --- act/text fields ---
  const actName    = booking?.actName || actFromSummary?.actName || actFromSummary?.name || "";
  const actTscName = booking?.act?.tscName || booking?.actTscName || actFromSummary?.tscName || "";
  const agent      = booking?.agent || "TSC Direct";
  const address    = booking?.addressFormatted || booking?.venueAddress || booking?.address || booking?.venue || "";
  const county     = booking?.county || booking?.userAddress?.county || "";

  // --- client ---
  const clientFirstNames =
    booking?.clientFirstNames ||
    booking?.clientName ||
    [booking?.userAddress?.firstName, booking?.userAddress?.lastName].filter(Boolean).join(" ") ||
    "";

  const clientEmails = [];
  if (Array.isArray(booking?.clientEmails)) {
    for (const e of booking.clientEmails) if (e) clientEmails.push({ email: e });
  } else if (booking?.userAddress?.email) {
    clientEmails.push({ email: booking.userAddress.email });
  } else if (booking?.userEmail) {
    clientEmails.push({ email: booking.userEmail });
  }

  // --- money ---
  const grossValue =
    Number(booking?.gross) ||
    Number(booking?.total) ||
    Number(booking?.totals?.fullAmount) ||
    0;

  const netCommission =
    Number(booking?.commission) ||
    Number(booking?.agencyCommission) ||
    0;

  // --- payments ---
  const payments = {
    balanceInvoiceUrl: booking?.balanceInvoiceUrl || "",
    balancePaymentReceived: !!booking?.balancePaid,
    bandPaymentsSent: !!booking?.bandPaymentsSent,  // ✅ top-level now
    depositAmount: Number(booking?.totals?.depositAmount || 0) || undefined,
  };

  // --- contract/pdf ---
  const contractUrl = booking?.contractUrl || booking?.pdfUrl || "";

  // --- write (NO bookingDocId) ---
  const filter = { bookingRef };

  await BookingBoardItem.findOneAndUpdate(
    filter,
    {
      $setOnInsert: {
        bookingRef,
        createdAt: new Date(),
      },
      $set: {
        actId, // used by allocation refresher
        clientFirstNames,
        clientEmails,
        actName,
        actTscName,
        agent,
        address,
        county,

        eventSheetLink: booking.eventSheetLink || booking.eventSheetUrl || "",
        eventDateISO,
        enquiryDateISO,
        bookingDateISO,

        grossValue,
        netCommission,

        payments,
        contractUrl,
        pdfUrl: booking?.pdfUrl || "",

        bandSize,
        lineupSelected: lineup?.label || lineup?.name || actFromSummary?.lineupLabel || "",
        lineupComposition: composition,

arrivalTime: (booking?.performanceTimes?.arrivalTime || booking.arrivalTime || ""),
        bookingDetails: {
          eventType: booking.eventType || "",
          ceremony: booking.ceremony || {},
          afternoon: booking.afternoon || {},
          evening: booking.evening || {},
          djServicesBooked: !!booking.djServicesBooked,
        },

        eventType: booking.eventType || actFromSummary?.eventType || "",

        allocation: { status: "in_progress" },
        review: { requestedCount: 0, received: false },
        actOwnerMusicianId: booking.actOwnerMusicianId || booking.musicianOwnerId || null,
        "visibility.grossAndCommissionVisibleToAdminOnly": true,
        updatedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  console.log("📋 upsertBoardRowFromBooking OK", { bookingRef, actId, eventDateISO });
}

export const ensureEmergencyContact = async (req, res) => {
 console.log(`🐣 (controllers/bookingController.js) ensureEmergencyContact called at`, new Date().toISOString(), {
    params: req.params,
  });
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ success: false, message: "Missing id" });

    const q = /^[0-9a-f]{24}$/i.test(id) ? { _id: id } : { bookingId: id };
    const book = await Booking.findOne(q);
    if (!book) return res.status(404).json({ success: false, message: "Booking not found" });

    // If already present, just ensure the mirror exists and return
    if (book?.contactRouting?.ivrCode && book?.contactRouting?.proxyNumber) {
      book.eventSheet = book.eventSheet || {};
      book.eventSheet.emergencyContact = mirrorEmergencyContact(book.contactRouting);
      await book.save();
      return res.json({ success: true, booking: book });
    }

    // Need a Twilio shared number configured
    if (!process.env.TWILIO_SHARED_IVR_NUMBER) {
      return res.status(500).json({
        success: false,
        message: "TWILIO_SHARED_IVR_NUMBER is not configured",
      });
    }

    // Generate and persist IVR details
    setSharedIVR(book);          // sets contactRouting + mirrors to eventSheet
    await book.save();

    return res.json({ success: true, booking: book });
  } catch (err) {
    console.error("ensureEmergencyContact error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// helpers inside bookingController.js


// Small date helper
function toDateISO(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * 2️⃣ + 3️⃣
 * Send booking confirmation to the **lead vocalist**
 * and mark them unavailable / clear badges.
 */
async function confirmLeadVocalistForBooking(booking) {
  const actSummary = Array.isArray(booking.actsSummary)
    ? booking.actsSummary[0]
    : null;

  const chosen = actSummary?.chosenVocalists?.[0];
  if (!chosen?.musicianId) {
    console.warn("🎤 No chosen lead vocalist on booking", { bookingId: booking.bookingId });
    return;
  }

  const musician = await Musician.findById(chosen.musicianId).lean();
  if (!musician) {
    console.warn("🎤 Lead vocalist musician not found", { musicianId: chosen.musicianId });
    return;
  }

  const phone = normalize(musician.phone || musician.phoneNumber);
  if (!phone) {
    console.warn("🎤 Lead vocalist has no valid phone", { musicianId: chosen.musicianId });
  }

  const actName =
    actSummary?.actName ||
    booking.actName ||
    "Your Act";

  const venueAddress =
    booking.venueAddress ||
    booking.venue ||
    "Venue";

  const eventDateISO = toDateISO(booking.date);
  const formattedDate = new Date(booking.date).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // 2️⃣ WhatsApp to lead vocalist (confirmed booking)
  if (phone) {
    try {
      const contentSid =
        process.env.TWILIO_VOCALIST_BOOKING_CONFIRMATION_SID ||
        process.env.TWILIO_BOOKING_CONFIRMATION_SID; // fallback

      await sendWhatsAppMessage({
        to: phone,
        contentSid,
        variables: {
          1: musician.firstName || "there",
          2: formattedDate,
          3: venueAddress,
          4: actName,
        },
      });

      console.log("📣 Lead vocalist confirmation WA sent", {
        to: phone,
        musicianId: musician._id,
        bookingId: booking.bookingId,
      });
    } catch (err) {
      console.warn("⚠️ Failed to send lead vocalist WA:", err.message);
    }
  }

  // 3️⃣ Mark vocalist unavailable for that date in AvailabilityModel
  try {
    await AvailabilityModel.updateMany(
      {
        musicianId: musician._id,
        dateISO: eventDateISO,
      },
      {
        $set: {
          reply: "yes",
          updatedAt: new Date(),
        },
      }
    );
  } catch (err) {
    console.warn("⚠️ Failed to mark vocalist unavailable in AvailabilityModel:", err.message);
  }

  // 3️⃣ Clear availability badges for this vocalist on this date across all acts
  try {
    await Act.updateMany(
      {
        "availabilityBadges.vocalistId": musician._id,
        "availabilityBadges.dateISO": eventDateISO,
      },
      {
        $set: { "availabilityBadges.active": false },
        $unset: {
          "availabilityBadges.vocalistName": "",
          "availabilityBadges.inPromo": "",
          "availabilityBadges.dateISO": "",
          "availabilityBadges.address": "",
          "availabilityBadges.setAt": "",
        },
      }
    );
    console.log("🧼 Cleared availability badges for vocalist", {
      vocalistId: musician._id,
      eventDateISO,
    });
  } catch (err) {
    console.warn("⚠️ Failed to clear availability badges:", err.message);
  }
}

/**
 * 4️⃣ Trigger musician booking requests for the lineup
 * This uses your existing sendBookingRequestsToLineup helper.
 */
async function sendBookingRequestsToLineupFromBooking(booking) {
  if (!booking.act || !booking.lineupId || !booking.date) {
    console.warn("🎻 Cannot send booking requests – missing act/lineup/date", {
      act: booking.act,
      lineupId: booking.lineupId,
      date: booking.date,
    });
    return;
  }

  const dateISO = toDateISO(booking.date);
  const address = booking.venueAddress || booking.venue || "";

  await sendBookingRequestsToLineup({
    actId: booking.act,
    lineupId: booking.lineupId,
    date: dateISO,
    address,
  });

  console.log("📣 Booking requests triggered to lineup", {
    actId: booking.act,
    lineupId: booking.lineupId,
    dateISO,
  });
}

/********************************************************************************************
 * COMPLETE BOOKING V2 — Fully Refactored
 * --------------------------------------------------------
 * - Correct lookup by bookingId (NOT bookingRef)
 * - Idempotent (won’t double-send WA / email / contracts)
 * - Normalised booking fields (actName, eventDateISO, venueAddress)
 * - Clean steps with centralised error logging
 ********************************************************************************************/

export const completeBookingV2 = async (req, res) => {
  const { session_id } = req.query;

  console.log(`🐣 completeBookingV2 called`, {
    query: req.query,
    timestamp: new Date().toISOString(),
  });

  if (!session_id) {
    return res
      .status(400)
      .json({ success: false, message: "Missing session_id" });
  }

  try {
    // ------------------------------------------------
    // 0️⃣ Retrieve Stripe session
    // ------------------------------------------------
    const stripe = await import("stripe").then(
      (m) => new m.default(process.env.STRIPE_SECRET_KEY)
    );
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["payment_intent"],
    });

    const bookingRef = session?.metadata?.booking_ref;
    if (!bookingRef) {
      throw new Error("Stripe session missing booking_ref metadata");
    }

    // ------------------------------------------------
    // 1️⃣ Fetch booking by bookingId
    // ------------------------------------------------
    const booking = await Booking.findOne({ bookingId: bookingRef }).lean();
    if (!booking) {
      throw new Error(`Booking not found for bookingId ${bookingRef}`);
    }

    console.log("✅ Booking found:", bookingRef);

    // ------------------------------------------------
    // 1.5️⃣ Idempotency guard — prevents double-processing
    // ------------------------------------------------
    if (booking.checkoutCompleted) {
      console.log(
        "🟢 Booking already completed — skipping duplicate processing"
      );
      return res.json({ success: true, bookingRef });
    }

    const amountMajor = (session.amount_total || 0) / 100;

    await Booking.updateOne(
      { bookingId: bookingRef },
      {
        $set: {
          checkoutCompleted: true,
          payment: true,
          sessionId: session_id,
          amount: amountMajor,
        },
      }
    );

    // ------------------------------------------------
    // Normalised safe fields
    // ------------------------------------------------
    const actName =
      booking.actsSummary?.[0]?.actName ||
      booking.actName ||
      "Your Act";

    const venueAddress =
      booking.venueAddress ||
      booking.venue ||
      "Venue";

const eventDateISO = toDateISO(booking.date);
booking.eventDateISO = eventDateISO;

    // ------------------------------------------------
    // 5️⃣ Ensure ONE shared calendar event exists
    // ------------------------------------------------
 const sharedEventId = await updateOrCreateBookingEvent({ booking });
console.log("📅 Booking event updated:", sharedEventId);

    // ------------------------------------------------
    // 2️⃣ + 3️⃣ Lead vocalist confirm + mark unavailable + clear badges
    // ------------------------------------------------
    try {
      await confirmLeadVocalistForBooking(booking);
    } catch (err) {
      console.warn(
        "⚠️ confirmLeadVocalistForBooking failed (non-fatal):",
        err.message
      );
    }

    // ------------------------------------------------
    // 4️⃣ Trigger booking requests to full lineup
    // ------------------------------------------------
    try {
      await sendBookingRequestsToLineupFromBooking(booking);
    } catch (err) {
      console.warn(
        "⚠️ sendBookingRequestsToLineupFromBooking failed (non-fatal):",
        err.message
      );
    }

    // ------------------------------------------------
    // 6️⃣ Contract PDF Generation + Email
    // ------------------------------------------------
    try {
      const browser = await launchBrowser({
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      const page = await browser.newPage();
      await page.setContent(`
        <html>
        <body>
          <h1>Contract for ${actName}</h1>
          <p>Booking Ref: ${bookingRef}</p>
          <p>Event Date: ${eventDateISO}</p>
          <p>Venue: ${venueAddress}</p>
        </body>
        </html>
      `);

      const pdfBuffer = await page.pdf({ format: "A4" });
      await browser.close();

      console.log("📄 Contract generated:", bookingRef);

      // TODO: upload pdfBuffer to Cloudinary and email to client
      // await uploadAndEmailContract(pdfBuffer, booking);

    } catch (err) {
      console.error("❌ Contract generation failed:", err.message);
    }

    // ------------------------------------------------
    // 7️⃣ Clear the user's cart
    // ------------------------------------------------
    try {
      if (booking.userId) {
        await userModel.updateOne(
          { _id: booking.userId },
          { $set: { cartData: {} } }
        );
        console.log("🛒 User cart cleared:", booking.userId);
      }
    } catch (err) {
      console.error("❌ Failed to clear cartData:", err);
    }

    // (Optional) Booking board update / additional side effects here

    return res.json({ success: true, bookingRef });
  } catch (err) {
    console.error("❌ completeBookingV2 FATAL:", err);
    return res
      .status(500)
      .json({ success: false, message: err.message });
  }
};



// ---------------- exports ----------------

export {
  allBookings,
  userBookings,
  updateStatus,
  completeBooking,
  manualCreateBooking,
  markMusicianAsPaid,
  upsertBoardRowFromBooking,
  upsertEnquiryRowFromShortlist,
  computePerMemberFee,
};
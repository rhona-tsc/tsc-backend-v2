import {activeAllocationHold,withinAllocationWeek,vocalistAllocationBlocked} from '../utils/bookingAllocationPolicy.js';
import {normaliseAllocationRole} from '../utils/allocationRoles.js';
import {confirmedBookingAvailabilityWrite, syncConfirmedBookingAssignments} from '../services/manualBookingConfirmation.js';
import {actRoleDeputies} from '../utils/actRoleDeputies.js';
import {rosterEligibilityForBooking,eligibleDeputiesForBooking} from '../utils/bookingRosterPools.js';
import {findPriorAvailabilityDecline} from '../services/availabilityPriorDeclines.js';
import { ownsBookingAssignment, isWithdrawalTarget, withdrawalAvailabilityRecord } from '../utils/bookingWithdrawal.js';
import {getRosterPolicy,bookingRosterEligibility} from '../services/rosterEligibilityService.js';
import {rosterEligibility,eligibleRosterDeputies,selectRosterMember} from '../utils/rosterEligibility.js';
// backend/controllers/allocationController.js
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import EnquiryMessage from "../models/EnquiryMessage.js";
import {
  sendWhatsAppMessage,
  sendWhatsAppText,
  sendSMSMessage,
} from "../utils/twilioClient.js";
import {
  ensureBookingEvent,
  appendLineToEventDescription,
  addAttendeeToEvent,
  reinstateCalendarAttendee,
} from "./googleController.js";
import AvailabilityModel from "../models/availabilityModel.js";
import bookingBoardItem from "../models/bookingBoardItem.js";
import { updateOrCreateBookingEvent } from "../utils/updateOrCreateBookingEvent.js";
import Booking from "../models/bookingModel.js";
import DeputyJob from "../models/deputyJobModel.js";
import mongoose from "mongoose";
import { promptForProfileAfterAcceptance } from "../services/onboardingAcceptancePrompt.js";
import nodemailer from "nodemailer";
import { buildBandEventSheetEmailHtml } from "../utils/tscEmailBranding.js";
import { buildBandSheetShareUrl } from "../utils/bandSheetUrl.js";
import sendEmail from "../utils/sendEmail.js";
import {
  isOnlyActiveVocalist,
  isVocalRole,
} from "../utils/calendarBookingIdentity.js";

/* -------------------------------------------------------------------------- */
/*                            Helper: firstNameOf                             */
/* -------------------------------------------------------------------------- */
const firstNameOf = (p) => {
  console.log(`🦚 (controllers/allocationController.js) firstNameOf called at`, new Date().toISOString(), { p });
  if (!p) return "there";
  if (typeof p === "string") {
    const parts = p.trim().split(/\s+/);
    return parts[0] || "there";
  }
  const direct = p.firstName || p.FirstName || p.first_name || p.firstname || p.givenName || p.given_name || "";
  if (direct && String(direct).trim()) return String(direct).trim().split(/\s+/)[0];
  const full = p.name || p.fullName || p.displayName || "";
  if (full && String(full).trim()) return String(full).trim().split(/\s+/)[0];
  return "there";
};

/* -------------------------------------------------------------------------- */
/*                               Helper: sanitizeFee                          */
/* -------------------------------------------------------------------------- */
export const sanitizeFee = (v) => {
  console.log(`🦚 (controllers/allocationController.js) sanitizeFee called at`, new Date().toISOString(), { v });
  const s = String(v ?? "").trim();
  if (!s) return "TBC";
  return s.replace(/[^\d.]/g, "");
};

/* -------------------------------------------------------------------------- */
/*                              Helper: normalizeFrom                         */
/* -------------------------------------------------------------------------- */
const normalizeFrom = (from) => {
  console.log(`🦚 (controllers/allocationController.js) normalizeFrom called at`, new Date().toISOString(), { from });
  const v = String(from || '').replace(/^whatsapp:/i, '').trim();
  if (!v) return [];
  const plus = v.startsWith('+') ? v : (v.startsWith('44') ? `+${v}` : v);
  const uk07 = plus.replace(/^\+44/, '0');
  const ukNoPlus = plus.replace(/^\+/, '');
  return Array.from(new Set([plus, uk07, ukNoPlus]));
};



const formatWithOrdinal = (dateLike) => {
  const d = new Date(dateLike);
  if (isNaN(d)) return String(dateLike || "");
  const day = d.getDate();
  const j = day % 10, k = day % 100;
  const suffix = j === 1 && k !== 11 ? "st" : j === 2 && k !== 12 ? "nd" : j === 3 && k !== 13 ? "rd" : "th";
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const month = d.toLocaleDateString("en-GB", { month: "short" });
  const year = d.getFullYear();
  return `${weekday}, ${day}${suffix} ${month} ${year}`;
};

const formatBookingClock = (value = "") => {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return raw;
  const hour = Number(match[1]);
  const minute = match[2];
  if (!Number.isFinite(hour) || hour > 23) return raw;
  const hour12 = hour % 12 || 12;
  return `${hour12}.${minute}${hour < 12 ? "am" : "pm"}`;
};

const normalizePhone = (raw = "") => {
  let v = String(raw || "").replace(/^whatsapp:/i, "").replace(/\s+/g, "");
  if (!v) return "";
  if (v.startsWith("+")) return v;
  if (v.startsWith("07")) return v.replace(/^0/, "+44");
  if (v.startsWith("44")) return `+${v}`;
  return v;
};

const sendCompletedEventSheetToAcceptedMusician = async ({ booking, assignment, musician, email }) => {
  if (!booking?.eventSheet?.submitted || !email) return false;
  const token = String(booking?.eventSheet?.bandSheetToken || "").trim();
  if (!token) return false;
  const pdfUrl = buildBandSheetShareUrl(token);
  const user = process.env.SMTP_USER || process.env.EMAIL_USER || process.env.GMAIL_USER || process.env.MAIL_USER || process.env.AGENT_EMAIL;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASS || process.env.MAIL_PASS || process.env.AGENT_PASSWORD;
  if (!user || !pass) throw new Error("Missing SMTP credentials for event-sheet delivery");
  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: process.env.SMTP_SECURE != null
      ? String(process.env.SMTP_SECURE).toLowerCase() === "true"
      : port === 465,
    auth: { user, pass },
  });
  const firstName = assignment?.firstName || musician?.firstName || musician?.basicInfo?.firstName || "there";
  const actName = booking?.actName || booking?.actsSummary?.[0]?.actName || "the band";
  const eventDate = formatWithOrdinal(booking?.eventDateISO || booking?.eventDate || booking?.date || "");
  const role = assignment?.role || assignment?.instrument || "Band member";
  const text = [
    `Hi ${firstName},`,
    "",
    `As the event sheet for ${actName} on ${eventDate} has already been completed, here is your PDF copy:`,
    pdfUrl,
    "",
    `Your role: ${role}.`,
    "Please read the event sheet before the event and let Rhona know if anything is unclear.",
    "",
    "The Supreme Collective",
  ].join("\n");
  await transporter.sendMail({
    from: `${process.env.SMTP_FROM_NAME || process.env.EMAIL_FROM_NAME || "The Supreme Collective"} <${process.env.SMTP_FROM_EMAIL || process.env.EMAIL_FROM_ADDRESS || user}>`,
    to: email,
    replyTo: process.env.SMTP_FROM_EMAIL || process.env.EMAIL_FROM_ADDRESS || user,
    subject: `Event sheet: ${actName} — ${eventDate}`,
    text,
    html: buildBandEventSheetEmailHtml({
      firstName,
      bandName: actName,
      eventDate,
      role,
      eventSheetUrl: pdfUrl,
    }),
  });
  return true;
};

const buildBookingSMS = ({ firstName, formattedDate, formattedAddress, fee, currency = "GBP", duties, actName, requestId }) => {
  const symbol = String(currency).toUpperCase() === "EUR" ? "€" : String(currency).toUpperCase() === "USD" ? "$" : "£";
  return `Hi ${firstName || "there"}, booking request for ${formattedDate} at ${formattedAddress} with ${actName}. Role: ${duties || "performance"}. Fee: ${symbol}${sanitizeFee(fee) || "TBC"}. Reply YES (YESBOOK_${requestId}) or NO (NOBOOK_${requestId}). 🤍 TSC`;
};

const AUTOMATED_REPLY_INSTRUCTION =
  "This is an automated messaging service. Please use the quick reply buttons to answer this message. If you have additional questions about this gig, please message +44 7594 223200.";

const sendInboundAcknowledgement = async ({ to, body, isWhatsApp = true }) => {
  const phone = normalizePhone(to);
  if (!phone) return;
  try {
    if (isWhatsApp) await sendWhatsAppText(phone, body);
    else await sendSMSMessage(phone, body);
  } catch (error) {
    console.error("Failed to send inbound acknowledgement:", error?.message || error);
  }
};


const findRealMusicianForMember = async (member = {}) => {
  try {
    if (member?.musicianId) {
      const byId = await Musician.findById(member.musicianId)
        .select("_id firstName lastName email phone phoneNumber phoneNormalized")
        .lean();
      if (byId) return byId;
    }

    const hasOwnPhone = !!normalizePhone(member?.phoneNumber || member?.phone || "");
    const hasOwnEmail = !!String(member?.email || member?.emailAddress || "").trim();

    // If ACT member already has its own contact data, do not try to match by phone/email.
    // That avoids cross-linking to the wrong real musician in test acts.
    if (hasOwnPhone || hasOwnEmail) {
      return null;
    }

    return null;
  } catch (err) {
    console.warn("⚠️ findRealMusicianForMember failed:", err?.message || err);
    return null;
  }
};

const buildMemberFee = ({ perMemberFee, member }) => {
  if (Number.isFinite(Number(perMemberFee)) && Number(perMemberFee) > 0) {
    return Math.ceil(Number(perMemberFee));
  }
  const memberFee = Number(member?.fee || 0);
  return Number.isFinite(memberFee) && memberFee > 0 ? Math.ceil(memberFee) : 0;
};

const hasPositiveAllocationFee = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
};

const allocationFeeRequiredResponse = (res) =>
  res.status(400).json({
    success: false,
    code: "ALLOCATION_FEE_REQUIRED",
    message:
      "Enter a fee above £0 before sending or manually accepting an allocation.",
  });

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const musicianDisplayName = (musician = {}) =>
  [
    musician.firstName || musician.basicInfo?.firstName,
    musician.lastName || musician.basicInfo?.lastName,
  ]
    .filter(Boolean)
    .join(" ")
    .trim() || musician.email || "Musician";

const candidateContact = (musician = {}) => ({
  email: String(musician.email || musician.basicInfo?.email || "").trim().toLowerCase(),
  phone: normalizePhone(
    musician.phone || musician.phoneNumber || musician.basicInfo?.phone || "",
  ),
});

const buildRoleSlotId = (role = "", index = 0) =>
  `${String(role || "role").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`;

const findOriginalBandMemberForSlot = ({ lineup, role, roleSlotId, requestedId }) => {
  const members = lineup?.bandMembers || [];
  const requested = members.find(
    (member) => String(member?._id || "") === String(requestedId || ""),
  );
  if (requested) return requested;

  const matching = members.filter(
    (member) =>
      String(member?.instrument || member?.role || "").trim().toLowerCase() ===
      String(role || "").trim().toLowerCase(),
  );
  const occurrence = Math.max(
    0,
    Number(String(roleSlotId || "").match(/-(\d+)$/)?.[1] || 1) - 1,
  );
  return matching[occurrence] || matching[0] || null;
};

export const resolveBoardItem = async (rawId) => {
  if (!rawId) return null;
  const value = String(rawId).trim();
  const conditions = [{ bookingRef: value }];
  if (mongoose.isValidObjectId(value)) {
    conditions.unshift({ _id: value }, { bookingId: value }, { sourceBookingId: value });
  }
  return bookingBoardItem.findOne({ $or: conditions });
};

const resolveSourceBooking = async (board, select = "") => {
  const conditions = [];
  for (const value of [board?.bookingId, board?.sourceBookingId]) {
    if (value && mongoose.isValidObjectId(String(value))) {
      conditions.push({ _id: value });
    }
  }
  if (board?.bookingRef) conditions.push({ bookingRef: board.bookingRef });
  if (!conditions.length) return null;

  const query = Booking.findOne({ $or: conditions });
  if (select) query.select(select);
  return query.lean();
};

export const getActLineupContext = async (board) => {
  let linkedBooking = null;
  const boardActId =
    board?.actId || board?.actsSummary?.[0]?.actId || board?.actsSummary?.[0]?._id;

  // Some legacy/synchronised board rows were created without copying the act
  // linkage from their source booking. Resolve through that booking so role
  // offers still work, rather than presenting an unhelpful "not linked" error.
  if (!boardActId) {
    linkedBooking = await resolveSourceBooking(
      board,
      "act actId lineupId actsSummary",
    );
  }

  const actId =
    boardActId ||
    linkedBooking?.act ||
    linkedBooking?.actId ||
    linkedBooking?.actsSummary?.[0]?.actId ||
    linkedBooking?.actsSummary?.[0]?._id;
  const act = actId ? await Act.findById(actId).lean() : null;
  const requestedLineup = String(
    board?.actsSummary?.[0]?.lineupId ||
      board?.lineupId ||
      linkedBooking?.actsSummary?.[0]?.lineupId ||
      linkedBooking?.lineupId ||
      "",
  );
  const lineup =
    act?.lineups?.find(
      (entry) =>
        String(entry?._id || "") === requestedLineup ||
        String(entry?.lineupId || "") === requestedLineup,
    ) || act?.lineups?.[0] || null;
  return { act, lineup };
};

const completeAcceptedAssignment = async ({
  board,
  assignment,
  musician = null,
  manualConfirmation = false,
}) => {
  const booking = await resolveSourceBooking(board);
  const email = String(
    assignment?.email || musician?.email || musician?.basicInfo?.email || "",
  ).trim().toLowerCase();
  const phone = normalizePhone(
    assignment?.phone || musician?.phone || musician?.phoneNumber || musician?.basicInfo?.phone || "",
  );
  let eventId = "";

  try {
    if (booking) {
      eventId = await updateOrCreateBookingEvent({
        booking,
        assignedMusicians: board?.assignedMusicians || [],
      });
      if (eventId && email) await addAttendeeToEvent({ eventId, email, calendarId: booking.calendarId || "primary" });
      try {
        await sendCompletedEventSheetToAcceptedMusician({
          booking,
          assignment,
          musician,
          email,
        });
      } catch (eventSheetError) {
        console.warn("Could not email completed event sheet to accepted musician", {
          bookingRef: board?.bookingRef,
          email,
          message: eventSheetError?.message,
        });
      }
    }
  } catch (calendarError) {
    console.warn("Could not sync accepted musician to shared calendar", {
      bookingRef: board?.bookingRef,
      musicianId: String(assignment?.musicianId || musician?._id || ""),
      message: calendarError?.message,
    });
  }

  if (phone) {
    const date = formatWithOrdinal(board?.eventDateISO || booking?.eventDateISO || booking?.date || "");
    const roleAndDuties = [
      assignment?.role || assignment?.instrument || "Musician",
      ...(Array.isArray(assignment?.duties) ? assignment.duties : []),
    ].filter(Boolean).join(" · ");
    const fee = Number(assignment?.fee || assignment?.totalFee || 0);
    const actName = board?.actName || booking?.actName || booking?.actsSummary?.[0]?.actName || "the band";
    const address = String(
      board?.address ||
        board?.venueAddress ||
        booking?.venueAddress ||
        booking?.venue ||
        booking?.address ||
        "",
    ).trim();
    const failureEmailTo = String(
      process.env.ALLOCATION_FAILURE_EMAIL ||
        process.env.ADMIN_EMAIL ||
        "rhona@thesupremecollective.co.uk",
    ).trim();
    const failureEmailSubject = `WhatsApp confirmation failed: ${assignment?.name || musicianDisplayName(musician || {})} — ${board?.bookingRef || "booking"}`;
    const failureEmailText = [
      "A musician confirmation could not be delivered by WhatsApp. No SMS fallback was sent.",
      `Booking: ${board?.bookingRef || "Not recorded"}`,
      `Act: ${actName}`,
      `Musician: ${assignment?.name || musicianDisplayName(musician || {})}`,
      `Role: ${roleAndDuties}`,
      `Event date: ${date || "Not recorded"}`,
      `Address: ${address || "Not recorded"}`,
      `Phone: ${phone}`,
      "The musician remains confirmed on the booking. Please contact them manually if needed.",
    ].join("\n");
    const confirmationSid = String(
      process.env.TWILIO_VOCALIST_BOOKING_CONFIRMATION_SID ||
        process.env.TWILIO_BOOKING_CONFIRMATION_SID ||
        "",
    ).trim();
    const failureEmail = {
      to: failureEmailTo,
      subject: failureEmailSubject,
      text: failureEmailText,
    };

    if (!confirmationSid) {
      await sendEmail({
        to: failureEmailTo,
        subject: failureEmailSubject,
        text: `${failureEmailText}\n\nImmediate error: No approved booking-confirmation Content SID is configured.`,
      });
    } else {
      try {
        await sendWhatsAppMessage({
          to: phone,
          contentSid: confirmationSid,
          allowDefaultContentSid: false,
          variables: {
            "1": assignment?.firstName || musician?.firstName || "there",
            "2": date,
            "3": address,
            "4": String(fee),
            "5": roleAndDuties,
            "6": actName,
          },
          allowSmsFallback: false,
          source: manualConfirmation
            ? "manual-booking-confirmation"
            : "booking-acceptance-confirmation",
          requireOpportunityDetails: true,
          opportunityDetails: {
            actName,
            date,
            address,
            duties: roleAndDuties,
            fee,
          },
          failureEmail,
        });
      } catch (whatsAppError) {
        console.warn("Could not send booking acceptance confirmation; no SMS fallback", {
          phone,
          message: whatsAppError?.message,
        });
      }
    }
  }

  return { eventId, email };
};

export const updateBoardRoleSlot = async (msg, changes = {}) => {
  const board = msg?.bookingBoardItemId
    ? await bookingBoardItem.findById(msg.bookingBoardItemId)
    : await resolveBoardItem(msg?.bookingRef);
  if (!board || !msg?.roleSlotId) return null;

  if (["offered", "accepted", "confirmed"].includes(changes.status)) changes = {
    ...changes, withdrawnAt: null, withdrawalReason: "", withdrawalSource: "",
  };
  const apply = (entries = []) => {
    let matched = false;
    const updated = entries.map((entry) => {
      if (entry?.roleSlotId === msg.roleSlotId || (msg.enquiryId && entry?.offerRequestId === msg.enquiryId)) {
        matched = true;
        return { ...(entry.toObject?.() || entry), ...changes };
      }
      return entry;
    });
    if (!matched) {
      const role = String(msg.meta?.role || msg.duties || "Musician").split(" · ")[0].trim();
      updated.push({
        role,
        instrument: role,
        roleSlotId: msg.roleSlotId,
        offerRequestId: msg.enquiryId,
        fee: Number(msg.fee || 0),
        totalFee: Number(msg.fee || 0),
        source: "booking_role_offer",
        ...changes,
      });
    }
    return updated;
  };
  const updatedAssignments = apply(board.assignedMusicians || []);
  board.assignedMusicians = updatedAssignments;
  board.bookingMusicians = updatedAssignments;
  board.bandLineup = updatedAssignments;
  board.bookingDetails = {
    ...(board.bookingDetails?.toObject?.() || board.bookingDetails || {}),
    assignedMusicians: updatedAssignments,
  };
  const acceptedCount = board.assignedMusicians.filter((item) =>
    ["accepted", "confirmed"].includes(item?.status),
  ).length;
  const unresolvedCount = board.assignedMusicians.filter((item) =>
    ["unfilled", "selected", "offered", "proposed", "declined", "unavailable"].includes(item?.status),
  ).length;
  board.allocation = {
    ...(board.allocation?.toObject?.() || board.allocation || {}),
    status: unresolvedCount ? (acceptedCount ? "in_progress" : "gap") : "fully_allocated",
    lastCheckedAt: new Date(),
  };
  await board.save();
  const booking = await resolveSourceBooking(board);
  await syncConfirmedBookingAssignments({board,booking,BookingModel:Booking});
  return board;
};

export const reconcilePendingRoleOffer = async (msg) => {
  const board = msg.bookingBoardItemId
    ? await bookingBoardItem.findById(msg.bookingBoardItemId)
    : await resolveBoardItem(msg.bookingRef);
  if (!board) return { board: null, resolved: false };
  if (activeAllocationHold(board,msg.roleSlotId)||vocalistAllocationBlocked(board,msg.meta?.role||String(msg.duties||" ").split(" · ")[0])) return {board,resolved:true,held:true};
  const messageRole = String(msg?.meta?.role || msg?.duties || "")
    .split("·")[0]
    .trim()
    .toLowerCase();
  const messagePhone = normalizePhone(msg?.phone);
  const assignments = [
    ...(board.assignedMusicians || []),
    ...(board.bookingMusicians || []),
    ...(board.bandLineup || []),
    ...(board.bookingDetails?.assignedMusicians || []),
  ];
  const slot = assignments.find((entry) => {
    const entryRole = String(entry?.role || entry?.instrument || "").trim().toLowerCase();
    const sameRole = !messageRole || !entryRole || entryRole === messageRole;
    const sameIdentity =
      (msg?.musicianId && String(entry?.musicianId || "") === String(msg.musicianId)) ||
      (messagePhone && normalizePhone(entry?.phone) === messagePhone);
    return (
      (msg?.roleSlotId && String(entry?.roleSlotId || "") === String(msg.roleSlotId)) ||
      String(entry?.offerRequestId || "") === String(msg?.enquiryId || "") ||
      (sameIdentity && sameRole)
    );
  });
  if (["accepted", "confirmed"].includes(String(slot?.status || "").toLowerCase())) {
    await EnquiryMessage.updateOne(
      { _id: msg._id, $or: [{ reply: null }, { reply: { $exists: false } }] },
      {
        $set: {
          reply: "yes",
          repliedAt: slot?.respondedAt || slot?.acceptedAt || new Date(),
          status: "read",
          reconciledFromAllocationAt: new Date(),
        },
      },
    );
    return { board, resolved: true, slot };
  }
  if (!msg?.roleSlotId) return { board, resolved: false, slot: null };
  const musician = msg.musicianId
    ? await Musician.findById(msg.musicianId).lean()
    : null;
  const contact = candidateContact(musician || {});
  const updatedBoard = await updateBoardRoleSlot(msg, {
    musicianId: msg.musicianId,
    name: musicianDisplayName(musician || {}),
    firstName: musician?.firstName || musician?.basicInfo?.firstName || "",
    lastName: musician?.lastName || musician?.basicInfo?.lastName || "",
    email: msg.calendar?.attendeeEmail || contact.email,
    phone: msg.phone || contact.phone,
    status: "offered",
    offerRequestId: msg.enquiryId,
    offeredAt: msg.createdAt || new Date(),
  });
  return { board: updatedBoard, resolved: false, slot: null };
};

const closeCompetingRoleOffers = async (winner) => {
  if (!winner?.bookingRef || !winner?.roleSlotId) return;
  const pending = await EnquiryMessage.find({
    bookingRef: winner.bookingRef,
    roleSlotId: winner.roleSlotId,
    "meta.kind": "booking",
    $or: [{ reply: null }, { reply: { $exists: false } }],
  });

  for (const other of pending) {
    const isWinner =
      (winner.offerRequestId && String(other.enquiryId || "") === String(winner.offerRequestId)) ||
      (winner.musicianId && String(other.musicianId || "") === String(winner.musicianId));
    await EnquiryMessage.updateOne(
      { _id: other._id, $or: [{ reply: null }, { reply: { $exists: false } }] },
      {
        $set: {
          reply: isWinner ? "yes" : "unavailable",
          repliedAt: new Date(),
          status: "read",
          reconciledFromAllocationAt: new Date(),
        },
      },
    );
    if (!isWinner) {
      await sendInboundAcknowledgement({
        to: other.phone,
        body: "This role has now been allocated, so you no longer need to respond. Thank you. 🤍 TSC",
        isWhatsApp: true,
      });
    }
  }

  // A late acceptance can arrive after escalation has opened a public deputy
  // job. Close that fallback immediately so the filled role cannot keep taking
  // applications.
  await DeputyJob.updateMany(
    {
      "automation.bookingRef": winner.bookingRef,
      "automation.roleSlotId": winner.roleSlotId,
      status: "open",
    },
    {
      $set: {
        status: "cancelled",
        workflowStage: "closed",
      },
    },
  );
};

const musicianMatchesAssignment = ownsBookingAssignment;

export const withdrawAllocatedBooking = async ({ board, assignment, user, reason = "", source = "portal", availabilityReply = 'unavailable' }) => {
  const now = new Date();
  const unavailable = withdrawalAvailabilityRecord({ board, assignment,
    phone: normalizePhone(assignment.phone || ''), reason, source, now });
  unavailable.reply = availabilityReply === 'no' ? 'no' : 'unavailable';
  unavailable.replyHistory[0].reply = unavailable.reply;
  // Also record manual allocations that have no original offer/availability row.
  // This is date-specific and sends no message to the withdrawing musician.
  await AvailabilityModel.findOneAndUpdate({ requestKey: unavailable.requestKey }, {
    $set: unavailable, $setOnInsert: { createdAt: now },
  }, { upsert: true, new: true, runValidators: true });
  const allocationPools = [
    ...(board.assignedMusicians || []),
    ...(board.bookingMusicians || []),
    ...(board.bandLineup || []),
    ...(board.bookingDetails?.assignedMusicians || []),
  ];
  const needsVocalistApproval = isOnlyActiveVocalist({
    assignment,
    assignments: allocationPools,
  });
  const roleSlotId = String(assignment?.roleSlotId || "");
  const offerRequestId = String(assignment?.offerRequestId || "");
  const deputyJobId = assignment?.deputyJobId || null;
  const apply = (entries = []) =>
    entries.map((entry) =>
      isWithdrawalTarget(entry, assignment, user)
        ? {
            ...(entry.toObject?.() || entry),
            status: "withdrawn",
            withdrawnAt: now,
            withdrawalReason: String(reason || "").trim(),
            withdrawalSource: source,
            respondedAt: now,
          }
        : entry,
    );

  board.assignedMusicians = apply(board.assignedMusicians || []);
  board.bookingMusicians = apply(board.bookingMusicians || []);
  board.bandLineup = apply(board.bandLineup || []);
  if (board.bookingDetails) {
    board.bookingDetails.assignedMusicians = apply(
      board.bookingDetails.assignedMusicians || [],
    );
  }
  const role = String(assignment?.role || assignment?.instrument || "Musician");
  const gaps = Array.isArray(board.allocation?.gaps)
    ? board.allocation.gaps.filter((gap) => String(gap?.instrument || "").toLowerCase() !== role.toLowerCase())
    : [];
  gaps.push({ instrument: role, needed: 1 });
  board.allocation = {
    ...(board.allocation?.toObject?.() || board.allocation || {}),
    status: "gap",
    lastCheckedAt: now,
    notes: `${role} withdrew on ${now.toLocaleDateString("en-GB")}. Reallocation required.`,
    gaps,
    ...(needsVocalistApproval
      ? {
          managerApprovalRequired: true,
          managerApprovalReason:
            "The gig's only vocalist is unavailable. Client approval is required before offering the role to a replacement vocalist.",
          managerApprovalRequestedAt: now,
        }
      : {}),
  };
  await board.save();

  // A withdrawal must be visible on both representations of an imported gig.
  const sourceBooking = await resolveSourceBooking(board);
  await syncConfirmedBookingAssignments({board, booking: sourceBooking, BookingModel: Booking});
  await AvailabilityModel.updateMany({bookingId:String(board.bookingRef || board._id),musicianId:assignment.musicianId},
    {$set:{calendarCancellationConfirmationPending:false}});
  if(mongoose.connection.readyState===1) await mongoose.connection.db.collection('calendardeclineconfirmations').updateMany(
    {boardId:board._id,musicianId:assignment.musicianId,state:'pending'},{$set:{state:'handled',reason:'Explicit booking withdrawal received',handledAt:now}});

  if (needsVocalistApproval) {
    const adminEmail = String(
      process.env.ALLOCATION_FAILURE_EMAIL ||
        process.env.ADMIN_EMAIL ||
        "rhona@thesupremecollective.co.uk",
    ).trim();
    const adminOrigin = String(
      process.env.ADMIN_FRONTEND_URL || "https://admin.thesupremecollective.co.uk",
    ).replace(/\/+$/, "");
    try {
      await sendEmail({
        to: adminEmail,
        subject: `Client approval needed: vocalist unavailable — ${board.bookingRef || board.bookerName || "booking"}`,
        text: [
          `${assignment?.name || "The allocated vocalist"} has confirmed that they are unavailable.`,
          `Booking: ${board.bookingRef || "Not recorded"}`,
          `Act: ${board.actName || board.actTscName || "Not recorded"}`,
          `Event date: ${board.eventDateISO || "Not recorded"}`,
          `Role: ${role}`,
          "No replacement vocalist has been contacted. Please inform the client and obtain approval before reallocating this role.",
          `${adminOrigin}/booking-board`,
        ].join("\n"),
      });
      board.allocation.managerApprovalNotifiedAt = new Date();
      await board.save();
    } catch (notificationError) {
      console.warn("Could not email the vocalist client-approval alert", {
        bookingRef: board.bookingRef,
        message: notificationError?.message,
      });
    }
    return { route: "manager_approval_required" };
  }

  if (activeAllocationHold(board, roleSlotId)) return {route:"allocation_held"};
  if(vocalistAllocationBlocked(board,role))return {route:"vocalist_confirmation_required"};

  if (withinAllocationWeek(board.eventDateISO) && deputyJobId && mongoose.isValidObjectId(deputyJobId)) {
    const job = await DeputyJob.findById(deputyJobId);
    if (job) {
      job.status = "open";
      job.workflowStage = "applications_open";
      job.allocatedMusicianId = null;
      job.allocatedMusicianSlug = "";
      job.allocatedMusicianName = "";
      job.allocatedAt = null;
      job.bookedMusicianId = null;
      job.bookedMusicianSlug = "";
      job.bookedMusicianName = "";
      job.bookingConfirmedAt = null;
      job.applications = (job.applications || []).map((application) =>
        musicianMatchesAssignment(application, user)
          ? { ...(application.toObject?.() || application), status: "withdrawn", withdrawnAt: now }
          : application,
      );
      await job.save();
      return { route: "job_board_reopened", job };
    }
  }

  const msg = offerRequestId
    ? await EnquiryMessage.findOne({ enquiryId: offerRequestId })
    : await EnquiryMessage.findOne({
        bookingBoardItemId: board._id,
        roleSlotId,
        musicianId: assignment?.musicianId || undefined,
      }).sort({ createdAt: -1 });
  if (msg) {
    const scheduleParts = [
      board?.arrivalTime || board?.performanceTimes?.arrivalTime
        ? `Arrival: ${formatBookingClock(board?.arrivalTime || board?.performanceTimes?.arrivalTime)}`
        : "",
      board?.startTime || board?.performanceTimes?.startTime
        ? `Start: ${formatBookingClock(board?.startTime || board?.performanceTimes?.startTime)}`
        : "",
      board?.finishTime || board?.performanceTimes?.finishTime
        ? `Finish: ${formatBookingClock(board?.finishTime || board?.performanceTimes?.finishTime)}`
        : "",
    ].filter(Boolean);
    const existingDuties = String(msg.duties || role).trim();
    if (scheduleParts.length && !/\b(?:Arrival|Start|Finish):/i.test(existingDuties)) {
      msg.duties = [existingDuties, ...scheduleParts].join(" · ");
    }
    const availabilityMatches = [
      msg.phone && msg.actId && msg.meta?.MetaISODate
        ? {
            phone: msg.phone,
            actId: msg.actId,
            dateISO: msg.meta.MetaISODate,
          }
        : null,
      assignment?.musicianId && board.bookingRef
        ? {
            musicianId: assignment.musicianId,
            bookingId: board.bookingRef,
          }
        : null,
    ].filter(Boolean);
    if (availabilityMatches.length) {
      await AvailabilityModel.updateMany(
        { $or: availabilityMatches },
        {
          $set: {
            reply: "no",
            status: "unavailable",
            repliedAt: now,
            updatedAt: now,
          },
        },
      );
    }
    await EnquiryMessage.updateOne(
      { _id: msg._id },
      {
        $set: {
          reply: "withdrawn",
          repliedAt: now,
          status: "read",
          duties: msg.duties,
        },
      },
    );
    await escalateToNextDeputy(msg);
    return { route: "act_deputy_chain" };
  }

  const fallbackMessage = {
    bookingBoardItemId: board._id,
    bookingRef: board.bookingRef,
    roleSlotId: roleSlotId || buildRoleSlotId(role, 0),
    actId: board.actId || board.actsSummary?.[0]?.actId,
    lineupId: board.lineupId || board.actsSummary?.[0]?.lineupId,
    musicianId: assignment.musicianId, phone: assignment.phone,
    originalBandMemberId: assignment.originalBandMemberId,
    formattedDate: formatWithOrdinal(board.eventDateISO),
    duties: [role,...(assignment.duties || [])].filter(Boolean).join(' · '),
    fee: assignment?.totalFee || assignment?.fee || 0,
    formattedAddress: board.address || board.venue || "",
    meta: { role, actName: board.actTscName || board.actName, MetaISODate: board.eventDateISO, county: board.county || '',
      callTime: board.arrivalTime || board.performanceTimes?.arrivalTime || '',
      startTime: board.startTime || board.performanceTimes?.startTime || '',
      finishTime: board.finishTime || board.performanceTimes?.finishTime || '' },
  };
  const { act, lineup } = await getActLineupContext(board);
  fallbackMessage.actId = act?._id;
  fallbackMessage.lineupId = lineup?._id || fallbackMessage.lineupId;
  const sent = await escalateToNextDeputy(fallbackMessage);
  if (sent) return {route:"act_deputy_chain"};
  const job = await DeputyJob.findOne({"automation.bookingBoardItemId":board._id,"automation.roleSlotId":fallbackMessage.roleSlotId,status:{$in:["open","allocated","filled"]}});
  return {route:job ? "job_board_created":"allocation_needs_review",job};
};

// Confirmed booking corrections use the same deputy route as the Bookings page.
export async function withdrawBookingForAvailability(updated, reply) {
  if(!updated?.bookingId || !['no','noloc','nolocation','unavailable'].includes(reply)) return false;
  const board=await resolveBoardItem(updated.bookingId);if(!board || board.bookingStatus==='cancelled')return false;
  const user={musicianId:updated.musicianId,email:updated.musicianEmail||updated.calendarInviteEmail};
  const pools=[...(board.assignedMusicians||[]),...(board.bookingMusicians||[]),...(board.bandLineup||[]),...(board.bookingDetails?.assignedMusicians||[])];
  const seen=new Set();
  const owned=pools.filter(a=>{const key=a.roleSlotId||a.role; if(seen.has(key)||!ownsBookingAssignment(a,user))return false;seen.add(key);return !a.withdrawnAt&&['confirmed','accepted'].includes(a.status);});
  if(!owned.length)return pools.some(a=>ownsBookingAssignment(a,user)&&a.withdrawnAt);
  for(const assignment of owned)await withdrawAllocatedBooking({board,assignment,user,availabilityReply:reply==='unavailable'?'unavailable':'no',reason:updated.inbound?.body || 'Availability withdrawn by musician',source:updated.inbound?.source || 'availability_reply'});
  return true;
}

export const withdrawMyBooking = async (req, res) => {
  try {
    const board = await resolveBoardItem(req.params?.id || req.body?.bookingId);
    if (!board) return res.status(404).json({ success: false, message: "Booking not found" });
    const pools = [
      ...(board.assignedMusicians || []),
      ...(board.bookingMusicians || []),
      ...(board.bandLineup || []),
      ...(board.bookingDetails?.assignedMusicians || []),
    ];
    const requestedSlot = String(req.body?.roleSlotId || "");
    const ownsRequestedSlot = entry => musicianMatchesAssignment(entry, req.user) &&
      (!requestedSlot || String(entry.roleSlotId || '') === requestedSlot);
    const assignment = pools.find(
      (entry) => ownsRequestedSlot(entry) &&
        ["accepted", "confirmed"].includes(String(entry?.status || "").toLowerCase()),
    );
    if (!assignment) {
      const previous = pools.find(entry => ownsRequestedSlot(entry) && entry.withdrawnAt);
      if (previous) return res.json({ success: true, alreadyWithdrawn: true,
        message: "You have already withdrawn from this gig. TSC is arranging cover.", reallocationRoute: "already_withdrawn" });
      return res.status(404).json({ success: false, message: "No confirmed allocation was found for your profile." });
    }
    const result = await withdrawAllocatedBooking({
      board,
      assignment,
      user: req.user,
      reason: req.body?.reason,
      source: "musician_portal",
    });
    return res.json({
      success: true,
      message: "Your availability has been withdrawn and the role has been reopened.",
      reallocationRoute: result.route,
    });
  } catch (error) {
    console.error("withdrawMyBooking failed:", error);
    return res.status(500).json({ success: false, message: error.message || "Could not withdraw availability." });
  }
};

export const postExhaustedRoleToDeputyBoard = async (msg, act) => {
  if(msg.bookingBoardItemId){const current=await bookingBoardItem.findById(msg.bookingBoardItemId).lean();if(current&&(activeAllocationHold(current,msg.roleSlotId)||vocalistAllocationBlocked(current,msg.meta?.role||String(msg.duties||" ").split(" · ")[0])))return null;}
  if(!(Number(msg.fee)>0))return null;
  const existing = await DeputyJob.findOne({
    "automation.bookingBoardItemId": msg.bookingBoardItemId || null,
    "automation.roleSlotId": msg.roleSlotId || "",
    status: { $in: ["open", "allocated", "filled"] },
  });
  if (existing) return existing;

  const role = String(msg.meta?.role || String(msg.duties || "Musician").split(" · ")[0]).trim();
  const eventDate = String(msg.meta?.MetaISODate || "").slice(0, 10);
  const fee = Number(msg.fee || 0) || 0;
  const job = await DeputyJob.create({
    title: `${role} needed for ${act?.tscName || act?.name || "band booking"}`,
    instrument: role,
    requiredInstruments: [role],
    eventDate,
    date: eventDate,
    venue: msg.formattedAddress || msg.meta?.MetaAddress || "",
    location: msg.formattedAddress || msg.meta?.MetaAddress || "",
    locationName: msg.formattedAddress || msg.meta?.MetaAddress || "",
    county: msg.meta?.county || "",
    callTime: msg.meta?.callTime || "",
    startTime: msg.meta?.startTime || "",
    finishTime: msg.meta?.finishTime || "",
    jobType: "booked",
    fee,
    deputyNetAmount: fee,
    paymentStatus: "not_required",
    payoutStatus: "not_ready",
    status: "open",
    workflowStage: "applications_open",
    previewMode: false,
    notes: `Automatically posted ${msg.meta?.escalationReason || "after the act deputy list was exhausted"}. Booking ${msg.bookingRef || ""}.`,
    automation: {
      source: "booking_allocation",
      bookingBoardItemId: msg.bookingBoardItemId || null,
      bookingRef: msg.bookingRef || "",
      roleSlotId: msg.roleSlotId || "",
      enquiryMessageId: msg._id,
    },
  });
  await updateBoardRoleSlot(msg, {
    status: "posted_to_job_board",
    respondedAt: new Date(),
    deputyJobId: job._id,
  });
  return job;
};

export const listRoleCandidates = async (req, res) => {
  try {
    const board = await resolveBoardItem(
      req.query?.bookingBoardItemId || req.query?.bookingId || req.query?.bookingRef,
    );
    if (!board) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    const role = String(req.query?.role || req.query?.instrument || "").trim();
    if (!role) {
      return res.status(400).json({ success: false, message: "A role is required" });
    }

    const query = String(req.query?.query || "").trim();
    const roleRegex = new RegExp(escapeRegex(role), "i");
    const textRegex = query ? new RegExp(escapeRegex(query), "i") : null;
    const { act, lineup } = await getActLineupContext(board);
    const rosterPolicy = act ? await getRosterPolicy(act._id) : null;
    const roleMembers = (lineup?.bandMembers || []).filter((member) =>
      roleRegex.test(String(member?.instrument || member?.role || "")),
    );
    const primaryIds = new Set(roleMembers.map((member) => String(member?.musicianId || member?._id || "")));
    const primaryEmails = new Set(
      roleMembers
        .map((member) => String(member?.email || "").trim().toLowerCase())
        .filter(Boolean),
    );
    const primaryPhones = new Set(
      roleMembers
        .flatMap((member) => normalizeFrom(member?.phoneNormalized || member?.phoneNumber || member?.phone || ""))
        .filter(Boolean),
    );
    const primaryLookupFilters = [
      ...(primaryEmails.size ? [{ email: { $in: [...primaryEmails] } }, { "basicInfo.email": { $in: [...primaryEmails] } }] : []),
      ...(primaryPhones.size
        ? [
            { phone: { $in: [...primaryPhones] } },
            { phoneNumber: { $in: [...primaryPhones] } },
            { phoneNormalized: { $in: [...primaryPhones] } },
            { "basicInfo.phone": { $in: [...primaryPhones] } },
          ]
        : []),
    ];
    const filters = [
      { "instrumentation.instrument": roleRegex },
      { other_skills: roleRegex },
      ...primaryLookupFilters,
    ];
    const textFilters = textRegex
      ? [
          { firstName: textRegex },
          { lastName: textRegex },
          { email: textRegex },
          { phone: textRegex },
          { phoneNumber: textRegex },
          { "basicInfo.firstName": textRegex },
          { "basicInfo.lastName": textRegex },
          { "basicInfo.email": textRegex },
          { "basicInfo.phone": textRegex },
          { "instrumentation.instrument": textRegex },
          { other_skills: textRegex },
        ]
      : null;

    const musicians = await Musician.find({
      $or: textFilters || filters,
    })
      .select("firstName lastName email phone phoneNumber basicInfo instrumentation other_skills profilePhoto")
      .limit(80)
      .lean();

    const dateISO = String(board.eventDateISO || "").slice(0, 10);
    const musicianIds = musicians.map((item) => item._id);
    const unavailable = dateISO
      ? await AvailabilityModel.find({
          musicianId: { $in: musicianIds },
          dateISO,
          $or: [
            { confirmedBooking: true },
            { reply: "unavailable" },
            { status: { $in: ["accepted", "unavailable"] } },
          ],
        })
          .select("musicianId reply status actId")
          .lean()
      : [];

    const conflicts = dateISO
      ? await bookingBoardItem
          .find({
            _id: { $ne: board._id },
            eventDateISO: dateISO,
            assignedMusicians: {
              $elemMatch: {
                musicianId: { $in: musicianIds },
                status: { $in: ["accepted", "confirmed"] },
              },
            },
          })
          .select("bookingRef bookerName assignedMusicians")
          .lean()
      : [];

    const unavailableIds = new Set(unavailable.map((item) => String(item.musicianId)));
    const conflictById = new Map();
    conflicts.forEach((item) => {
      item.assignedMusicians?.forEach((member) => {
        if (["accepted", "confirmed"].includes(member?.status)) {
          conflictById.set(String(member.musicianId), item.bookingRef || item.bookerName || "another booking");
        }
      });
    });

    const deputyIds = new Set(
      roleMembers.flatMap((member) =>
        (member?.deputies || []).map((deputy) => String(deputy?.musicianId || deputy?._id || "")),
      ),
    );

    const candidates = musicians
      .map((musician) => {
        const id = String(musician._id);
        const contact = candidateContact(musician);
        const isPrimary =
          primaryIds.has(id) ||
          primaryEmails.has(String(contact.email || "").trim().toLowerCase()) ||
          normalizeFrom(contact.phone || "").some((phone) => primaryPhones.has(phone));
        const matchedPrimaryMember = isPrimary
          ? roleMembers.find((member) => {
              const memberId = String(member?.musicianId || member?._id || "");
              const memberEmail = String(member?.email || "").trim().toLowerCase();
              const memberPhones = normalizeFrom(
                member?.phoneNormalized || member?.phoneNumber || member?.phone || "",
              );
              return memberId === id ||
                (memberEmail && memberEmail === String(contact.email || "").trim().toLowerCase()) ||
                memberPhones.some((phone) => normalizeFrom(contact.phone || "").includes(phone));
            })
          : null;
        const lineupName = [
          matchedPrimaryMember?.firstName,
          matchedPrimaryMember?.lastName,
        ].filter(Boolean).join(" ").trim();
        const bookingConflict = conflictById.get(id) || "";
        const rosterMember = matchedPrimaryMember || roleMembers.find(m=>(m.deputies || []).some(d=>String(d.musicianId || d._id || d.id || "")===id));
        const eligibility = rosterEligibilityForBooking({board,candidate:musician,member:rosterMember,lineup,assignments:board.assignedMusicians || [],policy:rosterPolicy,address:board.address || board.venueAddress,county:board.county,roleSlotId:req.query?.roleSlotId});
        const regionalOrder = rosterMember ? eligibleDeputiesForBooking({board,roleSlotId:req.query?.roleSlotId,member:rosterMember,lineup,policy:rosterPolicy,address:board.address || board.venueAddress,county:board.county,assignments:board.assignedMusicians || []}).findIndex(d=>String(d.musicianId || d._id || d.id || "")===id) : -1;
        const isUnavailable = unavailableIds.has(id) || Boolean(bookingConflict) || !eligibility.eligible;
        const roleMatch = [
          ...(Array.isArray(musician.instrumentation)
            ? musician.instrumentation.map((entry) => entry?.instrument)
            : []),
          ...(Array.isArray(musician.other_skills)
            ? musician.other_skills
            : [musician.other_skills]),
        ].some((value) => roleRegex.test(String(value || "")));
        return {
          _id: musician._id,
          name: lineupName || musicianDisplayName(musician),
          ...contact,
          instrumentation: musician.instrumentation || [],
          profilePhoto: musician.profilePhoto || "",
          source: isPrimary ? "primary" : deputyIds.has(id) ? "act_deputy" : "search",
          roleMatch,
          available: !isUnavailable,
          rosterEligible: eligibility.eligible,
          regionalOrder: regionalOrder < 0 ? 9999 : regionalOrder,
          unavailableReason: !eligibility.eligible ? eligibility.reason : bookingConflict
            ? `Already allocated to ${bookingConflict}`
            : unavailableIds.has(id)
              ? "Unavailable or already accepted another booking on this date"
              : "",
        };
      })
      .sort((a, b) => {
        const sourceRank = { primary: 0, act_deputy: 1, search: 2 };
        return Number(b.available) - Number(a.available) ||
          Number(b.roleMatch) - Number(a.roleMatch) ||
          sourceRank[a.source] - sourceRank[b.source] ||
          a.regionalOrder - b.regionalOrder ||
          a.name.localeCompare(b.name);
      });

    const roleSlotId = String(req.query?.roleSlotId || "").trim();
    const historyQuery = {
      bookingBoardItemId: board._id,
      "meta.kind": "booking",
      ...(roleSlotId ? { roleSlotId } : { "meta.role": role }),
    };
    const offerHistory = await EnquiryMessage.find(historyQuery)
      .sort({ createdAt: 1 })
      // EnquiryMessage's legacy ref uses "Musician", while the live musician
      // schema is registered as "musician". Supplying the imported model keeps
      // the replacement chooser working without relying on the ref casing.
      .populate({
        path: "musicianId",
        select: "firstName lastName basicInfo.firstName basicInfo.lastName",
        model: Musician,
      })
      .lean();

    return res.json({
      success: true,
      role,
      dateISO,
      candidates,
      offerHistory: offerHistory.map((item) => ({
        requestId: item.enquiryId,
        musicianId: item.musicianId?._id || item.musicianId,
        name: musicianDisplayName(item.musicianId || {}),
        status: item.reply || item.deliveryStatus || item.status || "sent",
        reply: item.reply || "",
        sentAt: item.createdAt,
        repliedAt: item.repliedAt || null,
        firstReminderAt: item.chaseSentAt || null,
        secondReminderAt: item.secondChaseSentAt || null,
        passedOnAt: item.autoEscalatedAt || null,
      })),
    });
  } catch (error) {
    console.error("listRoleCandidates error", error);
    return res.status(500).json({ success: false, message: error?.message || "Failed to load candidates" });
  }
};

export const offerBookingRole = async (req, res) => {
  try {
    const board = await resolveBoardItem(
      req.body?.bookingBoardItemId || req.body?.bookingId || req.body?.bookingRef,
    );
    if (!board) return res.status(404).json({ success: false, message: "Booking not found" });

    const role = String(req.body?.role || req.body?.instrument || "").trim();
    const musicianId = String(req.body?.musicianId || "").trim();
    const suppliedContact = req.body?.contact || {};
    if (!role) {
      return res.status(400).json({ success: false, message: "Role is required" });
    }

    const roleSlotId = String(
      req.body?.roleSlotId || buildRoleSlotId(role, Number(req.body?.slotIndex || 0)),
    );
    if (activeAllocationHold(board, roleSlotId)) return res.status(409).json({success:false,message:"This role is on hold. Release its allocation hold first."});
    if(vocalistAllocationBlocked(board,role))return res.status(409).json({success:false,code:"VOCALIST_CONFIRMATION_REQUIRED",message:"Confirm at least one booked lead vocalist and resolve client approval before inviting instrumentalists."});
    const fee = Number(req.body?.fee || 0) || 0;
    if (!hasPositiveAllocationFee(fee)) {
      return allocationFeeRequiredResponse(res);
    }

    let musician = mongoose.isValidObjectId(musicianId)
      ? await Musician.findById(musicianId).lean()
      : null;
    if (!musician && suppliedContact?.name) {
      const name = String(suppliedContact.name || "").trim();
      const email = String(suppliedContact.email || "").trim().toLowerCase();
      const phone = normalizePhone(suppliedContact.phone || "");
      if (!name || !email || !phone) {
        return res.status(400).json({
          success: false,
          message: "Name, email address and mobile number are required",
        });
      }
      const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      musician = await Musician.findOne({
        $or: [
          { email: { $regex: `^${escapedEmail}$`, $options: "i" } },
          { "basicInfo.email": { $regex: `^${escapedEmail}$`, $options: "i" } },
          { phoneNormalized: phone },
          { phone },
          { "basicInfo.phone": phone },
        ],
      }).lean();
      const parts = name.split(/\s+/).filter(Boolean);
      const firstName = parts.shift() || name;
      const lastName = parts.join(" ");
      if (musician) {
        musician = await Musician.findByIdAndUpdate(
          musician._id,
          {
            $set: {
              firstName: musician.firstName || firstName,
              lastName: musician.lastName || lastName,
              email: musician.email || email,
              phone,
              phoneNormalized: phone,
              "basicInfo.firstName": musician.basicInfo?.firstName || firstName,
              "basicInfo.lastName": musician.basicInfo?.lastName || lastName,
              "basicInfo.email": musician.basicInfo?.email || email,
              "basicInfo.phone": phone,
            },
          },
          { new: true },
        ).lean();
      } else {
        const created = await Musician.create({
          firstName,
          lastName,
          email,
          phone,
          phoneNormalized: phone,
          basicInfo: { firstName, lastName, email, phone },
          instrumentation: [{ instrument: role }],
          onboardingStatus: "not_started",
          hasSetPassword: false,
        });
        musician = created.toObject();
      }
    }
    if (!musician) {
      return res.status(404).json({ success: false, message: "Musician not found" });
    }
    const contact = candidateContact(musician);
    if (!contact.phone) {
      return res.status(400).json({ success: false, message: "This musician has no mobile number for an availability request" });
    }

    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const dateISO = String(board.eventDateISO || req.body?.dateISO || "").slice(0, 10);
    const formattedDate = formatWithOrdinal(dateISO);
    const currency = String(req.body?.currency || "GBP").trim().toUpperCase();
    const earlyArrivalMinutes = Math.max(
      0,
      Number(req.body?.earlyArrivalMinutes || 0) || 0,
    );
    const earlyArrivalTime = String(req.body?.earlyArrivalTime || "").trim();
    const arrivalTime = String(
      req.body?.arrivalTime ||
        board?.performanceTimes?.arrivalTime ||
        board?.arrivalTime ||
        board?.eventSheet?.answers?.schedule_simple_arrival ||
        "",
    ).trim();
    const startTime = String(
      req.body?.startTime ||
        board?.performanceTimes?.startTime ||
        board?.startTime ||
        board?.eventSheet?.answers?.schedule_simple_start ||
        "",
    ).trim();
    const finishTime = String(
      req.body?.finishTime ||
        board?.performanceTimes?.finishTime ||
        board?.finishTime ||
        board?.eventSheet?.answers?.schedule_simple_finish_time ||
        "",
    ).trim();
    const dutiesAlreadyAllocated = new Set(
      (Array.isArray(board.assignedMusicians) ? board.assignedMusicians : [])
        .filter(
          (entry) =>
            String(entry?.roleSlotId || "") !== roleSlotId &&
            ["accepted", "confirmed"].includes(
              String(entry?.status || "").trim().toLowerCase(),
            ),
        )
        .flatMap((entry) => (Array.isArray(entry?.duties) ? entry.duties : []))
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean),
    );
    const duties = Array.from(new Set(
      (Array.isArray(req.body?.duties) ? req.body.duties : [])
        .map((value) => String(value || "").trim())
        .filter(
          (value) =>
            value && !dutiesAlreadyAllocated.has(value.toLowerCase()),
        ),
    ));
    const roleWithSchedule = [
      role,
      ...duties,
      arrivalTime
        ? `Arrival: ${formatBookingClock(arrivalTime)}`
        : earlyArrivalMinutes
          ? `${earlyArrivalMinutes}-minute early arrival`
          : earlyArrivalTime
            ? `Early arrival: ${formatBookingClock(earlyArrivalTime)}`
            : "",
      startTime ? `Start: ${formatBookingClock(startTime)}` : "",
      finishTime ? `Finish: ${formatBookingClock(finishTime)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const { act, lineup } = await getActLineupContext(board);
    if (!act) return res.status(400).json({ success: false, message: "This booking is not linked to an act" });
    const originalBandMember = findOriginalBandMemberForSlot({
      lineup,
      role,
      roleSlotId,
      requestedId: req.body?.originalBandMemberId,
    });
    const originalBandMemberId = originalBandMember?._id || null;

    let address = String(board.address || req.body?.address || "").trim();
    if (!address) {
      const linkedBooking = await resolveSourceBooking(
        board,
        "venue venueAddress address eventAddress location",
      );
      address = String(
        linkedBooking?.venueAddress ||
          linkedBooking?.venue ||
          linkedBooking?.address ||
          linkedBooking?.eventAddress ||
          linkedBooking?.location ||
          "TBC",
      ).trim();
    }
    const rosterCheck = await bookingRosterEligibility({act,lineup,board,candidate:musician,member:originalBandMember,roleSlotId,address});
    if(!rosterCheck.eligible) return res.status(409).json({success:false,code:"ROSTER_INELIGIBLE",message:rosterCheck.reason});
    const name = musicianDisplayName(musician);
    const smsBody = buildBookingSMS({
      firstName: firstNameOf(musician),
      formattedDate,
      formattedAddress: address,
      fee,
      currency,
      duties: roleWithSchedule,
      actName: act.tscName || act.name || board.actName || "the band",
      requestId,
    });

    const dryRun = req.body?.dryRun === true;
    let messageSid = `dryrun_${requestId}`;
    if (!dryRun) {
      const sent = await sendWhatsAppMessage({
        to: `whatsapp:${contact.phone}`,
        contentSid: process.env.TWILIO_INSTRUMENTALIST_BOOKING_REQUEST_SID,
        allowDefaultContentSid: false,
        requestId,
        variables: {
          "1": firstNameOf(musician), "2": formattedDate, "3": address,
          "4": sanitizeFee(fee), "5": roleWithSchedule,
          "6": act.tscName || act.name || board.actName || "the band", "7": requestId,
        },
        smsBody,
        allowSmsFallback: false,
        source: "booking-allocation-request",
        requireOpportunityDetails: true,
        opportunityDetails: {
          actName: act.tscName || act.name || board.actName,
          date: formattedDate,
          address,
          duties: roleWithSchedule,
          fee,
        },
      });
      messageSid = sent?.sid || "";
    }

    if (!dryRun) {
      await EnquiryMessage.create({
        actId: act._id,
        lineupId: lineup?._id || lineup?.lineupId || null,
        musicianId: musician._id,
        enquiryId: requestId,
        bookingRef: board.bookingRef || "",
        bookingBoardItemId: board._id,
        roleSlotId,
        originalBandMemberId,
        candidateSource: req.body?.candidateSource || "search",
        phone: contact.phone,
        duties: roleWithSchedule,
        fee: fee ? String(fee) : "",
        formattedDate,
        formattedAddress: address,
        messageSid,
        deliveryStatus: "sent",
        status: "sent",
        meta: {
          actName: act.tscName || act.name || board.actName || "",
          MetaActId: String(act._id), MetaISODate: dateISO, MetaAddress: address,
          kind: "booking", bookingRef: board.bookingRef || "", currency, role,
        },
        calendar: { attendeeEmail: contact.email, calendarStatus: "needsAction" },
      });

      await AvailabilityModel.findOneAndUpdate(
        { actId: act._id, lineupId: lineup?._id || lineup?.lineupId || null, dateISO, phone: contact.phone },
        {
          $setOnInsert: { musicianId: musician._id, duties: roleWithSchedule, fee: fee ? String(fee) : "", formattedDate, formattedAddress: address },
          $set: { status: "sent", reply: null, bookingId: board.bookingRef || String(board._id), updatedAt: new Date() },
        },
        { upsert: true, new: true },
      );

      const candidate = {
        musicianId: musician._id, name, firstName: musician.firstName || musician.basicInfo?.firstName || "",
        lastName: musician.lastName || musician.basicInfo?.lastName || "", email: contact.email,
        phone: contact.phone, role, instrument: role, status: "offered", fee, totalFee: fee, currency,
        dietaryRequirements: String(musician?.dietaryRequirements || "").trim(),
        duties,
        earlyArrivalMinutes, earlyArrivalTime,
        paymentStatus: "not_due", source: "booking_role_offer", roleSlotId,
        originalBandMemberId,
        candidateSource: req.body?.candidateSource || "search", offerRequestId: requestId, offeredAt: new Date(),
      };
      const current = Array.isArray(board.assignedMusicians) ? board.assignedMusicians : [];
      const index = current.findIndex((entry) => entry.roleSlotId === roleSlotId);
      if (index >= 0) current[index] = candidate;
      else current.push(candidate);
      board.assignedMusicians = current;
      board.bookingMusicians = current;
      board.bandLineup = current;
      board.bookingDetails = {
        ...(board.bookingDetails?.toObject?.() || board.bookingDetails || {}),
        assignedMusicians: current,
      };
      board.allocation = { ...(board.allocation?.toObject?.() || board.allocation || {}), status: "in_progress", lastCheckedAt: new Date() };
      await board.save();
    }

    return res.json({ success: true, dryRun, requestId, roleSlotId, musician: { _id: musician._id, name, ...contact } });
  } catch (error) {
    console.error("offerBookingRole error", error);
    return res.status(500).json({ success: false, message: error?.message || "Failed to send availability request" });
  }
};

export const confirmBookingRole = async (req, res) => {
  try {
    const board = await resolveBoardItem(
      req.body?.bookingBoardItemId || req.body?.bookingId || req.body?.bookingRef,
    );
    if (!board) return res.status(404).json({ success: false, message: "Booking not found" });

    const musicianId = String(req.body?.musicianId || "").trim();
    const role = String(req.body?.role || req.body?.instrument || "").trim();
    if (!role || !mongoose.isValidObjectId(musicianId)) {
      return res.status(400).json({ success: false, message: "Role and musician are required" });
    }
    const musician = await Musician.findById(musicianId).lean();
    if (!musician) return res.status(404).json({ success: false, message: "Musician not found" });

    const roleSlotId = String(req.body?.roleSlotId || buildRoleSlotId(role));
    if (activeAllocationHold(board, roleSlotId)) return res.status(409).json({success:false,message:"This role is on hold. Release its allocation hold first."});
    const { act, lineup } = await getActLineupContext(board);
    const originalBandMember = findOriginalBandMemberForSlot({
      lineup,
      role,
      roleSlotId,
      requestedId: req.body?.originalBandMemberId,
    });
    const rosterCheck = act ? await bookingRosterEligibility({act,lineup,board,candidate:musician,member:originalBandMember,roleSlotId}) : {eligible:true};
    if(!rosterCheck.eligible) return res.status(409).json({success:false,code:'ROSTER_INELIGIBLE',message:rosterCheck.reason});
    const duties = Array.from(new Set(
      (Array.isArray(req.body?.duties) ? req.body.duties : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ));
    if (activeAllocationHold(board, roleSlotId)) return res.status(409).json({success:false,message:"This role is on hold. Release its allocation hold first."});
    const fee = Number(req.body?.fee || 0) || 0;
    if (!hasPositiveAllocationFee(fee)) {
      return allocationFeeRequiredResponse(res);
    }
    const contact = candidateContact(musician);
    const current = Array.isArray(board.assignedMusicians) ? board.assignedMusicians : [];
    const index = current.findIndex((entry) => entry.roleSlotId === roleSlotId);
    const existing = index >= 0 ? current[index]?.toObject?.() || current[index] : {};
    const candidate = {
      ...existing,
      musicianId: musician._id,
      name: musicianDisplayName(musician),
      firstName: musician.firstName || musician.basicInfo?.firstName || "",
      lastName: musician.lastName || musician.basicInfo?.lastName || "",
      email: contact.email,
      phone: contact.phone,
      role,
      instrument: role,
      duties,
      status: "confirmed",
      fee,
      totalFee: fee,
      currency: String(req.body?.currency || "GBP").toUpperCase(),
      paymentStatus: "not_due",
      source: "manual_admin_confirmation",
      candidateSource: "manual",
      roleSlotId,
      originalBandMemberId:
        originalBandMember?._id || existing?.originalBandMemberId || null,
      acceptedAt: new Date(),
      respondedAt: new Date(),
    };
    if (index >= 0) current[index] = candidate;
    else current.push(candidate);
    board.assignedMusicians = current;
    board.bookingMusicians = current;
    board.bandLineup = current;
    board.bookingDetails = {
      ...(board.bookingDetails?.toObject?.() || board.bookingDetails || {}),
      assignedMusicians: current,
    };
    board.allocation = {
      ...(board.allocation?.toObject?.() || board.allocation || {}),
      status: "in_progress",
      lastCheckedAt: new Date(),
      ...(isVocalRole(role)
        ? {
            managerApprovalRequired: false,
            managerApprovalReason: "",
            managerApprovalRequestedAt: null,
          }
        : {}),
    };
    await board.save();
    const sourceBooking = await resolveSourceBooking(board);
    await syncConfirmedBookingAssignments({board, booking: sourceBooking, BookingModel: Booking});
    await closeCompetingRoleOffers({
      bookingRef: board.bookingRef,
      roleSlotId,
      musicianId: musician._id,
    });
    const confirmation = await completeAcceptedAssignment({
      board,
      assignment: candidate,
      musician,
      manualConfirmation: true,
    });

    // Manual confirmation is also used to reinstate someone who previously
    // declined or withdrew. Keep their offer/availability history aligned with
    // the confirmed board slot so the UI does not continue to show them as
    // declined after an admin reallocates the role.
    const selectedOffer = await EnquiryMessage.findOne({
      bookingBoardItemId: board._id,
      roleSlotId,
      musicianId: musician._id,
      "meta.kind": "booking",
    }).sort({ createdAt: -1 });
    if (selectedOffer) {
      await EnquiryMessage.updateOne(
        { _id: selectedOffer._id },
        {
          $set: {
            reply: "yes",
            status: "read",
            repliedAt: candidate.respondedAt,
            reconciledFromAllocationAt: new Date(),
            "calendar.attendeeEmail": confirmation.email || contact.email || "",
            "calendar.eventId": confirmation.eventId || "",
            "calendar.calendarStatus": "accepted",
            "calendar.confirmedBooking": true,
          },
        },
      );
    }

    const availabilityWrite = confirmedBookingAvailabilityWrite({
      board, candidate, contact, eventId: confirmation.eventId, email: confirmation.email,
    });
    await AvailabilityModel.findOneAndUpdate(
      availabilityWrite.filter,
      availabilityWrite.update,
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    if (confirmation.eventId && confirmation.email) {
      candidate.calendarInviteSentAt = new Date();
      const applyInviteTimestamp = (entries = []) => entries.map((entry) =>
        entry?.roleSlotId === roleSlotId
          ? { ...(entry.toObject?.() || entry), calendarInviteSentAt: candidate.calendarInviteSentAt }
          : entry,
      );
      board.assignedMusicians = applyInviteTimestamp(board.assignedMusicians);
      board.bookingMusicians = applyInviteTimestamp(board.bookingMusicians);
      board.bandLineup = applyInviteTimestamp(board.bandLineup);
      board.bookingDetails = {
        ...(board.bookingDetails?.toObject?.() || board.bookingDetails || {}),
        assignedMusicians: applyInviteTimestamp(board.bookingDetails?.assignedMusicians),
      };
      await board.save();
    }
    return res.json({ success: true, roleSlotId, musician: candidate });
  } catch (error) {
    console.error("confirmBookingRole error", error);
    return res.status(500).json({ success: false, message: error?.message || "Failed to confirm musician" });
  }
};

/* -------------------------------------------------------------------------- */
/*                        triggerBookingRequests (main)                       */
/* -------------------------------------------------------------------------- */
export const triggerBookingRequests = async (req, res) => {
  console.log(
    `🦚 (controllers/allocationController.js) triggerBookingRequests called at`,
    new Date().toISOString(),
    {
      bodyKeys: Object.keys(req.body || {}),
    }
  );

  try {
    const {
      actId,
      lineupId,
      dateISO,
      address,
      perMemberFee,
      bookingId,
      bookingRef,
      dryRun = false,
    } = req.body;

    console.log("🧪 triggerBookingRequests mode", {
      dryRun,
      actId,
      lineupId,
      dateISO,
      bookingId,
      bookingRef,
    });

    if (!actId || !dateISO || !address) {
      return res
        .status(400)
        .json({ success: false, message: "Missing actId/dateISO/address" });
    }

    const act = await Act.findById(actId).lean();
    if (!act) {
      return res
        .status(404)
        .json({ success: false, message: "Act not found" });
    }

    // Keep badge logic untouched for now
    console.log(
      "🟡 Skipping badge clear in triggerBookingRequests; badge structure is date-keyed or embedded"
    );

    // Resolve lineup
    const allLineups = Array.isArray(act.lineups) ? act.lineups : [];
    const lineup = lineupId
      ? allLineups.find(
          (l) =>
            String(l._id) === String(lineupId) ||
            String(l.lineupId) === String(lineupId)
        )
      : allLineups[0];

    if (!lineup) {
      return res.json({ success: false, message: "No lineup found for act" });
    }

    let members = Array.isArray(lineup.bandMembers) ? lineup.bandMembers : [];
    const allocationBoard = bookingId||bookingRef ? await resolveBoardItem(bookingId||bookingRef) : await bookingBoardItem.findOne({actId:act._id,eventDateISO:dateISO,bookingStatus:{$ne:'cancelled'}}).lean();
    members=members.filter(m=>!vocalistAllocationBlocked(allocationBoard||{lineupComposition:members.map(p=>p.instrument)},m.instrument,lineup));
    if (!members.length) {
      return res.json({
        success: false,
        message: "No bandMembers in lineup",
      });
    }

    const performers = members.filter((member) => {
      const role = String(member?.instrument || "").trim().toLowerCase();
      return role && role !== "manager" && role !== "admin";
    });
    const zeroFeeMembers = performers.filter(
      (member) => !hasPositiveAllocationFee(buildMemberFee({ perMemberFee, member })),
    );
    if (zeroFeeMembers.length) {
      return res.status(400).json({
        success: false,
        code: "ALLOCATION_FEE_REQUIRED",
        message:
          "No allocation requests were sent. Enter a fee above £0 for every performer first.",
        roles: zeroFeeMembers.map((member) => member?.instrument || "Performer"),
      });
    }

    const ts = Date.now();
    const sent = [];

    const booking = allocationBoard ? await resolveSourceBooking(allocationBoard) :
      bookingId || bookingRef
        ? await Booking.findOne({
            $or: [
              { bookingId: bookingId || bookingRef },
              { bookingRef: bookingId || bookingRef },
            ],
          }).lean()
        : await Booking.findOne({
            act: actId,
            status: "confirmed",
            $or: [
              {
                date: {
                  $gte: new Date(`${dateISO}T00:00:00.000Z`),
                  $lte: new Date(`${dateISO}T23:59:59.999Z`),
                },
              },
              {
                eventDate: {
                  $gte: new Date(`${dateISO}T00:00:00.000Z`),
                  $lte: new Date(`${dateISO}T23:59:59.999Z`),
                },
              },
            ],
          })
            .sort({ updatedAt: -1, createdAt: -1 })
            .lean();

    const resolvedBookingRef =
      booking?.bookingId ||
      booking?.bookingRef ||
      bookingId ||
      bookingRef ||
      null;

    // Every booking offer shares the booking's own diary event. Do not create
    // a second generic event keyed only by act and date.
    const event = dryRun ? {id:`dryrun_${actId}_${dateISO}`} :
      (await ensureBookingEvent({booking,bookingRef:resolvedBookingRef,
        assignedMusicians:allocationBoard?.assignedMusicians || []})).event;

    const rosterPolicy = await getRosterPolicy(act._id);
    for (const originalMember of members) {
      const m=selectRosterMember({member:originalMember,lineup,policy:rosterPolicy,address});
      if(!m) continue;
      const roleLower = String(m?.instrument || "")
        .trim()
        .toLowerCase();

      if (!roleLower || roleLower === "manager" || roleLower === "admin") {
        continue;
      }

      const realMusician = await findRealMusicianForMember(m);

      // ACT member is source of truth for contact details
      const memberPhone = normalizePhone(m?.phoneNumber || m?.phone || "");
      const musicianPhone = normalizePhone(
        realMusician?.phone || realMusician?.phoneNumber || ""
      );
      const phone = memberPhone || musicianPhone;

      if (!phone) {
        console.warn("🦚 triggerBookingRequests skip: no phone for member", {
          name: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
          instrument: m.instrument || "",
        });
        continue;
      }

      const attendeeEmail = String(
        m?.email || m?.emailAddress || realMusician?.email || ""
      ).trim();

      const displayFirstName = m?.firstName || realMusician?.firstName || "";
      const displayLastName = m?.lastName || realMusician?.lastName || "";
      const displayName = `${displayFirstName} ${displayLastName}`.trim();

      const resolvedMusicianId = realMusician?._id || m?.musicianId || m?._id || null;

      const memberFee = buildMemberFee({ perMemberFee, member: m });

      const requestId = `${ts}_${Math.random().toString(36).slice(2, 7)}`;

      const formattedDate = new Date(dateISO).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      const smsBody = buildBookingSMS({
        firstName: firstNameOf(realMusician || m),
        formattedDate,
        formattedAddress: address,
        fee: memberFee,
        duties: m.instrument || "performance",
        actName: act.tscName || act.name || "the band",
        requestId,
      });

      if (!dryRun) {
        if (!resolvedMusicianId) {
          console.warn(
            "🦚 triggerBookingRequests skip: no musicianId resolved",
            {
              memberName: displayName,
              instrument: m.instrument || "",
              phone,
              attendeeEmail,
              hasActMusicianId: !!m?.musicianId,
              hasBandMemberSubdocId: !!m?._id,
            }
          );
          continue;
        }

        await EnquiryMessage.create({
          actId,
          lineupId: lineup._id || lineup.lineupId || null,
          musicianId: resolvedMusicianId,
          enquiryId: requestId,
          bookingRef: resolvedBookingRef,
          phone,
          originalBandMemberId: originalMember._id,
          duties: m.instrument || "",
          fee: memberFee ? String(memberFee) : undefined,
          formattedDate,
          formattedAddress: address,
          meta: {
            actName: act.tscName || act.name,
            MetaActId: String(actId),
            MetaISODate: dateISO,
            MetaAddress: address,
            kind: "booking",
            lineupId: String(lineup._id || lineup.lineupId || ""),
            bookingRef: resolvedBookingRef || "",
          },
          calendar: {
            eventId: event.id,
            calendarStatus: "needsAction",
            attendeeEmail,
          },
          deliveryStatus: "queued",
          status: "queued",
        });

        await AvailabilityModel.findOneAndUpdate(
          {
            actId,
            lineupId: lineup._id || lineup.lineupId || null,
            dateISO,
            phone,
          },
          {
            $setOnInsert: {
              actId,
              lineupId: lineup._id || lineup.lineupId || null,
              dateISO,
              phone,
              musicianId: resolvedMusicianId,
              musicianName: displayName,
              musicianEmail: attendeeEmail,
              duties: m.instrument || "performance",
              fee: memberFee ? String(memberFee) : "",
              formattedDate,
              formattedAddress: address,
              reply: null,
              createdAt: new Date(),
            },
            $set: {
              updatedAt: new Date(),
              status: "sent",
              bookingId: resolvedBookingRef,
            },
          },
          { new: true, upsert: true }
        );
      }

      const wa = dryRun
  ? { sid: `dryrun_${requestId}` }
  : await sendWhatsAppMessage({
      to: `whatsapp:${phone}`,
      contentSid: process.env.TWILIO_INSTRUMENTALIST_BOOKING_REQUEST_SID,
      allowDefaultContentSid: false,
      allowDefaultContentSid: false,
      requestId,
      variables: {
        "1": firstNameOf(realMusician || m),
        "2": formattedDate,
        "3": address,
        "4": sanitizeFee(memberFee),
        "5": m.instrument || "performance",
        "6": act.tscName || act.name || "the band",
        "7": requestId,
        firstName: firstNameOf(realMusician || m),
        date: formattedDate,
        location: address,
        fee: sanitizeFee(memberFee),
        role: m.instrument || "performance",
        actName: act.tscName || act.name || "the band",
        requestId,
        requestCode: `#${requestId}`,
      },
      smsBody,
      allowSmsFallback: false,
      source: "booking-lineup-request",
      requireOpportunityDetails: true,
      opportunityDetails: {
        actName: act.tscName || act.name,
        date: formattedDate,
        address,
        duties: m.instrument,
        fee: memberFee,
      },
    });

      if (!dryRun) {
        await EnquiryMessage.updateOne(
          { enquiryId: requestId },
          {
            $set: {
              deliveryStatus: "sent",
              status: "sent",
              messageSid: wa?.sid || null,
            },
          }
        );

        await AvailabilityModel.updateOne(
          {
            actId,
            lineupId: lineup._id || lineup.lineupId || null,
            dateISO,
            phone,
          },
          {
            $set: {
              messageSidOut: wa?.sid || null,
              outboundChannel: "whatsapp",
              outboundSentAt: new Date(),
              outboundMessage: smsBody,
              status: "sent",
            },
          }
        );
      }

      console.log("🦚 triggerBookingRequests sent", {
        name: displayName,
        phone,
        duties: m.instrument || "",
        bookingRef: resolvedBookingRef,
        channel: "whatsapp",
      });

      const line = `Booking invite sent to ${displayName} (${
        m.instrument || ""
      })`;

      if (!dryRun) {
        await appendLineToEventDescription({
          eventId: event.id,
          line,
        });
      }

      sent.push({
        name: displayName,
        phone,
        instrument: m.instrument || "",
        fee: memberFee,
        requestId,
        attendeeEmail,
        dryRun,
      });
    }

    return res.json({
      success: true,
      eventId: event.id,
      sent,
      dryRun,
    });
  } catch (err) {
    console.error("🦚 triggerBookingRequests error", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Server error",
    });
  }
};

/* -------------------------------------------------------------------------- */
/*                              parseBookingPayload                           */
/* -------------------------------------------------------------------------- */
const parseBookingPayload = (payload) => {
  console.log(`🦚 (controllers/allocationController.js) parseBookingPayload called at`, new Date().toISOString(), { payload });
  const m = String(payload || '').trim().match(/^(YESBOOK|NOBOOK)_(.+)$/i);
  if (!m) return { reply: null, bookingId: null };
  const kind = m[1].toUpperCase();
  const bookingId = m[2];
  const reply = kind === "YESBOOK" ? "yes" : "no";
  return { reply, bookingId };
};

/* -------------------------------------------------------------------------- */
/*                            twilioInboundBooking                            */
/* -------------------------------------------------------------------------- */
export const twilioInboundBooking = async (req, res) => {
  console.log(`🦚 twilioInboundBooking v4 called`, {
    ts: new Date().toISOString(),
    body: req.body,
  });

  // ---------------------------------------------------------
  // Helper: interpret YES / NO / NOLOC
  // ---------------------------------------------------------
 function interpretReply(raw) {
  if (!raw) return null;
  const low = String(raw).toLowerCase().trim();

  if (
    low === "yes" ||
    low.includes("book me in") ||
    low.startsWith("yesbook")
  ) {
    return "YES";
  }

  if (
    low === "no" ||
    low.includes("already booked") ||
    low.startsWith("nobook")
  ) {
    return "NO_BOOKED";
  }

  if (
    low === "noloc" ||
    low.includes("no thanks") ||
    low.includes("can't do this location") ||
    low.includes("cant do this location")
  ) {
    return "NO_LOC";
  }

  return null;
}

  try {
    // ---------------------------------------------------------
    // Extract incoming fields from Twilio webhook
    // ---------------------------------------------------------
    const bodyText      = String(req.body?.Body || "");
    const buttonText    = String(req.body?.ButtonText || "");
    const buttonPayload = String(req.body?.ButtonPayload || "");
    const fromRaw       = String(req.body?.From || req.body?.WaId || "");

    console.log("🦚 inbound payload", {
      fromRaw,
      bodyText,
      buttonText,
      buttonPayload,
    });

    // ---------------------------------------------------------
    // 1️⃣ Determine musician reply type
    // ---------------------------------------------------------
    const rawReply = buttonPayload || buttonText || bodyText || "";
    if(/^CAL_(?:YES|NO|LOC):/i.test(rawReply)) {
      const {handleCalendarDeclineReply}=await import('../services/calendarDeclineService.js');
      await handleCalendarDeclineReply({payload:rawReply,from:fromRaw,sid:req.body?.MessageSid});
      return res.status(200).send('<Response/>');
    }
    const calendarCancelYes = /calendar[_ -]?cancel[_ -]?yes|yes,? i['’]?m unavailable(?: now)?/i.test(rawReply);
    const calendarCancelNo = /calendar[_ -]?cancel[_ -]?no|no,? (?:please )?reinstate(?: invite)?/i.test(rawReply);
    if (calendarCancelYes || calendarCancelNo) {
      const variants = normalizeFrom(fromRaw);
      const availability = await AvailabilityModel.findOne({
        phone: { $in: variants },
        calendarCancellationConfirmationPending: true,
      }).sort({ calendarCancellationConfirmationSentAt: -1 });
      if (!availability) return res.status(200).send("<Response/>");

      if (calendarCancelNo) {
        await reinstateCalendarAttendee({
          eventId: availability.calendarEventId,
          email: availability.calendarInviteEmail,
        });
        availability.calendarCancellationConfirmationPending = false;
        availability.calendarStatus = "needsAction";
        availability.calendarDeclinedAt = null;
        availability.status = "accepted";
        availability.reply = "yes";
        await availability.save();
        return res.status(200).send("<Response/>");
      }

      const board = await resolveBoardItem(availability.bookingId);
      if (board) {
        const pools = [
          ...(board.assignedMusicians || []),
          ...(board.bookingMusicians || []),
          ...(board.bandLineup || []),
          ...(board.bookingDetails?.assignedMusicians || []),
        ];
        const user = { musicianId: availability.musicianId, email: availability.calendarInviteEmail };
        const assignment = pools.find((entry) => musicianMatchesAssignment(entry, user));
        if (assignment) {
          await withdrawAllocatedBooking({
            board,
            assignment,
            user,
            reason: "Confirmed after declining the calendar invitation",
            source: "calendar_decline_confirmed",
          });
        }
      }
      availability.calendarCancellationConfirmationPending = false;
      availability.calendarCancellationConfirmedAt = new Date();
      availability.calendarStatus = "declined";
      availability.status = "unavailable";
      availability.reply = "unavailable";
      await availability.save();
      return res.status(200).send("<Response/>");
    }
    const replyType = interpretReply(rawReply);

    console.log("🦚 replyType detected:", replyType);

    if (!replyType) {
      console.warn("⚠️ Could not interpret reply; ignoring");
      await sendInboundAcknowledgement({
        to: fromRaw,
        body: AUTOMATED_REPLY_INSTRUCTION,
        isWhatsApp: /^whatsapp:/i.test(fromRaw) || Boolean(req.body?.WaId),
      });
      return res.status(200).send("<Response/>");
    }

    // ---------------------------------------------------------
    // 2️⃣ Extract bookingId from YESBOOK_xxx or NOBOOK_xxx
    // ---------------------------------------------------------
    let requestId = null;

    const bookingMatch =
      bodyText.match(/YESBOOK_(\S+)/i) ||
      bodyText.match(/NOBOOK_(\S+)/i) ||
      buttonPayload.match(/YESBOOK_(\S+)/i) ||
      buttonPayload.match(/NOBOOK_(\S+)/i);

    if (bookingMatch) {
      requestId = bookingMatch[1];
    }

    // ---------------------------------------------------------
    // 3️⃣ Fetch the pending EnquiryMessage row
    // ---------------------------------------------------------
    const repliedSid = String(req.body?.OriginalRepliedMessageSid || "");
    let msg = requestId
      ? await EnquiryMessage.findOne({ enquiryId: requestId })
      : null;

    if (!msg && repliedSid) {
      msg = await EnquiryMessage.findOne({ messageSid: repliedSid });
    }

    if (!msg) {
      const variants = normalizeFrom(fromRaw);

      msg = await EnquiryMessage.findOne(
        {
          phone: { $in: variants },
          "meta.kind": "booking",
          $or: [{ reply: null }, { reply: { $exists: false } }],
        },
      ).sort({ createdAt: -1 });
    }

    if (!msg) {
      console.warn("🦚 No matching EnquiryMessage found for this reply");
      return res.status(200).send("<Response/>");
    }

    // A late acceptance is valid only while this role has not already been won.
    // Check before changing the message so an old quick reply cannot overwrite
    // a confirmed musician on the booking board.
    if (replyType === "YES") {
      const currentBoard = msg.bookingBoardItemId
        ? await bookingBoardItem.findById(msg.bookingBoardItemId)
        : await resolveBoardItem(msg.bookingRef);
      if(currentBoard && activeAllocationHold(currentBoard,msg.roleSlotId)) {
        await EnquiryMessage.updateOne({_id:msg._id},{$set:{reply:"yes",repliedAt:new Date(),"meta.allocationHoldReply":true}});
        await sendInboundAcknowledgement({to:msg.phone || fromRaw,body:"Thank you for replying. This role is currently on hold while management reviews the booking. We will confirm with you separately.",isWhatsApp:/^whatsapp:/i.test(fromRaw)||Boolean(req.body?.WaId)});
        return res.status(200).send("<Response/>");
      }
      const currentSlot = (currentBoard?.assignedMusicians || []).find(
        (entry) =>
          String(entry?.roleSlotId || "") === String(msg.roleSlotId || "") ||
          String(entry?.offerRequestId || "") === String(msg.enquiryId || ""),
      );
      const isWonByAnother =
        currentSlot &&
        ["accepted", "confirmed"].includes(String(currentSlot.status || "").toLowerCase()) &&
        String(currentSlot.musicianId || "") !== String(msg.musicianId || "");

      const acceptanceContext = currentBoard ? await getActLineupContext(currentBoard) : {};
      const acceptanceMember = acceptanceContext.lineup?.bandMembers?.find(m=>String(m._id)===String(msg.originalBandMemberId));
      const acceptingProfile = msg.musicianId ? await Musician.findById(msg.musicianId).lean() : null;
      const eligibility = acceptanceContext.act && acceptingProfile ? await bookingRosterEligibility({act:acceptanceContext.act,lineup:acceptanceContext.lineup,board:currentBoard,candidate:acceptingProfile,member:acceptanceMember,roleSlotId:msg.roleSlotId,address:msg.formattedAddress}) : {eligible:true};
      if(!eligibility.eligible) {
        await EnquiryMessage.updateOne({_id:msg._id},{$set:{reply:'unavailable',repliedAt:new Date()}});
        await updateBoardRoleSlot(msg,{status:'declined',respondedAt:new Date()});
        await escalateToNextDeputy(msg);
        await sendInboundAcknowledgement({to:msg.phone || fromRaw,body:'This lineup needs a different combination of musicians. Management will review the allocation. Thank you for replying.',isWhatsApp:/^whatsapp:/i.test(fromRaw)||Boolean(req.body?.WaId)});
        return res.status(200).send('<Response/>');
      }
      if (isWonByAnother) {
        await EnquiryMessage.updateOne(
          { _id: msg._id },
          { $set: { reply: "unavailable", repliedAt: new Date(), deliveryStatus: "read", status: "read" } },
        );
        await sendInboundAcknowledgement({
          to: msg.phone || fromRaw,
          body: "Sorry, this role has already been allocated now. Thank you for getting back to us. 🤍 TSC",
          isWhatsApp: /^whatsapp:/i.test(fromRaw) || Boolean(req.body?.WaId),
        });
        return res.status(200).send("<Response/>");
      }
    }

    await EnquiryMessage.updateOne(
      { _id: msg._id },
      {
        $set: {
          reply: replyType === "YES" ? "yes" : replyType === "NO_LOC" ? "no" : "unavailable",
          repliedAt: new Date(),
          deliveryStatus: "read",
          status: "read",
          "calendar.calendarStatus": "needsAction",
        },
      },
    );

    console.log("🦚 matched EnquiryMessage:", msg._id);

    // ---------------------------------------------------------
    // 4️⃣ YES — ACCEPTED
    // ---------------------------------------------------------
  if (replyType === "YES") {
  console.log("🟢 YES — musician accepts the gig");

  // 👍 Ensure shared event exists
const booking = msg?.bookingRef
  ? await Booking.findOne({
      $or: [{ bookingId: msg.bookingRef }, { bookingRef: msg.bookingRef }]
    }).lean()
  : null;
  const eventId =
    msg?.calendar?.eventId ||
    booking?.calendarEventId ||
    (booking ? await updateOrCreateBookingEvent({ booking }) : null);

  // ✔ determine their email
  const phoneVariants = normalizeFrom(fromRaw);
  let email = msg.calendar?.attendeeEmail || null;

  if (!email) {
    const act = await Act.findById(msg.actId).lean();
    const lineup =
      (act.lineups || []).find(x => String(x._id) === String(msg.lineupId))
      || act.lineups[0];

    const members = lineup.bandMembers || [];
    const match = members.find(m =>
      normalizeFrom(m.phoneNumber || m.phone)
        .some(p => phoneVariants.includes(p))
    );

    email = match?.email || null;
  }

  // ✔ Add attendee to the shared event
  if (eventId && email) {
    await addAttendeeToEvent({ eventId, email });

    await EnquiryMessage.updateOne(
      { _id: msg._id },
      {
        $set: {
          "calendar.attendeeEmail": email,
          "calendar.eventId": eventId,
        }
      }
    );
  }

  // Mark musician YES
  await AvailabilityModel.findOneAndUpdate(
    {
      phone: msg.phone,
      actId: msg.actId,
      dateISO: msg.meta?.MetaISODate,
    },
    {
      $set: {
        reply: "yes",
        status: "accepted",
        updatedAt: new Date(),
        calendarEventId: eventId || null,
        calendarInviteEmail: email || "",
        calendarInviteSentAt: eventId && email ? new Date() : null,
        bookingId: msg.bookingRef || null,
      },
      $setOnInsert: {
        lineupId: msg.lineupId || null,
        musicianId: msg.musicianId || null,
        duties: msg.duties || "performance",
        fee: msg.fee || "",
        formattedDate: msg.formattedDate || "",
        formattedAddress: msg.formattedAddress || "",
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  const acceptingMusician = msg.musicianId
    ? await Musician.findById(msg.musicianId).lean()
    : null;
  const acceptingContact = candidateContact(acceptingMusician || {});
  const updatedBoard = await updateBoardRoleSlot(msg, {
    musicianId: msg.musicianId,
    name: musicianDisplayName(acceptingMusician || {}),
    firstName: acceptingMusician?.firstName || acceptingMusician?.basicInfo?.firstName || "",
    lastName: acceptingMusician?.lastName || acceptingMusician?.basicInfo?.lastName || "",
    email: email || acceptingContact.email,
    phone: msg.phone || acceptingContact.phone,
    offerRequestId: msg.enquiryId,
    status: "confirmed",
    respondedAt: new Date(),
    acceptedAt: new Date(),
    calendarInviteSentAt: eventId && email ? new Date() : null,
  });

  await closeCompetingRoleOffers(msg);

  if (updatedBoard) {
    const acceptedAssignment = (updatedBoard.assignedMusicians || []).find(
      (entry) =>
        entry?.roleSlotId === msg.roleSlotId ||
        entry?.offerRequestId === msg.enquiryId ||
        String(entry?.musicianId || "") === String(msg.musicianId || ""),
    );
    const acceptedMusician = acceptingMusician;
    await completeAcceptedAssignment({
      board: updatedBoard,
      assignment: acceptedAssignment || {
        musicianId: msg.musicianId,
        email,
        phone: msg.phone,
        role: msg.duties,
        fee: msg.fee,
      },
      musician: acceptedMusician,
    });

    await promptForProfileAfterAcceptance({
      musicianId: acceptedMusician?._id || msg.musicianId,
      phone: msg.phone || fromRaw,
    });
  }

  await refreshAllocationForActDate(msg.actId, msg.meta?.MetaISODate);

  return res.status(200).send("<Response/>");
}

    // ---------------------------------------------------------
    // 5️⃣ NO_BOOKED — I'm already booked elsewhere
    // ---------------------------------------------------------
    if (replyType === "NO_BOOKED") {
      console.log("🔴 NO_BOOKED — musician is unavailable globally for this date");

      // Mark unavailable for ALL acts on this date
      await AvailabilityModel.updateMany(
        {
          $or: [
            { musicianId: msg.musicianId },
            { phone: msg.phone },
          ],
          dateISO: msg.meta?.MetaISODate,
        },
        {
          $set: {
            reply: "unavailable",
            status: "unavailable",
            updatedAt: new Date(),
            bookingId: msg.bookingRef || null,
          },
        }
      );

      await refreshAllocationForActDate(msg.actId, msg.meta?.MetaISODate);

      await updateBoardRoleSlot(msg, {
        status: "unavailable",
        respondedAt: new Date(),
        declinedAt: new Date(),
      });

      // Escalate to deputy
      await escalateToNextDeputy(msg);

      await sendInboundAcknowledgement({
        to: msg.phone || fromRaw,
        body: "Thanks for letting us know. We’ve received your reply and updated your availability.",
        isWhatsApp: /^whatsapp:/i.test(fromRaw) || Boolean(req.body?.WaId),
      });

      return res.status(200).send("<Response/>");
    }

    // ---------------------------------------------------------
    // 6️⃣ NO_LOC — decline just this one enquiry
    // ---------------------------------------------------------
    if (replyType === "NO_LOC") {
      console.log("🟠 NO_LOC — decline this booking only");

      await EnquiryMessage.updateOne(
        { _id: msg._id },
        { $set: { reply: "no", updatedAt: new Date() } }
      );

      await AvailabilityModel.findOneAndUpdate(
        {
          phone: msg.phone,
          actId: msg.actId,
          dateISO: msg.meta?.MetaISODate,
        },
        {
          $set: {
            reply: "no",
            status: "declined",
            updatedAt: new Date(),
            bookingId: msg.bookingRef || null,
          },
        },
        { upsert: true, new: true }
      );

      await refreshAllocationForActDate(msg.actId, msg.meta?.MetaISODate);

      await updateBoardRoleSlot(msg, {
        status: "declined",
        respondedAt: new Date(),
        declinedAt: new Date(),
      });

      // Escalate to next deputy
      await escalateToNextDeputy(msg);

      await sendInboundAcknowledgement({
        to: msg.phone || fromRaw,
        body: "Thanks for letting us know. We’ve received your reply and updated your availability.",
        isWhatsApp: /^whatsapp:/i.test(fromRaw) || Boolean(req.body?.WaId),
      });

      return res.status(200).send("<Response/>");
    }

    return res.status(200).send("<Response/>");

  } catch (err) {
    console.error("❌ twilioInboundBooking v4 ERROR:", err);
    return res.status(200).send("<Response/>");
  }
};

export async function escalateToNextDeputy(msg, {dryRun=false}={}) {
  try {
    console.log("🟡 escalateToNextDeputy v2 → starting", {
      msgId: msg._id,
      phone: msg.phone,
      actId: msg.actId,
      lineupId: msg.lineupId,
    });

    // ---------------------------------------------------
    // 1. Load act + lineup + members
    // ---------------------------------------------------
    const act = await Act.findById(msg.actId).lean();
    if (!act) {
      console.warn("❗ escalateToNextDeputy: act missing");
      return false;
    }

    const lineup =
      act.lineups?.find(
        (l) =>
          String(l._id) === String(msg.lineupId) ||
          String(l.lineupId) === String(msg.lineupId)
      ) || act.lineups?.[0];

    if (!lineup) {
      console.warn("❗ escalateToNextDeputy: lineup missing");
      await postExhaustedRoleToDeputyBoard(msg, act);
      return false;
    }

    // Act forms also carry a UUID lineupId; message records require the subdocument ObjectId.
    msg={...(msg.toObject?.()||msg),lineupId:lineup._id||msg.lineupId};
    const members = lineup.bandMembers || [];

    const rosterBoard = msg.bookingBoardItemId ? await bookingBoardItem.findById(msg.bookingBoardItemId).lean() : await resolveBoardItem(msg.bookingRef);
    if (!rosterBoard || rosterBoard.bookingStatus === "cancelled" || rosterBoard.cancellation?.cancelledAt) return false;
    if (activeAllocationHold(rosterBoard, msg.roleSlotId)) return false;
    const role=String(msg.meta?.role || String(msg.duties||"").split(" · ")[0]).trim();
    if (rosterBoard.allocation?.managerApprovalRequired && isVocalRole(role)) return false;
    if(vocalistAllocationBlocked(rosterBoard,role,lineup))return false;
    if (withinAllocationWeek(msg.meta?.MetaISODate)) {
      if(dryRun)return {route:"job_board",reason:"within_seven_days"};
      await postExhaustedRoleToDeputyBoard({...msg,meta:{...msg.meta,escalationReason:"because the role is unfilled within seven days of the event"}},act);
      return false;
    }
    const current=members.find(m=>msg.originalBandMemberId && String(m._id)===String(msg.originalBandMemberId))
      || members.find(m=>normaliseAllocationRole(m.instrument||m.role).toLowerCase()===normaliseAllocationRole(role).toLowerCase());
    const rosterPolicy=await getRosterPolicy(act._id);
    const deputies=actRoleDeputies({act,lineup,member:current,role,policy:rosterPolicy,board:rosterBoard,roleSlotId:msg.roleSlotId});
    const history=await EnquiryMessage.find({bookingBoardItemId:rosterBoard._id,roleSlotId:msg.roleSlotId}).lean();
    // A retry must not create a second request while another deputy is pending.
    if(history.some(h=>String(h._id)!==String(msg._id)&&!h.reply&&!h.autoEscalatedAt&&!h.reminderPausedAt&&['queued','pending','sent','delivered','read'].includes(h.deliveryStatus))) return true;
    let nextDep,phone;
    for(const deputy of deputies){
      let candidate=deputy;
      const id=String(deputy.musicianId||'');
      const lookup=id&&mongoose.isValidObjectId(id)?{_id:id}:deputy.email?{email:String(deputy.email).trim().toLowerCase()}:null;
      if(lookup){const profile=await Musician.findOne(lookup).select('firstName lastName email phone phoneNumber basicInfo').lean();if(profile)candidate={...deputy,...candidateContact(profile),musicianId:profile._id,firstName:profile.firstName||deputy.firstName,lastName:profile.lastName||deputy.lastName};}
      const targetPhone=normalizePhone(candidate.phone||candidate.phoneNumber);
      if(!/^\+\d{10,15}$/.test(targetPhone))continue;
      const targetId=String(candidate.musicianId||'');
      if((targetId && targetId===String(msg.musicianId||'')) || (targetPhone && targetPhone===normalizePhone(msg.phone)))continue;
      if(history.some(h=>normalizePhone(h.phone)===targetPhone||(targetId&&String(h.musicianId)===targetId)))continue;
      if((rosterBoard.assignedMusicians||[]).some(a=>a.withdrawnAt&&(String(a.musicianId)===targetId||normalizePhone(a.phone)===targetPhone)))continue;
      if(await findPriorAvailabilityDecline({musicianId:targetId,phone:targetPhone,dateISO:msg.meta.MetaISODate,formattedAddress:msg.formattedAddress}))continue;
      const conflict=await bookingBoardItem.exists({_id:{$ne:rosterBoard._id},eventDateISO:msg.meta.MetaISODate,bookingStatus:{$ne:'cancelled'},assignedMusicians:{$elemMatch:{musicianId:targetId,status:{$in:['confirmed','accepted']}}}});
      if(conflict)continue;
      nextDep=candidate;phone=targetPhone;break;
    }
    if(!nextDep){if(dryRun)return {route:"job_board",reason:"act_deputies_exhausted"};await postExhaustedRoleToDeputyBoard(msg,act);return false;}
    if(dryRun)return {route:"act_deputy",musicianId:nextDep.musicianId,name:[nextDep.firstName,nextDep.lastName].filter(Boolean).join(" "),phone};

    // ---------------------------------------------------
    // 4. Create new EnquiryMessage for this deputy
    // ---------------------------------------------------
    const newBookingId = `${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    const created = await EnquiryMessage.create({
      actId: msg.actId,
      lineupId: msg.lineupId,
      musicianId: nextDep.musicianId || nextDep._id || null,
      enquiryId: newBookingId,
      bookingRef: msg.bookingRef || null,
      bookingBoardItemId: msg.bookingBoardItemId || null,
      roleSlotId: msg.roleSlotId || "",
      originalBandMemberId: msg.originalBandMemberId || current?._id || null,
      candidateSource: "act_deputy",
      phone,
      duties: msg.duties,
      fee: msg.fee,
      formattedDate: msg.formattedDate,
      formattedAddress: msg.formattedAddress,
      meta: {
        actName: msg.meta?.actName,
        role: msg.meta?.role || String(msg.duties || "Musician").split(" · ")[0].trim(),
        MetaActId: msg.meta?.MetaActId,
        MetaISODate: msg.meta?.MetaISODate,
        MetaAddress: msg.meta?.MetaAddress,
        kind: "booking",
        bookingRef: msg.bookingRef || "",
      },
      calendar: {
        eventId: msg.calendar?.eventId,
        calendarStatus: "needsAction",
      },
      deliveryStatus: "queued",
      status: "queued",
    });

    await AvailabilityModel.findOneAndUpdate(
      {
        actId: msg.actId,
        lineupId: msg.lineupId,
        dateISO: msg.meta?.MetaISODate,
        phone,
      },
      {
        $setOnInsert: {
          actId: msg.actId,
          lineupId: msg.lineupId,
          dateISO: msg.meta?.MetaISODate,
          phone,
          musicianId: nextDep.musicianId || nextDep._id || null,
          duties: msg.duties || "performance",
          fee: msg.fee || "",
          formattedDate: msg.formattedDate || "",
          formattedAddress: msg.formattedAddress || "",
          createdAt: new Date(),
        },
        $set: {
          updatedAt: new Date(),
          status: "sent",
          bookingId: msg.bookingRef || null,
        },
      },
      { upsert: true, new: true }
    );

    console.log("🟢 Created new deputy EnquiryMessage", {
      messageId: created._id,
      phone,
    });

    // ---------------------------------------------------
    // 5. Send WhatsApp booking request
    // ---------------------------------------------------
    const smsBody =
      `Hi ${firstNameOf(nextDep)}, ${msg.formattedDate} in ${msg.formattedAddress} ` +
      `with ${msg.meta?.actName || "the band"} for ${msg.duties || "performance"} ` +
      `at £${sanitizeFee(msg.fee)}. Reply YES or NO. 🤍 TSC`;

    const wa = await sendWhatsAppMessage({
      to: `whatsapp:${phone}`,
      contentSid: process.env.TWILIO_INSTRUMENTALIST_BOOKING_REQUEST_SID,
      variables: {
        "1": firstNameOf(nextDep),
        "2": msg.formattedDate,
        "3": msg.formattedAddress,
        "4": sanitizeFee(msg.fee),
        "5": msg.duties || "performance",
        "6": msg.meta?.actName || "the band",
        "7": newBookingId,
      },
      smsBody,
      allowSmsFallback: false,
      source: "booking-deputy-request",
      requireOpportunityDetails: true,
      opportunityDetails: {
        actName: msg.meta?.actName,
        date: msg.formattedDate,
        address: msg.formattedAddress,
        duties: msg.duties,
        fee: msg.fee,
      },
    });

    await EnquiryMessage.updateOne(
      { _id: created._id },
      { $set: { messageSid: wa?.sid || null, deliveryStatus: "sent" } }
    );

    const nextName = [nextDep.firstName, nextDep.lastName].filter(Boolean).join(" ").trim();
    await updateBoardRoleSlot(msg, {
      musicianId: nextDep.musicianId || nextDep._id || null,
      name: nextName,
      firstName: nextDep.firstName || "",
      lastName: nextDep.lastName || "",
      email: nextDep.email || "",
      phone,
      status: "offered",
      candidateSource: "act_deputy",
      deputyJobId: null,
      offerRequestId: newBookingId,
      offeredAt: new Date(),
      respondedAt: null,
      declinedAt: null,
    });

    await AvailabilityModel.updateOne(
      {
        actId: msg.actId,
        lineupId: msg.lineupId,
        dateISO: msg.meta?.MetaISODate,
        phone,
      },
      {
        $set: {
          messageSidOut: wa?.sid || null,
          outboundChannel: "whatsapp",
          outboundSentAt: new Date(),
          outboundMessage: smsBody,
          status: "sent",
        },
      }
    );

    // ---------------------------------------------------
    // 6. Mark previous message auto-escalated
    // ---------------------------------------------------
    if(msg._id) await EnquiryMessage.updateOne(
      { _id: msg._id },
      { $set: { autoEscalatedAt: new Date() } }
    );

    await refreshAllocationForActDate(msg.actId, msg.meta?.MetaISODate);

    console.log("🟢 Escalation complete → new deputy contacted");
    return true;

  } catch (err) {
    console.error("❌ escalateToNextDeputy v2 ERROR:", err);
    return false;
  }
}


// Send the booking-request message to ALL performers in a lineup //whatsapp going to band working
export async function sendBookingRequestToLineup({ actId, lineupId, date, address }) {
   console.log(`🟢 (availabilityController.js) sendBookingRequestToLineup START at ${new Date().toISOString()}`, {
 });
  const act = await Act.findById(actId).lean();
  if (!act) { console.warn("sendBookingRequestToLineup: no act", actId); return { sent: 0 }; }

  const dateISO = new Date(date).toISOString().slice(0, 10);
  const formattedDate = formatWithOrdinal(date);
  const shortAddr = String(address || "")
    .split(",").slice(-2).join(",").replace(/,\s*UK$/i, "").trim();

  const allLineups = Array.isArray(act.lineups) ? act.lineups : [];
  const lineup = lineupId
    ? (allLineups.find(l =>
        String(l._id) === String(lineupId) || String(l.lineupId) === String(lineupId)
      ) || allLineups[0]) 
    : allLineups[0];

  const allBookingMembers = Array.isArray(lineup?.bandMembers) ? lineup.bandMembers : [];
  let members = allBookingMembers;
  const allocationBoard=await bookingBoardItem.findOne({actId:act._id,eventDateISO:dateISO,bookingStatus:{$ne:'cancelled'}}).lean();
  members=members.filter(m=>!vocalistAllocationBlocked(allocationBoard||{lineupComposition:members.map(p=>p.instrument)},m.instrument,lineup));
  const contentSid = process.env.TWILIO_INSTRUMENTALIST_BOOKING_REQUEST_SID; // HXcd99249…

  // Resolve every performer fee before sending anything. This makes the
  // operation all-or-nothing and prevents partial requests containing £0/TBC.
  const resolvedFees = new Map();
  for (const member of members) {
    const role = String(member?.instrument || "").trim().toLowerCase();
    if (!role || role === "manager" || role === "admin") continue;
    const finalFee = await _finalFeeForMember({
      act, lineup, members:allBookingMembers, member, address, dateISO,
    });
    if (!hasPositiveAllocationFee(finalFee)) {
      return {
        success: false,
        sent: 0,
        error: "ALLOCATION_FEE_REQUIRED",
        message:
          "No allocation requests were sent. Enter a fee above £0 for every performer first.",
      };
    }
    resolvedFees.set(member, finalFee);
  }

  let sent = 0;

  const rosterPolicy = await getRosterPolicy(act._id);
  for (const originalMember of members) {
    const m=selectRosterMember({member:originalMember,lineup,policy:rosterPolicy,address});
    if(!m) continue;
    const role = String(m?.instrument || "").trim().toLowerCase();
    if (!role || role === "manager" || role === "admin") continue; // performers only

    // normalise phone → +44…
    let phone = String(m?.phoneNumber || m?.phone || "").replace(/\s+/g, "");
    if (!phone && (m?.musicianId || m?._id)) {
      try {
        const mus = await Musician.findById(m.musicianId || m._id).select("phone phoneNumber").lean();
        phone = String(mus?.phone || mus?.phoneNumber || "").replace(/\s+/g, "");
      } catch {}
    }
    if (!phone) continue;
    if (phone.startsWith("07")) phone = phone.replace(/^0/, "+44");
    else if (phone.startsWith("44")) phone = `+${phone}`;
    else if (!phone.startsWith("+")) phone = `+${phone}`;

    // fee = SAME logic as enquiry
    const finalFee = resolvedFees.get(originalMember);

    // Keep a copy of the request for the message history. It is never used as
    // an automatic SMS fallback.
    const smsBody = buildAvailabilitySMS({
      firstName: m.firstName || m.name || "",
      formattedDate,
      formattedAddress: shortAddr,
      fee: String(finalFee),
      duties: m.instrument || "performance",
      actName: act.tscName || act.name || "the band",
    });

 // WhatsApp slots 1..6 ONLY – extra keys are NOT sent to Twilio
    const slots = {
      "1": m.firstName || m.name || "",
      "2": formattedDate,
      "3": shortAddr,
      "4": String(finalFee),
      "5": m.instrument || "performance",
      "6": act.tscName || act.name || "",
    };

    try {
      const waRes = await sendWhatsAppMessage({
        to: `whatsapp:${phone}`,
        contentSid,           // your instrumentalist booking-request template SID
        allowDefaultContentSid: false,
        variables: slots,     // <-- pass numbered slots here
        smsBody,
        allowSmsFallback: false,
        source: "booking-lineup-request",
        requireOpportunityDetails: true,
        opportunityDetails: {
          actName: act.tscName || act.name,
          date: formattedDate,
          address: shortAddr,
          duties: m.instrument,
          fee: finalFee,
        },
      });


      // Store the outbound SID so delivery failures can be recorded and emailed.
      await AvailabilityModel.findOneAndUpdate(
        { actId, dateISO, phone },
        {
          $setOnInsert: {
            enquiryId: Date.now().toString(),
            actId,
            lineupId: lineup?._id || lineup?.lineupId || null,
            phone,
            duties: m.instrument || "performance",
            fee: String(finalFee),
            formattedDate,
            formattedAddress: shortAddr,
            reply: null,
            createdAt: new Date(),
            actName: act.tscName || act.name || "",
            contactName: m.firstName || "",
            musicianName: `${m.firstName || ""} ${m.lastName || ""}`.trim(),
            dateISO,
          },
          $set: {
            messageSidOut: waRes?.sid || null,
            contactChannel: "whatsapp",
            updatedAt: new Date(),
            "outbound.smsBody": smsBody,
            "outbound.sid": waRes?.sid || null,
          },
        },
        { upsert: true }
      );

      sent++;
      console.log("📣 Booking request sent", { to: phone, duties: m.instrument, fee: finalFee });
    } catch (e) {
      console.warn("⚠️ WhatsApp booking request failed; no SMS fallback", {
        to: phone,
        err: e?.message || e,
      });
    }
  }

  return { sent, members: members.length };
}

// Resolve the musicianId who replied YES for a given act/date.
// Returns the most-recent YES row (if any).
export const resolveAvailableMusician = async (req, res) => {
   console.log(`🟢 (availabilityController.js) resolveAvailableMusician START at ${new Date().toISOString()}`, {
 });
  try {
    const { actId, dateISO } = req.query || {};
    if (!actId || !dateISO) {
      return res
        .status(400)
        .json({ success: false, musicianId: null, message: "Missing actId/dateISO" });
    }

    const row = await AvailabilityModel.findOne({ actId, dateISO, reply: "yes" })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select({ musicianId: 1 })
      .lean();

    return res.json({ success: true, musicianId: row?.musicianId || null });
  } catch (e) {
    console.error("resolveAvailableMusician error:", e?.message || e);
    return res
      .status(500)
      .json({ success: false, musicianId: null, message: e?.message || "Server error" });
  }
};

// ---- Allocation sync with Booking Board ----
async function refreshAllocationForActDate(actId, dateISO) {
   console.log(`🟢 (availabilityController.js) refreshAllocationForActDate START at ${new Date().toISOString()}`, {
 });
  try {
    if (!actId || !dateISO) return;

    const [yesCount, pendingCount, noCount] = await Promise.all([
      AvailabilityModel.countDocuments({ actId, dateISO, reply: "yes" }),
      AvailabilityModel.countDocuments({ actId, dateISO, reply: null }),
      AvailabilityModel.countDocuments({ actId, dateISO, reply: { $in: ["no", "unavailable"] } }),
    ]);

    let status = "in_progress";
    if (yesCount >= 1 && pendingCount === 0) status = "fully_allocated";
    if (noCount > 0 && yesCount === 0) status = "gap";

    await bookingBoardItem.updateMany(
      { actId, eventDateISO: dateISO },
      { $set: { "allocation.status": status, "allocation.lastCheckedAt": new Date() } }
    );
  } catch (e) {
    console.warn("⚠️ refreshAllocationForActDate failed:", e?.message || e);
  }
}

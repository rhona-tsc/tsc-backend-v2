import BookingBoardItem from "../models/bookingBoardItem.js";
import ClientAutomationDelivery from "../models/clientAutomationDeliveryModel.js";
import ClientAutomationDigest from "../models/clientAutomationDigestModel.js";
import sendEmail from "../utils/sendEmail.js";
import { escapeEmailHtml } from "../utils/tscEmailBranding.js";
import { resolveBookedActName } from "../utils/bookingDisplayName.js";
import {
  AUTOMATION_10_KEY,
  AUTOMATION_11_KEY,
  AUTOMATION_14_KEY,
  AUTOMATION_16_KEY,
  AUTOMATION_21_KEY,
  AUTOMATION_4_KEY,
  automation10Schedule,
  automation11Schedule,
  automation14Schedule,
  automation16Schedule,
  automation21Schedule,
  automation4Schedule,
  clientAutomationAllowlistSnapshot,
  londonTodayISO,
} from "./clientAutomationService.js";

const clean = (value) => String(value || "").trim();
const lower = (value) => clean(value).toLowerCase();

const rowEmails = (row = {}) => [
  row.clientEmail,
  ...(Array.isArray(row.clientEmails)
    ? row.clientEmails.map((item) => item?.email || item)
    : []),
].map(lower).filter(Boolean);

const friendlyDate = (value) => {
  const source = value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : clean(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return "Date missing";
  const date = new Date(`${source}T12:00:00.000Z`);
  const day = date.getUTCDate();
  const lastTwo = day % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
  const monthYear = date.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${day}${suffix} ${monthYear}`;
};

const automationDefinitions = [
  { number: 1, key: "automation-1-intro-email", name: "Booking introduction", intro: true },
  { number: 16, key: AUTOMATION_16_KEY, name: "Song suggestions due soon", schedule: automation16Schedule },
  { number: 14, key: AUTOMATION_14_KEY, name: "Song requests due today", schedule: automation14Schedule },
  { number: 21, key: AUTOMATION_21_KEY, name: "Act add-ons", schedule: automation21Schedule },
  { number: 10, key: AUTOMATION_10_KEY, name: "Playlist, event sheet & balance coming due", schedule: automation10Schedule },
  { number: 11, key: AUTOMATION_11_KEY, name: "Balance now due", schedule: automation11Schedule },
  { number: 4, key: AUTOMATION_4_KEY, name: "Vocalists finalise setlist", schedule: automation4Schedule, internal: true },
];

const deliveryStatus = (delivery) => {
  if (!delivery) return "";
  if (delivery.status === "sent") return `Sent${delivery.sentAt ? ` ${friendlyDate(delivery.sentAt)}` : ""}`;
  if (delivery.status === "blocked") {
    const missing = (delivery.missingPrerequisites || []).join(", ");
    return `BLOCKED${missing ? ` — missing ${missing}` : ""}`;
  }
  if (delivery.status === "failed") return `FAILED${delivery.error ? ` — ${clean(delivery.error)}` : ""}`;
  return "Sending";
};

const scheduleStatus = ({ row, definition, todayISO, delivery, allowlisted }) => {
  const delivered = deliveryStatus(delivery);
  if (delivered) return delivered;
  if (definition.intro) {
    return row.introEmailSentAt
      ? `Sent ${friendlyDate(row.introEmailSentAt)}`
      : "Not sent — manual booking-board action";
  }
  if (row.siteAutomationsEnabled === false) return "Suppressed — site automations are off";
  if (!allowlisted) return "Preview only — not on the live allowlist";
  if ((definition.number === 10 || definition.number === 11) && (
    row.balancePaid || row.balancePaymentReceived || row.invoicePaid ||
    row.payments?.balancePaymentReceived || row.payments?.invoicePaid
  )) return "Not required — balance recorded as paid";
  const schedule = definition.schedule(row, todayISO);
  if (schedule.eligible) {
    return schedule.reason === "catch_up" ? "DUE NOW — catch-up" : "DUE NOW";
  }
  if (schedule.plannedISO) return `${friendlyDate(schedule.plannedISO)} — ${schedule.reason.replaceAll("_", " ")}`;
  return `Not schedulable — ${schedule.reason.replaceAll("_", " ")}`;
};

export const buildClientAutomationDigest = ({ rows = [], deliveries = [], todayISO }) => {
  const { emails, bookingRefs: refs } = clientAutomationAllowlistSnapshot();
  const deliveryMap = new Map(deliveries.map((item) => [`${item.bookingId}|${item.automationKey}`, item]));
  let warningCount = 0;

  const bookings = rows.map((row) => {
    const emailAllowed = rowEmails(row).some((email) => emails.has(email));
    const refAllowed = !refs.size || refs.has(clean(row.bookingRef).toUpperCase());
    const allowlisted = emailAllowed && refAllowed;
    const automations = automationDefinitions.map((definition) => {
      const delivery = deliveryMap.get(`${row._id}|${definition.key}`);
      const status = scheduleStatus({ row, definition, todayISO, delivery, allowlisted });
      const plannedISO = definition.schedule
        ? definition.schedule(row, todayISO).plannedISO || ""
        : "";
      return { ...definition, status, plannedISO };
    });
    const plannedCounts = automations.reduce((counts, item) => {
      if (item.plannedISO) counts.set(item.plannedISO, (counts.get(item.plannedISO) || 0) + 1);
      return counts;
    }, new Map());
    automations.forEach((item) => {
      if ((plannedCounts.get(item.plannedISO) || 0) > 1) {
        item.status += " · SAME-DAY OVERLAP";
      }
      if (/^(BLOCKED|FAILED|DUE NOW|Not schedulable)/.test(item.status) || item.status.includes("SAME-DAY OVERLAP")) {
        warningCount += 1;
      }
    });
    return {
      bookingRef: clean(row.bookingRef) || "No booking reference",
      eventDate: friendlyDate(row.eventDateISO || row.eventDate),
      client: clean(row.clientFirstNames || row.bookerName || row.clientName) || "Client name missing",
      email: rowEmails(row)[0] || "Client email missing",
      act: resolveBookedActName({ board: row }) || "Act name missing",
      allowlisted,
      automations,
    };
  });

  const subject = `Daily automation safety digest — ${bookings.length} upcoming gig${bookings.length === 1 ? "" : "s"} — ${friendlyDate(todayISO)}`;
  const text = [
    `Daily automation safety digest for ${friendlyDate(todayISO)}`,
    `${bookings.length} upcoming gig(s); ${warningCount} item(s) need attention or are due now.`,
    "",
    ...bookings.flatMap((booking) => [
      `${booking.eventDate} · ${booking.act} · ${booking.client} · ${booking.bookingRef}`,
      `${booking.allowlisted ? "LIVE allowlist" : "Preview only"} · ${booking.email}`,
      ...booking.automations.map((item) => `  Automation ${item.number}${item.internal ? " (band workflow)" : ""}: ${item.name} — ${item.status}`),
      "",
    ]),
  ].join("\n");

  const htmlBookings = bookings.map((booking) => `
    <section style="border:1px solid #dbe2ea;border-radius:12px;padding:16px;margin:0 0 14px;">
      <h2 style="font-size:18px;margin:0 0 6px;color:#101828;">${escapeEmailHtml(booking.eventDate)} · ${escapeEmailHtml(booking.act)}</h2>
      <p style="margin:0 0 10px;color:#475467;">${escapeEmailHtml(booking.client)} · ${escapeEmailHtml(booking.bookingRef)} · ${escapeEmailHtml(booking.email)}<br /><strong style="color:${booking.allowlisted ? "#067647" : "#b54708"};">${booking.allowlisted ? "LIVE allowlist" : "Preview only — not allowlisted"}</strong></p>
      <table role="presentation" style="border-collapse:collapse;width:100%;font-size:14px;">
        ${booking.automations.map((item) => `
          <tr>
            <td style="padding:7px 8px;border-top:1px solid #eaecf0;width:43%;"><strong>Automation ${item.number}</strong>${item.internal ? " (band workflow)" : ""}<br />${escapeEmailHtml(item.name)}</td>
            <td style="padding:7px 8px;border-top:1px solid #eaecf0;">${escapeEmailHtml(item.status)}</td>
          </tr>`).join("")}
      </table>
    </section>`).join("");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#101828;max-width:900px;margin:auto;">
      <h1 style="font-size:24px;margin-bottom:6px;">Daily automation safety digest</h1>
      <p style="color:#475467;margin-top:0;">${escapeEmailHtml(friendlyDate(todayISO))} · <strong>${bookings.length}</strong> upcoming gig${bookings.length === 1 ? "" : "s"} · <strong>${warningCount}</strong> item${warningCount === 1 ? "" : "s"} due or needing attention.</p>
      ${htmlBookings || "<p>No upcoming gigs were found.</p>"}
      <p style="font-size:12px;color:#667085;">This report is generated from the same schedule rules, booking allowlists and delivery ledger used by the live sender.</p>
    </div>`;

  return { subject, text, html, bookingCount: bookings.length, warningCount, bookings };
};

export const sendClientAutomationDigest = async ({
  now = new Date(),
  bookingModel = BookingBoardItem,
  deliveryModel = ClientAutomationDelivery,
  digestModel = ClientAutomationDigest,
  emailSender = sendEmail,
} = {}) => {
  if (lower(process.env.CLIENT_AUTOMATION_DIGEST_ENABLED) === "false") {
    return { enabled: false, sent: false };
  }
  const todayISO = londonTodayISO(now);
  const recipient = lower(
    process.env.CLIENT_AUTOMATION_DIGEST_RECIPIENT ||
      process.env.CLIENT_AUTOMATION_ALERT_EMAIL ||
      "rhona@thesupremecollective.co.uk",
  );
  const existing = await digestModel.findOne({ digestDate: todayISO });
  const sendingRecently = existing?.status === "sending" &&
    new Date(existing.updatedAt || existing.createdAt || 0).getTime() >= Date.now() - (30 * 60 * 1000);
  if (existing?.status === "sent" || sendingRecently) {
    return { enabled: true, sent: false, reason: "already_processed", digestDate: todayISO };
  }
  const rows = await bookingModel.find({
    eventDateISO: { $gte: todayISO },
    bookingStatus: { $ne: "cancelled" },
  }).sort({ eventDateISO: 1, bookingRef: 1 }).lean();
  const deliveries = rows.length
    ? await deliveryModel.find({ bookingId: { $in: rows.map((row) => row._id) } }).lean()
    : [];
  const digest = buildClientAutomationDigest({ rows, deliveries, todayISO });
  let ledger;
  try {
    ledger = existing || await digestModel.create({
      digestDate: todayISO,
      recipient,
      status: "sending",
      bookingCount: digest.bookingCount,
      warningCount: digest.warningCount,
    });
    if (existing) {
      ledger.status = "sending";
      ledger.error = "";
      ledger.recipient = recipient;
      ledger.bookingCount = digest.bookingCount;
      ledger.warningCount = digest.warningCount;
      await ledger.save();
    }
  } catch (error) {
    if (error?.code === 11000) {
      return { enabled: true, sent: false, reason: "already_processed", digestDate: todayISO };
    }
    throw error;
  }
  const result = await emailSender({
    to: recipient,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });
  if (!result?.ok) {
    ledger.status = "failed";
    ledger.error = clean(result?.error || "Email provider rejected the digest.").slice(0, 1000);
    await ledger.save();
    throw new Error(ledger.error);
  }
  ledger.status = "sent";
  ledger.sentAt = new Date();
  ledger.messageId = result.messageId || "";
  await ledger.save();
  return {
    enabled: true,
    sent: true,
    digestDate: todayISO,
    recipient,
    bookingCount: digest.bookingCount,
    warningCount: digest.warningCount,
  };
};

import BookingBoardItem from "../models/bookingBoardItem.js";
import ClientAutomationDelivery from "../models/clientAutomationDeliveryModel.js";
import cloudinary from "../config/cloudinary.js";
import sendEmail from "../utils/sendEmail.js";
import { buildIntroInvoiceAttachments } from "../utils/introInvoiceAttachment.js";
import { buildTscEmailFooter, escapeEmailHtml } from "../utils/tscEmailBranding.js";

export const AUTOMATION_10_KEY = "automation-10-balance-coming-due";
export const AUTOMATION_10_NUMBER = 10;

const clean = (value) => String(value || "").trim();
const lower = (value) => clean(value).toLowerCase();

const isoDate = (value) => {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
};

const shiftISODate = (value, days) => {
  const source = isoDate(value);
  if (!source) return "";
  const date = new Date(`${source}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
};

export const londonTodayISO = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const ordinalDate = (value) => {
  const source = isoDate(value);
  if (!source) return "the agreed date";
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

const rowEmails = (row = {}) => [
  row.clientEmail,
  ...(Array.isArray(row.clientEmails) ? row.clientEmails.map((item) => item?.email || item) : []),
].map(lower).filter(Boolean);

export const automation10Schedule = (row, todayISO) => {
  const invoiceDueISO = isoDate(row?.invoiceDueDateISO);
  const today = isoDate(todayISO);
  if (!invoiceDueISO || !today) {
    return { eligible: false, reason: "missing_date", plannedISO: "" };
  }
  const plannedISO = shiftISODate(invoiceDueISO, -7);
  if (today < plannedISO) {
    return { eligible: false, reason: "not_due", plannedISO };
  }
  if (today >= invoiceDueISO) {
    return { eligible: false, reason: "deadline_reached", plannedISO };
  }
  return {
    eligible: true,
    reason: today === plannedISO ? "planned_date" : "catch_up",
    plannedISO,
    sendISO: today,
  };
};

const publicEventSheetUrl = (row) => {
  const base = clean(
    process.env.PUBLIC_SITE_URL ||
      process.env.FRONTEND_URL ||
      "https://thesupremecollective.co.uk",
  ).replace(/\/$/, "");
  return row?.bookingRef
    ? `${base}/event-sheet/${encodeURIComponent(row.bookingRef)}`
    : clean(row?.eventSheetLink);
};

export const buildAutomation10Email = (row) => {
  const name = clean(row?.clientFirstNames || row?.bookerName || "there").split(/\s+|&/)[0];
  const dueDate = ordinalDate(row?.invoiceDueDateISO);
  const eventSheetUrl = publicEventSheetUrl(row);
  const hasDj = Boolean(
    row?.bookingDetails?.djServicesBooked || row?.bookedDj || row?.djBooked,
  );
  const subject = "Automated Reminder: Playlist(s), Event Sheet & Balance Coming Due";
  const lines = [
    `Hi ${name || "there"},`,
    "",
    "I hope you are doing well.",
    "",
    `Just a gentle reminder that the Spotify playlist(s) are due next week on ${dueDate}.`,
    ...(hasDj ? ["", "As a band-member DJ service is booked, the advance DJ requests are also due on this date."] : []),
    "",
    "The Event Sheet should also be complete by this date, to ensure the band has everything they need to carry out a successful performance.",
    "",
    `EVENT SHEET: ${eventSheetUrl}`,
    "",
    "Finally, the balance should also be settled by this date. The issued invoice is attached and includes the BACS details.",
    "",
    "If you have already submitted your playlist link(s), completed the Event Sheet, and paid the balance, please disregard this email.",
    "",
    "If you would like to run through your Event Sheet with me over the phone, please feel free to book a slot directly in my calendar: https://calendly.com/thesupremecollective/call",
    "",
    "Warmest wishes,",
    "Rhona ✨",
  ];
  const text = lines.join("\n");
  const paragraph = (value) => `<p style="margin:0 0 18px;font-size:15px;line-height:1.8;">${escapeEmailHtml(value)}</p>`;
  const html = `
    <div style="margin:0;padding:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111;">
      <div style="max-width:720px;margin:0;background:#fff;padding:0;">
        ${paragraph(`Hi ${name || "there"},`)}
        ${paragraph("I hope you are doing well.")}
        ${paragraph(`Just a gentle reminder that the Spotify playlist(s) are due next week on ${dueDate}.`)}
        ${hasDj ? paragraph("As a band-member DJ service is booked, the advance DJ requests are also due on this date.") : ""}
        ${paragraph("The Event Sheet should also be complete by this date, to ensure the band has everything they need to carry out a successful performance.")}
        <p style="margin:0 0 18px;font-size:15px;line-height:1.8;"><strong>EVENT SHEET:</strong> <a href="${escapeEmailHtml(eventSheetUrl)}" style="color:#ff6667;font-weight:700;">Open your editable event sheet</a></p>
        ${paragraph("Finally, the balance should also be settled by this date. The issued invoice is attached and includes the BACS details.")}
        ${paragraph("If you have already submitted your playlist link(s), completed the Event Sheet, and paid the balance, please disregard this email.")}
        <p style="margin:0 0 18px;font-size:15px;line-height:1.8;">If you would like to run through your Event Sheet with me over the phone, please feel free to <a href="https://calendly.com/thesupremecollective/call" style="color:#ff6667;font-weight:700;">book a slot directly in my calendar</a>.</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.7;">Warmest wishes,<br />Rhona ✨</p>
        ${buildTscEmailFooter()}
      </div>
    </div>`;
  return { subject, text, html, eventSheetUrl };
};

const configuredAllowlist = () => new Set(
  clean(process.env.CLIENT_AUTOMATION_EMAIL_ALLOWLIST)
    .split(",")
    .map(lower)
    .filter(Boolean),
);

const configuredBookingRefs = () => new Set(
  clean(process.env.CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST)
    .split(",")
    .map((value) => clean(value).toUpperCase())
    .filter(Boolean),
);

const isBalancePaid = (row = {}) => Boolean(
  row.balancePaid ||
    row.balancePaymentReceived ||
    row.invoicePaid ||
    row.payments?.balancePaymentReceived ||
    row.payments?.invoicePaid,
);

const claimDelivery = async ({ deliveryModel, row, recipient, scheduledForISO, subject }) => {
  const existing = await deliveryModel.findOne({
    automationKey: AUTOMATION_10_KEY,
    bookingId: row._id,
  });
  if (existing?.status === "sent") return null;
  if (existing?.status === "sending") {
    const attemptedAt = existing.attemptedAt ? new Date(existing.attemptedAt).getTime() : 0;
    const staleBefore = Date.now() - (30 * 60 * 1000);
    if (attemptedAt && attemptedAt >= staleBefore) return null;
  }
  if (existing) {
    existing.status = "sending";
    existing.attempts = Number(existing.attempts || 0) + 1;
    existing.attemptedAt = new Date();
    existing.error = "";
    existing.scheduledForISO = scheduledForISO;
    existing.subject = subject;
    await existing.save();
    return existing;
  }
  try {
    return await deliveryModel.create({
      automationKey: AUTOMATION_10_KEY,
      automationNumber: AUTOMATION_10_NUMBER,
      bookingId: row._id,
      bookingRef: clean(row.bookingRef),
      recipient,
      subject,
      scheduledForISO,
      status: "sending",
      attempts: 1,
      attemptedAt: new Date(),
    });
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
};

export const runClientAutomations = async ({
  now = new Date(),
  bookingModel = BookingBoardItem,
  deliveryModel = ClientAutomationDelivery,
  emailSender = sendEmail,
  attachmentBuilder = buildIntroInvoiceAttachments,
  cloudinaryClient = cloudinary,
} = {}) => {
  if (clean(process.env.CLIENT_AUTOMATIONS_ENABLED).toLowerCase() !== "true") {
    return { enabled: false, considered: 0, sent: 0, skipped: 0, failed: 0 };
  }
  const allowlist = configuredAllowlist();
  if (!allowlist.size) {
    return { enabled: true, considered: 0, sent: 0, skipped: 0, failed: 0, reason: "empty_allowlist" };
  }
  const todayISO = londonTodayISO(now);
  const bookingRefs = configuredBookingRefs();
  const notBefore = isoDate(process.env.CLIENT_AUTOMATIONS_NOT_BEFORE);
  if (notBefore && todayISO < notBefore) {
    return { enabled: true, considered: 0, sent: 0, skipped: 0, failed: 0, reason: "not_before" };
  }

  const query = {
    siteAutomationsEnabled: { $ne: false },
    $or: [
      { clientEmail: { $in: [...allowlist] } },
      { "clientEmails.email": { $in: [...allowlist] } },
    ],
  };
  if (bookingRefs.size) query.bookingRef = { $in: [...bookingRefs] };
  const rows = await bookingModel.find(query).lean();
  const summary = { enabled: true, considered: rows.length, sent: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    const recipient = rowEmails(row).find((email) => allowlist.has(email));
    const schedule = automation10Schedule(row, todayISO);
    if (!recipient || !schedule.eligible || isBalancePaid(row)) {
      summary.skipped += 1;
      continue;
    }
    const email = buildAutomation10Email(row);
    const delivery = await claimDelivery({
      deliveryModel,
      row,
      recipient,
      scheduledForISO: schedule.sendISO,
      subject: email.subject,
    });
    if (!delivery) {
      summary.skipped += 1;
      continue;
    }
    try {
      const attachments = await attachmentBuilder(row, { cloudinaryClient });
      if (!attachments.length) throw new Error("No issued invoice PDF is recorded for this booking.");
      const result = await emailSender({
        to: recipient,
        bcc: "hello@thesupremecollective.co.uk",
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments,
      });
      if (!result?.ok) throw new Error(result?.error || "Email provider rejected the message.");
      delivery.status = "sent";
      delivery.sentAt = new Date();
      delivery.messageId = result.messageId || "";
      delivery.invoiceAttached = true;
      await delivery.save();
      summary.sent += 1;
    } catch (error) {
      delivery.status = "failed";
      delivery.error = clean(error?.message).slice(0, 1000);
      await delivery.save();
      summary.failed += 1;
    }
  }
  return summary;
};

import BookingBoardItem from "../models/bookingBoardItem.js";
import ClientAutomationDelivery from "../models/clientAutomationDeliveryModel.js";
import cloudinary from "../config/cloudinary.js";
import sendEmail from "../utils/sendEmail.js";
import { buildIntroInvoiceAttachments } from "../utils/introInvoiceAttachment.js";
import { buildTscEmailFooter, escapeEmailHtml } from "../utils/tscEmailBranding.js";

export const AUTOMATION_10_KEY = "automation-10-balance-coming-due";
export const AUTOMATION_10_NUMBER = 10;
export const AUTOMATION_4_KEY = "automation-4-vocalists-finalise-setlist";
export const AUTOMATION_4_NUMBER = 4;

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

const firstName = (value) => clean(value).split(/\s+/)[0] || "";

const friendlyDate = (value) => {
  const source = isoDate(value);
  if (!source) return "the event";
  return new Date(`${source}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

const joinNames = (names = []) => {
  const unique = [...new Set(names.map(clean).filter(Boolean))];
  if (unique.length < 2) return unique[0] || "there";
  if (unique.length === 2) return `${unique[0]} & ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")} & ${unique.at(-1)}`;
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

const songRequestDueISO = (row = {}) => {
  const explicit = isoDate(row.songSuggestionsDueDateISO);
  if (explicit) return explicit;
  const eventISO = isoDate(row.eventDateISO || row.eventDate || row.date);
  if (!eventISO) return "";
  const bookingISO = isoDate(
    row.bookingDateISO || row.enquiryDateISO || row.createdAt,
  );
  if (bookingISO) {
    const event = new Date(`${eventISO}T12:00:00.000Z`);
    const booked = new Date(`${bookingISO}T12:00:00.000Z`);
    const leadDays = Math.round((event.getTime() - booked.getTime()) / 86400000);
    if (leadDays < 35) {
      const oneWeekAfterBooking = shiftISODate(bookingISO, 7);
      if (oneWeekAfterBooking < eventISO) return oneWeekAfterBooking;
      return new Date(booked.getTime() + ((event.getTime() - booked.getTime()) / 2))
        .toISOString()
        .slice(0, 10);
    }
  }
  const event = new Date(`${eventISO}T12:00:00.000Z`);
  event.setUTCMonth(event.getUTCMonth() - 1);
  return event.toISOString().slice(0, 10);
};

export const automation4Schedule = (row, todayISO) => {
  const dueISO = songRequestDueISO(row);
  const today = isoDate(todayISO);
  const eventISO = isoDate(row?.eventDateISO || row?.eventDate || row?.date);
  if (!dueISO || !today) {
    return { eligible: false, reason: "missing_date", plannedISO: "" };
  }
  const plannedISO = shiftISODate(dueISO, 1);
  if (today < plannedISO) {
    return { eligible: false, reason: "not_due", plannedISO };
  }
  if (eventISO && today >= eventISO) {
    return { eligible: false, reason: "event_reached", plannedISO };
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

const assignedMusicians = (row = {}) => {
  const seen = new Set();
  return [
    ...(Array.isArray(row.assignedMusicians) ? row.assignedMusicians : []),
    ...(Array.isArray(row.bookingMusicians) ? row.bookingMusicians : []),
    ...(Array.isArray(row.bandLineup) ? row.bandLineup : []),
    ...(Array.isArray(row.bookingDetails?.assignedMusicians)
      ? row.bookingDetails.assignedMusicians
      : []),
  ].filter((member) => {
    const key = lower(member?.email || member?.musicianId || member?._id || member?.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const vocalistRecipients = (row = {}) => assignedMusicians(row)
  .filter((member) => /vocal|singer/i.test(`${member?.role || ""} ${member?.instrument || ""}`))
  .map((member) => ({
    email: lower(member?.email),
    firstName: firstName(member?.firstName || member?.name),
  }))
  .filter((member) => member.email);

export const buildAutomation4Email = (row) => {
  const vocalists = vocalistRecipients(row);
  const names = joinNames(vocalists.map((member) => member.firstName));
  const clientName = clean(row?.clientFirstNames || row?.bookerName || "the client");
  const eventType = clean(row?.eventType || "event");
  const eventDate = friendlyDate(row?.eventDateISO || row?.eventDate);
  const eventSheetUrl = publicEventSheetUrl(row);
  const draftSetlistUrl = clean(row?.draftSetlistLink);
  const whatsappUrl = clean(row?.whatsappGroupLink);
  const subject = `Time to Finalise The Setlist for ${clientName}'s ${eventType} on ${eventDate}`;
  const lines = [
    `Hi ${names},`,
    "",
    "Hope you're well!",
    "",
    `It's time to check the song suggestions and requests from the Event Sheet, make any amendments needed to the draft setlist, and note any key changes directly in the spreadsheet. Once you're done, please let the band know in the WhatsApp group so everyone has ample time to prepare for the gig.`,
    "",
    `EVENT SHEET: ${eventSheetUrl}`,
    `DRAFT SETLIST: ${draftSetlistUrl}`,
    `WHATSAPP GROUP: ${whatsappUrl}`,
    "",
    "If the song suggestions aren't on the Event Sheet, or the draft setlist hasn't populated correctly, please flag this with me and I'll get it resolved for you.",
    "",
    "Many thanks!",
    "Rhona ✨",
  ];
  const link = (label, url) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.8;"><strong>${label}:</strong> <a href="${escapeEmailHtml(url)}" style="color:#ff6667;font-weight:700;">Open ${escapeEmailHtml(label.toLowerCase())}</a></p>`;
  const html = `
    <div style="margin:0;padding:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111;">
      <div style="max-width:720px;margin:0;background:#fff;padding:0;">
        <p style="margin:0 0 18px;font-size:15px;line-height:1.8;">Hi ${escapeEmailHtml(names)},</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.8;">Hope you're well!</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.8;">It's time to check the song suggestions and requests from the Event Sheet, make any amendments needed to the draft setlist, and note any key changes directly in the spreadsheet. Once you're done, please let the band know in the WhatsApp group so everyone has ample time to prepare for the gig.</p>
        ${link("EVENT SHEET", eventSheetUrl)}
        ${link("DRAFT SETLIST", draftSetlistUrl)}
        ${link("WHATSAPP GROUP", whatsappUrl)}
        <p style="margin:18px 0;font-size:15px;line-height:1.8;">If the song suggestions aren't on the Event Sheet, or the draft setlist hasn't populated correctly, please flag this with me and I'll get it resolved for you.</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.7;">Many thanks!<br />Rhona ✨</p>
        ${buildTscEmailFooter()}
      </div>
    </div>`;
  return {
    subject,
    text: lines.join("\n"),
    html,
    recipients: vocalists.map((member) => member.email),
  };
};

const missingAutomation4Prerequisites = (row = {}) => [
  !clean(row.draftSetlistLink) ? "Draft setlist link" : "",
  !clean(row.whatsappGroupLink) ? "WhatsApp group link" : "",
].filter(Boolean);

const automationAlertRecipient = () => clean(
  process.env.CLIENT_AUTOMATION_ALERT_EMAIL ||
    process.env.ADMIN_EMAIL ||
    "hello@thesupremecollective.co.uk",
);

const buildBlockedAutomation4Alert = (row, missing) => {
  const bookingRef = clean(row?.bookingRef || "Unknown booking");
  const subject = `Automation held: vocalist setlist invite · ${bookingRef}`;
  const missingList = missing.join(" and ");
  const text = [
    "Hi Rhona,",
    "",
    `Invite for Vocalists to Finalise Setlist tried to run for ${bookingRef}, but it was not sent because the ${missingList} ${missing.length === 1 ? "is" : "are"} missing.`,
    "",
    "Add the missing link(s) on the Booking Board row. The vocalist email will then join the queue automatically for the next automation run.",
    "",
    `Client/contact: ${clean(row?.clientFirstNames || row?.bookerName || "Not recorded")}`,
    `Act: ${clean(row?.actTscName || row?.actName || "Not recorded")}`,
    `Event date: ${friendlyDate(row?.eventDateISO || row?.eventDate)}`,
  ].join("\n");
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:720px;">
      <p>Hi Rhona,</p>
      <p><strong>Invite for Vocalists to Finalise Setlist</strong> tried to run for <strong>${escapeEmailHtml(bookingRef)}</strong>, but it was not sent because the <strong>${escapeEmailHtml(missingList)}</strong> ${missing.length === 1 ? "is" : "are"} missing.</p>
      <p>Add the missing link(s) on the Booking Board row. The vocalist email will then join the queue automatically for the next automation run.</p>
      <p>Client/contact: ${escapeEmailHtml(clean(row?.clientFirstNames || row?.bookerName || "Not recorded"))}<br />Act: ${escapeEmailHtml(clean(row?.actTscName || row?.actName || "Not recorded"))}<br />Event date: ${escapeEmailHtml(friendlyDate(row?.eventDateISO || row?.eventDate))}</p>
    </div>`;
  return { subject, text, html };
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

const claimDelivery = async ({
  deliveryModel,
  row,
  recipient,
  scheduledForISO,
  subject,
  automationKey = AUTOMATION_10_KEY,
  automationNumber = AUTOMATION_10_NUMBER,
}) => {
  const existing = await deliveryModel.findOne({
    automationKey,
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
    existing.recipient = recipient;
    existing.missingPrerequisites = [];
    existing.blockSignature = "";
    existing.blockedNotifiedAt = null;
    await existing.save();
    return existing;
  }
  try {
    return await deliveryModel.create({
      automationKey,
      automationNumber,
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

const holdAutomation4ForMissingLinks = async ({
  deliveryModel,
  emailSender,
  row,
  recipient,
  scheduledForISO,
  subject,
  missing,
}) => {
  const signature = missing.map(lower).sort().join("|");
  let delivery = await deliveryModel.findOne({
    automationKey: AUTOMATION_4_KEY,
    bookingId: row._id,
  });
  if (delivery?.status === "sent") return { held: false, alreadySent: true, notified: false };
  if (
    delivery?.status === "blocked" &&
    delivery?.blockSignature === signature &&
    delivery?.blockedNotifiedAt
  ) {
    return { held: true, alreadySent: false, notified: false };
  }
  if (!delivery) {
    try {
      delivery = await deliveryModel.create({
        automationKey: AUTOMATION_4_KEY,
        automationNumber: AUTOMATION_4_NUMBER,
        bookingId: row._id,
        bookingRef: clean(row.bookingRef),
        recipient,
        subject,
        scheduledForISO,
        status: "blocked",
        missingPrerequisites: missing,
        blockSignature: signature,
      });
    } catch (error) {
      if (error?.code === 11000) return { held: true, alreadySent: false, notified: false };
      throw error;
    }
  } else {
    delivery.status = "blocked";
    delivery.recipient = recipient;
    delivery.subject = subject;
    delivery.scheduledForISO = scheduledForISO;
    delivery.missingPrerequisites = missing;
    delivery.blockSignature = signature;
    delivery.blockedNotifiedAt = null;
    delivery.error = "";
    await delivery.save();
  }

  const alert = buildBlockedAutomation4Alert(row, missing);
  const result = await emailSender({
    to: automationAlertRecipient(),
    subject: alert.subject,
    html: alert.html,
    text: alert.text,
  });
  if (!result?.ok) {
    delivery.error = clean(result?.error || "The missing-link alert was rejected.").slice(0, 1000);
    await delivery.save();
    throw new Error(delivery.error);
  }
  delivery.blockedNotifiedAt = new Date();
  delivery.messageId = result.messageId || "";
  await delivery.save();
  return { held: true, alreadySent: false, notified: true };
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
  const summary = {
    enabled: true,
    considered: rows.length,
    sent: 0,
    blocked: 0,
    alertsSent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const row of rows) {
    const recipient = rowEmails(row).find((email) => allowlist.has(email));
    const schedule = automation10Schedule(row, todayISO);
    if (!recipient || !schedule.eligible || isBalancePaid(row)) {
      summary.skipped += 1;
    } else {
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
      } else {
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
    }

    const vocalistSchedule = automation4Schedule(row, todayISO);
    if (!vocalistSchedule.eligible) {
      summary.skipped += 1;
      continue;
    }
    const vocalistEmail = buildAutomation4Email(row);
    if (!vocalistEmail.recipients.length) {
      summary.skipped += 1;
      continue;
    }
    const missing = missingAutomation4Prerequisites(row);
    if (missing.length) {
      try {
        const hold = await holdAutomation4ForMissingLinks({
          deliveryModel,
          emailSender,
          row,
          recipient: vocalistEmail.recipients.join(", "),
          scheduledForISO: vocalistSchedule.sendISO,
          subject: vocalistEmail.subject,
          missing,
        });
        if (hold.alreadySent) summary.skipped += 1;
        else {
          summary.blocked += 1;
          if (hold.notified) summary.alertsSent += 1;
        }
      } catch {
        summary.failed += 1;
      }
      continue;
    }
    const vocalistDelivery = await claimDelivery({
      deliveryModel,
      row,
      recipient: vocalistEmail.recipients.join(", "),
      scheduledForISO: vocalistSchedule.sendISO,
      subject: vocalistEmail.subject,
      automationKey: AUTOMATION_4_KEY,
      automationNumber: AUTOMATION_4_NUMBER,
    });
    if (!vocalistDelivery) {
      summary.skipped += 1;
      continue;
    }
    try {
      const result = await emailSender({
        to: vocalistEmail.recipients,
        bcc: "hello@thesupremecollective.co.uk",
        subject: vocalistEmail.subject,
        html: vocalistEmail.html,
        text: vocalistEmail.text,
      });
      if (!result?.ok) throw new Error(result?.error || "Email provider rejected the message.");
      vocalistDelivery.status = "sent";
      vocalistDelivery.sentAt = new Date();
      vocalistDelivery.messageId = result.messageId || "";
      await vocalistDelivery.save();
      summary.sent += 1;
    } catch (error) {
      vocalistDelivery.status = "failed";
      vocalistDelivery.error = clean(error?.message).slice(0, 1000);
      await vocalistDelivery.save();
      summary.failed += 1;
    }
  }
  return summary;
};

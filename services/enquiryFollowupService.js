import AvailabilityModel from "../models/availabilityModel.js";
import EnquiryBoardItem from "../models/enquiryBoardItem.js";
import Act from "../models/actModel.js";
import sendEmail from "../utils/sendEmail.js";
import { buildTscEmailFooter, escapeEmailHtml } from "../utils/tscEmailBranding.js";
import { availableVocalistsForLineup } from "../utils/enquiryAvailability.js";

const DAY_TWO_DELAY_MS = 48 * 60 * 60 * 1000;
const clean = (value) => String(value || "").trim();

const shortName = (value) => {
  const parts = clean(value).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Vocalist";
  return `${parts[0]} ${parts.at(-1)[0].toUpperCase()}`;
};

const friendlyDate = (value) => {
  const date = new Date(`${clean(value).slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "your date";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

const findLineup = (act, rows) => {
  const lineupId = rows.find((row) => row.lineupId)?.lineupId;
  return (act?.lineups || []).find(
    (lineup) =>
      String(lineup?._id || "") === String(lineupId || "") ||
      String(lineup?.lineupId || "") === String(lineupId || ""),
  );
};

const vocalistOptionsHtml = (summary) =>
  summary.requiredSlots
    .map((slotIndex) => {
      const names = (summary.bySlot.get(slotIndex) || [])
        .map((row) => shortName(row.displayName || row.musicianName))
        .filter(Boolean);
      const label = summary.requiredSlots.length > 1
        ? `Vocal slot ${slotIndex + 1}`
        : "Available vocalists";
      return `<li><strong>${escapeEmailHtml(label)}:</strong> ${escapeEmailHtml(names.join(", "))}</li>`;
    })
    .join("");

export const buildEnquiryDayTwoEmail = ({ enquiry, act, summary }) => {
  const clientFirstName = clean(enquiry?.clientName).split(/\s+/)[0] || "there";
  const actName = clean(enquiry?.actTscName || enquiry?.actName || act?.tscName || act?.name || "the band");
  const eventDate = friendlyDate(enquiry?.eventDateISO);
  const site = clean(process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || "https://thesupremecollective.co.uk").replace(/\/$/, "");
  const slug = clean(act?.slug || act?.tscSlug) || actName.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const address = clean(enquiry?.address || summary.all[0]?.formattedAddress);
  const bookUrl = `${site}/act/${encodeURIComponent(slug)}?date=${encodeURIComponent(enquiry?.eventDateISO || "")}&address=${encodeURIComponent(address)}`;
  const optionLines = summary.requiredSlots.map((slotIndex) => {
    const names = (summary.bySlot.get(slotIndex) || [])
      .map((row) => shortName(row.displayName || row.musicianName))
      .filter(Boolean);
    const label = summary.requiredSlots.length > 1 ? `Vocal slot ${slotIndex + 1}` : "Available vocalists";
    return `${label}: ${names.join(", ")}`;
  });
  const subject = `A quick check-in about ${actName} for ${eventDate}`;
  const text = [
    `Hi ${clientFirstName},`,
    "",
    `I just wanted to check in personally to see whether you had any questions about ${actName}.`,
    "",
    "We have now heard back from the vocalists below, who are currently available for your date:",
    ...optionLines.map((line) => `- ${line}`),
    "",
    "Availability can change because our vocalists also accept work through other avenues, so please let me know if you would like any help choosing the best fit or putting the booking in place.",
    "",
    `View the band and book: ${bookUrl}`,
    "",
    "Warmest wishes,",
    "Rhona ✨",
  ].join("\n");
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.7;max-width:720px;">
      <p>Hi ${escapeEmailHtml(clientFirstName)},</p>
      <p>I just wanted to check in personally to see whether you had any questions about <strong>${escapeEmailHtml(actName)}</strong>.</p>
      <p>We have now heard back from the vocalists below, who are currently available for your date:</p>
      <ul>${vocalistOptionsHtml(summary)}</ul>
      <p>Availability can change because our vocalists also accept work through other avenues, so please let me know if you would like any help choosing the best fit or putting the booking in place.</p>
      <p><a href="${escapeEmailHtml(bookUrl)}" style="display:inline-block;background:#ff6667;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;">View ${escapeEmailHtml(actName)} and book →</a></p>
      <p>Warmest wishes,<br />Rhona ✨</p>
      ${buildTscEmailFooter()}
    </div>`;
  return { subject, text, html };
};

export const runEnquiryDayTwoFollowups = async ({ now = new Date() } = {}) => {
  const cutoff = new Date(now.getTime() - DAY_TWO_DELAY_MS);
  const dueRows = await AvailabilityModel.find({
    clientAvailabilityEmailSentAt: { $ne: null, $lte: cutoff },
    clientDayTwoEmailSentAt: null,
    requestKey: { $exists: true, $ne: "" },
  })
    .select("requestKey enquiryId")
    .lean();
  const requestKeys = [...new Set(dueRows.map((row) => row.requestKey).filter(Boolean))];
  const result = { considered: requestKeys.length, sent: 0, skipped: 0, failed: 0 };

  for (const requestKey of requestKeys) {
    const rows = await AvailabilityModel.find({ requestKey }).lean();
    const representative = rows.find((row) => row.clientAvailabilityEmailSentAt);
    if (
      !representative ||
      rows.some((row) => row.clientDayTwoEmailSentAt || row.confirmedBooking)
    ) {
      result.skipped += 1;
      continue;
    }
    const enquiry = await EnquiryBoardItem.findOne({
      enquiryRef: representative.enquiryId,
      status: { $in: ["open", "contacted", "qualified"] },
    }).lean();
    if (!enquiry || !/\S+@\S+\.\S+/.test(clean(enquiry.clientEmail || representative.clientEmail))) {
      result.skipped += 1;
      continue;
    }
    const act = await Act.findById(representative.actId)
      .select("tscName name slug tscSlug lineups")
      .lean();
    const lineup = findLineup(act, rows);
    const summary = availableVocalistsForLineup(rows, lineup);
    if (!summary.complete) {
      result.skipped += 1;
      continue;
    }

    const claimed = await AvailabilityModel.findOneAndUpdate(
      { _id: representative._id, clientDayTwoEmailSentAt: null },
      { $set: { clientDayTwoEmailSentAt: now } },
      { new: true },
    );
    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    try {
      const email = buildEnquiryDayTwoEmail({ enquiry, act, summary });
      const sent = await sendEmail({
        to: clean(enquiry.clientEmail || representative.clientEmail),
        bcc: "hello@thesupremecollective.co.uk",
        subject: email.subject,
        text: email.text,
        html: email.html,
        replyTo: "hello@thesupremecollective.co.uk",
      });
      if (!sent?.ok) throw new Error(sent?.error || "Email provider rejected the message");
      await AvailabilityModel.updateMany(
        { requestKey },
        {
          $set: {
            clientDayTwoEmailSentAt: now,
            clientDayTwoEmailMessageId: sent.messageId || "",
          },
        },
      );
      result.sent += 1;
    } catch (error) {
      await AvailabilityModel.updateOne(
        { _id: representative._id },
        { $set: { clientDayTwoEmailSentAt: null } },
      );
      console.error("❌ Enquiry Day 2 follow-up failed", requestKey, error?.message || error);
      result.failed += 1;
    }
  }

  return result;
};


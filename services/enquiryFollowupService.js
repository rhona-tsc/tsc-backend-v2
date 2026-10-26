import AvailabilityModel from "../models/availabilityModel.js";
import EnquiryBoardItem from "../models/enquiryBoardItem.js";
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import sendEmail from "../utils/sendEmail.js";
import { buildTscEmailFooter, escapeEmailHtml } from "../utils/tscEmailBranding.js";
import { availableVocalistsForLineup } from "../utils/enquiryAvailability.js";

const DAY_TWO_DELAY_MS = 48 * 60 * 60 * 1000;
const clean = (value) => String(value || "").trim();
const isHttpUrl = (value) => /^https?:\/\//i.test(clean(value));

const publicSiteUrl = () =>
  clean(
    process.env.PUBLIC_SITE_URL ||
      process.env.FRONTEND_URL ||
      "https://thesupremecollective.co.uk",
  ).replace(/\/$/, "");

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

const vocalistProfileCardsHtml = (summary) =>
  summary.requiredSlots
    .map((slotIndex) => {
      const rows = summary.bySlot.get(slotIndex) || [];
      const slotHeading =
        summary.requiredSlots.length > 1
          ? `<h3 style="margin:24px 0 4px;font-size:17px;color:#111;">Vocal slot ${slotIndex + 1}</h3>`
          : "";
      const cards = rows
        .map((row) => {
          const name = shortName(row.displayName || row.musicianName);
          const profileUrl = isHttpUrl(row.profileUrl) ? row.profileUrl : "";
          const photoUrl = isHttpUrl(row.photoUrl) ? row.photoUrl : "";
          const videos = (Array.isArray(row.videos) ? row.videos : [])
            .filter((video) => isHttpUrl(video?.url))
            .slice(0, 4);
          return `
            <div style="margin:18px 0 0;padding:18px 0 0;border-top:1px solid #eeeeee;">
              <h3 style="margin:0 0 12px;font-size:18px;color:#111;">Introducing ${escapeEmailHtml(name)}</h3>
              ${
                photoUrl
                  ? profileUrl
                    ? `<a href="${escapeEmailHtml(profileUrl)}" style="display:inline-block;text-decoration:none;"><img src="${escapeEmailHtml(photoUrl)}" width="160" height="160" alt="${escapeEmailHtml(name)}" style="display:block;width:160px;height:160px;border-radius:50%;object-fit:cover;border:0;" /></a>`
                    : `<img src="${escapeEmailHtml(photoUrl)}" width="160" height="160" alt="${escapeEmailHtml(name)}" style="display:block;width:160px;height:160px;border-radius:50%;object-fit:cover;border:0;" />`
                  : ""
              }
              ${profileUrl ? `<p style="margin:10px 0 0;"><a href="${escapeEmailHtml(profileUrl)}" style="color:#ff6667;font-weight:700;text-decoration:none;">View ${escapeEmailHtml(name)}'s profile →</a></p>` : ""}
              ${
                videos.length
                  ? `<p style="margin:14px 0 6px;font-weight:700;">Watch ${escapeEmailHtml(name)}:</p><ul style="margin:0;padding-left:20px;">${videos
                      .map(
                        (video, index) =>
                          `<li style="margin:4px 0;"><a href="${escapeEmailHtml(video.url)}" style="color:#ff6667;text-decoration:none;">${escapeEmailHtml(video.title || `Video ${index + 1}`)}</a></li>`,
                      )
                      .join("")}</ul>`
                  : ""
              }
            </div>`;
        })
        .join("");
      return `${slotHeading}${cards}`;
    })
    .join("");

const enrichVocalistSummary = async (summary) => {
  const musicianIds = [
    ...new Set(
      summary.all
        .map((row) => clean(row?.musicianId))
        .filter(Boolean),
    ),
  ];
  if (!musicianIds.length) return summary;

  const musicians = await Musician.find({ _id: { $in: musicianIds } })
    .select(
      "firstName lastName displayName preferredName name musicianSlug profilePhoto " +
        "tscApprovedFunctionBandVideoLinks tscApprovedOriginalBandVideoLinks",
    )
    .lean();
  const byId = new Map(musicians.map((musician) => [String(musician._id), musician]));
  const site = publicSiteUrl();
  const enrichRow = (row) => {
    const musician = byId.get(String(row?.musicianId || ""));
    if (!musician) return row;
    const videos = [
      ...(Array.isArray(musician.tscApprovedFunctionBandVideoLinks)
        ? musician.tscApprovedFunctionBandVideoLinks
        : []),
      ...(Array.isArray(musician.tscApprovedOriginalBandVideoLinks)
        ? musician.tscApprovedOriginalBandVideoLinks
        : []),
    ]
      .filter((video) => isHttpUrl(video?.url))
      .map((video) => ({ title: clean(video.title), url: clean(video.url) }));
    return {
      ...row,
      displayName:
        clean(row.displayName || row.musicianName) ||
        clean(
          musician.displayName ||
            musician.preferredName ||
            musician.name ||
            `${clean(musician.firstName)} ${clean(musician.lastName)}`,
        ),
      profileUrl: musician.musicianSlug
        ? `${site}/musician/${encodeURIComponent(musician.musicianSlug)}`
        : `${site}/musician/${musician._id}`,
      photoUrl: isHttpUrl(musician.profilePhoto) ? musician.profilePhoto : "",
      videos,
    };
  };
  const bySlot = new Map(
    summary.requiredSlots.map((slotIndex) => [
      slotIndex,
      (summary.bySlot.get(slotIndex) || []).map(enrichRow),
    ]),
  );
  return {
    ...summary,
    bySlot,
    selected: summary.requiredSlots
      .map((slotIndex) => (bySlot.get(slotIndex) || [])[0])
      .filter(Boolean),
    all: summary.requiredSlots.flatMap(
      (slotIndex) => bySlot.get(slotIndex) || [],
    ),
  };
};

export const buildEnquiryDayTwoEmail = ({ enquiry, act, summary }) => {
  const clientFirstName = clean(enquiry?.clientName).split(/\s+/)[0] || "there";
  const actName = clean(enquiry?.actTscName || enquiry?.actName || act?.tscName || act?.name || "the band");
  const eventDate = friendlyDate(enquiry?.eventDateISO);
  const site = publicSiteUrl();
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
    "We have now heard back from the band's other deputy vocalists below, who are currently available for your date:",
    ...optionLines.map((line) => `- ${line}`),
    "",
    "If you would like to book a particular vocalist to front the band, you can do so by proceeding to checkout and selecting your preferred deputy. You’re also welcome to progress your booking with a particular vocalist simply by replying to this email, if that’s easiest for you.",
    "",
    "Please kindly note that availability can change because our vocalists also accept work through other avenues, so please let me know if you would like any help choosing the best fit.",
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
      <p>We have now heard back from the band's <em>other deputy</em> vocalists below, who are currently available for your date:</p>
      ${vocalistProfileCardsHtml(summary)}
      <p>If you would like to book a particular vocalist to front the band, you can do so by proceeding to checkout and selecting your preferred deputy. You’re also welcome to progress your booking with a particular vocalist simply by replying to this email, if that’s easiest for you.</p>
      <p>Please kindly note that availability can change because our vocalists also accept work through other avenues, so please let me know if you would like any help choosing the best fit.</p>
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
    const summary = await enrichVocalistSummary(
      availableVocalistsForLineup(rows, lineup),
    );
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


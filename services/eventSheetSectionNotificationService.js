import sendEmail from "../utils/sendEmail.js";
import { buildEventSheetUrl } from "../utils/publicSiteUrl.js";
import { escapeEmailHtml } from "../utils/tscEmailBranding.js";

const clean = (value) => String(value || "").trim();

const isSongSectionComplete = (complete = {}) =>
  complete?.first_dance === true || complete?.song_suggestions === true;

export const didSongSectionBecomeComplete = (previousEventSheet, nextEventSheet) =>
  !isSongSectionComplete(previousEventSheet?.complete) &&
  isSongSectionComplete(nextEventSheet?.complete);

const friendlyDate = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value) || "Not recorded";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
};

const bookingReference = (booking = {}, board = {}) =>
  clean(board.bookingRef || booking.bookingId || booking.bookingRef || booking._id);

const eventSheetAnswers = (booking = {}) => booking?.eventSheet?.answers || {};

export const buildSongSuggestionsCompletedEmail = ({ booking = {}, board = {} } = {}) => {
  const reference = bookingReference(booking, board);
  const answers = eventSheetAnswers(booking);
  const client = clean(
    board.clientFirstNames ||
      board.bookerName ||
      booking.clientName ||
      booking.userAddress?.firstNames ||
      booking.userAddress?.firstName ||
      "Not recorded",
  );
  const act = clean(
    board.actTscName ||
      board.actName ||
      booking.actTscName ||
      booking.actName ||
      booking.actsSummary?.[0]?.actName ||
      "Not recorded",
  );
  const eventDate = friendlyDate(
    board.eventDateISO || booking.eventDate || booking.date,
  );
  const songSuggestions = clean(
    answers.song_suggestions || answers.songSuggestions || "No song suggestions were entered.",
  );
  const specialRequest = clean(
    answers.first_dance_song ||
      answers.firstDanceSong ||
      answers.off_repertoire_request ||
      answers.offRepertoireRequest ||
      "None entered",
  );
  const performedBy = clean(
    answers.first_dance_performed_by || answers.firstDancePerformedBy || "Not selected",
  );
  const eventSheetUrl = buildEventSheetUrl(reference);
  const adminBase = clean(
    process.env.ADMIN_SITE_URL || "https://admin.thesupremecollective.co.uk",
  ).replace(/\/$/, "");
  const bookingBoardUrl = `${adminBase}/booking-board`;
  const subject = `Song suggestions completed · ${reference} · ${act}`;
  const text = [
    "Hi Rhona,",
    "",
    `${client} has marked the Song Suggestions section complete, so the draft setlist can now be prepared.`,
    "",
    `Booking reference: ${reference}`,
    `Act: ${act}`,
    `Event date: ${eventDate}`,
    `First dance / off-repertoire request: ${specialRequest}`,
    `Play live or use MP3: ${performedBy}`,
    "",
    "Song suggestions:",
    songSuggestions,
    "",
    `Open the editable Event Sheet: ${eventSheetUrl}`,
    `Open the Booking Board: ${bookingBoardUrl}`,
  ].join("\n");
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:720px;line-height:1.6;">
      <p>Hi Rhona,</p>
      <p><strong>${escapeEmailHtml(client)}</strong> has marked the <strong>Song Suggestions</strong> section complete, so the draft setlist can now be prepared.</p>
      <p><strong>Booking reference:</strong> ${escapeEmailHtml(reference)}<br />
      <strong>Act:</strong> ${escapeEmailHtml(act)}<br />
      <strong>Event date:</strong> ${escapeEmailHtml(eventDate)}<br />
      <strong>First dance / off-repertoire request:</strong> ${escapeEmailHtml(specialRequest)}<br />
      <strong>Play live or use MP3:</strong> ${escapeEmailHtml(performedBy)}</p>
      <p><strong>Song suggestions:</strong></p>
      <div style="white-space:pre-wrap;padding:14px;background:#f7f7f7;border-radius:10px;">${escapeEmailHtml(songSuggestions)}</div>
      <p><a href="${escapeEmailHtml(eventSheetUrl)}" style="color:#ff6667;font-weight:700;">Open the editable Event Sheet</a><br />
      <a href="${escapeEmailHtml(bookingBoardUrl)}" style="color:#ff6667;font-weight:700;">Open the Booking Board</a></p>
    </div>`;
  return { subject, text, html, eventSheetUrl, bookingBoardUrl };
};

export const sendSongSuggestionsCompletedNotification = async ({
  booking,
  board,
  emailSender = sendEmail,
} = {}) => {
  const message = buildSongSuggestionsCompletedEmail({ booking, board });
  const recipient = clean(
    process.env.EVENT_SHEET_ALERT_EMAIL ||
      process.env.ADMIN_EMAIL ||
      "hello@thesupremecollective.co.uk",
  );
  const result = await emailSender({
    to: recipient,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  if (!result?.ok) {
    throw new Error(result?.error || "The Song Suggestions completion email was rejected.");
  }
  return { ...result, recipient };
};

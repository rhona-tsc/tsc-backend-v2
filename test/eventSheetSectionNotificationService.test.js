import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSongSuggestionsCompletedEmail,
  didSongSectionBecomeComplete,
  sendSongSuggestionsCompletedNotification,
} from "../services/eventSheetSectionNotificationService.js";

test("Song Suggestions notification fires only on an incomplete-to-complete transition", () => {
  assert.equal(
    didSongSectionBecomeComplete(
      { complete: { first_dance: false } },
      { complete: { first_dance: true } },
    ),
    true,
  );
  assert.equal(
    didSongSectionBecomeComplete(
      { complete: { first_dance: true } },
      { complete: { first_dance: true } },
    ),
    false,
  );
  assert.equal(
    didSongSectionBecomeComplete(
      { complete: { first_dance: true } },
      { complete: { first_dance: false } },
    ),
    false,
  );
  assert.equal(
    didSongSectionBecomeComplete(
      { complete: { first_dance: false } },
      { complete: { song_suggestions: true } },
    ),
    true,
  );
});

test("Song Suggestions completion email contains the actionable booking details", () => {
  const email = buildSongSuggestionsCompletedEmail({
    booking: {
      bookingId: "BBM 497 DESIGN",
      eventSheet: {
        answers: {
          first_dance_song: "Show Me Love – Robin S",
          first_dance_performed_by: "Band",
          song_suggestions: "Flowers – Sweet Female Attitude\nFinally – CeCe Peniston",
        },
      },
    },
    board: {
      bookingRef: "BBM 497 DESIGN",
      clientFirstNames: "Susie",
      actTscName: "Committed to Kisstory",
      eventDateISO: "2026-10-29",
    },
  });
  assert.match(email.subject, /BBM 497 DESIGN/);
  assert.match(email.text, /Susie has marked/);
  assert.match(email.text, /Committed to Kisstory/);
  assert.match(email.text, /Flowers – Sweet Female Attitude/);
  assert.match(email.text, /event-sheet\/BBM%20497%20DESIGN/);
  assert.match(email.html, /Open the Booking Board/);
});

test("Song Suggestions completion notification is sent to the configured admin inbox", async () => {
  const previous = process.env.EVENT_SHEET_ALERT_EMAIL;
  process.env.EVENT_SHEET_ALERT_EMAIL = "rhona@example.com";
  let sent;
  const result = await sendSongSuggestionsCompletedNotification({
    booking: { bookingId: "TEST 123", eventSheet: { answers: {} } },
    board: { bookingRef: "TEST 123", clientFirstNames: "Alex" },
    emailSender: async (message) => {
      sent = message;
      return { ok: true, messageId: "message-1" };
    },
  });
  assert.equal(sent.to, "rhona@example.com");
  assert.match(sent.subject, /Song suggestions completed/);
  assert.equal(result.recipient, "rhona@example.com");
  if (previous === undefined) delete process.env.EVENT_SHEET_ALERT_EMAIL;
  else process.env.EVENT_SHEET_ALERT_EMAIL = previous;
});

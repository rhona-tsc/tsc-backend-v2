import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyBookingReply,
  resolveBookingReplyIntent,
} from "../utils/bookingReplyIntent.js";

test("recognises all three booking quick-reply labels", () => {
  assert.equal(classifyBookingReply("Yes, book me in!"), "YES");
  assert.equal(classifyBookingReply("I'm already booked!"), "NO_BOOKED");
  assert.equal(classifyBookingReply("No thanks!"), "NO_LOC");
});

test("routes a booking quick reply when Twilio omits the hidden booking code", () => {
  assert.deepEqual(
    resolveBookingReplyIntent({
      buttonText: "Yes, book me in!",
      bodyText: "Yes, book me in!",
      usedQuickReply: true,
    }),
    { looksExplicit: true, reply: "YES" },
  );
});

test("does not treat manually typed WhatsApp text as a booking button", () => {
  assert.deepEqual(
    resolveBookingReplyIntent({
      bodyText: "Yes, book me in!",
      usedQuickReply: false,
    }),
    { looksExplicit: false, reply: null },
  );
});

test("continues to route encoded booking payloads", () => {
  assert.deepEqual(
    resolveBookingReplyIntent({
      buttonPayload: "YESBOOK_1792070049807_noiset",
      usedQuickReply: true,
    }),
    { looksExplicit: true, reply: "YES" },
  );
});

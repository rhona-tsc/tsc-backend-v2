import test from "node:test";
import assert from "node:assert/strict";

import { buildIntroEmail } from "../routes/bookingBoardRoutes.js";

const buildAgentRow = (eventType) => ({
  clientEmail: "susie@example.com",
  clientFirstNames: "Susie",
  bookingRef: "BBM 497 DESIGN",
  actTscName: "Committed to Kisstory",
  eventType,
  eventDateISO: "2026-10-29",
  bookingDateISO: "2026-10-06",
  songSuggestionsDueDateISO: "2026-10-18",
  invoiceDueDateISO: "2026-10-22",
  contactRole: "agent",
});

test("agent intro email uses complete request labels without duplicating 'request'", () => {
  const cases = [
    {
      eventType: "Corporate Event",
      expected: "Song suggestions and Off Repertoire Request due on the 18 October 2026",
    },
    {
      eventType: "Wedding",
      expected: "Song suggestions and First Dance request due on the 18 October 2026",
    },
  ];

  for (const { eventType, expected } of cases) {
    const email = buildIntroEmail(buildAgentRow(eventType));

    assert.match(email.text, new RegExp(expected));
    assert.match(email.html, new RegExp(expected));
    assert.doesNotMatch(email.text, /\brequest\s+request\b/i);
    assert.doesNotMatch(email.html, /\brequest\s+request\b/i);
  }
});

test("direct-client Booking Board preview uses the complete intro template and calculated final-details date", () => {
  const email = buildIntroEmail({
    clientEmail: "james@example.com",
    clientFirstNames: "James",
    bookingRef: "260927276335",
    actTscName: "Rhythm Mystique",
    eventType: "Private Party",
    eventDateISO: "2026-11-21",
    bookingDateISO: "2026-10-21",
    songSuggestionsDueDateISO: "2026-10-30",
    invoiceDueDateISO: "2026-11-05",
    contactRole: "direct_client",
  });

  assert.match(email.text, /schedule a call with me directly in my calendar/);
  assert.match(email.text, /Song suggestions and Off Repertoire request due on the 30 October 2026/);
  assert.doesNotMatch(email.text, /\brequest\s+request\b/i);
  assert.match(email.text, /balance due on the 12 November 2026/);
  assert.match(email.html, /Follow This Link to your Event Sheet/);
  assert.match(email.html, /12 November 2026/);
});

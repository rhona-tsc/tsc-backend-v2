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

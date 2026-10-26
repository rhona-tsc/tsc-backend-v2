import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMusicianCancellationEmail,
  buildMusicianCancellationWhatsAppVariables,
} from "../routes/bookingBoardRoutes.js";

const row = {
  bookingRef: "KeCJs",
  actTscName: "The Riot Dogs",
  eventDateISO: "2027-06-05",
  address: "Tisbury",
};

test("booking cancellation email releases the date and explains a zero fee", () => {
  const email = buildMusicianCancellationEmail(row, { firstName: "Sam" }, 0);

  assert.match(email.subject, /The Riot Dogs/);
  assert.match(email.text, /5 June 2027 in Tisbury/);
  assert.match(email.text, /no cancellation fee is due/i);
  assert.match(email.text, /date is now released/i);
});

test("booking cancellation email states a positive musician cancellation payment", () => {
  const email = buildMusicianCancellationEmail(row, { firstName: "Sam" }, 125);

  assert.match(email.text, /£125\.00/);
  assert.doesNotMatch(email.text, /no cancellation fee is due/i);
});

test("booking cancellation WhatsApp variables match the approved template slots", () => {
  assert.deepEqual(
    buildMusicianCancellationWhatsAppVariables(row, { firstName: "Sam" }),
    {
      "1": "Sam",
      "2": "The Riot Dogs",
      "3": "5 June 2027",
      "4": "Tisbury",
      "5": "KeCJs",
    },
  );
});

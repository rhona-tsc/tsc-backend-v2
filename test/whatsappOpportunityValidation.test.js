import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  positiveFee,
  validateOpportunityDetails,
} from "../utils/outboundOpportunityValidation.js";

const valid = {
  actName: "Dancefloor Magic",
  date: "Thursday, 17 August 2028",
  address: "The Priests House, Skipton BD23 6AS",
  duties: "Lead Female Vocal",
  fee: "£503",
};

test("accepts a complete opportunity with a positive fee", () => {
  assert.equal(validateOpportunityDetails(valid), true);
  assert.equal(positiveFee("£503.00"), 503);
});

test("blocks missing fields, placeholders, zero and TBC fees", () => {
  for (const changes of [
    { actName: "the band" },
    { date: "TBC" },
    { address: "Location TBC" },
    { duties: "" },
    { fee: 0 },
    { fee: "£TBC" },
  ]) {
    assert.throws(
      () => validateOpportunityDetails({ ...valid, ...changes }),
      /WhatsApp message blocked/,
    );
  }
});

test("availability chasers use both approved-template SIDs and no SMS fallback", () => {
  const source = readFileSync(
    new URL("../cron/chaseAndEscalate.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /HXfda06289224c64c8821b3fb5425bf53b/);
  assert.match(source, /HXa063207c0b9e26192622293604b6dac3/);
  assert.match(source, /TWILIO_AVAILABILITY_REMINDERS_ENABLED/);
  assert.match(source, /allowSmsFallback:\s*false/);
});

test("an unclassified SMS reply stays on SMS instead of opening WhatsApp", () => {
  const source = readFileSync(
    new URL("../controllers/availabilityController.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /isWhatsApp:\s*inboundIsWhatsApp/);
  assert.match(source, /await sendSMSMessage\(/);
});


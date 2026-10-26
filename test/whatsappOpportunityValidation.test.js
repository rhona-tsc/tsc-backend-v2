import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  positiveFee,
  validateOpportunityDetails,
} from "../utils/outboundOpportunityValidation.js";
import {
  automatedEnquiryEligible,
  automatedEnquiryFollowupEligible,
  validAvailabilityRecipientName,
} from "../utils/enquiryAutomationEligibility.js";

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
  assert.match(
    source,
    /!row\.firstAvailabilityReminderSentAt && ageHours >= 24[\s\S]*hoursSinceFirst >= 24[\s\S]*hoursSinceSecond >= 24/,
  );
});

test("automated enquiry messaging excludes stale, past-date and test records", () => {
  const now = new Date("2026-10-26T19:00:00Z").getTime();
  const current = {
    actName: "Motown Luxe",
    dateISO: "2028-08-17",
    createdAt: "2026-10-23T15:03:31Z",
  };

  assert.equal(automatedEnquiryEligible(current, now), true);
  assert.equal(
    automatedEnquiryEligible({ ...current, createdAt: "2026-05-11T16:48:10Z" }, now),
    false,
  );
  assert.equal(
    automatedEnquiryEligible({ ...current, dateISO: "2026-09-19" }, now),
    false,
  );
  assert.equal(
    automatedEnquiryEligible({ ...current, actName: "Test Soul Allegiance" }, now),
    false,
  );
  assert.equal(
    automatedEnquiryFollowupEligible(
      { ...current, createdAt: "2026-10-14T19:00:00Z" },
      now,
    ),
    true,
  );
  assert.equal(
    automatedEnquiryFollowupEligible(
      { ...current, createdAt: "2026-05-11T16:48:10Z" },
      now,
    ),
    false,
  );
});

test("client follow-ups stop when an enquiry has converted to a booking", () => {
  const source = readFileSync(
    new URL("../services/enquiryFollowupService.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /ACTIVE_ENQUIRY_STATUSES/);
  assert.match(source, /BookingBoardItem\.exists/);
  assert.match(source, /Booking\.exists/);
  assert.ok((source.match(/enquiryHasConvertedToBooking\(\{ enquiry, rows \}\)/g) || []).length >= 3);
  assert.match(source, /runEnquiryDaySixFollowups/);
  assert.match(source, /clientDaySixEmailSentAt/);
});

test("availability reminders reject missing and placeholder recipient names", () => {
  assert.equal(validAvailabilityRecipientName("Mari Songs"), true);
  assert.equal(validAvailabilityRecipientName(""), false);
  assert.equal(validAvailabilityRecipientName("TBC"), false);
});

test("an unclassified SMS reply stays on SMS instead of opening WhatsApp", () => {
  const source = readFileSync(
    new URL("../controllers/availabilityController.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /isWhatsApp:\s*inboundIsWhatsApp/);
  assert.match(source, /await sendSMSMessage\(/);
  assert.match(
    source,
    /bookingLooksExplicit && !inboundIsWhatsApp/,
  );
  assert.match(source, /if \(bookingMsg\) \{/);
});


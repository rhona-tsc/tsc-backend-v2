import test from "node:test";
import assert from "node:assert/strict";
import { availableVocalistsForLineup } from "../utils/enquiryAvailability.js";
import { buildEnquiryDayTwoEmail } from "../services/enquiryFollowupService.js";

const twoVocalistLineup = {
  bandMembers: [
    { instrument: "Lead Female Vocal", email: "a@example.com" },
    { instrument: "Lead Male Vocal / Rapper", email: "b@example.com" },
    { instrument: "Drums", email: "c@example.com" },
  ],
};

test("a two-vocalist lineup is held until both slots have a yes", () => {
  const oneCovered = availableVocalistsForLineup(
    [{ slotIndex: 0, reply: "yes", musicianName: "Alex One" }],
    twoVocalistLineup,
  );
  assert.equal(oneCovered.complete, false);
  assert.deepEqual(oneCovered.requiredSlots, [0, 1]);

  const bothCovered = availableVocalistsForLineup(
    [
      { slotIndex: 0, reply: "yes", musicianName: "Alex One" },
      { slotIndex: 1, reply: "yes", musicianName: "Bill Two" },
    ],
    twoVocalistLineup,
  );
  assert.equal(bothCovered.complete, true);
  assert.equal(bothCovered.selected.length, 2);
});

test("Day 2 email includes the first vocalist and later available alternatives", () => {
  const lineup = { bandMembers: [{ instrument: "Lead Female Vocal" }] };
  const summary = availableVocalistsForLineup(
    [
      { slotIndex: 0, reply: "yes", musicianName: "Mari Songs", repliedAt: "2026-10-23T10:00:00Z" },
      { slotIndex: 0, reply: "yes", musicianName: "Rachel Francis", repliedAt: "2026-10-23T11:00:00Z", isDeputy: true },
      { slotIndex: 0, reply: "yes", musicianName: "Shamyra Abbott", repliedAt: "2026-10-24T12:00:00Z", isDeputy: true },
    ],
    lineup,
  );
  const email = buildEnquiryDayTwoEmail({
    enquiry: {
      clientName: "Narelle Beckley-Perry",
      actTscName: "Committed to Kisstory",
      eventDateISO: "2028-08-17",
      address: "The Priests House",
    },
    act: { name: "Committed to Kisstory", slug: "committed-to-kisstory" },
    summary,
  });
  assert.match(email.text, /Mari S/);
  assert.match(email.text, /Rachel F/);
  assert.match(email.text, /Shamyra A/);
  assert.match(email.html, /TSC_Signature_2026/);
  assert.match(email.html, /google-5-star-reviews/);
  assert.match(email.html, /Company Number: 16883956/);
  assert.match(email.html, /instagram\.com\/thesupremecollective/);
});


import test from "node:test";
import assert from "node:assert/strict";
import { availableVocalistsForLineup } from "../utils/enquiryAvailability.js";
import { buildEnquiryDayTwoEmail } from "../services/enquiryFollowupService.js";
import { buildTscEmailFooter } from "../utils/tscEmailBranding.js";

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
      {
        slotIndex: 0,
        reply: "yes",
        musicianName: "Mari Songs",
        repliedAt: "2026-10-23T10:00:00Z",
        profileUrl: "https://thesupremecollective.co.uk/musician/mari-s",
        photoUrl: "https://images.example.com/mari.jpg",
        videos: [{ title: "Mari live", url: "https://youtu.be/mari" }],
      },
      {
        slotIndex: 0,
        reply: "yes",
        musicianName: "Rachel Francis",
        repliedAt: "2026-10-23T11:00:00Z",
        isDeputy: true,
        profileUrl: "https://thesupremecollective.co.uk/musician/rachel-f",
        photoUrl: "https://images.example.com/rachel.jpg",
        videos: [{ title: "Rachel live", url: "https://youtu.be/rachel" }],
      },
      {
        slotIndex: 0,
        reply: "yes",
        musicianName: "Shamyra Abbott",
        repliedAt: "2026-10-24T12:00:00Z",
        isDeputy: true,
        profileUrl: "https://thesupremecollective.co.uk/musician/shamyra-a",
        photoUrl: "https://images.example.com/shamyra.jpg",
        videos: [{ title: "Shamyra live", url: "https://youtu.be/shamyra" }],
      },
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
  assert.match(email.html, /Introducing Mari S/);
  assert.match(email.html, /Introducing Rachel F/);
  assert.match(email.html, /Introducing Shamyra A/);
  assert.match(email.html, /images\.example\.com\/rachel\.jpg/);
  assert.match(email.html, /youtu\.be\/shamyra/);
  assert.match(email.html, /band's <em>other deputy<\/em> vocalists/);
  assert.match(email.html, /selecting your preferred deputy/);
  assert.match(email.html, /simply by replying to this email/);
  assert.match(email.text, /band's other deputy vocalists/);
  assert.match(email.html, /TSC_Signature_2026/);
  assert.match(email.html, /google-5-star-reviews/);
  assert.match(email.html, /Company Number: 16883956/);
  assert.match(email.html, /instagram\.com\/thesupremecollective/);
});

test("email footer stacks the Google rating above the WhatsApp button", () => {
  const footer = buildTscEmailFooter();
  const googleRating = footer.indexOf("google-5-star-reviews.png");
  const whatsappButton = footer.indexOf("Chat on WhatsApp");

  assert.ok(googleRating >= 0);
  assert.ok(whatsappButton > googleRating);
  assert.match(
    footer.slice(googleRating, whatsappButton),
    /text-align:center;/,
  );
});


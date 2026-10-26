import test from "node:test";
import assert from "node:assert/strict";
import { availableVocalistsForLineup } from "../utils/enquiryAvailability.js";
import {
  buildEnquiryDaySixEmail,
  buildEnquiryDayFourEmail,
  buildEnquiryDayTwoEmail,
} from "../services/enquiryFollowupService.js";
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

test("Day 2 email omits slot labels when exactly one vocalist is available per slot", () => {
  const summary = availableVocalistsForLineup(
    [
      { slotIndex: 0, reply: "yes", musicianName: "Annie Afrilu", isDeputy: true },
      { slotIndex: 1, reply: "yes", musicianName: "Rachel Francis" },
    ],
    twoVocalistLineup,
  );
  const email = buildEnquiryDayTwoEmail({
    enquiry: {
      clientName: "Narelle Beckley-Perry",
      actTscName: "Motown Luxe",
      eventDateISO: "2028-08-17",
      address: "The Priests House",
    },
    act: { name: "Motown Luxe", slug: "motown-luxe" },
    summary,
  });

  assert.match(email.html, /For this Motown Luxe lineup/);
  assert.doesNotMatch(email.html, /Vocal slot 1/);
  assert.match(email.html, /Introducing Annie A/);
  assert.doesNotMatch(email.html, /Vocal slot 2/);
  assert.match(email.html, /Introducing Rachel F/);
  assert.match(email.html, /proceeding to checkout or you’re also welcome/);
  assert.doesNotMatch(email.html, /preferred vocalist for each slot/);
  assert.doesNotMatch(email.html, /other deputy vocalists/);
});

test("Day 2 email keeps slot labels when a slot has multiple vocalist options", () => {
  const summary = availableVocalistsForLineup(
    [
      { slotIndex: 0, reply: "yes", musicianName: "Annie Afrilu", isDeputy: true },
      { slotIndex: 0, reply: "yes", musicianName: "Mari Songs", isDeputy: true },
      { slotIndex: 1, reply: "yes", musicianName: "Rachel Francis" },
    ],
    twoVocalistLineup,
  );
  const email = buildEnquiryDayTwoEmail({
    enquiry: {
      clientName: "Narelle Beckley-Perry",
      actTscName: "Motown Luxe",
      eventDateISO: "2028-08-17",
      address: "The Priests House",
    },
    act: { name: "Motown Luxe", slug: "motown-luxe" },
    summary,
  });

  assert.match(email.html, /Vocal slot 1/);
  assert.match(email.html, /Vocal slot 2/);
  assert.match(email.html, /preferred vocalist for each slot/);
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
  assert.match(email.html, /band(?:'|&#39;)s other deputy vocalists/);
  assert.doesNotMatch(email.html, /<em>other deputy<\/em>/);
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

test("Day 4 email gives a clear availability reminder and booking action", () => {
  const lineup = { bandMembers: [{ instrument: "Lead Female Vocal" }] };
  const summary = availableVocalistsForLineup(
    [
      { slotIndex: 0, reply: "yes", musicianName: "Mari Songs" },
      { slotIndex: 0, reply: "yes", musicianName: "Rachel Francis" },
    ],
    lineup,
  );
  summary.all.forEach((row, index) => {
    row.profileUrl = `https://thesupremecollective.co.uk/musician/test-${index + 1}`;
    row.photoUrl = `https://res.cloudinary.com/example/test-${index + 1}.jpg`;
  });
  const email = buildEnquiryDayFourEmail({
    enquiry: {
      clientName: "Narelle Beckley-Perry",
      actTscName: "Committed to Kisstory",
      eventDateISO: "2028-08-17",
      address: "The Priests House",
    },
    act: { name: "Committed to Kisstory", slug: "committed-to-kisstory" },
    summary,
  });

  assert.match(email.subject, /availability update/i);
  assert.match(email.html, /Mari S and Rachel F/);
  assert.match(email.html, /View Profile/);
  assert.match(email.html, /high number of enquiries/);
  assert.match(email.html, /booked elsewhere/);
  assert.match(email.html, /avoid disappointment/);
  assert.match(email.html, /View Committed to Kisstory and book/);
  assert.match(email.html, /TSC_Signature_2026/);
});

test("Day 6 email offers tailored package options without claiming fixed extras", () => {
  const summary = availableVocalistsForLineup(
    [{ slotIndex: 0, reply: "yes", musicianName: "Mari Songs" }],
    { bandMembers: [{ instrument: "Lead Female Vocal" }] },
  );
  const email = buildEnquiryDaySixEmail({
    enquiry: {
      clientName: "Narelle Beckley-Perry",
      actTscName: "Committed to Kisstory",
      eventDateISO: "2028-08-17",
      address: "The Priests House",
    },
    act: { name: "Committed to Kisstory", slug: "committed-to-kisstory" },
    summary,
  });

  assert.match(email.subject, /tailoring your Committed to Kisstory package/i);
  assert.match(email.html, /fuller or more tailored package/i);
  assert.match(email.html, /larger lineup/i);
  assert.match(email.html, /extra live performance time/i);
  assert.match(email.html, /special song requests/i);
  assert.match(email.html, /Explore Committed to Kisstory and package options/);
  assert.match(email.html, /TSC_Signature_2026/);
});


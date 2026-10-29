import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClientAutomationDigest,
  sendClientAutomationDigest,
} from "../services/clientAutomationDigestService.js";
import { AUTOMATION_16_KEY } from "../services/clientAutomationService.js";

const georgia = {
  _id: "georgia-booking",
  bookingRef: "260915275050",
  clientFirstNames: "Georgia",
  clientEmail: "georgia.hyndman@ukimediaevents.com",
  actName: "Rhythm Mystique",
  eventDateISO: "2026-12-10",
  songSuggestionsDueDateISO: "2026-11-10",
  invoiceDueDateISO: "2026-12-03",
  introEmailSentAt: new Date("2026-10-28T20:02:44.876Z"),
  siteAutomationsEnabled: true,
  bookingStatus: "active",
};

const susie = {
  _id: "susie-booking",
  bookingRef: "BBM 497 DESIGN",
  clientFirstNames: "Susie",
  clientEmail: "susie@tigproductions.co.uk",
  actName: "The Live Act",
  eventDateISO: "2026-12-20",
  songSuggestionsDueDateISO: "2026-11-20",
  invoiceDueDateISO: "2026-12-13",
  siteAutomationsEnabled: true,
  bookingStatus: "active",
};

test("daily digest keeps Georgia in preview and puts live bookings first", () => {
  const digest = buildClientAutomationDigest({
    rows: [georgia, susie],
    deliveries: [{
      bookingId: georgia._id,
      automationKey: AUTOMATION_16_KEY,
      status: "sent",
      sentAt: new Date("2026-11-03T09:05:00.000Z"),
    }],
    todayISO: "2026-10-29",
  });

  assert.equal(digest.bookingCount, 2);
  assert.equal(digest.bookings[0].allowlisted, true);
  assert.equal(digest.bookings[0].bookingRef, "BBM 497 DESIGN");
  assert.equal(digest.bookings[1].allowlisted, false);
  assert.equal(digest.bookings[1].bookingRef, "260915275050");
  assert.match(digest.subject, /2 upcoming gigs/);
  assert.match(digest.text, /Rhythm Mystique/);
  assert.match(digest.text, /260915275050/);
  assert.match(digest.text, /Automation 16.*Sent 3rd November 2026/);
  assert.ok(digest.text.indexOf("LIVE allowlist") < digest.text.indexOf("Preview only"));
  assert.ok(digest.html.indexOf("LIVE allowlist") < digest.html.indexOf("Preview only"));
});

test("daily digest sends once per London calendar day", async () => {
  let ledger;
  const digestModel = {
    findOne: async () => ledger || null,
    create: async (value) => {
      ledger = { ...value, save: async () => {} };
      return ledger;
    },
  };
  const bookingModel = {
    find: () => ({
      sort: () => ({ lean: async () => [georgia] }),
    }),
  };
  const deliveryModel = {
    find: () => ({ lean: async () => [] }),
  };
  const sent = [];
  const options = {
    now: new Date("2026-10-29T08:00:00.000Z"),
    bookingModel,
    deliveryModel,
    digestModel,
    emailSender: async (message) => {
      sent.push(message);
      return { ok: true, messageId: "digest-message" };
    },
  };

  const first = await sendClientAutomationDigest(options);
  const second = await sendClientAutomationDigest(options);

  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(second.reason, "already_processed");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "rhona@thesupremecollective.co.uk");
  assert.equal(ledger.status, "sent");
});

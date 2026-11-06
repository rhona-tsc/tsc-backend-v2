import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClientAutomationDigest,
  sendClientAutomationDigest,
} from "../services/clientAutomationDigestService.js";
import {
  AUTOMATION_16_KEY,
  clientAutomationAllowlistSnapshot,
} from "../services/clientAutomationService.js";

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

test("FireAngel is included in both live automation allowlists", () => {
  const allowlist = clientAutomationAllowlistSnapshot();
  assert.equal(allowlist.emails.has("reception@fireangeltech.com"), true);
  assert.equal(allowlist.bookingRefs.has("260922275836"), true);
});

test("Megan is included in both live automation allowlists", () => {
  const allowlist = clientAutomationAllowlistSnapshot();
  assert.equal(allowlist.emails.has("meganltompkins2716@hotmail.com"), true);
  assert.equal(allowlist.bookingRefs.has("260115241436"), true);
});

test("Sarah is included in both live automation allowlists", () => {
  const allowlist = clientAutomationAllowlistSnapshot();
  assert.equal(allowlist.emails.has("sarah.murphy11@hotmail.co.uk"), true);
  assert.equal(allowlist.bookingRefs.has("261011277662"), true);
});

test("daily digest recognises Georgia and Susie as live allowlisted bookings", () => {
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
  assert.equal(digest.bookings[0].bookingRef, "260915275050");
  assert.equal(digest.bookings[1].allowlisted, true);
  assert.equal(digest.bookings[1].bookingRef, "BBM 497 DESIGN");
  assert.match(digest.subject, /2 bookings/);
  assert.match(digest.text, /Rhythm Mystique/);
  assert.match(digest.text, /260915275050/);
  assert.match(digest.text, /Automation 16.*Sent 3rd November 2026/);
  assert.doesNotMatch(digest.text, /Preview only/);
  assert.doesNotMatch(digest.html, /Preview only/);
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


test("Encore booking keeps its mixed-case reference and is live without original balance reminders", () => {
  const allowlist = clientAutomationAllowlistSnapshot();
  assert.equal(allowlist.emails.has("sue_young1576@hotmail.com"), true);
  assert.equal(allowlist.bookingRefs.has("UUZfW"), true);
  const digest = buildClientAutomationDigest({
    rows: [{ ...susie, bookingRef: "UUZfW", clientEmail: "sue_young1576@hotmail.com", agent: "Encore" }],
    todayISO: "2026-11-06",
  });
  assert.equal(digest.bookings[0].allowlisted, true);
  for (const number of [10, 11]) {
    assert.match(digest.bookings[0].automations.find(item => item.number === number).status, /payment arranged through Encore/);
  }
});

test('daily digest includes the three booking review requests after the event',()=>{
 const row={_id:'sarah-review-plan',bookingRef:'UUZfW',clientEmail:'sue_young1576@hotmail.com',eventDateISO:'2026-12-31',eventType:'Birthday Party',reviewRequestPlan:{enabled:true,exclusive:true,items:[{automationNumber:13,offsetDays:3},{automationNumber:15,offsetDays:10},{automationNumber:3,offsetDays:17}]}};
 const digest=buildClientAutomationDigest({rows:[row],deliveries:[],todayISO:'2027-01-03'});
 const reviews=digest.bookings[0].automations.filter(item=>[13,15,3].includes(item.number));
 assert.deepEqual(reviews.map(item=>item.plannedISO),['2027-01-03','2027-01-10','2027-01-17']);
 assert.equal(reviews[0].status,'DUE NOW');
 assert.ok(!digest.bookings[0].automations.some(item=>[10,11,14,16,21].includes(item.number)));
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTOMATION_4_KEY,
  automation4Schedule,
  automation10Schedule,
  buildAutomation4Email,
  buildAutomation10Email,
  londonTodayISO,
  runClientAutomations,
} from "../services/clientAutomationService.js";

test("Automation 10 catches up before the invoice deadline", () => {
  const result = automation10Schedule(
    { invoiceDueDateISO: "2026-10-22" },
    "2026-10-17",
  );
  assert.deepEqual(result, {
    eligible: true,
    reason: "catch_up",
    plannedISO: "2026-10-15",
    sendISO: "2026-10-17",
  });
});

test("Automation 10 never catches up on or after the invoice deadline", () => {
  assert.equal(
    automation10Schedule({ invoiceDueDateISO: "2026-10-22" }, "2026-10-22").eligible,
    false,
  );
  assert.equal(
    automation10Schedule({ invoiceDueDateISO: "2026-10-22" }, "2026-10-23").reason,
    "deadline_reached",
  );
});

test("vocalist setlist automation catches up after the song-request deadline but not after the event", () => {
  assert.deepEqual(
    automation4Schedule(
      {
        songSuggestionsDueDateISO: "2026-10-13",
        eventDateISO: "2026-10-29",
      },
      "2026-10-16",
    ),
    {
      eligible: true,
      reason: "catch_up",
      plannedISO: "2026-10-14",
      sendISO: "2026-10-16",
    },
  );
  assert.equal(
    automation4Schedule(
      {
        songSuggestionsDueDateISO: "2026-10-13",
        eventDateISO: "2026-10-29",
      },
      "2026-10-29",
    ).reason,
    "event_reached",
  );
});

test("vocalist setlist email uses the two operational links and vocalist first names", () => {
  const email = buildAutomation4Email({
    bookingRef: "BBM 497 DESIGN",
    clientFirstNames: "Susie",
    eventType: "Corporate Event",
    eventDateISO: "2026-10-29",
    draftSetlistLink: "https://example.com/setlist",
    whatsappGroupLink: "https://chat.whatsapp.com/example",
    assignedMusicians: [
      { name: "Koko Clay", email: "koko@example.com", role: "Lead Female Vocal" },
      { firstName: "Rya", email: "rya@example.com", instrument: "Lead Male Vocal / Rapper" },
      { name: "Ewan McIntosh", email: "ewan@example.com", role: "Bass Guitar" },
    ],
  });
  assert.match(email.text, /Hi Koko & Rya,/);
  assert.match(email.text, /https:\/\/example\.com\/setlist/);
  assert.match(email.text, /https:\/\/chat\.whatsapp\.com\/example/);
  assert.deepEqual(email.recipients, ["koko@example.com", "rya@example.com"]);
});

test("Automation 10 email uses the editable event sheet and an ordinal deadline", () => {
  const email = buildAutomation10Email({
    bookingRef: "BBM 497 DESIGN",
    clientFirstNames: "Susie",
    invoiceDueDateISO: "2026-10-22",
    bookingDetails: { djServicesBooked: false },
  });
  assert.match(email.text, /Hi Susie,/);
  assert.match(email.text, /22nd October 2026/);
  assert.match(email.text, /event-sheet\/BBM%20497%20DESIGN/);
  assert.doesNotMatch(email.text, /advance DJ requests/);
  assert.match(email.text, /issued invoice is attached/);
});

test("London automation dates use the configured business timezone", () => {
  assert.equal(londonTodayISO(new Date("2026-10-16T23:30:00.000Z")), "2026-10-17");
});

test("the staged runner sends Automation 10 only to the allowlisted booking with its invoice", async () => {
  const previous = {
    enabled: process.env.CLIENT_AUTOMATIONS_ENABLED,
    emails: process.env.CLIENT_AUTOMATION_EMAIL_ALLOWLIST,
    refs: process.env.CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST,
    notBefore: process.env.CLIENT_AUTOMATIONS_NOT_BEFORE,
  };
  process.env.CLIENT_AUTOMATIONS_ENABLED = "true";
  process.env.CLIENT_AUTOMATION_EMAIL_ALLOWLIST = "susie@tigproductions.co.uk";
  process.env.CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST = "BBM 497 DESIGN";
  process.env.CLIENT_AUTOMATIONS_NOT_BEFORE = "2026-10-17";

  const row = {
    _id: "booking-id",
    bookingRef: "BBM 497 DESIGN",
    clientFirstNames: "Susie",
    clientEmail: "susie@tigproductions.co.uk",
    invoiceDueDateISO: "2026-10-22",
    siteAutomationsEnabled: true,
    balancePaid: false,
  };
  let query;
  const bookingModel = {
    find(value) {
      query = value;
      return { lean: async () => [row] };
    },
  };
  let deliveryRecord;
  const deliveryModel = {
    findOne: async () => deliveryRecord,
    create: async (value) => {
      deliveryRecord = { ...value, save: async () => {} };
      return deliveryRecord;
    },
  };
  const sent = [];
  const summary = await runClientAutomations({
    now: new Date("2026-10-17T09:05:00.000Z"),
    bookingModel,
    deliveryModel,
    attachmentBuilder: async () => [{ filename: "invoice.pdf", content: Buffer.from("pdf") }],
    emailSender: async (message) => {
      sent.push(message);
      return { ok: true, messageId: "message-1" };
    },
  });

  assert.equal(summary.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "susie@tigproductions.co.uk");
  assert.equal(sent[0].attachments[0].filename, "invoice.pdf");
  assert.deepEqual(query.bookingRef, { $in: ["BBM 497 DESIGN"] });
  assert.equal(deliveryRecord.status, "sent");

  Object.entries(previous).forEach(([key, value]) => {
    const envKey = {
      enabled: "CLIENT_AUTOMATIONS_ENABLED",
      emails: "CLIENT_AUTOMATION_EMAIL_ALLOWLIST",
      refs: "CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST",
      notBefore: "CLIENT_AUTOMATIONS_NOT_BEFORE",
    }[key];
    if (value === undefined) delete process.env[envKey];
    else process.env[envKey] = value;
  });
});

test("vocalist setlist automation alerts once while links are missing, then sends on the next run", async () => {
  const previous = {
    enabled: process.env.CLIENT_AUTOMATIONS_ENABLED,
    emails: process.env.CLIENT_AUTOMATION_EMAIL_ALLOWLIST,
    refs: process.env.CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST,
    notBefore: process.env.CLIENT_AUTOMATIONS_NOT_BEFORE,
    alertEmail: process.env.CLIENT_AUTOMATION_ALERT_EMAIL,
  };
  process.env.CLIENT_AUTOMATIONS_ENABLED = "true";
  process.env.CLIENT_AUTOMATION_EMAIL_ALLOWLIST = "susie@tigproductions.co.uk";
  process.env.CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST = "BBM 497 DESIGN";
  process.env.CLIENT_AUTOMATIONS_NOT_BEFORE = "2026-10-16";
  process.env.CLIENT_AUTOMATION_ALERT_EMAIL = "rhona@example.com";

  const row = {
    _id: "booking-id",
    bookingRef: "BBM 497 DESIGN",
    clientFirstNames: "Susie",
    clientEmail: "susie@tigproductions.co.uk",
    eventType: "Corporate Event",
    eventDateISO: "2026-10-29",
    songSuggestionsDueDateISO: "2026-10-13",
    invoiceDueDateISO: "2026-10-22",
    siteAutomationsEnabled: true,
    balancePaid: true,
    assignedMusicians: [
      { name: "Koko Clay", email: "koko@example.com", role: "Lead Female Vocal" },
      { name: "Rya Pink", email: "rya@example.com", role: "Lead Male Vocal" },
    ],
    draftSetlistLink: "",
    whatsappGroupLink: "",
  };
  const bookingModel = {
    find() {
      return { lean: async () => [row] };
    },
  };
  const records = new Map();
  const deliveryModel = {
    findOne: async ({ automationKey, bookingId }) => records.get(`${automationKey}|${bookingId}`) || null,
    create: async (value) => {
      const record = { ...value, save: async () => {} };
      records.set(`${value.automationKey}|${value.bookingId}`, record);
      return record;
    },
  };
  const sent = [];
  const emailSender = async (message) => {
    sent.push(message);
    return { ok: true, messageId: `message-${sent.length}` };
  };
  const options = {
    now: new Date("2026-10-16T09:05:00.000Z"),
    bookingModel,
    deliveryModel,
    attachmentBuilder: async () => [],
    emailSender,
  };

  const first = await runClientAutomations(options);
  assert.equal(first.blocked, 1);
  assert.equal(first.alertsSent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "rhona@example.com");
  assert.match(sent[0].subject, /Automation held/);
  assert.match(sent[0].text, /Draft setlist link and WhatsApp group link/);

  const second = await runClientAutomations(options);
  assert.equal(second.blocked, 1);
  assert.equal(second.alertsSent, 0);
  assert.equal(sent.length, 1);

  row.draftSetlistLink = "https://example.com/setlist";
  row.whatsappGroupLink = "https://chat.whatsapp.com/example";
  const third = await runClientAutomations(options);
  assert.equal(third.sent, 1);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].to, ["koko@example.com", "rya@example.com"]);
  assert.equal(records.get(`${AUTOMATION_4_KEY}|booking-id`).status, "sent");

  const envKeys = {
    enabled: "CLIENT_AUTOMATIONS_ENABLED",
    emails: "CLIENT_AUTOMATION_EMAIL_ALLOWLIST",
    refs: "CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST",
    notBefore: "CLIENT_AUTOMATIONS_NOT_BEFORE",
    alertEmail: "CLIENT_AUTOMATION_ALERT_EMAIL",
  };
  Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) delete process.env[envKeys[key]];
    else process.env[envKeys[key]] = value;
  });
});

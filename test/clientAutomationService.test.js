import test from "node:test";
import assert from "node:assert/strict";

import {
  automation10Schedule,
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

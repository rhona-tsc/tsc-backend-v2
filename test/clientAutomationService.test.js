import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTOMATION_4_KEY,
  AUTOMATION_10_KEY,
  AUTOMATION_11_KEY,
  AUTOMATION_14_KEY,
  AUTOMATION_16_KEY,
  AUTOMATION_21_KEY,
  AUTOMATION_30_KEY,
  AUTOMATION_26_KEY,
  actAddOnOptions,
  automation4Schedule,
  automation10Schedule,
  automation11Schedule,
  automation14Schedule,
  automation16Schedule,
  automation21Schedule,
  automation30Schedule,
  automation26Schedule,
  buildAutomation4Email,
  buildAutomation10Email,
  buildAutomation11Email,
  buildAutomation21Email,
  buildAutomation30Email,
  buildAutomation26Email,
  londonTodayISO,
  runClientAutomations,
} from "../services/clientAutomationService.js";

test("Automation 30 starts from a non-Google review and stops after a Google review", () => {
  const pending = automation30Schedule({
    review: {
      source: "other",
      comment: "The band were brilliant.",
      nonGoogleReceivedAt: "2026-10-27T10:15:00.000Z",
    },
  }, "2026-10-27");
  assert.equal(pending.eligible, true);
  assert.equal(pending.sendISO, "2026-10-27");

  const completed = automation30Schedule({
    review: {
      source: "other",
      comment: "The band were brilliant.",
      nonGoogleReceivedAt: "2026-10-27T10:15:00.000Z",
      googleReceivedAt: "2026-10-27T11:00:00.000Z",
    },
  }, "2026-10-27");
  assert.equal(completed.eligible, false);
  assert.equal(completed.reason, "google_review_received");
});

test("Automation 30 includes the saved review and booked act", () => {
  const email = buildAutomation30Email({
    clientFirstNames: "Susie",
    actTscName: "Committed to Kisstory",
    review: { comment: "The band were brilliant." },
  });
  assert.match(email.text, /Hi Susie,/);
  assert.match(email.text, /Committed to Kisstory/);
  assert.match(email.text, /The band were brilliant\./);
  assert.match(email.text, /Google Review/);
  assert.equal(AUTOMATION_30_KEY, "automation-30-non-google-review-followup");
});

test("Automation 26 runs five days after Automation 30 unless a Google review arrives", () => {
  const row = {
    review: { source: "other", comment: "The band were brilliant." },
  };
  const automation30Delivery = {
    status: "sent",
    sentAt: "2026-10-27T10:15:00.000Z",
  };
  assert.equal(
    automation26Schedule(row, "2026-10-31", automation30Delivery).reason,
    "not_due",
  );
  assert.deepEqual(
    automation26Schedule(row, "2026-11-01", automation30Delivery),
    {
      eligible: true,
      reason: "planned_date",
      plannedISO: "2026-11-01",
      sendISO: "2026-11-01",
    },
  );
  assert.equal(
    automation26Schedule({
      review: {
        ...row.review,
        googleReceivedAt: "2026-10-30T09:00:00.000Z",
      },
    }, "2026-11-01", automation30Delivery).reason,
    "google_review_received",
  );
});

test("Automation 26 repeats the saved review in its reminder", () => {
  const email = buildAutomation26Email({
    clientFirstNames: "Susie",
    actTscName: "Committed to Kisstory",
    review: { comment: "The band were brilliant." },
  });
  assert.match(email.text, /Hi Susie,/);
  assert.match(email.text, /The band were brilliant\./);
  assert.match(email.text, /Committed to Kisstory/);
  assert.equal(AUTOMATION_26_KEY, "automation-26-google-review-reminder");
});

test("Susie's reviewed automation dates resolve to the staged live schedule", () => {
  const row = {
    songSuggestionsDueDateISO: "2026-10-18",
    invoiceDueDateISO: "2026-10-22",
    eventDateISO: "2026-10-29",
    introEmailSentAt: new Date("2026-10-16T12:00:00.000Z"),
  };
  assert.equal(automation16Schedule(row, "2026-10-17").sendISO, "2026-10-17");
  assert.equal(automation14Schedule(row, "2026-10-18").sendISO, "2026-10-18");
  assert.equal(automation21Schedule(row, "2026-10-19").sendISO, "2026-10-19");
  assert.equal(automation11Schedule(row, "2026-10-22").sendISO, "2026-10-22");
});

test("Automation 21 names the booked act while using the linked act's add-on pricing", () => {
  const row = {
    clientFirstNames: "Georgia",
    actName: "Rhythm Mystique",
    actTscName: "Dancefloor Magic",
    eventType: "Wedding",
    lineupSelected: "6-Piece",
    actData: {
      tscName: "Dancefloor Magic",
      extras: {
        extra_30min_performance_per_band_member: { price: 50 },
      },
    },
  };

  const email = buildAutomation21Email(row);

  assert.match(email.text, /choosing Rhythm Mystique/);
  assert.match(email.text, /Add-ons available for Rhythm Mystique/);
  assert.match(email.text, /Additional 30-minute performance \(6-piece\): £399/);
  assert.doesNotMatch(email.text, /choosing Dancefloor Magic/);
});

test("the due-now balance email omits DJ requests when no DJ was booked", () => {
  const email = buildAutomation11Email({
    bookingRef: "BBM 497 DESIGN",
    clientFirstNames: "Susie",
    bookingDetails: { djServicesBooked: false },
  });
  assert.doesNotMatch(email.text, /Advanced DJ requests/);
  assert.match(email.text, /invoice attached/);
});

test("act add-on options apply lineup, county travel and commission pricing", () => {
  const options = actAddOnOptions({
    actTscName: "Committed to Kisstory",
    county: "Greater London",
    lineupComposition: ["Vocal", "Vocal", "Bass", "Guitar", "Keys", "Drums"],
    actData: {
      countyFees: { greater_london: 60 },
      extras: {
        extra_60min_performance_per_band_member: { price: 100 },
        speedy_setup_60mins_roadie_and_engineer_duties_only_travel_added_on_top_later_for_additional_team_member: { price: 200 },
        wireless_mic_for_speeches: { price: 75 },
      },
    },
  });
  assert.match(options, /Additional 60-minute performance \(6-piece\): £798/);
  assert.match(options, /Speedy 60-minute setup and soundcheck: £346/);
  assert.match(options, /Wireless microphone hire for speeches: £133/);
});

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
    bandEventSheetUrl: "https://backend.example.com/api/booking/band-sheet/secure-token",
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
  assert.match(email.text, /https:\/\/backend\.example\.com\/api\/booking\/band-sheet\/secure-token/);
  assert.doesNotMatch(email.text, /event-sheet\/BBM%20497%20DESIGN/);
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
  assert.deepEqual(query.bookingRef, {
    $in: ["BBM 497 DESIGN", "260927276335"],
  });
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

test("the staged runner sends Susie's six live rules once on their reviewed dates", async () => {
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
    _id: "susie-booking",
    bookingRef: "BBM 497 DESIGN",
    clientFirstNames: "Susie",
    clientEmail: "susie@tigproductions.co.uk",
    actTscName: "Committed to Kisstory",
    eventType: "Corporate Event",
    eventDateISO: "2026-10-29",
    songSuggestionsDueDateISO: "2026-10-18",
    invoiceDueDateISO: "2026-10-22",
    introEmailSentAt: new Date("2026-10-16T12:00:00.000Z"),
    siteAutomationsEnabled: true,
    balancePaid: false,
    lineupComposition: ["Vocal", "Vocal", "Bass", "Guitar", "Keys", "Drums"],
    actData: { extras: { wireless_mic_for_speeches: { price: 100 } } },
  };
  const bookingModel = { find: () => ({ lean: async () => [row] }) };
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
  const options = {
    bookingModel,
    deliveryModel,
    attachmentBuilder: async () => [{ filename: "invoice.pdf", content: Buffer.from("pdf") }],
    emailSender: async (message) => {
      sent.push(message);
      return { ok: true, messageId: `message-${sent.length}` };
    },
  };

  await runClientAutomations({ ...options, now: new Date("2026-10-17T09:05:00.000Z") });
  await runClientAutomations({ ...options, now: new Date("2026-10-18T09:05:00.000Z") });
  await runClientAutomations({ ...options, now: new Date("2026-10-19T09:05:00.000Z") });
  await runClientAutomations({ ...options, now: new Date("2026-10-22T09:05:00.000Z") });

  assert.deepEqual([...records.keys()].sort(), [
    `${AUTOMATION_10_KEY}|susie-booking`,
    `${AUTOMATION_11_KEY}|susie-booking`,
    `${AUTOMATION_14_KEY}|susie-booking`,
    `${AUTOMATION_16_KEY}|susie-booking`,
    `${AUTOMATION_21_KEY}|susie-booking`,
  ].sort());
  assert.equal(sent.length, 5);
  assert.equal(sent.filter((message) => message.attachments?.length).length, 2);
  assert.ok(sent.every((message) => message.to === "susie@tigproductions.co.uk"));

  const envKeys = {
    enabled: "CLIENT_AUTOMATIONS_ENABLED",
    emails: "CLIENT_AUTOMATION_EMAIL_ALLOWLIST",
    refs: "CLIENT_AUTOMATION_BOOKING_REF_ALLOWLIST",
    notBefore: "CLIENT_AUTOMATIONS_NOT_BEFORE",
  };
  Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) delete process.env[envKeys[key]];
    else process.env[envKeys[key]] = value;
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

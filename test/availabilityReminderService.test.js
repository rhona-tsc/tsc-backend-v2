import test from "node:test";
import assert from "node:assert/strict";
import {
  nextAvailabilityReminder, availabilityReminderQuietHours,
  createAvailabilityReminderRunner,
} from "../services/availabilityReminderService.js";

const now = Date.parse("2026-11-17T12:00:00Z");
const hour = 3_600_000;
const request = changes => ({
  _id: "availability-1", enquiryId: "jdWiT", actId: "act-1", lineupId: "lineup-1",
  dateISO: "2026-12-01", requestId: "EXACT123", requestKey: "enquiry:jdWiT",
  actName: "The Dreamers", musicianName: "Phoebe Belli", phone: "+447834550305",
  messageSidOut: "SMoriginal", outboundSentAt: new Date(now - 3 * hour),
  createdAt: new Date(now - 3 * hour), updatedAt: new Date(now - 1),
  reply: null, fee: "310", duties: "Lead vocals/acoustic guitar",
  formattedAddress: "London WC2N", deliveryStatus: "", status: "sent",
  websiteReplies: [], ...changes,
});

function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    const actual = row[key];
    if (value === null) return actual == null;
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("$exists" in value && (actual !== undefined) !== value.$exists) return false;
      if ("$ne" in value && actual === value.$ne) return false;
      if ("$nin" in value && value.$nin.includes(actual)) return false;
      if ("$not" in value && value.$not.$elemMatch) {
        return !(actual || []).some(item => matches(item, value.$not.$elemMatch));
      }
      return true;
    }
    return actual === value;
  });
}
function fixture({ rows = [request()], delivery = "delivered", scope, send, afterClaim } = {}) {
  const sent = [], originalSids = [];
  const model = {
    find: query => ({ sort: () => ({ lean: async () => rows.filter(r => matches(r, query)).map(r => ({ ...r })) }) }),
    findOneAndUpdate: (query, update) => ({ lean: async () => {
      const row = rows.find(r => matches(r, query));
      if (!row) return null;
      Object.assign(row, update.$set);
      afterClaim?.(row);
      return { ...row };
    } }),
    findById: id => ({ lean: async () => ({ ...rows.find(r => r._id === id) }) }),
    updateOne: async (query, update) => {
      const row = rows.find(r => matches(r, query));
      if (row) Object.assign(row, update.$set);
      return { matchedCount: row ? 1 : 0 };
    },
  };
  const run = createAvailabilityReminderRunner({
    Availability: model,
    getScopeState: scope || (async () => ({ active: true })),
    getOriginalDelivery: async row => { originalSids.push(row.messageSidOut); return { status: delivery }; },
    sendReminder: async data => {
      sent.push(data);
      if (send) return send(data);
      return { sid: "SMreminder" + sent.length };
    },
    logger: { error() {} },
  });
  return { rows, sent, run, originalSids };
}

test("first chase becomes due at exactly three hours from original send, not updatedAt", () => {
  const row = request();
  assert.equal(nextAvailabilityReminder(row, now - 1), null);
  assert.equal(nextAvailabilityReminder(row, now).field, "firstAvailabilityReminderSentAt");
  assert.equal(nextAvailabilityReminder({ ...row, outboundSentAt: new Date(now - 2 * hour) }, now), null);
});

test("later reminders keep their existing 24-hour spacing and stop after the final one", () => {
  const first = request({ firstAvailabilityReminderSentAt: new Date(now) });
  assert.equal(nextAvailabilityReminder(first, now + 24 * hour - 1), null);
  assert.equal(nextAvailabilityReminder(first, now + 24 * hour).field, "secondAvailabilityReminderSentAt");
  const second = { ...first, secondAvailabilityReminderSentAt: new Date(now + 24 * hour) };
  assert.equal(nextAvailabilityReminder(second, now + 48 * hour - 1), null);
  assert.deepEqual(nextAvailabilityReminder(second, now + 48 * hour), {
    field: "finalAvailabilityReminderSentAt", final: true,
  });
  assert.equal(nextAvailabilityReminder({ ...second, finalAvailabilityReminderSentAt: new Date(now + 48 * hour) }, now + 60 * hour), null);
});

test("does not chase explicit replies, external-reply pauses, website messages or ambiguous calendar responses", () => {
  for (const changes of [
    { reply: "yes" }, { reply: "no" }, { reply: "unavailable" },
    { repliedAt: new Date(now) }, { availabilityRemindersPausedAt: new Date(now) },
    { websiteReplies: [{ senderRole: "musician", body: "Please clarify the setup" }] },
    { calendarStatus: "tentative" }, { calendarStatus: "declined" },
    { confirmedBooking: true }, { status: "unavailable" }, { reminderSent: true },
    { dateISO: "2026-11-16" }, { createdAt: new Date(now - 200 * hour), outboundSentAt: new Date(now - 200 * hour) },
    { requestId: "" }, { enquiryId: "" }, { messageSidOut: "" }, { actName: "Test Band" },
  ]) assert.equal(nextAvailabilityReminder(request(changes), now), null, JSON.stringify(changes));
  // Calendar acceptance alone is not an availability reply.
  assert.ok(nextAvailabilityReminder(request({ calendarStatus: "accepted" }), now));
});

test("London quiet hours defer a chase until 9am and respect summer time", () => {
  for (const time of ["2026-11-17T08:59:59Z", "2026-11-17T21:00:00Z", "2027-07-01T20:00:00Z"]) {
    assert.equal(availabilityReminderQuietHours(Date.parse(time)), true);
  }
  for (const time of ["2026-11-17T09:00:00Z", "2027-07-01T08:00:00Z", "2027-07-01T19:59:59Z"]) {
    assert.equal(availabilityReminderQuietHours(Date.parse(time)), false);
  }
});

test("repeated and overlapping scheduler runs send one chase for the same exact request", async () => {
  const f = fixture();
  await Promise.all([f.run({ now }), f.run({ now }), f.run({ now })]);
  await f.run({ now: now + 5 * 60_000 });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].row.requestId, "EXACT123");
  assert.equal(f.sent[0].row.enquiryId, "jdWiT");
  assert.equal(f.rows[0].availabilityReminderMessageSid, "SMreminder1");
  assert.equal(f.rows[0].messageSidOut, "SMoriginal");
  assert.equal(f.rows[0].availabilityReminderAttemptStatus, "accepted");
});

test("does not chase a failed or unverified original delivery, even when callbacks are blank", async () => {
  for (const delivery of ["failed", "undelivered", "queued", "sent", "recipient-mismatch", null, ""]) {
    const f = fixture({ delivery });
    await f.run({ now });
    assert.equal(f.sent.length, 0, String(delivery));
    assert.deepEqual(f.originalSids, ["SMoriginal"]);
  }
});

test("does not send when an enquiry was closed, quoted, booked, or another lead has replied", async () => {
  for (const reason of ["closed", "contacted", "booked", "other-positive", "musician-outreach-disabled"]) {
    const f = fixture({ scope: async () => ({ active: false, reason }) });
    const result = await f.run({ now });
    assert.equal(f.sent.length, 0);
    assert.equal(result.skipped[0].reason, reason);
  }
});

test("rechecks a musician reply or enquiry closure arriving during the claim", async () => {
  const reply = fixture({ afterClaim: row => { row.reply = "yes"; } });
  await reply.run({ now });
  assert.equal(reply.sent.length, 0);
  assert.equal(reply.rows[0].firstAvailabilityReminderSentAt, null);
  let calls = 0;
  const closure = fixture({ scope: async () => ({ active: ++calls === 1 }) });
  await closure.run({ now });
  assert.equal(closure.sent.length, 0);
});

test("provider errors and lost responses stay paused for reconciliation, without a blind retry", async () => {
  for (const send of [async () => { throw new Error("Provider timeout"); }, async () => ({})]) {
    const f = fixture({ send });
    await f.run({ now });
    await f.run({ now: now + 25 * hour });
    assert.equal(f.sent.length, 1);
    assert.equal(f.rows[0].availabilityReminderAttemptStatus, "failed");
    assert.ok(f.rows[0].availabilityReminderFailure);
  }
});

test("a preview makes no claims or sends, and a run limits each phone to one reminder", async () => {
  const f = fixture({ rows: [request(), request({ _id: "availability-2", enquiryId: "other-job", requestId: "OTHER123", phone: "whatsapp:07834550305" })] });
  const preview = await f.run({ now, dryRun: true });
  assert.equal(preview.eligible.length, 1);
  assert.equal(f.sent.length, 0);
  assert.equal(f.rows[0].firstAvailabilityReminderSentAt, undefined);
  await f.run({ now });
  assert.equal(f.sent.length, 1);
});

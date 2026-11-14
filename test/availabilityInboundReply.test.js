import test from "node:test";
import assert from "node:assert/strict";
import Availability from "../models/availabilityModel.js";
import { availabilityReplyIntent as intent, availabilityButtonIntent as button,
  selectAvailabilityReplyTarget as target, recordAvailabilityReply as record,
  queueAvailabilityInbound as queue } from "../services/availabilityInboundReply.js";

const now = new Date("2026-11-14T09:24:00Z");
const row = overrides => ({ _id: "request-a", requestId: "ZHSWMRC", enquiryId: "a8lgJ",
  phone: "+447000000001", reply: "yes", repliedAt: new Date("2026-11-14T09:23:16Z"),
  updatedAt: new Date("2026-11-14T09:23:17Z"), inbound: { sid: "SM-yes", body: "I am available" },
  outboundSentAt: new Date("2026-11-14T09:00:00Z"), ...overrides });

// In-memory atomic update adapter, enforcing the same compare-and-set/dedupe
// contract as Mongo. The document is validated with the real Mongoose schema.
function store(initial) {
  let value = structuredClone(initial);
  return {
    get value() { return value; },
    async findOneAndUpdate(filter, update) {
      if (String(filter._id) !== String(value._id) || +filter.updatedAt !== +value.updatedAt ||
          (filter["inbound.sid"] && value.inbound?.sid === filter["inbound.sid"].$ne) ||
          (filter["replyHistory.sid"] && value.replyHistory?.some(item => item.sid === filter["replyHistory.sid"].$ne))) return null;
      for (const [key, next] of Object.entries(update.$set)) {
        if (key.startsWith("inbound.")) (value.inbound ||= {})[key.slice(8)] = next;
        else value[key] = next;
      }
      value.replyHistory = [...(value.replyHistory || []), ...update.$push.replyHistory.$each];
      value.updatedAt = new Date(+value.updatedAt + 1);
      return structuredClone(value);
    },
  };
}

test("Rachel's typed correction is negative; uncertain replies are never affirmative", () => {
  for (const message of ["I’m not available sorry that was a mistake", "I'm not available on this date.", "Sorry I can't make it", "Unavailable this day", "I'm no longer available"]) assert.equal(intent(message), "unavailable", message);
  for (const message of ["I am available", "I'm available", "yes!", "I can do it"]) assert.equal(intent(message), "yes", message);
  for (const message of ["not sure", "Yesterday was fine", "Are you available?", "I am available if we finish early", "I'm not unavailable", "My drummer is unavailable", "No problem", "I can't do it unless we finish early"]) assert.equal(intent(message), null, message);
});

test("all button payloads retain the original request ID, including location decline", () => {
  assert.deepEqual(button("NOLOC9N4L654"), { requestId: "9N4L654", reply: "no" });
  assert.deepEqual(button("UNAVAILABLE:ZHSWMRC"), { requestId: "ZHSWMRC", reply: "unavailable" });
  assert.deepEqual(button("YESZHSWMRC"), { requestId: "ZHSWMRC", reply: "yes" });
  assert.equal(button("YESBOOK_1234567"), null);
  assert.equal(button("AVAILABLE"), null);
});

test("correction matches answered enquiry; never picks another pending enquiry", () => {
  const answered = row();
  const other = row({ _id: "other", requestId: "OTHER01", reply: null, repliedAt: null,
    outboundSentAt: new Date("2026-11-13T09:00:00Z") });
  assert.equal(target([answered, other], { now }), answered);
  assert.equal(target([answered, other], { requestId: "MISSING", now }), null);
  assert.equal(target([answered, other], { repliedSid: "unknown", now }), null);
  assert.equal(target([answered, { ...other, outboundSentAt: now }], { now }), null);
  assert.equal(target([row({ confirmedBooking: true })], { now }), null);
  assert.equal(target([answered], { now: new Date("2026-11-15") }), null);
});

test("quoted SID and reference must agree, not silently switch gigs", () => {
  const a = row({ messageSidOut: "SM-out-a" });
  const b = row({ _id: "b", requestId: "OTHER01", messageSidOut: "SM-out-b" });
  assert.equal(target([a, b], { repliedSid: "SM-out-a" }), a);
  assert.equal(target([a, b], { requestId: "ZHSWMRC", repliedSid: "SM-out-b" }), null);
});

test("YES followed by correction revokes current availability, preserving both answers", async () => {
  const db = store(row());
  const event = { reply: intent("I’m not available sorry that was a mistake"), sid: "SM-correction",
    occurredAt: new Date("2026-11-14T09:23:40Z"), receivedAt: now, source: "whatsapp-text",
    body: "I’m not available sorry that was a mistake" };
  const result = await record(db, db.value, event);
  assert.equal(result.state, "recorded");
  assert.equal(db.value.reply, "unavailable");
  assert.equal(db.value.status, "unavailable");
  assert.deepEqual(db.value.replyHistory.map(item => item.reply), ["yes", "unavailable"]);
  assert.equal(db.value.replyHistory[0].sid, "SM-yes");
  assert.equal(db.value.inbound.source, "whatsapp-text");
  assert.equal(db.value.requestId, "ZHSWMRC");
  assert.equal((await record(db, db.value, event)).state, "duplicate");
  // A retry of the original YES and a delayed older distinct message cannot undo it.
  assert.equal((await record(db, db.value, { ...event, reply: "yes", sid: "SM-yes" })).state, "duplicate");
  assert.equal((await record(db, db.value, { ...event, reply: "yes", sid: "SM-delayed", occurredAt: new Date("2026-11-14T09:23:17Z") })).state, "stale");
  assert.equal(db.value.reply, "unavailable");
  const document = new Availability({ ...db.value, _id: undefined });
  assert.equal(document.validateSync(), undefined);
  assert.equal(document.toObject().inbound.source, "whatsapp-text");
  assert.equal(document.toObject().replyHistory.length, 2);
});

test("same-second replies respect receive order; concurrent outdated snapshots cannot overwrite", async () => {
  const db = store(row());
  const oldSnapshot = structuredClone(db.value);
  const event = { reply: "unavailable", sid: "SM-no", occurredAt: new Date("2026-11-14T09:23:16Z"), receivedAt: now, source: "whatsapp-text" };
  assert.equal((await record(db, oldSnapshot, event)).state, "recorded");
  assert.equal((await record(db, oldSnapshot, { ...event, reply: "yes", sid: "SM-race" })).state, "conflict");
  assert.equal(db.value.reply, "unavailable");
});

test("a delayed WhatsApp YES cannot overwrite a newer website or administrative decline", async () => {
  const db = store(row({ reply: 'unavailable', replyEventAt: new Date('2026-11-14T09:23:16Z'),
    repliedAt: new Date('2026-11-14T10:03:43Z') }));
  const result = await record(db, db.value, { reply: 'yes', sid: 'SM-delayed-website',
    occurredAt: new Date('2026-11-14T09:24:00Z'), source: 'availability-button' });
  assert.equal(result.state, 'stale');
  assert.equal(db.value.reply, 'unavailable');
});

test("consecutive replies await previous side effects, without blocking other musicians", async () => {
  const order = [];
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const yes = queue("rachel", async () => { order.push("yes-start"); await blocked; order.push("yes-end"); });
  const no = queue("rachel", async () => { order.push("correction"); });
  await queue("other", async () => { order.push("other"); });
  assert.deepEqual(order, ["yes-start", "other"]);
  release();
  await Promise.all([yes, no]);
  assert.deepEqual(order, ["yes-start", "other", "yes-end", "correction"]);
});

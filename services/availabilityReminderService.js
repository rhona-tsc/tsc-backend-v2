import { randomUUID } from "node:crypto";
import { automatedEnquiryEligible } from "../utils/enquiryAutomationEligibility.js";

const HOUR = 3_600_000;
const BLOCKED_ATTEMPTS = ["sending", "failed", "unknown"];
const BLOCKED_CALENDARS = ["declined", "cancelled", "tentative", "decline_confirmation_pending"];
const fields = [
  "firstAvailabilityReminderSentAt",
  "secondAvailabilityReminderSentAt",
  "finalAvailabilityReminderSentAt",
];

export const availabilityReminderHours = { first: 3, subsequent: 24 };

export function availabilityReminderQuietHours(now = Date.now()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "numeric", hourCycle: "h23",
  }).format(new Date(now)));
  return hour < 9 || hour >= 21;
}

export function nextAvailabilityReminder(row, now = Date.now()) {
  if (!automatedEnquiryEligible(row, now) || row.reply != null ||
      row.repliedAt || row.confirmedBooking || row.availabilityRemindersPausedAt ||
      BLOCKED_ATTEMPTS.includes(row.availabilityReminderAttemptStatus) ||
      ["failed", "undelivered", "unavailable", "declined", "accepted"].includes(row.status) ||
      ["failed", "undelivered", "canceled"].includes(row.deliveryStatus) ||
      BLOCKED_CALENDARS.includes(row.calendarStatus) ||
      row.websiteReplies?.some(message => message.senderRole === "musician") ||
      !row.enquiryId || !row.actId || !row.lineupId || !row.requestId ||
      !row.requestKey || !row.messageSidOut || !row.phone) return null;

  // Provider callbacks change updatedAt: only the original send starts the clock.
  const start = new Date(row.outboundSentAt || row.createdAt).getTime();
  if (!row.firstAvailabilityReminderSentAt) {
    if (row.reminderSent) return null; // Older three-hour routine already chased.
    return now - start >= 3 * HOUR ? { field: fields[0], final: false } : null;
  }
  if (!row.secondAvailabilityReminderSentAt) {
    const first = new Date(row.firstAvailabilityReminderSentAt).getTime();
    return now - first >= 24 * HOUR ? { field: fields[1], final: false } : null;
  }
  if (!row.finalAvailabilityReminderSentAt) {
    const second = new Date(row.secondAvailabilityReminderSentAt).getTime();
    return now - second >= 24 * HOUR ? { field: fields[2], final: true } : null;
  }
  return null;
}

export const pendingAvailabilityReminderFilter = () => ({
  reply: null,
  repliedAt: null,
  confirmedBooking: { $ne: true },
  availabilityRemindersPausedAt: null,
  availabilityReminderAttemptStatus: { $nin: BLOCKED_ATTEMPTS },
  calendarStatus: { $nin: BLOCKED_CALENDARS },
  websiteReplies: { $not: { $elemMatch: { senderRole: "musician" } } },
  requestKey: { $exists: true, $ne: "" },
  requestId: { $exists: true, $ne: "" },
  messageSidOut: { $exists: true, $ne: "" },
  deliveryStatus: { $nin: ["failed", "undelivered", "canceled"] },
  status: { $nin: ["failed", "undelivered", "unavailable", "declined", "accepted"] },
});

// Dependencies are injected so tests and previews never contact musicians.
export function createAvailabilityReminderRunner({
  Availability, getScopeState, getOriginalDelivery, sendReminder,
  logger = console, enabled = () => true,
}) {
  return async function runAvailabilityChasers({ now = Date.now(), dryRun = false } = {}) {
    const result = { sent: [], eligible: [], skipped: [], failed: [] };
    if (!enabled() || availabilityReminderQuietHours(now)) return result;
    const rows = await Availability.find(pendingAvailabilityReminderFilter())
      .sort({ outboundSentAt: 1, _id: 1 }).lean();
    const phones = new Set();
    for (const row of rows) {
      const plan = nextAvailabilityReminder(row, now);
      if (!plan) continue;
      const phone = String(row.phone).replace(/\D/g, "").replace(/^0(?=7)/, "44");
      if (!phone || phones.has(phone)) continue;
      const id = String(row._id);
      let attemptId, response;
      try {
        // Board state and positive replies are scoped to enquiry + act + lineup + date.
        const state = await getScopeState(row);
        if (!state?.active) {
          result.skipped.push({ id, reason: state?.reason || "inactive-enquiry" });
          continue;
        }
        // Blank callbacks are not delivery evidence; read the exact original SID.
        const delivery = await getOriginalDelivery(row);
        if (!["delivered", "read"].includes(delivery?.status)) {
          result.skipped.push({ id, reason: "original-not-delivered", status: delivery?.status });
          continue;
        }
        result.eligible.push({ id, requestId: row.requestId, field: plan.field });
        if (dryRun) { phones.add(phone); continue; }
        attemptId = randomUUID();
        const claimed = await Availability.findOneAndUpdate({
          ...pendingAvailabilityReminderFilter(),
          _id: row._id, enquiryId: row.enquiryId, actId: row.actId,
          lineupId: row.lineupId, dateISO: row.dateISO, requestId: row.requestId,
          messageSidOut: row.messageSidOut, phone: row.phone, fee: row.fee,
          duties: row.duties, formattedAddress: row.formattedAddress,
          [plan.field]: null,
        }, { $set: {
          [plan.field]: new Date(now),
          availabilityReminderAttemptId: attemptId,
          availabilityReminderAttemptStatus: "sending",
          availabilityReminderAttemptedAt: new Date(now),
          availabilityReminderFailure: "",
        } }, { new: true }).lean();
        if (!claimed) continue;
        phones.add(phone);

        // Recheck after the claim/provider lookup, in case a reply or closure arrived.
        const fresh = await Availability.findById(row._id).lean();
        const currentScope = await getScopeState(fresh);
        const unclaimed = { ...fresh, [plan.field]: null, availabilityReminderAttemptStatus: "" };
        if (!currentScope?.active || !nextAvailabilityReminder(unclaimed, now)) {
          await Availability.updateOne({ _id: row._id, availabilityReminderAttemptId: attemptId }, {
            $set: { [plan.field]: null, availabilityReminderAttemptStatus: "cancelled" },
          });
          result.skipped.push({ id, reason: "reply-or-state-changed-before-send" });
          continue;
        }
        response = await sendReminder({ row: fresh, final: plan.final });
        if (!response?.sid) throw new Error("Provider returned no message SID; reconcile before retry");
        await Availability.updateOne({ _id: row._id, availabilityReminderAttemptId: attemptId }, {
          $set: {
            availabilityReminderAttemptStatus: "accepted",
            availabilityReminderMessageSid: response.sid,
            availabilityReminderFailure: "",
          },
        });
        result.sent.push({ id, requestId: row.requestId, field: plan.field, messageSid: response.sid });
      } catch (error) {
        // A timeout can happen after provider acceptance. Keep the claim and pause,
        // rather than resetting the timestamp and risking another message next tick.
        if (attemptId) {
          await Availability.updateOne({ _id: row._id, availabilityReminderAttemptId: attemptId }, {
            $set: {
              availabilityReminderAttemptStatus: response?.sid ? "unknown" : "failed",
              ...(response?.sid ? { availabilityReminderMessageSid: response.sid } : {}),
              availabilityReminderFailure: String(error?.message || error),
            },
          }).catch(() => {});
        }
        result.failed.push({ id, error: String(error?.message || error) });
        logger.error("Availability reminder held for review", { availabilityId: id, error: error?.message });
      }
    }
    return result;
  };
}

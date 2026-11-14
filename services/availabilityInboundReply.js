// Availability enquiries only. Booking/allocation acceptance has its own handler.
export function availabilityReplyIntent(value = "") {
  const text = String(value).replace(/[’‘]/g, "'").replace(/#\w+/g, "")
    .trim().toLowerCase().replace(/\s+/g, " ");
  if (!text || /\?|\b(if|unless|maybe|perhaps|possibly|probably|unsure)\b|not sure|not unavailable|don't know/.test(text)) return null;
  // Negation must precede positive phrases: "I'm not available ... mistake".
  if (/\b(?:i(?:'m| am|m) (?:not available|unavailable|already booked|no longer available)|i (?:can't|cannot) (?:make|do))\b/.test(text) ||
      /^(?:sorry[,!]? )?(?:not available|unavailable|already booked|can't (?:make|do)|cannot (?:make|do))\b/.test(text)) return "unavailable";
  if (/^(?:no(?: thanks)?|not for (?:this|the) (?:place|location))[!.\s]*$/.test(text)) return "no";
  if (/^(?:y|yes)[!.\s]*$/.test(text) || /^(?:hi[,!]? )?(?:i(?:'m| am|m) available|i can (?:do|make) (?:it|this|that))(?:[!.,\s]|$)/.test(text)) return "yes";
  return null;
}

export function availabilityButtonIntent(value = "") {
  // Longest prefix first: NOLOC must never become request ID LOCxxxxxxx.
  const match = String(value).trim().match(/^(UNAVAILABLE|NOLOC|YES|NO)[:\s-]?([A-Z0-9]{5,12})$/i);
  if (!match) return null;
  const kind = match[1].toUpperCase();
  return { requestId: match[2].toUpperCase(), reply: kind === "YES" ? "yes" : kind === "UNAVAILABLE" ? "unavailable" : "no" };
}

const time = (value) => value ? new Date(value).getTime() : 0;
export function selectAvailabilityReplyTarget(rows, { requestId, repliedSid, now = new Date() }) {
  // Never fall back to a different gig when an explicit reference did not match.
  if (requestId || repliedSid) {
    const matches = rows.filter(row => (!requestId || row.requestId === requestId) &&
      (!repliedSid || [row.messageSidOut, row.smsFallbackSid].includes(repliedSid)));
    return matches.length === 1 ? matches[0] : null;
  }
  // A typed correction can refer to an answered request. Require ONE recent
  // conversation, including outbound requests, rather than the latest pending gig.
  const recent = rows.filter(row => !row.confirmedBooking &&
    Math.max(time(row.replyReceivedAt || row.repliedAt), time(row.outboundSentAt)) >= time(now) - 30 * 60_000);
  return recent.length === 1 ? recent[0] : null;
}

export async function recordAvailabilityReply(Model, row, event) {
  const { reply, sid, occurredAt, receivedAt = new Date(), source, body = "", buttonText = "", buttonPayload = "", repliedSid = null, evidence = "" } = event;
  if (!["yes", "no", "unavailable"].includes(reply)) throw new Error("Invalid availability reply");
  if (sid && (row.inbound?.sid === sid || row.replyHistory?.some(item => item.sid === sid))) return { state: "duplicate" };
  // Twilio timestamps have second precision. Within a second use receive order.
  const previousTime = Math.max(time(row.replyEventAt), time(row.repliedAt));
  if (occurredAt && Math.floor(time(occurredAt) / 1000) < Math.floor(previousTime / 1000)) return { state: "stale" };
  const history = [];
  if (!row.replyHistory?.length && row.reply) history.push({
    reply: row.reply, occurredAt: row.repliedAt, receivedAt: row.repliedAt,
    sid: row.inbound?.sid, body: row.inbound?.body || "", source: "legacy-snapshot",
    buttonText: row.inbound?.buttonText, buttonPayload: row.inbound?.buttonPayload,
  });
  history.push({ reply, previousReply: row.reply || null, sid, occurredAt: occurredAt || receivedAt, receivedAt, source, body, buttonText, buttonPayload, evidence });
  const updated = await Model.findOneAndUpdate({
    _id: row._id,
    // Compare-and-set prevents two workers from silently overwriting each other.
    updatedAt: row.updatedAt,
    ...(sid ? { "replyHistory.sid": { $ne: sid }, "inbound.sid": { $ne: sid } } : {}),
  }, {
    $set: {
      reply, repliedAt: occurredAt || receivedAt, replyEventAt: occurredAt || receivedAt,
      replyReceivedAt: receivedAt, status: reply === "yes" ? "read" : "unavailable",
      "inbound.sid": sid || null, "inbound.repliedSid": repliedSid,
      "inbound.body": body, "inbound.buttonText": buttonText || null,
      "inbound.buttonPayload": buttonPayload || null, "inbound.source": source,
      "inbound.requestId": row.requestId, "inbound.readByAdmin": false,
    },
    $push: { replyHistory: { $each: history } },
  }, { new: true, runValidators: true });
  return updated ? { state: "recorded", updated, changed: row.reply !== reply } : { state: "conflict" };
}

// Keep a musician's rapidly consecutive button/text replies and their calendar
// side effects in receive order in this process. DB compare-and-set also protects
// against concurrent workers; provider times reject older delayed messages.
const queues = new Map();
export function queueAvailabilityInbound(sender, work) {
  const prior = queues.get(sender) || Promise.resolve();
  const next = prior.catch(() => {}).then(work);
  queues.set(sender, next);
  return next.finally(() => { if (queues.get(sender) === next) queues.delete(sender); });
}

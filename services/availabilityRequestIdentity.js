const clean = value => String(value || '').trim();

// One request per enquiry/person/role, rather than one request per calendar day.
// The address/requestKey is correlation data and may change as a venue is settled.
export const availabilityEnquiryIndexName = 'availability_enquiry_person_slot_unique';
export const availabilityEnquiryIndexKey = {
  enquiryId: 1, actId: 1, lineupId: 1, dateISO: 1, phone: 1, v2: 1, slotIndex: 1,
};

export function availabilityRequestEnquiryRef(body = {}) {
  return [body.enquiryId, body.shortlistId, body.requestId, body.parentKey]
    .map(clean).find(Boolean) || null;
}

export function availabilityRequestEnquiryScope(body = {}) {
  const enquiryId = availabilityRequestEnquiryRef(body);
  // Legacy requests without a reference must never reuse a named enquiry's row.
  return enquiryId ? { enquiryId } : { enquiryId: { $in: [null, ''] } };
}

export const availabilityAttemptFilter = () => ({
  $or: [
    { status: { $in: ['sent', 'queued', 'delivered', 'read', 'undelivered'] } },
    { messageSidOut: { $exists: true, $nin: [null, ''] } },
    { outboundSentAt: { $ne: null } },
  ],
});

// Claim the exact row before sending. Concurrent retries must not overwrite its
// requestId or send twice; a locally failed validation with no outbound may retry.
export async function reserveAvailabilityRequest(Model, query, setOnInsert, fields) {
  const set = { ...fields, status: 'sent' };
  const insert = Object.fromEntries(Object.entries(setOnInsert).filter(([key]) => !(key in set)));
  try {
    const doc = await Model.findOneAndUpdate(
      { ...query, reply: null, $nor: [availabilityAttemptFilter()] },
      { $setOnInsert: insert, $set: set },
      { new: true, upsert: true },
    );
    return { reserved: true, doc };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const doc = await Model.findOne(query).lean();
    // An unrelated index conflict is a real error, not evidence of an old send.
    if (!doc) throw error;
    return { reserved: false, doc };
  }
}

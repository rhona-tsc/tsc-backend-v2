const clean = value => String(value || '').trim();

export const encoreRequestEnquiryScope = body => body?.source === 'encore_enquiry_board' && clean(body.enquiryId)
  ? { enquiryId: clean(body.enquiryId) } : {};

// Never fall back to act/date alone: another client's reply is not availability for this enquiry.
export function enquiryAvailabilityFilter(row) {
  if (!clean(row?.enquiryRef) || !clean(row?.actId) || !clean(row?.eventDateISO)) return null;
  return {
    enquiryId: clean(row.enquiryRef), actId: row.actId, dateISO: clean(row.eventDateISO),
    ...(clean(row.lineupId) ? { lineupId: row.lineupId } : {}),
  };
}

export const enquiryAvailabilityProjection = 'enquiryId actId lineupId dateISO requestId slotIndex musicianId musicianName isDeputy reply status deliveryStatus deliveryErrorCode outboundSentAt repliedAt updatedAt createdAt calendarStatus websiteReplies inbound replyHistory';

export function enquiryAvailabilityRequests(docs) {
  return docs.map(doc => ({
    availabilityId: String(doc._id), requestId: doc.requestId || null,
    enquiryRef: doc.enquiryId, actId: String(doc.actId), lineupId: doc.lineupId ? String(doc.lineupId) : null,
    dateISO: doc.dateISO, slotIndex: doc.slotIndex, musicianId: doc.musicianId ? String(doc.musicianId) : null,
    musicianName: doc.musicianName || '', isDeputy: !!doc.isDeputy,
    // Calendar acceptance/delivery is not an affirmative vocalist reply.
    reply: doc.reply || null, status: doc.status, deliveryStatus: doc.deliveryStatus || '',
    deliveryErrorCode: doc.deliveryErrorCode || '', sentAt: doc.outboundSentAt || null,
    repliedAt: doc.repliedAt || null, updatedAt: doc.updatedAt,
    replySource: doc.inbound?.source || null,
    replyHistory: (doc.replyHistory || []).map(item => ({
      reply: item.reply, previousReply: item.previousReply || null,
      occurredAt: item.occurredAt || null, receivedAt: item.receivedAt || null,
      source: item.source || null, body: item.body || '',
    })),
    calendarStatus: doc.calendarStatus || null,
    musicianMessages: (doc.websiteReplies || []).filter(message => message.senderRole === 'musician')
      .map(message => ({ body: message.body, senderName: message.senderName, createdAt: message.createdAt })),
  }));
}

export function enquiryAvailabilitySlots(requests) {
  const currentByMusician = new Map();
  const timestamp = value => new Date(value.repliedAt || value.updatedAt || value.sentAt || 0).getTime();
  for (const request of requests) {
    if (!Number.isInteger(request.slotIndex)) continue;
    // A singer's later decline replaces THEIR yes. It must not replace a
    // different deputy's valid yes for the same role in this enquiry.
    const key = `${request.slotIndex}:${request.musicianId || 'unknown'}`;
    const previous = currentByMusician.get(key);
    if (!previous || timestamp(request) >= timestamp(previous)) currentByMusician.set(key, request);
  }
  const latest = new Map();
  for (const request of currentByMusician.values()) {
    const previous = latest.get(request.slotIndex);
    if (!previous || (request.reply === 'yes' && previous.reply !== 'yes') ||
        ((request.reply === 'yes') === (previous.reply === 'yes') && timestamp(request) >= timestamp(previous))) latest.set(request.slotIndex, request);
  }
  return [...latest.values()].map(request => ({
    slotIndex: request.slotIndex, musicianName: request.musicianName, requestId: request.requestId,
    reply: request.reply, repliedAt: request.repliedAt, deliveryStatus: request.deliveryStatus,
    // Only explicit yes/no/unavailable is a reply. Delivery and calendar state remain separate.
    status: request.reply ? request.status : ['failed', 'undelivered'].includes(request.status) ? request.status : 'pending',
  }));
}

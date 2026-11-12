const clean = value => String(value || '').trim();

// Never fall back to act/date alone: another client's reply is not availability for this enquiry.
export function enquiryAvailabilityFilter(row) {
  if (!clean(row?.enquiryRef) || !clean(row?.actId) || !clean(row?.eventDateISO)) return null;
  return {
    enquiryId: clean(row.enquiryRef), actId: row.actId, dateISO: clean(row.eventDateISO),
    ...(clean(row.lineupId) ? { lineupId: row.lineupId } : {}),
  };
}

export const enquiryAvailabilityProjection = 'enquiryId actId lineupId dateISO requestId slotIndex musicianId musicianName isDeputy reply status deliveryStatus deliveryErrorCode outboundSentAt repliedAt updatedAt createdAt calendarStatus websiteReplies';

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
    calendarStatus: doc.calendarStatus || null,
    musicianMessages: (doc.websiteReplies || []).filter(message => message.senderRole === 'musician')
      .map(message => ({ body: message.body, senderName: message.senderName, createdAt: message.createdAt })),
  }));
}

export function enquiryAvailabilitySlots(requests) {
  const latest = new Map();
  for (const request of requests) {
    if (!Number.isInteger(request.slotIndex)) continue;
    const previous = latest.get(request.slotIndex);
    const timestamp = value => new Date(value.updatedAt || value.sentAt || 0).getTime();
    if (!previous || timestamp(request) >= timestamp(previous)) latest.set(request.slotIndex, request);
  }
  return [...latest.values()].map(request => ({ ...request,
    // Only explicit yes/no/unavailable is a reply. Delivery and calendar state remain separate.
    status: request.reply ? request.status : ['failed', 'undelivered'].includes(request.status) ? request.status : 'pending',
  }));
}

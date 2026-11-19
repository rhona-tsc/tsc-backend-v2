import { sortedVocalContacts } from '../utils/enquiryAvailability.js';

const clean = value => String(value || '').trim();
const email = value => clean(value).toLowerCase();
const phone = value => {
  let result = clean(value).replace(/^whatsapp:/i, '').replace(/[\s()-]/g, '');
  if (result.startsWith('00')) result = `+${result.slice(2)}`;
  if (/^0\d{10}$/.test(result)) result = `+44${result.slice(1)}`;
  if (/^44\d+$/.test(result)) result = `+${result}`;
  return result;
};
const personPhone = person => phone(person?.phone || person?.phoneNumber);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// Identity fields must agree; a matching name must never override a different phone.
function matches(member, selected) {
  const pairs = [
    [clean(member.musicianId), clean(selected.musicianId)],
    [personPhone(member), personPhone(selected)],
    [email(member.email), email(selected.email)],
  ].filter(([a, b]) => a && b);
  if (pairs.some(([a, b]) => a !== b)) return false;
  return pairs.some(([a, b]) => a === b) ||
    Boolean(selected._id && clean(member._id) === clean(selected._id));
}

export function assertAvailabilityContactAllowed(person, dateISO, approval) {
  const isEmma = clean(person?.musicianId || person?._id) === '6920b022cddfe7353a7806a6' ||
    email(person?.email) === 'emma_osei_lah@hotmail.com' || personPhone(person) === '+447859844499';
  if (!isEmma || !/^2027-\d{2}-\d{2}$/.test(dateISO)) return;
  const weekday = new Date(`${dateISO}T12:00:00Z`).getUTCDay();
  if (![0, 4, 5, 6].includes(weekday)) return;
  // No invented "last-minute" cutoff: staff must record a specific authorized exception.
  if (approval?.musicianId === '6920b022cddfe7353a7806a6' &&
      approval.dateISO === dateISO && approval.approvedBy === 'Rhona' && clean(approval.reason)) return;
  fail('AVAILABILITY_CONTACT_RESTRICTED',
    'Emma’s 2027 Thursday–Sunday tour restriction requires a specific date-authorized contact exception. No request was sent.');
}

function approvedOfferFor(body, member, slotIndex, required) {
  const offers = body.approvedOffers || (body.approvedOffer ? [body.approvedOffer] : []);
  if (!Array.isArray(offers)) fail('AVAILABILITY_OFFER_REQUIRED', 'Approved offers must be a list.');
  const found = offers.filter(offer => matches(member, offer) &&
    (offer.slotIndex === undefined || offer.slotIndex === slotIndex));
  if (!found.length && !required && !offers.length) return null;
  if (found.length !== 1) fail('AVAILABILITY_OFFER_REQUIRED',
    'Confirm one exact recipient and their approved total fee including travel before sending.');
  const offer = found[0];
  if (typeof offer.total !== 'number' || !Number.isFinite(offer.total) || offer.total <= 0 ||
      Math.abs(Math.round(offer.total * 100) - offer.total * 100) > 0.000001 ||
      offer.includesTravel !== true || !/^\+[1-9]\d{7,14}$/.test(personPhone(offer))) {
    fail('AVAILABILITY_OFFER_INVALID', 'The approved offer must specify the exact phone and a positive total fee including travel.');
  }
  return { ...offer, phone: personPhone(offer) };
}

// Runs for the entire selection before any request is reserved, escalated or sent.
export function prepareAvailabilityDispatch({ body, lineup, dateISO }) {
  const vocalists = sortedVocalContacts(lineup);
  const managed = body.source === 'encore_enquiry_board' && body.automaticDeputy !== true;
  if (body.isDeputy) {
    const member = body.deputy;
    if (!member) fail('AVAILABILITY_TARGET_INVALID', 'Select an exact deputy.');
    const slotIndex = body.slotIndex ?? 0;
    if (!Number.isInteger(slotIndex) || !vocalists[slotIndex]) fail('AVAILABILITY_SLOT_MISMATCH', 'Confirm the vocal-role index.');
    assertAvailabilityContactAllowed(member, dateISO, body.contactPolicyApproval);
    return { targeted: true, single: { member, slotIndex,
      offer: approvedOfferFor(body, member, slotIndex, managed) }, primary: [] };
  }

  const selected = body.targetMember || body.targetVocalist;
  const name = clean(body.selectedVocalistName).toLowerCase();
  let slots = vocalists.map((member, slotIndex) => ({ member, slotIndex }));
  const targeted = Boolean(selected || name || body.slotIndex !== undefined);
  if (selected || name) {
    slots = slots.filter(({ member }) => selected ? matches(member, selected) :
      `${clean(member.firstName)} ${clean(member.lastName)}`.toLowerCase() === name);
    if (slots.length !== 1) fail('AVAILABILITY_TARGET_INVALID', 'The selected singer does not uniquely match this lineup.');
  }
  if (body.slotIndex !== undefined) {
    if (!Number.isInteger(body.slotIndex) || !slots.some(slot => slot.slotIndex === body.slotIndex)) {
      fail('AVAILABILITY_SLOT_MISMATCH', 'The selected singer and vocal-role index do not match. No request was sent.');
    }
    slots = slots.filter(slot => slot.slotIndex === body.slotIndex);
  }
  if (!slots.length) fail('AVAILABILITY_TARGET_INVALID', 'This lineup has no selected lead vocalist.');
  const primary = slots.map(slot => {
    const member = selected ? { ...slot.member, ...selected } : slot.member;
    assertAvailabilityContactAllowed(member, dateISO, body.contactPolicyApproval);
    return { member, slotIndex: slot.slotIndex,
      offer: approvedOfferFor(body, member, slot.slotIndex, managed) };
  });
  const supplied = body.approvedOffers || (body.approvedOffer ? [body.approvedOffer] : []);
  if (supplied.length && primary.length !== supplied.length) {
    fail('AVAILABILITY_RECIPIENT_MISMATCH', 'The approved recipient list differs from the planned send.');
  }
  return { targeted, single: primary.length === 1 ? primary[0] : null, primary };
}

export function assertApprovedAvailabilityRecipient(offer, canonicalId, recipientPhone) {
  if (!offer) return;
  if (offer.phone !== phone(recipientPhone) ||
      (offer.musicianId && clean(offer.musicianId) !== clean(canonicalId))) {
    fail('AVAILABILITY_RECIPIENT_MISMATCH', 'The resolved recipient differs from the approved offer. No request was sent.');
  }
}

export async function validateAvailabilityDispatchRecipients(dispatch, { dateISO, approval, resolveCanonical, loadPriorReplies }) {
  const recipients = dispatch.single ? [dispatch.single] : dispatch.primary;
  const verified = new Map();
  for (const planned of recipients) {
    const recipientPhone = personPhone(planned.member);
    const canonical = await resolveCanonical(planned.member, recipientPhone);
    assertApprovedAvailabilityRecipient(planned.offer, canonical?._id, recipientPhone);
    assertAvailabilityContactAllowed({ ...planned.member, ...canonical,
      musicianId: canonical?._id || planned.member.musicianId }, dateISO, approval);
    if (loadPriorReplies) {
      const prior = await loadPriorReplies(canonical?._id, recipientPhone);
      if (prior?.length) fail('AVAILABILITY_PRIOR_DECLINE',
        'This musician has already declined this date or the same venue. Review the existing reply; no new request was sent.');
    }
    verified.set(recipientPhone, canonical);
  }
  return verified;
}

export function priorAvailabilityDeclines(rows, formattedAddress) {
  const address = clean(formattedAddress).toLowerCase().replace(/\s+/g, ' ');
  const postcode = address.match(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/i)?.[0]?.replace(/\s/g, '');
  return rows.filter(row => {
    // System skip/clash rows without an actual request/reply are not musician declines.
    if (!row.messageSidOut && !row.outboundSentAt && !row.replyHistory?.length) return false;
    if (row.reply === 'unavailable') return true;
    if (row.reply !== 'no') return false;
    const earlier = clean(row.formattedAddress || row.address).toLowerCase().replace(/\s+/g, ' ');
    return earlier === address || Boolean(postcode && earlier.replace(/\s/g, '').includes(postcode));
  });
}

export function approvedAvailabilityFee(offer, calculatedFee) {
  // This is already the checked all-in offer: never add travel/extras a second time.
  return offer ? offer.total : calculatedFee;
}

export function availabilityEnquiryDuties(body, member) {
  const text = clean(body.inheritedDuties || member?.instrument || 'Performance');
  return /not a confirmed (booking|gig)|enquiry only/i.test(text) ? text :
    `${text}. Enquiry only, not a confirmed booking.`;
}

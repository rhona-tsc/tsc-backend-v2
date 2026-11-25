import { availabilityPhone } from './availabilityPriorDeclines.js';

export function scheduledDeputyOffer(lead, deputy) {
  const musicianId = String(deputy.musicianId || deputy.id || deputy._id || '');
  const phone = availabilityPhone(deputy.phoneNumber || deputy.phone);
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  if (!musicianId || !/^\+[1-9]\d{7,14}$/.test(phone) ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(lead.fee)) || !(Number(lead.fee) > 0)) {
    fail('DEPUTY_PRICING_UNCONFIRMED', 'An exact original all-in offer and deputy contact are required.');
  }
  const isEmma = musicianId === '6920b022cddfe7353a7806a6' ||
    String(deputy.email || '').toLowerCase() === 'emma_osei_lah@hotmail.com' || phone === '+447859844499';
  if (isEmma && /^2027-/.test(lead.dateISO) &&
      [0, 4, 5, 6].includes(new Date(`${lead.dateISO}T12:00:00Z`).getUTCDay())) {
    fail('AVAILABILITY_CONTACT_RESTRICTED', 'Emma’s Thursday–Sunday tour restriction requires a date-specific staff review.');
  }
  // Preserve the original approved offer and travel once. Never silently
  // substitute a new personal rate or lose daytime/setup duties in a handoff.
  return {
    automaticDeputy: false,
    inheritedFee: Number(lead.fee), inheritedFeeIncludesTravel: true,
    inheritedDuties: lead.duties,
    approvedOffer: { musicianId, phone, total: Number(lead.fee), includesTravel: true },
  };
}

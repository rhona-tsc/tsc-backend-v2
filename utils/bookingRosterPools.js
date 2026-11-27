import {bookingRolePlan} from './bookingAllocationPolicy.js';
import {ROSTER_REGIONS, rosterEligibility, eligibleRosterDeputies, selectRosterMember, sameRosterPerson, isLeadVocalPart} from './rosterEligibility.js';

// Overrides are saved by an administrator for one booking role. Venue details
// and every other role keep their normal geographic routing.
export function bookingPoolRegions(board, roleSlotId) {
  const override = (board?.allocationPoolOverrides || []).find(item =>
    roleSlotId && item.roleSlotId === roleSlotId && String(item.reason || '').trim());
  return [...new Set((override?.regions || []).filter(region => ROSTER_REGIONS.includes(region)))];
}

export const bookingLeadVocalCount = (board, lineup) =>
  bookingRolePlan(board || {}, lineup).filter(slot => isLeadVocalPart(slot.role)).length;

export function rosterEligibilityForBooking({board, roleSlotId, ...context}) {
  const regions = bookingPoolRegions(board, roleSlotId);
  const results = (regions.length ? regions : [undefined]).map(region =>
    rosterEligibility({...context, leadVocalCount: bookingLeadVocalCount(board, context.lineup), roleSlotId, ...(region ? {region} : {})}));
  return results.find(result => result.eligible) || results[0];
}

export function eligibleDeputiesForBooking({board, roleSlotId, ...context}) {
  const regions = bookingPoolRegions(board, roleSlotId), seen = new Set(), result = [];
  for (const region of regions.length ? regions : [undefined]) {
    for (const deputy of eligibleRosterDeputies({...context, leadVocalCount: bookingLeadVocalCount(board, context.lineup), roleSlotId, ...(region ? {region} : {})})) {
      const key = String(deputy.musicianId || deputy._id || deputy.email || deputy.phoneNumber || deputy.phone || '');
      if (!key || seen.has(key)) continue;
      seen.add(key); result.push(deputy);
    }
  }
  return result;
}


// A selected upgrade replacement keeps precedence across explicitly ordered pools.
export function selectRosterMemberForBooking({board, roleSlotId, member, ...context}) {
  const selected = (context.assignments || []).find(a => a.source === 'lineup_upgrade' &&
    !a.withdrawnAt && ['selected','proposed','offered','accepted','confirmed'].includes(a.status) &&
    String(a.originalBandMemberId || '') === String(member._id || ''));
  const deputy = selected && (member.deputies || []).find(d => sameRosterPerson(d, selected));
  if (deputy && rosterEligibilityForBooking({board,roleSlotId,member,candidate:deputy,...context}).eligible)
    return {...(member.toObject?.() || member),...deputy,_id:member._id,
      musicianId:deputy.musicianId || deputy.id || deputy._id,
      instrument:member.instrument,deputies:member.deputies};
  const regions=bookingPoolRegions(board,roleSlotId);
  for(const region of regions.length?regions:[undefined]) {
    const person=selectRosterMember({member,roleSlotId,...context,leadVocalCount:bookingLeadVocalCount(board,context.lineup),...(region?{region}:{})});
    if(person)return person;
  }
  return null;
}

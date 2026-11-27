import {ROSTER_REGIONS, rosterEligibility, eligibleRosterDeputies} from './rosterEligibility.js';

// Overrides are saved by an administrator for one booking role. Venue details
// and every other role keep their normal geographic routing.
export function bookingPoolRegions(board, roleSlotId) {
  const override = (board?.allocationPoolOverrides || []).find(item =>
    roleSlotId && item.roleSlotId === roleSlotId && String(item.reason || '').trim());
  return [...new Set((override?.regions || []).filter(region => ROSTER_REGIONS.includes(region)))];
}

export function rosterEligibilityForBooking({board, roleSlotId, ...context}) {
  const regions = bookingPoolRegions(board, roleSlotId);
  const results = (regions.length ? regions : [undefined]).map(region =>
    rosterEligibility({...context, roleSlotId, ...(region ? {region} : {})}));
  return results.find(result => result.eligible) || results[0];
}

export function eligibleDeputiesForBooking({board, roleSlotId, ...context}) {
  const regions = bookingPoolRegions(board, roleSlotId), seen = new Set(), result = [];
  for (const region of regions.length ? regions : [undefined]) {
    for (const deputy of eligibleRosterDeputies({...context, roleSlotId, ...(region ? {region} : {})})) {
      const key = String(deputy.musicianId || deputy._id || deputy.email || deputy.phoneNumber || deputy.phone || '');
      if (!key || seen.has(key)) continue;
      seen.add(key); result.push(deputy);
    }
  }
  return result;
}

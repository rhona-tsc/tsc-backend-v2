import { bookingAssignments, bookingRolePlan, activeBooking, confirmedAllocation } from './bookingAllocationPolicy.js';
import { normaliseAllocationRole } from './allocationRoles.js';
import { sameRosterPerson } from './rosterEligibility.js';
import { eligibleDeputiesForBooking } from './bookingRosterPools.js';
const plain = x => x?.toObject?.() || x;
const active = a => !a?.withdrawnAt && !['declined','cancelled','removed','unavailable','withdrawn','replaced'].includes(String(a?.status || '').toLowerCase());
const role = a => normaliseAllocationRole(a?.role || a?.instrument || '');

export function planBookingRoleUpgrade({ board, lineup, policy, unavailableMusicianIds = [], now = new Date() }) {
  if (!activeBooking(board)) return null;
  const assignments = bookingAssignments(board).map(plain);
  const plan = bookingRolePlan(board, lineup);
  for (const rule of policy?.roleUpgradeTransfers || []) {
    const person = { musicianId: rule.musicianId };
    const fromRole = normaliseAllocationRole(rule.fromRole);
    let pattern;
    try { pattern = new RegExp(rule.toRolePattern, 'i'); } catch { continue; }
    const released = assignments.find(a => active(a) && sameRosterPerson(a, person) && role(a) === fromRole);
    if (!released) continue;
    const from = plan.find(s => s.role === fromRole && s.member);
    const to = plan.find(s => pattern.test(s.role) && s.member && sameRosterPerson(s.member, person));
    if (!from || !to) continue;
    const bookedVocal = assignments.find(a => active(a) && (a.roleSlotId === to.roleSlotId || role(a) === to.role));
    // A different allocated singer takes precedence over an unfilled original.
    if (bookedVocal && !sameRosterPerson(bookedVocal, person)) continue;
    const retained = assignments.filter(a => !(sameRosterPerson(a, person) && role(a) === fromRole));
    const newVocal = bookedVocal || {
      musicianId: rule.musicianId,
      name: [to.member.firstName, to.member.lastName].filter(Boolean).join(' '),
      email: to.member.email || '', phone: to.member.phoneNumber || '',
      role: to.role, instrument: to.role, roleSlotId: to.roleSlotId,
      originalBandMemberId: to.member._id, status: 'selected',
      candidateSource: 'primary', source: 'lineup_upgrade',
      fee: 0, totalFee: 0,
      notes: 'Moved from bass after a lineup upgrade; confirm the vocal role and fee before dispatching the bass replacement.',
      taggedAt: now,
    };
    if (!bookedVocal) retained.push(newVocal);
    const candidates = eligibleDeputiesForBooking({ board, roleSlotId: from.roleSlotId, member: from.member, lineup, policy,
      assignments: retained, county: board.county, address: board.address || board.venueAddress });
    const unavailable = new Set(unavailableMusicianIds.map(String));
    const next = candidates.find(p => !sameRosterPerson(p, person) && !unavailable.has(String(p.musicianId || p.id || p._id))); 
    const nextBass = {
      role: from.role, instrument: from.role, roleSlotId: from.roleSlotId,
      originalBandMemberId: from.member._id, source: 'lineup_upgrade',
      status: next ? 'selected' : 'unfilled', candidateSource: next ? 'act_deputy' : '',
      ...(next ? { musicianId: next.musicianId || next.id || next._id,
        name: [next.firstName, next.lastName].filter(Boolean).join(' '),
        email: next.email || '', phone: next.phoneNumber || next.phone || '' } : {}),
      fee: 0, totalFee: 0, taggedAt: now,
      notes: 'Next bass candidate after the vocalist moved roles; availability and fee remain subject to the normal offer process.',
    };
    retained.push(nextBass);
    return {
      assignments: retained,
      released, vocal: newVocal, nextBass,
      fromRole: from.role, fromRoleSlotId: from.roleSlotId,
      originalBandMemberId: from.member._id, toRoleSlotId: to.roleSlotId,
      musicianId: rule.musicianId,
      offerFee: Number(released.totalFee || released.fee || from.member.fee || 0),
      vocalConfirmed: confirmedAllocation(newVocal),
    };
  }
  return null;
}

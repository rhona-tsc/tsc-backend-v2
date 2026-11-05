const key = value => String(value || '').trim().toLowerCase();
const validDate = value => value && Number.isFinite(new Date(value).getTime());

export const originalRoleProgress = ({ project, rounds = [], reservations = [], submissions = [], futureReservations = [], viewerId = '' }, now = new Date()) => {
  const current = rounds.find(item => String(item._id) === String(project.currentRoundId));
  const failedIds = new Set(submissions.filter(item => ['rejected', 'withdrawn', 'retracted'].includes(item.state) && item.reservationId).map(item => String(item.reservationId)));
  const heldSlots = reservations.filter(item => String(item.roundId) === String(project.currentRoundId) && item.slotHeld !== false &&
    !failedIds.has(String(item._id)) && (item.state === 'submitted' || (item.state === 'active' && validDate(item.expiresAt) && new Date(item.expiresAt) > now)))
    .sort((a, b) => (new Date(a.reservedAt || 0) - new Date(b.reservedAt || 0)) || String(a._id || '').localeCompare(String(b._id || '')));
  // Keep actual round seat numbers; allocate unused numbers to legacy slots.
  const usedNumbers = new Set(heldSlots.map(item => item.seatNumber).filter(number => Number.isInteger(number) && number >= 1 && number <= 3));
  const numberedSlots = heldSlots.map(item => {
    let slotNumber = item.seatNumber;
    if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 3) {
      slotNumber = [1, 2, 3].find(number => !usedNumbers.has(number));
      usedNumbers.add(slotNumber);
    }
    return { reservation: item, slotNumber };
  });

  return (project.requestedRoles || []).map(role => {
    const matching = submissions.filter(item => key(item.roleName) === key(role.name));
    const accepted = matching.some(item => item.state === 'accepted');
    const awaiting = matching.some(item => item.state === 'submitted' && String(item.roundId) === String(project.currentRoundId));
    const isCurrent = Boolean(current && (current.type === 'foundation' ? (current.eligibleRoles || []).some(name => key(name) === key(role.name)) : key(current.roleName) === key(role.name)));
    // Expose only anonymous seat numbers and deadlines, never another musician's
    // reservation ID, agreement, private credit preferences or contact details.
    const slots = accepted ? [] : numberedSlots.filter(({ reservation }) => key(reservation.roleName) === key(role.name)).map(({ reservation, slotNumber }) => ({
      slotNumber,
      state: reservation.state,
      expectedBy: reservation.state === 'active' ? new Date(reservation.expiresAt).toISOString() : null,
      isOwn: Boolean(viewerId && String(reservation.musicianId) === String(viewerId)),
    })).sort((a, b) => a.slotNumber - b.slotNumber);
    const active = slots.some(item => item.state === 'active');
    const advanceCount = futureReservations.filter(item => item.state === 'waiting' && key(item.roleName) === key(role.name)).length;
    return {
      canReserveAhead: !accepted && !isCurrent && ['live', 'foundation_open', 'role_round_open', 'owner_review'].includes(project.state),
      advanceCount, advancePlacesRemaining: Math.max(0, 3 - advanceCount), name: role.name,
      status: accepted ? 'Recording approved' : awaiting ? 'Submitted — awaiting review' : active ? 'Reserved — awaiting recording' : isCurrent && ['open', 'reopened'].includes(current.state) ? 'Awaiting interested musicians' : 'Awaiting a future round',
      canRecommend: !accepted,
      timingState: accepted ? 'complete' : active ? 'reserved' : awaiting || slots.length ? 'review' : isCurrent && ['open', 'reopened'].includes(current.state) ? 'awaiting_reservation' : 'future_round',
      slots,
    };
  });
};

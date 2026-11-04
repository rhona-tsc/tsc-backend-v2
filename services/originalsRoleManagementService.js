const key = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const editableStates = new Set(['draft', 'changes_requested', 'live', 'foundation_open', 'role_round_open', 'owner_review']);

export function originalRoleManagement(snapshot, now = new Date()) {
  const { project, rounds = [], reservations = [], submissions = [], futureReservations = [], invitations = [] } = snapshot;
  const roles = project.requestedRoles || [];
  const reason = project.currentCreditVersionId ? 'The project already has a credit version. Resolve the credits before changing its parts.'
    : !editableStates.has(project.state) ? 'Parts can be changed while planning or recording, before mixing, mastering or final credits.' : '';
  const current = rounds.find(round => String(round._id) === String(project.currentRoundId));
  const currentNames = current?.type === 'foundation' ? current.eligibleRoles || [] : current?.roleName ? [current.roleName] : [];
  return {
    canEdit: !reason,
    reason,
    roles: roles.map(role => {
      const matches = item => key(item.roleName) === key(role.name);
      const protectedSubmission = submissions.some(item => matches(item) && ['submitted', 'accepted', 'retraction_requested'].includes(item.state));
      const heldReservation = reservations.some(item => matches(item) && ((item.state === 'active' && new Date(item.expiresAt) > now)
        || (item.state === 'submitted' && !submissions.some(sub => String(sub.reservationId) === String(item._id) && ['rejected', 'withdrawn', 'retracted'].includes(sub.state)))));
      const removeReason = reason || (protectedSubmission ? 'This part has a submitted or approved recording. Keep it to preserve the review and credits.'
        : heldReservation ? 'Someone has an active recording place for this part. It must be released or expire first.'
        : futureReservations.some(item => matches(item) && item.state === 'waiting') ? 'Someone has an advance place for this part. They must release it first.'
        : invitations.some(item => matches(item) && String(item.roundId) === String(project.currentRoundId) && ['pending', 'accepted'].includes(item.state) && (!item.expiresAt || new Date(item.expiresAt) > now)) ? 'This part has an active invitation in the current round.'
        : currentNames.some(name => key(name) === key(role.name)) ? 'This part is in the current round. Move to the next stage before removing an unused part.'
        : roles.length <= 1 ? 'Keep at least one part in the project.'
        : ['draft', 'changes_requested'].includes(project.state) && ['none', 'video_demo'].includes(project.sourceType || (project.hasInitialStem ? 'final_eligible_stem' : 'none')) && role.foundationEligible && !roles.some(other => key(other.name) !== key(role.name) && other.foundationEligible) ? 'Keep at least one foundation part so the project can start.' : '');
      return { name: role.name, canRemove: !removeReason, removeReason };
    }),
  };
}

export function originalRoleName(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) throw Object.assign(new Error('Enter a part name.'), { status: 400 });
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) throw Object.assign(new Error('Use a part name between 1 and 80 characters.'), { status: 400 });
  if (['tsc', 'project owner', 'mix', 'master', 'mix producer', 'mastering engineer'].includes(key(name))) throw Object.assign(new Error('Mixing and mastering have their own stages. Choose an instrument or another recording part.'), { status: 400 });
  return name;
}

export const sameOriginalRole = (a, b) => key(a) === key(b);

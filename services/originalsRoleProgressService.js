const key = value => String(value || '').trim().toLowerCase();
export const originalRoleProgress = ({ project, rounds = [], reservations = [], submissions = [] }, now = new Date()) => (project.requestedRoles || []).map(role => {
  const matching = submissions.filter(item => key(item.roleName) === key(role.name));
  const accepted = matching.some(item => item.state === 'accepted');
  const awaiting = matching.some(item => item.state === 'submitted' && String(item.roundId) === String(project.currentRoundId));
  const active = reservations.some(item => key(item.roleName) === key(role.name) && String(item.roundId) === String(project.currentRoundId) && item.state === 'active' && new Date(item.expiresAt) > now);
  const current = rounds.find(item => String(item._id) === String(project.currentRoundId));
  const isCurrent = current && (current.type === 'foundation' ? (current.eligibleRoles || []).some(name => key(name) === key(role.name)) : key(current.roleName) === key(role.name));
  return { name: role.name, status: accepted ? 'Recording approved' : awaiting ? 'Submitted — awaiting review' : active ? 'Reserved — awaiting recording' : isCurrent && ['open','reopened'].includes(current.state) ? 'Awaiting interested musicians' : 'Awaiting a future round', canRecommend: !accepted };
});

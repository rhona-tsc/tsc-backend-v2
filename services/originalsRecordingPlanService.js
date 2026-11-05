const key = value => String(value || '').trim().toLowerCase();

export function validateOriginalRecordingOrder(roles) {
  const used = new Set();
  return roles.map(role => {
    const raw = role.recordingOrder;
    if (raw === undefined || raw === null || raw === '') return { ...role, recordingOrder: null };
    const number = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isInteger(number) || number < 1 || number > 30 || used.has(number)) {
      throw Object.assign(new Error('Use a different whole number from 1 to 30 for each preferred recording order, or leave it blank.'), { status: 400 });
    }
    used.add(number);
    return { ...role, recordingOrder: number };
  });
}

export function orderedOriginalRoles(roles = []) {
  return roles.map((role, index) => ({ role, index })).sort((a, b) =>
    (a.role.recordingOrder ?? Infinity) - (b.role.recordingOrder ?? Infinity) || a.index - b.index
  ).map(item => item.role);
}

export function originalRecordingPlan({ project, rounds = [], submissions = [] }) {
  const current = rounds.find(round => String(round._id) === String(project.currentRoundId));
  const approved = new Set(submissions.filter(item => ['accepted', 'retraction_requested'].includes(item.state) && item.category === 'contribution').map(item => key(item.roleName)));
  const remaining = orderedOriginalRoles(project.requestedRoles).filter(role => !approved.has(key(role.name)) && !(current?.type === 'instrument' && key(role.name) === key(current.roleName)));
  const role = remaining[0];
  const nextRound = current?.type === 'mix' ? { type: 'master', roleName: 'Mastering engineer', fromPreference: false }
    : role ? { type: 'instrument', roleName: role.name, fromPreference: role.recordingOrder != null, recordingOrder: role.recordingOrder ?? null }
    : { type: 'mix', roleName: 'Mix producer', fromPreference: false };
  const pending = submissions.filter(item => item.state === 'submitted' && String(item.roundId) === String(current?._id));
  const dates = submissions.filter(item => String(item.roundId) === String(current?._id)).filter(item => item.submittedAt != null).map(item => new Date(item.submittedAt).getTime()).filter(Number.isFinite);
  const latest = dates.length ? Math.max(...dates) : null;
  // Review is a human decision. This deadline never approves audio automatically.
  const reviewDueAt = pending.length && latest != null ? new Date(latest + 7 * 24 * 60 * 60 * 1000).toISOString() : null;
  return { nextRound, reviewDueAt };
}

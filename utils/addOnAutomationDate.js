const dayMs = 86400000;
const timestamp = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return NaN;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() : NaN;
};
const iso = value => new Date(value).toISOString().slice(0, 10);
// Only the flexible add-on email moves. Ties favour the preceding day; the
// intro day and final-details deadline are excluded. Catch-ups cannot move back.
export function collisionFreeAddOnDay({ plannedISO, introISO, deadlineISO, blockedISOs = [], notBeforeISO = '' }) {
  const planned = timestamp(plannedISO), intro = timestamp(introISO), deadline = timestamp(deadlineISO);
  if (![planned, intro, deadline].every(Number.isFinite) || intro >= deadline) return '';
  const minimum = Math.max(intro + dayMs, notBeforeISO ? timestamp(notBeforeISO) : intro + dayMs);
  if (!Number.isFinite(minimum) || minimum >= deadline) return '';
  const blocked = new Set(blockedISOs.filter(Boolean));
  const candidates = [];
  for (let candidate = minimum; candidate < deadline; candidate += dayMs) {
    if (!blocked.has(iso(candidate))) candidates.push(candidate);
  }
  candidates.sort((left, right) => Math.abs(left - planned) - Math.abs(right - planned) || left - right);
  return candidates.length ? iso(candidates[0]) : '';
}

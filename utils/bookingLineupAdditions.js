// The base lineup remains the contract snapshot. Only explicitly marked extras
// add performers; a doubled instrument or a service is not another musician.
export const bookingExtras = (row = {}) => row.extras ?? row.bookingDetails?.extras
  ?? row.actsSummary?.[0]?.selectedExtras ?? [];
export const additionalMusicianRoles = (row = {}) => bookingExtras(row).flatMap(extra => {
  if (extra.addsMusician !== true) return [];
  const role = String(extra.musicianRole || extra.name || extra.key || '').trim();
  const count = Math.max(0, Math.min(50, Math.floor(Number(extra.quantity ?? 1) || 0)));
  return role ? Array(count).fill(role) : [];
});
export const effectiveLineupRoles = (row = {}, baseRoles = row.lineupComposition || []) =>
  [...baseRoles, ...additionalMusicianRoles(row)];
export const lineupDisplayLabel = (row = {}) => {
  const label = row.lineupSelected || row.actsSummary?.[0]?.lineupLabel || '';
  const additions = additionalMusicianRoles(row);
  if (!additions.length) return label;
  const baseCount = row.lineupComposition?.length || Number(row.bandSize)
    || Number(label.match(/(\d+)\s*[- ]?piece/i)?.[1]) || 0;
  const names = [...new Set(additions)].map(role => {
    const count = additions.filter(value => value === role).length;
    return count > 1 ? `${count} × ${role}` : role;
  });
  return `${label} + ${names.join(' + ')}${baseCount ? ` (${baseCount + additions.length} musicians)` : ''}`;
};

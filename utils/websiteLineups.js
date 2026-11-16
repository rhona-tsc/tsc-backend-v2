// Keep unpublished options in the source record for administration and past bookings.
export function websiteActView(act) {
  const hidden = new Set((act?.hiddenWebsiteLineupIds || []).map(String));
  if (!hidden.size || !Array.isArray(act?.lineups)) return act;
  const source = typeof act.toObject === 'function' ? act.toObject({ depopulate: true }) : act;
  return { ...source, lineups: source.lineups.filter(lineup =>
    ![lineup.lineupId, lineup._id].filter(Boolean).some(id => hidden.has(String(id)))) };
}

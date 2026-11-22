// Keep unpublished options in the source record for administration and past bookings.
export const isEnquiryOnlyLineup = lineup => lineup?.websiteVisibility === 'enquiry';

export function websiteActView(act) {
  const hidden = new Set((act?.hiddenWebsiteLineupIds || []).map(String));
  if (!Array.isArray(act?.lineups)) return act;
  if (!hidden.size && !act.lineups.some(isEnquiryOnlyLineup)) return act;
  const source = typeof act.toObject === 'function' ? act.toObject({ depopulate: true }) : act;
  const lineups = source.lineups.filter(lineup => !isEnquiryOnlyLineup(lineup) &&
    ![lineup.lineupId, lineup._id].filter(Boolean).some(id => hidden.has(String(id))));
  const result = { ...source, lineups };
  // Price cards must use the same catalogue as the visible lineup selector.
  if (source.supplierPricing?.lineups) {
    const visibleIds = new Set(lineups.flatMap(l => [l._id, l.lineupId].filter(Boolean).map(String)));
    result.supplierPricing = { ...source.supplierPricing, lineups: Object.fromEntries(
      Object.entries(source.supplierPricing.lineups).filter(([id]) => visibleIds.has(id))) };
  }
  return result;
}

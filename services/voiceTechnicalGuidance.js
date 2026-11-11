// Curated, general guidance only. Historical client details and unverified power totals are excluded.
const stageWidths = { 3: 4, 4: 4, 5: 4, 6: 5, 7: 5, 8: 5, 9: 6, 10: 6 };
export function getVoiceTechnicalGuidance({ topic, bandSize } = {}) {
  if (!['stage', 'lighting', 'power'].includes(topic)) throw new Error('Choose stage, lighting or power.');
  const base = { topic, guidanceOnly: true, bookingChecked: false, supplierConfirmed: false, checkedAt: '2026-11-11' };
  if (topic === 'stage') {
    if (!Number.isInteger(bandSize) || !stageWidths[bandSize]) return { ...base, needsClarification: true, note: 'Confirm the performer count. The supplied guide covers three to ten performers; other sizes need a band-specific layout.' };
    return { ...base, bandSize, suggestedWidthMetres: stageWidths[bandSize], suggestedDepthMetres: 3,
      note: 'Approximate clear performance-area planning guide from TSC’s supplied one-metre-grid chart, not a certified minimum or a guaranteed fit. Confirm the actual lineup, venue layout and PA/lighting positions with the band. For a constrained area, take the venue dimensions and pass the question to management.' };
  }
  if (topic === 'lighting') return { ...base,
    typicalOptions: ['Disco lights with colours changing to the music', 'Stage uplights or wash bars behind/on the performance area, often lighting amps', 'Sometimes LED disco-ball effects'],
    note: 'The actual package varies with the band and assigned equipment supplier. Do not promise particular fixtures, quantities, lasers, haze, whole-room uplighting or a specific show. Save any requested lighting or restrictions for management to confirm.' };
  return { ...base, confirmedTotalWatts: null, confirmedTotalAmps: null, needsManagementReview: true,
    note: 'Exact supply requirements need the confirmed PA/lighting supplier, current models, quantities and venue supply. Do not quote their totals as a current rider, convert speaker output ratings to mains draw, infer current from watts alone, or guarantee socket/circuit/generator capacity. Offer to record the band/date/venue and the venue’s question for management and its competent electrical supplier to confirm.' };
}

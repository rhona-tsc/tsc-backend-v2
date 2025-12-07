// services/buildActFilterCard.js
function canonicalInstruments(act) { /* your splitter + alias logic */ }
function deriveWirelessMap(act) { /* map {Vocal,true, Guitar,false, ...} */ }
function minDbFromLineups(act) { /* scan l.db -> number */ }
function setupFlags(act) { /* supports60/supports90 from totalSetupAndSoundcheckTime; hasSpeedySetup via extras */ }
function paLightFlags(act) { /* normalise to {pa:{...}, light:{...}} */ }
function ceremonyAfternoonFlags(act) { /* true/false for solo/duo/trio/fourpiece */ }
function extrasFlags(act) { /* mark true when extra has price>0 or complimentary */ }
function lineupSizes(act) { return [...new Set((act.lineups||[]).map(l=>l.actSize).filter(Boolean))]; }
function smallestLineupSize(act) { /* min bandMembers.length */ }
function travelSummary(act) {
  const perMile = Number(act.costPerMile) > 0;
  const county = !!act.useCountyTravelFee;
  return {
    type: county ? "county" : perMile ? "per-mile" : "mu",
    useCountyTravelFee: !!act.useCountyTravelFee,
    costPerMile: Number(act.costPerMile) || 0,
    hasCountyFees: !!act.countyFees && Object.keys(act.countyFees).length > 0,
  };
}

function buildCard(act) {
  return {
    actId: act._id,
    name: act.name,
    tscName: act.tscName,
    status: act.status,
    isTest: !!(act.isTest || act.actData?.isTest),
    genres: Array.isArray(act.genre) ? act.genre : [],
    lineupSizes: lineupSizes(act),
    instruments: canonicalInstruments(act),
    wirelessByInstrument: deriveWirelessMap(act),

    hasElectricDrums: /* from lineups/extras */,
    hasIEMs: /* from lineups/extras */,
    canMakeAcoustic: /* from flags */,
    canRemoveDrums: /* from flags */,
    minDb: minDbFromLineups(act),

    ...setupFlags(act),
    ...paLightFlags(act),

    pliAmount: Number(act.pliAmount) || 0,
    extras: extrasFlags(act),

    ...ceremonyAfternoonFlags(act),

    travelModel: travelSummary(act),
    smallestLineupSize: smallestLineupSize(act),
  };
}

module.exports = { buildCard };
// frontend/src/pages/utils/pricing.jsx
// Optional: Outcode → County mapping
import outcodeToCounty from "./outcodeToCounty";
import getTravelV2 from "./travelV2";

export function calculateActPricing(act, selectedLineupName, derivedCounty, isNorthernGig) {
  console.group(`\n=== Calculating Pricing for Act: ${act.name} ===`);
  console.log(`Selected Lineup: ${selectedLineupName}`);
  console.log(`Derived County: ${derivedCounty}`);
  console.log(`Is Northern Gig: ${isNorthernGig}`);

  console.log('Act meta:', {
    managementFee: act.managementFee ?? 0,
    margin: act.margin ?? 0,
    costPerMile: act.costPerMile ?? 0,
    muRates: act.muRates ?? 0,
    travelMiles: act.travelMiles ?? 0
  });

  const lineup = act.lineups.find(l => l.name === selectedLineupName);
  if (!lineup) {
    console.warn('Lineup not found, returning zero pricing.');
    console.groupEnd();
    return { total: 0, travelFee: 0, grossTotal: 0 };
  }

  let subtotal = 0;
  console.group('Band Members (pricing inputs)');
  lineup.members.forEach((member, idx) => {
    const roleFees = Number(member.roleFees || 0);
    const baseFee  = Number(member.baseFee || 0);
    const essential = !!member.essential;
    const addRoles = Array.isArray(member.additionalRoles) ? member.additionalRoles : [];
    const essentialRoles = addRoles.filter(r => r?.isEssential).map(r => ({
      role: r?.role || r?.title || 'n/a',
      fee: Number(r?.additionalFee || r?.fee || 0)
    }));
    const essentialRolesTotal = essentialRoles.reduce((s, r) => s + (r.fee || 0), 0);
    const memberTotal = baseFee + roleFees + essentialRolesTotal;

    console.group(`#${idx+1} ${member.name || (member.firstName + ' ' + (member.lastName || '')).trim()}`);
    console.table({
      instrument: member.instrument,
      isEssential: essential,
      travelEligible: !!member.travelEligible,
      baseFee,
      roleFees,
      essentialRolesTotal,
      memberTotal
    });
    if (essentialRoles.length) {
      console.table(essentialRoles);
    }
    console.groupEnd();

    subtotal += memberTotal;
  });
  console.groupEnd();

  console.log(`Subtotal before travel: ${subtotal}`);

  // Travel Fee Calculation
  let travelFee = 0;
  const countyData = getCountyData(derivedCounty);
  if (countyData?.countyFee) {
    travelFee = countyData.countyFee;
    console.log(`Using countyFee for travel: ${travelFee}`);
  } else if (countyData?.costPerMile) {
    const miles = act.travelMiles || 0;
    travelFee = miles * countyData.costPerMile;
    console.log(`Using costPerMile: ${countyData.costPerMile} * miles: ${miles} = travelFee: ${travelFee}`);
  } else if (act.muRates) {
    travelFee = act.muRates * (act.travelMiles || 0);
    console.log(`Using MU rates: ${act.muRates} * travelMiles: ${act.travelMiles || 0} = travelFee: ${travelFee}`);
  } else {
    console.log('No travel fee data found, travelFee set to 0.');
  }

  console.log('Travel fee computed:', travelFee);

  // Per-member travel cost breakdown
  console.group('Per Member Travel Costs');
  const perMemberTravel = (travelFee / Math.max(1, lineup.members.length));
  console.table(lineup.members.map(m => ({
    name: m.name || [m.firstName, m.lastName].filter(Boolean).join(' '),
    instrument: m.instrument,
    travelEligible: !!m.travelEligible,
    perMemberTravel: perMemberTravel.toFixed(2)
  })));
  console.groupEnd();

  // Management and travel eligibility
  const managementFeeApplicable = act.managementFee && act.managementFee > 0;
  const eligibleForTravel = lineup.members.filter(m => m.travelEligible).length;
  console.log(`Management Fee Applicable: ${managementFeeApplicable}`);
  console.log(`Number of members eligible for travel: ${eligibleForTravel}`);

  // Final totals
  const total = subtotal + travelFee + (managementFeeApplicable ? act.managementFee : 0);
  const commissionRate = act.margin ?? 0; // treating act.margin as commission %
  const commissionFee  = total * commissionRate;
  console.log('Breakdown:', {
    membersSubtotal: subtotal,
    travelFee,
    managementFee: (act.managementFee && act.managementFee > 0) ? act.managementFee : 0,
    preCommissionTotal: total,
    commissionRate,
    commissionFee,
    grossTotal: total + commissionFee
  });
  const grossTotal = total + commissionFee;

  console.log(`Final Totals: subtotal(${subtotal}) + travelFee(${travelFee}) + managementFee(${managementFeeApplicable ? act.managementFee : 0}) = total(${total})`);
  console.log(`Margin: ${commissionRate * 100}%`);
  console.log(`Gross Total after margin: ${grossTotal}`);

  console.groupEnd();

  return { total, travelFee, grossTotal };
}

export default calculateActPricing;

// Extras
export function calculateExtraPrice({ extra, act, lineup, address, date }) {
  const key = extra?.key;

  const lineupSize =
    Number(lineup?.bandMembers?.length) ||
    Number(lineup?.actSize) ||
    Number(lineup?.actSizeCount) ||
    0;

  const getBaseFromActExtras = (k) => {
    const extras = act?.extras;
    if (!extras) return 0;
    const raw = typeof extras.get === "function" ? extras.get(k) : extras?.[k];
    if (typeof raw === "number") return Number(raw) || 0;
    if (raw && typeof raw === "object") {
      const price = raw.price != null ? Number(raw.price) : 0;
      return isNaN(price) ? 0 : price;
    }
    return 0;
  };

  // Per-member-per-60
  if (
    key === "late_stay_60min_per_band_member" ||
    key === "early_arrival_60min_per_band_member"
  ) {
    const base = getBaseFromActExtras(key);
    const minutes = Number(extra?.minutes || 60);
    const blocks = minutes / 60;
    return base * lineupSize * blocks;
  }

  if (/_per_band_member$/.test(String(key || ""))) {
    const base = getBaseFromActExtras(key);
    const minutes = Number(extra?.minutes || 60);
    const blocks = minutes / 60;
    return base * lineupSize * blocks;
  }

  if (extra?.flatPrice != null) return Number(extra.flatPrice) || 0;

  const fallbackBase =
    extra?.basePrice != null ? Number(extra.basePrice) : getBaseFromActExtras(key);
  return isNaN(fallbackBase) ? 0 : fallbackBase;
}
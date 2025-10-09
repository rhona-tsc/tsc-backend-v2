import { getCountyData } from './locations';

export function calculateActPricing(act, selectedLineupName, derivedCounty, isNorthernGig) {
  console.group(`\n=== Calculating Pricing for Act: ${act.name} ===`);
  console.log(`Selected Lineup: ${selectedLineupName}`);
  console.log(`Derived County: ${derivedCounty}`);
  console.log(`Is Northern Gig: ${isNorthernGig}`);

  const lineup = act.lineups.find(l => l.name === selectedLineupName);
  if (!lineup) {
    console.warn('Lineup not found, returning zero pricing.');
    console.groupEnd();
    return { total: 0, travelFee: 0, grossTotal: 0 };
  }

  let subtotal = 0;
  console.group('Band Members Details:');
  lineup.members.forEach(member => {
    console.group(`Member: ${member.name}`);
    console.log(`Instrument: ${member.instrument}`);
    console.log(`Base Fee: ${member.baseFee}`);
    const essentialRole = member.essential ? 'Yes' : 'No';
    console.log(`Essential Role: ${essentialRole}`);
    const roleFees = member.roleFees || 0;
    console.log(`Role Fees: ${roleFees}`);
    console.groupEnd();

    subtotal += member.baseFee + (member.roleFees || 0);
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

  // Per-member travel cost breakdown
  console.group('Per Member Travel Costs:');
  lineup.members.forEach(member => {
    const memberTravel = (travelFee / lineup.members.length) || 0;
    console.log(`${member.name}: ${memberTravel.toFixed(2)}`);
  });
  console.groupEnd();

  // Management and travel eligibility
  const managementFeeApplicable = act.managementFee && act.managementFee > 0;
  const eligibleForTravel = lineup.members.filter(m => m.travelEligible).length;
  console.log(`Management Fee Applicable: ${managementFeeApplicable}`);
  console.log(`Number of members eligible for travel: ${eligibleForTravel}`);

  // Final totals
  const total = subtotal + travelFee + (managementFeeApplicable ? act.managementFee : 0);
  const margin = act.margin || 0;
  const grossTotal = total * (1 + margin);

  console.log(`Final Totals: subtotal(${subtotal}) + travelFee(${travelFee}) + managementFee(${managementFeeApplicable ? act.managementFee : 0}) = total(${total})`);
  console.log(`Margin: ${margin * 100}%`);
  console.log(`Gross Total after margin: ${grossTotal}`);

  console.groupEnd();

  return { total, travelFee, grossTotal };
}
import Act from '../models/actModel.js';
import calculateWebsitePrice from './websiteLineupPricing.js';
import { validPostcode } from './voiceVenueLookup.js';

// Private calculation inputs never leave this service. The assistant receives only the retail total.
export const VOICE_PRICE_FIELDS = '_id tscName status isTest useCountyTravelFee countyFees costPerMile useDifferentTeamForNorthernGigs northernTeam.instrument northernTeam.postCode northernTeam.isManager northernTeam.isNonPerformer northernTeam.additionalRoles.role lineups._id lineups.lineupId lineups.actSize lineups.bandMembers.instrument lineups.bandMembers.isEssential lineups.bandMembers.fee lineups.bandMembers.additionalRoles.role lineups.bandMembers.additionalRoles.isEssential lineups.bandMembers.additionalRoles.additionalFee lineups.bandMembers.postCode lineups.bandMembers.countyTravelFees lineups.bandMembers.isManager lineups.bandMembers.isNonPerformer';
const manager = member => member.isManager || member.isNonPerformer || /\bmanager|management\b/i.test(member.instrument || '') || member.additionalRoles?.some(role => /\bmanager|management\b/i.test(role.role || ''));
const amount = value => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0;
const countyFee = (table, county) => Object.entries(table || {}).find(([key])=>key.toLowerCase().trim() === county.toLowerCase().trim())?.[1];

export async function readVoiceTravel(origin, destination, dateISO, request = fetch) {
  if (!validPostcode(origin) || !validPostcode(destination)) throw new Error('Travel needs full postcodes.');
  const query = new URLSearchParams({ origin, destination, date: dateISO });
  const response = await request(`https://tsc-backend-v2.onrender.com/api/v2/travel/travel-data?${query}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6500) });
  if (!response.ok) throw new Error('Travel could not be calculated.');
  const data = await response.json();
  for (const leg of [data.outbound, data.returnTrip]) if (!Number.isFinite(leg?.distance?.value) || !Number.isFinite(leg?.duration?.value) || leg.distance.value < 0 || leg.duration.value < 0) throw new Error('A travel leg is incomplete.');
  return { outbound: data.outbound, returnTrip: data.returnTrip, miles: data.outbound.distance.value/1609.34 };
}

export async function lookupVoiceLineupPrice({ actId, lineupId, eventDateISO, venue }, { loadAct, travel = readVoiceTravel, now = new Date() } = {}) {
  if (!/^[a-f\d]{24}$/i.test(actId || '') || typeof lineupId !== 'string' || !lineupId || lineupId.length > 100) throw new Error('Choose one exact published band lineup.');
  const eventDate = new Date(`${eventDateISO}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDateISO || '') || !Number.isFinite(+eventDate) || eventDate.toISOString().slice(0,10) !== eventDateISO || eventDateISO < now.toISOString().slice(0,10)) throw new Error('Confirm the future event date, including year.');
  if (!venue || !validPostcode(venue.postcode) || !venue.county || !venue.postcodeValidated || venue.countyConflict || venue.addressIncomplete) throw new Error('Confirm the venue address, county and full postcode before pricing.');
  const act = await (loadAct || (id=>Act.findById(id).select(VOICE_PRICE_FIELDS).maxTimeMS(3000).lean()))(actId);
  const unavailable = reason => ({ priceAvailable: false, testMode: true, reason, bookingConfirmed: false, availabilityChecked: false });
  if (!act || act.isTest || !['approved','live','approved_changes_pending','live_changes_pending'].includes(act.status)) return unavailable('This band needs management review.');
  const lineup = act.lineups?.find(item=>String(item.lineupId || item._id) === lineupId);
  if (!lineup?.bandMembers?.length || lineup.bandMembers.length > 20) return unavailable('The selected lineup needs review.');
  const performers = lineup.bandMembers.filter(member=>!manager(member));
  const declaredSize = Number(String(lineup.actSize || '').match(/\d+/)?.[0]);
  if (!declaredSize || declaredSize !== performers.length) return unavailable('The lineup size needs management verification.');
  if (lineup.bandMembers.some(member=>!manager(member) && member.isEssential && !amount(member.fee) || member.additionalRoles?.some(role=>role.isEssential && !amount(role.additionalFee)))) return unavailable('The lineup price has incomplete fee information.');
  // A different regional team must be reconciled to this exact lineup before we quote it.
  if (act.useDifferentTeamForNorthernGigs) return unavailable('Regional team pricing needs management confirmation for this lineup.');
  const tableFee = countyFee(act.countyFees, venue.county);
  const countyPricing = act.useCountyTravelFee && Number(tableFee) > 0;
  if (countyPricing && performers.some(member=>{const fee=countyFee(member.countyTravelFees,venue.county);return fee !== undefined && !amount(fee);})) return unavailable('County travel fees need management review.');
  if (!countyPricing && performers.some(member=>!validPostcode(member.postCode))) return unavailable('Travel information is incomplete. Someone from the team needs to confirm the price.');
  try {
    const cache = new Map();
    const checkedTravel = async (origin, destination, date) => {
      const key = `${origin}|${destination}|${date}`;
      if (!cache.has(key)) cache.set(key, travel(origin, venue.postcode, date));
      return cache.get(key);
    };
    const result = await calculateWebsitePrice(act, venue.county, venue.postcode, eventDateISO, lineup, checkedTravel);
    if (!Number.isFinite(result?.total) || result.total <= 0 || result.total > 100000 || result.travelCalculated !== true) return unavailable('A complete travel-inclusive price could not be verified.');
    return { priceAvailable: true, priceGBP: result.total, currency: 'GBP', bandName: act.tscName, actId, lineupId, performerCount: performers.length,
      eventDateISO, venueName: venue.name, county: venue.county, postcode: venue.postcode, travelIncluded: true,
      priceBasis: 'Current website lineup estimate including calculated travel; standard package only. Extras, availability and final booking terms still need confirmation.',
      testMode: true, availabilityChecked: false, bookingConfirmed: false };
  } catch { return unavailable('Travel pricing is temporarily unavailable. Save the enquiry for management; do not quote a base-only total as travel-inclusive.'); }
}

import { postcodes } from '../utils/postcodes.js';
import { sortedVocalContacts } from '../utils/enquiryAvailability.js';
const key = value => String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
const entries = value => value instanceof Map ? [...value] : Object.entries(value || {});
const counties = [...new Set(['london', ...Object.keys(postcodes[0] || {}).map(key)])];
const comparable = value => key(value) === 'london' ? 'greater london' : key(value);
const title = value => value.replace(/\b\w/g, c => c.toUpperCase());
const full = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const outward = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\b/i;
export function countyRate(map, county) {
  const match = entries(map).find(([name]) => key(name) === key(county));
  if (!match || match[1] === '' || match[1] == null || !Number.isFinite(Number(match[1])) || Number(match[1]) < 0) return null;
  return Number(match[1]);
}
export function namedEnquiryCounty(value) {
  const input = key(value);
  // Exact comma-delimited place, not a substring such as West Sussex -> Sussex.
  const matches = [...new Set(input.split(',').map(part => counties.includes(part.trim()) ? part.trim() : '').filter(Boolean))];
  return matches.length === 1 ? title(matches[0]) : '';
}
export function resolveEnquiryLocation({ address = '', county = '' } = {}) {
  const text = String(address || '').trim();
  const supplied = county ? namedEnquiryCounty(county) : '';
  if (county && !supplied) return { eligible: false, reason: 'Choose a recognised county.' };
  const named = namedEnquiryCounty(text);
  if (supplied && named && comparable(supplied) !== comparable(named)) return { eligible: false, reason: 'The address and county disagree. Confirm the county before sending.' };
  const postcode = text.match(full)?.[0]?.toUpperCase() || '';
  const outcode = postcode ? postcode.match(outward)?.[0] : text.match(outward)?.[0]?.toUpperCase() || '';
  const postcodeCounties = outcode ? Object.entries(postcodes[0] || {}).filter(([, codes]) => codes.includes(outcode)).map(([name]) => title(key(name))) : [];
  if (supplied && postcodeCounties.length && !postcodeCounties.some(name => comparable(name) === comparable(supplied))) return { eligible: false, reason: 'The postcode and county disagree. Confirm the location before sending.' };
  const selectedCounty = supplied || named || (postcodeCounties.length === 1 ? postcodeCounties[0] : '');
  const precision = postcode ? 'postcode' : outcode ? 'outcode' : selectedCounty ? 'county' : 'unknown';
  return { eligible: precision !== 'unknown', reason: precision === 'unknown' ? 'Add a county or a full or partial postcode.' : '', county: selectedCounty, postcode, outcode, precision,
    address: text && !/^tbc$/i.test(text) ? text : selectedCounty,
    shortAddress: [selectedCounty, postcode || outcode].filter(Boolean).join(', ') || text };
}
export function countyVocalistTravel(act, member, county) {
  const personal = countyRate(member?.countyTravelFees, county);
  if (personal !== null) return personal;
  return act?.useCountyTravelFee === true ? countyRate(act.countyFees, county) : null;
}
export function enquiryLocationEligibility(act, lineup, input) {
  const location = resolveEnquiryLocation(input);
  if (!location.eligible) return location;
  const mode = act?.enquiryLocationMode || 'auto';
  if (mode === 'full_postcode' && location.precision !== 'postcode') return { ...location, eligible: false, reason: 'This act needs a full postcode to quote and check availability.' };
  if (location.precision !== 'county') return location;
  const vocalists = sortedVocalContacts(lineup);
  const hasPersonalRates = vocalists.length > 0 && vocalists.every(m => countyRate(m.countyTravelFees, location.county) !== null);
  const countyBased = mode === 'county' || (mode === 'auto' && (act?.useCountyTravelFee === true || hasPersonalRates));
  if (!countyBased) return { ...location, eligible: false, reason: 'This act needs a full or partial postcode to quote and check availability.' };
  if (vocalists.some(m => countyVocalistTravel(act, m, location.county) === null)) return { ...location, eligible: false, reason: `Confirm this lineup’s vocalist travel fee for ${location.county}; no request will be sent with an estimated fee.` };
  return location;
}
export function requireEnquiryLocation(act, lineup, input) {
  const result = enquiryLocationEligibility(act, lineup, input);
  if (!result.eligible) throw Object.assign(new Error(result.reason), { code: 'ENQUIRY_LOCATION_REQUIRED' });
  return result;
}

import crypto from 'node:crypto';
import Venue from '../models/venueModel.js';

const clean = (value, max = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
export const normalPostcode = value => clean(value, 20).toUpperCase().replace(/\s/g, '').replace(/(.{3})$/, ' $1').trim();
export const validPostcode = value => /^(GIR 0AA|[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2})$/.test(normalPostcode(value));
const literal = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idFor = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
// A verified public reference is useful when a spoken venue name is misheard.
const REFERENCES = [{ name: 'Hedsor House', aliases: ['hedsor', 'hepsture house', 'heads or house'], address: 'Hedsor House, Hedsor Park, Taplow, Buckinghamshire, SL6 0HX', postcode: 'SL6 0HX', county: 'Buckinghamshire', source: 'https://www.hedsor.com/contact-us/visit-us' }];
export async function postcodeDetails(postcode, request = fetch) {
  if (!validPostcode(postcode)) return null;
  const response = await request(`https://api.postcodes.io/postcodes/${encodeURIComponent(normalPostcode(postcode))}`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  const data = (await response.json()).result;
  if (!data || normalPostcode(data.postcode) !== normalPostcode(postcode) || data.country !== 'England' && !['Scotland', 'Wales', 'Northern Ireland'].includes(data.country)) return null;
  const district = clean(data.admin_district);
  const historicCounties = { 'Windsor and Maidenhead': 'Berkshire', 'West Berkshire': 'Berkshire', Reading: 'Berkshire', Slough: 'Berkshire', Wokingham: 'Berkshire', 'Bracknell Forest': 'Berkshire', Buckinghamshire: 'Buckinghamshire', 'Wiltshire': 'Wiltshire', 'Cornwall': 'Cornwall', 'Dorset': 'Dorset', 'Northumberland': 'Northumberland', 'County Durham': 'County Durham', 'Shropshire': 'Shropshire', 'Isle of Wight': 'Isle of Wight', 'Herefordshire, County of': 'Herefordshire', 'East Riding of Yorkshire': 'East Yorkshire' };
  const county = data.region === 'London' ? 'Greater London' : clean(data.admin_county) || historicCounties[district] || '';
  return { postcode: normalPostcode(data.postcode), county, district, source: 'https://postcodes.io' };
}
export async function lookupVoiceVenues(input = {}, { loadVenues, request = fetch, mapsKey = process.env.GOOGLE_MAPS_API_KEY } = {}) {
  const query = clean(input.query, 180), postcode = clean(input.postcode, 20);
  if (query.length < 3 && !validPostcode(postcode)) throw new Error('Ask for the venue name and town or full postcode.');
  if (postcode && !validPostcode(postcode)) throw new Error('Ask the caller to repeat the full postcode, including the last three characters.');
  let candidates = REFERENCES.filter(item => item.aliases.some(alias => query.toLowerCase().includes(alias)) || postcode && normalPostcode(postcode) === item.postcode);
  const load = loadVenues || (async () => Venue.find(postcode ? { postcode: normalPostcode(postcode) } : { $or: [{ name: { $regex: literal(query), $options: 'i' } }, { aliases: { $regex: literal(query), $options: 'i' } }] }).select('_id name address postcode county').limit(3).maxTimeMS(3000).lean());
  const local = await load({ query, postcode: normalPostcode(postcode) });
  candidates.push(...local.map(item => ({ name: clean(item.name), address: clean(item.address, 400), postcode: normalPostcode(item.postcode), county: clean(item.county, 100), source: 'TSC venue reference' })));
  if (!candidates.length && mapsKey) {
    try {
      const response = await request('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': mapsKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents' }, body: JSON.stringify({ textQuery: `${query} ${postcode} United Kingdom`.trim(), regionCode: 'GB', languageCode: 'en', pageSize: 3 }), signal: AbortSignal.timeout(6000) });
      if (response.ok) for (const place of (await response.json()).places || []) {
        const component = type => clean(place.addressComponents?.find(item => item.types?.includes(type))?.longText);
        if (component('country') !== 'United Kingdom') continue;
        candidates.push({ name: clean(place.displayName?.text), address: clean(place.formattedAddress, 400), postcode: normalPostcode(component('postal_code')), county: component('administrative_area_level_2'), source: 'Google Maps' });
      }
    } catch { /* A failure must become a manual confirmation, never an invented address. */ }
  }
  if (!candidates.length && validPostcode(postcode)) {
    const details = await postcodeDetails(postcode, request).catch(() => null);
    if (details) candidates.push({ name: query, address: `${query}, ${details.district}, ${details.postcode}`, ...details, addressIncomplete: true });
  }
  const seen = new Set(), venues = [];
  for (const item of candidates.slice(0, 6)) {
    if (!item.name || !validPostcode(item.postcode) || postcode && normalPostcode(postcode) !== normalPostcode(item.postcode)) continue;
    const key = `${item.name.toLowerCase()}|${item.postcode}`;
    if (seen.has(key)) continue; seen.add(key);
    const details = await postcodeDetails(item.postcode, request).catch(() => null);
    const county = item.county || details?.county || '';
    const venue = { name: item.name, address: item.address, postcode: item.postcode, county, source: item.source, addressIncomplete: !!item.addressIncomplete,
      postcodeValidated: !!details, countyConflict: !!(item.county && details?.county && item.county !== details.county), postcodeCounty: details?.county || '' };
    venues.push({ ...venue, venueId: idFor(venue), needsCallerConfirmation: true });
    if (venues.length === 3) break;
  }
  return { venues, readOnly: true, travelPriceConfirmed: false, instruction: venues.length ? 'Read the venue name, address, county and full postcode back. Ask for confirmation; never pick silently. If address is incomplete or county conflicts, ask for clarification. A postcode is not a full street address.' : 'Ask the caller to spell the venue and full postcode. Save unresolved location for management; do not invent a county or quote travel.' };
}

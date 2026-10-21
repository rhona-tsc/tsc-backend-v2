import Act from '../models/actModel.js';
import Musician from '../models/musicianModel.js';
import Venue from '../models/venueModel.js';
import { locationImageUrl } from './locationImage.js';

export const locationCounties = ['London', 'Kent', 'Essex', 'Surrey', 'Hertfordshire', 'West Sussex', 'Berkshire', 'Oxfordshire', 'Cambridgeshire', 'Buckinghamshire', 'East Sussex', 'North Yorkshire'];
const clean = value => String(value || '').trim();
const key = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const emailKey = value => clean(value).toLowerCase();
export const canonicalCounty = value => {
  const label = key(value);
  if (/^(?:(?:greater|central|north|south|east|west|north west|north east|south west|south east) )?london$/.test(label)) return 'London';
  return locationCounties.find(county => key(county) === label) || '';
};

export const reviewCounty = (value, venues = []) => {
  const direct = canonicalCounty(value);
  if (direct) return direct;
  const text = key(value);
  const matchingVenues = venues.filter(venue => key(venue.name).length > 5 && text.includes(key(venue.name)));
  const venueCounties = [...new Set(matchingVenues.map(venue => canonicalCounty(venue.county)).filter(Boolean))];
  if (venueCounties.length === 1) return venueCounties[0];
  const counties = locationCounties.filter(county => new RegExp(`\\b${county.toLowerCase()}\\b`).test(text));
  return counties.length === 1 ? counties[0] : '';
};

// Only county-level results leave this service. No member identity, address,
// postcode, contact information, fees or banking details enter the public data.
export const buildLocationPages = (acts, musicians, venues) => {
  const byId = new Map(musicians.map(musician => [String(musician._id), musician]));
  const byEmail = new Map();
  for (const musician of musicians) {
    const email = emailKey(musician.email);
    if (email) byEmail.set(email, byEmail.has(email) ? null : musician);
  }
  const originals = new Map(acts.map(act => {
    const profiles = new Map();
    for (const member of (act.lineups || []).flatMap(lineup => lineup.bandMembers || [])) {
      const emailProfile = byEmail.get(emailKey(member.email));
      const sameName = emailProfile && key(member.firstName) && key(member.lastName)
        && key(member.firstName) === key(emailProfile.firstName || emailProfile.basicInfo?.firstName)
        && key(member.lastName) === key(emailProfile.lastName || emailProfile.basicInfo?.lastName);
      const profile = byId.get(clean(member.musicianId)) || (sameName ? emailProfile : null);
      // Do not infer residence from legacy member postcodes: these may be
      // administrative placeholders. Deputies are deliberately not traversed.
      if (profile) profiles.set(String(profile._id), profile);
    }
    return [String(act._id), [...profiles.values()]];
  }));

  return Object.fromEntries(locationCounties.map(county => {
    const localVenues = venues.filter(venue => canonicalCounty(venue.county) === county && clean(venue.name) && !/^(?:private|home|residential)(?:\s|$)/i.test(venue.name) && !/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(venue.name));
    const performed = new Set(localVenues.flatMap(venue => (venue.visits || []).map(visit => key(visit.actName))));
    const bands = acts.filter(act => act.slug && !act.slug.startsWith('test-')).map(act => ({
      id: String(act._id), name: act.tscName || act.name, slug: act.slug,
      image: locationImageUrl(act),
      description: clean(act.tscDescription || act.description).replace(/<[^>]*>/g, ''),
      genres: Array.isArray(act.genre) ? act.genre.filter(value => typeof value === 'string') : [],
      hasLocalOriginal: originals.get(String(act._id)).some(profile => canonicalCounty(profile.address?.county) === county),
      hasVenueExperience: performed.has(key(act.tscName || act.name)),
    })).sort((a, b) => Number(b.hasLocalOriginal) - Number(a.hasLocalOriginal) || Number(b.hasVenueExperience) - Number(a.hasVenueExperience) || a.name.localeCompare(b.name));
    const seen = new Set();
    const reviews = acts.flatMap(act => (act.reviews || []).filter(review => review.verified === true && clean(review.comment) && reviewCounty(review.eventLocation, venues) === county).map(review => ({
      id: String(review._id || review.reviewId || ''), actName: act.tscName || act.name, actSlug: act.slug,
      author: clean(review.clientFirstName).slice(0, 60) || 'Client',
      comment: clean(review.comment), eventType: clean(review.eventType),
      ...(review.eventDate && !Number.isNaN(new Date(review.eventDate).getTime()) ? { eventDate: new Date(review.eventDate).toISOString().slice(0, 10) } : {}),
    }))).filter(review => {
      const signature = key(review.comment);
      if (seen.has(signature) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(review.comment)) return false;
      seen.add(signature); return true;
    }).sort((a, b) => (b.eventDate || '').localeCompare(a.eventDate || '')).slice(0, 6);
    return [county.toLowerCase().replace(/\s+/g, '-'), { county, bands, venues: localVenues.map(venue => ({ id: String(venue._id), name: venue.name, county: venue.county })).sort((a, b) => a.name.localeCompare(b.name)), reviews }];
  }));
};

let cache;
let expires = 0;
export const getLocationPages = async () => {
  if (cache && Date.now() < expires) return cache;
  const [acts, musicians, venues] = await Promise.all([
    Act.find({ status: 'approved' }).select('tscName name slug tscDescription description genre images.url images.locationCrop coverImage.url lineups.bandMembers.musicianId lineups.bandMembers.email lineups.bandMembers.firstName lineups.bandMembers.lastName reviews').lean(),
    Musician.find({}).select('email firstName lastName basicInfo.firstName basicInfo.lastName address.county').lean(),
    Venue.find({}).select('name county visits.actName').lean(),
  ]);
  cache = buildLocationPages(acts, musicians, venues);
  expires = Date.now() + 60000;
  return cache;
};

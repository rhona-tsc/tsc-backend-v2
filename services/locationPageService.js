import Act from '../models/actModel.js';
import Musician from '../models/musicianModel.js';
import Venue from '../models/venueModel.js';
import { locationImageUrl } from './locationImage.js';
import { createActNameResolver } from './actNameMatching.js';
import { locationCounties, canonicalCounty, countyForReview, isPublicVenue } from './locationMatching.js';
import { buildPublicPerformanceHistory } from './publicPerformanceHistory.js';
export { locationCounties, canonicalCounty, reviewCounty } from './locationMatching.js';

const clean = value => String(value || '').trim();
const key = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const emailKey = value => clean(value).toLowerCase();

// Only county-level results leave this service. No member identity, address,
// postcode, contact information, fees or banking details enter the public data.
export const buildLocationPages = (acts, musicians, venues) => {
  const { venueHistories } = buildPublicPerformanceHistory(acts, venues);
  const resolveAct = createActNameResolver(acts);
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
    const localVenues = venues.filter(venue => canonicalCounty(venue.county) === county && isPublicVenue(venue));
    const performed = new Set(localVenues.flatMap(venue => (venue.visits || []).filter(visit => visit.eventDate && new Date(visit.eventDate) <= new Date()).map(visit => resolveAct(visit.actName, visit.actId)?.slug).filter(Boolean)));
    const bands = acts.filter(act => act.slug && !act.slug.startsWith('test-')).map(act => ({
      id: String(act._id), name: act.tscName || act.name, slug: act.slug,
      image: locationImageUrl(act),
      description: clean(act.tscDescription || act.description).replace(/<[^>]*>/g, ''),
      genres: Array.isArray(act.genre) ? act.genre.filter(value => typeof value === 'string') : [],
      hasLocalOriginal: originals.get(String(act._id)).some(profile => canonicalCounty(profile.address?.county) === county),
      hasVenueExperience: performed.has(act.slug),
    })).sort((a, b) => Number(b.hasLocalOriginal) - Number(a.hasLocalOriginal) || Number(b.hasVenueExperience) - Number(a.hasVenueExperience) || a.name.localeCompare(b.name));
    const seen = new Set();
    const reviews = acts.flatMap(act => (act.reviews || []).filter(review => review.verified === true && clean(review.comment) && countyForReview(review, venues) === county).map(review => ({
      id: String(review._id || review.reviewId || ''), actName: act.tscName || act.name, actSlug: act.slug,
      author: clean(review.clientFirstName).slice(0, 60) || 'Client',
      comment: clean(review.comment), eventType: clean(review.eventType),
      ...(review.eventDate && !Number.isNaN(new Date(review.eventDate).getTime()) ? { eventDate: new Date(review.eventDate).toISOString().slice(0, 10) } : {}),
    }))).filter(review => {
      const signature = key(review.comment);
      if (seen.has(signature) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(review.comment)) return false;
      seen.add(signature); return true;
    }).sort((a, b) => (b.eventDate || '').localeCompare(a.eventDate || '')).slice(0, 6);
    return [county.toLowerCase().replace(/\s+/g, '-'), { county, bands, examples: localVenues.flatMap(venue => venueHistories[String(venue._id)]?.examples || []), venues: localVenues.map(venue => ({
      id: String(venue._id),
      name: venue.name,
      county: venue.county,
      photoUrl: clean(venue.photoUrl),
      photoAlt: clean(venue.photoAlt) || `${venue.name} wedding venue`,
    })).sort((a, b) => a.name.localeCompare(b.name)), reviews }];
  }));
};

let cache;
let expires = 0;
export const getLocationPages = async () => {
  if (cache && Date.now() < expires) return cache;
  const [acts, musicians, venues] = await Promise.all([
    Act.find({ status: 'approved' }).select('tscName name slug tscDescription description genre images.url images.locationCrop coverImage.url lineups.bandMembers.musicianId lineups.bandMembers.email lineups.bandMembers.firstName lineups.bandMembers.lastName reviews').lean(),
    Musician.find({}).select('email firstName lastName basicInfo.firstName basicInfo.lastName address.county').lean(),
    Venue.find({}).select('name aliases county photoUrl photoAlt visits.actName visits.actId visits.eventDate').lean(),
  ]);
  cache = buildLocationPages(acts, musicians, venues);
  expires = Date.now() + 60000;
  return cache;
};

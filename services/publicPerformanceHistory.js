import Act from '../models/actModel.js';
import Venue from '../models/venueModel.js';
import { createActNameResolver } from './actNameMatching.js';
import { canonicalCounty, countySlug, isPublicVenue, countyForReview } from './locationMatching.js';
import { venueEveningExamples } from '../data/venueEveningExamples.js';

const nameKey = value => String(value || '').replace(/^for\s+(?:the\s+)?address\s+we\s+have\s*:\s*/i, '').trim().toLowerCase();
export function buildPublicPerformanceHistory(acts, venues, now = new Date()) {
  const resolve = createActNameResolver(acts);
  const eligible = venues.filter(isPublicVenue);
  const histories = Object.fromEntries(acts.filter(act => act.slug).map(act => [act.slug, {
    slug: act.slug, name: act.tscName || act.name, venues: [], examples: [],
    reviewCounties: (act.reviews || []).map((review, index) => {
      // Prefer recorded event location. Only use the review's own text when the
      // location field is blank; multiple possible counties remain unresolved.
      const county = countyForReview(review, eligible);
      return { reviewId: String(review._id || review.reviewId || ''), index, county, countySlug: countySlug(county) };
    }).filter(review => review.county),
  }]));
  const venueHistories = {};
  for (const venue of eligible) {
    const grouped = new Map();
    for (const visit of venue.visits || []) {
      const date = visit.eventDate && new Date(visit.eventDate);
      if (!date || !Number.isFinite(date.getTime()) || date > now) continue;
      const act = resolve(visit.actName, visit.actId);
      if (!act?.slug || !histories[act.slug]) continue;
      const month = date.toISOString().slice(0, 7);
      if (!grouped.has(act.slug)) grouped.set(act.slug, { name: act.tscName || act.name, slug: act.slug, months: new Set() });
      grouped.get(act.slug).months.add(month);
    }
    const performances = [...grouped.values()].map(item => ({ ...item, months: [...item.months].sort().reverse() })).sort((a,b) => a.name.localeCompare(b.name));
    const county = canonicalCounty(venue.county);
    const examples = venueEveningExamples.filter(example => nameKey(example.venueName) === nameKey(venue.name) && canonicalCounty(example.county) === county && histories[example.actSlug]).map(example => ({
      ...example, venueId: String(venue._id), venueCounty: venue.county,
      actName: histories[example.actSlug].name, countySlug: countySlug(county),
    }));
    venueHistories[String(venue._id)] = { performances, examples, county, countySlug: countySlug(county) };
    for (const performance of performances) histories[performance.slug].venues.push({
      id: String(venue._id), name: String(venue.name).replace(/^for\s+(?:the\s+)?address\s+we\s+have\s*:\s*/i, ''),
      county, venueCounty: venue.county, countySlug: countySlug(county), months: performance.months,
    });
    for (const example of examples) histories[example.actSlug].examples.push(example);
  }
  for (const history of Object.values(histories)) history.venues.sort((a,b) => a.name.localeCompare(b.name));
  return { histories, venueHistories };
}

let cached;
let expires = 0;
export async function getPublicPerformanceHistory() {
  if (cached && Date.now() < expires) return cached;
  const [acts, venues] = await Promise.all([
    Act.find({ status: 'approved' }).select('name tscName slug reviews._id reviews.reviewId reviews.eventLocation reviews.comment').lean(),
    Venue.find({}).select('name aliases county visits.actName visits.actId visits.eventDate').lean(),
  ]);
  cached = buildPublicPerformanceHistory(acts, venues);
  expires = Date.now() + 60000;
  return cached;
}

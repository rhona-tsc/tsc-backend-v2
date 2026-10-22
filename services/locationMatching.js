export const locationCounties = ['London', 'Kent', 'Essex', 'Surrey', 'Hertfordshire', 'West Sussex', 'Berkshire', 'Oxfordshire', 'Cambridgeshire', 'Buckinghamshire', 'East Sussex', 'North Yorkshire'];
export const locationKey = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const canonicalCounty = value => {
  const label = locationKey(value);
  if (/^(?:(?:greater|central|north|south|east|west|north west|north east|south west|south east) )?london$/.test(label)) return 'London';
  return locationCounties.find(county => locationKey(county) === label) || '';
};
export const reviewCounty = (value, venues = []) => {
  const direct = canonicalCounty(value);
  if (direct) return direct;
  const text = locationKey(value);
  const matchingVenues = venues.filter(venue => [venue.name, ...(venue.aliases || [])].some(name => {
    const key = locationKey(name);
    return key.length > 5 && (` ${text} `).includes(` ${key} `);
  }));
  const venueCounties = [...new Set(matchingVenues.map(venue => canonicalCounty(venue.county)).filter(Boolean))];
  if (venueCounties.length > 1) return '';
  const counties = locationCounties.filter(county => new RegExp(`\\b${county.toLowerCase()}\\b`).test(text));
  const matches = [...new Set([...venueCounties, ...counties])];
  return matches.length === 1 ? matches[0] : '';
};
export const countySlug = county => canonicalCounty(county).toLowerCase().replace(/\s+/g, '-');
export function countyForReview(review, venues = []) {
  if (String(review.eventLocation || '').trim()) return reviewCounty(review.eventLocation, venues);
  const text = locationKey(review.comment);
  const county = reviewCounty(text, venues);
  if (!county) return '';
  const places = [county, ...venues.filter(venue => canonicalCounty(venue.county) === county).flatMap(venue => [venue.name, ...(venue.aliases || [])])]
    .map(locationKey).filter(Boolean).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // A band's home county or a guest's journey is not the event location.
  const event = '(?:wedding|reception|party|event|celebration|performed|played)';
  return new RegExp(`\\b${event}\\b.{0,80}\\b(?:in|at) (?:the )?(?:${places.join('|')})\\b|\\b${locationKey(county)} ${event}\\b`).test(text) ? county : '';
}
export const isPublicVenue = venue => !!String(venue.name || '').trim()
  && !/^(?:private|home|residential)(?:\s|$)/i.test(venue.name)
  && !/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(venue.name);

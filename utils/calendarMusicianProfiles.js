import Musician from '../models/musicianModel.js';

const clean = value => String(value || '').trim();
const objectId = value => /^[a-f\d]{24}$/i.test(clean(value));

// Read canonical public slugs in one query: assignment snapshots may predate a
// profile rename. Missing slugs omit the link rather than exposing an ID URL.
export async function calendarMusicianProfiles(members = [], {
  loadProfiles = ids => Musician.find({ _id: { $in: ids } }).select('_id musicianSlug firstName lastName').lean(),
} = {}) {
  const ids = [...new Set(members.map(member => clean(member.musicianId || member.musician?._id)).filter(objectId))];
  const profiles = ids.length ? await loadProfiles(ids) : [];
  const byId = new Map(profiles.map(person => [String(person._id), person]));
  return members.map(member => {
    const id = clean(member.musicianId || member.musician?._id);
    const canonical = byId.get(id);
    return { ...member, ...(canonical?.firstName ? {firstName:canonical.firstName,lastName:canonical.lastName || ''} : {}), musicianSlug: canonical
      ? clean(canonical.musicianSlug)
      : clean(member.musicianSlug || member.musician?.musicianSlug) };
  });
}

export function calendarMusicianDisplayName(member = {}) {
  const full = clean(member.name);
  if (!member.musicianId && !member.email && /pending|awaiting|replacement|unfilled|\bTBC\b/i.test(full)) return full;
  const parts = full.split(/\s+/).filter(Boolean);
  const first = clean(member.firstName) || parts[0] || 'Band member';
  const last = clean(member.lastName) || (parts.length > 1 ? parts.at(-1) : '');
  return [first, last ? `${Array.from(last)[0].toUpperCase()}.` : ''].filter(Boolean).join(' ');
}

export function calendarMusicianProfileUrl(member = {}) {
  const slug = clean(member.musicianSlug);
  if (!slug || objectId(slug)) return '';
  const base = clean(process.env.PUBLIC_SITE_URL || 'https://thesupremecollective.co.uk').replace(/\/$/, '');
  return `${base}/musician/${encodeURIComponent(slug)}/`;
}

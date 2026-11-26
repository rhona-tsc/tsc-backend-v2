import mongoose from 'mongoose';

const text = value => String(value || '').trim();
const email = value => text(value).toLowerCase();
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const publicMusician = m => Boolean(m && !m.privateTestProfile && !m.profileDeletedAt && !m.mergedIntoMusicianId && ['approved', 'approved, changes pending'].includes(text(m.status).toLowerCase()));
const publicAct = a => ['approved', 'live', 'approved, changes pending'].includes(text(a.status).toLowerCase());
const image = value => typeof value === 'string' ? value : Array.isArray(value) ? image(value[0]) : value?.url || '';
export const musicianIdentities = m => ({
  ids: new Set([m._id, m.musicianId, ...(m.mergedProfileIds || [])].filter(Boolean).map(String)),
  emails: new Set([m.email, ...(m.mergedProfileEmails || [])].map(email).filter(Boolean)),
});
export const matchesMusician = (member, identities) => identities.ids.has(String(member?.musicianId || '')) || (email(member?.email) && identities.emails.has(email(member.email)));
export function splitBandMemberships(musician, acts) {
  const identities = musicianIdentities(musician);
  const regularBands = [], deputyBands = [];
  for (const act of acts.filter(publicAct)) {
    const members = (act.lineups || []).flatMap(l => l.bandMembers || []);
    const regular = members.some(m => matchesMusician(m, identities));
    const deputy = members.some(m => (m.deputies || []).some(d => matchesMusician(d, identities)));
    if (!regular && !deputy) continue;
    const key = act.slug || text(act.tscName || act.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || String(act._id);
    const card = { _id: String(act._id), name: act.tscName || act.name, image: image(act.coverImage) || image(act.profileImage) || image(act.images), href: `/act/${encodeURIComponent(key)}/` };
    (regular ? regularBands : deputyBands).push(card);
  }
  const unique = list => [...new Map(list.map(a => [a._id, a])).values()].sort((a,b) => a.name.localeCompare(b.name));
  return { regularBands: unique(regularBands), deputyBands: unique(deputyBands) };
}
export function confirmedRoster(booking) {
  const rows = booking.assignedMusicians?.length ? booking.assignedMusicians : booking.bookingDetails?.assignedMusicians?.length ? booking.bookingDetails.assignedMusicians : booking.bookingMusicians?.length ? booking.bookingMusicians : booking.bandLineup || [];
  return rows.filter(m => ['accepted', 'confirmed', 'completed'].includes(text(m.status).toLowerCase()) && (!m.withdrawnAt || new Date(m.acceptedAt || m.respondedAt || 0) > new Date(m.withdrawnAt)));
}
export function completedBooking(booking, today) {
  if (['cancelled', 'canceled', 'provisional', 'enquiry', 'declined'].includes(text(booking.bookingStatus || booking.status).toLowerCase())) return false;
  const value = booking.eventDateISO || booking.date || booking.eventDate || booking.bookingDetails?.eventDate;
  const date = value instanceof Date ? value.toISOString().slice(0,10) : text(value).slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today;
}
export const musicianConnectionCard = m => ({
  _id: String(m._id), name: [m.firstName, text(m.lastName).slice(0,1)].filter(Boolean).join(' '),
  image: image(m.profilePhoto) || image(m.profilePicture) || image(m.additionalImages),
  href: `/musician/${encodeURIComponent(m.musicianSlug || String(m._id))}`,
  role: (m.instrumentation || []).map(i => i.instrument).filter(Boolean).join(', ') || (m.vocals?.type || []).join(', '),
});
const rosterPaths = ['assignedMusicians', 'bookingDetails.assignedMusicians', 'bookingMusicians', 'bandLineup'];
const identityQuery = (identities, paths) => ({ $or: paths.flatMap(path => [
  { [`${path}.musicianId`]: { $in: [...identities.ids].flatMap(id => mongoose.isValidObjectId(id) ? [id, new mongoose.Types.ObjectId(id)] : [id]) } },
  ...[...identities.emails].map(address => ({ [`${path}.email`]: new RegExp(`^${escapeRegex(address)}$`, 'i') })),
]) });
export async function getMusicianConnections(musician, { includeMusicians = true, now = new Date(), db = mongoose.connection } = {}) {
  if (!publicMusician(musician)) return { regularBands: [], deputyBands: [], musicians: [] };
  const identities = musicianIdentities(musician);
  const acts = await db.collection('acts').find(identityQuery(identities, ['lineups.bandMembers', 'lineups.bandMembers.deputies'])).project({ tscName:1, name:1, slug:1, status:1, coverImage:1, profileImage:1, images:1, 'lineups.bandMembers.musicianId':1, 'lineups.bandMembers.email':1, 'lineups.bandMembers.deputies.musicianId':1, 'lineups.bandMembers.deputies.email':1 }).maxTimeMS(10000).toArray();
  const bands = splitBandMemberships(musician, acts);
  if (!includeMusicians) return { ...bands, musicians: [] };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
  const [board, core] = await Promise.all(['bookingboarditems', 'bookings'].map(collection => db.collection(collection).find(identityQuery(identities, rosterPaths)).project({bookingRef:1, bookingId:1, sourceBookingId:1, eventDateISO:1, date:1, eventDate:1, status:1, bookingStatus:1, assignedMusicians:1, bookingDetails:1, bookingMusicians:1, bandLineup:1}).maxTimeMS(10000).toArray()));
  // The booking board is authoritative when an older core booking also exists.
  const bookings = [...board, ...core.filter(b => !board.some(row => String(row.bookingId || row.sourceBookingId || '') === String(b._id) || (row.bookingRef && row.bookingRef === b.bookingRef)))];
  const peers = bookings.filter(b => completedBooking(b, today)).flatMap(b => {
    const roster = confirmedRoster(b);
    return roster.some(m => matchesMusician(m, identities)) ? roster.filter(m => !matchesMusician(m, identities)) : [];
  });
  if (!peers.length) return {...bands, musicians:[]};
  const peerIds = peers.map(p => String(p.musicianId || '')).filter(id => mongoose.isValidObjectId(id)).map(id => new mongoose.Types.ObjectId(id));
  const peerEmails = [...new Set(peers.map(p => email(p.email)).filter(Boolean))];
  const musicians = await db.collection('musicians').find({ $or: [{_id:{$in:peerIds}}, ...peerEmails.map(address => ({email:new RegExp(`^${escapeRegex(address)}$`,'i')}))], privateTestProfile:{$ne:true}, profileDeletedAt:null, mergedIntoMusicianId:null, status:{$in:['approved','Approved, changes pending']} }).project({firstName:1,lastName:1,musicianSlug:1,profilePhoto:1,profilePicture:1,additionalImages:1,instrumentation:1,vocals:1}).maxTimeMS(10000).toArray();
  return {...bands, musicians: musicians.filter(m => !identities.ids.has(String(m._id))).map(musicianConnectionCard).sort((a,b)=>a.name.localeCompare(b.name))};
}

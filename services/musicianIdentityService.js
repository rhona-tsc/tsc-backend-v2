import mongoose from 'mongoose';
import Musician from '../models/musicianModel.js';

// Keep historical profile URLs useful after an explicitly approved merge.
// Only an explicit merge pointer can cross account identities.
export async function resolveMergedMusician(profile, model = Musician) {
  const seen = new Set();
  let current = profile;
  while (current?.mergedIntoMusicianId) {
    const id = String(current._id);
    if (seen.has(id) || seen.size >= 8) return null;
    seen.add(id);
    current = await model.findById(current.mergedIntoMusicianId).lean();
  }
  return current?.profileDeletedAt ? null : current;
}

export async function findMusicianByIdOrSlug(value, model = Musician) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let profile = mongoose.isValidObjectId(raw)
    ? await model.findById(raw).lean() : null;
  if (!profile && mongoose.isValidObjectId(raw)) {
    profile = await model.findOne({ mergedProfileIds: raw }).lean();
  }
  if (!profile) profile = await model.findOne({ musicianSlug: raw.toLowerCase() }).lean();
  if (!profile) profile = await model.findOne({ mergedProfileSlugs: raw.toLowerCase() }).lean();
  return resolveMergedMusician(profile, model);
}

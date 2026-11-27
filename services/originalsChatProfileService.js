import Musician from '../models/musicianModel.js';

export function originalChatAuthorProfilePath(message, profile) {
  if (message.authorAnonymous || ['stem_submitted', 'stem_approved'].includes(message.messageType) || !profile || profile.privateTestProfile || profile.profileDeletedAt) return null;
  const slug = String(profile.musicianSlug || profile._id || message.authorId || '').trim();
  return slug ? `/musician/${encodeURIComponent(slug)}` : null;
}

// Never look up anonymous identities or persist profile URLs on chat records.
// Resolve on read so deleted/private profiles and changed slugs stay current.
export async function addOriginalChatProfiles(messages = []) {
  const ids = [...new Set(messages.filter(message => !message.authorAnonymous && !['stem_submitted', 'stem_approved'].includes(message.messageType)).map(message => String(message.authorId || '')).filter(id => /^[a-f\d]{24}$/i.test(id)))];
  const profiles = ids.length ? await Musician.find({ _id: { $in: ids } }).select('_id musicianSlug privateTestProfile profileDeletedAt').lean() : [];
  const byId = new Map(profiles.map(profile => [String(profile._id), profile]));
  return messages.map(message => {
    const plain = message.toObject ? message.toObject() : message;
    return { ...plain, authorProfilePath: originalChatAuthorProfilePath(plain, byId.get(String(plain.authorId))) };
  });
}

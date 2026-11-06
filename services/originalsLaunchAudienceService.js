import isEmail from 'validator/lib/isEmail.js';
import { musicianEmailHash, normaliseMusicianEmail } from '../utils/musicianEmailPreferences.js';

export function planOriginalsLaunchAudience(musicians, preferences = []) {
  const suppressed = new Set(preferences.filter(row => row.originalsOpportunities === false || row.profileDeletedAt).map(row => row.emailHash));
  const recipients = new Map();
  const excluded = { notOnBooks: 0, removedOrTest: 0, invalidEmail: 0, unsubscribed: 0, duplicate: 0 };
  for (const musician of musicians) {
    if (String(musician.role || '').toLowerCase().trim() !== 'musician' || !['approved', 'approved, changes pending'].includes(String(musician.status || '').toLowerCase().trim())) { excluded.notOnBooks++; continue; }
    if (musician.profileDeletedAt || musician.privateTestProfile === true) { excluded.removedOrTest++; continue; }
    const email = normaliseMusicianEmail(musician.email);
    if (!isEmail(email) || /@(?:example\.(?:com|net|org)|[^@]+\.(?:test|invalid|example))$/i.test(email)) { excluded.invalidEmail++; continue; }
    if (suppressed.has(musicianEmailHash(email))) { excluded.unsubscribed++; continue; }
    if (recipients.has(email)) { excluded.duplicate++; continue; }
    recipients.set(email, { musicianId: String(musician._id), email, firstName: String(musician.firstName || '').trim() || 'there' });
  }
  return { recipients: [...recipients.values()].sort((a, b) => a.email.localeCompare(b.email)), excluded };
}

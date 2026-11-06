import Preferences from '../models/musicianEmailPreferenceModel.js';
import Musician from '../models/musicianModel.js';
import { musicianEmailHash, verifyMusicianEmailPreferencesToken } from '../utils/musicianEmailPreferences.js';
const userId = user => String(user?._id || user?.id || user?.userId || '');
const present = record => ({ deputyOpportunities: record?.deputyOpportunities !== false, originalsOpportunities: record?.originalsOpportunities !== false, profileDeleted: Boolean(record?.profileDeletedAt) });
async function identity(req) {
  const token = req.method === 'GET' ? req.query.token : req.body.token;
  if (token) return { emailHash: verifyMusicianEmailPreferencesToken(token) };
  if (!userId(req.user)) throw Object.assign(new Error('Use the link in your email, or sign in to manage your preferences.'), { status: 401 });
  const musician = await Musician.findById(userId(req.user)).select('email').lean();
  if (!musician?.email) throw Object.assign(new Error('Your musician account could not be found.'), { status: 404 });
  return { emailHash: musicianEmailHash(musician.email) };
}
const fail = (res, error) => res.status(error.status || (['JsonWebTokenError', 'TokenExpiredError'].includes(error.name) ? 400 : 500)).json({ success: false, message: error.status ? error.message : error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' ? 'This preferences link is not valid. Sign in to manage your preferences.' : 'Could not save your preferences. Please try again.' });
export async function getMusicianEmailPreferences(req, res) {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  try {
    const { emailHash } = await identity(req);
    const record = await Preferences.findOne({ emailHash }).lean();
    return res.json({ success: true, preferences: present(record) });
  } catch (error) { return fail(res, error); }
}
export async function saveMusicianEmailPreferences(req, res) {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  try {
    const { emailHash } = await identity(req);
    if (typeof req.body.deputyOpportunities !== 'boolean' || typeof req.body.originalsOpportunities !== 'boolean' || (req.body.deleteProfile !== undefined && typeof req.body.deleteProfile !== 'boolean')) return res.status(400).json({ success: false, message: 'Choose your email preferences before saving.' });
    const existing = await Preferences.findOne({ emailHash }).lean();
    const deletion = req.body.deleteProfile === true;
    if (deletion) {
      if (!userId(req.user)) return res.status(401).json({ success: false, message: 'Sign in to confirm removal of your own musician profile.' });
      const musician = await Musician.findById(userId(req.user)).select('email profileDeletedAt').lean();
      if (!musician?.email || musicianEmailHash(musician.email) !== emailHash) return res.status(403).json({ success: false, message: 'Sign in to the account this preferences link belongs to.' });
      if (req.body.confirmation !== 'DELETE') return res.status(400).json({ success: false, message: 'Type DELETE to confirm profile removal.' });
      const deletedAt = musician.profileDeletedAt || new Date();
      // Remove public visibility while retaining booking, agreement, payment and
      // royalty history linked to this account. Repeating the action is safe.
      await Preferences.updateOne({ emailHash }, { $set: { deputyOpportunities: false, originalsOpportunities: false, profileDeletedAt: deletedAt } }, { upsert: true });
      await Musician.updateOne({ _id: musician._id }, { $set: { profileDeletedAt: deletedAt } });
      return res.json({ success: true, preferences: { deputyOpportunities: false, originalsOpportunities: false, profileDeleted: true }, message: 'Your musician profile has been removed from public view and both opportunity email lists. Existing booking and royalty records are retained.' });
    }
    if (existing?.profileDeletedAt) return res.status(409).json({ success: false, message: 'This profile has been removed. Contact TSC if you would like to rejoin.' });
    await Preferences.updateOne({ emailHash }, { $set: { deputyOpportunities: req.body.deputyOpportunities, originalsOpportunities: req.body.originalsOpportunities } }, { upsert: true });
    return res.json({ success: true, preferences: present(req.body), message: 'Your email preferences have been saved.' });
  } catch (error) { return fail(res, error); }
}

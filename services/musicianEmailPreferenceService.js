import Preferences from '../models/musicianEmailPreferenceModel.js';
import { musicianEmailHash } from '../utils/musicianEmailPreferences.js';
export async function musicianOpportunityAllowed(email, category, repository = Preferences) {
  if (!['deputy', 'originals'].includes(category)) return true;
  const record = await repository.findOne({ emailHash: musicianEmailHash(email) }).lean();
  return !record?.profileDeletedAt && record?.[category === 'deputy' ? 'deputyOpportunities' : 'originalsOpportunities'] !== false;
}

import Preferences from '../models/musicianEmailPreferenceModel.js';
import { musicianEmailHash } from '../utils/musicianEmailPreferences.js';
export async function musicianOpportunityAllowed(email, category, repository = Preferences) {
  const fields = { deputy: 'deputyOpportunities', originals: 'originalsOpportunities', deputy_outcome: 'deputyOutcomeUpdates' };
  if (!fields[category]) return true;
  const record = await repository.findOne({ emailHash: musicianEmailHash(email) }).lean();
  return !record?.profileDeletedAt && record?.[fields[category]] !== false;
}

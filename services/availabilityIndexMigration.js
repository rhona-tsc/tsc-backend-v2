import { availabilityEnquiryIndexKey, availabilityEnquiryIndexName } from './availabilityRequestIdentity.js';

const oldKeys = [
  { actId: 1, lineupId: 1, dateISO: 1, phone: 1, v2: 1, slotIndex: 1 },
  { actId: 1, requestKey: 1, lineupId: 1, dateISO: 1, phone: 1, v2: 1, slotIndex: 1 },
];
const sameKey = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export async function migrateAvailabilityEnquiryIndex(collection, { apply = false } = {}) {
  const indexes = await collection.indexes();
  const conflicting = indexes.filter(index => index.unique && oldKeys.some(key => sameKey(index.key, key)));
  const existing = indexes.find(index => index.unique && sameKey(index.key, availabilityEnquiryIndexKey));
  const groups = await collection.aggregate([
    { $group: {
      _id: Object.fromEntries(Object.keys(availabilityEnquiryIndexKey).map(key => [key, { $ifNull: [`$${key}`, null] }])),
      count: { $sum: 1 },
    } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'duplicateGroups' },
  ]).toArray();
  const duplicateGroups = groups[0]?.duplicateGroups || 0;
  const plan = { applied: false, targetIndex: existing?.name || availabilityEnquiryIndexName,
    duplicateGroups, replaceIndexes: conflicting.map(index => index.name), documentCount: await collection.countDocuments() };
  if (duplicateGroups) throw Object.assign(new Error('Duplicate enquiry/person/slot rows need review; no indexes changed.'), { code: 'AVAILABILITY_DUPLICATE_SCOPE' });
  if (!apply) return plan;
  // Build the replacement first. If this fails, retain every previous safeguard.
  if (!existing) await collection.createIndex(availabilityEnquiryIndexKey, { unique: true, name: availabilityEnquiryIndexName });
  for (const index of conflicting) await collection.dropIndex(index.name);
  return { ...plan, applied: true };
}

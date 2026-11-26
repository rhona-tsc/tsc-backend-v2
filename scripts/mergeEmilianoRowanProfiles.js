import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { EJSON } from 'bson';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { mergeProfileValues, removeRejectedImage, ACCOUNT_FIELDS } from '../utils/mergeMusicianProfiles.js';
import { musicianEmailHash } from '../utils/musicianEmailPreferences.js';

const apply = process.argv.includes('--apply');
const backupDir = process.env.PROFILE_MERGE_BACKUP_DIR;
if (!backupDir) throw new Error('PROFILE_MERGE_BACKUP_DIR is required');
dotenv.config({ path: process.env.PROFILE_MERGE_ENV_FILE || '.env' });
const pairs = [
  { name: 'Emiliano', primary: '69b966957ff9abd751f94ff8', source: '6af993a43478059d65075386' },
  { name: 'Rowan', primary: '69b9669d7ff9abd751f9527d', source: '68b441d2416f0bcd9cb6cbcc' },
];
const rejectedImage = 'acts/wejevgq6ljfotjphbogu';
const oid = id => new mongoose.Types.ObjectId(id);
const snapshot = value => EJSON.stringify(value, { relaxed: false });
const hash = value => createHash('sha256').update(snapshot(value)).digest('hex');
const replaceIds = value => {
  if (value?._bsontype === 'ObjectId') return oid(pairs.find(pair => pair.source === String(value))?.primary || String(value));
  if (typeof value === 'string') return pairs.find(pair => pair.source === value)?.primary || value;
  if (Array.isArray(value)) return value.map(replaceIds);
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceIds(child)]));
  return value;
};
await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
try {
  const db = mongoose.connection.db;
  const referenceSummary = JSON.parse(fs.readFileSync(backupDir + '/reference-summary.json', 'utf8'));
  const references = [];
  for (const item of referenceSummary) for (const ref of item.retiredReferences) {
    const document = await db.collection(item.collection).findOne({ _id: oid(ref.id) });
    if (!document) throw new Error('A reference disappeared; re-audit before merging');
    references.push({ collection: item.collection, document });
  }
  const plans = [];
  for (const pair of pairs) {
    const [primary, source] = await Promise.all([pair.primary, pair.source].map(id => db.collection('musicians').findOne({ _id: oid(id) })));
    if (!primary || !source || primary.firstName !== pair.name || source.firstName !== pair.name || primary.profileDeletedAt || source.profileDeletedAt || primary.mergedIntoMusicianId || source.mergedIntoMusicianId) throw new Error('Identity or prior-merge guard failed');
    let merged = mergeProfileValues(primary, source);
    for (const field of ACCOUNT_FIELDS) {
      if (field in primary) merged[field] = primary[field]; else delete merged[field];
    }
    merged.basicInfo = { ...(merged.basicInfo || {}), firstName: primary.firstName, lastName: primary.lastName, email: primary.email, phone: primary.phone };
    merged.mergedProfileIds = [...new Set([...(primary.mergedProfileIds || []), pair.source, ...(source.mergedProfileIds || [])])];
    merged.mergedProfileSlugs = [...new Set([...(primary.mergedProfileSlugs || []), source.musicianSlug, ...(source.mergedProfileSlugs || [])].filter(Boolean))];
    merged.mergedProfileEmails = [...new Set([...(primary.mergedProfileEmails || []), source.email, ...(source.mergedProfileEmails || [])].filter(Boolean))];
    merged.mergedProfileContacts = [...(primary.mergedProfileContacts || []), { sourceId: pair.source, email: source.email, phone: source.phone, phoneNormalized: source.phoneNormalized, basicInfo: source.basicInfo }];
    merged.profilePhoto ||= source.profilePhoto || source.profilePicture || primary.profilePicture || null;
    if (pair.name === 'Emiliano') merged.coverHeroImage = merged.profilePhoto;
    merged = removeRejectedImage(merged, rejectedImage);
    const now = new Date();
    merged.updatedAt = now;
    const archived = removeRejectedImage({ ...source, mergedIntoMusicianId: oid(pair.primary), mergedAt: now, profileDeletedAt: now, updatedAt: now }, rejectedImage);
    const emails = [...new Set([primary.email, source.email, ...(merged.mergedProfileEmails || [])].filter(Boolean).map(email => email.trim().toLowerCase()))];
    const preferences = await db.collection('musicianemailpreferences').find({ emailHash: { $in: emails.map(musicianEmailHash) } }).toArray();
    if (preferences.some(row => row.profileDeletedAt)) throw new Error('A merged email requested profile deletion; review required');
    plans.push({ pair, primary, source, merged, archived, emails, preferences });
  }
  const backup = { createdAt: new Date(), plans, references };
  const backupPath = backupDir + '/' + (apply ? 'apply' : 'plan') + '-snapshot.ejson';
  fs.writeFileSync(backupPath, snapshot(backup), { mode: 0o600, flag: apply ? 'wx' : 'w' });
  console.log(JSON.stringify({ apply, profiles: plans.map(({ pair, primary, source, merged, preferences }) => ({ name: pair.name, keep: pair.primary, retire: pair.source, slug: primary.musicianSlug, profilePhoto: !!merged.profilePhoto, galleryPhotos: ['additionalImages', 'digitalWardrobeBlackTie', 'digitalWardrobeFormal', 'digitalWardrobeSmartCasual', 'digitalWardrobeSessionAllBlack'].reduce((n, field) => n + (merged[field]?.length || 0), 0), fieldsAdded: Object.keys(source).filter(key => !ACCOUNT_FIELDS.includes(key) && !primary[key] && merged[key]), existingOptOuts: preferences.filter(row => row.deputyOpportunities === false || row.originalsOpportunities === false).length })), references: references.map(({ collection, document }) => ({ collection, id: String(document._id) })) }, null, 2));
  if (apply) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const { collection, document } of [...plans.flatMap(plan => [plan.primary, plan.source].map(document => ({ collection: 'musicians', document }))), ...references]) {
          const current = await db.collection(collection).findOne({ _id: document._id }, { session });
          if (hash(current) !== hash(document)) throw new Error('Concurrent update; nothing merged. Re-audit and retry.');
        }
        await db.collection('profilemergebackups').insertOne({ createdAt: new Date(), reason: 'User-approved Emiliano and Rowan duplicate profile merges; retain active booking identities and remove rejected contact-details image', localBackupPath: backupPath, localBackupSha256: createHash('sha256').update(fs.readFileSync(backupPath)).digest('hex'), ...backup }, { session });
        for (const plan of plans) {
          await db.collection('musicians').replaceOne({ _id: plan.primary._id }, plan.merged, { session });
          await db.collection('musicians').replaceOne({ _id: plan.source._id }, plan.archived, { session });
          // A merge never opts someone back in. Apply any existing category
          // suppression to every contact address, retaining per-email history.
          const blocked = {};
          for (const category of ['deputyOpportunities', 'originalsOpportunities']) if (plan.preferences.some(row => row[category] === false)) blocked[category] = false;
          if (Object.keys(blocked).length) for (const email of plan.emails) await db.collection('musicianemailpreferences').updateOne({ emailHash: musicianEmailHash(email) }, { $set: { ...blocked, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true, session });
        }
        for (const { collection, document } of references) {
          await db.collection(collection).replaceOne({ _id: document._id }, replaceIds(document), { session });
        }
      });
    } finally { await session.endSession(); }
    fs.writeFileSync(backupDir + '/merge-receipt.json', JSON.stringify({ completedAt: new Date(), profiles: pairs, referencesMoved: references.length, backupPath }, null, 2), { mode: 0o600 });
    console.log('Merge committed; all source records archived and receipts saved.');
  }
} finally { await mongoose.disconnect(); }

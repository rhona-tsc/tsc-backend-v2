import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planMusicianProfileCleanup, privateTestProfileUpdate } from '../services/musicianProfileCleanupService.js';

// Dry-run by default. --apply deletes only matching musician profile documents.
// Add --activate-private-test only AFTER deploying the private directory rules.
// No emails, media deletions, booking changes, or cascading deletes are performed.
const apply = process.argv.includes('--apply');
const activatePrivateTest = process.argv.includes('--activate-private-test');
const EJSON = mongoose.mongo.BSON.EJSON;
mongoose.set('autoIndex', false); mongoose.set('autoCreate', false);
const digest = value => createHash('sha256').update(EJSON.stringify(value)).digest('hex');
try {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverApi: { version: '1', strict: true, deprecationErrors: true }, tls: true, serverSelectionTimeoutMS: 10000 });
  const collection = mongoose.connection.db.collection('musicians');
  const records = await collection.find({ email: { $regex: '(?:@thesupremecollective\\.co\\.uk$|^tsc[^@\\s]*@gmail\\.com$)', $options: 'i' } }).toArray();
  const plan = planMusicianProfileCleanup(records);
  if (plan.retainAsTest.length > 1) throw new Error('More than one matching Rowan profile: select one explicitly before applying');
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', remove: plan.remove.map(row => ({ id: String(row._id), email: row.email })), retainAsTest: plan.retainAsTest.map(row => ({ id: String(row._id), email: row.email })), protected: plan.protected.map(row => row.email), privateRenameDeferred: !activatePrivateTest }));
  if (apply && (plan.remove.length || activatePrivateTest && plan.retainAsTest.length)) {
    const backupDirectory = path.join(os.homedir(), '.codex', 'backups', `tsc-musician-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    const backupPath = path.join(backupDirectory, 'profiles.ejson');
    const backup = { createdAt: new Date(), collection: collection.collectionName, profiles: [...plan.remove, ...plan.retainAsTest], retainedProfileUpdate: privateTestProfileUpdate, activatePrivateTest };
    await fs.writeFile(backupPath, EJSON.stringify(backup, { relaxed: false }), { mode: 0o600, flag: 'wx' });
    const checked = EJSON.parse(await fs.readFile(backupPath, 'utf8'));
    if (checked.profiles.length !== backup.profiles.length) throw new Error('Backup verification failed');
    const session = await mongoose.startSession();
    let deleted = 0, renamed = 0;
    try {
      await session.withTransaction(async () => {
        deleted = 0; renamed = 0;
        for (const row of [...plan.remove, ...(activatePrivateTest ? plan.retainAsTest : [])]) {
          const current = await collection.findOne({ _id: row._id }, { session });
          if (!current || digest(current) !== digest(row)) throw new Error('A target profile changed after backup; no changes committed. Run again.');
        }
        for (const row of plan.remove) {
          const result = await collection.deleteOne({ _id: row._id, email: row.email }, { session });
          if (result.deletedCount !== 1) throw new Error('Delete guard failed; no changes committed');
          deleted++;
        }
        if (activatePrivateTest) for (const row of plan.retainAsTest) {
          const result = await collection.updateOne({ _id: row._id, email: row.email }, { $set: { ...privateTestProfileUpdate, updatedAt: new Date() } }, { session });
          if (result.matchedCount !== 1) throw new Error('Rename guard failed; no changes committed');
          renamed++;
        }
      });
    } finally { await session.endSession(); }
    const remaining = await collection.countDocuments({ _id: { $in: plan.remove.map(row => row._id) } });
    if (remaining !== 0) throw new Error('Post-cleanup verification failed');
    console.log(JSON.stringify({ deletedProfiles: deleted, renamedPrivateTestProfiles: renamed, protectedProfiles: await collection.countDocuments({ _id: { $in: plan.protected.map(row => row._id) } }), backupPath }));
  }
} finally { await mongoose.disconnect(); }

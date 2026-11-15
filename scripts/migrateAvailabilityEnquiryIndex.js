import 'dotenv/config';
import mongoose from 'mongoose';
import { migrateAvailabilityEnquiryIndex } from '../services/availabilityIndexMigration.js';

// Read-only plan by default. Apply only this narrowly identified index migration;
// never sync/drop unrelated indexes and never edit requests or musician replies.
try {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Database connection is not configured.');
  await mongoose.connect(uri, { autoIndex: false });
  console.log(JSON.stringify(await migrateAvailabilityEnquiryIndex(
    mongoose.connection.db.collection('availabilities'), { apply: process.argv.includes('--apply') },
  ), null, 2));
} catch (error) {
  console.error(error.code || 'MIGRATION_FAILED', error.code === 'AVAILABILITY_DUPLICATE_SCOPE'
    ? error.message : 'Availability index migration did not complete; inspect the database state before retrying.');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

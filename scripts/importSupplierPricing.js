// Explicit, reversible migration. No bookings, musician fees, travel tables or extras are changed.
// Usage: node scripts/importSupplierPricing.js PLAN.json BACKUP.json [--apply]
import 'dotenv/config';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Act from '../models/actModel.js';
import ActCard from '../models/actCard.model.js';
import ActFilterCard from '../models/ActFilterCard.js';
import { buildCard } from '../services/buildActFilterCard.js';
import { minimumCustomerPrice } from '../utils/supplierPricing.js';

const [planPath, backupPath, mode] = process.argv.slice(2);
assert(planPath && backupPath, 'Specify a reviewed plan and new backup path.');
const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
try {
  const documents = [];
  for (const item of plan) {
    const act = await Act.findById(item.actId).lean();
    assert.equal(act?.tscName, item.name, 'Act identity changed');
    assert.equal(item.supplierPricing?.sourceColumn, 'G');
    const ids = new Set(act.lineups.map(lineup => lineup.lineupId));
    for (const [id, lineup] of Object.entries(item.supplierPricing.lineups)) {
      assert(ids.has(id), 'Selected lineup no longer exists');
      assert(Object.values(lineup.counties).every(price => typeof price === 'number' && Number.isFinite(price) && price > 0));
    }
    assert.equal(item.minDisplayPrice, minimumCustomerPrice(item));
    documents.push(act);
  }
  if (mode === '--apply') {
    const backup = { createdAt: new Date().toISOString(), acts: documents,
      actCards: await ActCard.find({ actId: { $in: documents.map(act => act._id) } }).lean(),
      filterCards: await ActFilterCard.find({ actId: { $in: documents.map(act => act._id) } }).lean() };
    assert.equal(backup.actCards.length, documents.length, 'Every selected act needs an existing card');
    assert.equal(backup.filterCards.length, documents.length, 'Every selected act needs an existing filter card');
    await fs.writeFile(backupPath, JSON.stringify(backup, null, 2), { flag: 'wx', mode: 0o600 });
    for (let index = 0; index < plan.length; index++) {
      const item = plan[index], before = documents[index];
      const condition = { _id: before._id,
        supplierPricing: before.supplierPricing ?? { $exists: false },
        minDisplayPrice: before.minDisplayPrice ?? null };
      const result = await Act.updateOne(condition, { $set: { supplierPricing: item.supplierPricing, minDisplayPrice: item.minDisplayPrice } });
      assert.equal(result.matchedCount, 1, 'Pricing changed during import; review backup before resuming');
      const act = { ...before, supplierPricing: item.supplierPricing, minDisplayPrice: item.minDisplayPrice };
      const raw = buildCard(act);
      // Pricing imports must not change publication state or other cached metadata.
      const pricingFields = { supplierPricing: item.supplierPricing,
        minDisplayPrice: item.minDisplayPrice, basePrice: raw.basePrice };
      const filterResult = await ActFilterCard.updateOne({ actId: act._id }, { $set: pricingFields });
      const cardResult = await ActCard.updateOne({ actId: act._id }, { $set: pricingFields });
      assert.equal(filterResult.matchedCount, 1, 'Missing filter card');
      assert.equal(cardResult.matchedCount, 1, 'Missing act card');
    }
  }
  console.log(JSON.stringify({ applied: mode === '--apply', acts: plan.length,
    lineups: plan.reduce((sum, item) => sum + Object.keys(item.supplierPricing.lineups).length, 0) }));
} finally { await mongoose.disconnect(); }

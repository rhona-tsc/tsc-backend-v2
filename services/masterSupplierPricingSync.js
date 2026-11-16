import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { google } from 'googleapis';
import Act from '../models/actModel.js';
import ActCard from '../models/actCard.model.js';
import ActFilterCard from '../models/ActFilterCard.js';
import { openEquipmentToken } from './voiceEquipmentGoogle.js';
import { publicActStatuses } from '../utils/publicActStatuses.js';
import { MASTER_PRICING_ID, MASTER_PRICING_SHEET_ID, MASTER_PRICING_SYNC_ID, MASTER_PRICING_INTERVAL_MS, buildMasterPricingPlan } from './masterSupplierPricing.js';

const controls = () => mongoose.connection.db.collection('master_supplier_pricing_sync');
const history = () => mongoose.connection.db.collection('master_supplier_pricing_runs');

async function readMasterSheet() {
  let phase = 'connection';
  try {
    // Reuse the already authorised private, read-only Sheets connection.
    const connection = await mongoose.connection.db.collection('voice_equipment_google_connections').findOne({ _id: 'reference' });
    if (!connection?.refreshTokenEncrypted) throw new Error('No verified Sheets connection.');
    const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    phase = 'decrypt';
    auth.setCredentials({ refresh_token: openEquipmentToken(connection.refreshTokenEncrypted) });
    const api = google.sheets({ version: 'v4', auth });
    phase = 'metadata';
    const metadata = await api.spreadsheets.get({ spreadsheetId: MASTER_PRICING_ID,
      fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))' }, { timeout: 10000 });
    const tab = metadata.data.sheets?.find(sheet => sheet.properties?.sheetId === MASTER_PRICING_SHEET_ID)?.properties;
    if (!tab || tab.gridProperties.columnCount < 13 || tab.gridProperties.rowCount < 6 || tab.gridProperties.rowCount > 20000) throw new Error('Master sheet layout changed.');
    const range = `'${tab.title.replace(/'/g, "''")}'!A5:M${tab.gridProperties.rowCount}`;
    phase = 'values';
    const response = await api.spreadsheets.values.get({ spreadsheetId: MASTER_PRICING_ID, range, valueRenderOption: 'FORMATTED_VALUE' }, { timeout: 15000 });
    return { rows: response.data.values || [], sheetTitle: tab.title, readAt: new Date().toISOString() };
  } catch (error) {
    // Do not persist Google request objects, tokens or authentication headers.
    throw Object.assign(new Error('The private master spreadsheet could not be read; existing website prices were retained.'), { code: 'MASTER_SHEET_UNAVAILABLE', phase, providerStatus: error.response?.status });
  }
}

async function applyPricingPlan(plan, run) {
  const ids = plan.changes.map(change => change.actId);
  const [cards, filterCards] = await Promise.all([
    ActCard.find({ actId: { $in: ids } }).select('actId supplierPricing minDisplayPrice basePrice').lean(),
    ActFilterCard.find({ actId: { $in: ids } }).select('actId supplierPricing minDisplayPrice basePrice').lean(),
  ]);
  if (cards.length !== ids.length || filterCards.length !== ids.length) throw Object.assign(new Error('A website price card is missing; existing prices were retained.'), { code: 'MASTER_PRICING_CACHE_MISSING' });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Price-only rollback history; never copy private musician/contact/banking data.
      await history().insertOne({ ...run, status: 'applied',
        before: { acts: plan.changes.map(change => ({ _id: change.actId, ...change.before })), actCards: cards, filterCards },
      }, { session });
      for (const change of plan.changes) {
        const result = await Act.updateOne({ _id: change.actId, supplierPricing: change.before.supplierPricing,
          minDisplayPrice: change.before.minDisplayPrice }, { $set: {
          supplierPricing: change.pricingFields.supplierPricing, minDisplayPrice: change.pricingFields.minDisplayPrice,
        } }, { session });
        if (result.matchedCount !== 1) throw Object.assign(new Error('Website prices changed during the sync; retrying on the next run.'), { code: 'MASTER_PRICING_CONFLICT' });
        for (const model of [ActCard, ActFilterCard]) {
          const cacheResult = await model.updateOne({ actId: change.actId }, { $set: change.pricingFields }, { session });
          if (cacheResult.matchedCount !== 1) throw Object.assign(new Error('A website price card changed during the sync.'), { code: 'MASTER_PRICING_CACHE_MISSING' });
        }
      }
    });
  } finally { await session.endSession(); }
}

export async function runMasterSupplierPricingSync() {
  if (mongoose.connection.readyState !== 1) return { skipped: 'database_not_ready' };
  const now = new Date(), owner = crypto.randomUUID();
  const config = await controls().findOneAndUpdate({ _id: MASTER_PRICING_SYNC_ID, enabled: true, nextRunAt: { $lte: now },
    $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }] },
  { $set: { leaseOwner: owner, leaseUntil: new Date(now.getTime() + 120000), lastAttemptAt: now } },
  { returnDocument: 'after', includeResultMetadata: false });
  if (!config) return { skipped: 'not_due' };
  const runId = crypto.randomUUID();
  try {
    if (!['preview', 'apply'].includes(config.mode)) throw Object.assign(new Error('Pricing sync mode is not configured.'), { code: 'MASTER_PRICING_CONFIG_INVALID' });
    const source = await readMasterSheet();
    const acts = await Act.find({ status: { $in: publicActStatuses }, isTest: { $ne: true },
      'supplierPricing.sourceSpreadsheetId': MASTER_PRICING_ID, 'supplierPricing.sourceColumn': 'G' })
      .select('_id tscName supplierPricing minDisplayPrice lineups.lineupId lineups._id').sort({ _id: 1 }).lean();
    const plan = buildMasterPricingPlan({ ...source, acts });
    const run = { _id: runId, startedAt: now, readAt: new Date(source.readAt), mode: config.mode,
      sourceSpreadsheetId: MASTER_PRICING_ID, sourceSheetId: MASTER_PRICING_SHEET_ID,
      sourceHash: crypto.createHash('sha256').update(JSON.stringify(source.rows)).digest('hex'),
      ...plan.summary, priceChanges: plan.changes.map(change => ({ actId: change.actId, name: change.name,
        oldCustomerMinimum: change.before.minDisplayPrice, newCustomerMinimum: change.pricingFields.minDisplayPrice, changedRates: change.changedRates })) };
    if (config.mode === 'apply' && plan.changes.length) await applyPricingPlan(plan, run);
    else await history().insertOne({ ...run, status: config.mode === 'preview' ? 'preview' : 'no_changes' });
    const completedAt = new Date();
    await controls().updateOne({ _id: MASTER_PRICING_SYNC_ID, leaseOwner: owner }, { $set: {
      lastSuccessAt: completedAt, lastRunId: runId, lastResult: { mode: config.mode, ...plan.summary },
      nextRunAt: new Date(completedAt.getTime() + MASTER_PRICING_INTERVAL_MS),
      ...(config.mode === 'preview' ? { enabled: false } : {}),
    }, $unset: { leaseOwner: '', leaseUntil: '', lastError: '' } });
    console.log('[Master pricing sync]', { mode: config.mode, ...plan.summary });
    return { mode: config.mode, ...plan.summary };
  } catch (error) {
    const issue = { code: error.code || 'MASTER_PRICING_SYNC_FAILED', message: error.code ? error.message : 'The pricing sync failed; existing prices were retained.', at: new Date(), ...(error.phase ? { phase: error.phase, providerStatus: error.providerStatus } : {}) };
    await history().insertOne({ _id: runId, startedAt: now, mode: config.mode, status: 'failed', issue });
    await controls().updateOne({ _id: MASTER_PRICING_SYNC_ID, leaseOwner: owner }, { $set: { lastError: issue, lastRunId: runId,
      nextRunAt: new Date(Date.now() + MASTER_PRICING_INTERVAL_MS), ...(config.mode === 'preview' ? { enabled: false } : {}) },
    $unset: { leaseOwner: '', leaseUntil: '' } });
    console.error('[Master pricing sync]', issue.code, issue.message);
    return { failed: true, issue };
  }
}

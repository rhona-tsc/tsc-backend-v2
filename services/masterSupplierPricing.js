import { countyKey, minimumSupplierPrice, minimumCustomerPrice } from '../utils/supplierPricing.js';

export const MASTER_PRICING_ID = '1L6cim0tjAgs4CQ6kd1xi7m0IbqbESt6R1WQeoNQwE_c';
export const MASTER_PRICING_SHEET_ID = 1750402781;
export const MASTER_PRICING_SYNC_ID = 'website-supplier-prices';
export const MASTER_PRICING_INTERVAL_MS = 15 * 60 * 1000;
const aliases = { 'Dancefloor Magic': 'Motown Magic' };
const key = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const invalid = message => Object.assign(new Error(message), { code: 'MASTER_PRICING_INVALID' });

function supplierAmount(value, cell) {
  const text = String(value ?? '').trim();
  if (['', '-', '—', '–', '0', '£0'].includes(text)) return null;
  if (!/^£?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(text)) throw invalid(`Invalid supplier price at ${cell}.`);
  const number = Number(text.replace(/[£,\s]/g, ''));
  if (!(number > 0) || !Number.isFinite(number)) throw invalid(`Invalid supplier price at ${cell}.`);
  return number;
}

export function buildMasterPricingPlan({ rows, acts, sheetTitle = 'County prices', readAt = new Date().toISOString() }) {
  const headers = rows?.[0] || [];
  for (const [column, expected] of [[0, 'Original act'], [3, 'Lineup description'], [5, 'County'], [6, 'Supplier price'], [10, 'Lineup ID']]) {
    if (headers[column] !== expected) throw invalid(`Master pricing column ${column + 1} no longer matches ${expected}.`);
  }
  if (!acts.length) throw invalid('No previously matched website acts are available.');
  const groups = new Map();
  rows.slice(1).forEach((row, index) => {
    if (!row[0] || !row[10]) return;
    const groupKey = `${key(row[0])}\n${key(row[10])}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push({ row, sheetRow: index + 6 });
  });
  let rates = 0, lineups = 0, changedRates = 0;
  const changes = [];
  for (const act of acts) {
    const before = act.supplierPricing;
    if (before?.sourceSpreadsheetId !== MASTER_PRICING_ID || before.sourceColumn !== 'G') throw invalid(`Unverified pricing source for ${act.tscName}.`);
    const sourceAct = before.sourceAct || aliases[act.tscName] || act.tscName;
    const actualIds = new Set((act.lineups || []).flatMap(lineup => [lineup.lineupId, lineup._id]).filter(Boolean).map(String));
    const next = structuredClone(before);
    let actChangedRates = 0;
    if (!Object.keys(before.lineups || {}).length) throw invalid(`No reviewed lineup matches for ${act.tscName}.`);
    for (const [id, lineup] of Object.entries(before.lineups)) {
      if (!actualIds.has(id)) throw invalid(`A previously matched lineup was removed from ${act.tscName}.`);
      const group = groups.get(`${key(sourceAct)}\n${key(lineup.masterLineup)}`);
      if (!group?.length) throw invalid(`Missing master lineup: ${sourceAct} / ${lineup.masterLineup}.`);
      const oldCounties = new Map(Object.entries(lineup.counties || {}).map(([name, price]) => [countyKey(name), { name, price }]));
      const seen = new Set(), counties = {}, sourceRows = [];
      for (const { row, sheetRow } of group) {
        const county = String(row[5] || '').trim(), normalized = countyKey(county);
        if (!normalized || seen.has(normalized)) throw invalid(`Missing or duplicate county at F${sheetRow}: ${sourceAct} / ${lineup.masterLineup}.`);
        seen.add(normalized);
        const amount = supplierAmount(row[6], `G${sheetRow}`);
        const old = oldCounties.get(normalized);
        if (amount == null) {
          if (old?.price > 0) throw invalid(`An existing supplier rate is blank at G${sheetRow}: ${sourceAct} / ${lineup.masterLineup} / ${county}.`);
          continue;
        }
        counties[old?.name || county] = amount;
        sourceRows.push(sheetRow);
        if (old?.price !== amount) actChangedRates += 1;
      }
      for (const [county, previous] of oldCounties) {
        if (previous.price > 0 && !seen.has(county)) throw invalid(`An existing county rate is missing: ${sourceAct} / ${lineup.masterLineup} / ${previous.name}.`);
      }
      if (!Object.keys(counties).length) throw invalid(`No priced counties for ${sourceAct} / ${lineup.masterLineup}.`);
      next.lineups[id] = { ...lineup, counties, sourceRows };
      rates += Object.keys(counties).length;
      lineups += 1;
    }
    next.sourceAct = sourceAct;
    next.sourceSheetId = MASTER_PRICING_SHEET_ID;
    next.sourceSheet = sheetTitle;
    next.minimumSupplierPrice = minimumSupplierPrice({ supplierPricing: next });
    const minDisplayPrice = minimumCustomerPrice({ supplierPricing: next });
    const metadataChanged = before.sourceAct !== sourceAct || before.sourceSheetId !== MASTER_PRICING_SHEET_ID || before.sourceSheet !== sheetTitle;
    if (actChangedRates || metadataChanged || act.minDisplayPrice !== minDisplayPrice || before.minimumSupplierPrice !== next.minimumSupplierPrice) {
      next.importedAt = readAt;
      changes.push({ actId: act._id, name: act.tscName, before: { supplierPricing: before, minDisplayPrice: act.minDisplayPrice },
        pricingFields: { supplierPricing: next, minDisplayPrice, basePrice: next.minimumSupplierPrice }, changedRates: actChangedRates });
    }
    changedRates += actChangedRates;
  }
  return { changes, summary: { acts: acts.length, lineups, rates, changedActs: changes.length, changedRates } };
}

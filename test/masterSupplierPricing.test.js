import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMasterPricingPlan, MASTER_PRICING_ID, MASTER_PRICING_SHEET_ID } from '../services/masterSupplierPricing.js';

const header = ['Original act', 'EN act name', 'Status', 'Lineup description', 'Region', 'County', 'Supplier price', 'Estimated EN public price', 'Website status', 'Captured', 'Lineup ID', 'Pricing basis', 'Pricing notes'];
const rate = (county, price, act = 'Example Band', lineup = 'Standard 3-piece') => [act, 'Agency Alias', 'Current/live', 'Three musicians', 'Region', county, price, '£999,999', 'Displayed', '', lineup];
const act = { _id: 'act-id', tscName: 'Example Band', minDisplayPrice: 1330,
  lineups: [{ lineupId: 'reviewed-lineup', bandMembers: [{ email: 'PRIVATE' }] }], extras: { fee: 'PRIVATE' },
  supplierPricing: { sourceSpreadsheetId: MASTER_PRICING_ID, sourceColumn: 'G',
    lineups: { 'reviewed-lineup': { masterLineup: 'Standard 3-piece', description: 'Keep the website lineup details', counties: { London: 1000, Kent: 1100 } } } } };
const source = [header, rate('Greater London', '£1,000'), rate('Kent', '£1,100')];
const plan = (rows = source, acts = [act], readAt = '2026-11-16T00:00:00Z') => buildMasterPricingPlan({ rows, acts, readAt });

test('column G updates every matched county and applies the customer markup once', () => {
  const snapshot = JSON.stringify(act);
  const p = plan([header, rate('Greater London', '£1,500'), rate('Kent', '£1,600')]);
  assert.equal(p.summary.changedRates, 2);
  const next = p.changes[0].pricingFields;
  assert.equal(next.supplierPricing.lineups['reviewed-lineup'].counties.London, 1500);
  assert.equal(next.supplierPricing.lineups['reviewed-lineup'].counties.Kent, 1600);
  assert.equal(next.basePrice, 1500);
  assert.equal(next.minDisplayPrice, 1945);
  assert.equal(JSON.stringify(act), snapshot);
  assert(!JSON.stringify(p).includes('PRIVATE'));
});

test('unchanged prices are idempotent after the source metadata is installed', () => {
  const first = plan();
  assert.equal(first.summary.changedRates, 0);
  const saved = { ...act, ...first.changes[0].pricingFields };
  const next = plan(source, [saved], '2026-11-17T00:00:00Z');
  assert.equal(next.changes.length, 0);
  assert.equal(saved.supplierPricing.sourceSheetId, MASTER_PRICING_SHEET_ID);
});

test('reviewed aliases remain exact and new sheet lineups are not invented on the website', () => {
  const p = plan([header, rate('Greater London', '£1,000', 'Motown Magic'), rate('Kent', '£1,100', 'Motown Magic'),
    rate('Kent', '£50', 'Motown Magic', 'Unreviewed new duo')], [{ ...act, tscName: 'Dancefloor Magic' }]);
  assert.equal(p.changes[0].pricingFields.supplierPricing.sourceAct, 'Motown Magic');
  assert.deepEqual(Object.keys(p.changes[0].pricingFields.supplierPricing.lineups), ['reviewed-lineup']);
});

test('missing, duplicate and invalid rates stop the plan before any prices can change', () => {
  for (const rows of [
    [header, rate('Greater London', '£2,000')],
    [header, rate('Greater London', '£2,000'), rate('Kent', '')],
    [header, rate('Greater London', '£2,000'), rate('Kent', '#REF!')],
    [header, rate('Greater London', '£2,000'), rate('London', '£2,000'), rate('Kent', '£1,100')],
    [header, rate('Greater London', '£2,000', 'Wrong band'), rate('Kent', '£1,100', 'Wrong band')],
  ]) assert.throws(() => plan(rows), { code: 'MASTER_PRICING_INVALID' });
  const wrongHeader = [...header]; wrongHeader[6] = 'Estimated EN public price';
  assert.throws(() => plan([wrongHeader, ...source.slice(1)]), /column 7/);
  assert.throws(() => plan(source, [{ ...act, lineups: [] }]), /lineup was removed/);
  assert.equal(act.minDisplayPrice, 1330);
});

test('previously unavailable counties may gain a rate without deleting known rates', () => {
  const p = plan([...source, rate('Somerset', '£900.50'), rate('Devon', '—')]);
  assert.equal(p.changes[0].pricingFields.minDisplayPrice, Math.ceil(900.5 * 1.33) - 50);
  assert.equal(p.changes[0].pricingFields.supplierPricing.lineups['reviewed-lineup'].counties.Devon, undefined);
  assert.equal(p.summary.changedRates, 1);
});

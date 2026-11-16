import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierQuote, minimumSupplierPrice, customerPrice, countyKey } from './supplierPricing.js';
import calculateWebsitePrice from '../services/websiteLineupPricing.js';
import calculateActPricing from './calculateActPricing.js';
import { buildCard } from '../services/buildActFilterCard.js';
import { normalizeActCard } from '../services/normalizeActCard.js';

const lineup = { lineupId: 'six', actSize: '6-Piece', bandMembers: [{ fee: 9999, instrument: 'Guitar' }] };
const act = { tscName: 'Example', lineups: [lineup], useCountyTravelFee: true, countyFees: { London: 999 },
  supplierPricing: { lineups: { six: { counties: { London: 2760, Kent: 2900, Devon: 0 } } } }, minDisplayPrice: 3671 };

test('website county names resolve to master county names', () => {
  assert.equal(countyKey('Greater Manchester'), countyKey('Manchester'));
  assert.equal(countyKey('East Riding of Yorkshire'), countyKey('East Yorkshire'));
  assert.equal(countyKey('City of Edinburgh'), countyKey('Edinburgh'));
});

test('master fee includes travel and gets the customer margin exactly once', async () => {
  const quote = supplierQuote(act, lineup, 'Greater London');
  assert.equal(quote.supplierPrice, 2760);
  assert.equal(quote.total, 3671);
  assert.equal(customerPrice(quote), 3671);
  assert.equal(quote.travelCalculated, true);
  const travel = () => { throw new Error('Must not add travel to a complete master fee'); };
  assert.equal((await calculateWebsitePrice(act, 'London', 'SW1A 1AA', '2027-01-01', lineup, travel)).total, 3671);
  assert.equal((await calculateActPricing(act, 'London', 'SW1A 1AA', '2027-01-01', lineup)).total, 3671);
});

test('county and lineup changes select the precise rate; no zero or missing county becomes free', () => {
  assert.equal(supplierQuote(act, lineup, ' KENT ').total, 3857);
  for (const county of ['Devon', 'Unknown']) assert.equal(supplierQuote(act, lineup, county).total, null);
  assert.equal(supplierQuote(act, { lineupId: 'unmapped' }, 'London'), undefined);
  assert.equal(supplierQuote({}, lineup, 'London'), undefined);
});

test('starting prices and cached cards retain supplier and retail amounts separately', () => {
  assert.equal(minimumSupplierPrice(act), 2760);
  const start = supplierQuote(act, lineup, '');
  assert.equal(start.total, 3671);
  assert.equal(start.travelCalculated, false);
  const raw = buildCard(act);
  assert.equal(raw.basePrice, 2760);
  assert.equal(raw.minDisplayPrice, 3671);
  const card = normalizeActCard(raw, act);
  assert.equal(card.minDisplayPrice, 3671);
  assert.deepEqual(card.supplierPricing, act.supplierPricing);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { directBookingSaving, normalWebsitePrice, minimumCustomerPrice, supplierQuote, minimumSupplierPrice, customerPrice, countyKey } from './supplierPricing.js';
import calculateWebsitePrice from '../services/websiteLineupPricing.js';
import calculateActPricing from './calculateActPricing.js';
import { buildCard } from '../services/buildActFilterCard.js';
import { normalizeActCard } from '../services/normalizeActCard.js';

const lineup = { lineupId: 'six', actSize: '6-Piece', bandMembers: [{ fee: 9999, instrument: 'Guitar' }] };
const act = { tscName: 'Example', lineups: [lineup], useCountyTravelFee: true, countyFees: { London: 999 },
  supplierPricing: { lineups: { six: { counties: { London: 2760, Kent: 2900, Devon: 0 } } } }, minDisplayPrice: 3571 };

test('website county names resolve to master county names', () => {
  assert.equal(countyKey('Greater Manchester'), countyKey('Manchester'));
  assert.equal(countyKey('East Riding of Yorkshire'), countyKey('East Yorkshire'));
  assert.equal(countyKey('City of Edinburgh'), countyKey('Edinburgh'));
});

test('master fee includes travel and gets the customer margin exactly once', async () => {
  const quote = supplierQuote(act, lineup, 'Greater London');
  assert.equal(quote.supplierPrice, 2760);
  assert.equal(quote.total, 3571);
  assert.equal(customerPrice(quote), 3571);
  assert.equal(quote.travelCalculated, true);
  const travel = () => { throw new Error('Must not add travel to a complete master fee'); };
  assert.equal((await calculateWebsitePrice(act, 'London', 'SW1A 1AA', '2027-01-01', lineup, travel)).total, 3571);
  assert.equal((await calculateActPricing(act, 'London', 'SW1A 1AA', '2027-01-01', lineup)).total, 3571);
});

test('county and lineup changes select the precise rate; no zero or missing county becomes free', () => {
  assert.equal(supplierQuote(act, lineup, ' KENT ').total, 3757);
  for (const county of ['Devon', 'Unknown']) assert.equal(supplierQuote(act, lineup, county).total, null);
  assert.equal(supplierQuote(act, { lineupId: 'unmapped' }, 'London'), undefined);
  assert.equal(supplierQuote({}, lineup, 'London'), undefined);
});

test('starting prices and cached cards retain supplier and retail amounts separately', () => {
  assert.equal(minimumSupplierPrice(act), 2760);
  const start = supplierQuote(act, lineup, '');
  assert.equal(start.total, 3571);
  assert.equal(start.travelCalculated, false);
  const raw = buildCard(act);
  assert.equal(raw.basePrice, 2760);
  assert.equal(raw.minDisplayPrice, 3571);
  const card = normalizeActCard(raw, act);
  assert.equal(card.minDisplayPrice, 3571);
  assert.deepEqual(card.supplierPricing, act.supplierPricing);
});


test('fixed saving tier uses the normal London lineup guide, including the £2500 boundary', () => {
  assert.equal(directBookingSaving(2499), 50);
  assert.equal(directBookingSaving(2500), 100);
  assert.equal(directBookingSaving(2501), 100);
  assert.equal(directBookingSaving(0), 0);
  assert.equal(normalWebsitePrice(1402), 1865);
  const lineup = { lineupId: 'three' };
  const act = { supplierPricing: { lineups: { three: { counties: { 'Greater London': 1402, Kent: 2000, Devon: 0 } } } } };
  const before = JSON.stringify(act);
  assert.equal(supplierQuote(act, lineup, 'London').total, 1815);
  // Travelling to a more expensive county does not increase the lineup's saving.
  assert.equal(supplierQuote(act, lineup, 'Kent').total, 2610);
  assert.equal(supplierQuote(act, lineup, 'Kent').directBookingSaving, 50);
  assert.equal(supplierQuote(act, lineup, 'Devon').total, null);
  assert.equal(customerPrice(supplierQuote(act, lineup, 'Kent')), 2610);
  assert.equal(JSON.stringify(act), before);
});

test('starting price is the cheapest discounted eligible lineup/county, not a second discount', () => {
  const act = { minDisplayPrice: 12345, supplierPricing: { lineups: {
    small: { counties: { London: 1402, Kent: 2000 } },
    large: { counties: { London: 2760, Somerset: 1400 } },
  } } };
  assert.equal(minimumSupplierPrice(act), 1400);
  assert.equal(minimumCustomerPrice(act), 1762);
  // Missing London references do not invent a tier from the requested county.
  assert.equal(supplierQuote({ supplierPricing: { lineups: { x: { counties: { Kent: 1000 } } } } }, { lineupId: 'x' }, 'Kent').directBookingSaving, 0);
});

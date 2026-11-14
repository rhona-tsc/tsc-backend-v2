import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAutomaticDeputyPrice } from '../services/automaticDeputyPricing.js';

function fixture() {
  const headers = [[], []];
  headers[0][9] = 'FOR LONDON BASED VOCALISTS';
  headers[1][35] = 'Rachel & Shamyra';
  const singers = Array.from({ length: 15 }, () => []);
  singers[14] = ['Indigo Delight', 'Sophia', '07738 636961', 'sophia@example.test', '', '£300', '', '£275'];
  const counties = Array.from({ length: 26 }, () => []);
  counties[25] = ['Herefordshire', '59', '118', '40', '', '£158'];
  counties[25][26] = '£114'; // AJ, Rachel/Shamyra’s personal travel
  return { headers, singers, counties, roleRows: [['Indigo Delight', 'Royal Charm', 'Standard 4-piece', '', '4', '1', '0', '3', '£300', '£0']], readAt: '2026-11-14T20:00:00Z' };
}
const musician = { _id: 'sophia-id', phoneNormalized: '+447738636961', email: 'sophia@example.test' };
const price = (rates, overrides = {}) => calculateAutomaticDeputyPrice({ rates, musician, county: 'Herefordshire', dateISO: '2028-02-05', actName: 'Indigo Delight', bandSize: 4, ...overrides });

test('Sophia Saturday 5 February 2028: £300 plus £158 total return travel = £458, with source cells', () => {
  const result = price(fixture());
  assert.equal(result.total, 458);
  assert.equal(result.base, 300);
  assert.equal(result.travel, 158);
  assert.equal(result.baseCell, 'F17');
  assert.equal(result.travelCell, 'O28');
  assert.equal(result.musicianId, 'sophia-id');
});
test('missing postcode and disabled act county travel cannot drop verified personal travel', () => {
  const result = price(fixture(), { act: { useCountyTravelFee: false, countyFees: { Herefordshire: 114 } }, inheritedFee: 414 });
  assert.equal(result.total, 458); // neither the other singer’s £114 nor a prior inclusive offer is reused
});
test('a northern deputy uses her named travel column rather than the London £158', () => {
  const rates = fixture();
  rates.singers[14][1] = 'Shamyra';
  const result = price(rates);
  assert.equal(result.total, 414);
  assert.equal(result.travelCell, 'AJ28');
});
test('an explicitly displayed zero is allowed; a blank or spreadsheet error is not zero', () => {
  for (const value of ['', '#REF!', 'TBC', '£158 proposed']) {
    const rates = fixture(); rates.counties[25][5] = value;
    assert.throws(() => price(rates), { code: 'DEPUTY_PRICING_UNCONFIRMED' });
  }
  const rates = fixture(); rates.counties[25][5] = '£0';
  assert.equal(price(rates).total, 300);
});
test('blank own travel does not fall back to another location’s fee', () => {
  const rates = fixture(); rates.singers[14][1] = 'Shamyra'; rates.counties[25][26] = '';
  assert.throws(() => price(rates), /AJ28/);
});
test('ambiguous contact, unknown singer and missing county prevent an offer', () => {
  const rates = fixture(); rates.singers.push([...rates.singers[14]]);
  assert.throws(() => price(rates), /unique contact/);
  assert.throws(() => price(fixture(), { musician: { _id: 'other', email: 'unknown@example.test' } }), /contact/);
  assert.throws(() => price(fixture(), { county: 'Unverified' }), /travel/);
});
test('VAT-qualified, blank or modelled base rates and notes require review', () => {
  for (const value of ['', '300+VAT', 'proposed £300', '#REF!']) {
    const rates = fixture(); rates.singers[14][5] = value;
    assert.throws(() => price(rates), { code: 'DEPUTY_PRICING_UNCONFIRMED' });
  }
  const rates = fixture(); rates.singers[14][4] = 'Restrictions apply';
  assert.throws(() => price(rates), /notes/);
});
test('unconfirmed Sunday and New Year’s Eve pricing cannot inherit a Saturday fee', () => {
  assert.throws(() => price(fixture(), { dateISO: '2028-02-06' }), /G17/);
  assert.throws(() => price(fixture(), { dateISO: '2028-12-31' }), /holiday/);
  assert.equal(price(fixture(), { dateISO: '2028-02-07' }).personalBase, 275);
  assert.equal(price(fixture(), { dateISO: '2028-02-07' }).base, 300);
});
test('essential role extras are included exactly once on top of own base and total travel', () => {
  const result = price(fixture(), { essentialRoles: [{ isEssential: true, additionalFee: 25 }, { isEssential: false, additionalFee: 90 }] });
  assert.equal(result.total, 483);
  assert.equal(result.essentialExtras, 25);
});

test('an updated act minimum cannot be undercut by a legacy £300 roster/personal base', () => {
  const rates = fixture(); rates.roleRows[0][8] = '£355';
  const result = price(rates);
  assert.equal(result.base, 355);
  assert.equal(result.total, 513);
});
test('a missing or ambiguous act/lineup minimum holds instead of guessing a role fee', () => {
  assert.throws(() => price(fixture(), { bandSize: 9 }), /act\/lineup/);
  const rates = fixture(); rates.roleRows.push([...rates.roleRows[0]]); rates.roleRows[1][8] = '£355';
  assert.throws(() => price(rates), /act\/lineup/);
});

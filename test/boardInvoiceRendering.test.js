import test from 'node:test';
import assert from 'node:assert/strict';
import parse from 'pdf-parse/lib/pdf-parse.js';

// Synthetic keys keep these render-only tests independent of live credentials.
process.env.STRIPE_SECRET_KEY_V2 = 'sk_test_render_only';
process.env.STRIPE_SECRET_KEY = 'sk_test_render_only';
const { buildBoardInvoiceSplit, makeInvoicePdfBuffer } = await import('../controllers/invoicesController.js');
const company = { brand: 'TSC', name: 'The Supreme Collective Ltd', companyNumber: '16883956', vatRate: 0, bank: {} };
const fixture = () => ({ bookingRef: 'EXAMPLE-INVOICE', agent: 'Direct', clientName: 'Example client',
  eventDateISO: '2026-11-28', invoiceDateISO: '2026-11-05', grossValue: 2972,
  payments: { depositChargedAmount: 980.76 }, accounting: { commissionGross: 721.24, passThroughGross: 1270 },
});
const render = async (row) => {
  const split = buildBoardInvoiceSplit(row, company);
  const { text, numpages } = await parse(Uint8Array.from(await makeInvoicePdfBuffer(row, split, company)), { version: "v2.0.550" });
  assert.equal(numpages, 1);
  return text;
};
test('rendered balance-only invoice includes the correct amount with no deposit deduction', async () => {
  const text = await render(fixture());
  assert.match(text, /Outstanding balance for band performance/);
  assert.match(text, /Total due\s*£1,991\.24/);
  assert.doesNotMatch(text, /Deposit already paid|980\.76|1,010\.48/);
});
test('rendered full-fee invoice includes the fee, deposit and correct remaining balance', async () => {
  const row = fixture(); row.accounting.commissionGross = 1702;
  const text = await render(row);
  assert.match(text, /£2,972\.00/);
  assert.match(text, /Deposit already paid\s*-£980\.76/);
  assert.match(text, /Total due\s*£1,991\.24/);
});
test('mismatched allocation renders the contract total without misleading fee columns', async () => {
  const row = fixture(); row.accounting = { commissionGross: 600, passThroughGross: 600 };
  const text = await render(row);
  assert.match(text, /Booking total\s*£2,972\.00/);
  assert.match(text, /Deposit already paid\s*-£980\.76/);
  assert.match(text, /Total due\s*£1,991\.24/);
  assert.doesNotMatch(text, /Supplier fee|Mgmt fee|£600\.00/);
});
test('extras-only invoice does not subtract the original booking deposit', async () => {
  const row = { ...fixture(), invoiceType: 'extras', extras: [{ name: 'Later extra', quantity: 1, price: 417 }] };
  const text = await render(row);
  assert.match(text, /Total due\s*£417\.00/);
  assert.doesNotMatch(text, /Deposit already paid|980\.76/);
});

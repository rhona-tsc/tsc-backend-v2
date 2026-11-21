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
test('main invoice keeps extras separate by default', async () => {
  const row = {
    ...fixture(),
    originalBookingTotal: 2972,
    grossValue: 3000,
    extras: [{ name: 'Parking', quantity: 1, price: 28 }],
  };
  row.accounting = { commissionGross: 1702, passThroughGross: 1270 };
  const text = await render(row);
  assert.doesNotMatch(text, /Parking/);
  assert.match(text, /Total due\s*£1,991\.24/);
});
test('main invoice includes extras only when explicitly selected', async () => {
  const row = {
    ...fixture(),
    originalBookingTotal: 2972,
    grossValue: 3000,
    mainInvoiceIncludesExtras: true,
    extras: [{ name: 'Parking', quantity: 1, price: 28 }],
  };
  row.accounting = { commissionGross: 1702, passThroughGross: 1270 };
  const text = await render(row);
  assert.match(text, /Parking/);
  assert.match(text, /Total due\s*£2,019\.24/);
});
test('client bank override displays domestic and international details together',async()=>{
 const text=await render({...fixture(),contactRole:'agent',eventDateISO:'2026-12-31',invoiceDueDateISO:'2026-12-24',paymentInstructions:{accountName:'Rhona Gill Downie',bankName:'Barclays — THE BARCLAYS BANK A/C',sortCode:'20-44-91',accountNumber:'30465151',iban:'GB26BARC20449130465151',swiftBic:'BARCGB22'}});
 for(const value of ['Rhona Gill Downie','20-44-91','30465151','GB26BARC20449130465151','BARCGB22'])assert.ok(text.includes(value));
 assert.doesNotMatch(text,/Mettle/);
 assert.match(text,/24 December 2026/);
});

const extrasFixture = () => ({ ...fixture(), bookingRef: 'BBM 407 LIGHTFOOT', invoiceType: 'extras',
  extras: [
    { name: 'Lunch Allowance', price: 20, quantity: 1, passThroughGross: 20, managementGross: 0, paidAmount: 20, paidAt: '2026-11-18T12:00:00Z' },
    { name: 'Parking', price: 28, quantity: 3, passThroughGross: 28, managementGross: 0 },
    { name: 'Parking', price: 34, quantity: 1, passThroughGross: 34, managementGross: 0 },
    { name: 'Wireless Mic', price: 125, quantity: 1, passThroughGross: 50, managementGross: 75 },
  ] });
test('extras preserve supplier and management splits while subtracting only the recorded lunch payment', async () => {
  const bmm = { ...company, brand: 'BMM', vatRate: 0.2 };
  const row = extrasFixture(); const split = buildBoardInvoiceSplit(row, bmm);
  assert.equal(split.gross, 263); assert.equal(split.passThroughGross, 188);
  assert.equal(split.managementGross, 75); assert.equal(split.managementVat, 12.5);
  assert.equal(split.paidAmount, 20); assert.equal(split.amountDue, 243);
  assert.equal(split.outstandingPassThroughGross, 168); assert.equal(split.outstandingManagementGross, 75);
  const { text, numpages } = await parse(Uint8Array.from(await makeInvoicePdfBuffer(row, split, bmm)), { version: 'v2.0.550' });
  assert.equal(numpages, 1); assert.match(text, /Total due\s*£243\.00/);
  assert.match(text, /Invoice total\s*£263\.00/); assert.match(text, /Paid: Lunch Allowance/);
  assert.match(text, /18 November 2026/); assert.match(text, /-£20\.00/);
  assert.match(text, /Invoice ref: BBM 407 LIGHTFOOT-EXTRAS/);
  assert.match(text, /Supplier fees\s*£188\.00/);
  assert.doesNotMatch(text, /deposits|refundable|Deposit already paid/i);
});
test('a refundable deposit is labelled only when an actual refundable deposit is present', async () => {
  const text = await render({ ...fixture(), invoiceType:'extras', extras:[{name:'Equipment security deposit',price:50,quantity:1,passThroughGross:50,refundableDeposit:true}] });
  assert.match(text,/Refundable deposits\s*£50\.00/); assert.match(text,/Total due\s*£50\.00/);
});
test('the existing lunch receipt does not claim that newly added unpaid extras were paid', async () => {
  const { partialExtrasReceiptRow } = await import('../utils/extraInvoicePayments.js');
  const row = partialExtrasReceiptRow({...extrasFixture(), documentType:'receipt'}, extrasFixture().extras);
  const text = await render(row);
  assert.match(text,/Total paid\s*£20\.00/); assert.match(text,/18 November 2026/);
  assert.doesNotMatch(text,/Parking|Wireless Mic|£263\.00|£243\.00/);
});

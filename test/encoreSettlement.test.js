import test from 'node:test';
import assert from 'node:assert/strict';
import { isEncoreBooking, resolveEncoreSettlement } from '../utils/encoreSettlement.js';
import { effectiveLineupRoles, lineupDisplayLabel } from '../utils/bookingLineupAdditions.js';
import { getBalanceAmounts } from '../services/bookingBalancePaymentService.js';
import { buildIntroInvoiceAttachments } from '../utils/introInvoiceAttachment.js';
const fixture = () => ({ agent: 'Encore', originalBookingTotal: 2615, grossValue: 3255,
  lineupSelected: 'Bespoke 4-piece', bandSize: 4,
  lineupComposition: ['Lead Vocal / Rapper', 'Electric Guitar', 'Drums', 'Bass Guitar'],
  payments: { depositChargedAmount: 563, invoicePaid: true },
  extras: [{ name: 'Saxophone', price: 640, quantity: 1, addsMusician: true, musicianRole: 'Saxophone' }],
  accounting: { commissionGross: 600, passThroughGross: 2015 },
});
test('Encore client liability includes only separate extras, independent of deposit and original settlement', () => {
  const row = fixture(), before = JSON.stringify(row);
  const amounts = resolveEncoreSettlement(row);
  assert.equal(amounts.bookingTotal, 2615);
  assert.equal(amounts.addOnsPostBooking, 640);
  assert.equal(amounts.fullAmount, 3255);
  assert.equal(amounts.depositAmount, 0);
  assert.equal(amounts.remainingAmount, 640);
  assert.deepEqual(amounts.paymentArrangement, { provider: 'Encore', arrangedAmount: 2615, extrasPaid: false });
  assert.equal(JSON.stringify(row), before);
  row.payments.balancePaymentReceived = true;
  assert.equal(resolveEncoreSettlement(row).remainingAmount, 640);
  row.payments.extrasInvoicePaid = true;
  assert.equal(resolveEncoreSettlement(row).remainingAmount, 0);
});
test('zero extras means no client liability while the original earnings remain arranged through Encore', () => {
  const row = fixture(); row.extras = [];
  const result = resolveEncoreSettlement(row);
  assert.equal(result.remainingAmount, 0); assert.equal(result.fullAmount, 2615);
  assert.equal(result.paymentArrangement.arrangedAmount, 2615);
});
test('unverified legacy quotes are not guessed into earnings; importer evidence is accepted', () => {
  assert.equal(resolveEncoreSettlement({ grossValue: 3268.75 }), null);
  assert.equal(resolveEncoreSettlement({ importMetadata: { encore: { earnings: 2615 } } }).bookingTotal, 2615);
  assert.equal(isEncoreBooking({ importMetadata: { source: 'encore_pdf' } }), true);
  assert.equal(isEncoreBooking({ agent: 'Direct' }), false);
});
test('a marked additional player augments base roles without changing the original contract or doubling on refresh', () => {
  const row = fixture();
  assert.equal(lineupDisplayLabel(row), 'Bespoke 4-piece + Saxophone (5 musicians)');
  assert.equal(effectiveLineupRoles(row).length, 5);
  assert.deepEqual(effectiveLineupRoles(row), effectiveLineupRoles(row));
  assert.equal(row.lineupComposition.length, 4);
  row.extras.push({ name: 'Photography', quantity: 1 }, { name: 'Late stay', quantity: 5 });
  assert.equal(effectiveLineupRoles(row).length, 5);
  row.extras[0].quantity = 2;
  assert.equal(effectiveLineupRoles(row).length, 6);
  assert.match(lineupDisplayLabel(row), /2 × Saxophone \(6 musicians\)/);
  row.extras = [];
  assert.equal(lineupDisplayLabel(row), 'Bespoke 4-piece');
  assert.equal(effectiveLineupRoles(row).length, 4);
});
test('Encore cannot generate an original client checkout or attach an old main invoice', async () => {
  assert.throws(() => getBalanceAmounts(fixture()), /arranged through Encore/);
  let downloads = 0;
  const result = await buildIntroInvoiceAttachments({ ...fixture(), invoiceUrl: 'https://example.test/old.pdf' }, {
    fetchImpl: () => { downloads++; throw Error('should not download'); },
  });
  assert.deepEqual(result, []); assert.equal(downloads, 0);
});

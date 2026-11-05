import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInvoiceAmounts } from '../utils/invoiceAmounts.js';

test('balance-only Louise invoice does not subtract the deposit twice', () => {
  assert.deepEqual(resolveInvoiceAmounts({ storedGross: 2972, calculatedGross: 1991.24, depositPaid: 980.76 }), {
    gross: 1991.24, depositPaid: 0, amountDue: 1991.24, balanceOnly: true, totalOnly: false,
  });
});
test('full fee invoice shows and subtracts the deposit once', () => {
  const result = resolveInvoiceAmounts({ storedGross: 2972, calculatedGross: 2972, depositPaid: 980.76 });
  assert.equal(result.gross, 2972);
  assert.equal(result.depositPaid, 980.76);
  assert.equal(result.amountDue, 1991.24);
  assert.equal(result.balanceOnly, false);
});
test('inconsistent accounting falls back to contracted fee without inventing allocations', () => {
  const result = resolveInvoiceAmounts({ storedGross: 2972, calculatedGross: 1200, depositPaid: 980.76 });
  assert.equal(result.gross, 2972);
  assert.equal(result.amountDue, 1991.24);
  assert.equal(result.totalOnly, true);
});
test('external-agency invoices with no deductible deposit keep the agreed fee', () => {
  assert.equal(resolveInvoiceAmounts({ storedGross: 1270, calculatedGross: 1270, depositPaid: 0 }).amountDue, 1270);
});
test('legacy rows without full totals retain their accounting total', () => {
  assert.equal(resolveInvoiceAmounts({ storedGross: 0, calculatedGross: 1000, depositPaid: 100 }).amountDue, 900);
});
test('separate extras and manual adjustments are not discarded by the contract-total fallback', () => {
  assert.equal(resolveInvoiceAmounts({ storedGross: 2972, calculatedGross: 3389, depositPaid: 980.76, adjustments: 417 }).amountDue, 2408.24);
  assert.equal(resolveInvoiceAmounts({ storedGross: 2972, calculatedGross: 2872, depositPaid: 980.76, adjustments: -100 }).amountDue, 1891.24);
});

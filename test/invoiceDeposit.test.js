import test from "node:test";
import assert from "node:assert/strict";

import {
  getDepositPaidToInvoiceCompany,
  isExternalAgencyBooking,
} from "../utils/invoiceDeposit.js";

test("an Entertainment Nation deposit is not treated as paid to Bamboo", () => {
  const booking = {
    agent: "Entertainment Nation",
    payments: { depositChargedAmount: 547 },
  };

  assert.equal(isExternalAgencyBooking(booking), true);
  assert.equal(getDepositPaidToInvoiceCompany(booking), 0);
});

test("a direct Stripe deposit remains deductible from the balance invoice", () => {
  const booking = {
    agent: "TSC Direct",
    payments: { depositChargedAmount: 547 },
  };

  assert.equal(isExternalAgencyBooking(booking), false);
  assert.equal(getDepositPaidToInvoiceCompany(booking), 547);
});

test("a legacy booking without an agent can retain its charged deposit", () => {
  const booking = { payments: { depositChargedAmount: 250 } };

  assert.equal(isExternalAgencyBooking(booking), false);
  assert.equal(getDepositPaidToInvoiceCompany(booking), 250);
});

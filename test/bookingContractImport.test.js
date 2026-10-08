import test from "node:test";
import assert from "node:assert/strict";

import { parseBookingContract } from "../routes/bookingBoardRoutes.js";

test("contract import recognises pound-symbol totals and creates a deposit invoice draft", () => {
  const contractText = `
Contract Ref: BBM 499 BREWERS
Date of Issue: 8th October 2026
Contact Name: Alex
Contact Telephone: 020 8501 1313
Contact Address: Brunning & Price Limited, 5-7 Marshalsea Road, London, SE1 1EP
Contact Email: two.brewers@brunningandprice.co.uk
Event Type: New Years Eve Party
Event Date: 31st December 2026
Venue Address: The Two Brewers, 47 Lambourne Road, Chigwell, IG7 6ET
Artist Line-up: 3-piece (lead female vocal/guitar, bass, drums with backing vocals)
Artist Arrival Time: from 5.30pm
Artist Finish Time: 12.30am
Performance Plan: 2x60mins or 3x40mins
Total: £1600
Deposit: £500
The deposit amount is payable to Bamboo Music Management Ltd within 7 days of the issuing of this contract.
Balance to pay: £1100
Bamboo Music Management Booking Contract issued on behalf of the 'Artist' (Romy B).
`;

  const draft = parseBookingContract(contractText);

  assert.equal(draft.bookingRef, "BBM 499 BREWERS");
  assert.equal(draft.actName, "Romy B");
  assert.equal(draft.grossValue, 1600);
  assert.equal(draft.commissionGross, 500);
  assert.equal(draft.passThroughGross, 1100);
  assert.equal(draft.currency, "GBP");
  assert.equal(draft.depositInvoice.gross, 500);
  assert.equal(draft.depositInvoice.invoiceCompany, "BMM");
  assert.equal(draft.depositInvoice.issueDateISO, "2026-10-08");
  assert.equal(draft.depositInvoice.dueDateISO, "2026-10-15");
});

test("contract import continues to recognise three-letter currencies", () => {
  const contractText = `
Contract Ref: EUR 123
Date of Issue: 8th October 2026
Contact Name: Client
Event Date: 31st December 2026
Artist Name: Example Artist
Total: EUR 1,600.00
Deposit: EUR 500.00
Balance to pay: EUR 1,100.00
`;

  const draft = parseBookingContract(contractText);

  assert.equal(draft.currency, "EUR");
  assert.equal(draft.grossValue, 1600);
  assert.equal(draft.depositInvoice.gross, 500);
});

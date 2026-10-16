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

test("Encore booking and acceptance PDFs import the agent fee and artist earnings", () => {
  const bookingText = `
Booking Overview
Job reference:nxaaiWhat's this?
Booked as:
The Riot Dogs
Deposit paid - Encore Pay
You quoted:£1988.75
Your earnings:£1591
Contact details:
Chris Brydon
chrisbrydon01@gmail.co
m
07397156218
Line-up:
4 musicians
This quote is for:
2x60 minutes sets
Location:
Grove Park Drive
Ardington, Wantage
OX12 7QG
Date:
07 Nov 2026
Arrive
7.00pm
2nd Mar 2026Chris requested a quote from you
`;
  const acceptedEmailText = `
Encore bookings <bookings@encoremusicians.com>16 April 2026 at 09:43
Saturday 07 November 2026
7:00pm for 2 hours
(2 x 60min sets)
Performance fee£1988.75
Service fee- £397.75
Your earnings£1591.00
`;

  const draft = parseBookingContract(bookingText, acceptedEmailText);

  assert.equal(draft.bookingRef, "nxaai");
  assert.equal(draft.agent, "Encore");
  assert.equal(draft.actName, "The Riot Dogs");
  assert.equal(draft.clientEmail, "chrisbrydon01@gmail.com");
  assert.equal(draft.eventDateISO, "2026-11-07");
  assert.equal(draft.bookingDateISO, "2026-04-16");
  assert.equal(draft.enquiryDateISO, "2026-03-02");
  assert.equal(draft.grossValue, 1988.75);
  assert.equal(draft.commissionGross, 397.75);
  assert.equal(draft.passThroughGross, 1591);
  assert.equal(draft.accounting.commissionVat, 0);
  assert.equal(draft.payments.depositChargedAmount, 159.1);
  assert.equal(draft.bandSize, 4);
  assert.equal(draft.arrivalTime, "19:00");
});

test("Entertainment Nation artist-copy contracts import supplier-labelled fields", () => {
  const contractText = `
Entertainment Nation Booking Contract
Issued by the 'Agent' (Entertainment Nation) on behalf of the 'Client' (James Kemp) and the 'Supplier' (Rhythm Mystique)
Contract Ref : 260927276335
Date of Issue : 02/10/2026
Contact Name : James Kemp
Contact Telephone : 07801285488
Contact Address : Tubslake, Water Lane, Cranbrook, TN18 5AP
Contact Email : james@tlfservices.co.uk
Event Type : Party
Event Date : 21/11/26
Venue Address : The Winemakers Pub, Cranbrook Road, Goudhurst, Kent, TN17 1XP
Supplier Line-up : 5 Piece Band: Female Lead Vocals, Guitar, Keys, Bass and Drums
Supplier Arrival Time : 17:00 or later
Supplier Setup Time : 60-90 minutes
Supplier Change Time : 15 minutes to get changed
Supplier Start Time : TBC
Supplier Finish Time : 00:00
Performance Area Required : 3m x 4m (shape a little flexible)
Performance Plan : 2x60 or 3x40 minute sets plus Playlist DJ Service before, between and after sets until curfew
Supplier Fees to pay : £2172 Payable to the Supplier
`;

  const draft = parseBookingContract(contractText);

  assert.equal(draft.bookingRef, "260927276335");
  assert.equal(draft.eventDateISO, "2026-11-21");
  assert.equal(draft.bookingDateISO, "2026-10-02");
  assert.equal(draft.agent, "Entertainment Nation");
  assert.equal(draft.actName, "Rhythm Mystique");
  assert.equal(draft.clientEmail, "james@tlfservices.co.uk");
  assert.equal(draft.eventType, "Party");
  assert.equal(draft.grossValue, 2172);
  assert.equal(draft.passThroughGross, 2172);
  assert.equal(draft.bandSize, 5);
  assert.equal(draft.arrivalTime, "17:00");
  assert.equal(draft.startTime, "");
  assert.equal(draft.finishTime, "00:00");
  assert.deepEqual(draft.lineupComposition, [
    "Female Lead Vocals", "Guitar", "Keys", "Bass", "Drums",
  ]);
  assert.ok(draft.importMetadata.incompleteFields.includes("startTime"));
});

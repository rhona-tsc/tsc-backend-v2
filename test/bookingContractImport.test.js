import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBookingPatch,
  linkedBookingBoardLinkPatch,
  parseBookingContract,
  protectBookingAssignmentPatch,
  resolveBookingAssignmentsForUpsert,
} from "../routes/bookingBoardRoutes.js";

test("quick edits persist a WhatsApp group link on linked core bookings", async () => {
  const bookingDoc = {
    constructor: {
      schema: {
        path(field) {
          return field === "whatsappGroupLink";
        },
      },
    },
    totals: {},
    async save() {
      return this;
    },
  };

  await applyBookingPatch(bookingDoc, {
    whatsappGroupLink: "https://chat.whatsapp.com/SarahGroup123",
  });

  assert.equal(
    bookingDoc.whatsappGroupLink,
    "https://chat.whatsapp.com/SarahGroup123",
  );
});

test("linked booking link edits are mirrored back to the booking-board row", () => {
  assert.deepEqual(
    linkedBookingBoardLinkPatch({
      whatsappGroupLink: "  https://chat.whatsapp.com/SarahGroup123  ",
    }),
    { whatsappGroupLink: "https://chat.whatsapp.com/SarahGroup123" },
  );
});

test("manual edits and PDF re-imports preserve existing accepted musicians", () => {
  const accepted = {
    musicianId: "69442f43a034dd3ebd6a0487",
    name: "Ione Townsend",
    email: "info@ioneofficial.com",
    role: "Lead Female Vocal",
    roleSlotId: "lead-female-vocal-1",
    status: "accepted",
  };

  const resolved = resolveBookingAssignmentsForUpsert({
    payload: {
      bookingRef: "261018278454",
      importMetadata: { source: "entertainment_nation_pdf" },
    },
    existingBooking: { assignedMusicians: [accepted] },
    existingBoardRow: {},
  });

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].name, "Ione Townsend");
  assert.equal(resolved[0].status, "accepted");
});

test("clearing musicians requires the explicit replacement flag", () => {
  const existing = {
    assignedMusicians: [{ name: "Existing Musician", role: "Drums" }],
  };

  assert.equal(
    resolveBookingAssignmentsForUpsert({
      payload: { assignedMusicians: [] },
      existingBooking: existing,
    }).length,
    1,
  );
  assert.deepEqual(
    resolveBookingAssignmentsForUpsert({
      payload: { assignedMusicians: [], replaceAssignedMusicians: true },
      existingBooking: existing,
    }),
    [],
  );
});

test("creating a new booking tolerates missing existing records", () => {
  assert.deepEqual(
    resolveBookingAssignmentsForUpsert({
      payload: { bookingRef: "260915275050" },
      existingBooking: null,
      existingBoardRow: null,
    }),
    [],
  );
});

test("ordinary booking updates cannot silently submit empty musician arrays", () => {
  const protectedPatch = protectBookingAssignmentPatch({
    clientFirstNames: "James",
    assignedMusicians: [],
    bookingMusicians: [],
    bandLineup: [],
    bookingDetails: { eventType: "Private Party", assignedMusicians: [] },
  });

  assert.equal(protectedPatch.clientFirstNames, "James");
  assert.equal(protectedPatch.assignedMusicians, undefined);
  assert.equal(protectedPatch.bookingMusicians, undefined);
  assert.equal(protectedPatch.bandLineup, undefined);
  assert.equal(protectedPatch.bookingDetails.assignedMusicians, undefined);
});

test("an explicit lineup-clear action is still honoured", () => {
  const protectedPatch = protectBookingAssignmentPatch({
    replaceAssignedMusicians: true,
    assignedMusicians: [],
  });

  assert.equal(protectedPatch.replaceAssignedMusicians, true);
  assert.deepEqual(protectedPatch.assignedMusicians, []);
});

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
  // Encore's client deposit status does not prove an artist payment received.
  assert.equal(draft.payments.depositChargedAmount, 0);
  assert.equal(draft.importMetadata.encore.clientDepositPaidToEncore, true);
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
  assert.equal(draft.clientFirstNames, "James");
  assert.equal(draft.clientLastName, "Kemp");
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

test("Entertainment Nation imports preserve a one-off trumpet lineup", () => {
  const contractText = `
Entertainment Nation Booking Contract
Issued by the 'Agent' (Entertainment Nation) on behalf of the 'Client' (Megan Tompkins) and the 'Supplier' (Rhythm Mystique)
Contract Ref : 260115241436
Date of Issue : 15/01/2026
Contact Name : Megan Tompkins
Contact Email : megan@example.com
Event Date : 31/12/2026
Supplier Name : Rhythm Mystique
Supplier Line-up : 6 Piece Band: Female Lead Vocals, Guitar, Keys, Trumpet, Bass and Drums
Supplier Fees to pay : £3000 Payable to the Supplier
`;

  const draft = parseBookingContract(contractText);

  assert.equal(draft.bandSize, 6);
  assert.deepEqual(draft.lineupComposition, [
    "Female Lead Vocals",
    "Guitar",
    "Keys",
    "Trumpet",
    "Bass",
    "Drums",
  ]);
  assert.equal(draft.lineupComposition.includes("Saxophone"), false);
});

test("contract import stores the first contact's surname when multiple contacts are listed", () => {
  const contractText = `
Entertainment Nation Booking Contract
Contract Ref : 260922275836
Date of Issue : 01/10/2026
Contact Name : Nicki Hiscox / Beth Ford
Contact Email : reception@fireangeltech.com
Event Date : 17/12/2026
Supplier Name : Rhythm Mystique
Supplier Line-up : 5 Piece Band: Female Lead Vocals, Guitar, Keys, Bass and Drums
Supplier Fees to pay : £2068 Payable to the Supplier
`;

  const draft = parseBookingContract(contractText);

  assert.equal(draft.bookerName, "Nicki Hiscox / Beth Ford");
  assert.equal(draft.clientFirstNames, "Nicki");
  assert.equal(draft.clientLastName, "Hiscox");
});

import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument as PDFLibDocument } from "pdf-lib";
import { buildEventSheetPdfBuffer } from "../routes/bookingRoutes.js";

test("band event-sheet PDF appends uploaded venue PDFs", async () => {
  const attachment = await PDFLibDocument.create();
  attachment.addPage([300, 400]);
  const attachmentBytes = await attachment.save();
  const documentUrl = `data:application/pdf;base64,${Buffer.from(
    attachmentBytes,
  ).toString("base64")}`;

  const booking = {
    bookingId: "TEST-APPENDIX",
    clientName: "Test Client",
    eventDate: "2027-02-20",
    venueAddress: "Test Venue",
    eventSheet: {
      answers: {
        sound_limits_present: "Yes",
        sound_limits_doc_name: "Venue supplier agreement.pdf",
        sound_limits_doc_url: documentUrl,
        sound_limits_doc_type: "application/pdf",
        sound_limits_doc_purpose: "information",
      },
    },
  };

  const result = await buildEventSheetPdfBuffer(booking);
  const output = await PDFLibDocument.load(result);

  assert.ok(output.getPageCount() >= 3);
});

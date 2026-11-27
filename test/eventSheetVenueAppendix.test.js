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

test('band PDF includes links and PDF appendices for access, parking and room documents', async () => {
  const previousCloud = process.env.REACT_APP_CLOUDINARY_NAME;
  const previousFetch = global.fetch;
  process.env.REACT_APP_CLOUDINARY_NAME = 'attachment-test';
  const attachment = await PDFLibDocument.create();
  attachment.addPage([300, 400]);
  const bytes = await attachment.save();
  const url = name => `https://res.cloudinary.com/attachment-test/raw/upload/v123/event-sheets/docs/${name}.pdf`;
  const fetched = [];
  global.fetch = async value => { fetched.push(value); return new Response(bytes, {headers:{'Content-Type':'application/pdf'}}); };
  try {
    const booking = {bookingId:'TEST-SECTION-ATTACHMENTS',clientName:'Test Client',eventDate:'2027-06-18',eventSheet:{answers:{
      location_documents:[{name:'Access map.pdf',url:url('access')}],
      parking_documents:[{name:'Parking permit.pdf',url:url('parking')}],
      room_area_documents:[{name:'Room plan.pdf',url:url('room')}],
    }}};
    const result = await buildEventSheetPdfBuffer(booking);
    const output = await PDFLibDocument.load(result);
    assert.deepEqual(fetched,[url('access'),url('parking'),url('room')]);
    assert.ok(output.getPageCount() >= 7);
    const annotations = output.getPages().flatMap(page => page.node.Annots()?.asArray() || []);
    assert.ok(annotations.length >= 3, 'attachments have clickable links in the band PDF');
  } finally {
    global.fetch = previousFetch;
    if (previousCloud === undefined) delete process.env.REACT_APP_CLOUDINARY_NAME;
    else process.env.REACT_APP_CLOUDINARY_NAME = previousCloud;
  }
});

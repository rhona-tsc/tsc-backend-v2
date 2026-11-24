import test from 'node:test';
import assert from 'node:assert/strict';
import { musicianCancellationNotice, normaliseMusicianCancellationPolicy } from '../utils/musicianCancellationPolicy.js';
import { withConfirmedAllocation, buildEventSheetPdfBuffer } from '../routes/bookingRoutes.js';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { PDFDocument, PDFName } from 'pdf-lib';

test('new Wedissimo bookings disclose no early-cancellation return without exposing agency identity', () => {
  const notice = musicianCancellationNotice({ agent: 'Wedissimo', bookingRef: 'TEST / 123' });
  assert.equal(notice.paymentBasis, 'receipts_share');
  assert.match(notice.summary, /more than 30 days/);
  assert.match(notice.paymentText, /actually received/);
  assert.match(notice.paymentText, /no cancellation payment is guaranteed/);
  assert.doesNotMatch(JSON.stringify(notice), /wedissimo/i);
  assert.equal(notice.withdrawalUrl, 'https://admin.thesupremecollective.co.uk/bookings?booking=TEST%20%2F%20123');
  assert.match(notice.paymentText, /does not change any different terms/);
});
test('mongoose empty nested defaults do not override the new-booking receipts policy', () => {
  const notice = musicianCancellationNotice({ agent: 'Wedissimo', musicianCancellationPolicy: { summary: '', paymentBasis: 'existing_terms', version: '' } });
  assert.equal(notice.paymentBasis, 'receipts_share');
});
test('explicit booking terms override defaults and preserve previously agreed musician terms', () => {
  const notice = musicianCancellationNotice({ agent: 'Wedissimo', musicianCancellationPolicy: { summary: 'Agreed cancellation terms for this booking.', paymentBasis: 'existing_terms' } });
  assert.equal(notice.summary, 'Agreed cancellation terms for this booking.');
  assert.match(notice.paymentText, /existing agreed musician/);
  for (const agent of ['Encore', 'Poptop', 'Entertainment Nation', 'Direct', 'Other']) assert.equal(musicianCancellationNotice({ agent }), null);
});
test('cancellation policy input rejects invalid types, oversized notices and unknown payment bases', () => {
  for (const value of [null, [], 'receipts_share', {summary:'text',paymentBasis:'full_fee'}, {summary:'x'.repeat(4001), paymentBasis:'receipts_share'}]) assert.throws(() => normaliseMusicianCancellationPolicy(value));
});
test('band PDF projection uses the board cancellation notice rather than stale booking terms', async () => {
  const policy = {summary:'This booking has limited cancellation protection.',paymentBasis:'receipts_share'};
  const board = {bookingRef:'CANCELLATION-DEMO',agent:'Wedissimo',musicianCancellationPolicy:policy};
  const result = await withConfirmedAllocation({bookingId:'CANCELLATION-DEMO', musicianCancellationPolicy:{summary:'old',paymentBasis:'existing_terms'}}, {
    BoardModel:{findOne:()=>({lean:async()=>board})},
    ActModel:{findOne:()=>({select:()=>({lean:async()=>null})})},
  });
  assert.deepEqual(result.musicianCancellationPolicy, policy);
});
test('generated band PDF includes a working review link, policy notice and no agency name', async () => {
  const buffer = await buildEventSheetPdfBuffer({bookingId:'CANCELLATION-DEMO', agent:'Wedissimo',actName:'Example Band',eventDate:'2027-06-12',eventSheet:{submitted:true,answers:{venue_name:'Example Venue'}}});
  const parsed = await pdfParse(buffer);
  assert.match(parsed.text, /CANCELLATION TERMS FOR MUSICIANS/);
  assert.match(parsed.text.replace(/\s+/g, " "), /no cancellation payment is guaranteed/);
  assert.doesNotMatch(parsed.text, /wedissimo/i);
  const pdf = await PDFDocument.load(buffer);
  const links = pdf.getPages().flatMap(page => (page.node.Annots()?.asArray() || []).map(ref => pdf.context.lookup(ref).lookup(PDFName.of('A'))?.lookup(PDFName.of('URI'))?.decodeText?.() || ''));
  assert.ok(links.some(link => link.includes('https://admin.thesupremecollective.co.uk/bookings?booking=CANCELLATION-DEMO')));
  const fs = await import('node:fs/promises');
  await fs.writeFile('/Users/rhonadownie/Desktop/tsc2025/admin/tsc-admin-v2/output/cancellation-notice-demo.pdf', buffer);
});

test('only administrators can change cancellation notices, including dotted-field attempts', async () => {
  const [{default:express},{default:jwt},{default:router}] = await Promise.all([import('express'),import('jsonwebtoken'),import('../routes/bookingBoardRoutes.js')]);
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'cancellation-notice-offline-test';
  const app = express(); app.use(express.json()); app.use('/bookings',router);
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/bookings/699999999999999999999999`;
  try {
    const token = jwt.sign({id:'688888888888888888888888',role:'musician'},process.env.JWT_SECRET);
    for (const body of [{musicianCancellationPolicy:{summary:'wrong',paymentBasis:'receipts_share'}},{'musicianCancellationPolicy.summary':'wrong'}]) {
      const response = await fetch(endpoint,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
      assert.equal(response.status,403);
    }
    const adminToken = jwt.sign({id:'688888888888888888888888',role:'admin'},process.env.JWT_SECRET);
    const response = await fetch(endpoint,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${adminToken}`},body:JSON.stringify({musicianCancellationPolicy:{summary:'wrong',paymentBasis:'full_fee'}})});
    assert.equal(response.status,400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  }
});

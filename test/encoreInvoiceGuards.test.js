import test from 'node:test';
import assert from 'node:assert/strict';
process.env.STRIPE_SECRET_KEY_V2 = 'sk_test_render_only';
process.env.STRIPE_SECRET_KEY = 'sk_test_render_only';
const { createBoardInvoice, serveBoardInvoicePdf, getOrCreateBalanceLink } = await import('../controllers/invoicesController.js');
const { default: Board } = await import('../models/bookingBoardItem.js');
const { default: Booking } = await import('../models/bookingModel.js');
const response = () => ({statusCode:200,headers:{},status(code){this.statusCode=code;return this;},
  set(key,value){this.headers[key]=value;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}});
test('Encore original invoice generation and PDF access are rejected before financial side effects', async () => {
  const find = Board.findOne;
  Board.findOne = () => ({lean:async()=>({agent:'Encore',bookingRef:'EXAMPLE'})});
  try {
    for(const invoiceType of ['main','deposit']) {
      const res=response();
      await createBoardInvoice({body:{bookingId:'EXAMPLE',invoiceType}},res);
      assert.equal(res.statusCode,409);assert.match(res.body.message,/arranged through Encore/);
      const pdf=response();await serveBoardInvoicePdf({params:{id:'EXAMPLE'},query:{invoiceType}},pdf);
      assert.equal(pdf.statusCode,409);
    }
  } finally {Board.findOne=find;}
});
test('a stale Direct core record cannot open the original payment when the board says Encore', async () => {
  const coreFind=Booking.findOne, boardFind=Board.findOne;
  Booking.findOne=async()=>({agent:'Direct',bookingId:'EXAMPLE'});
  Board.findOne=()=>({lean:async()=>({agent:'Encore'})});
  try {const res=response();await getOrCreateBalanceLink({params:{idOrRef:'EXAMPLE'}},res);assert.equal(res.statusCode,409);}
  finally {Booking.findOne=coreFind;Board.findOne=boardFind;}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { extraPayments, extrasWithPaymentFraction, partialExtrasReceiptRow } from '../utils/extraInvoicePayments.js';
import BookingBoardItem from '../models/bookingBoardItem.js';
test('payments are capped to their own line and never credited against another extra',()=>{
 const extras=[{name:'Lunch',price:20,quantity:1,paidAmount:99,paidAt:'2026-11-18'},{name:'Mic',price:125,paidAmount:-5}];
 assert.deepEqual(extraPayments(extras),[{description:'Lunch',amount:20,paidAt:'2026-11-18'}]);
 assert.equal(extrasWithPaymentFraction(extras).length,1);
});
test('a partial line payment allocates the remaining supplier and management fees proportionally',()=>{
 const [row]=extrasWithPaymentFraction([{price:125,quantity:1,passThroughGross:50,managementGross:75,paidAmount:25}]);
 assert.equal(row.price,100);assert.equal(row.passThroughGross,40);assert.equal(row.managementGross,60);
});
test('a line payment and date survive schema validation without setting the whole invoice paid',()=>{
 const row=new BookingBoardItem({extras:[{name:'Lunch',price:20,paidAmount:20,paidAt:'2026-11-18'}]});
 assert.equal(row.validateSync(),undefined);assert.equal(row.extras[0].paidAmount,20);assert.equal(row.extras[0].paidAt.toISOString().slice(0,10),'2026-11-18');assert.notEqual(row.extrasPaid,true);
});
test('receipt rows require recorded payment and leave fully paid receipts intact',()=>{
 const row={extrasPaid:false};assert.equal(partialExtrasReceiptRow(row,[{price:100}]),null);
 const paid={extrasPaid:true};assert.equal(partialExtrasReceiptRow(paid,[{price:100}]),paid);
});

test('fractional fee allocations reconcile to the remaining penny',()=>{
 const [row]=extrasWithPaymentFraction([{price:0.02,passThroughGross:0.01,managementGross:0.01,paidAmount:0.01}]);
 assert.equal(row.price,0.01);assert.equal(row.passThroughGross+row.managementGross,0.01);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTOMATION_37_TAGS, automation37ExtrasState, prepareAutomation37Rule, renderAutomation37Conditions } from '../utils/automation37Extras.js';
const legacy = {
  sourceNumber: 37,
  subject: 'Automated Reminder: Event Sheet & Spotify Playlist(/s) Due Soon',
  body: "Hi {{client_first_name}},\n\nKeep this introduction and Event Sheet link.\n\nFinally, the 'extras' balance should also be settled by this date. The issued invoice is attached and includes the BACS details.\n\nIf you have already submitted your playlist link(s), completed the Event Sheet, and paid the balance, please disregard this email.\n\nKeep Rhona's calendar and signature.",
  attachInvoice: true,
};
const invoiceUrl = 'https://invoices.example.com/extras.pdf';
const withExtras = {extras:[{name:'Saxophone', price:640, quantity:1}], extrasInvoicePdfUrl:invoiceUrl};
const render = (row, changes={}) => {
  const rule=prepareAutomation37Rule({...legacy,...changes});
  return {subject:renderAutomation37Conditions(rule.subject,row,rule),body:renderAutomation37Conditions(rule.body,row,rule)};
};
test('no extras: only Event Sheet and playlist subject and completion sentence, even with main invoice',()=>{
  const result=render({invoicePdfUrl:'https://invoices.example.com/main.pdf'});
  assert.equal(result.subject,legacy.subject);
  assert.match(result.body,/playlist link\(s\), and completed the Event Sheet, please disregard this email\./);
  assert.doesNotMatch(result.body,/balance|invoice is attached|BACS|\{\{extras_/i);
  assert.match(result.body,/Keep this introduction and Event Sheet link/);
  assert.match(result.body,/Keep Rhona's calendar and signature/);
  assert.doesNotMatch(result.body,/\n\n\n/);
});
test('unpaid extras and issued PDF: extras subject, payment paragraph and paid-extras completion sentence',()=>{
  const result=render(withExtras);
  assert.equal(result.subject,'Automated Reminder: Event Sheet, Spotify Playlist(/s) & Extras Balance Due Soon');
  assert.match(result.body,/Finally, the 'extras' balance should also be settled by this date\. The issued invoice is attached and includes the BACS details\./);
  assert.match(result.body,/and paid the 'extras' balance, please disregard this email\./);
  assert.equal(automation37ExtrasState(withExtras,legacy).shouldAttachInvoice,true);
});
test('extras without an issued PDF: acknowledge balance without claiming an attachment',()=>{
  const row={extras:withExtras.extras,invoicePdfUrl:'https://invoices.example.com/main.pdf'};
  const result=render(row);
  assert.match(result.subject,/Extras Balance Due Soon/);
  assert.match(result.body,/paid the 'extras' balance/);
  assert.doesNotMatch(result.body,/Finally|invoice is attached|BACS/);
  assert.equal(automation37ExtrasState(row,legacy).shouldAttachInvoice,false);
});
test('all paid extras flags suppress the payment demand, subject and attachment',()=>{
  for(const paid of [{extrasPaid:true},{extrasStatus:'paid'},{payments:{extrasPaymentReceived:true}},{payments:{extrasInvoicePaid:true}}]){
    const row={...withExtras,...paid};
    assert.equal(render(row).subject,legacy.subject);
    assert.doesNotMatch(render(row).body,/balance|invoice is attached|BACS/i);
    assert.equal(automation37ExtrasState(row,legacy).shouldAttachInvoice,false);
  }
});
test('attachment toggle removes attachment wording but retains an outstanding extras balance',()=>{
  const result=render(withExtras,{attachInvoice:false});
  assert.match(result.subject,/Extras Balance/);
  assert.doesNotMatch(result.body,/invoice is attached|BACS|Finally/);
  assert.equal(automation37ExtrasState(withExtras,{attachInvoice:false}).shouldAttachInvoice,false);
});
test('invoice-only legacy records and nested PDF fields are recognised; main payment flags do not settle extras',()=>{
  const row={payments:{extrasInvoicePdfUrl:invoiceUrl,balancePaymentReceived:true,invoicePaid:true}};
  assert.equal(automation37ExtrasState(row,legacy).shouldAttachInvoice,true);
  assert.match(render(row).body,/paid the 'extras' balance/);
  assert.equal(automation37ExtrasState({extrasInvoiceUrl:invoiceUrl},legacy).shouldAttachInvoice,true);
});
test('free, zero quantity, or excluded extras without an invoice do not create a balance',()=>{
  for(const extra of [{price:0},{price:640,quantity:0},{price:640,includeOnExtrasInvoice:false}]){
    assert.equal(automation37ExtrasState({extras:[extra]},legacy).hasOutstandingExtras,false);
  }
  assert.equal(automation37ExtrasState({extrasAccounting:{extrasTotal:640}},legacy).hasOutstandingExtras,true);
});
test('migration is idempotent, preserves custom text and leaves other automations unchanged',()=>{
  const prepared=prepareAutomation37Rule(legacy);
  assert.equal(prepared.subject,AUTOMATION_37_TAGS.subject);
  assert.deepEqual(prepareAutomation37Rule(prepared),prepared);
  const custom=prepareAutomation37Rule({...legacy,subject:'Custom subject'});
  assert.equal(custom.subject,'Custom subject');
  const other={...legacy,sourceNumber:36};
  assert.deepEqual(prepareAutomation37Rule(other),other);
  assert.equal(renderAutomation37Conditions(other.body,{},other),other.body);
});
test('old imported balance paragraph and standalone invoice label become a single conditional passage',()=>{
  const rule=prepareAutomation37Rule({...legacy,body:'And finally, the balance should also be settled by this date.\n\nInvoice attached\n\nOther instructions.'});
  assert.equal(renderAutomation37Conditions(rule.body,{},rule),'\n\nOther instructions.');
  assert.equal(renderAutomation37Conditions(rule.body,withExtras,rule).match(/invoice is attached/g).length,1);
});


test('an extras card checkout link is not treated as an issued PDF',()=>{
  const row={extrasInvoiceUrl:'https://invoice.stripe.com/i/example'};
  assert.equal(automation37ExtrasState(row,legacy).shouldAttachInvoice,false);
  assert.equal(automation37ExtrasState(row,legacy).hasOutstandingExtras,false);
});

test('an unrelated custom final paragraph is retained',()=>{
  const rule=prepareAutomation37Rule({...legacy,body:legacy.body+"\n\nFinally, remember to tell the venue about parking."});
  assert.match(renderAutomation37Conditions(rule.body,{},rule),/Finally, remember to tell the venue about parking\./);
});

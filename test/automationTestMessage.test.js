import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAutomationTestMessage } from '../utils/automationTestMessage.js';
import { AUTOMATION_37_TAGS } from '../utils/automation37Extras.js';
const input={automationNumber:37,bookingId:'6aede53b5d6f7534fc5bde80',attachInvoice:true,subject:AUTOMATION_37_TAGS.subject,body:`Hello Sarah.\n\n${AUTOMATION_37_TAGS.payment}\n\n${AUTOMATION_37_TAGS.completion}`};
const extrasRow={agent:'Encore',extras:[{name:'Saxophone',price:640}],extrasInvoicePdfUrl:'https://invoices.example.com/extras.pdf'};
const setup=(row)=>{
 const calls=[];
 return {calls,deps:{
  loadBooking:async(id)=>{calls.push(['load',id]);return row;},
  buildMainAttachments:async()=>{calls.push(['main']);return [{filename:'main.pdf'}];},
  buildExtrasAttachments:async()=>{calls.push(['extras']);return [{filename:'extras.pdf'}];},
 }};
};
test('test email resolves Automation 37 against stored booking and attaches extras only for Encore',async()=>{
 const {deps,calls}=setup(extrasRow);
 const result=await prepareAutomationTestMessage(input,deps);
 assert.match(result.subject,/Extras Balance Due Soon/);
 assert.match(result.body,/invoice is attached/);
 assert.deepEqual(result.attachments,[{filename:'extras.pdf'}]);
 assert.deepEqual(calls,[['load',input.bookingId],['extras']]);
});
test('no extras or paid extras: never invokes either attachment builder or claims attachment',async()=>{
 for(const row of [{invoicePdfUrl:'https://invoices.example.com/main.pdf'},{...extrasRow,extrasPaid:true}]){
  const {deps,calls}=setup(row);const result=await prepareAutomationTestMessage(input,deps);
  assert.doesNotMatch(result.subject,/Balance/);
  assert.doesNotMatch(result.body,/balance|attached|BACS/);
  assert.deepEqual(result.attachments,[]);
  assert.deepEqual(calls,[['load',input.bookingId]]);
 }
});
test('extras without invoice and attachment disabled do not claim attachment',async()=>{
 for(const [row,request] of [[{extras:extrasRow.extras},input],[extrasRow,{...input,attachInvoice:false}]]){
  const {deps,calls}=setup(row);const result=await prepareAutomationTestMessage(request,deps);
  assert.match(result.subject,/Extras Balance/);
  assert.doesNotMatch(result.body,/attached|BACS/);
  assert.deepEqual(result.attachments,[]);
  assert.deepEqual(calls,[['load',input.bookingId]]);
 }
});
test('a missing or failed extras attachment prevents returning a message claiming attachment',async()=>{
 const {deps}=setup(extrasRow);
 await assert.rejects(prepareAutomationTestMessage(input,{...deps,buildExtrasAttachments:async()=>[]}),/could not be attached/);
 await assert.rejects(prepareAutomationTestMessage(input,{...deps,buildExtrasAttachments:async()=>{throw new Error('PDF unavailable');}}),/PDF unavailable/);
});
test('requires persisted booking for Automation 37 even when attachments are off',async()=>{
 const {deps}=setup(null);
 await assert.rejects(prepareAutomationTestMessage({...input,bookingId:'invalid',attachInvoice:false},deps),{statusCode:400});
 await assert.rejects(prepareAutomationTestMessage(input,deps),{statusCode:404});
});
test('other automation subjects, wording and main attachment behavior remain unchanged',async()=>{
 const {deps,calls}=setup({invoicePdfUrl:'https://invoices.example.com/main.pdf'});
 const request={...input,automationNumber:10,subject:'Balance due',body:'Pay main balance'};
 const result=await prepareAutomationTestMessage(request,deps);
 assert.deepEqual(result,{subject:request.subject,body:request.body,attachments:[{filename:'main.pdf'}]});
 assert.deepEqual(calls,[['load',input.bookingId],['main']]);
 const noInvoice=await prepareAutomationTestMessage({...request,attachInvoice:false},{});
 assert.deepEqual(noInvoice,{subject:request.subject,body:request.body,attachments:[]});
});

test('Automation 38 resolves Due Today wording from the stored booking and uses only the extras PDF',async()=>{
 const request={...input,automationNumber:38};
 for(const row of [extrasRow,{...extrasRow,extrasPaid:true},{invoicePdfUrl:'https://invoices.example.com/main.pdf'},{extras:extrasRow.extras}]){
  const {deps,calls}=setup(row);const result=await prepareAutomationTestMessage(request,deps);
  assert.match(result.subject,/Due Today$/);assert.doesNotMatch(result.body,/\{\{|Due Soon/);
  assert.ok(calls.every(call=>call[0]!=='main'));
  if(row===extrasRow){
   assert.match(result.body,/balance should also be settled today/);
   assert.deepEqual(result.attachments,[{filename:'extras.pdf'}]);
  }else{
   assert.doesNotMatch(result.body,/invoice is attached/);assert.deepEqual(result.attachments,[]);
  }
 }
});

test('Automation 38 will not send wording claiming attachment when its extras PDF cannot be attached',async()=>{
 const {deps}=setup(extrasRow);
 await assert.rejects(prepareAutomationTestMessage({...input,automationNumber:38},{...deps,buildExtrasAttachments:async()=>[]}),/could not be attached/);
});

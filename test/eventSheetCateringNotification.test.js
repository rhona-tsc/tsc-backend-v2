import test from 'node:test';import assert from 'node:assert/strict';
import {notificationBookingQuery,createCateringHandlers,buildCateringMail,cateringDisplayName} from '../services/eventSheetCateringNotification.js';
const booking={_id:'6ae9feae012132a6f274f0f5',bookingId:'BBM 499 BREWERS',eventDateISO:'2026-12-31',clientName:'Megan',venueAddress:'Tewinbury Farm Hotel'};
const roster=[{name:'Rebecca Waite',instrument:'Trumpet',email:'rebecca@example.test',dietaryRequirements:'Mild allergy to apples and hazelnuts (reported as not serious).'},{name:'Josh Draper',instrument:'Guitar',email:'josh@example.test',dietaryRequirements:'No mushrooms.'}];
const response=()=>({code:200,status(code){this.code=code;return this;},json(data){this.data=data;return this;}});
test('a booking reference is never cast as a Mongo ID',()=>{
 assert.deepEqual(notificationBookingQuery('BBM 499 BREWERS'),{bookingId:'BBM 499 BREWERS'});
 assert.deepEqual(notificationBookingQuery('260115241436'),{bookingId:'260115241436'});
 assert.equal(notificationBookingQuery(booking._id).$or[1]._id,booking._id);
});
test('caterer send uses the object email API, current roster, service notes and branded footer',async()=>{
 let sent,query;
 const h=createCateringHandlers({findBooking:async q=>{query=q;return booking;},loadRoster:async()=>roster,mailer:async mail=>{sent=mail;return{ok:true,messageId:'test',accepted:['marry@tewinbury.co.uk']};}});
 const res=response();await h.sendDietaryToCaterer({body:{bookingId:'260115241436',catererEmail:'marry@tewinbury.co.uk',notes:'Pizzas',dietarySummary:[{name:'Stale',diet:'None'}]}},res);
 assert.equal(res.code,200);assert.equal(res.data.success,true);assert.equal(sent.to,'marry@tewinbury.co.uk');assert.equal(sent.cc,'hello@thesupremecollective.co.uk');
 assert.match(sent.html,/No mushrooms/);assert.match(sent.html,/apples and hazelnuts/);assert.doesNotMatch(sent.html,/Stale/);assert.match(sent.text,/Pizzas/);assert.match(sent.text,/keep plates aside/);assert.match(sent.subject,/31 December 2026/);assert.match(sent.html,/TSC_Signature/);
 for (const body of [sent.html,sent.text]) {
  assert.match(body,/Rebecca W\./);assert.match(body,/Josh D\./);
  assert.doesNotMatch(body,/Waite|Draper/);assert.match(body,/prefer to eat before performing/);
 }
});
test('catering display names keep only the surname initial',()=>{
 assert.equal(cateringDisplayName('  David Asafu-Adjaye  '),'David A.');
 assert.equal(cateringDisplayName('Rebecca W.'),'Rebecca W.');
 assert.equal(cateringDisplayName('Rya'),'Rya');
});
test('invalid addresses, missing bookings and empty rosters never send mail',async()=>{
 let calls=0;const h=createCateringHandlers({findBooking:async()=>null,loadRoster:async()=>[],mailer:async()=>{calls++;}});
 let res=response();await h.sendDietaryToCaterer({body:{bookingId:'ref',catererEmail:'x@y.com\nBcc:bad@example.com'}},res);assert.equal(res.code,400);
 res=response();await h.sendDietaryToCaterer({body:{bookingId:'ref',catererEmail:'test@example.com'}},res);assert.equal(res.code,404);assert.equal(calls,0);
});
test('SMTP failures and office-only acceptance cannot report success to the client',async()=>{
 for(const result of [{ok:false,error:'provider error'},{ok:true,accepted:['hello@thesupremecollective.co.uk']}]){
  const h=createCateringHandlers({findBooking:async()=>booking,loadRoster:async()=>roster,mailer:async()=>result});const res=response();await h.sendDietaryToCaterer({body:{bookingId:'ref',catererEmail:'test@example.com'}},res);assert.equal(res.code,502);assert.equal(res.data.success,false);
 }
});
test('menu sends only to the confirmed roster and includes uploaded menu links',async()=>{
 let mail;const h=createCateringHandlers({findBooking:async()=>booking,loadRoster:async()=>roster,mailer:async value=>{mail=value;return{ok:true};}});const res=response();await h.sendMenuToBand({body:{bookingId:'ref',menu:{fileUrl:'https://example.com/menu.pdf',text:'Pizza & salad'}}},res);assert.deepEqual(mail.to,roster.map(m=>m.email));assert.match(mail.html,/Open uploaded menu/);assert.match(mail.html,/Pizza &amp; salad/);assert.equal(res.data.success,true);
});
test('client notes cannot insert email markup or script links',()=>{
 const m=buildCateringMail({booking,roster,to:'test@example.com',notes:'<img src=x onerror=alert(1)>',menu:{url:'javascript:alert(1)'}});
 assert.match(m.html,/&lt;img/);assert.doesNotMatch(m.html,/href="javascript:/);
});

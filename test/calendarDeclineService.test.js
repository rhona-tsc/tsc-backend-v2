import test from 'node:test';import assert from 'node:assert/strict';
import {createCalendarDeclineService,calendarDeclineButton,activeCalendarAssignments,CALENDAR_DECLINE_DELAY_MS}from'../services/calendarDeclineService.js';
const person='111111111111111111111111',boardId='222222222222222222222222';
const val=(obj,path)=>path.split('.').reduce((o,k)=>o?.[k],obj);
const eq=(a,b)=>String(a)===String(b);
function matches(row,q){return Object.entries(q).every(([k,v])=>k==='$or'?v.some(p=>matches(row,p)):v&&typeof v==='object'&&!(v instanceof Date)&&!v._bsontype?Object.entries(v).every(([op,x])=>op==='$in'?x.some(n=>eq(n,val(row,k))):op==='$lte'?val(row,k)<=x:op==='$exists'?((val(row,k)!==undefined)===x):false):eq(val(row,k),v));}
function fixture(){
 let clock=new Date('2026-11-26T12:00:00Z'),sent=[],withdrawals=[],patches=[];
 const assignment={musicianId:person,firstName:'Paolo',name:'Paolo Example',email:'player@example.test',phone:'+447000000001',role:'Electric Guitar',roleSlotId:'guitar-1',fee:282,status:'confirmed'};
 const board={_id:boardId,bookingRef:'GIG',eventDateISO:'2026-12-10',actTscName:'Example Act',address:'Example venue',assignedMusicians:[assignment],bookingMusicians:[assignment]};
 const event={id:'event',status:'confirmed',description:'Booking Reference: GIG',attendees:[{email:assignment.email,responseStatus:'declined'}]};
 const rows={bookingboarditems:[board],musicians:[{_id:person,firstName:'Paolo',email:assignment.email,phone:assignment.phone}],availabilities:[],calendardeclineconfirmations:[],bookings:[]};
 const apply=(doc,u,insert)=>{if(insert)Object.assign(doc,u.$setOnInsert);Object.assign(doc,u.$set);for(const k of Object.keys(u.$unset||{}))delete doc[k];for(const[k,v]of Object.entries(u.$addToSet||{})){doc[k]||=[];if(!doc[k].some(x=>JSON.stringify(x)===JSON.stringify(v)))doc[k].push(v);}return doc;};
 const db={collection(name){const records=rows[name]||=[];return{findOne:async q=>records.find(row=>matches(row,q))||null,find:q=>({toArray:async()=>records.filter(row=>matches(row,q))}),updateOne:async(q,u,opt={})=>{let doc=records.find(row=>matches(row,q));let insert=false;if(!doc&&opt.upsert){doc={_id:q._id};records.push(doc);insert=true;}if(doc)apply(doc,u,insert);},findOneAndUpdate:async(q,u)=>{const doc=records.find(row=>matches(row,q));return doc?apply(doc,u,false):null;}};}};
 const service=createCalendarDeclineService({db,calendar:{events:{get:async()=>({data:event}),patch:async p=>{patches.push(p);event.attendees=p.requestBody.attendees;}}},send:async p=>{sent.push(p);return{sid:'SM-confirmation'};},withdraw:async p=>{withdrawals.push(p);assignment.status='withdrawn';assignment.withdrawnAt=clock;},template:async()=> 'HX-approved',now:()=>clock});
 return{service,rows,board,event,assignment,sent,withdrawals,patches,advance:ms=>clock=new Date(+clock+ms),job:()=>rows.calendardeclineconfirmations[0]};
}
test('one pending confirmation per musician/role across duplicate invites; wait a full ten minutes',async()=>{
 const f=fixture();await f.service.reconcile(f.event,'primary');const first=f.job().notBefore;f.advance(60000);await f.service.reconcile({...f.event,id:'mirror'},'TSC Gigs');assert.equal(f.rows.calendardeclineconfirmations.length,1);assert.equal(+f.job().notBefore,+first);assert.equal(f.job().observations.length,2);
 assert.equal(await f.service.dispatch(f.job()),'waiting');assert.equal(f.sent.length,0);f.advance(CALENDAR_DECLINE_DELAY_MS);assert.equal(await f.service.dispatch(f.job()),'sent');assert.equal(f.sent.length,1);assert.equal(f.sent[0].variables['5'],'282');assert.equal(f.sent[0].variables['2'],'Example Act');await f.service.dispatch(f.job());assert.equal(f.sent.length,1);
});
test('website withdrawal during the grace period suppresses WhatsApp and follows withdrawal routing',async()=>{
 const f=fixture();await f.service.reconcile(f.event,'primary');f.rows.availabilities.push({bookingId:'GIG',musicianId:person,dateISO:'2026-12-10',reply:'unavailable',inbound:{sid:'WEB-1',source:'website-quick-reply'}});f.advance(CALENDAR_DECLINE_DELAY_MS);assert.equal(await f.service.dispatch(f.job()),'handled');assert.equal(f.sent.length,0);assert.equal(f.withdrawals.length,1);
});
test('an existing explicit system decline is handled without creating a calendar follow-up',async()=>{
 const f=fixture();f.rows.availabilities.push({bookingId:'GIG',musicianId:person,dateISO:'2026-12-10',reply:'unavailable',replyHistory:[{reply:'unavailable',source:'musician_portal'}]});await f.service.reconcile(f.event,'primary');assert.equal(f.job().state,'handled');assert.equal(f.withdrawals.length,1);assert.equal(f.sent.length,0);
});
test('retracted calendar decline and inactive or cancelled allocations never trigger follow-up',async()=>{
 const f=fixture();await f.service.reconcile(f.event,'primary');f.advance(CALENDAR_DECLINE_DELAY_MS);f.event.attendees[0].responseStatus='accepted';assert.equal(await f.service.dispatch(f.job()),'cancelled');assert.equal(f.sent.length,0);
 const g=fixture();await g.service.reconcile(g.event,'primary');g.assignment.status='withdrawn';g.assignment.withdrawnAt=new Date();g.advance(CALENDAR_DECLINE_DELAY_MS);assert.equal(await g.service.dispatch(g.job()),'handled');assert.equal(g.sent.length,0);
 const h=fixture();await h.service.reconcile({...h.event,status:'cancelled'},'primary');assert.equal(h.job(),undefined);
});
test('quick replies bind to the exact job and sender; location decline is not date-wide unavailable',async()=>{
 for(const[button,reply]of[['NO','unavailable'],['LOC','no'],['YES','yes']]){
  const f=fixture();await f.service.reconcile(f.event,'primary');f.advance(CALENDAR_DECLINE_DELAY_MS);await f.service.dispatch(f.job());
  const payload='CAL_'+button+':'+f.job()._id;
  await f.service.respond({payload,from:'+447999999999',sid:'wrong-sender'});assert.equal(f.job().state,'sent');
  await f.service.respond({payload,from:'whatsapp:'+f.assignment.phone,sid:'SM-reply'});assert.equal(f.job().state,'handled');assert.equal(f.job().reply,reply);
  if(reply==='yes'){assert.equal(f.withdrawals.length,0);assert.equal(f.patches.length,1);assert.equal(f.patches[0].requestBody.attendees[0].responseStatus,'accepted');}else assert.equal(f.withdrawals[0].reply,reply);
  await f.service.respond({payload,from:f.assignment.phone,sid:'duplicate'});assert.equal(f.withdrawals.length,reply==='yes'?0:1);
 }
});
test('a late available click cannot reinstate a musician already withdrawn on the website',async()=>{
 const f=fixture();await f.service.reconcile(f.event,'primary');f.advance(CALENDAR_DECLINE_DELAY_MS);await f.service.dispatch(f.job());f.assignment.status='withdrawn';await f.service.respond({payload:'CAL_YES:'+f.job()._id,from:f.assignment.phone});assert.equal(f.patches.length,0);assert.equal(f.withdrawals.length,0);
});
test('button parsing and active allocation deduplication do not guess identities',()=>{
 assert.deepEqual(calendarDeclineButton('CAL_LOC:'+person),{id:person,reply:'no'});assert.equal(calendarDeclineButton('unavailable'),null);assert.equal(activeCalendarAssignments(null).length,0);
 const f=fixture();assert.equal(activeCalendarAssignments(f.board).length,1);
});
test('legacy calendar matching requires a whole client name, postcode and one unique same-day booking',async()=>{
 const f=fixture();f.event.description='EVENT SHEET: To follow';f.event.start={dateTime:'2026-12-10T17:00:00Z'};f.event.location='Venue, RH5 6HS';f.board.address='Venue, RH5 6HS';f.board.clientFirstNames='Ann';f.event.summary="Joanne's Wedding";
 assert.equal(await f.service.boardFor(f.event),null);
 f.event.summary="Ann's Wedding";assert.equal(await f.service.boardFor(f.event),f.board);
 f.rows.bookingboarditems.push({...f.board,_id:'333333333333333333333333'});assert.equal(await f.service.boardFor(f.event),null);
});

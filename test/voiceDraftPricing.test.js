import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVoiceDraft, createEnquiryToolHandler } from '../services/incomingEnquiryAssistant.js';
import { saveVoiceDraft } from '../services/voiceEnquiryStore.js';
import { lookupVoiceLineupPrice } from '../services/voiceLineupPricing.js';
import { lookupVoiceVenueHistory } from '../services/voiceVenueHistory.js';
import { buildEnquiryVoiceSession } from '../services/voiceEnquiryConnection.js';
import { automatedEnquiryEligible } from '../utils/enquiryAutomationEligibility.js';

const venue={venueId:'venue1',name:'Test Venue',address:'Test Venue Cambridge CB2 1TN',county:'Cambridgeshire',postcode:'CB2 1TN',postcodeValidated:true};
const actId='a'.repeat(24), lineupId='lineup1';
const band={actId,name:'Test Band',lineups:[{lineupId,size:2}]};
const call={callId:'test_call'};

test('partial drafts keep supplied contact/preferences without accepting confirmation, qualification, price or selected IDs',()=>{
  const draft=normalizeVoiceDraft({clientName:'Mary',clientPhone:'07700 900123',clientEmail:'MARY@example.invalid',styles:['Funk'],preferredSize:'6 or 7',confirmed:true,qualified:true,selectedBands:[{actId}],priceGBP:1});
  assert.equal(draft.clientPhone,'+447700900123');assert.equal(draft.clientEmail,'mary@example.invalid');assert.equal(draft.confirmed,undefined);assert.equal(draft.selectedBands,undefined);assert.equal(draft.priceGBP,undefined);
});

test('draft persistence uses one call identity, labels every detail unconfirmed and cannot overwrite a confirmed enquiry',async()=>{
  let update,filter;
  const Model={findOneAndUpdate:async(f,u)=>{filter=f;update=u;return u.$set;}};
  await saveVoiceDraft('call1',{clientName:'Mary',clientPhone:'+447700900123'},{Model});
  assert.equal(filter.websiteKey,'phone:call1');assert.deepEqual(filter.captureState,{$ne:'confirmed'});assert.equal(update.$set.captureState,'draft');assert.equal(update.$set.contactConfirmed,false);assert.match(update.$set.notes,/UNCONFIRMED DRAFT/);assert.equal(update.$setOnInsert.status,'open');
  const confirmed={captureState:'confirmed'};
  const protectedModel={findOneAndUpdate:async()=>{throw Object.assign(new Error(),{code:11000});},findOne:async()=>confirmed};
  assert.equal(await saveVoiceDraft('call1',{}, {Model:protectedModel}),confirmed);
});

test('live pilot collects an early contact or explicit refusal before searching, and failed final validation still leaves a draft',async()=>{
  const drafts=[];let lookups=0;
  const handler=createEnquiryToolHandler({enforceBookingFlow:true,saveDraft:async(id,draft)=>drafts.push(draft),lookupBands:async()=>{lookups++;return {bands:[]};},saveBoardRecord:async()=>{throw Error('should not confirm');}});
  await assert.rejects(handler({...call,name:'lookup_bands',arguments:{styles:['Funk']}}),/name and preferred/);
  await handler({...call,name:'save_enquiry_draft',arguments:{clientName:'Mary',clientPhone:'07700900123'}});
  await handler({...call,name:'lookup_bands',arguments:{styles:['Funk']}});assert.equal(lookups,1);
  await assert.rejects(handler({...call,name:'lookup_bands',arguments:{styles:['Funk'],mustHaveInstruments:['Brass section']}}),/one saxophone or at least two/);
  await assert.rejects(handler({...call,name:'save_enquiry',arguments:{clientName:'Mary',clientPhone:'07700900123',requirements:'Funk wedding',confirmed:false}}),/confirmation/);
  assert.equal(drafts.at(-1).requirements,'Funk wedding');assert.equal(drafts.at(-1).clientPhone,'+447700900123');
});

test('price and history require same-call venue/lineup provenance and pricing saves only safe returned estimates',async()=>{
  const prices=[];let historyReads=0;
  const handler=createEnquiryToolHandler({lookupBands:async()=>({bands:[band]}),lookupVenues:async()=>({venues:[venue]}),lookupPrice:async()=>({priceAvailable:true,priceGBP:500}),savePriceEstimates:async(id,quotes)=>prices.push(quotes),lookupVenueHistory:async()=>{historyReads++;return {historyFound:true};}});
  const input={actId,lineupId,venueId:'venue1',venueConfirmed:true,eventDateISO:'2027-01-01'};
  await assert.rejects(handler({...call,name:'lookup_lineup_price',arguments:input}),/First look up/);
  await handler({...call,name:'lookup_bands',arguments:{query:'Test Band'}});await handler({...call,name:'lookup_venue',arguments:{query:'Test Venue'}});
  assert.equal((await handler({...call,name:'lookup_lineup_price',arguments:input})).priceGBP,500);assert.equal(prices[0].length,1);
  await handler({...call,name:'lookup_venue_history',arguments:{venueId:'venue1',venueConfirmed:true}});assert.equal(historyReads,1);
  await assert.rejects(handler({callId:'another_call',name:'lookup_lineup_price',arguments:input}),/First look up/);
});

const act=()=>({_id:actId,tscName:'Test Band',status:'approved',useCountyTravelFee:true,countyFees:{Cambridgeshire:20},lineups:[{lineupId,actSize:'2-piece',bandMembers:[
  {instrument:'Guitar',isEssential:true,fee:100,postCode:'SW1A 1AA',countyTravelFees:{Cambridgeshire:5},additionalRoles:[{role:'Sound Engineering',isEssential:true,additionalFee:30}]},
  {instrument:'Vocals',isEssential:true,fee:150,postCode:'E1 6AN'},
  {instrument:'',isEssential:true,fee:null,additionalRoles:[{role:'Band Manager',isEssential:true,additionalFee:40}]},
]}]});
const priceInput={actId,lineupId,eventDateISO:'2027-01-01',venue};

test('website price includes exact lineup, manager role fee and per-member county overrides, without leaking private inputs',async()=>{
  const result=await lookupVoiceLineupPrice(priceInput,{loadAct:async()=>act(),travel:async()=>{throw Error('county needs no route');}});
  assert.equal(result.priceGBP,460);assert.equal(result.travelIncluded,true);assert.equal(result.performerCount,2);assert.equal(result.bookingConfirmed,false);
  assert.doesNotMatch(JSON.stringify(result),/SW1A|E1 6AN|additionalFee|margin|Sound Engineering|countyTravelFees/);
});

test('website mileage and MU calculations use checked routes and missing routes never become a travel-inclusive base quote',async()=>{
  const a=act();a.useCountyTravelFee=false;a.costPerMile=.02;
  const travel=async()=>({miles:10,outbound:{distance:{value:16093.4},duration:{value:1800}},returnTrip:{distance:{value:16093.4},duration:{value:1800}}});
  assert.equal((await lookupVoiceLineupPrice(priceInput,{loadAct:async()=>a,travel})).priceGBP,440);
  a.costPerMile=0;
  assert.equal((await lookupVoiceLineupPrice(priceInput,{loadAct:async()=>a,travel})).priceGBP,492);
  const failed=await lookupVoiceLineupPrice(priceInput,{loadAct:async()=>a,travel:async()=>{throw Error('route');}});assert.equal(failed.priceAvailable,false);assert.equal(failed.priceGBP,undefined);
  delete a.lineups[0].bandMembers[0].postCode;
  assert.equal((await lookupVoiceLineupPrice(priceInput,{loadAct:async()=>a,travel})).priceAvailable,false);
});

test('history counts past events once, excludes future/cancelled records and exposes only month and aggregate count',async()=>{
  const rows=[{name:'Test Venue',visits:[
    {bookingId:'past1',eventDate:'2026-06-01',clientName:'Private client'},
    {bookingId:'duplicate-import',eventDate:'2026-06-01'},
    {bookingId:'cancelled1',eventDate:'2026-08-01'},
    {bookingId:'future1',eventDate:'2027-01-01'},
  ]}];
  const result=await lookupVoiceVenueHistory(venue,{now:new Date('2026-11-11'),loadVenues:async()=>rows,loadBookings:async()=>[{bookingId:'cancelled1',status:'cancelled'}]});
  assert.equal(result.pastGigCount,1);assert.equal(result.latestGigMonth,'June 2026');assert.doesNotMatch(JSON.stringify(result),/Private client|past1|cancelled1|2026-06-01/);
  assert.equal((await lookupVoiceVenueHistory(venue,{loadVenues:async()=>[]})).historyFound,false);
});

test('phone audio has no transcription hint, filters close-mic noise and does not cut speech on every detected sound',()=>{
  const config=buildEnquiryVoiceSession({model:'test'});
  assert.equal(config.audio.input.transcription.prompt,undefined);assert.equal(config.audio.input.noise_reduction.type,'near_field');assert.equal(config.audio.input.turn_detection.interrupt_response,false);assert.ok(config.audio.input.turn_detection.threshold>.5);assert.match(config.instructions,/British accent/);
});

test('drafts and pilot phone records stay outside automated client follow-up',()=>{
  const row={actName:'Test Band',dateISO:'2027-01-01',createdAt:new Date(),captureState:'draft'};
  assert.equal(automatedEnquiryEligible(row),false);assert.equal(automatedEnquiryEligible({...row,captureState:'confirmed',marketingSource:'Phone — AI pilot test'}),false);
});

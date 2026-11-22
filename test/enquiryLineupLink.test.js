import test from 'node:test';import assert from 'node:assert/strict';
import Act from '../models/actModel.js';import Availability from '../models/availabilityModel.js';import Board from '../models/enquiryBoardItem.js';
import {enquiryLineupLink} from '../controllers/enquiryLineupLinkController.js';
const actId='685be0c79e9d4b0d2b69bd65',lineupId='6af822aca37f052ca044911b';
const query=value=>({select(){return this;},limit(){return this;},lean:async()=>value});
const input={actId,lineupId,date:'2028-06-17',address:'Jordans, Beaconsfield HP9 2SU'};
async function run(t,{rows=[{enquiryId:'t8xZ6',formattedAddress:input.address}],agent='Encore',visibility='enquiry',args=input,fail=false}={}){
 t.mock.method(Act,'findById',()=>{if(fail)throw new Error('offline');return query({_id:actId,tscName:'Motown Luxe',lineups:[{_id:lineupId,websiteVisibility:visibility,bandMembers:[{instrument:'Lead Vocal'},{instrument:'Keyboard'}]}]});});
 t.mock.method(Availability,'find',filter=>{assert.equal(filter.dateISO,input.date);assert.equal(filter.lineupId,lineupId);return query(rows);});
 t.mock.method(Board,'findOne',()=>query(agent?{agent}:null));
 const result={status:200};const res={set(){},status(code){result.status=code;return this;},json(body){result.body=body;return this;}};
 await enquiryLineupLink({query:args},res);return result;
}
test('an existing bespoke cart link goes to its exact Encore quote, not a new website price',async t=>{const r=await run(t);assert.equal(r.body.url,'https://encoremusicians.com/jobs/t8xZ6');assert.equal(r.body.bespoke,true);assert.equal(r.status,200);});
test('standard cart links stay on their existing booking path',async t=>{const r=await run(t,{visibility:'public'});assert.deepEqual(r.body,{success:true,bespoke:false});});
test('different location cannot reuse a bespoke enquiry link',async t=>{const r=await run(t,{rows:[{enquiryId:'t8xZ6',formattedAddress:'London'}]});assert.equal(r.status,409);assert.equal(r.body.url,undefined);});
test('two different enquiries at the same location require clarification',async t=>{const r=await run(t,{rows:[{enquiryId:'t8xZ6',formattedAddress:input.address},{enquiryId:'OTHER',formattedAddress:input.address}]});assert.equal(r.status,409);});
test('missing board context cannot turn an availability row into a booking',async t=>{const r=await run(t,{agent:null});assert.equal(r.status,409);});
test('incomplete and tampered cart links fail before reading data',async t=>{const r=await run(t,{args:{...input,lineupId:'../../other'}});assert.equal(r.status,400);});
test('unavailable data cannot silently select another lineup',async t=>{const r=await run(t,{fail:true});assert.equal(r.status,503);assert.equal(r.body.url,undefined);});

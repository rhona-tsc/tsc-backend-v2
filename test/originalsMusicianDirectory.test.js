import test from 'node:test';
import assert from 'node:assert/strict';
import Musician from '../models/musicianModel.js';
import Project from '../models/originalProjectModel.js';
import { browseOriginalMusicians, originalInstrumentFilter } from '../services/originalsMusicianDirectoryService.js';
import { searchOriginalReferralMusicians } from '../controllers/originalsReferralController.js';
import { searchOriginalMusicians } from '../controllers/originalsWorkflowController.js';
const id='111111111111111111111111';
const response=()=>({code:200,status(code){this.code=code;return this;},json(data){this.body=data;return this;}});
function directory(t, records=[]) {
  const calls=[];
  t.mock.method(Musician,'find',query=>{
    const call={query};calls.push(call);
    const chain={select(value){call.select=value;return this;},sort(value){call.sort=value;return this;},skip(value){call.skip=value;return this;},limit(value){call.limit=value;return this;},async lean(){return records.slice(call.skip,call.skip+call.limit);}};
    return chain;
  });
  return calls;
}
test('an empty name browses a whole instrument, using stored profile genres and all instrument fields',async t=>{
  const calls=directory(t,[{_id:id,firstName:'Shamyra',lastName:'Anderson',musicianSlug:'shamyra-a-vocal',instrumentation:[{instrument:'Keys'}],vocals:{type:['Lead Vocalist'],genres:['Soul & Motown']},email:'private@example.test',phone:'private',basicInfo:{email:'private@example.test'},address:{postcode:'private'}}]);
  const result=await browseOriginalMusicians({instrument:'Vocal',genre:'Soul & Motown'});
  assert.equal(calls.length,1);assert.equal(calls[0].query.$and.length,2);
  const roles=calls[0].query.$and[0].$or;assert.deepEqual(roles.slice(0,3).map(item=>Object.keys(item)[0]),['instrument','instruments','instrumentation.instrument']);
  assert.ok(roles[3]['vocals.type'].$in.some(pattern=>pattern.test('Lead Vocalist')));assert.ok(!roles[3]['vocals.type'].$in.some(pattern=>pattern.test("I don't sing")));
  const genres=calls[0].query.$and[1].$or;assert.equal(genres[0]['vocals.genres'].test('Soul & Motown'),true);assert.equal(genres[0]['vocals.genres'].test('Soul & Motown Tribute'),false);
  assert.deepEqual(result.musicians,[{_id:id,displayName:'Shamyra A.',instruments:['Keys','Lead Vocalist'],genres:['Soul & Motown'],profilePath:'/musician/shamyra-a-vocal'}]);
  assert.doesNotMatch(JSON.stringify(result),/private@example|postcode|phone|Anderson/);
});
test('guitar browsing does not mistake bass guitar for guitar, and bass does not search vocal range',()=>{
 const guitar=originalInstrumentFilter('Guitar').$or[0].instrument;
 assert.equal(guitar.test('Electric Guitar'),true);assert.equal(guitar.test('Bass Guitar'),false);
 const bass=originalInstrumentFilter('Bass');assert.equal(bass.$or[0].instrument.test('Double Bass'),true);assert.ok(!JSON.stringify(bass).includes('range'));
 const keys=originalInstrumentFilter('Keys').$or[2]['instrumentation.instrument'];assert.equal(keys.test('Piano'),true);assert.equal(keys.test('Keyboard'),true);
 const piano=originalInstrumentFilter('Piano').$or[0].instrument;assert.equal(piano.test('Piano'),true);assert.equal(piano.test('Organ'),false);
});
test('name, custom instrument and genre input are treated literally, and email search is owner-only',async t=>{
 const calls=directory(t);
 await browseOriginalMusicians({q:'.*',instrument:'[Custom]',genre:'RnB, HipHop & Garage'});
 const name=calls[0].query.$and[0].$or;assert.equal(name[0].firstName.test('Anyone'),false);assert.equal(name[0].firstName.test('Literal .*'),true);assert.equal(name.some(item=>'email'in item),false);
 assert.equal(calls[0].query.$and[1].$or[0].instrument.test('C'),false);
 await browseOriginalMusicians({q:'sam@example.test'},{allowEmail:true});assert.ok(calls[1].query.$and[0].$or.some(item=>item.email instanceof RegExp));
});
test('pagination makes matches beyond the old first 15 or 20 reachable without changing sort order',async t=>{
 const rows=Array.from({length:31},(_,index)=>({_id:String(index),firstName:`Musician ${index}`,lastName:'Example'}));const calls=directory(t,rows);
 const first=await browseOriginalMusicians({});assert.equal(first.musicians.length,25);assert.equal(first.pagination.hasMore,true);assert.equal(first.pagination.hasPrevious,false);
 const second=await browseOriginalMusicians({page:'2'});assert.equal(second.musicians.length,6);assert.equal(second.musicians[0]._id,'25');assert.equal(second.pagination.hasMore,false);assert.equal(second.pagination.hasPrevious,true);
 assert.deepEqual(calls[0].sort,calls[1].sort);assert.deepEqual(calls[0].sort,{firstName:1,lastName:1,_id:1});assert.equal(calls[1].skip,25);
});
test('filter options include actual profile tags, custom instruments and the standard vocal group',async t=>{
 directory(t);const fields=[];t.mock.method(Musician,'distinct',async field=>{fields.push(field);return({'instrumentation.instrument':['Cello','Keys'],'vocals.type':['Lead Vocalist',"I don't sing"],'vocals.genres':['Jazz & Swing','Neo Soul'],'genres':['Neo Soul','Classical']})[field]||[];});
 const result=await browseOriginalMusicians({includeFilters:'true'});assert.equal(fields.length,6);assert.ok(result.filters.instruments.includes('Cello'));assert.ok(result.filters.instruments.includes('Vocal'));assert.ok(!result.filters.instruments.includes("I don't sing"));assert.deepEqual(result.filters.genres,['Classical','Jazz & Swing','Neo Soul']);
});
test('invalid filters and unbounded pages are refused before accessing the database',async t=>{
 const calls=directory(t);
 for(const params of [{q:{$ne:''}},{instrument:['Bass']},{genre:'x'.repeat(101)},{page:'0'},{page:'-1'},{page:'10001'},{page:'two'}]) await assert.rejects(browseOriginalMusicians(params),{status:400});
 assert.equal(calls.length,0);
});
test('both controller entry points use the same browsable results, with owner access still enforced',async t=>{
 const calls=directory(t,[{_id:id,firstName:'Sam',lastName:'Smith'}]);
 const participant=response();await searchOriginalReferralMusicians({query:{instrument:'Keys'}},participant);assert.equal(participant.code,200);assert.equal(participant.body.musicians[0].displayName,'Sam S.');
 t.mock.method(Project,'findById',()=>({lean:async()=>({_id:id,ownerId:id})}));
 const denied=response();await searchOriginalMusicians({query:{projectId:id,instrument:'Keys'},user:{id:'222222222222222222222222'}},denied);assert.equal(denied.code,403);assert.equal(calls.length,1);
 const owner=response();await searchOriginalMusicians({query:{projectId:id,instrument:'Keys'},user:{id}},owner);assert.equal(owner.code,200);assert.deepEqual(owner.body.musicians,participant.body.musicians);
});

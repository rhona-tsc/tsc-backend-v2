import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCard } from '../services/buildActFilterCard.js';

test('act browse cards carry the stored setlist-control level', () => {
  const card = buildCard({
    _id: '6803a715d851b68a61832b06',
    tscName: 'The Dreamers',
    setlist: 'largeTailoring',
    lineups: [],
  });

  assert.equal(card.setlist, 'largeTailoring');
});

test('unknown setlist-control values are not exposed on browse cards', () => {
  const card = buildCard({
    _id: '6803a715d851b68a61832b06',
    tscName: 'The Dreamers',
    setlist: 'unexpected-value',
    lineups: [],
  });

  assert.equal(card.setlist, '');
});

import { normalizeActCard } from '../services/normalizeActCard.js';
import ActCard from '../models/actCard.model.js';
import ActFilterCard from '../models/ActFilterCard.js';
import Act from '../models/actModel.js';
import { upsertActCardFromAct as saveCard } from '../controllers/helpers/upsertActCardFromAct.js';
import { upsertActCardFromAct as saveLegacyCard } from '../services/actCard.service.js';
import { getFilterCards } from '../controllers/searchController.js';
const id='6803a715d851b68a61832b06';

test('both card persistence paths retain all three levels and allow clearing a previous choice',async t=>{
 const writes=[];
 t.mock.method(ActCard,'updateOne',async(_filter,update)=>{writes.push(update.$set);return{};});
 t.mock.method(ActCard,'findOneAndUpdate',async(_filter,update)=>{writes.push(update.$set);return{};});
 for(const setlist of ['smallTailoring','mediumTailoring','largeTailoring','']){
  const act={_id:id,setlist,lineups:[]};await saveCard(act);await saveLegacyCard(act);
  assert.equal(writes.at(-1).setlist,setlist);assert.equal(writes.at(-2).setlist,setlist);
  assert.equal(new ActFilterCard({...buildCard(act),actId:id}).toObject().setlist,setlist);
 }
 assert.equal(normalizeActCard({setlist:'largeTailoring'},{setlist:''}).setlist,'');
 assert.equal(normalizeActCard({setlist:'unexpected'}).setlist,'');
});

function browseSetup(t){
 t.mock.method(console,'log',()=>{});
 const rows=[{_id:'card-a',actId:id,status:'approved'},{_id:'card-b',actId:'6803a715d851b68a61832b07',status:'live'},{_id:'card-c',actId:'6803a715d851b68a61832b08',setlist:'largeTailoring',status:'approved'}];
 const source=rows.map((row,index)=>({_id:row.actId,setlist:['largeTailoring','mediumTailoring',''][index],loveCount:index+1}));
 const query=records=>({collation(){return this;},select(fields){assert.ok(fields.split(' ').includes('setlist'));return this;},sort(){return this;},skip(){return this;},limit(){return this;},lean:async()=>records,then(resolve,reject){return Promise.resolve(records).then(resolve,reject);}});
 t.mock.method(ActFilterCard,'find',()=>query(rows));t.mock.method(ActFilterCard,'countDocuments',async()=>rows.length);
 t.mock.method(ActFilterCard,'aggregate',()=>query([{data:rows,total:[{n:rows.length}]}]));
 t.mock.method(ActCard,'find',()=>query(rows));t.mock.method(Act,'find',()=>query(source));
 return{rows,source};
}
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
test('filter-card enrichment repairs old missing values from source acts, including genre-filtered results',async t=>{
 browseSetup(t);
 for(const query of [{},{genre:'Soul'}]){
  const res=response();await getFilterCards({query,user:{}},res);assert.equal(res.code,200);
  assert.deepEqual(res.body.cards.map(card=>card.setlist),['largeTailoring','mediumTailoring','']);
  assert.deepEqual(res.body.cards.map(card=>card.loveCount),[1,2,3]);assert.equal(res.body.total,3);
 }
});

test('public /act/cards returns current choices even when stored cards are old or stale',async t=>{
 const {rows}=browseSetup(t);
 const {default:router}=await import('../routes/actV2Routes.js');
 const layer=router.stack.find(layer=>layer.route?.path==='/cards'&&layer.route.methods.get);
 assert.ok(layer);const res=response();await layer.route.stack[0].handle({query:{}},res);
 assert.equal(res.code,200);assert.deepEqual(res.body.acts.map(card=>card.setlist),['largeTailoring','mediumTailoring','']);
 assert.equal(rows[0].setlist,undefined);assert.equal(rows[2].setlist,'largeTailoring');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import Booking from '../models/bookingModel.js';
import BookingBoardItem from '../models/bookingBoardItem.js';
import { normaliseBespokeLineup, updateBespokeSummary } from '../utils/bespokeLineup.js';
import { findActLineup } from '../utils/bookingActData.js';
const draft={lineupId:'bespoke',lineupSlots:[{role:'Lead Vocal / Guitar'},{role:'Saxophone',excluded:true},{role:'Drums'},{role:'Saxophone'}]};

test('bespoke count uses active people and keeps duplicates and crossed-off slots',()=>{
 const p=normaliseBespokeLineup({...draft,bandSize:99,lineupSelected:'Wrong label'});
 assert.equal(p.bandSize,3);assert.equal(p.lineupSelected,'Bespoke 3-piece');
 assert.deepEqual(p.lineupComposition,['Lead Vocal / Guitar','Drums','Saxophone']);
 assert.equal(p.lineupSlots.length,4);
 const restored=normaliseBespokeLineup({...p,lineupSlots:p.lineupSlots.map(s=>({...s,excluded:false}))});
 assert.equal(restored.bandSize,4);assert.equal(restored.lineupComposition.filter(r=>r==='Saxophone').length,2);
});
test('zero musicians cannot be saved and standard lineups remain unchanged',()=>{
 assert.throws(()=>normaliseBespokeLineup({lineupId:'bespoke',lineupSlots:[{role:'Drums',excluded:true}]}),/at least one/);
 const standard={lineupId:'standard',lineupSelected:'Trio',bandSize:3};assert.equal(normaliseBespokeLineup(standard),standard);
});
test('both booking models persist restore metadata through serialisation',()=>{
 const patch=normaliseBespokeLineup(draft);
 for(const Model of [Booking,BookingBoardItem]){
  const serialised=new Model({...patch,bookingId:'TEST',bookingRef:'TEST'}).toObject();
  const reloaded=new Model(serialised).toObject();
  assert.equal(reloaded.lineupMode,'bespoke');assert.equal(reloaded.lineupSlots[1].excluded,true);
  assert.equal(reloaded.bandSize,3);assert.deepEqual(reloaded.lineupComposition,patch.lineupComposition);
 }
});
test('custom roles never fall back to a same-sized standard lineup',()=>{
 const act={lineups:[{lineupId:'standard',actSize:'3-Piece',bandMembers:[{instrument:'Keyboard'}]}]};
 const custom=findActLineup(act,normaliseBespokeLineup(draft));
 assert.equal(custom.lineupId,'bespoke');assert.deepEqual(custom.bandMembers.map(m=>m.instrument),['Lead Vocal / Guitar','Drums','Saxophone']);
 assert.equal(act.lineups[0].bandMembers[0].instrument,'Keyboard');
});
test('summary refresh changes roles but preserves agreed prices and musician assignments',()=>{
 const p=normaliseBespokeLineup(draft);
 const summary={actId:'act',prices:{adjustedTotal:2615},chosenVocalists:[{musicianId:'singer'}],lineup:{bandMembers:[{instrument:'Drums',fee:150},{instrument:'Saxophone',fee:200}]}};
 const next=updateBespokeSummary(summary,p);
 assert.equal(next.lineupLabel,'Bespoke 3-piece');assert.equal(next.prices.adjustedTotal,2615);
 assert.deepEqual(next.chosenVocalists,summary.chosenVocalists);assert.equal(next.bandMembers.find(m=>m.instrument==='Drums').fee,150);
 assert.equal(summary.lineup.bandMembers.length,2);
});

test('saving a bespoke edit updates the booking, event sheet and restores slots without changing money',async()=>{
 const { applyBookingPatch }=await import('../routes/bookingBoardRoutes.js');
 const { getLineupMembersForPdf, getLineupDescriptionForPdf }=await import('../routes/bookingRoutes.js');
 const doc=Booking.hydrate({bookingId:'TEST',amount:2615,fee:2615,
  totals:{fullAmount:2615,depositAmount:500,chargedAmount:500},
  actsSummary:[{actId:'act',lineupId:'standard',lineupLabel:'4-Piece',prices:{adjustedTotal:2615},lineup:{actSize:'4-Piece',bandMembers:[{instrument:'Keyboard'}]}}],
  assignedMusicians:[{name:'Existing player',instrument:'Drums'}]});
 doc.save=async()=>doc;
 const assignments=JSON.stringify(doc.assignedMusicians);
 const originalFee=doc.fee;
 await applyBookingPatch(doc,draft);
 assert.equal(doc.bandSize,3);assert.equal(doc.lineupSelected,'Bespoke 3-piece');
 assert.equal(doc.actsSummary[0].lineupLabel,'Bespoke 3-piece');
 assert.equal(doc.totals.fullAmount,2615);assert.equal(doc.totals.chargedAmount,500);
 assert.equal(doc.amount,2615);assert.equal(doc.fee,originalFee);assert.equal(JSON.stringify(doc.assignedMusicians),assignments);
 const plain=doc.toObject();
 assert.deepEqual(getLineupMembersForPdf(plain,{}).map(m=>m.instrument),['Lead Vocal / Guitar','Drums','Saxophone']);
 assert.equal(getLineupDescriptionForPdf(plain,{}),'Lead Vocal / Guitar; Drums; Saxophone');
 await applyBookingPatch(doc,{...draft,lineupSlots:doc.lineupSlots.map(s=>({role:s.role,excluded:false}))});
 assert.equal(doc.bandSize,4);assert.equal(doc.actsSummary[0].bandMembers.length,4);
 assert.equal(doc.lineupSlots.length,4);
});

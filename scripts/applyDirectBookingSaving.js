// Price-only migration for the approved direct website saving.
// Usage: node --env-file=PATH scripts/applyDirectBookingSaving.js SOURCE.json AUDIT.json [--apply]
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Act from '../models/actModel.js';
import ActCard from '../models/actCard.model.js';
import ActFilterCard from '../models/ActFilterCard.js';
import { publicActStatuses } from '../utils/publicActStatuses.js';
import { buildMasterPricingPlan } from '../services/masterSupplierPricing.js';
import { supplierQuote, lineupSaving, minimumCustomerPrice } from '../utils/supplierPricing.js';
const [sourcePath, auditPath, mode] = process.argv.slice(2);
assert(sourcePath && auditPath, 'A fresh source and new audit path are required');
const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
assert(Date.now() - Date.parse(source.readAt) < 60 * 60 * 1000, 'Re-read the master before applying');
await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
try {
  const acts = await Act.find({ status: { $in: publicActStatuses }, isTest: { $ne: true } })
    .select('_id tscName supplierPricing minDisplayPrice hiddenWebsiteLineupIds lineups.lineupId lineups._id').lean();
  const originalPricing = new Map(acts.map(a => [String(a._id), structuredClone(a.supplierPricing)]));
  // Exact reviewed duo already present on Magnolia's public profile and in the master.
  const magnolia = acts.find(a => a.tscName === 'Magnolia Sky');
  const duoId = '8e29fb2c-1654-4b53-81e4-fc7e06580cb9';
  if (magnolia && !magnolia.supplierPricing.lineups[duoId]) {
    assert(magnolia.lineups.some(l => l.lineupId === duoId));
    const matches = source.rows.map((row,i) => ({row,sheetRow:i+5})).filter(x => x.row[0] === 'Magnolia Sky' && x.row[10] === 'Duo');
    assert.equal(matches.length,61,'Duo source coverage changed');
    const counties = Object.fromEntries(matches.map(({row}) => [row[5],Number(String(row[6]).replace(/[£,\s]/g,''))]));
    assert.equal(Object.keys(counties).length,61);
    assert(Object.values(counties).every(n => Number.isFinite(n) && n > 0));
    magnolia.supplierPricing.lineups[duoId] = {masterLineup:'Duo',description:'Lead vocalist + instrumentalist with backing tracks',counties,sourceRows:matches.map(x => x.sheetRow),status:'Modelled lineup price'};
    magnolia.supplierPricing.minimumSupplierPrice = Math.min(...Object.values(magnolia.supplierPricing.lineups).flatMap(l => Object.values(l.counties)).filter(n=>n>0));
  }
  const plan = buildMasterPricingPlan({ ...source, acts });
  assert.equal(plan.summary.changedRates, 0, 'Supplier rates changed: let the normal master sync update them first');
  const audit = { createdAt: new Date().toISOString(), sourceReadAt: source.readAt, policy: 'London lineup guide below 2500: 50; at/above: 100', summary: plan.summary, acts: [] };
  for (const act of acts) {
    const hidden = new Set((act.hiddenWebsiteLineupIds || []).map(String));
    const visible = act.lineups.filter(l => ![l.lineupId,l._id].some(id => hidden.has(String(id))));
    assert(visible.every(l => act.supplierPricing?.lineups?.[String(l.lineupId || l._id)]), 'Unmapped public lineup: '+act.tscName);
    const fields = { minDisplayPrice: minimumCustomerPrice(act) };
    assert(fields.minDisplayPrice > 0);
    const lineups = Object.entries(act.supplierPricing.lineups).map(([id,entry]) => {
      const saving = lineupSaving(entry);
      assert(saving === 50 || saving === 100, 'Missing London tier reference');
      const quote = supplierQuote(act,{lineupId:id},'London');
      return { lineupId:id, masterLineup:entry.masterLineup, saving, londonBefore:quote.standardTotal, londonAfter:quote.total };
    });
    const [card,filter] = await Promise.all([ActCard.findOne({actId:act._id}).select('_id actId minDisplayPrice').lean(),ActFilterCard.findOne({actId:act._id}).select('_id actId minDisplayPrice').lean()]);
    assert(card && filter, 'Missing price cache');
    audit.acts.push({...(act===magnolia?{mappingBefore:originalPricing.get(String(act._id)),mappingAfter:act.supplierPricing}:{}),actId:act._id,name:act.tscName,lineups,before:{act:act.minDisplayPrice,card:card.minDisplayPrice,filter:filter.minDisplayPrice},after:fields.minDisplayPrice});
  }
  await fs.writeFile(auditPath,JSON.stringify(audit,null,2),{flag:'wx',mode:0o600});
  if(mode === '--apply') {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async()=>{
        for(let i=0;i<acts.length;i++) {
          const act=acts[i], item=audit.acts[i];
          const result=await Act.updateOne({_id:act._id,supplierPricing:originalPricing.get(String(act._id)),minDisplayPrice:item.before.act},{$set:{minDisplayPrice:item.after,...(item.mappingAfter?{supplierPricing:item.mappingAfter}: {})}},{session});
          assert.equal(result.matchedCount,1,'Concurrent price change');
          for(const [model,key] of [[ActCard,'card'],[ActFilterCard,'filter']]) {
            const cached=await model.updateOne({actId:act._id,minDisplayPrice:item.before[key]},{$set:{minDisplayPrice:item.after,...(item.mappingAfter?{supplierPricing:item.mappingAfter,basePrice:item.mappingAfter.minimumSupplierPrice}: {})}},{session});
            assert.equal(cached.matchedCount,1,'Concurrent cache change');
          }
        }
      });
    } finally {await session.endSession();}
    for(const item of audit.acts) {
      const [act,card,filter]=await Promise.all([Act.findById(item.actId).select('minDisplayPrice supplierPricing').lean(),ActCard.findOne({actId:item.actId}).select('minDisplayPrice').lean(),ActFilterCard.findOne({actId:item.actId}).select('minDisplayPrice').lean()]);
      assert.deepEqual([act.minDisplayPrice,card.minDisplayPrice,filter.minDisplayPrice],[item.after,item.after,item.after]);
      assert.deepEqual(act.supplierPricing,acts.find(a=>String(a._id)===String(item.actId)).supplierPricing);
    }
  }
  console.log(JSON.stringify({applied:mode==='--apply',...audit.summary,acts:audit.acts.map(a=>({name:a.name,before:a.before.act,after:a.after}))},null,2));
} finally {await mongoose.disconnect();}

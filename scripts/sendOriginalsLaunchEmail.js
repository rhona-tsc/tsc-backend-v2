import 'dotenv/config';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import Musician from '../models/musicianModel.js';
import Preferences from '../models/musicianEmailPreferenceModel.js';
import { planOriginalsLaunchAudience } from '../services/originalsLaunchAudienceService.js';
import { buildOriginalsLaunchEmail } from '../utils/originalsLaunchEmail.js';
import { musicianEmailHash, musicianEmailPreferencesUrl } from '../utils/musicianEmailPreferences.js';
import sendEmail from '../utils/sendEmail.js';

// Dry-run unless --send is supplied. Persistent receipts prevent a resumed run
// from emailing a successful recipient twice. Ambiguous SMTP outcomes stop the run.
process.umask(0o077);
const apply = process.argv.includes('--send');
const campaignId = 'tsc-originals-launch-2026-11-06';
const directory = path.join(os.homedir(), '.codex', 'backups', campaignId);
const ledgerPath = path.join(directory, 'delivery.json');
const lockPath = path.join(directory, 'sending.lock');
const message = buildOriginalsLaunchEmail();
const bodyHash = createHash('sha256').update(JSON.stringify(message)).digest('hex');
const countStates = ledger => ledger.recipients.reduce((counts, row) => { const state=ledger.results[musicianEmailHash(row.email)]?.state || 'pending'; counts[state]=(counts[state]||0)+1; return counts; }, {});
const save = async ledger => { const temp=ledgerPath+'.tmp';await fs.writeFile(temp,JSON.stringify(ledger,null,2),{mode:0o600});await fs.rename(temp,ledgerPath); };
async function verifyLiveReadiness() {
  const backend = String(process.env.BACKEND_PUBLIC_URL || 'https://tsc-backend-v2.onrender.com').replace(/\/+$/, '');
  const auth = jwt.sign({id:'000000000000000000000001',role:'musician',email:'release-check@example.invalid'},process.env.JWT_SECRET,{expiresIn:'5m'});
  const response = await fetch(`${backend}/api/originals`,{headers:{Authorization:`Bearer ${auth}`},signal:AbortSignal.timeout(20000)});
  const data = await response.json();
  if (!response.ok || data.success !== true) throw new Error('Launch paused: ordinary musicians cannot yet access the live Originals workspace. No campaign email sent.');
  const link=new URL(musicianEmailPreferencesUrl('launch-readiness@example.invalid'));
  const preferences = await fetch(`${backend}/api/email-preferences?${link.searchParams}`,{signal:AbortSignal.timeout(20000)});
  const result = preferences.ok ? await preferences.json() : null;
  if (!result?.success || !result.preferences) throw new Error('Launch paused: the personalised unsubscribe link is not working on the live backend. No campaign email sent.');
}
let lock;
try {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:10000});
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const musicians = await Musician.find({role:'musician',status:{$in:['approved','Approved, changes pending']}}).select('_id email firstName role status profileDeletedAt privateTestProfile').lean();
  const preferences = await Preferences.find({}).lean();
  const plan = planOriginalsLaunchAudience(musicians,preferences);
  let ledger;
  try { ledger=JSON.parse(await fs.readFile(ledgerPath,'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; }
  if(!ledger){ledger={campaignId,bodyHash,createdAt:new Date().toISOString(),recipients:plan.recipients,excluded:plan.excluded,results:{},bccCopied:false};await save(ledger);}
  if(ledger.bodyHash!==bodyHash)throw new Error('Campaign content has changed since preparation; review before sending.');
  console.log(JSON.stringify({mode:apply?'send':'dry-run',campaignId,recipientCount:ledger.recipients.length,excluded:ledger.excluded,states:countStates(ledger),ledgerPath}));
  if(apply){
    await verifyLiveReadiness();
    lock=await fs.open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));
    ledger=JSON.parse(await fs.readFile(ledgerPath,'utf8'));
    if(ledger.bodyHash!==bodyHash)throw new Error('Campaign content has changed since preparation; review before sending.');
    const limitArg=process.argv.find(arg=>arg.startsWith('--limit='));const limit=limitArg?Number(limitArg.split('=')[1]):Infinity;let attempted=0;
    if(!(limit>0))throw new Error('Limit must be positive');
    for(const recipient of ledger.recipients){
      const key=musicianEmailHash(recipient.email);const prior=ledger.results[key];
      if(['sent','skipped'].includes(prior?.state))continue;
      if(['sending','uncertain'].includes(prior?.state))throw new Error('A previous SMTP outcome needs checking before continuing; no automatic resend.');
      if(attempted>=limit)break;
      const current=await Musician.findById(recipient.musicianId).select('_id email firstName role status profileDeletedAt privateTestProfile').lean();
      if(!current || planOriginalsLaunchAudience([current]).recipients[0]?.email!==recipient.email){ledger.results[key]={state:'skipped',reason:'Profile no longer eligible',at:new Date().toISOString()};await save(ledger);continue;}
      ledger.results[key]={state:'sending',startedAt:new Date().toISOString()};await save(ledger);attempted++;
      const result=await sendEmail({to:recipient.email,...buildOriginalsLaunchEmail({firstName:recipient.firstName}),musicianPreferences:true,opportunityCategory:'originals',...(!ledger.bccCopied?{bcc:'hello@thesupremecollective.co.uk'}:{})});
      if(result.accepted?.some(email=>String(email).toLowerCase()==='hello@thesupremecollective.co.uk'))ledger.bccCopied=true;
      const accepted=result.accepted?.some(email=>String(email).toLowerCase()===recipient.email);
      const state=result.skipped&&result.reason==='unsubscribed'?'skipped':accepted?'sent':'uncertain';
      ledger.results[key]={state,messageId:result.messageId||'',reason:result.reason||result.error||(!accepted?'SMTP did not confirm acceptance for this recipient':''),finishedAt:new Date().toISOString()};
      await save(ledger);
      console.log(JSON.stringify({campaignId,progress:countStates(ledger)}));
      if(state==='uncertain')throw new Error('Campaign paused after an unconfirmed SMTP delivery. Check the receipt before resuming.');
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    console.log(JSON.stringify({campaignId,states:countStates(ledger),ledgerPath}));
  }
} catch(error) { console.error(error.message);process.exitCode=1; }
finally {if(lock){await lock.close();await fs.unlink(lockPath);}await mongoose.disconnect();}

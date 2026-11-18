import crypto from 'node:crypto';
import mongoose from 'mongoose';

export const VOICE_LIVE_MONTHLY_LIMIT_PENCE=1000;
// Conservative reservation, not a per-call charge. It covers the bounded six-minute
// voice/recording/TTS and three transcription attempts, with substantial headroom.
export const VOICE_LIVE_CALL_RESERVE_PENCE=100;
export function voiceBudgetMonth(now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}`;
}
const meter=()=>mongoose.connection.db.collection('voice_live_monthly_limits');
export async function reserveLiveVoiceCall({projectId,callSid,now=new Date(),collection=meter()}={}){
  if(!/^proj_[a-z\d_-]+$/i.test(projectId||'')||!/^CA[a-f\d]{32}$/i.test(callSid||''))return false;
  const id=`live:${projectId}:${voiceBudgetMonth(now)}`,hash=crypto.createHash('sha256').update(callSid).digest('hex');
  try{
    await collection.updateOne({_id:id},{$setOnInsert:{reservedPence:0,acceptedCalls:0,callHashes:[],limitPence:VOICE_LIVE_MONTHLY_LIMIT_PENCE,month:voiceBudgetMonth(now)}},{upsert:true,maxTimeMS:1500});
    // A provider retry after a restart reuses its existing reservation.
    if(await collection.findOne({_id:id,callHashes:hash},{projection:{_id:1},maxTimeMS:1500}))return true;
    const row=await collection.findOneAndUpdate({_id:id,reservedPence:{$lte:VOICE_LIVE_MONTHLY_LIMIT_PENCE-VOICE_LIVE_CALL_RESERVE_PENCE},callHashes:{$ne:hash}},{$inc:{reservedPence:VOICE_LIVE_CALL_RESERVE_PENCE,acceptedCalls:1},$push:{callHashes:hash},$set:{updatedAt:now}},{returnDocument:'after',includeResultMetadata:false,maxTimeMS:1500});
    if(row)return true;
    return !!await collection.findOne({_id:id,callHashes:hash},{projection:{_id:1},maxTimeMS:1500});
  }catch{return false;} // Never answer an unbudgeted live call.
}
export async function liveVoiceBudgetStatus({projectId,now=new Date(),collection=meter()}={}){
  const row=await collection.findOne({_id:`live:${projectId}:${voiceBudgetMonth(now)}`},{projection:{reservedPence:1,acceptedCalls:1},maxTimeMS:1500});
  return {month:voiceBudgetMonth(now),limitPence:VOICE_LIVE_MONTHLY_LIMIT_PENCE,reservedPence:row?.reservedPence||0,acceptedCalls:row?.acceptedCalls||0,reservationPerCallPence:VOICE_LIVE_CALL_RESERVE_PENCE,actualCharges:null,remainingReservations:Math.max(0,Math.floor((VOICE_LIVE_MONTHLY_LIMIT_PENCE-(row?.reservedPence||0))/VOICE_LIVE_CALL_RESERVE_PENCE))};
}

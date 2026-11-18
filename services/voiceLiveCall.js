import mongoose from 'mongoose';
import twilio from 'twilio';
import {voiceCallRef} from './voiceCallReview.js';
import {VOICE_MAX_SECONDS} from './voiceEnquiryConnection.js';
export async function enforceLiveVoiceDuration(row,{collection=mongoose.connection.db.collection('voice_call_reviews'),update=sid=>twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN,{timeout:3000,autoRetry:false}).calls(sid).update({timeLimit:VOICE_MAX_SECONDS})}={}){
  if(row?.testMode!==false||row.guided?.durationLimitSet)return true;
  if(!/^CA[a-f\d]{32}$/i.test(row.callSid||''))return false;
  try{await update(row.callSid);await collection.updateOne({_id:voiceCallRef(row.callSid)},{$set:{'guided.durationLimitSet':true}});return true;}catch{return false;}
}

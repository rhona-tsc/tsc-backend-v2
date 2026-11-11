import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {google} from 'googleapis';
import {EQUIPMENT_SHEET_ID,EQUIPMENT_SUPPLIERS,parseEquipmentRows} from './voiceBookingEquipment.js';
export const SHEETS_READ_ONLY='https://www.googleapis.com/auth/spreadsheets.readonly';
const PREFIX='voice-equipment-test.';
const key=()=>{const secret=process.env.VOICE_ENQUIRY_BRIDGE_SECRET||'';if(secret.length<32)throw new Error('Equipment connection is not configured.');return crypto.createHash('sha256').update(`voice-equipment:${secret}`).digest();};
export function sealEquipmentToken(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(part=>part.toString('base64url')).join('.');}
export function openEquipmentToken(value){const parts=String(value||'').split('.');if(parts.length!==3)throw new Error('Invalid equipment connection.');const [iv,tag,data]=parts.map(part=>Buffer.from(part,'base64url'));const cipher=crypto.createDecipheriv('aes-256-gcm',key(),iv);cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');}
const oauth=()=>{
  const redirect=new URL(process.env.GOOGLE_REDIRECT_URI);
  if(redirect.protocol!=='https:' || !['/api/google/oauth2callback','/api/seo-keywords/google/callback'].includes(redirect.pathname))throw new Error('The equipment Google return path is not configured.');
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,redirect.href);
};
const connections=()=>mongoose.connection.db.collection('voice_equipment_google_connections');
const states=()=>mongoose.connection.db.collection('voice_equipment_oauth_states');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
export async function equipmentConnectionStatus(){const record=await connections().findOne({_id:'reference'});return {connected:!!record?.refreshTokenEncrypted,sheetId:EQUIPMENT_SHEET_ID,tabs:Object.values(EQUIPMENT_SUPPLIERS).map(p=>p.tab),readOnly:true,testMode:true,connectedAt:record?.connectedAt||null};}
export async function disconnectEquipmentGoogleConnection(){await connections().updateOne({_id:'reference'},{$unset:{refreshTokenEncrypted:1},$set:{disconnectedAt:new Date()}});return equipmentConnectionStatus();}
export async function beginEquipmentGoogleConnection(userId){
  key();
  const nonce=crypto.randomBytes(32).toString('base64url');
  await states().createIndex({expiresAt:1},{expireAfterSeconds:0});
  await states().insertOne({_id:hash(nonce),requestedBy:String(userId||''),expiresAt:new Date(Date.now()+10*60*1000),consumedAt:null});
  return oauth().generateAuthUrl({access_type:'offline',prompt:'consent',scope:[SHEETS_READ_ONLY],include_granted_scopes:false,state:PREFIX+nonce});
}
export function isEquipmentOAuthState(state){return typeof state==='string'&&state.startsWith(PREFIX);}
export function equipmentGoogleCallbackGate(req,res,next){return isEquipmentOAuthState(req.query?.state)?handleEquipmentGoogleCallback(req,res):next();}
export async function handleEquipmentGoogleCallback(req,res){
  const fallback='https://admin.thesupremecollective.co.uk/enquiry-board?equipmentConnection=';
  try{
    const state=String(req.query.state||'');const nonce=state.slice(PREFIX.length);
    if(!/^[A-Za-z0-9_-]{43}$/.test(nonce))return res.status(400).send('Invalid equipment connection request.');
    const consumed=await states().findOneAndUpdate({_id:hash(nonce),expiresAt:{$gt:new Date()},consumedAt:null},{$set:{consumedAt:new Date()}},{returnDocument:'after',includeResultMetadata:false});
    if(!consumed)return res.status(400).send('This equipment connection request expired or was already used. Start again from the enquiry board.');
    if(req.query.error || typeof req.query.code!=='string' || !req.query.code || req.query.code.length>4096)return res.redirect(fallback+'cancelled');
    const client=oauth();const {tokens}=await client.getToken(req.query.code);
    if(!tokens.refresh_token)throw new Error('No offline connection returned.');
    client.setCredentials(tokens);
    // Verify only the three fixed equipment rectangles. No other tabs or private event header cells.
    await google.sheets({version:'v4',auth:client}).spreadsheets.values.batchGet({spreadsheetId:EQUIPMENT_SHEET_ID,ranges:Object.values(EQUIPMENT_SUPPLIERS).map(p=>p.range),valueRenderOption:'FORMATTED_VALUE'},{timeout:8000});
    await connections().updateOne({_id:'reference'},{$set:{refreshTokenEncrypted:sealEquipmentToken(tokens.refresh_token),connectedAt:new Date(),requestedBy:consumed.requestedBy,requestedScope:SHEETS_READ_ONLY}},{upsert:true});
    return res.redirect(fallback+'connected');
  }catch{return res.redirect(fallback+'failed');}
}
export async function readEquipmentProfile(profile){
  if(!Object.values(EQUIPMENT_SUPPLIERS).some(p=>p.tab===profile?.tab&&p.range===profile?.range))throw new Error('Unapproved equipment profile.');
  const connection=await connections().findOne({_id:'reference'});
  if(!connection?.refreshTokenEncrypted)return {status:'connection_required',items:{audio:[],lighting:[]}};
  const client=oauth();client.setCredentials({refresh_token:openEquipmentToken(connection.refreshTokenEncrypted)});
  const result=await google.sheets({version:'v4',auth:client}).spreadsheets.values.get({spreadsheetId:EQUIPMENT_SHEET_ID,range:profile.range,valueRenderOption:'FORMATTED_VALUE'},{timeout:6000});
  return {status:'reference_only',readAt:new Date().toISOString(),items:parseEquipmentRows(result.data.values)};
}

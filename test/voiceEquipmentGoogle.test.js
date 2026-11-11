import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {google} from 'googleapis';
import {sealEquipmentToken,openEquipmentToken,beginEquipmentGoogleConnection,handleEquipmentGoogleCallback,readEquipmentProfile,equipmentConnectionStatus,disconnectEquipmentGoogleConnection,equipmentGoogleCallbackGate,SHEETS_READ_ONLY} from '../services/voiceEquipmentGoogle.js';
import {EQUIPMENT_SUPPLIERS,EQUIPMENT_SHEET_ID} from '../services/voiceBookingEquipment.js';

test('Google connection uses separate encrypted credentials, fixed read-only ranges, expiring single-use consent and no secret responses',async()=>{
 const envKeys=['VOICE_ENQUIRY_BRIDGE_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI'];
 const old=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));const db=mongoose.connection.db;
 Object.assign(process.env,{VOICE_ENQUIRY_BRIDGE_SECRET:'TEST-ONLY-EQUIPMENT-KEY-32-CHARS-LONG',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',GOOGLE_REDIRECT_URI:'https://example.test/api/google/oauth2callback'});
 let pending,connection;let exchanged=0;const requests=[];
 mongoose.connection.db={collection:name=>name==='voice_equipment_oauth_states'?{
  createIndex:async()=>{},insertOne:async row=>{pending=row;},findOneAndUpdate:async query=>{if(!pending||pending._id!==query._id||pending.consumedAt||pending.expiresAt<=query.expiresAt.$gt)return null;pending.consumedAt=new Date();return pending;},
 }:{findOne:async()=>connection,updateOne:async(_,update)=>{connection={...update.$set};}}};
 const tokenMock=mock.method(google.auth.OAuth2.prototype,'getToken',async()=>{exchanged++;return {tokens:{refresh_token:'SECRET_REFRESH_TOKEN',access_token:'SECRET_ACCESS_TOKEN'}};});
 const sheetMock=mock.method(google,'sheets',()=>({spreadsheets:{values:{batchGet:async args=>{requests.push(args);return {data:{valueRanges:[]}};},get:async args=>{requests.push(args);return {data:{values:[['AUDIO'],['2','PA speaker','9999']]}};}}}}));
 const response=()=>({code:200,target:'',status(n){this.code=n;return this;},send(t){this.target=t;return this;},redirect(t){this.target=t;return this;}});
 try{
  const sealed=sealEquipmentToken('SECRET_REFRESH_TOKEN');assert.equal(openEquipmentToken(sealed),'SECRET_REFRESH_TOKEN');assert.doesNotMatch(sealed,/SECRET/);assert.throws(()=>openEquipmentToken(sealed+'x'));
  assert.equal((await equipmentConnectionStatus()).connected,false);
  assert.equal((await readEquipmentProfile(EQUIPMENT_SUPPLIERS['6a05f1a00358e40a87adb33d'])).status,'connection_required');assert.equal(requests.length,0);
  const url=new URL(await beginEquipmentGoogleConnection('management-user'));
  assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('scope'),SHEETS_READ_ONLY);assert.equal(url.searchParams.get('include_granted_scopes'),'false');
  assert.equal(url.searchParams.get('redirect_uri'),'https://example.test/api/google/oauth2callback');
  assert.notEqual(pending._id,url.searchParams.get('state'));assert.ok(pending.expiresAt>Date.now());
  const state=url.searchParams.get('state');const result=response();await handleEquipmentGoogleCallback({query:{state,code:'example-code'}},result);
  assert.match(result.target,/equipmentConnection=connected$/);assert.equal(exchanged,1);assert.ok(connection.refreshTokenEncrypted);assert.doesNotMatch(JSON.stringify(connection),/SECRET/);
  assert.equal(requests[0].spreadsheetId,EQUIPMENT_SHEET_ID);assert.deepEqual(requests[0].ranges,Object.values(EQUIPMENT_SUPPLIERS).map(p=>p.range));
  const status=await equipmentConnectionStatus();assert.equal(status.connected,true);assert.doesNotMatch(JSON.stringify(status),/Encrypted|SECRET|refresh_token/);
  const profile=await readEquipmentProfile(EQUIPMENT_SUPPLIERS['6a05f1a00358e40a87adb33d']);assert.equal(profile.status,'reference_only');assert.doesNotMatch(JSON.stringify(profile),/9999|SECRET/);
  const replay=response();await handleEquipmentGoogleCallback({query:{state,code:'example-code'}},replay);assert.equal(replay.code,400);assert.equal(exchanged,1);
  let legacyCalls=0;await equipmentGoogleCallbackGate({query:{state:'existing-seo-state'}},response(),()=>{legacyCalls++;});assert.equal(legacyCalls,1);
  const invalid=response();await equipmentGoogleCallbackGate({query:{state:'voice-equipment-test.invalid',code:'bad'}},invalid,()=>assert.fail('Equipment state must not reach the legacy callback'));assert.equal(invalid.code,400);
  await assert.rejects(readEquipmentProfile({tab:'Q1 Private',range:"'Q1 Private'!A1:Z99"}));
  assert.equal((await disconnectEquipmentGoogleConnection()).connected,false);
  assert.equal((await readEquipmentProfile(EQUIPMENT_SUPPLIERS['6a05f1a00358e40a87adb33d'])).status,'connection_required');
  const expiredUrl=new URL(await beginEquipmentGoogleConnection('management-user'));pending.expiresAt=new Date(0);const expired=response();await handleEquipmentGoogleCallback({query:{state:expiredUrl.searchParams.get('state'),code:'expired'}},expired);assert.equal(expired.code,400);assert.equal(exchanged,1);
 }finally{tokenMock.mock.restore();sheetMock.mock.restore();mongoose.connection.db=db;for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

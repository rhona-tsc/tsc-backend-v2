import Acceptance from '../models/originalAgreementAcceptanceModel.js';
import { getOriginalAgreement, recordOriginalAgreement, requireCurrentOriginalAgreement } from '../services/originalsAgreementService.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import Reservation from '../models/originalReservationModel.js';
import Future from '../models/originalRoleReservationModel.js';
import Round from '../models/originalRoundModel.js';
import Project from '../models/originalProjectModel.js';
import Submission from '../models/originalSubmissionModel.js';
import Invitation from '../models/originalInvitationModel.js';
import Musician from '../models/musicianModel.js';
import Notification from '../models/originalNotificationModel.js';
import { createOriginalRecordingReservation as createRecordingReservation, activateOriginalRoleReservations } from '../services/originalsReservationService.js';
import { reserveFutureOriginalRole, releaseFutureOriginalRole, releaseOriginalReservation } from '../controllers/originalsReservationsController.js';
import { runOriginalRoundNotifications, buildOriginalRoundOpenEmail } from '../services/originalsRoundNotificationService.js';
import { originalParticipation } from '../services/originalsMembershipService.js';
import { originalTakeKindsValid } from '../services/originalsTakeFilesService.js';
const owner='111111111111111111111111',player='222222222222222222222222',projectId='333333333333333333333333',now=new Date('2026-11-04T16:00:00Z');
const project={_id:projectId,ownerId:owner,currentRoundId:'round',state:'role_round_open',title:'Soul song',requestedRoles:[{name:'Vocal'},{name:'Bass'}]};
const round={_id:'round',projectId,type:'instrument',roleName:'Bass',state:'open',slotLimit:3,clockStartedAt:null,closesAt:null};
const terms=getOriginalAgreement();
const agreementInput={accepted:true,fullName:'Test Musician',version:terms.version,textHash:terms.textHash,acknowledgement:terms.acknowledgement};
let acceptances;
test.beforeEach(t=>{
 acceptances=new Map();
 t.mock.method(Acceptance,'create',async data=>{const row={_id:`agreement-${acceptances.size+1}`,...data};acceptances.set(row._id,row);return row;});
 t.mock.method(Acceptance,'findById',id=>({lean:async()=>acceptances.get(String(id))||null}));
 t.mock.method(Notification,'updateOne',async()=>({}));
});
async function acceptedFor(musicianId=player,roleName='Bass',type='contributor') {
 const current=getOriginalAgreement(type);
 return recordOriginalAgreement({projectId,musicianId,roleName,type,input:{...agreementInput,version:current.version,textHash:current.textHash,acknowledgement:current.acknowledgement},now});
}
async function createOriginalRecordingReservation(options) {
 const agreement=await acceptedFor(options.musicianId,options.roleName);
 return createRecordingReservation({...options,agreementAcceptanceId:agreement._id});
}
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
function mockClock(t){t.mock.method(Round,'findOneAndUpdate',async()=>({...round,clockStartedAt:now,closesAt:new Date(+now+7*86400000)}));t.mock.method(Invitation,'updateMany',async()=>({}));}
function slotStore(t,initial=[]){
 const rows=[...initial];t.mock.method(Submission,'find',()=>({select:()=>({lean:async()=>[]})}));
 t.mock.method(Reservation,'find',()=>({select:()=>({lean:async()=>rows.filter(item=>item.slotHeld!==false&&['active','submitted'].includes(item.state))})}));
 t.mock.method(Reservation,'updateMany',async()=>({}));t.mock.method(Reservation,'updateOne',async(filter,update)=>{Object.assign(rows.find(item=>item._id===filter._id)||{},update.$set);});
 t.mock.method(Reservation,'findOne',filter=>({lean:async()=>rows.find(item=>item.futureReservationId&&String(item.futureReservationId)===String(filter.futureReservationId))||null}));
 t.mock.method(Reservation,'create',async data=>{
  if(rows.some(item=>item.slotHeld!==false&&item.seatNumber===data.seatNumber)||rows.some(item=>item.state==='active'&&item.musicianId===data.musicianId))throw Object.assign(new Error('duplicate'),{code:11000});
  const row={_id:`slot-${rows.length+1}`,state:'active',...data};rows.push(row);return row;
 });mockClock(t);return rows;
}
function futureSnapshot(t,waiting){
 t.mock.method(Future,'find',()=>({sort:()=>({lean:async()=>waiting}),select:()=>({lean:async()=>waiting})}));
 t.mock.method(Round,'find',()=>({select:()=>({lean:async()=>[round]})}));
 t.mock.method(Invitation,'find',()=>({select:()=>({lean:async()=>[]})}));
}
test('three recording places are held, submitted places still count, and a fourth cannot overbook',async t=>{
 const rows=slotStore(t);for(let i=0;i<3;i++)await createOriginalRecordingReservation({round,musicianId:`person-${i}`,roleName:'Bass',now});
 rows[0].state='submitted';await assert.rejects(createOriginalRecordingReservation({round,musicianId:'fourth',roleName:'Bass',now}),/All places/);assert.equal(rows.length,3);
});
test('a released place can be reserved again and a new recording reservation has its own 24 hours',async t=>{
 const rows=slotStore(t,[{_id:'released',seatNumber:1,slotHeld:false,state:'released',musicianId:'other'}]);
 const{reservation}=await createOriginalRecordingReservation({round,musicianId:player,roleName:'Bass',now});assert.equal(reservation.seatNumber,1);assert.equal(+reservation.expiresAt-+reservation.reservedAt,86400000);assert.equal(rows.length,2);
});
test('legacy reservations without seat numbers still consume capacity',async t=>{
 slotStore(t,[{_id:'legacy',musicianId:'old',state:'active'}]);const{reservation}=await createOriginalRecordingReservation({round,musicianId:player,roleName:'Bass',now});assert.equal(reservation.seatNumber,2);
});
test('closing while a new reservation is created releases its held seat',async t=>{
 const rows=slotStore(t);t.mock.method(Round,'findOneAndUpdate',async()=>null);t.mock.method(Round,'findOne',async()=>null);
 await assert.rejects(createOriginalRecordingReservation({round,musicianId:player,roleName:'Bass',now}),/closed/);assert.equal(rows[0].slotHeld,false);assert.equal(rows[0].state,'cancelled');
});
test('advance places do not have a round deadline and never start the round clock',async t=>{
 t.mock.method(Project,'findById',()=>({lean:async()=>project}));t.mock.method(Project,'updateOne',async(query,update)=>{assert.equal(query['requestedRoles.name'],'Bass');assert.equal(query.state,project.state);assert.equal(update.$inc.__v,1);return{matchedCount:1};});t.mock.method(Round,'findById',()=>({lean:async()=>({...round,roleName:'Vocal'})}));t.mock.method(Submission,'exists',async()=>false);t.mock.method(Future,'findOne',()=>({lean:async()=>null}));let saved;
 t.mock.method(Future,'create',async data=>{saved=data;return{_id:'future',state:'waiting',...data};});
 const clock=t.mock.method(Round,'findOneAndUpdate',()=>assert.fail('future reservation cannot start a clock'));
 const res=response();await reserveFutureOriginalRole({params:{id:projectId},user:{id:player},body:{roleName:'Bass',agreement:agreementInput}},res);
 assert.equal(res.code,201);assert.equal(saved.roleKey,'bass');assert.equal('expiresAt'in saved,false);assert.equal('roundId'in saved,false);assert.equal(clock.mock.callCount(),0);
});
test('advance reservations are limited to three places and refused once their role is current',async t=>{
 t.mock.method(Project,'findById',()=>({lean:async()=>project}));t.mock.method(Round,'findById',()=>({lean:async()=>({...round,roleName:'Vocal'})}));t.mock.method(Submission,'exists',async()=>false);t.mock.method(Future,'findOne',()=>({lean:async()=>null}));let attempts=0;
 t.mock.method(Future,'create',async()=>{attempts++;throw Object.assign(new Error('seat occupied'),{code:11000});});
 const req={params:{id:projectId},user:{id:player},body:{roleName:'Bass',agreement:agreementInput}};const full=response();await reserveFutureOriginalRole(req,full);assert.equal(full.code,409);assert.equal(attempts,3);
 t.mock.method(Round,'findById',()=>({lean:async()=>round}));const current=response();await reserveFutureOriginalRole(req,current);assert.equal(current.code,409);assert.equal(attempts,3);
});
test('a concurrent part removal cancels the new advance hold while retaining agreement evidence',async t=>{
 t.mock.method(Project,'findById',()=>({lean:async()=>project}));t.mock.method(Round,'findById',()=>({lean:async()=>({...round,roleName:'Vocal'})}));t.mock.method(Submission,'exists',async()=>false);t.mock.method(Future,'findOne',()=>({lean:async()=>null}));
 let saved,cancelled;
 t.mock.method(Future,'create',async data=>{saved=data;return{_id:'future',state:'waiting',...data};});
 t.mock.method(Project,'updateOne',async(query,update)=>{assert.equal(query['requestedRoles.name'],'Bass');assert.equal(update.$inc.__v,1);return{matchedCount:0};});
 t.mock.method(Future,'updateOne',async(query,update)=>{assert.equal(query._id,'future');cancelled=update.$set.state;});
 const res=response();await reserveFutureOriginalRole({params:{id:projectId},user:{id:player},body:{roleName:'Bass',agreement:agreementInput}},res);
 assert.equal(res.code,409);assert.equal(cancelled,'cancelled');assert.match(res.body.message,/parts have changed/);assert.ok(acceptances.has(saved.agreementAcceptanceId));
});
test('opening a role activates its future place once, starts a real 24-hour clock and preserves anonymity',async t=>{
 const rows=slotStore(t);const agreement=await acceptedFor();const item={agreementAcceptanceId:agreement._id,_id:'future',musicianId:player,roleName:'Bass',projectId,state:'waiting',anonymous:true,creditName:'Stage Name'};futureSnapshot(t,[item]);
 t.mock.method(Future,'findOneAndUpdate',()=>({lean:async()=>({...item,state:'activated'})}));let saved;
 t.mock.method(Future,'updateOne',async(_filter,update)=>{saved=update.$set;});
 await activateOriginalRoleReservations({project,round,now});assert.equal(rows.length,1);assert.equal(rows[0].futureReservationId,'future');assert.equal(rows[0].anonymous,true);assert.equal(rows[0].creditName,'Stage Name');assert.equal(saved.activeReservationId,rows[0]._id);
 const recovered=await createOriginalRecordingReservation({round,musicianId:player,roleName:'Bass',futureReservationId:'future',now:new Date(+now+1000)});assert.equal(rows.length,1);assert.equal(recovered.reservation.reservedAt,now);
});
test('only the musician can release their waiting or unsubmitted reservation',async t=>{
 t.mock.method(Future,'findOneAndUpdate',query=>({lean:async()=>{assert.equal(query.musicianId,player);assert.equal(query.state,'waiting');return{_id:'future',state:'released'};}}));
 const waiting=response();await releaseFutureOriginalRole({params:{id:projectId,futureId:'future'},user:{id:player}},waiting);assert.equal(waiting.code,200);
 t.mock.method(Reservation,'findOneAndUpdate',query=>({lean:async()=>{assert.equal(query.musicianId,player);assert.equal(query.state,'active');return null;}}));
 const submitted=response();await releaseOriginalReservation({params:{reservationId:'submitted'},user:{id:player}},submitted);assert.equal(submitted.code,409);
});
test('release cancels queued round emails and frees the seat without deleting files',async t=>{
 let update;t.mock.method(Reservation,'findOneAndUpdate',(_query,change)=>({lean:async()=>{update=change.$set;return{_id:'booking',projectId,musicianId:player,state:'released'};}}));let cancelled;
 t.mock.method(Notification,'updateMany',async query=>{cancelled=query;});
 const res=response();await releaseOriginalReservation({params:{reservationId:'booking'},user:{id:player}},res);assert.equal(res.code,200);assert.equal(update.slotHeld,false);assert.equal(cancelled.template,'originals_reserved_round_open');
});
test('waiting for a different future role retains membership, but a rejected role cannot be revived by waiting',()=>{
 const base={project,rounds:[round],reservations:[],submissions:[{musicianId:player,roleName:'Vocal',roundId:'old',state:'rejected'}],invitations:[],futureReservations:[{musicianId:player,roleName:'Bass',state:'waiting'}]};
 assert.equal(originalParticipation(base,player,now).notify,true);base.futureReservations[0].roleName='Vocal';assert.equal(originalParticipation(base,player,now).canAccess,false);
});
test('three stems and one shared listening mix are valid; a fourth stem is refused',()=>{
 const stems=['a','b','c'],assets=[...stems.map(_id=>({_id,kind:'take_stem'})),{_id:'mix',kind:'take_mixdown'},{_id:'d',kind:'take_stem'}];
 const take={stemAssetId:'a',stemAssetIds:stems,mixdownAssetId:'mix'};assert.equal(originalTakeKindsValid([take],assets),true);assert.equal(originalTakeKindsValid([{...take,stemAssetIds:[...stems,'d']}],assets),false);assert.equal(originalTakeKindsValid([{...take,wetStemAssetId:'d'}],assets),false);
});
test('round email explains when the reservation expires and how to release it',()=>{
 const email=buildOriginalRoundOpenEmail({project,reservation:{roleName:'Bass',expiresAt:new Date(+now+86400000)}});assert.match(email.text,/24-hour/);assert.match(email.text,/one to three stems/);assert.match(email.text,/release/);assert.match(email.text,new RegExp(projectId));
});
test('released advance reservations do not receive round-open email',async t=>{
 t.mock.method(Future,'distinct',async()=>[]);t.mock.method(Reservation,'find',()=>({limit:()=>({lean:async()=>[]})}));let once=false;
 t.mock.method(Notification,'findOneAndUpdate',()=>({lean:async()=>once?null:(once=true,{_id:'job',projectId,recipientMusicianId:player,payload:{reservationId:'booking'},attempts:1})}));
 t.mock.method(Reservation,'findById',()=>({lean:async()=>({state:'released',expiresAt:new Date('2030-01-01')})}));t.mock.method(Project,'findById',()=>({lean:async()=>project}));t.mock.method(Musician,'findById',()=>({select:()=>({lean:async()=>({email:'fake@example.test'})})}));let state;
 t.mock.method(Notification,'updateOne',async(_query,update)=>{state=update.$set.state;});await runOriginalRoundNotifications({emailSender:()=>assert.fail('must not email a released reservation'),now});assert.equal(state,'cancelled');
});

test('simultaneous recording reservations receive different numbered places',async t=>{
 const rows=slotStore(t);const results=await Promise.all(['one','two','three'].map(musicianId=>createOriginalRecordingReservation({round,musicianId,roleName:'Bass',now})));
 assert.equal(rows.length,3);assert.equal(new Set(results.map(item=>item.reservation.seatNumber)).size,3);
});
test('active advance reservation receives a real round-open email through the delivery worker',async t=>{
 const reservation={_id:'booking',projectId,roundId:'round',musicianId:player,roleName:'Bass',state:'active',expiresAt:new Date('2030-01-01')};
 t.mock.method(Future,'distinct',async()=>[]);t.mock.method(Future,'find',()=>({select:()=>({lean:async()=>[]})}));
 t.mock.method(Reservation,'find',()=>({limit:()=>({lean:async()=>[]}),select:()=>({lean:async()=>[reservation]})}));
 t.mock.method(Submission,'find',()=>({select:()=>({lean:async()=>[]})}));t.mock.method(Invitation,'find',()=>({select:()=>({lean:async()=>[]})}));t.mock.method(Round,'find',()=>({select:()=>({lean:async()=>[round]})}));
 let once=false;t.mock.method(Notification,'findOneAndUpdate',()=>({lean:async()=>once?null:(once=true,{_id:'job',projectId,recipientMusicianId:player,payload:{reservationId:'booking'},attempts:1})}));
 t.mock.method(Reservation,'findById',()=>({lean:async()=>reservation}));t.mock.method(Project,'findById',()=>({lean:async()=>project}));t.mock.method(Musician,'findById',()=>({select:()=>({lean:async()=>({email:'fake@example.test',firstName:'Player'})})}));let state,mail;
 t.mock.method(Notification,'updateOne',async(_query,update)=>{state=update.$set.state;});await runOriginalRoundNotifications({emailSender:async email=>{mail=email;return{ok:true};},now});assert.equal(state,'sent');assert.equal(mail.to,'fake@example.test');assert.match(mail.subject,/Bass round is open/);
});
test('round-open outbox is marked only after an idempotent recipient-specific notification is saved',async t=>{
 t.mock.method(Future,'distinct',async()=>[]);t.mock.method(Reservation,'find',()=>({limit:()=>({lean:async()=>[{_id:'booking',projectId,musicianId:player,state:'active',expiresAt:new Date('2030-01-01')}]})}));let queued,marked;
 t.mock.method(Notification,'updateOne',async(query,update,options)=>{queued={query,update,options};});t.mock.method(Reservation,'updateOne',async(_query,update)=>{marked=update.$set.roundNotificationQueued;});t.mock.method(Notification,'findOneAndUpdate',()=>({lean:async()=>null}));
 await runOriginalRoundNotifications({emailSender:()=>assert.fail('no claimed mail jobs'),now});assert.equal(marked,true);assert.equal(queued.options.upsert,true);assert.equal(queued.query.eventKey,'reserved-round:booking');assert.equal(queued.update.$setOnInsert.payload.reservationId,'booking');
});

test('three approved stems in one grouped contribution receive one contributor royalty allocation',async()=>{
 const {calculateOriginalsSplits,totalPercent}=await import('../services/originalsRoyaltyService.js');
 const splits=calculateOriginalsSplits({project:{ownerId:owner,ownerSongwritingClaim:true},acceptedSubmissions:[{category:'contribution',musicianId:player,roleName:'Vocal',songwritingChoice:'songwriting_claim',takes:[{stemAssetId:'lead',stemAssetIds:['lead','harmony','double'],mixdownAssetId:'mix'}]},{category:'mix',musicianId:'mix'},{category:'master',musicianId:'master'}]});
 assert.equal(splits.master.find(share=>share.recipientId===player).percent,40);assert.equal(splits.composition.find(share=>share.recipientId===player).percent,50);assert.equal(totalPercent(splits.master),100);
});

test('reservation service refuses absent consent evidence before allocating a seat or starting a clock',async t=>{
 const rows=slotStore(t);const clock=t.mock.method(Round,'findOneAndUpdate',()=>assert.fail('no agreement cannot start a clock'));
 await assert.rejects(createRecordingReservation({round,musicianId:player,roleName:'Bass',now}),{code:'ORIGINALS_AGREEMENT_REQUIRED'});
 assert.equal(rows.length,0);assert.equal(clock.mock.callCount(),0);
});
test('acceptance requires explicit consent, a name, exact current version and text hash',async()=>{
 const options={projectId,musicianId:player,roleName:'Bass'};
 for(const input of [undefined,{...agreementInput,accepted:false},{...agreementInput,accepted:'true'},{...agreementInput,version:'old'},{...agreementInput,textHash:'forged'},{...agreementInput,acknowledgement:undefined},{...agreementInput,acknowledgement:'I agree to different terms'},{...agreementInput,fullName:'   '},{...agreementInput,fullName:'a'.repeat(161)}]) await assert.rejects(recordOriginalAgreement({...options,input}));
 assert.equal(acceptances.size,0);
 const saved=await recordOriginalAgreement({...options,input:agreementInput,now});
 assert.equal(saved.text,terms.text);assert.equal(saved.textHash,terms.textHash);assert.equal(saved.acceptedAt,now);assert.equal(saved.fullName,'Test Musician');
});
test('agreement evidence cannot be borrowed from a different person, project, role or contract type',async()=>{
 const saved=await acceptedFor();const binding={agreementAcceptanceId:saved._id,projectId,musicianId:player,roleName:'Bass'};
 for(const patch of [{musicianId:owner},{projectId:owner},{roleName:'Keys'},{type:'mix'}]) await assert.rejects(requireCurrentOriginalAgreement({...binding,...patch}),{code:'ORIGINALS_AGREEMENT_REQUIRED'});
 assert.equal((await requireCurrentOriginalAgreement(binding))._id,saved._id);
 saved.text+=' changed';await assert.rejects(requireCurrentOriginalAgreement(binding),{code:'ORIGINALS_AGREEMENT_REQUIRED'});
});
test('legacy or stale advance consent never auto-activates a recording clock',async t=>{
 const rows=slotStore(t);const saved=await acceptedFor();saved.version='old';
 futureSnapshot(t,[{_id:'legacy',musicianId:player,roleName:'Bass',projectId,state:'waiting'},{_id:'stale',musicianId:player,roleName:'Bass',projectId,state:'waiting',agreementAcceptanceId:saved._id}]);
 const claim=t.mock.method(Future,'findOneAndUpdate',()=>assert.fail('cannot activate unsigned terms'));
 await activateOriginalRoleReservations({project,round,now});assert.equal(rows.length,0);assert.equal(claim.mock.callCount(),0);
 assert.equal(Notification.updateOne.mock.callCount(),2);assert.equal(Notification.updateOne.mock.calls[0].arguments[1].$setOnInsert.template,'originals_reservation_agreement_review');
});
test('mix and master rounds require their own current agreement',async t=>{
 const rows=slotStore(t);const contributor=await acceptedFor(player,'Mix');const productionRound={...round,type:'mix',roleName:'Mix'};
 await assert.rejects(createRecordingReservation({round:productionRound,musicianId:player,roleName:'Mix',agreementAcceptanceId:contributor._id,now}),{code:'ORIGINALS_AGREEMENT_REQUIRED'});
 const mix=await acceptedFor(player,'Mix','mix');const result=await createRecordingReservation({round:productionRound,musicianId:player,roleName:'Mix',agreementAcceptanceId:mix._id,now});assert.equal(result.reservation.agreementAcceptanceId,mix._id);assert.equal(rows.length,1);
});

test('a waiting musician can accept renewed terms without erasing earlier evidence or starting an unrelated round',async t=>{
 const { renewFutureOriginalAgreement }=await import('../controllers/originalsReservationsController.js');
 const old=await acceptedFor();old.version='old';const waiting={_id:'future',projectId,musicianId:player,roleName:'Bass',state:'waiting',agreementAcceptanceId:old._id};
 t.mock.method(Future,'findOne',query=>({lean:async()=>{assert.equal(query.musicianId,player);assert.equal(query.projectId,projectId);assert.equal(query.state,'waiting');return waiting;}}));
 t.mock.method(Future,'findOneAndUpdate',(query,update)=>({lean:async()=>{assert.equal(query.state,'waiting');Object.assign(waiting,update.$set);return waiting;}}));
 t.mock.method(Project,'findById',()=>({lean:async()=>project}));t.mock.method(Round,'findById',()=>({lean:async()=>({...round,roleName:'Vocal'})}));t.mock.method(Future,'find',()=>({sort:()=>({lean:async()=>[]})}));
 const clock=t.mock.method(Round,'findOneAndUpdate',()=>assert.fail('no matching round may start'));
 const res=response();await renewFutureOriginalAgreement({params:{id:projectId,futureId:'future'},user:{id:player},body:{agreement:agreementInput}},res);
 assert.equal(res.code,200);assert.equal(acceptances.size,2);assert.equal(acceptances.get(old._id).version,'old');assert.notEqual(waiting.agreementAcceptanceId,old._id);assert.equal(waiting.agreementVersion,terms.version);assert.equal(clock.mock.callCount(),0);
});

test('agreement review email tells a waiting musician the round is open without claiming a countdown has started',async t=>{
 const waiting={_id:'future',projectId,musicianId:player,roleName:'Bass',state:'waiting'};
 t.mock.method(Future,'distinct',async()=>[]);futureSnapshot(t,[waiting]);t.mock.method(Future,'findById',()=>({lean:async()=>waiting}));
 t.mock.method(Reservation,'find',()=>({limit:()=>({lean:async()=>[]}),select:()=>({lean:async()=>[]})}));t.mock.method(Submission,'find',()=>({select:()=>({lean:async()=>[]})}));
 t.mock.method(Project,'findById',()=>({lean:async()=>project}));t.mock.method(Round,'findById',()=>({lean:async()=>round}));t.mock.method(Musician,'findById',()=>({select:()=>({lean:async()=>({email:'test@example.test',firstName:'Test'})})}));
 let once=false;t.mock.method(Notification,'findOneAndUpdate',()=>({lean:async()=>once?null:(once=true,{_id:'review-job',projectId,recipientMusicianId:player,template:'originals_reservation_agreement_review',payload:{futureId:'future',roundId:round._id,textHash:terms.textHash},attempts:1})}));
 let state,mail;t.mock.method(Notification,'updateOne',async(_query,update)=>{state=update.$set.state;});
 await runOriginalRoundNotifications({emailSender:async message=>{mail=message;return{ok:true};},now});assert.equal(state,'sent');assert.match(mail.text,/countdown has not started/);assert.match(mail.text,/review and accept/i);assert.equal(mail.to,'test@example.test');
});

test('interrupted advance linkage recovers an existing timed reservation without inventing agreement evidence',async t=>{
 const existing={_id:'old-booking',projectId,roundId:round._id,musicianId:player,roleName:'Bass',futureReservationId:'future',state:'active'};
 slotStore(t,[existing]);futureSnapshot(t,[{_id:'future',projectId,musicianId:player,roleName:'Bass',state:'activated',activeReservationId:null}]);
 let linked;t.mock.method(Future,'updateOne',async(_query,update)=>{linked=update.$set;});
 await activateOriginalRoleReservations({project,round,now});assert.deepEqual(linked,{activeReservationId:'old-booking'});assert.equal(acceptances.size,0);assert.equal(existing.agreementAcceptanceId,undefined);
});

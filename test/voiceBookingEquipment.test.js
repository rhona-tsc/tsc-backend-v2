import test from 'node:test';
import assert from 'node:assert/strict';
import {createBookingEquipmentLookup,resolveBookingSuppliers,parseEquipmentRows,normalizeEquipmentLookup,EQUIPMENT_SUPPLIERS,BOOKING_EQUIPMENT_FIELDS} from '../services/voiceBookingEquipment.js';
import {createEnquiryToolHandler} from '../services/incomingEnquiryAssistant.js';
const ewan='6a05f1a00358e40a87adb33d',james='69b966887ff9abd751f949bd',michael='69b9668e7ff9abd751f94d24';
const criteria={bookingReference:'EXAMPLE-BOOKING',eventDateISO:'2027-06-05'};
const member=(id,status,duties)=>({musicianId:id,name:'PRIVATE ALIAS',status,duties,email:'PRIVATE EMAIL',phone:'PRIVATE PHONE',fee:999});
const row={bookingRef:'EXAMPLE-BOOKING',eventDateISO:'2027-06-05',actName:'Example band',bookingStatus:'active',assignedMusicians:[member(ewan,'accepted',['PA provision','Lighting provision','Sound engineering']),member('111111111111111111111111','accepted',['Lead Vocal'])],clientEmail:'PRIVATE',grossValue:999};
const profileRead=async p=>({status:'reference_only',readAt:'2026-11-11T12:00:00Z',items:{audio:[{quantity:2,description:'PA speakers'}],lighting:[{quantity:6,description:'Uplighters'}]}});

test('lookup refuses untrusted caller claims before reading a booking or equipment',async()=>{
 const result=await createBookingEquipmentLookup({...criteria,trustedTestOperator:true},{loadBookings:()=>assert.fail(),readEquipmentProfile:()=>assert.fail()});
 assert.equal(result.available,false);
 const handle=createEnquiryToolHandler({trustedTestOperator:false,lookupBookingEquipment:()=>assert.fail()});
 assert.equal((await handle({callId:'untrusted',name:'lookup_booking_equipment',arguments:{...criteria,trustedTestOperator:true}})).available,false);
});
test('accepted explicit duties resolve each provision separately and capabilities/sound engineering/attendance never imply supply',()=>{
 const result=resolveBookingSuppliers({...row,assignedMusicians:[member(ewan,'accepted',['Sound engineering']),member(james,'provisional',['PA provision']),member(michael,'confirmed',['Lighting provision'])]});
 assert.equal(result.pa.status,'unconfirmed');assert.equal(result.lighting.status,'confirmed');assert.equal(result.lighting.suppliers[0].name,'Michael Mayor');
 const mirrored=resolveBookingSuppliers({...row,assignedMusicians:[member(ewan,'withdrawn',['PA provision'])],bookingMusicians:[member(ewan,'confirmed',['PA provision','Lighting provision'])]});
 assert.equal(mirrored.pa.status,'unconfirmed');assert.equal(mirrored.lighting.status,'unconfirmed');
});
test('duplicate/conflicting provision assignments require review instead of silently choosing the first',()=>{
 const multiple=resolveBookingSuppliers({...row,assignedMusicians:[member(ewan,'accepted',['PA provision']),member(james,'confirmed',['PA provision'])]});assert.equal(multiple.pa.status,'needs_review');
 const conflicting=resolveBookingSuppliers({...row,assignedMusicians:[member(ewan,'accepted',['PA provision']),member(ewan,'withdrawn',['PA provision'])]});assert.equal(conflicting.pa.status,'needs_review');
 const dedup=resolveBookingSuppliers({...row,assignedMusicians:[member(ewan,'accepted',['PA provision']),member(ewan,'confirmed',['PA provision'])]});assert.equal(dedup.pa.suppliers.length,1);
});
test('one booking exposes only supplier names and reference items, not private roster/customer/payment fields or approved power',async()=>{
 let reads=0;const result=await createBookingEquipmentLookup(criteria,{trustedTestOperator:true,loadBookings:async()=>[row],readEquipmentProfile:async p=>{reads++;return profileRead(p);}});
 assert.equal(result.available,true);assert.equal(result.provisions.pa.suppliers[0].name,'Ewan McIntosh');assert.equal(reads,1);
 assert.equal(result.provisions.pa.suppliers[0].reference.items[0].description,'PA speakers');assert.equal(result.provisions.lighting.suppliers[0].reference.items[0].description,'Uplighters');
 assert.equal(result.equipmentConfirmedForBooking,false);assert.equal(result.powerRequirementsConfirmed,false);assert.equal(result.messagesSent,0);assert.equal(result.testMode,true);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|999|"musicianId"|"clientEmail"|"fee"|"grossValue"/);
 assert.doesNotMatch(BOOKING_EQUIPMENT_FIELDS,/email|phone|fee|payment/i);
});
test('missing/ambiguous/cancelled bookings do not read the sheet; act can disambiguate but duplicate acts remain blocked',async()=>{
 const options={trustedTestOperator:true,readEquipmentProfile:()=>assert.fail()};
 for(const rows of [[],[row,{...row,actName:'Another band'}],[{...row,bookingStatus:'cancelled'}]]) assert.equal((await createBookingEquipmentLookup(criteria,{...options,loadBookings:async()=>rows})).available,false);
 const result=await createBookingEquipmentLookup({...criteria,actName:'Another band'},{...options,readEquipmentProfile:profileRead,loadBookings:async()=>[row,{...row,actName:'Another band'}]});assert.equal(result.actName,'Another band');
 for(const change of [{bookingReference:''},{eventDateISO:'2027-02-30'},{eventDateISO:''}]) assert.throws(()=>normalizeEquipmentLookup({...criteria,...change}));
});
test('unknown suppliers and failed/disconnected sheet reads stay explicit; power cells and historical headers never reach the model',async()=>{
 const unavailable=await createBookingEquipmentLookup(criteria,{trustedTestOperator:true,loadBookings:async()=>[row],readEquipmentProfile:async()=>{throw new Error('PRIVATE TOKEN');}});
 assert.equal(unavailable.provisions.pa.status,'confirmed');assert.equal(unavailable.provisions.pa.suppliers[0].reference.status,'unavailable');assert.doesNotMatch(JSON.stringify(unavailable),/PRIVATE TOKEN/);
 const unknown=await createBookingEquipmentLookup(criteria,{trustedTestOperator:true,loadBookings:async()=>[{...row,assignedMusicians:[member('222222222222222222222222','accepted',['PA provision'])]}],readEquipmentProfile:()=>assert.fail()});assert.equal(unknown.provisions.pa.suppliers[0].reference.status,'no_profile');
 const parsed=parseEquipmentRows([['Event','PRIVATE CLIENT'],['AUDIO'],['Quantity','Description','Watts'],['2','PA speakers','1400','2800','79','79'],['1','Contingency','500'],['LIGHTING'],['1','GigBAR','79','79','79','79'],['','TOTAL','PRIVATE']]);
 assert.deepEqual(parsed,{audio:[{quantity:2,description:'PA speakers'}],lighting:[{quantity:1,description:'GigBAR'}]});assert.doesNotMatch(JSON.stringify(parsed),/PRIVATE|Watts|1400|2800|79|Contingency/);
 assert.deepEqual(Object.values(EQUIPMENT_SUPPLIERS).map(p=>p.tab),['James Gordon','Ewan','Michael']);
});

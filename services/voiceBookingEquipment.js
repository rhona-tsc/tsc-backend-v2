// Booking-specific supplier resolution. Reads explicit accepted duties, never catalogue capabilities.
export const EQUIPMENT_SUPPLIERS = Object.freeze({
  '69b966887ff9abd751f949bd': { name: 'James Gordon', tab: 'James Gordon', range: "'James Gordon'!A9:F32" },
  '6a05f1a00358e40a87adb33d': { name: 'Ewan McIntosh', tab: 'Ewan', range: "'Ewan'!A2:F25" },
  '69b9668e7ff9abd751f94d24': { name: 'Michael Mayor', tab: 'Michael', range: "'Michael'!A5:F29" },
});
export const EQUIPMENT_SHEET_ID = '1Qf4lu82r8T_A_r3CX8Nrs4aOQYTLu9j0_7bpf8dtoSA';
export const BOOKING_EQUIPMENT_FIELDS = '_id bookingRef bookingId sourceBookingId eventDateISO actName actTscName bookingStatus assignedMusicians.musicianId assignedMusicians.name assignedMusicians.firstName assignedMusicians.lastName assignedMusicians.role assignedMusicians.instrument assignedMusicians.duties assignedMusicians.status assignedMusicians.roleSlotId bookingMusicians.musicianId bookingMusicians.name bookingMusicians.firstName bookingMusicians.lastName bookingMusicians.role bookingMusicians.instrument bookingMusicians.duties bookingMusicians.status bookingMusicians.roleSlotId bandLineup.musicianId bandLineup.name bandLineup.firstName bandLineup.lastName bandLineup.role bandLineup.instrument bandLineup.duties bandLineup.status bandLineup.roleSlotId';
const clean = (value, max=160) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max) : '';
const normalize = value => clean(value).toLowerCase().replace(/\s+/g,' ');
export function normalizeEquipmentLookup(input={}) {
  const bookingReference=clean(input.bookingReference,100);
  const eventDateISO=clean(input.eventDateISO,10);
  const date=new Date(`${eventDateISO}T12:00:00Z`);
  if(!bookingReference || input.bookingReference.length>100) throw new Error('Ask for the exact booking reference.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(eventDateISO) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==eventDateISO) throw new Error('Ask for the event date including the year.');
  return {bookingReference,eventDateISO,actName:clean(input.actName)};
}
export function parseEquipmentRows(values=[]) {
  const items={audio:[],lighting:[]}; let section='';
  for(const row of values.slice(0,50)) {
    const label=normalize(row?.[0]);
    if(label==='audio' || label==='lighting') {section=label;continue;}
    const quantity=Number(row?.[0]); const description=clean(row?.[1]);
    if(!section || !Number.isInteger(quantity) || quantity<1 || quantity>50 || !description || /^contingency$/i.test(description)) continue;
    // Watts/amps, formulas, historical client headers and unrelated cells never leave this parser.
    items[section].push({quantity,description});
  }
  return items;
}
export function resolveBookingSuppliers(row) {
  const rosterSource=['assignedMusicians','bookingMusicians','bandLineup'].find(field=>Array.isArray(row?.[field]) && row[field].length);
  const roster=rosterSource ? row[rosterSource] : [];
  const accepted=new Set(['accepted','confirmed']);
  return Object.fromEntries([['pa','pa provision'],['lighting','lighting provision']].map(([key,duty])=>{
    const entries=roster.filter(member=>(member.duties||[]).some(item=>normalize(item)===duty));
    const suppliers=new Map(); let conflict=false;
    for(const member of entries.filter(item=>accepted.has(normalize(item.status)))) {
      const id=String(member.musicianId||'');
      const rawName=clean(member.name)||clean([member.firstName,member.lastName].filter(Boolean).join(' '));
      const name=/@|(?:\+?\d[\d ()-]{7,})|^[a-f\d]{24}$/i.test(rawName)?'Assigned supplier':rawName;
      if(!id) {conflict=true;continue;}
      if(entries.some(other=>String(other.musicianId||'')===id && !accepted.has(normalize(other.status)))) conflict=true;
      suppliers.set(id,{musicianId:id,name:EQUIPMENT_SUPPLIERS[id]?.name||name||'Assigned supplier',assignmentStatus:normalize(member.status)});
    }
    return [key,{status:conflict || suppliers.size>1?'needs_review':suppliers.size===1?'confirmed':'unconfirmed',rosterSource:rosterSource||null,
      suppliers:[...suppliers.values()],reason:conflict?'Conflicting or incomplete supplier assignments.':suppliers.size>1?'More than one supplier has this confirmed duty; management must confirm the arrangement.':suppliers.size?null:'No accepted or confirmed assignment explicitly includes this provision duty.'}];
  }));
}
export async function createBookingEquipmentLookup(input,{trustedTestOperator=false,loadBookings,readEquipmentProfile}={}) {
  const base={testMode:true,readOnly:true,messagesSent:0,equipmentConfirmedForBooking:false,powerRequirementsConfirmed:false};
  if(trustedTestOperator!==true) return {...base,available:false,reason:'This booking lookup is available only to approved test callers or authorised management.'};
  const criteria=normalizeEquipmentLookup(input);
  const rows=await loadBookings(criteria);
  const matches=criteria.actName ? rows.filter(row=>[row.actName,row.actTscName].some(name=>normalize(name)===normalize(criteria.actName))) : rows;
  if(matches.length!==1) return {...base,available:false,reason:matches.length?'More than one booking matches. Confirm the act, or ask management to review duplicate records.':'No unique booking matches that reference, date and act.',
    ...(matches.length>1?{acts:[...new Set(matches.map(row=>clean(row.actName)||clean(row.actTscName)).filter(Boolean))].slice(0,6)}:{})};
  const row=matches[0];
  if(normalize(row.bookingStatus)==='cancelled') return {...base,available:false,reason:'This booking is cancelled; management must confirm any equipment arrangements.'};
  const resolved=resolveBookingSuppliers(row);
  const cache=new Map();
  const provisions={};
  for(const [kind,provision] of Object.entries(resolved)) {
    const suppliers=[];
    for(const supplier of provision.suppliers) {
      const profile=EQUIPMENT_SUPPLIERS[supplier.musicianId];
      let reference;
      if(provision.status!=='confirmed') reference={status:'needs_assignment_review',items:[]};
      else if(!profile) reference={status:'no_profile',items:[]};
      else {
        if(!cache.has(profile.tab)) cache.set(profile.tab,Promise.resolve().then(()=>readEquipmentProfile(profile)).catch(()=>({status:'unavailable',items:{audio:[],lighting:[]}})));
        const data=await cache.get(profile.tab);
        reference={status:data.status||'reference_only',sheetTab:profile.tab,readAt:data.readAt||null,
          items:data.items?.[kind==='pa'?'audio':'lighting']||[]};
      }
      suppliers.push({name:supplier.name,assignmentStatus:supplier.assignmentStatus,reference});
    }
    provisions[kind]={status:provision.status,reason:provision.reason,rosterSource:provision.rosterSource,suppliers};
  }
  return {...base,available:true,bookingReference:criteria.bookingReference,eventDateISO:criteria.eventDateISO,actName:clean(row.actName)||clean(row.actTscName),provisions,
    note:'The named supplier has accepted the explicit booking duty only when its status is confirmed. Sheet items are reference inventory, not a confirmed event kit list. Exact fixtures, quantities and power requirements still need supplier confirmation. Do not disclose personal contacts, fees or other roster members.'};
}

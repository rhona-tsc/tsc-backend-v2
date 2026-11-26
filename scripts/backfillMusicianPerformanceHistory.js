// Read-only calendar export in, derived relationship evidence out. No calendar
// writes, allocation changes, emails, invitations or booking automations.
import 'dotenv/config';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { buildHistoricalPerformances } from '../services/historicalMusicianPerformanceService.js';
import { publicMusician } from '../services/musicianConnectionsService.js';
const input = process.argv.find(arg=>arg.startsWith('--input='))?.slice(8);
if (!input) throw new Error('Provide --input=/absolute/path/to/calendar-export.json. Dry run unless --apply is present.');
await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
try {
 const db=mongoose.connection;
 const [profiles,board,core]=await Promise.all([
  db.collection('musicians').find({}).project({_id:1,musicianId:1,email:1,mergedIntoMusicianId:1,mergedProfileIds:1,mergedProfileEmails:1,mergedProfileContacts:1,status:1,profileDeletedAt:1,privateTestProfile:1,firstName:1,lastName:1,musicianSlug:1}).toArray(),
  db.collection('bookingboarditems').find({}).project({bookingRef:1,bookingId:1,sourceBookingId:1,calendarEventId:1,calendarId:1,eventDateISO:1,date:1,eventDate:1,status:1,bookingStatus:1,address:1,venueAddress:1,venue:1,clientName:1,clientFirstNames:1,eventTitle:1,assignedMusicians:1,bookingDetails:1,bookingMusicians:1,bandLineup:1}).toArray(),
  db.collection('bookings').find({}).project({bookingRef:1,bookingId:1,calendarEventId:1,calendarId:1,eventDateISO:1,date:1,eventDate:1,status:1,bookingStatus:1,address:1,venueAddress:1,venue:1,clientName:1,clientFirstNames:1,eventTitle:1,assignedMusicians:1,bookingDetails:1,bookingMusicians:1,bandLineup:1}).toArray(),
 ]);
 const events=JSON.parse(await fs.readFile(input,'utf8'));
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const {records,review,identity}=buildHistoricalPerformances({events,profiles,board,core,today});
 const publicIds=new Set(profiles.filter(publicMusician).map(m=>String(m._id)));
 const people=new Set(),pairs=new Set(),publicPairs=new Set(),byYear={};
 for(const r of records){byYear[r.eventDateISO.slice(0,4)]=(byYear[r.eventDateISO.slice(0,4)]||0)+1;for(const a of r.musicianIds){people.add(a);for(const b of r.musicianIds)if(a<b){pairs.add(`${a}:${b}`);if(publicIds.has(a)&&publicIds.has(b))publicPairs.add(`${a}:${b}`);}}}
 const koko=profiles.find(m=>m.musicianSlug==='koko-c');
 const kokoPeers=new Set(records.filter(r=>r.musicianIds.includes(String(koko?._id))).flatMap(r=>r.musicianIds).filter(id=>id!==String(koko?._id)&&publicIds.has(id)));
 const summary={eventsScanned:events.length,verifiedEventRecords:records.length,people:people.size,uniquePairs:pairs.size,publicPairs:publicPairs.size,byYear,kokoPublicPeers:kokoPeers.size,reviewItems:review.length,applied:process.argv.includes('--apply')};
 const report=process.argv.find(arg=>arg.startsWith('--report='))?.slice(9);
 if(report)await fs.writeFile(report,JSON.stringify({summary,review,records},null,2),{mode:0o600});
 if(process.argv.includes('--apply')){
  const collection=db.collection('musicianperformancehistories');
  await collection.createIndex({musicianIds:1,eventDateISO:1,status:1});
  const importedAt=new Date();
  if(records.length)await collection.bulkWrite(records.map(record=>({updateOne:{filter:{_id:record._id},update:{$set:{...record,importedAt},$setOnInsert:{createdAt:importedAt}},upsert:true}})),{ordered:false});
  // A re-read may remove someone or invalidate a gig. Supersede prior evidence
  // only for the precise calendar events in this import, never unrelated history.
  const byCalendar=new Map();for(const event of events){if(!byCalendar.has(event.calendarId))byCalendar.set(event.calendarId,[]);byCalendar.get(event.calendarId).push(event.id);}
  for(const [calendarId,eventIds] of byCalendar)await collection.updateMany({source:'calendar_history',sourceCalendarId:calendarId,sourceEventId:{$in:eventIds},importedAt:{$ne:importedAt}},{$set:{status:'superseded',reconciledAt:importedAt}});
 }
 console.log(JSON.stringify(summary,null,2));
}finally{await mongoose.disconnect();}

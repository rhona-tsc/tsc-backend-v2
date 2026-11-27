import mongoose from 'mongoose';
import {escapeEmailHtml as esc, buildTscEmailFooter, buildTscEmailFooterText} from '../utils/tscEmailBranding.js';
export function notificationBookingQuery(value) {
 const ref=String(value||'').trim();
 if(!ref)return null;
 return mongoose.isValidObjectId(ref)?{$or:[{bookingId:ref},{_id:ref}]}:{bookingId:ref};
}
export const validCatererEmail = value => typeof value==='string' && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value.trim());
const safeUrl = value => {try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
export const cateringServiceNotes = 'If possible, the band would prefer to eat before performing. Please allow 30 minutes for their meal. If the meal needs to take place during a performance break, the band may need to be fast-tracked. If food is initially served while the band is performing, please keep plates aside for them.';
export function cateringDisplayName(value = '') {
 const parts=String(value).trim().split(/\s+/).filter(Boolean);
 return parts.length > 1 ? `${parts[0]} ${parts.at(-1).charAt(0)}.` : (parts[0] || 'Band member');
}
const dateLabel = value => {const day=(value instanceof Date?value.toISOString():String(value||'')).slice(0,10);const date=new Date(day+'T12:00:00Z');return Number.isNaN(date.getTime())?'Date to be confirmed':date.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/London'});};
export function buildCateringMail({booking,roster,to,menu={},notes='',serviceNotes=cateringServiceNotes,toBand=false}) {
 const ref=booking.bookingId||String(booking._id);
 const answers=booking.eventSheet?.answers||{};
 const date=dateLabel(booking.eventDateISO||booking.eventDate||booking.date);
 const title=toBand?'Menu and catering arrangements':'Dietary requirements and service notes';
 const venue=booking.venueAddress||booking.address||booking.venue||'';
 const eventName=booking.clientName||booking.clientFirstNames||'';
 const rows=roster.map(m=>({name:cateringDisplayName(m.name),instrument:m.instrument,diet:m.dietaryRequirements||'To be confirmed'}));
 const paragraphs=[`Booking: ${eventName?eventName+' — ':''}${date}`,`Venue: ${venue}`,`Reference: ${ref}`];
 const menuUrl=safeUrl(menu.url),fileUrl=safeUrl(menu.fileUrl);
 const text=[title,...paragraphs,'',...rows.map(r=>`${r.name} (${r.instrument}): ${r.diet}`),'',serviceNotes&&`Service notes: ${serviceNotes}`,notes&&`Catering arrangements: ${notes}`,menuUrl&&`Menu: ${menuUrl}`,fileUrl&&`Uploaded menu: ${fileUrl}`,menu.text&&`Menu details:\n${menu.text}`,'','Warmest wishes,','The Supreme Collective',buildTscEmailFooterText()].filter(Boolean).join('\n');
 const content=`<p>Hello,</p><p>${esc(title)} for ${esc(eventName||'this booking')} on <strong>${esc(date)}</strong>.</p><p><strong>Venue:</strong> ${esc(venue)}<br/><strong>Booking reference:</strong> ${esc(ref)}</p><p>There are ${rows.length} confirmed band members:</p><table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr><th align="left">Name</th><th align="left">Instrument</th><th align="left">Dietary requirement</th></tr></thead><tbody>${rows.map(r=>`<tr><td style="padding:8px 4px;border-bottom:1px solid #ddd">${esc(r.name)}</td><td style="padding:8px 4px;border-bottom:1px solid #ddd">${esc(r.instrument)}</td><td style="padding:8px 4px;border-bottom:1px solid #ddd">${esc(r.diet)}</td></tr>`).join('')}</tbody></table>${serviceNotes?`<p><strong>Service notes:</strong> ${esc(serviceNotes)}</p>`:''}${notes?`<p><strong>Catering arrangements:</strong> ${esc(notes)}</p>`:''}${menuUrl?`<p><a href="${esc(menuUrl)}">View menu</a></p>`:''}${fileUrl?`<p><a href="${esc(fileUrl)}">Open uploaded menu</a></p>`:''}${menu.text?`<p><strong>Menu details:</strong></p><div style="white-space:pre-wrap">${esc(menu.text)}</div>`:''}<p>Warmest wishes,<br/>The Supreme Collective</p>`;
 const html=`<div style="background:#f3f4f6;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111"><div style="max-width:720px;margin:auto"><div style="background:#111;color:white;padding:22px;border-radius:20px 20px 0 0"><strong>THE SUPREME COLLECTIVE</strong><h1 style="font-size:22px">${esc(title)}</h1></div><div style="background:white;padding:24px;line-height:1.6">${content}${buildTscEmailFooter()}</div></div></div>`;
 return {to,cc:'hello@thesupremecollective.co.uk',replyTo:'hello@thesupremecollective.co.uk',subject:`${title} — ${eventName?eventName+' — ':''}${date} — ${ref}`,html,text};
}
export function createCateringHandlers({findBooking,loadRoster,mailer,loadMenuAttachments=async()=>[]}) {
 const handler = toBand => async(req,res)=>{
  try{
   const body=req.body||{};const query=notificationBookingQuery(body.bookingId);
   if(!query)return res.status(400).json({success:false,message:'Booking reference is required.'});
   const caterer=String(body.catererEmail||'').trim();
   if((!toBand||caterer)&&!validCatererEmail(caterer))return res.status(400).json({success:false,message:'Please enter a valid caterer email address.'});
   const booking=await findBooking(query);
   if(!booking)return res.status(404).json({success:false,message:'Booking not found. Please refresh the event sheet and try again.'});
   const roster=await loadRoster(booking);
   if(!roster.length)return res.status(400).json({success:false,message:'There are no confirmed band members to send dietary details for yet.'});
   const answers=booking.eventSheet?.answers||{};
   const to=toBand?[...new Set(roster.map(m=>m.email).filter(Boolean))]:caterer;
   if(toBand&&!to.length)return res.status(400).json({success:false,message:'No confirmed band email addresses are available.'});
   const menu=body.menu||{};
   const notes=String(body.notes??menu.notes??answers.dietary_notes??'');
   const serviceNotes=cateringServiceNotes;
   const mail=buildCateringMail({booking,roster,to,menu,notes,serviceNotes,toBand});
   mail.attachments=await loadMenuAttachments(menu.fileUrl);
   if(toBand&&caterer)mail.cc=[caterer,'hello@thesupremecollective.co.uk'];
   const result=await mailer(mail);
   const accepted=(result?.accepted||[]).map(s=>String(s).toLowerCase());
   if(!result?.ok||(!toBand&&accepted.length&&!accepted.includes(caterer.toLowerCase())))return res.status(502).json({success:false,message:'The email could not be delivered. Please try again shortly.'});
   return res.json({success:true,messageId:result.messageId||''});
  }catch(error){console.error('Event-sheet catering email failed:',error.message);return res.status(500).json({success:false,message:'The email could not be sent. Please try again shortly.'});}
 };
 return {sendDietaryToCaterer:handler(false),sendMenuToBand:handler(true)};
}

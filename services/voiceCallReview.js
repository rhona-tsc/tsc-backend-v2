import { saveVoiceDraft } from './voiceEnquiryStore.js';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import EnquiryBoardItem from '../models/enquiryBoardItem.js';
import { getSmtpConfig } from '../utils/getTransporter.js';
import { lookupVoiceCallSlots } from './voiceAppointments.js';

export const VOICE_MANAGEMENT_EMAIL = 'hello@thesupremecollective.co.uk';
export const voiceCallRef = sid => `PHONE-${crypto.createHash('sha256').update(sid).digest('hex').slice(0, 12).toUpperCase()}`;
const calls = () => mongoose.connection.db.collection('voice_call_reviews');
const clean = (text, max = 6000) => typeof text === 'string' ? text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : '';
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(value) ? value : '';

export async function voiceFollowupReadiness() {
  const config = getSmtpConfig();
  const mail = async () => { try { await nodemailer.createTransport({ host: config.host, port: config.port, secure: config.port === 465, auth: { user: config.user, pass: config.pass }, connectionTimeout: 5000, socketTimeout: 6000 }).verify(); return 'ready'; } catch { return 'needs_attention'; } };
  const calendar = async () => { try { const date = new Date(); date.setUTCDate(date.getUTCDate()+((8-date.getUTCDay())%7 || 7)); await lookupVoiceCallSlots({dateISO:date.toISOString().slice(0,10)}); return 'ready'; } catch { return 'needs_attention'; } };
  const [managementEmail, callbackCalendar] = await Promise.all([mail(),calendar()]);
  return { managementEmail, callbackCalendar, venueSearchConfigured: !!process.env.GOOGLE_MAPS_API_KEY, recipient: VOICE_MANAGEMENT_EMAIL, testMode: true };
}

export function createCallTranscript({ persist, now = () => new Date() }) {
  const items = new Map(); let sequence = 0, failed = false, limited = false, closed = false;
  const itemFor = id => {
    if (!safeId(id)) return null;
    if (!items.has(id)) { if (items.size >= 240) { limited = true; return null; } items.set(id, { itemId: id, sequence: ++sequence, capturedAt: now().toISOString(), role: '', text: '', content: {}, previousItemId: '' }); }
    return items.get(id);
  };
  let queue = Promise.resolve();
  const snapshot = () => {
    const visiting = new Set(), visited = new Set();
    // Build a stable order from committed item links: transcription completion can arrive late.
    const output = [];
    const append = item => { if (visited.has(item.itemId) || visiting.has(item.itemId)) return; visiting.add(item.itemId); const previous = items.get(item.previousItemId); if (previous) append(previous); visiting.delete(item.itemId); visited.add(item.itemId); if (item.role && (item.text || item.transcriptionFailed || item.role === 'user')) { const { content, ...entry } = item; output.push({ ...entry, transcriptionPending: item.role === 'user' && !item.text && !item.transcriptionFailed }); } };
    [...items.values()].sort((a,b) => a.sequence-b.sequence).forEach(append);
    return { turns: output, transcriptLimited: limited, transcriptHasGaps: failed || output.some(item => item.transcriptionFailed || item.transcriptionPending || item.recognitionSuspect), transcriptNotice: 'Machine transcript; may contain recognition errors. Interrupted assistant speech may include generated words the caller did not hear.' };
  };
  return {
    accept(event) {
      if (closed) return;
      let item;
      if (['conversation.item.added', 'conversation.item.created', 'response.output_item.added'].includes(event.type)) {
        item = itemFor(event.item?.id); if (!item) return;
        if (['user', 'assistant'].includes(event.item.role)) item.role = event.item.role;
        if (safeId(event.previous_item_id)) item.previousItemId = event.previous_item_id;
      } else if (event.type === 'input_audio_buffer.committed') { item = itemFor(event.item_id); if (!item) return; item.role = 'user'; item.previousItemId = safeId(event.previous_item_id); }
      else if (['conversation.item.input_audio_transcription.completed', 'response.output_audio_transcript.done'].includes(event.type)) {
        item = itemFor(event.item_id); if (!item) return;
        item.role = event.type.startsWith('conversation.') ? 'user' : 'assistant';
        item.content[Math.max(0, Math.min(10, Number(event.content_index) || 0))] = clean(event.transcript);
        item.text = Object.keys(item.content).sort((a,b)=>a-b).map(key=>item.content[key]).join('\n').slice(0, 12000);
        item.recognitionSuspect = item.role === 'user' && /UK venue names, band names, full postcodes/i.test(item.text);
      } else if (event.type === 'conversation.item.input_audio_transcription.failed') { item = itemFor(event.item_id); if (!item) return; item.role = 'user'; item.transcriptionFailed = true; }
      else if (event.type === 'conversation.item.truncated') { item = itemFor(event.item_id); if (!item) return; item.interrupted = true; }
      else return;
      const data = snapshot();
      queue = queue.then(() => persist(data)).catch(() => { failed = true; });
    },
    async flush() { closed = true; await queue; try { await persist(snapshot()); } catch { failed = true; } return snapshot(); },
    snapshot,
  };
}

export async function startVoiceCallReview({ callSid, caller, intent }) {
  if (!/^CA[a-f\d]{32}$/i.test(callSid)) throw new Error('Invalid call reference.');
  await saveVoiceDraft(callSid, {});
  await calls().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await calls().updateOne({ _id: voiceCallRef(callSid) }, { $setOnInsert: { callSid, caller, intent, startedAt: new Date(), status: 'connecting', testMode: true, turns: [], expiresAt: new Date(Date.now()+90*86400000), notificationStatus: 'pending' } }, { upsert: true });
}
export function createStoredCallTranscript(callSid) {
  return createCallTranscript({ persist: data => calls().updateOne({ _id: voiceCallRef(callSid) }, { $set: { ...data, transcriptCount: data.turns.length, status: 'in_progress', updatedAt: new Date() } }) });
}

export function managementCallEmail(call, enquiry) {
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(call.startedAt);
  const lines = [
    'AI PHONE PILOT TEST — no musician or customer messages were sent.', `Call: ${date} UK time`, `Reference: ${call._id}`, `Status: ${call.status}`,
    enquiry?.captureState === 'draft' ? 'UNCONFIRMED DRAFT — details may be incomplete or misheard; review the transcript and confirm before following up.' : '',
    enquiry ? `Name: ${enquiry.clientName || 'Not captured'}\nPhone: ${enquiry.clientPhone || 'Not captured'}\nEmail: ${enquiry.clientEmail || 'Not supplied'}\nPreferred follow-up: ${enquiry.preferredContactMethod || 'Not specified'}\nEvent: ${enquiry.eventDateISO || 'Not captured'}\nVenue: ${enquiry.address || 'Not captured'}\nCounty: ${enquiry.county || 'Needs confirmation'}\nPostcode: ${enquiry.postcode || 'Needs confirmation'}\nBudget: ${enquiry.maxBudget ? `£${enquiry.maxBudget}` : 'Not supplied'}\nHopes to book: ${enquiry.decisionWindow || 'Not supplied'}\nSelected bands: ${(enquiry.selectedBands || []).map(item=>item.name).join(', ') || 'None selected'}\nAvailability previews: ${enquiry.availabilityRequestTest?.requests?.length || 0}; 0 sent\nCallback appointment: ${enquiry.callAppointment?.label || 'None'}${enquiry.callAppointment ? ' (test proposal; not booked)' : ''}\n\n${enquiry.notes || ''}` : 'No confirmed enquiry was saved. Review the transcript for incomplete details.',
    enquiry?.voicePriceEstimates?.length ? `Website estimates checked (not bookings):\n${enquiry.voicePriceEstimates.map(quote=>`${quote.bandName}, ${quote.performerCount}-piece, ${quote.county}, ${quote.eventDateISO}: £${quote.priceGBP}, calculated travel included`).join('\n')}` : '',
    `Transcript: ${call.turns?.length || 0} turns${call.transcriptHasGaps ? '; capture gaps need review' : ''}${call.transcriptLimited ? '; capture limit reached' : ''}.`,
    'Review the call and all prepared band requests before contacting the client:', `https://admin.thesupremecollective.co.uk/enquiry-board?callReview=${call._id}`,
    'No live availability replies are expected in test mode. A prepared preview is not a sent request or a confirmed band.',
  ];
  return { to: VOICE_MANAGEMENT_EMAIL, subject: `[AI test call] ${enquiry?.captureState === 'draft' ? 'Draft enquiry — ' : ''}${enquiry?.clientName || 'Incomplete enquiry'} — ${call._id}`, text: lines.join('\n\n') };
}
export async function finishVoiceCallReview(callSid, { status = 'completed', sendMail } = {}) {
  const id = voiceCallRef(callSid);
  await calls().updateOne({ _id: id }, { $set: { status, endedAt: new Date() } });
  const claimed = await calls().findOneAndUpdate({ _id: id, notificationStatus: 'pending' }, { $set: { notificationStatus: 'sending' } }, { returnDocument: 'after', includeResultMetadata: false });
  if (!claimed) return;
  try {
    const enquiry = await EnquiryBoardItem.findOne({ websiteKey: `phone:${callSid}` }).lean();
    const config = getSmtpConfig();
    const send = sendMail || (mail => nodemailer.createTransport({ host: config.host, port: config.port, secure: config.port === 465, auth: { user: config.user, pass: config.pass }, connectionTimeout: 6000, socketTimeout: 10000 }).sendMail({ ...mail, from: config.from }));
    await send(managementCallEmail(claimed, enquiry));
    await calls().updateOne({ _id: id }, { $set: { notificationStatus: 'sent', notifiedAt: new Date() } });
  } catch { await calls().updateOne({ _id: id }, { $set: { notificationStatus: 'needs_review' } }); }
}

export async function listVoiceCallReviews() {
  const reviews = await calls().find({ expiresAt: { $gt: new Date() } }, { projection: { callSid: 0, caller: 0, turns: 0 } }).sort({ startedAt: -1 }).limit(30).toArray();
  const old = await EnquiryBoardItem.find({ marketingSource: 'Phone — AI pilot test', enquiryRef: { $nin: reviews.map(item => item._id) } }).select('enquiryRef clientName createdAt').sort({ createdAt: -1 }).limit(10).lean();
  return [...reviews, ...old.map(item => ({ _id: item.enquiryRef, clientName: item.clientName, startedAt: item.createdAt, status: 'no_transcript', transcriptCount: 0 }))].sort((a,b)=>+new Date(b.startedAt)-+new Date(a.startedAt)).slice(0,30);
}
export async function readVoiceCallReview(ref) {
  if (!/^PHONE-[A-F\d]{12}$/.test(ref || '')) return null;
  const call = await calls().findOne({ _id: ref, expiresAt: { $gt: new Date() } }, { projection: { callSid: 0, caller: 0 } });
  const enquiry = await EnquiryBoardItem.findOne({ enquiryRef: ref, marketingSource: 'Phone — AI pilot test' }).select('enquiryRef clientName clientEmail clientPhone eventDateISO address county postcode venueConfirmation preferredContactMethod decisionWindow styles preferredSize maxBudget selectedBands availabilityRequestTest callAppointment captureState draftDetails voicePriceEstimates notes createdAt').lean();
  if (!call && !enquiry) return null;
  const result = { ...(call || { _id: ref, startedAt: enquiry?.createdAt, status: 'no_transcript', turns: [] }), enquiry };
  result.turns = (result.turns || []).map(turn=>({...turn,recognitionSuspect:!!turn.recognitionSuspect || turn.role==='user' && /UK venue names, band names, full postcodes/i.test(turn.text)}));
  result.transcriptHasGaps = !!result.transcriptHasGaps || result.turns.some(turn=>turn.recognitionSuspect);
  return result;
}

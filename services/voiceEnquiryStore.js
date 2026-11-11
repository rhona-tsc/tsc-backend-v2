import { lookupVoiceLineupPrice } from './voiceLineupPricing.js';
import { lookupVoiceVenueHistory } from './voiceVenueHistory.js';
import { lookupVoiceVenues } from './voiceVenueLookup.js';
import { lookupVoiceCallSlots } from './voiceAppointments.js';
import { lookupVoiceBookingEquipment } from './voiceBookingEquipmentStore.js';
import { lookupVoicePublicJobs } from './voicePublicJobs.js';
import Act from '../models/actModel.js';
import EnquiryBoardItem from '../models/enquiryBoardItem.js';
import { matchVoiceBands } from './voiceBandMatching.js';
import { prepareVoiceAvailabilityBatch, voicePreviewSnapshot, voicePreviewKey } from './availabilityRequestTestPreview.js';
import { VoiceEnquiryValidationError } from './incomingEnquiryAssistant.js';
import { createEnquiryToolHandler, buildVoiceBoardRecord } from './incomingEnquiryAssistant.js';

// Never load musician names, contacts, fees, availability or customer records for search.
export const VOICE_CATALOGUE_FIELDS = '_id tscName slug status isTest genre genres lineups._id lineups.lineupId lineups.actSize lineups.bandMembers.instrument';

export async function lookupVoiceBands(criteria, selection) {
  const acts = await Act.find({ status: { $in: ['approved', 'live', 'approved_changes_pending', 'live_changes_pending'] }, isTest: { $ne: true } })
    .select(VOICE_CATALOGUE_FIELDS).limit(500).maxTimeMS(4000).lean();
  return matchVoiceBands(acts, criteria, selection);
}

export async function saveVoiceDraft(callId, draft = {}, { Model = EnquiryBoardItem, now = new Date() } = {}) {
  const ref = buildVoiceBoardRecord(callId, {}, now).enquiryRef;
  const notes = ['[AI PHONE PILOT TEST — UNCONFIRMED DRAFT; not a qualified enquiry or advertising conversion]',
    'Call details saved so far. Confirm every detail before contacting the client or requesting bands.',
    draft.clientName && `Caller-supplied name: ${draft.clientName}`, draft.clientPhone && `Unconfirmed callback: ${draft.clientPhone}`,
    draft.clientEmail && `Unconfirmed email: ${draft.clientEmail}`, draft.requirements && `Requirements: ${draft.requirements}`,
    draft.address && `Venue as supplied (unconfirmed): ${draft.address}`, draft.preferredBands && `Bands mentioned (not confirmed selections): ${draft.preferredBands}`,
    draft.callbackReason && `Callback reason: ${draft.callbackReason}`, draft.contactDeclined && 'Caller declined contact details.',
  ].filter(Boolean).join('\n');
  try {
    return await Model.findOneAndUpdate({ websiteKey: `phone:${callId}`, captureState: { $ne: 'confirmed' } }, {
      $setOnInsert: { websiteKey: `phone:${callId}`, enquiryRef: ref, enquiryDateISO: now.toISOString().slice(0,10), agent: 'Direct', status: 'open' },
      $set: { ...draft, marketingSource: 'Phone — AI pilot test', captureState: 'draft', contactConfirmed: false, emailConfirmed: false, notes,
        draftDetails: { fields: draft, unconfirmed: true, updatedAt: now.toISOString(), contactDeclined: !!draft.contactDeclined, qualified: false, availabilityRequestsSent: 0 } },
    }, { upsert: true, new: true, runValidators: true });
  } catch (error) {
    if(error.code !== 11000) throw error;
    const confirmed = await Model.findOne({ websiteKey: `phone:${callId}`, captureState:'confirmed' });
    if(!confirmed) throw error; return confirmed;
  }
}

export async function saveVoiceBoardRecord(record) {
  const { status, ...details } = record;
  details.marketingSource = 'Phone — AI pilot test';
  details.notes = `[AI PHONE PILOT TEST — not a real advertising conversion]\n${details.notes}`;
  return EnquiryBoardItem.findOneAndUpdate({ websiteKey: record.websiteKey }, {
    $set: details, $setOnInsert: { status }, $unset: { draftDetails: 1, availabilityRequestTest: 1, callAppointment: 1, ...(!record.venueConfirmation ? { venueConfirmation: 1 } : {}) },
  }, { upsert: true, new: true, runValidators: true });
}

export async function prepareVoiceAvailability(record) {
  const stored = await EnquiryBoardItem.findOne({ websiteKey: record.websiteKey }).lean();
  if (!stored || stored.enquiryRef !== record.enquiryRef || voicePreviewSnapshot(stored) !== voicePreviewSnapshot(record)) throw new VoiceEnquiryValidationError('The enquiry details changed. Read back and save the current details and band choices again.');
  const key = voicePreviewKey(record);

  const { triggerAvailabilityRequest } = await import('../controllers/availabilityController.js');
  const preview = await prepareVoiceAvailabilityBatch(record, { lookupBands: lookupVoiceBands, trigger: triggerAvailabilityRequest });
  if (stored.availabilityRequestTest?.key === key) preview.preparedAt = stored.availabilityRequestTest.preparedAt;
  const updated = await EnquiryBoardItem.findOneAndUpdate({ _id: stored._id, updatedAt: stored.updatedAt },
    { $set: { availabilityRequestTest: preview } }, { new: true, runValidators: true });
  if (!updated) throw new VoiceEnquiryValidationError('The enquiry changed while preparing the preview. Confirm and save the latest details again.');
  return preview;
}

export const createVoiceEnquiryTools = ({ trustedTestCaller = false } = {}) => createEnquiryToolHandler({ enforceBookingFlow: true, saveDraft: saveVoiceDraft, lookupPrice: lookupVoiceLineupPrice, lookupVenueHistory: lookupVoiceVenueHistory, savePriceEstimates: (callId, quotes) => EnquiryBoardItem.updateOne({websiteKey:`phone:${callId}`},{$set:{voicePriceEstimates:quotes}}), trustedTestOperator: trustedTestCaller === true, lookupVenues: lookupVoiceVenues, lookupCallSlots: lookupVoiceCallSlots, prepareAppointment: async (record, appointment) => { const saved = await EnquiryBoardItem.updateOne({ websiteKey: record.websiteKey, clientPhone: record.clientPhone, clientEmail: record.clientEmail }, { $set: { callAppointment: appointment } }); if (!saved.matchedCount) throw new VoiceEnquiryValidationError('The enquiry details changed. Save and confirm the latest contact details again.'); }, lookupBookingEquipment: lookupVoiceBookingEquipment, lookupBands: lookupVoiceBands, lookupJobs: lookupVoicePublicJobs, saveBoardRecord: saveVoiceBoardRecord, prepareAvailability: prepareVoiceAvailability });

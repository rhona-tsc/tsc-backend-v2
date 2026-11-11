import Act from '../models/actModel.js';
import EnquiryBoardItem from '../models/enquiryBoardItem.js';
import { matchVoiceBands } from './voiceBandMatching.js';
import { createEnquiryToolHandler } from './incomingEnquiryAssistant.js';

// Never load musician names, contacts, fees, availability or customer records for search.
export const VOICE_CATALOGUE_FIELDS = '_id tscName slug status isTest genre genres lineups._id lineups.lineupId lineups.actSize lineups.bandMembers.instrument';

export async function lookupVoiceBands(criteria, selection) {
  const acts = await Act.find({ status: { $in: ['approved', 'live', 'approved_changes_pending', 'live_changes_pending'] }, isTest: { $ne: true } })
    .select(VOICE_CATALOGUE_FIELDS).limit(500).maxTimeMS(4000).lean();
  return matchVoiceBands(acts, criteria, selection);
}

export async function saveVoiceBoardRecord(record) {
  const { status, ...details } = record;
  details.marketingSource = 'Phone — AI pilot test';
  details.notes = `[AI PHONE PILOT TEST — not a real advertising conversion]\n${details.notes}`;
  return EnquiryBoardItem.findOneAndUpdate({ websiteKey: record.websiteKey }, {
    $set: details, $setOnInsert: { status },
  }, { upsert: true, new: true, runValidators: true });
}

export const createVoiceEnquiryTools = () => createEnquiryToolHandler({ lookupBands: lookupVoiceBands, saveBoardRecord: saveVoiceBoardRecord });

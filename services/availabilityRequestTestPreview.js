import crypto from 'node:crypto';
import { sortedVocalContacts } from '../utils/enquiryAvailability.js';

const clean = value => String(value || '').trim();
export const VOICE_PREVIEW_FIELDS = ['clientName', 'clientEmail', 'clientPhone', 'eventDateISO', 'address', 'styleMatch', 'styles', 'preferredSize', 'mustHaveInstruments', 'selectedBands'];
export function voicePreviewSnapshot(record) {
  return JSON.stringify(Object.fromEntries(VOICE_PREVIEW_FIELDS.map(key => [key, key === 'selectedBands'
    ? (record[key] || []).map(band => ({ actId: String(band.actId), name: band.name || '', lineupId: band.lineupId || '' }))
    : record[key] ?? (key === 'styleMatch' ? 'any' : ['styles', 'mustHaveInstruments'].includes(key) ? [] : '')])));
}
export function voicePreviewKey(record) {
  return crypto.createHash('sha256').update(`${record.websiteKey}|${voicePreviewSnapshot(record)}`).digest('hex').slice(0, 24);
}

// This boundary runs BEFORE the live request path. It never imports a sender or writes a queue.
export async function interceptAvailabilityTest(body = {}, { loadAct, now = new Date() } = {}) {
  const voice = /^voice[_-]/i.test(clean(body.source));
  if (voice && body.dryRun !== true) return { success: false, testMode: true, sent: 0, reason: 'Voice availability requests are test-only. No messages were sent.' };
  if (body.dryRun !== true) return null;
  const blocked = reason => ({ success: false, testMode: true, sent: 0, reason });
  const dateISO = clean(body.dateISO);
  const parsed = new Date(`${dateISO}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateISO || dateISO < now.toISOString().slice(0, 10)) return blocked('Confirm a valid future event date, including the year.');
  const address = clean(body.formattedAddress || body.address);
  if (!address || /^(tbc|tbd|unknown|not (yet )?(decided|known)|to be confirmed|n\/?a)[.!]?$/i.test(address)) return blocked('Confirm the event venue, town or postcode.');
  if (!clean(body.clientName) || (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(body.clientEmail)) && !/^\+[1-9]\d{7,14}$/.test(clean(body.clientPhone)))) return blocked('Confirm the client name and a contact number or email.');
  if (!clean(body.enquiryId) || !clean(body.lineupId) || !/^[a-f\d]{24}$/i.test(clean(body.actId))) return blocked('A saved enquiry and one exact selected band lineup are required.');
  const act = await loadAct(body.actId);
  if (!act || act.isTest || !['approved', 'live', 'approved_changes_pending', 'live_changes_pending'].includes(act.status)) return blocked('The selected band needs staff review.');
  const lineup = act.lineups?.find(item => String(item.lineupId || item._id || '') === body.lineupId);
  if (!lineup) return blocked('The selected lineup is no longer in the catalogue. Confirm the lineup again.');
  const instruments = (lineup.bandMembers || []).map(member => clean(member.instrument)).filter(role => role && !/^manager$/i.test(role));
  if (!instruments.length) return blocked('The selected lineup needs staff review.');
  return { success: true, testMode: true, sent: 0, availabilityChecked: false, deliveryChecksPending: true,
    request: { actId: String(act._id), bandName: clean(act.tscName), lineupId: body.lineupId,
      lineupLabel: `${instruments.length}-piece · ${instruments.join(', ')}`, instruments,
      vocalistRoles: sortedVocalContacts(lineup).length, dateISO, address, enquiryRef: clean(body.enquiryId) } };
}

// Refresh the match immediately before preparing each request. No implicit first lineup.
export async function prepareVoiceAvailabilityBatch(record, { lookupBands, trigger, now = new Date() }) {
  const requests = [];
  const blocked = [];
  const seen = new Set();
  for (const band of record.selectedBands || []) {
    const id = `${band.actId}|${band.lineupId || ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const fresh = await lookupBands({ query: band.name, styles: record.styles || [], preferredSize: record.preferredSize || '',
      styleMatch: record.styleMatch || 'any', mustHaveInstruments: record.mustHaveInstruments || [] }, { actId: String(band.actId), lineupId: band.lineupId || undefined });
    const current = fresh.bands?.find(item => String(item.actId) === String(band.actId));
    const lineups = (current?.lineups || []).filter(item => !band.lineupId || item.lineupId === band.lineupId);
    if (lineups.length !== 1 || lineups[0].sizeNeedsReview) {
      blocked.push({ bandName: band.name, reason: lineups.length > 1 ? 'Confirm one exact lineup for this band before preparing its request.' : 'The selected lineup needs staff review or no longer matches the preferences.' });
      continue;
    }
    const result = await trigger({ actId: String(band.actId), lineupId: lineups[0].lineupId,
      dateISO: record.eventDateISO, address: record.address, formattedAddress: record.address,
      clientName: record.clientName, clientEmail: record.clientEmail, clientPhone: record.clientPhone,
      enquiryId: record.enquiryRef, requestId: record.enquiryRef, source: 'voice_enquiry_test', dryRun: true });
    if (result?.testMode !== true || result.sent !== 0) throw new Error('Test request boundary did not confirm a dry run.');
    if (result.success && result.request) requests.push(result.request);
    else blocked.push({ bandName: band.name, reason: result.reason || 'Staff review is needed.' });
  }
  return { key: voicePreviewKey(record), testMode: true, sent: 0, status: blocked.length ? 'needs_details' : 'prepared',
    preparedAt: now.toISOString(), requests, blocked, deliveryChecksPending: true, availabilityChecked: false };
}

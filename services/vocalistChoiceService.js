import Booking from "../models/bookingModel.js";
import Availability from "../models/availabilityModel.js";
import Act from "../models/actModel.js";
import Musician from "../models/musicianModel.js";
import { availableVocalistsForLineup, assignDistinctVocalists, musicianCanFrontVocalSlot } from "../utils/enquiryAvailability.js";
import { getPublicSiteBaseUrl } from "../utils/publicSiteUrl.js";
const addressKey = value => String(value || "").toLowerCase().replace(/\b(united kingdom|uk)\b/g, "").replace(/[^a-z0-9]/g, "");
export async function loadVocalistChoices({ actId, lineupId, dateISO, address }, { ActModel = Act, AvailabilityModel = Availability, MusicianModel = Musician, BookingModel = Booking } = {}) {
  const act = await ActModel.findById(actId).lean();
  const lineup = act?.lineups?.find(l => String(l._id || l.lineupId) === String(lineupId));
  if (!lineup) throw new Error("Please reselect your band lineup.");
  const rows = await AvailabilityModel.find({ actId, lineupId, dateISO }).lean();
  const scoped = rows.filter(row => addressKey(row.formattedAddress) === addressKey(address));
  const ids = [...new Set(scoped.map(row => String(row.musicianId || "")).filter(Boolean))];
  const profiles = ids.length ? await MusicianModel.find({ _id: { $in: ids } }).select("firstName lastName musicianSlug profilePhoto status vocals instrumentation").lean() : [];
  const byId = new Map(profiles.map(profile => [String(profile._id), profile]));
  const dayStart = new Date(`${dateISO}T00:00:00Z`);
  const dayEnd = new Date(`${dateISO}T23:59:59.999Z`);
  const booked = await BookingModel.find({ status: "confirmed", $or: [
    { date: { $gte: dayStart, $lte: dayEnd } }, { eventDate: { $gte: dayStart, $lte: dayEnd } },
  ] }).select("actsSummary.chosenVocalists actsSummary.selectedVocalist bandLineup").lean();
  const unavailable = new Set(booked.flatMap(booking => [
    ...(booking.bandLineup || []).map(String),
    ...(booking.actsSummary || []).flatMap(item => [...(item.chosenVocalists || []), ...(item.selectedVocalist ? [item.selectedVocalist] : [])].map(person => String(person.musicianId || ""))),
  ]));
  const summary = availableVocalistsForLineup(scoped.map(row => unavailable.has(String(row.musicianId)) ? { ...row, reply: "unavailable" } : row), lineup);
  const bySlot = new Map(summary.requiredSlots.map(slot => [slot,
    (summary.bySlot.get(slot) || []).filter(row => {
      const profile = byId.get(String(row.musicianId));
      return profile && (!row.isDeputy || musicianCanFrontVocalSlot(profile, summary.slotContacts.get(slot)));
    }).map(row => {
      const profile = byId.get(String(row.musicianId));
      return { musicianId: String(row.musicianId), slotIndex: slot, isDeputy: Boolean(row.isDeputy),
        displayName: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || row.displayName,
        photoUrl: profile.profilePhoto || row.photoUrl || "",
        profileUrl: `${getPublicSiteBaseUrl()}/musician/${encodeURIComponent(profile.musicianSlug || profile._id)}` };
    })
  ]));
  return { ...summary, bySlot, complete: summary.requiredSlots.length === 0 || Boolean(assignDistinctVocalists(summary.requiredSlots, bySlot)),
    roles: summary.requiredSlots.map(slot => ({ slotIndex: slot, label: summary.slotContacts.get(slot)?.instrument || `Vocalist ${slot + 1}`, candidates: bySlot.get(slot) || [] })) };
}

export function validateVocalistSelection(summary, selectedIds = []) {
  const ids = selectedIds.map(value => String(value?.musicianId || value).toLowerCase());
  if (ids.length !== summary.requiredSlots.length || new Set(ids).size !== ids.length) return null;
  return assignDistinctVocalists(summary.requiredSlots, summary.bySlot, new Set(ids));
}

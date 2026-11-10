import mongoose from 'mongoose';
import Musician from '../models/musicianModel.js';
import Future from '../models/originalRoleReservationModel.js';
import { musicianDirectoryVisibility } from './musicianDirectoryVisibility.js';
import { chatDisplayName } from './originalsChatService.js';

const key = value => String(value || '').trim().toLowerCase();
const invalid = message => Object.assign(new Error(message), { status: 400 });

export function originalPreferredPlaces(input, roles = [], sourceType = 'none') {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 30) throw invalid('Choose at most one preferred musician per recording role.');
  const seen = new Set();
  const places = input.map(item => {
    const role = roles.find(role => key(role.name) === key(item?.roleName));
    const musicianId = String(item?.musicianId || '');
    if (!role || seen.has(key(role.name)) || !mongoose.Types.ObjectId.isValid(musicianId)) throw invalid('Choose a valid role and one preferred musician for each held place.');
    seen.add(key(role.name));
    return { roleName: role.name, roleKey: key(role.name), musicianId };
  });
  if (['none', 'video_demo'].includes(sourceType)) {
    const foundation = places.filter(place => roles.find(role => key(role.name) === place.roleKey)?.foundationEligible);
    if (foundation.length > 3) throw invalid('The foundation round has three places. Choose no more than three preferred foundation musicians.');
    if (new Set(foundation.map(place => place.musicianId)).size !== foundation.length) throw invalid('A musician can hold only one foundation place. Choose one foundation role for each preferred musician.');
  }
  return places;
}

export async function validateOriginalPreferredMusicians(places, viewer) {
  if (!places.length) return;
  const ids = [...new Set(places.map(place => place.musicianId))];
  const records = await Musician.find({ _id: { $in: ids }, ...musicianDirectoryVisibility(viewer) }).select('_id firstName lastName basicInfo.firstName basicInfo.lastName').lean();
  if (records.length !== ids.length) throw invalid('A preferred musician is no longer available. Choose them again before submitting.');
  for (const place of places) {
    const musician = records.find(record => String(record._id) === place.musicianId);
    place.assignedDisplayName = chatDisplayName([musician.firstName || musician.basicInfo?.firstName, musician.lastName || musician.basicInfo?.lastName].filter(Boolean).join(' '));
  }
}

export async function saveOriginalPreferredPlaces({ projectId, places, session }) {
  if (!places.length) return;
  // No agreement is accepted on their behalf and no recording clock starts.
  await Future.create(places.map(place => ({ ...place, projectId, seatNumber: 1, assignedByOwner: true, state: 'waiting' })), { session });
}

export function originalAvailableSeat({ occupied, preferred, slotLimit, musicianId, futureReservationId }) {
  const used = new Set(occupied.map(item => item.seatNumber).filter(Boolean));
  const next = () => Array.from({ length: slotLimit }, (_, i) => i + 1).find(number => !used.has(number));
  for (const item of occupied.filter(item => !item.seatNumber)) used.add(next());
  let heldSeat;
  for (const hold of preferred) {
    if (occupied.some(item => String(item.futureReservationId || '') === String(hold._id))) continue;
    const seat = next();
    if (seat) used.add(seat);
    if (String(hold._id) === String(futureReservationId || '') && String(hold.musicianId) === String(musicianId)) heldSeat = seat;
  }
  return heldSeat || next();
}

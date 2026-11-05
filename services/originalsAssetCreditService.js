import Musician from '../models/musicianModel.js';
import { chatDisplayName } from './originalsChatService.js';
import { originalTakeAssetIds } from './originalsTakeFilesService.js';

const idOf = value => String(value?._id || value || '');
const text = value => typeof value === 'string' ? value.trim() : '';

// Return only public credit information. Anonymous credits never carry a profile
// path, even for a manager viewing the workspace.
export async function addOriginalAssetCredits({ assets = [], project, submissions = [], reservations = [] }) {
  const submissionByAsset = new Map();
  for (const submission of submissions) {
    for (const id of [...originalTakeAssetIds(submission.takes || []), submission.outputAssetId].filter(Boolean)) {
      submissionByAsset.set(idOf(id), submission);
    }
  }
  const reservationById = new Map(reservations.map(item => [idOf(item._id), item]));
  const contexts = assets.map(asset => {
    const submission = submissionByAsset.get(idOf(asset._id));
    const reservation = reservationById.get(idOf(asset.reservationId || submission?.reservationId));
    const musicianId = idOf(asset.ownerId);
    const isOwner = Boolean(musicianId) && musicianId === idOf(project.ownerId);
    const anonymous = Boolean(submission?.anonymous || reservation?.anonymous || (isOwner && project.ownerAnonymous));
    const creditName = (submission?.anonymous && text(submission.creditName)) || (reservation?.anonymous && text(reservation.creditName)) || (isOwner && project.ownerAnonymous && text(project.ownerCreditName)) || 'Anonymous';
    return { asset, musicianId, isOwner, anonymous, creditName };
  });
  const ids = [...new Set(contexts.filter(item => !item.anonymous && item.musicianId).map(item => item.musicianId))];
  const profiles = ids.length ? await Musician.find({ _id: { $in: ids } })
    .select('firstName lastName basicInfo.firstName basicInfo.lastName musicianSlug').lean() : [];
  const byId = new Map(profiles.map(profile => [idOf(profile._id), profile]));
  return contexts.map(({ asset, musicianId, isOwner, anonymous, creditName }) => {
    if (anonymous) return { ...asset, submittedBy: { displayName: creditName, anonymous: true, profilePath: null } };
    const profile = byId.get(musicianId);
    const firstName = text(profile?.firstName) || text(profile?.basicInfo?.firstName);
    const lastName = text(profile?.lastName) || text(profile?.basicInfo?.lastName);
    const displayName = firstName ? `${firstName}${lastName ? ` ${Array.from(lastName)[0]}.` : ''}` : isOwner && text(project.ownerName) ? chatDisplayName(project.ownerName) : 'Project participant';
    return { ...asset, submittedBy: {
      displayName, anonymous: false,
      profilePath: profile ? `/musician/${encodeURIComponent(text(profile.musicianSlug) || idOf(profile._id))}` : null,
    } };
  });
}

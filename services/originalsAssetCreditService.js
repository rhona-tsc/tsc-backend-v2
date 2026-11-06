import Musician from '../models/musicianModel.js';
import { chatDisplayName } from './originalsChatService.js';
import { originalTakeAssetIds } from './originalsTakeFilesService.js';

const idOf = value => String(value?._id || value || '');
const text = value => typeof value === 'string' ? value.trim() : '';

function creditContext(asset, submission, reservation, project) {
  const musicianId = idOf(asset.ownerId);
  const isOwner = Boolean(musicianId) && musicianId === idOf(project.ownerId);
  const anonymous = Boolean(submission?.anonymous || reservation?.anonymous || (isOwner && project.ownerAnonymous));
  const creditName = (submission?.anonymous && text(submission.creditName)) || (reservation?.anonymous && text(reservation.creditName)) || (isOwner && project.ownerAnonymous && text(project.ownerCreditName)) || 'Anonymous';
  return { asset, musicianId, isOwner, anonymous, creditName };
}

// Anonymous credits never query or carry an identifying photo or profile path,
// even for a manager viewing the workspace.
async function addCredits(contexts, project) {
  const ids = [...new Set(contexts.filter(item => !item.anonymous && item.musicianId).map(item => item.musicianId))];
  const profiles = ids.length ? await Musician.find({ _id: { $in: ids } })
    .select('firstName lastName basicInfo.firstName basicInfo.lastName musicianSlug privateTestProfile profilePhoto profileDeletedAt').lean() : [];
  const byId = new Map(profiles.map(profile => [idOf(profile._id), profile]));
  return contexts.map(({ asset, musicianId, isOwner, anonymous, creditName }) => {
    if (anonymous) return { ...asset, submittedBy: { displayName: creditName, anonymous: true, profilePath: null } };
    const profile = byId.get(musicianId);
    const firstName = text(profile?.firstName) || text(profile?.basicInfo?.firstName);
    const lastName = text(profile?.lastName) || text(profile?.basicInfo?.lastName);
    const displayName = firstName ? `${firstName}${lastName ? ` ${Array.from(lastName)[0]}.` : ''}` : isOwner && text(project.ownerName) ? chatDisplayName(project.ownerName) : 'Project participant';
    const profilePhoto = !profile?.privateTestProfile && !profile?.profileDeletedAt && /^https?:\/\//i.test(text(profile?.profilePhoto)) ? text(profile.profilePhoto) : '';
    return { ...asset, submittedBy: {
      displayName, anonymous: false,
      ...(profilePhoto ? { profilePhoto } : {}),
      profilePath: profile && !profile.privateTestProfile && !profile.profileDeletedAt ? `/musician/${encodeURIComponent(text(profile.musicianSlug) || idOf(profile._id))}` : null,
    } };
  });
}

export async function addOriginalAssetCredits({ assets = [], project, submissions = [], reservations = [] }) {
  const submissionByAsset = new Map();
  for (const submission of submissions) {
    for (const id of [...originalTakeAssetIds(submission.takes || []), submission.outputAssetId].filter(Boolean)) {
      submissionByAsset.set(idOf(id), submission);
    }
  }
  const reservationById = new Map(reservations.map(item => [idOf(item._id), item]));
  return addCredits(assets.map(asset => {
    const submission = submissionByAsset.get(idOf(asset._id));
    return creditContext(asset, submission, reservationById.get(idOf(asset.reservationId || submission?.reservationId)), project);
  }), project);
}

// Approved role credits remain available even if a source file is no longer in
// the active file list. Pending recordings never disclose contributor details.
export async function addOriginalRoleCredits({ roles = [], project, submissions = [], reservations = [] }) {
  const approvedRoles = new Set(roles.filter(role => role.timingState === 'complete').map(role => text(role.name).toLowerCase()));
  const approved = submissions.filter(item => item.state === 'accepted' && approvedRoles.has(text(item.roleName).toLowerCase()));
  const reservationById = new Map(reservations.map(item => [idOf(item._id), item]));
  const credits = await addCredits(approved.map(submission => creditContext(
    { ownerId: submission.musicianId }, submission, reservationById.get(idOf(submission.reservationId)), project,
  )), project);
  return roles.map(role => {
    if (role.timingState !== 'complete') return role;
    const seen = new Set();
    const approvedContributors = approved.flatMap((submission, index) => {
      const musicianId = idOf(submission.musicianId);
      if (text(submission.roleName).toLowerCase() !== text(role.name).toLowerCase() || seen.has(musicianId)) return [];
      seen.add(musicianId);
      return [credits[index].submittedBy];
    });
    return { ...role, approvedContributors };
  });
}

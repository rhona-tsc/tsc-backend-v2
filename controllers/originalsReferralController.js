import { browseOriginalMusicians } from '../services/originalsMusicianDirectoryService.js';
import validator from 'validator';
import mongoose from 'mongoose';
import Referral from '../models/originalReferralModel.js';
import Project from '../models/originalProjectModel.js';
import Musician from '../models/musicianModel.js';
import { getOriginalsUserId, originalOwnerDisplayName } from '../services/originalsPolicyService.js';
import { loadOriginalMembership, originalParticipation } from '../services/originalsMembershipService.js';
import { originalRoleProgress } from '../services/originalsRoleProgressService.js';
import { chatDisplayName } from '../services/originalsChatService.js';
import { deliverOriginalReferrals, referralHash } from '../services/originalsReferralService.js';
const clean = value => String(value || '').trim();
const key = value => clean(value).toLowerCase();

export async function searchOriginalReferralMusicians(req, res) {
  try {
    return res.json(await browseOriginalMusicians(req.query));
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not search musicians' }); }
}

export async function recommendOriginalMusician(req, res) {
  try {
    const referrerId = getOriginalsUserId(req.user);
    const project = await Project.findById(req.params.id).lean();
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    const requestedRole = clean(req.body.roleName);
    const snapshot = await loadOriginalMembership(project);
    const role = originalRoleProgress(snapshot).find(item => key(item.name) === key(requestedRole) && item.canRecommend);
    if (!role) return res.status(409).json({ success: false, message: 'This role is no longer looking for recommendations' });
    let contact;
    if (req.body.musicianId) {
      if (!mongoose.Types.ObjectId.isValid(req.body.musicianId)) return res.status(400).json({ success: false, message: 'Choose a valid musician' });
      const target = await Musician.findById(req.body.musicianId).select('firstName lastName email phone').lean();
      if (target) contact = { fullName: [target.firstName,target.lastName].filter(Boolean).join(' '), email: key(target.email), phone: target.phone || '' };
    } else contact = { fullName: clean(req.body.fullName), email: key(req.body.email), phone: clean(req.body.phone) };
    if (!contact || !validator.isEmail(contact.email || '') || contact.fullName.length < 2 || contact.fullName.length > 160 || contact.phone.length > 40 || (!req.body.musicianId && contact.phone.replace(/\D/g,'').length < 7)) return res.status(400).json({ success: false, message: 'Enter a full name, valid email address and phone number' });
    const referrer = await Musician.findById(referrerId).select('firstName lastName email').lean();
    if (key(referrer?.email) === contact.email) return res.status(400).json({ success: false, message: 'Choose someone other than yourself' });
    const existing = await Referral.findOne({ projectId: project._id, email: contact.email, roleName: role.name });
    if (existing) return res.status(409).json({ success: false, message: 'This person has already been recommended for this role' });
    if (await Referral.countDocuments({ referrerId, createdAt: { $gte: new Date(Date.now() - 86400000) } }) >= 10) return res.status(429).json({ success: false, message: 'You can recommend up to ten people per day. Please try again tomorrow.' });
    const prefs = snapshot.reservations.find(item => String(item.musicianId) === referrerId && item.anonymous);
    const referrerName = String(project.ownerId) === referrerId ? originalOwnerDisplayName(project) : prefs ? prefs.creditName || 'A project participant' : chatDisplayName([referrer?.firstName, referrer?.lastName].filter(Boolean).join(' '));
    const referral = await Referral.create({ projectId: project._id, referrerId, referrerName, roleName: role.name, ...contact, expiresAt: new Date(Date.now() + 30 * 86400000) });
    res.status(201).json({ success: true, message: 'Recommendation saved. Their project invitation will be emailed shortly.' });
    try { await deliverOriginalReferrals({ referralId: referral._id }); } catch (error) { console.error('Project referral email will retry:', error); }
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'This person has already been recommended for this role' });
    return res.status(500).json({ success: false, message: 'Could not save this recommendation' });
  }
}

export async function claimOriginalReferral(req, res) {
  try {
    const musicianId = getOriginalsUserId(req.user);
    if (await Referral.exists({ projectId: req.params.id, musicianId, claimedAt: { $ne: null } })) return res.json({ success: true });
    if (!/^[a-f\d]{64}$/i.test(req.body.token || '')) return res.status(400).json({ success: false, message: 'Invalid project invitation' });
    const profile = await Musician.findById(musicianId).select('email').lean();
    const referral = await Referral.findOne({ projectId: req.params.id, email: key(profile?.email), tokenHash: referralHash(req.body.token), claimedAt: null, expiresAt: { $gt: new Date() } });
    if (!referral) return res.status(403).json({ success: false, message: 'Use the account with the email address this invitation was sent to. The invitation may also have expired.' });
    const project = await Project.findById(referral.projectId).lean();
    const snapshot = project && await loadOriginalMembership(project);
    if (!snapshot || !originalParticipation(snapshot, musicianId).canAccess || !originalRoleProgress(snapshot).some(role => key(role.name) === key(referral.roleName) && role.canRecommend)) return res.status(403).json({ success: false, code: 'ORIGINALS_PARTICIPATION_ENDED', message: 'This role is no longer available to you.' });
    await Referral.updateOne({ _id: referral._id, claimedAt: null }, { $set: { musicianId, claimedAt: new Date(), tokenHash: '', emailState: 'sent', leaseExpiresAt: null } });
    return res.json({ success: true });
  } catch { return res.status(500).json({ success: false, message: 'Could not open this project invitation' }); }
}

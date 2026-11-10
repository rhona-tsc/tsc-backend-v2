import { validateOriginalTemporaryStem, saveOriginalTemporaryStem } from '../services/originalsTemporaryStemService.js';
import { authoriseOriginalAsset } from '../services/originalsAssetAccessService.js';
import { requireOriginalStemReviews } from '../services/originalsRecordingContextService.js';
import { originalSubmissionCommit } from "../services/originalsSubmissionCommitService.js";
import { originalStemChatActivity } from "../services/originalsStemChatActivityService.js";
import { addOriginalAssetCredits, addOriginalRoleCredits } from "../services/originalsAssetCreditService.js";
import { advanceOriginalRound } from "../services/originalsRoundProgressionService.js";
import { browseOriginalMusicians } from "../services/originalsMusicianDirectoryService.js";
import { canSeeMusicianInDirectory } from '../services/musicianDirectoryVisibility.js';
import { recordOriginalAgreement, originalAgreementType } from "../services/originalsAgreementService.js";
import Future from "../models/originalRoleReservationModel.js";
import { createOriginalRecordingReservation, activateOriginalRoleReservations, eligibleRoundRoles } from "../services/originalsReservationService.js";
import { originalTakeAssetIds, originalTakeKindsValid, originalTakeNeedsListeningMix } from "../services/originalsTakeFilesService.js";
import { queueOriginalChatNotifications, deliverOriginalChatNotifications } from "../services/originalsChatNotificationService.js";
import { randomUUID } from "node:crypto";
import { chatUploadError, chatDisplayName, CHAT_ATTACHMENT_LIMIT } from "../services/originalsChatService.js";
import { requireOriginalProjectManager, presentOriginalWorkspace, originalReferenceKinds } from "../services/originalsAccessService.js";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import originalProjectModel from "../models/originalProjectModel.js";
import originalRoundModel from "../models/originalRoundModel.js";
import originalAssetModel from "../models/originalAssetModel.js";
import originalReservationModel from "../models/originalReservationModel.js";
import originalSubmissionModel from "../models/originalSubmissionModel.js";
import originalEventModel from "../models/originalEventModel.js";
import originalNotificationModel from "../models/originalNotificationModel.js";
import originalInvitationModel from "../models/originalInvitationModel.js";
import musicianModel from "../models/musicianModel.js";
import originalCreditVersionModel from "../models/originalCreditVersionModel.js";
import originalIssueModel from "../models/originalIssueModel.js";
import originalMessageModel from "../models/originalMessageModel.js";
import {
  canRequestReservationExtension,
  canManageOriginalProject,
  isOriginalRoundExpired,
  getOriginalsUserId,
} from "../services/originalsPolicyService.js";

import { prepareOriginalRoundClock } from "../services/originalsRoundClockService.js";

cloudinary.config({
  cloud_name: process.env.REACT_APP_CLOUDINARY_NAME,
  api_key: process.env.REACT_APP_CLOUDINARY_API_KEY,
  api_secret: process.env.REACT_APP_CLOUDINARY_SECRET_KEY,
});

const clean = (value) => String(value || "").trim();
const objectId = (value) => mongoose.Types.ObjectId.isValid(String(value || "")) ? String(value) : "";
const AUDIO_MIMES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/aiff",
  "audio/x-aiff", "audio/flac", "audio/x-flac", "audio/mp4", "audio/x-m4a",
  "audio/aac", "audio/ogg", "audio/webm", "audio/opus",
]);
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);
const ASSET_KINDS = new Set([
  "initial_stem", "temporary_stem", "guide_track", "demo", "voice_note", "video_submission", "click_track", "take_stem", "take_mixdown", "mix", "master", "chat_attachment",
]);

const audit = ({ projectId, roundId, reservationId, type, user, metadata = {} }) =>
  originalEventModel.create({
    projectId,
    roundId: roundId || null,
    type,
    actorId: objectId(getOriginalsUserId(user)) || null,
    actorRole: clean(user?.role || user?.userrole).toLowerCase(),
    metadata: { ...metadata, reservationId: reservationId ? String(reservationId) : undefined },
  });

const uploadAuthenticated = (file, projectId) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `originals/${projectId}`,
        resource_type: !/^(audio|video)\//.test(file.mimetype) ? "raw" : "video",
        ...(!/^(audio|video)\//.test(file.mimetype) ? { public_id: `${randomUUID()}.${String(file.originalname).split(".").at(-1).replace(/[^a-z0-9]/gi, "").slice(0, 10) || "bin"}` } : {}),
        type: "authenticated",
        use_filename: false,
        unique_filename: true,
      },
      (error, result) => error ? reject(error) : resolve(result),
    );
    stream.end(file.buffer);
  });

export const getOriginalProjectWorkspace = async (req, res) => {
  try {
    const project = await originalProjectModel.findById(req.params.id).lean();
    if (!project) return res.status(404).json({ success: false, message: "Originals project not found" });
    const canManage = canManageOriginalProject(project, req.user);
    const [rounds, reservations, submissions, assets, notifications, invitations, creditVersions, issues, messages, futureReservations] = await Promise.all([
      originalRoundModel.find({ projectId: project._id }).sort({ sequence: 1 }).lean(),
      originalReservationModel.find({ projectId: project._id }).sort({ createdAt: -1 }).lean(),
      originalSubmissionModel.find({ projectId: project._id }).sort({ submittedAt: -1 }).lean(),
      originalAssetModel.find({ projectId: project._id, state: { $ne: "deleted" } })
        .select("kind originalName mimeType bytes finalEligible replacementRoleName createdEntirelyWithAi alignmentReviewRequired alignmentReview state ownerId roundId reservationId createdAt")
        .sort({ createdAt: -1 }).lean(),
      canManage ? originalNotificationModel.find({ projectId: project._id, template: { $ne: 'originals_signed_agreement_copy' } }).sort({ createdAt: -1 }).limit(50).lean() : [],
      canManage ? originalInvitationModel.find({ projectId: project._id })
        .populate("invitedMusicianId", "firstName lastName email instrument")
        .sort({ createdAt: -1 }).lean() : [],
      originalCreditVersionModel.find({ projectId: project._id }).sort({ version: -1 }).lean(),
      originalIssueModel.find({ projectId: project._id }).sort({ createdAt: -1 }).lean(),
      originalMessageModel.find({ projectId: project._id }).sort({ createdAt: -1, _id: -1 }).limit(500).populate("attachmentIds", "kind originalName mimeType bytes state").lean(),
      Future.find({ projectId: project._id }).sort({ createdAt: 1 }).lean(),
    ]);
    const currentIndex = rounds.findIndex(round => String(round._id) === String(project.currentRoundId));
    if (currentIndex >= 0) {
      const prepared = await prepareOriginalRoundClock(rounds[currentIndex]);
      if (prepared) rounds[currentIndex] = prepared.toObject ? prepared.toObject() : prepared;
      if (project.state === "owner_review" && ["open", "reopened"].includes(rounds[currentIndex].state)) {
        project.state = { foundation: "foundation_open", instrument: "role_round_open", mix: "mix_open", master: "master_open" }[rounds[currentIndex].type];
      }
    }
    const workspace = presentOriginalWorkspace({ project, rounds, reservations, submissions, assets, notifications, invitations, creditVersions, issues, messages: messages.reverse(), futureReservations }, req.user);
    workspace.assets = await addOriginalAssetCredits({ assets: workspace.assets, project, submissions, reservations });
    workspace.roleProgress = await addOriginalRoleCredits({ roles: workspace.roleProgress, project, submissions, reservations });
    return res.json(workspace);
  } catch (error) {
    console.error("❌ getOriginalProjectWorkspace error:", error);
    return res.status(500).json({ success: false, message: "Failed to load project workspace" });
  }
};

export const uploadOriginalAsset = async (req, res) => {
  try {
    const project = await originalProjectModel.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: "Originals project not found" });
    if (!req.file) return res.status(400).json({ success: false, message: "Choose a file to upload" });
    const kind = clean(req.body?.kind).toLowerCase();
    if (!["take_stem", "take_mixdown", "mix", "master", "voice_note", "chat_attachment"].includes(kind) && !canManageOriginalProject(project, req.user)) return res.status(403).json({ success: false, message: "Only the project owner can upload project references" });
    if (!ASSET_KINDS.has(kind)) return res.status(400).json({ success: false, message: "Invalid asset type" });
    if (kind === 'initial_stem' && ![true, 'true'].includes(req.body?.finalStemConfirmed)) return res.status(400).json({ success: false, message: 'Confirm this is a stem intended for the final production, or upload it as a reference-only idea or guide.' });
    const isStem = ["initial_stem", "temporary_stem", "take_stem", "click_track"].includes(kind);
    const replacementRoleName = kind === "temporary_stem" ? validateOriginalTemporaryStem(project, req.body?.replacementRoleName) : "";
    const declaration = req.body?.createdEntirelyWithAi;
    if (declaration !== undefined && (!isStem || ![true, false, "true", "false"].includes(declaration))) {
      return res.status(400).json({ success: false, message: "Use a true or false AI declaration for stem files only" });
    }
    const createdEntirelyWithAi = declaration === undefined ? null : declaration === true || declaration === "true";
    req.file.mimetype = String(req.file.mimetype).split(";")[0].toLowerCase();
    const chatError = chatUploadError(kind, req.file);
    if (chatError) return res.status(415).json({ success: false, message: chatError });
    if (kind !== "chat_attachment" && ![...AUDIO_MIMES, ...VIDEO_MIMES].includes(req.file.mimetype)) {
      return res.status(415).json({ success: false, message: "Use WAV, MP3, AIFF, FLAC, M4A, MP4 or MOV" });
    }
    if (VIDEO_MIMES.has(req.file.mimetype) && !["demo", "video_submission", "chat_attachment"].includes(kind)) {
      return res.status(415).json({ success: false, message: "Video is only allowed for project demos" });
    }

    const ownerId = objectId(getOriginalsUserId(req.user));
    const roundId = objectId(req.body?.roundId) || null;
    const reservationId = objectId(req.body?.reservationId) || null;
    if (["take_stem", "take_mixdown", "mix", "master"].includes(kind) && !reservationId) {
      return res.status(400).json({ success: false, message: "A reservation is required for take uploads" });
    }
    if (reservationId) {
      const reservation = await originalReservationModel.findOne({
        _id: reservationId, projectId: project._id, musicianId: ownerId, state: { $in: ["active", "submitted"] },
      });
      const pending = reservation?.state === 'submitted' ? await originalSubmissionModel.findOne({ reservationId, state: 'submitted' }).lean() : null;
      if (!reservation || reservation.expiresAt <= new Date() || (reservation.state === 'submitted' && !(pending?.revisionSession?.status === 'editing' && new Date(pending.revisionSession.expiresAt) > new Date())) || String(project.currentRoundId) !== String(reservation.roundId)) {
        return res.status(409).json({ success: false, message: "This reservation is not active" });
      }
    }

    const uploaded = await uploadAuthenticated(req.file, project._id);
    const assetData = {
      projectId: project._id,
      replacementRoleName,
      roundId,
      reservationId,
      ownerId,
      kind,
      createdEntirelyWithAi,
      alignmentReviewRequired: kind === "take_stem",
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      bytes: req.file.size,
      cloudinaryPublicId: uploaded.public_id,
      cloudinaryResourceType: uploaded.resource_type || "video",
      cloudinaryFormat: uploaded.format || "",
      deliveryType: "authenticated",
      finalEligible: !["temporary_stem", "guide_track", "demo", "voice_note", "video_submission", "click_track", "take_mixdown", "chat_attachment"].includes(kind),
    };
    const asset = kind === 'temporary_stem'
      ? await saveOriginalTemporaryStem({ projectId: project._id, data: assetData, songwritingClaim: req.body?.songwritingClaim })
      : await originalAssetModel.create(assetData);
    if (["initial_stem", "guide_track", "demo", "voice_note", "video_submission", "click_track"].includes(kind)) {
      project.initialAssetIds.addToSet(asset._id);
      if (kind === "initial_stem") {
        project.hasInitialStem = true;
        project.sourceType = "final_eligible_stem";
        if (req.body?.songwritingClaim !== undefined) project.ownerSongwritingClaim = [true, "true"].includes(req.body.songwritingClaim);
      }
      if (kind === "guide_track" && !['final_eligible_stem', 'temporary_stem'].includes(project.sourceType)) {
        project.sourceType = "guide_track";
        project.hasInitialStem = true;
        if (req.body?.songwritingClaim !== undefined) project.ownerSongwritingClaim = [true, "true"].includes(req.body.songwritingClaim);
      }
      if (kind === "video_submission" && !['final_eligible_stem', 'temporary_stem', 'guide_track'].includes(project.sourceType)) {
        project.sourceType = "video_demo";
        project.ownerSongwritingClaim = req.body?.songwritingClaim === "true";
      }
      await project.save();
    }
    await audit({ projectId: project._id, roundId, reservationId, type: "asset_uploaded", user: req.user, metadata: { assetId: String(asset._id), kind, ...(isStem ? { createdEntirelyWithAi } : {}) } });
    return res.status(201).json({ success: true, asset: { _id: asset._id, kind, originalName: asset.originalName, bytes: asset.bytes, replacementRoleName: asset.replacementRoleName, finalEligible: asset.finalEligible, createdEntirelyWithAi: asset.createdEntirelyWithAi, alignmentReviewRequired: asset.alignmentReviewRequired } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
    console.error("❌ uploadOriginalAsset error:", error);
    return res.status(500).json({ success: false, message: "Private upload failed" });
  }
};

export const postOriginalMessage = async (req, res) => {
  try {
    const project = await originalProjectModel.findById(req.params.id).lean();
    if (!project) return res.status(404).json({ success: false, message: "Originals project not found" });
    const authorId = objectId(getOriginalsUserId(req.user));
    if (!authorId) return res.status(401).json({ success: false, message: "Please sign in again to send a message" });
    const clientMessageId = clean(req.body?.clientMessageId);
    if (clientMessageId.length > 100 || clientMessageId.startsWith('system:')) return res.status(400).json({ success: false, message: "Invalid message identifier" });
    if (clientMessageId) {
      const existing = await originalMessageModel.findOne({ projectId: project._id, authorId, clientMessageId });
      if (existing) return res.status(200).json({ success: true, message: existing });
    }
    const body = clean(req.body?.body);
    if (body.length > 3000) return res.status(400).json({ success: false, message: "Messages can contain up to 3,000 characters" });
    const attachments = req.body?.attachmentIds || [];
    if (!Array.isArray(attachments) || attachments.length > CHAT_ATTACHMENT_LIMIT || attachments.some(id => !objectId(id))) return res.status(400).json({ success: false, message: "Attach up to five valid files" });
    const attachmentIds = [...new Set(attachments.map(objectId))];
    if (attachmentIds.length) {
      const count = await originalAssetModel.countDocuments({ _id: { $in: attachmentIds }, projectId: project._id, ownerId: authorId, kind: "chat_attachment", state: "active" });
      if (count !== attachmentIds.length) return res.status(400).json({ success: false, message: "One or more attachments are unavailable" });
    }
    if (req.body?.voiceAssetId && !objectId(req.body.voiceAssetId)) return res.status(400).json({ success: false, message: "Invalid voice note" });
    const voiceAssetId = objectId(req.body?.voiceAssetId) || null;
    if (!body && !voiceAssetId && !attachmentIds.length) return res.status(400).json({ success: false, message: "Write a message or attach a voice note" });
    if (voiceAssetId) {
      const voice = await originalAssetModel.findOne({ _id: voiceAssetId, projectId: project._id, kind: "voice_note", ownerId: authorId, state: "active" });
      if (!voice) return res.status(400).json({ success: false, message: "Voice note is unavailable" });
    }
    const profile = await musicianModel.findById(authorId).select("firstName lastName").lean();
    const isOwner = String(project.ownerId) === authorId;
    const preference = await originalReservationModel.findOne({ projectId: project._id, musicianId: authorId }).sort({ createdAt: -1 }).lean();
    const anonymous = (isOwner && project.ownerAnonymous) || preference?.anonymous || req.body?.anonymous === true;
    const alias = (isOwner && project.ownerAnonymous ? project.ownerCreditName : preference?.anonymous ? preference.creditName : req.body?.creditName);
    const authorName = isOwner ? project.ownerName : [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
    let message;
    try { message = await originalMessageModel.create({
      projectId: project._id,
      authorId,
      body,
      voiceAssetId,
      attachmentIds,
      ...(clientMessageId ? { clientMessageId } : {}),
      authorAnonymous: Boolean(anonymous),
      authorCreditName: anonymous ? clean(alias) || "Anonymous" : chatDisplayName(authorName),
    }); } catch (error) {
      if (error.code !== 11000 || !clientMessageId) throw error;
      const existing = await originalMessageModel.findOne({ projectId: project._id, authorId, clientMessageId });
      if (!existing) throw error;
      return res.status(200).json({ success: true, message: existing });
    }
    // Delivery and audit failures must never turn a saved chat message into a failed send.
    try {
      await queueOriginalChatNotifications({ project, message });
      await audit({ projectId: project._id, type: "group_message_posted", user: req.user, metadata: { messageId: String(message._id), hasVoiceNote: Boolean(voiceAssetId) } });
    } catch (error) { console.error("Originals chat follow-up failed after message was saved:", error); }
    res.status(201).json({ success: true, message });
    // The response is already sent; SMTP latency cannot leave the chat composer waiting.
    try { await deliverOriginalChatNotifications({ projectId: project._id }); }
    catch (error) { console.error("Originals chat email delivery will retry:", error); }
    return;
  } catch (error) {
    console.error("❌ postOriginalMessage error:", error);
    return res.status(500).json({ success: false, message: "Failed to post message" });
  }
};

// Legacy clients use the same timed, transactional revision submission path.
export const replaceOriginalSubmission = async (req, res) => {
  try {
    const submission = await originalSubmissionModel.findById(req.params.submissionId);
    if (!submission || String(submission.musicianId) !== getOriginalsUserId(req.user)) return res.status(404).json({ success: false, message: 'Submission not found' });
    const takes = Array.isArray(req.body?.takes) ? req.body.takes : [];
    if (!takes.length || takes.length > 4 || originalTakeAssetIds(takes).some(id => !objectId(id))) return res.status(400).json({ success: false, message: 'Choose one to four valid recording files' });
    const saved = await originalSubmissionCommit.run({ reservationId: submission.reservationId, musicianId: submission.musicianId, payload: {
      category: submission.category, takes, notes: clean(req.body?.notes), songwritingChoice: submission.songwritingChoice,
    } });
    return res.json({ success: true, submission: saved });
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not submit the revision' }); }
};

export const openOriginalIssue = async (req, res) => {
  try {
    const submission = await originalSubmissionModel.findById(req.params.submissionId);
    if (!submission || !["submitted", "accepted"].includes(submission.state)) return res.status(404).json({ success: false, message: "Submission is unavailable" });
    if (String(submission.musicianId) !== getOriginalsUserId(req.user) && !await requireOriginalProjectManager(req, res, submission.projectId)) return;
    const category = clean(req.body?.category);
    const reason = clean(req.body?.reason);
    if (!["lyrics", "creative_direction", "credit", "conduct", "other"].includes(category) || !reason) return res.status(400).json({ success: false, message: "Choose a category and explain the concern" });
    const actorId = objectId(getOriginalsUserId(req.user));
    const issue = await originalIssueModel.create({ projectId: submission.projectId, submissionId: submission._id, openedBy: actorId, category, priorSubmissionState: submission.state, messages: [{ authorId: actorId, type: "reason", body: reason }] });
    submission.state = "retraction_requested";
    await submission.save();
    await audit({ projectId: submission.projectId, roundId: submission.roundId, type: "retraction_review_opened", user: req.user, metadata: { issueId: String(issue._id), submissionId: String(submission._id), category } });
    return res.status(201).json({ success: true, issue });
  } catch (error) {
    console.error("❌ openOriginalIssue error:", error);
    return res.status(500).json({ success: false, message: "Failed to open concern" });
  }
};

export const updateOriginalIssue = async (req, res) => {
  try {
    const issue = await originalIssueModel.findById(req.params.issueId);
    if (!issue || ["resolved", "retraction_confirmed", "cancelled"].includes(issue.state)) return res.status(404).json({ success: false, message: "Open concern not found" });
    if (String(issue.openedBy) !== getOriginalsUserId(req.user) && !await requireOriginalProjectManager(req, res, issue.projectId)) return;
    const action = clean(req.body?.action);
    const body = clean(req.body?.body);
    if (!["propose_remedy", "request_amendments", "resolve", "confirm_retraction"].includes(action) || !body) return res.status(400).json({ success: false, message: "Choose an action and add a note" });
    const actorId = objectId(getOriginalsUserId(req.user));
    const type = action === "propose_remedy" ? "response" : action === "request_amendments" ? "amendment_request" : "resolution_note";
    issue.messages.push({ authorId: actorId, type, body });
    issue.state = action === "propose_remedy" ? "remedy_proposed" : action === "request_amendments" ? "further_amendments" : action === "resolve" ? "resolved" : "retraction_confirmed";
    if (["resolve", "confirm_retraction"].includes(action)) issue.resolvedAt = new Date();
    await issue.save();
    const submission = await originalSubmissionModel.findById(issue.submissionId);
    if (action === "resolve") submission.state = issue.priorSubmissionState;
    if (action === "confirm_retraction") {
      submission.state = "retracted";
      const ids = submission.outputAssetId ? [submission.outputAssetId] : originalTakeAssetIds(submission.takes);
      await originalAssetModel.updateMany({ _id: { $in: ids } }, { $set: { state: "hidden" } });
      await originalProjectModel.updateOne({ _id: submission.projectId }, { $set: { state: "owner_review", currentCreditVersionId: null } });
    }
    await submission.save();
    await audit({ projectId: issue.projectId, roundId: submission.roundId, type: `issue_${action}`, user: req.user, metadata: { issueId: String(issue._id), submissionId: String(submission._id) } });
    return res.json({ success: true, issue, submission });
  } catch (error) {
    console.error("❌ updateOriginalIssue error:", error);
    return res.status(500).json({ success: false, message: "Failed to update concern" });
  }
};

export const accessOriginalAsset = async (req, res) => {
  try {
    const asset = await authoriseOriginalAsset(req);
    const url = cloudinary.utils.private_download_url(
      asset.cloudinaryPublicId,
      asset.cloudinaryFormat || null,
      {
        resource_type: asset.cloudinaryResourceType,
        type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
      },
    );
    const downloadUrl = cloudinary.utils.private_download_url(asset.cloudinaryPublicId, asset.cloudinaryFormat || null, {
      resource_type: asset.cloudinaryResourceType, type: "authenticated", expires_at: Math.floor(Date.now() / 1000) + 300, attachment: true,
    });
    return res.json({ success: true, url, downloadUrl, expiresInSeconds: 300 });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("❌ accessOriginalAsset error:", error);
    return res.status(500).json({ success: false, message: "Failed to grant asset access" });
  }
};

export const reserveOriginalRound = async (req, res) => {
  try {
    const candidate = await originalRoundModel.findById(req.params.roundId);
    const project = candidate ? await originalProjectModel.findById(candidate.projectId).lean() : null;
    if (!project || String(project.currentRoundId) !== String(candidate._id)) return res.status(409).json({ success: false, message: "This is not the current round" });
    const round = await prepareOriginalRoundClock(candidate);
    if (!round || !["open", "reopened"].includes(round.state) || isOriginalRoundExpired(round)) return res.status(409).json({ success: false, message: "This round is closed" });
    const musicianId = objectId(getOriginalsUserId(req.user));
    const now = new Date();
    const roleName = clean(req.body?.roleName || round.roleName);
    const eligible = round.type === "foundation" ? round.eligibleRoles : [round.roleName];
    if (!roleName || !eligible.some((role) => role.toLowerCase() === roleName.toLowerCase())) {
      return res.status(400).json({ success: false, message: "Choose an eligible instrument for this round" });
    }
    const anonymous = req.body?.anonymous === true;
    const creditName = clean(req.body?.creditName);
    if (anonymous && !creditName) return res.status(400).json({ success: false, message: "Anonymous contributors need an artistic name" });
    const agreement = await recordOriginalAgreement({ input: req.body.agreement, projectId: project._id, projectTitle: project.title, musicianId, roleName, type: originalAgreementType(round), now });
    await activateOriginalRoleReservations({ project, round, now });
    const { reservation, round: timedRound } = await createOriginalRecordingReservation({ round, musicianId, roleName, anonymous, creditName, agreementAcceptanceId: agreement._id, now });
    await audit({ projectId: round.projectId, roundId: round._id, reservationId: reservation._id, type: "reservation_created", user: req.user, metadata: { roleName } });
    return res.status(201).json({ success: true, reservation, round: timedRound });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "You already hold an active slot in this round" });
    if (error.status) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
    console.error("❌ reserveOriginalRound error:", error);
    return res.status(500).json({ success: false, message: "Failed to reserve a slot" });
  }
};

export const requestReservationExtension = async (req, res) => {
  try {
    const reservation = await originalReservationModel.findOne({ _id: req.params.reservationId, musicianId: getOriginalsUserId(req.user) });
    if (!reservation) return res.status(404).json({ success: false, message: "Reservation not found" });
    if (!canRequestReservationExtension(reservation)) return res.status(409).json({ success: false, message: "An extension cannot be requested for this reservation" });
    reservation.extensionRequest = { status: "pending", requestedAt: new Date() };
    await reservation.save();
    await audit({ projectId: reservation.projectId, roundId: reservation.roundId, reservationId: reservation._id, type: "extension_requested", user: req.user });
    return res.json({ success: true, reservation });
  } catch (error) {
    console.error("❌ requestReservationExtension error:", error);
    return res.status(500).json({ success: false, message: "Failed to request an extension" });
  }
};

export const decideReservationExtension = async (req, res) => {
  try {
    const reservation = await originalReservationModel.findById(req.params.reservationId);
    if (!reservation || reservation.extensionRequest?.status !== "pending") {
      return res.status(404).json({ success: false, message: "Pending extension request not found" });
    }
    if (!await requireOriginalProjectManager(req, res, reservation.projectId)) return;
    const hours = Number(req.body?.hours);
    if (![12, 24].includes(hours)) return res.status(400).json({ success: false, message: "Choose a 12 or 24 hour extension" });
    reservation.extensionRequest.status = "approved";
    reservation.extensionRequest.decidedAt = new Date();
    reservation.extensionRequest.hours = hours;
    reservation.extensionCount += 1;
    reservation.expiresAt = new Date(reservation.expiresAt.getTime() + hours * 60 * 60 * 1000);
    await reservation.save();
    await audit({ projectId: reservation.projectId, roundId: reservation.roundId, reservationId: reservation._id, type: "extension_approved", user: req.user, metadata: { hours } });
    return res.json({ success: true, reservation });
  } catch (error) {
    console.error("❌ decideReservationExtension error:", error);
    return res.status(500).json({ success: false, message: "Failed to grant extension" });
  }
};

export const submitOriginalTakes = async (req, res) => {
  try {
    const musicianId = objectId(getOriginalsUserId(req.user));
    const reservation = await originalReservationModel.findOne({
      _id: req.params.reservationId, musicianId, state: { $in: ["active", "submitted"] }, expiresAt: { $gt: new Date() },
    });
    if (!reservation) return res.status(409).json({ success: false, message: "This reservation has expired or is unavailable" });
    const round = await originalRoundModel.findById(reservation.roundId).lean();
    if (!round || String(round.projectId) !== String(reservation.projectId)) return res.status(409).json({ success: false, message: "The reservation round is unavailable" });
    if (!["open", "reopened", "review"].includes(round.state) || round.closeReason === "next_round_opened") return res.status(409).json({ success: false, message: "This round has closed; it no longer accepts submissions" });
    const listeningMixRequired = originalTakeNeedsListeningMix(round);
    const takes = Array.isArray(req.body?.takes) ? req.body.takes : [];
    if (takes.length > 4) return res.status(400).json({ success: false, message: "Choose up to four stems" });
    if (!takes.length) return res.status(400).json({ success: false, message: "Submit at least one take" });
    const songwritingChoice = clean(req.body?.songwritingChoice);
    if (!["master_only", "songwriting_claim"].includes(songwritingChoice)) {
      return res.status(400).json({ success: false, message: "Choose your songwriting credit preference" });
    }
    const assetIds = originalTakeAssetIds(takes).map(objectId);
    if (assetIds.some((id) => !id)) return res.status(400).json({ success: false, message: "Choose valid stem and listening mix files" });
    const assets = await originalAssetModel.find({ _id: { $in: assetIds }, reservationId: reservation._id, ownerId: musicianId, state: "active" }).lean();
    if (assets.length !== new Set(assetIds).size) return res.status(400).json({ success: false, message: "One or more take files are unavailable" });
    if (!originalTakeKindsValid(takes, assets, { listeningMixRequired })) {
      return res.status(400).json({ success: false, message: listeningMixRequired ? "Each take requires a stem and its listening mix" : "Choose valid stems and any optional listening mixes" });
    }
    await requireOriginalStemReviews({ assets, musicianId });
    const submission = await originalSubmissionCommit.run({ reservationId: reservation._id, musicianId, payload: {
      projectId: reservation.projectId, roundId: reservation.roundId, reservationId: reservation._id,
      musicianId, roleName: reservation.roleName, songwritingChoice, listeningMixRequired, ownerNotificationPending: true, submitterConfirmationPending: true,
      anonymous: reservation.anonymous, creditName: reservation.creditName,
      takes: takes.map((take, index) => ({ label: clean(take.label) || `Take ${index + 1}`, stemAssetId: take.stemAssetId, mixdownAssetId: take.mixdownAssetId || null, stemAssetIds: take.stemAssetIds || [take.stemAssetId], wetStemAssetId: take.wetStemAssetId || null, effects: take.effects || 'not_specified', notes: clean(take.notes) })),
      notes: clean(req.body?.notes),
    } });
    try { await originalStemChatActivity.publish(submission); }
    catch (error) { console.error('Originals submitted stem chat update will retry:', error.message); }
    await audit({ projectId: reservation.projectId, roundId: reservation.roundId, reservationId: reservation._id, type: "submission_received", user: req.user, metadata: { submissionId: String(submission._id), takeCount: takes.length, songwritingChoice } });
    return res.status(201).json({ success: true, submission });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message, ...(error.code ? { code: error.code, assetId: error.assetId } : {}) });
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "This reservation has already been submitted" });
    console.error("❌ submitOriginalTakes error:", error);
    return res.status(500).json({ success: false, message: "Failed to submit takes" });
  }
};

export const decideOriginalSubmission = async (req, res) => {
  try {
    const submission = await originalSubmissionModel.findById(req.params.submissionId);
    if (!submission || submission.state !== "submitted") {
      return res.status(404).json({ success: false, message: "Pending submission not found" });
    }
    if (!await requireOriginalProjectManager(req, res, submission.projectId)) return;
    if (submission.revisionSession?.status === 'editing') return res.status(409).json({ success: false, message: 'The contributor is revising this recording. Wait for their updated submission or revision deadline.' });
    if (submission.revisionRequest?.status === 'pending') return res.status(409).json({ success: false, message: 'Approve or decline the pending revision request before deciding this submission' });
    submission.$where = { state: "submitted", revision: submission.revision, 'revisionSession.status': { $ne: 'editing' }, 'revisionRequest.status': { $ne: 'pending' } };
    const decision = clean(req.body?.decision).toLowerCase();
    if (!["accept", "reject"].includes(decision)) {
      return res.status(400).json({ success: false, message: "Choose accept or reject" });
    }
    const note = clean(req.body?.note);
    if (decision === "reject" && !note) {
      return res.status(400).json({ success: false, message: "Add a short rejection note" });
    }

    if (decision === "accept") {
      const mode = clean(req.body?.selectionMode);
      const isProduction = ["mix", "master"].includes(submission.category);
      if (!["whole_take", "selected_ranges"].includes(mode)) {
        return res.status(400).json({ success: false, message: "Choose a whole take or selected time ranges" });
      }
      if (isProduction && mode !== "whole_take") {
        return res.status(400).json({ success: false, message: "Mix and master outputs are approved as complete files" });
      }
      const takeIds = new Set(submission.takes.map((take) => String(take._id)));
      if (mode === "whole_take") {
        const selectedTakeId = objectId(req.body?.selectedTakeId);
        if (!isProduction && !takeIds.has(selectedTakeId)) return res.status(400).json({ success: false, message: "Choose a valid take" });
        submission.selectedTakeId = isProduction ? null : selectedTakeId;
        submission.selectedRanges = [];
      } else {
        const ranges = Array.isArray(req.body?.selectedRanges) ? req.body.selectedRanges : [];
        const valid = ranges.length > 0 && ranges.every((range) => {
          const takeId = objectId(range.takeId);
          const start = Number(range.startSeconds);
          const end = Number(range.endSeconds);
          return takeIds.has(takeId) && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;
        });
        if (!valid) return res.status(400).json({ success: false, message: "Add at least one valid time range" });
        submission.selectedTakeId = null;
        submission.selectedRanges = ranges.map((range) => ({
          takeId: range.takeId,
          startSeconds: Number(range.startSeconds),
          endSeconds: Number(range.endSeconds),
          note: clean(range.note),
        }));
      }
      submission.state = "accepted";
      submission.selectionMode = mode;
    } else {
      submission.state = "rejected";
      submission.selectionMode = "";
      submission.selectedTakeId = null;
      submission.selectedRanges = [];
    }

    submission.decisionNote = note;
    submission.decidedAt = new Date();
    submission.decidedBy = objectId(getOriginalsUserId(req.user)) || null;
    if (submission.state === 'accepted' && (!submission.category || submission.category === 'contribution')) submission.approvedChatPending = true;
    await submission.save();
    if (submission.state === 'rejected') {
      const assetIds = submission.outputAssetId
        ? [submission.outputAssetId]
        : originalTakeAssetIds(submission.takes);
      await originalAssetModel.updateMany({ _id: { $in: assetIds } }, { $set: { state: "hidden" } });
      const round = await originalRoundModel.findById(submission.roundId);
      if (round && round.closeReason !== "next_round_opened" && ["review", "closed"].includes(round.state)) {
        const reopened = await originalRoundModel.findOneAndUpdate(
          { _id: round._id, state: { $in: ["review", "closed"] }, closeReason: { $ne: "next_round_opened" } },
          { $set: { state: "reopened", openedAt: new Date(), closesAt: null, clockStartedAt: null, closedAt: null, closeReason: "reopened_after_rejection" } },
          { new: true },
        );
        if (reopened) await originalProjectModel.updateOne(
          { _id: submission.projectId, currentRoundId: round._id },
          { $set: { state: round.type === "foundation" ? "foundation_open" : "role_round_open" } },
        );
      }
    }
    try { await originalStemChatActivity.publish(submission); }
    catch (error) { console.error('Originals approved stem chat update will retry:', error.message); }
    if (submission.state === "rejected") await originalReservationModel.updateOne({ _id: submission.reservationId }, { $set: { slotHeld: false, state: "released" } });
    try {
      await originalNotificationModel.create({
        projectId: submission.projectId,
        recipientMusicianId: submission.musicianId,
        eventKey: `submission:${submission._id}:${submission.state}`,
        template: submission.state === "accepted" ? "originals_submission_accepted" : "originals_submission_rejected",
        payload: { submissionId: String(submission._id), roleName: submission.roleName, note },
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    await audit({ projectId: submission.projectId, roundId: submission.roundId, reservationId: submission.reservationId, type: `submission_${submission.state}`, user: req.user, metadata: { submissionId: String(submission._id), selectionMode: submission.selectionMode } });
    return res.json({ success: true, submission });
  } catch (error) {
    if (error.name === "DocumentNotFoundError") return res.status(409).json({ success: false, message: "This submission has already changed or its round has closed." });
    console.error("❌ decideOriginalSubmission error:", error);
    return res.status(500).json({ success: false, message: "Failed to review submission" });
  }
};

export const reopenOriginalRound = async (req, res) => {
  try {
    const round = await originalRoundModel.findById(req.params.roundId);
    if (!round) return res.status(404).json({ success: false, message: "Round not found" });
    const project = await requireOriginalProjectManager(req, res, round.projectId);
    if (!project) return;
    if (['foundation', 'instrument'].includes(round.type)) {
      const planned = new Set((project.requestedRoles || []).map(role => clean(role.name).toLowerCase()));
      const roundRoles = round.type === 'foundation' ? round.eligibleRoles || [] : [round.roleName];
      if (roundRoles.some(name => !planned.has(clean(name).toLowerCase()))) return res.status(409).json({ success: false, message: 'This round includes a part removed from the project. Add it again or open a stage for a current part.' });
    }
    if (["open", "reopened"].includes(round.state)) return res.status(409).json({ success: false, message: "Round is already open" });
    round.state = "reopened";
    round.openedAt = new Date();
    round.closesAt = null;
    round.clockStartedAt = null;
    round.closedAt = null;
    round.closeReason = clean(req.body?.reason) || "reopened_by_owner";
    await round.save();
    await originalProjectModel.updateOne(
      { _id: round.projectId },
      { $set: { state: round.type === "foundation" ? "foundation_open" : "role_round_open", currentRoundId: round._id } },
    );
    await audit({ projectId: round.projectId, roundId: round._id, type: "round_reopened", user: req.user, metadata: { reason: round.closeReason } });
    return res.json({ success: true, round });
  } catch (error) {
    console.error("❌ reopenOriginalRound error:", error);
    return res.status(500).json({ success: false, message: "Failed to reopen round" });
  }
};

export const openNextOriginalRound = async (req, res) => {
  try {
    const project = await originalProjectModel.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: "Originals project not found" });
    if (!canManageOriginalProject(project, req.user)) return res.status(403).json({ success: false, message: "Only the project owner or TSC can open stages" });
    const type = clean(req.body?.type).toLowerCase();
    if (!["instrument", "mix", "master"].includes(type)) {
      return res.status(400).json({ success: false, message: "Choose an instrument, mix or master round" });
    }
    const result = await advanceOriginalRound({ projectId: project._id, fromRoundId: req.body?.fromRoundId || project.currentRoundId, type, roleName: clean(req.body?.roleName), user: req.user });
    // Advance places activate only after the transition has committed. The worker
    // retries this linkage if a temporary error interrupts activation.
    try { await activateOriginalRoleReservations({ project: result.project, round: result.round }); }
    catch (error) { console.error("Next-round advance places will retry activation:", error.message); }
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "The next round already exists" });
    console.error("❌ openNextOriginalRound error:", error);
    return res.status(500).json({ success: false, message: "Failed to open next round" });
  }
};

export const inviteOriginalMusician = async (req, res) => {
  try {
    const round = await originalRoundModel.findOne({ _id: req.params.roundId, state: { $in: ["open", "reopened"] } });
    if (!round) return res.status(409).json({ success: false, message: "Invitations require an open round" });
    if (!await requireOriginalProjectManager(req, res, round.projectId)) return;
    const invitedMusicianId = objectId(req.body?.musicianId);
    const musician = invitedMusicianId ? await musicianModel.findById(invitedMusicianId).select("_id firstName lastName email privateTestProfile profileDeletedAt") : null;
    if (!musician || !canSeeMusicianInDirectory(musician, req.user)) return res.status(404).json({ success: false, message: "Musician not found" });
    const roleName = clean(req.body?.roleName || round.roleName);
    if (!eligibleRoundRoles(round).some(role => clean(role).toLowerCase() === roleName.toLowerCase())) return res.status(400).json({ success: false, message: "Choose an instrument in the current round" });
    const invitation = await originalInvitationModel.create({
      projectId: round.projectId,
      roundId: round._id,
      invitedMusicianId,
      invitedBy: objectId(getOriginalsUserId(req.user)),
      roleName,
      message: clean(req.body?.message),
      expiresAt: round.closesAt,
      emailPending: true,
    });
    await audit({ projectId: round.projectId, roundId: round._id, type: "private_invitation_created", user: req.user, metadata: { invitationId: String(invitation._id), invitedMusicianId, roleName } });
    return res.status(201).json({ success: true, invitation });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "This musician is already invited to the round" });
    console.error("❌ inviteOriginalMusician error:", error);
    return res.status(500).json({ success: false, message: "Failed to create invitation" });
  }
};

export const searchOriginalMusicians = async (req, res) => {
  try {
    if (req.path === '/musicians/for-project') return res.json(await browseOriginalMusicians(req.query, { viewer: req.user }));
    if (!objectId(req.query?.projectId)) return res.status(400).json({ success: false, message: "Choose a project before searching musicians" });
    if (!await requireOriginalProjectManager(req, res, req.query.projectId)) return;
    return res.json(await browseOriginalMusicians(req.query, { allowEmail: true, viewer: req.user }));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("❌ searchOriginalMusicians error:", error);
    return res.status(500).json({ success: false, message: "Failed to search musicians" });
  }
};

export const submitOriginalProduction = async (req, res) => {
  try {
    const musicianId = objectId(getOriginalsUserId(req.user));
    const reservation = await originalReservationModel.findOne({
      _id: req.params.reservationId, musicianId, state: { $in: ["active", "submitted"] }, expiresAt: { $gt: new Date() },
    });
    if (!reservation) return res.status(409).json({ success: false, message: "This reservation has expired or is unavailable" });
    const round = await originalRoundModel.findById(reservation.roundId);
    if (!round || !["mix", "master"].includes(round.type)) {
      return res.status(400).json({ success: false, message: "This is not a mix or master reservation" });
    }
    if (!["open", "reopened", "review"].includes(round.state) || round.closeReason === "next_round_opened") return res.status(409).json({ success: false, message: "This round has closed; it no longer accepts submissions" });
    const outputAssetId = objectId(req.body?.outputAssetId);
    const expectedKind = round.type;
    const asset = await originalAssetModel.findOne({ _id: outputAssetId, reservationId: reservation._id, ownerId: musicianId, kind: expectedKind, state: "active" });
    if (!asset) return res.status(400).json({ success: false, message: `Upload the ${expectedKind} output first` });
    const submission = await originalSubmissionCommit.run({ reservationId: reservation._id, musicianId, payload: {
      projectId: reservation.projectId,
      roundId: reservation.roundId,
      reservationId: reservation._id,
      musicianId,
      roleName: reservation.roleName,
      category: round.type,
      ownerNotificationPending: true, submitterConfirmationPending: true,
      outputAssetId: asset._id,
      songwritingChoice: "master_only",
      anonymous: reservation.anonymous,
      creditName: reservation.creditName,
      takes: [],
      notes: clean(req.body?.notes),
    } });
    await audit({ projectId: reservation.projectId, roundId: reservation.roundId, reservationId: reservation._id, type: `${round.type}_submitted`, user: req.user, metadata: { submissionId: String(submission._id), assetId: String(asset._id) } });
    return res.status(201).json({ success: true, submission });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "This reservation has already been submitted" });
    console.error("❌ submitOriginalProduction error:", error);
    return res.status(500).json({ success: false, message: "Failed to submit production output" });
  }
};

export const getOriginalMessages = async (req, res) => {
  try {
    if (!await originalProjectModel.exists({ _id: req.params.id })) return res.status(404).json({ success: false, message: "Originals project not found" });
    const messages = await originalMessageModel.find({ projectId: req.params.id }).sort({ createdAt: -1, _id: -1 }).limit(500).populate("attachmentIds", "kind originalName mimeType bytes state").lean();
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, messages: messages.reverse() });
  } catch (error) {
    console.error("Originals chat load failed:", error);
    return res.status(500).json({ success: false, message: "Could not refresh chat" });
  }
};

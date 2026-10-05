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
  getOriginalsUserId,
  getReservationExpiry,
} from "../services/originalsPolicyService.js";

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
  "initial_stem", "guide_track", "demo", "voice_note", "video_submission", "click_track", "take_stem", "take_mixdown", "mix", "master",
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
        resource_type: "video",
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
    const [rounds, reservations, submissions, assets, notifications, invitations, creditVersions, issues, messages] = await Promise.all([
      originalRoundModel.find({ projectId: project._id }).sort({ sequence: 1 }).lean(),
      originalReservationModel.find({ projectId: project._id }).sort({ createdAt: -1 }).lean(),
      originalSubmissionModel.find({ projectId: project._id }).sort({ submittedAt: -1 }).lean(),
      originalAssetModel.find({ projectId: project._id, state: { $ne: "deleted" } })
        .select("kind originalName mimeType bytes state ownerId roundId reservationId createdAt")
        .sort({ createdAt: -1 }).lean(),
      originalNotificationModel.find({ projectId: project._id }).sort({ createdAt: -1 }).limit(50).lean(),
      originalInvitationModel.find({ projectId: project._id })
        .populate("invitedMusicianId", "firstName lastName email instrument")
        .sort({ createdAt: -1 }).lean(),
      originalCreditVersionModel.find({ projectId: project._id }).sort({ version: -1 }).lean(),
      originalIssueModel.find({ projectId: project._id }).sort({ createdAt: -1 }).lean(),
      originalMessageModel.find({ projectId: project._id }).sort({ createdAt: 1 }).limit(500).lean(),
    ]);
    return res.json({ success: true, project, rounds, reservations, submissions, assets, notifications, invitations, creditVersions, issues, messages });
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
    if (!ASSET_KINDS.has(kind)) return res.status(400).json({ success: false, message: "Invalid asset type" });
    if (![...AUDIO_MIMES, ...VIDEO_MIMES].includes(req.file.mimetype)) {
      return res.status(415).json({ success: false, message: "Use WAV, MP3, AIFF, FLAC, M4A, MP4 or MOV" });
    }
    if (VIDEO_MIMES.has(req.file.mimetype) && !["demo", "video_submission"].includes(kind)) {
      return res.status(415).json({ success: false, message: "Video is only allowed for project demos" });
    }

    const ownerId = objectId(getOriginalsUserId(req.user));
    const roundId = objectId(req.body?.roundId) || null;
    const reservationId = objectId(req.body?.reservationId) || null;
    if (["take_stem", "take_mixdown"].includes(kind) && !reservationId) {
      return res.status(400).json({ success: false, message: "A reservation is required for take uploads" });
    }
    if (reservationId) {
      const reservation = await originalReservationModel.findOne({
        _id: reservationId, projectId: project._id, musicianId: ownerId, state: { $in: ["active", "submitted"] },
      });
      if (!reservation || (reservation.state === "active" && reservation.expiresAt <= new Date())) {
        return res.status(409).json({ success: false, message: "This reservation is not active" });
      }
    }

    const uploaded = await uploadAuthenticated(req.file, project._id);
    const asset = await originalAssetModel.create({
      projectId: project._id,
      roundId,
      reservationId,
      ownerId,
      kind,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      bytes: req.file.size,
      cloudinaryPublicId: uploaded.public_id,
      cloudinaryResourceType: uploaded.resource_type || "video",
      cloudinaryFormat: uploaded.format || "",
      deliveryType: "authenticated",
      finalEligible: !["guide_track", "demo", "voice_note", "video_submission", "click_track", "take_mixdown"].includes(kind),
    });
    if (["initial_stem", "guide_track", "demo", "video_submission", "voice_note", "click_track"].includes(kind)) {
      project.initialAssetIds.addToSet(asset._id);
      if (kind === "initial_stem") {
        project.hasInitialStem = true;
        project.sourceType = "final_eligible_stem";
        project.ownerSongwritingClaim = true;
      }
      if (kind === "guide_track") {
        project.sourceType = "guide_track";
        project.hasInitialStem = true;
        project.ownerSongwritingClaim = true;
      }
      if (kind === "video_submission") {
        project.sourceType = "video_demo";
        project.ownerSongwritingClaim = req.body?.songwritingClaim === "true";
      }
      await project.save();
    }
    await audit({ projectId: project._id, roundId, reservationId, type: "asset_uploaded", user: req.user, metadata: { assetId: String(asset._id), kind } });
    return res.status(201).json({ success: true, asset: { _id: asset._id, kind, originalName: asset.originalName, bytes: asset.bytes } });
  } catch (error) {
    console.error("❌ uploadOriginalAsset error:", error);
    return res.status(500).json({ success: false, message: "Private upload failed" });
  }
};

export const postOriginalMessage = async (req, res) => {
  try {
    const project = await originalProjectModel.findById(req.params.id).lean();
    if (!project) return res.status(404).json({ success: false, message: "Originals project not found" });
    const body = clean(req.body?.body);
    const voiceAssetId = objectId(req.body?.voiceAssetId) || null;
    if (!body && !voiceAssetId) return res.status(400).json({ success: false, message: "Write a message or attach a voice note" });
    if (voiceAssetId) {
      const voice = await originalAssetModel.findOne({ _id: voiceAssetId, projectId: project._id, kind: "voice_note", state: "active" });
      if (!voice) return res.status(400).json({ success: false, message: "Voice note is unavailable" });
    }
    const message = await originalMessageModel.create({
      projectId: project._id,
      authorId: objectId(getOriginalsUserId(req.user)),
      body,
      voiceAssetId,
      authorAnonymous: req.body?.anonymous === true,
      authorCreditName: clean(req.body?.creditName),
    });
    const participantIds = await originalSubmissionModel.distinct("musicianId", {
      projectId: project._id,
      state: { $nin: ["rejected", "withdrawn", "retracted"] },
    });
    const reservedIds = await originalReservationModel.distinct("musicianId", {
      projectId: project._id,
      state: { $in: ["active", "submitted"] },
    });
    const authorId = String(objectId(getOriginalsUserId(req.user)) || "");
    const recipientIds = [...new Set([
      String(project.ownerId || ""),
      ...participantIds.map(String),
      ...reservedIds.map(String),
    ])].filter((id) => objectId(id) && id !== authorId);
    if (recipientIds.length) {
      await originalNotificationModel.insertMany(
        recipientIds.map((recipientMusicianId) => ({
          projectId: project._id,
          recipientMusicianId,
          eventKey: `group-message:${message._id}:${recipientMusicianId}`,
          channels: ["whatsapp"],
          template: "originals_group_chat_message",
          payload: {
            messageId: String(message._id),
            projectId: String(project._id),
            projectTitle: project.title,
            preview: body.slice(0, 240),
            hasVoiceNote: Boolean(voiceAssetId),
          },
        })),
        { ordered: false },
      ).catch((error) => {
        if (error?.code !== 11000 && !error?.writeErrors?.every((item) => item?.code === 11000)) throw error;
      });
    }
    await audit({ projectId: project._id, type: "group_message_posted", user: req.user, metadata: { messageId: String(message._id), hasVoiceNote: Boolean(voiceAssetId) } });
    return res.status(201).json({ success: true, message });
  } catch (error) {
    console.error("❌ postOriginalMessage error:", error);
    return res.status(500).json({ success: false, message: "Failed to post message" });
  }
};

export const replaceOriginalSubmission = async (req, res) => {
  try {
    const submission = await originalSubmissionModel.findById(req.params.submissionId);
    if (!submission || submission.state !== "submitted") return res.status(409).json({ success: false, message: "Only a pending submission can be replaced" });
    const round = await originalRoundModel.findById(submission.roundId).lean();
    const laterRound = await originalRoundModel.exists({ projectId: submission.projectId, sequence: { $gt: round.sequence } });
    if (laterRound) return res.status(409).json({ success: false, message: "This project has moved to the next stage; open a concern instead" });
    const takes = Array.isArray(req.body?.takes) ? req.body.takes.slice(0, 3) : [];
    if (!takes.length) return res.status(400).json({ success: false, message: "Add at least one replacement take" });
    const assetIds = takes.flatMap((take) => [take.stemAssetId, take.mixdownAssetId]).map(objectId);
    const assets = await originalAssetModel.find({ _id: { $in: assetIds }, reservationId: submission.reservationId, ownerId: submission.musicianId, state: "active" }).lean();
    if (assets.length !== new Set(assetIds).size) return res.status(400).json({ success: false, message: "Replacement files are unavailable" });
    const kinds = new Map(assets.map((asset) => [String(asset._id), asset.kind]));
    if (takes.some((take) => kinds.get(String(take.stemAssetId)) !== "take_stem" || kinds.get(String(take.mixdownAssetId)) !== "take_mixdown")) return res.status(400).json({ success: false, message: "Each replacement needs a stem and mixdown" });
    const oldAssetIds = submission.takes.flatMap((take) => [take.stemAssetId, take.mixdownAssetId]);
    await originalAssetModel.updateMany({ _id: { $in: oldAssetIds } }, { $set: { state: "hidden" } });
    submission.takes = takes.map((take, index) => ({ label: clean(take.label) || `Take ${index + 1}`, stemAssetId: take.stemAssetId, mixdownAssetId: take.mixdownAssetId, notes: clean(take.notes) }));
    submission.revision += 1;
    submission.notes = clean(req.body?.notes);
    await submission.save();
    await audit({ projectId: submission.projectId, roundId: submission.roundId, reservationId: submission.reservationId, type: "submission_replaced", user: req.user, metadata: { submissionId: String(submission._id), revision: submission.revision } });
    return res.json({ success: true, submission });
  } catch (error) {
    console.error("❌ replaceOriginalSubmission error:", error);
    return res.status(500).json({ success: false, message: "Failed to replace submission" });
  }
};

export const openOriginalIssue = async (req, res) => {
  try {
    const submission = await originalSubmissionModel.findById(req.params.submissionId);
    if (!submission || !["submitted", "accepted"].includes(submission.state)) return res.status(404).json({ success: false, message: "Submission is unavailable" });
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
      const ids = submission.outputAssetId ? [submission.outputAssetId] : submission.takes.flatMap((take) => [take.stemAssetId, take.mixdownAssetId]);
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
    const asset = await originalAssetModel.findById(req.params.assetId).lean();
    if (!asset || asset.state !== "active") return res.status(404).json({ success: false, message: "Asset not found" });
    const url = cloudinary.utils.private_download_url(
      asset.cloudinaryPublicId,
      asset.cloudinaryFormat || null,
      {
        resource_type: asset.cloudinaryResourceType,
        type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
      },
    );
    return res.json({ success: true, url, expiresInSeconds: 300 });
  } catch (error) {
    console.error("❌ accessOriginalAsset error:", error);
    return res.status(500).json({ success: false, message: "Failed to grant asset access" });
  }
};

export const reserveOriginalRound = async (req, res) => {
  try {
    const round = await originalRoundModel.findOne({ _id: req.params.roundId, state: { $in: ["open", "reopened"] } });
    if (!round || round.closesAt <= new Date()) return res.status(409).json({ success: false, message: "This round is closed" });
    const musicianId = objectId(getOriginalsUserId(req.user));
    const now = new Date();
    await originalReservationModel.updateMany(
      { roundId: round._id, state: "active", expiresAt: { $lte: now } },
      { $set: { state: "expired" } },
    );
    const activeCount = await originalReservationModel.countDocuments({ roundId: round._id, state: "active", expiresAt: { $gt: now } });
    if (activeCount >= round.slotLimit) return res.status(409).json({ success: false, message: "All three slots are currently reserved" });
    const roleName = clean(req.body?.roleName || round.roleName);
    const eligible = round.type === "foundation" ? round.eligibleRoles : [round.roleName];
    if (!roleName || !eligible.some((role) => role.toLowerCase() === roleName.toLowerCase())) {
      return res.status(400).json({ success: false, message: "Choose an eligible instrument for this round" });
    }
    const anonymous = req.body?.anonymous === true;
    const creditName = clean(req.body?.creditName);
    if (anonymous && !creditName) return res.status(400).json({ success: false, message: "Anonymous contributors need an artistic name" });
    const reservation = await originalReservationModel.create({
      projectId: round.projectId, roundId: round._id, musicianId, roleName, anonymous, creditName,
      reservedAt: now, expiresAt: getReservationExpiry(now),
    });
    await audit({ projectId: round.projectId, roundId: round._id, reservationId: reservation._id, type: "reservation_created", user: req.user, metadata: { roleName } });
    return res.status(201).json({ success: true, reservation });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "You already hold an active slot in this round" });
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
      _id: req.params.reservationId, musicianId, state: "active", expiresAt: { $gt: new Date() },
    });
    if (!reservation) return res.status(409).json({ success: false, message: "This reservation has expired or is unavailable" });
    const takes = Array.isArray(req.body?.takes) ? req.body.takes.slice(0, 3) : [];
    if (!takes.length) return res.status(400).json({ success: false, message: "Submit at least one take" });
    const songwritingChoice = clean(req.body?.songwritingChoice);
    if (!["master_only", "songwriting_claim"].includes(songwritingChoice)) {
      return res.status(400).json({ success: false, message: "Choose your songwriting credit preference" });
    }
    const assetIds = takes.flatMap((take) => [take.stemAssetId, take.mixdownAssetId]).map(objectId);
    if (assetIds.some((id) => !id)) return res.status(400).json({ success: false, message: "Every take needs a stem and mixdown" });
    const assets = await originalAssetModel.find({ _id: { $in: assetIds }, reservationId: reservation._id, ownerId: musicianId, state: "active" }).lean();
    if (assets.length !== new Set(assetIds).size) return res.status(400).json({ success: false, message: "One or more take files are unavailable" });
    const kinds = new Map(assets.map((asset) => [String(asset._id), asset.kind]));
    if (takes.some((take) => kinds.get(String(take.stemAssetId)) !== "take_stem" || kinds.get(String(take.mixdownAssetId)) !== "take_mixdown")) {
      return res.status(400).json({ success: false, message: "Each take requires the correct stem and mixdown files" });
    }
    const submission = await originalSubmissionModel.create({
      projectId: reservation.projectId, roundId: reservation.roundId, reservationId: reservation._id,
      musicianId, roleName: reservation.roleName, songwritingChoice,
      anonymous: reservation.anonymous, creditName: reservation.creditName,
      takes: takes.map((take, index) => ({ label: clean(take.label) || `Take ${index + 1}`, stemAssetId: take.stemAssetId, mixdownAssetId: take.mixdownAssetId, notes: clean(take.notes) })),
      notes: clean(req.body?.notes),
    });
    reservation.state = "submitted";
    await reservation.save();
    await audit({ projectId: reservation.projectId, roundId: reservation.roundId, reservationId: reservation._id, type: "submission_received", user: req.user, metadata: { submissionId: String(submission._id), takeCount: takes.length, songwritingChoice } });
    return res.status(201).json({ success: true, submission });
  } catch (error) {
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
      const assetIds = submission.outputAssetId
        ? [submission.outputAssetId]
        : submission.takes.flatMap((take) => [take.stemAssetId, take.mixdownAssetId]);
      await originalAssetModel.updateMany({ _id: { $in: assetIds } }, { $set: { state: "hidden" } });
      const round = await originalRoundModel.findById(submission.roundId);
      if (round && ["review", "closed"].includes(round.state)) {
        round.state = "reopened";
        round.openedAt = new Date();
        round.closesAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        round.closedAt = null;
        round.closeReason = "reopened_after_rejection";
        await round.save();
        await originalProjectModel.updateOne(
          { _id: submission.projectId },
          { $set: { state: round.type === "foundation" ? "foundation_open" : "role_round_open" } },
        );
      }
    }

    submission.decisionNote = note;
    submission.decidedAt = new Date();
    submission.decidedBy = objectId(getOriginalsUserId(req.user)) || null;
    await submission.save();
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
    console.error("❌ decideOriginalSubmission error:", error);
    return res.status(500).json({ success: false, message: "Failed to review submission" });
  }
};

export const reopenOriginalRound = async (req, res) => {
  try {
    const round = await originalRoundModel.findById(req.params.roundId);
    if (!round) return res.status(404).json({ success: false, message: "Round not found" });
    if (["open", "reopened"].includes(round.state)) return res.status(409).json({ success: false, message: "Round is already open" });
    round.state = "reopened";
    round.openedAt = new Date();
    round.closesAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
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
    const type = clean(req.body?.type).toLowerCase();
    if (!["instrument", "mix", "master"].includes(type)) {
      return res.status(400).json({ success: false, message: "Choose an instrument, mix or master round" });
    }
    const acceptedQuery = { projectId: project._id, state: "accepted" };
    if (type === "mix") acceptedQuery.category = "contribution";
    if (type === "master") acceptedQuery.category = "mix";
    if (await originalSubmissionModel.countDocuments(acceptedQuery) < 1) {
      return res.status(409).json({ success: false, message: type === "master" ? "Accept a mix before opening mastering" : "Accept material before opening the next stage" });
    }
    let roleName = clean(req.body?.roleName);
    if (type === "instrument") {
      const requested = project.requestedRoles.map((role) => role.name);
      if (!requested.some((role) => role.toLowerCase() === roleName.toLowerCase())) {
        return res.status(400).json({ success: false, message: "Choose one of the project's requested roles" });
      }
    } else roleName = type === "mix" ? "Mix producer" : "Mastering engineer";

    await originalRoundModel.updateMany(
      { projectId: project._id, state: { $in: ["open", "reopened", "review"] } },
      { $set: { state: "closed", closedAt: new Date(), closeReason: "next_round_opened" } },
    );
    const lastRound = await originalRoundModel.findOne({ projectId: project._id }).sort({ sequence: -1 }).lean();
    const round = await originalRoundModel.create({
      projectId: project._id,
      type,
      sequence: Number(lastRound?.sequence ?? -1) + 1,
      roleName,
      state: "open",
      slotLimit: 3,
      openedAt: new Date(),
      closesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    project.currentRoundId = round._id;
    project.state = type === "instrument" ? "role_round_open" : type === "mix" ? "mix_open" : "master_open";
    await project.save();
    await audit({ projectId: project._id, roundId: round._id, type: "round_opened", user: req.user, metadata: { roundType: type, roleName } });
    return res.status(201).json({ success: true, round, project });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "The next round already exists" });
    console.error("❌ openNextOriginalRound error:", error);
    return res.status(500).json({ success: false, message: "Failed to open next round" });
  }
};

export const inviteOriginalMusician = async (req, res) => {
  try {
    const round = await originalRoundModel.findOne({ _id: req.params.roundId, state: { $in: ["open", "reopened"] } });
    if (!round) return res.status(409).json({ success: false, message: "Invitations require an open round" });
    const invitedMusicianId = objectId(req.body?.musicianId);
    const musician = invitedMusicianId ? await musicianModel.findById(invitedMusicianId).select("_id firstName lastName email") : null;
    if (!musician) return res.status(404).json({ success: false, message: "Musician not found" });
    const roleName = clean(req.body?.roleName || round.roleName);
    const invitation = await originalInvitationModel.create({
      projectId: round.projectId,
      roundId: round._id,
      invitedMusicianId,
      invitedBy: objectId(getOriginalsUserId(req.user)),
      roleName,
      message: clean(req.body?.message),
      expiresAt: round.closesAt,
    });
    try {
      await originalNotificationModel.create({
        projectId: round.projectId,
        recipientMusicianId: invitedMusicianId,
        eventKey: `invitation:${invitation._id}:created`,
        template: "originals_private_invitation",
        payload: { invitationId: String(invitation._id), roleName, message: invitation.message },
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
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
    const query = clean(req.query?.q);
    if (query.length < 2) return res.json({ success: true, musicians: [] });
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "i");
    const musicians = await musicianModel.find({
      $or: [
        { firstName: pattern },
        { lastName: pattern },
        { email: pattern },
        { instrument: pattern },
        { instruments: pattern },
      ],
    }).select("firstName lastName email instrument instruments").limit(20).lean();
    return res.json({ success: true, musicians });
  } catch (error) {
    console.error("❌ searchOriginalMusicians error:", error);
    return res.status(500).json({ success: false, message: "Failed to search musicians" });
  }
};

export const submitOriginalProduction = async (req, res) => {
  try {
    const musicianId = objectId(getOriginalsUserId(req.user));
    const reservation = await originalReservationModel.findOne({
      _id: req.params.reservationId, musicianId, state: "active", expiresAt: { $gt: new Date() },
    });
    if (!reservation) return res.status(409).json({ success: false, message: "This reservation has expired or is unavailable" });
    const round = await originalRoundModel.findById(reservation.roundId);
    if (!round || !["mix", "master"].includes(round.type)) {
      return res.status(400).json({ success: false, message: "This is not a mix or master reservation" });
    }
    const outputAssetId = objectId(req.body?.outputAssetId);
    const expectedKind = round.type;
    const asset = await originalAssetModel.findOne({ _id: outputAssetId, reservationId: reservation._id, ownerId: musicianId, kind: expectedKind, state: "active" });
    if (!asset) return res.status(400).json({ success: false, message: `Upload the ${expectedKind} output first` });
    const submission = await originalSubmissionModel.create({
      projectId: reservation.projectId,
      roundId: reservation.roundId,
      reservationId: reservation._id,
      musicianId,
      roleName: reservation.roleName,
      category: round.type,
      outputAssetId: asset._id,
      songwritingChoice: "master_only",
      anonymous: reservation.anonymous,
      creditName: reservation.creditName,
      takes: [],
      notes: clean(req.body?.notes),
    });
    reservation.state = "submitted";
    await reservation.save();
    await audit({ projectId: reservation.projectId, roundId: reservation.roundId, reservationId: reservation._id, type: `${round.type}_submitted`, user: req.user, metadata: { submissionId: String(submission._id), assetId: String(asset._id) } });
    return res.status(201).json({ success: true, submission });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "This reservation has already been submitted" });
    console.error("❌ submitOriginalProduction error:", error);
    return res.status(500).json({ success: false, message: "Failed to submit production output" });
  }
};

import mongoose from "mongoose";
import musicianModel from "../models/musicianModel.js";
import originalProjectModel from "../models/originalProjectModel.js";
import originalRoundModel from "../models/originalRoundModel.js";
import originalEventModel from "../models/originalEventModel.js";
import {
  ORIGINALS_OWNER_AGREEMENT_VERSION,
  canModerateOriginals,
  getOriginalsUserId,
  normaliseRequestedRoles,
  normaliseStringList,
  validateOriginalProjectForModeration,
} from "../services/originalsPolicyService.js";

const clean = (value) => String(value || "").trim();
const cleanEmail = (value) => clean(value).toLowerCase();

const requireObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(String(value || "")) ? String(value) : "";

const actorMetadata = (user = {}) => ({
  actorId: requireObjectId(getOriginalsUserId(user)) || null,
  actorRole: clean(user?.role || user?.userrole).toLowerCase(),
});

const recordEvent = async ({ projectId, type, user, fromState, toState, reason, metadata }) =>
  originalEventModel.create({
    projectId,
    type,
    ...actorMetadata(user),
    fromState: fromState || "",
    toState: toState || "",
    reason: reason || "",
    metadata: metadata || {},
  });

const presentProject = (project, { includePrivate = false } = {}) => {
  const value = project?.toObject ? project.toObject() : { ...project };
  if (!includePrivate && value.ownerAnonymous) {
    value.ownerId = null;
    value.ownerName = "Anonymous";
    value.ownerEmail = "";
  } else if (!includePrivate) {
    value.ownerEmail = "";
  }
  return value;
};

const canManageProject = (project, user) => {
  if (canModerateOriginals(user)) return true;
  return String(project?.ownerId || "") === getOriginalsUserId(user);
};

const buildProjectFields = (body = {}, { partial = false } = {}) => {
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const fields = {};
  if (!partial || has("title")) fields.title = clean(body.title);
  if (!partial || has("description")) fields.description = clean(body.description);
  if (!partial || has("genres")) fields.genres = normaliseStringList(body.genres);
  if (!partial || has("requestedRoles")) {
    fields.requestedRoles = normaliseRequestedRoles(body.requestedRoles);
  }
  if (!partial || has("hasInitialStem")) fields.hasInitialStem = body.hasInitialStem === true;
  if (!partial || has("ownerAnonymous")) fields.ownerAnonymous = body.ownerAnonymous === true;
  if (!partial || has("ownerCreditName")) fields.ownerCreditName = clean(body.ownerCreditName);
  if (!partial || has("bpm")) {
    fields.bpm = body.bpm === "" || body.bpm == null ? null : Number(body.bpm);
  }
  if (!partial || has("musicalKey")) fields.musicalKey = clean(body.musicalKey);
  if (!partial || has("timeSignature")) fields.timeSignature = clean(body.timeSignature);
  if (!partial || has("originalWorkConfirmed")) {
    fields.originalWorkConfirmed = body.originalWorkConfirmed === true;
  }
  return fields;
};

export const createOriginalProject = async (req, res) => {
  try {
    const ownerId = requireObjectId(getOriginalsUserId(req.user));
    if (!ownerId) {
      return res.status(400).json({ success: false, message: "A valid musician login is required" });
    }

    const musician = await musicianModel
      .findById(ownerId)
      .select("firstName lastName email status")
      .lean();
    if (!musician) {
      return res.status(403).json({ success: false, message: "Your musician profile could not be found" });
    }

    const fields = buildProjectFields(req.body);
    if (!fields.title || !fields.description) {
      return res.status(400).json({
        success: false,
        message: "Project title and description are required",
      });
    }

    const acceptedAgreement = req.body?.ownerAgreementAccepted === true;
    const project = await originalProjectModel.create({
      ...fields,
      ownerId,
      ownerName: [musician.firstName, musician.lastName].filter(Boolean).join(" ").trim(),
      ownerEmail: cleanEmail(musician.email),
      ownerAgreement: {
        version: acceptedAgreement ? ORIGINALS_OWNER_AGREEMENT_VERSION : "",
        accepted: acceptedAgreement,
        acceptedAt: acceptedAgreement ? new Date() : null,
        displayName: clean(req.body?.ownerAgreementDisplayName),
      },
    });

    await recordEvent({
      projectId: project._id,
      type: "project_created",
      user: req.user,
      fromState: "",
      toState: "draft",
    });

    return res.status(201).json({ success: true, project: presentProject(project, { includePrivate: true }) });
  } catch (error) {
    console.error("❌ createOriginalProject error:", error);
    return res.status(500).json({ success: false, message: "Failed to create Originals project" });
  }
};

export const updateOriginalProject = async (req, res) => {
  try {
    const project = await originalProjectModel.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: "Originals project not found" });
    if (!canManageProject(project, req.user)) {
      return res.status(403).json({ success: false, message: "You cannot edit this project" });
    }
    if (!["draft", "changes_requested"].includes(project.state)) {
      return res.status(409).json({ success: false, message: "This project can no longer be edited as a draft" });
    }

    Object.assign(project, buildProjectFields(req.body, { partial: true }));
    if (req.body?.ownerAgreementAccepted === true) {
      project.ownerAgreement = {
        version: ORIGINALS_OWNER_AGREEMENT_VERSION,
        accepted: true,
        acceptedAt: new Date(),
        displayName: clean(req.body?.ownerAgreementDisplayName),
      };
    }
    await project.save();

    await recordEvent({ projectId: project._id, type: "project_updated", user: req.user });
    return res.json({ success: true, project: presentProject(project, { includePrivate: true }) });
  } catch (error) {
    console.error("❌ updateOriginalProject error:", error);
    return res.status(500).json({ success: false, message: "Failed to update Originals project" });
  }
};

export const submitOriginalProjectForModeration = async (req, res) => {
  try {
    const project = await originalProjectModel.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: "Originals project not found" });
    if (String(project.ownerId) !== getOriginalsUserId(req.user)) {
      return res.status(403).json({ success: false, message: "Only the project owner can submit it" });
    }
    if (!["draft", "changes_requested"].includes(project.state)) {
      return res.status(409).json({ success: false, message: "Project is not ready for submission" });
    }

    const validationErrors = validateOriginalProjectForModeration(project);
    if (validationErrors.length) {
      return res.status(400).json({
        success: false,
        message: "Complete the project before submitting it",
        errors: validationErrors,
      });
    }

    const previousState = project.state;
    project.state = "pending_moderation";
    project.moderation.status = "pending";
    project.moderation.submittedAt = new Date();
    project.moderation.reason = "";
    await project.save();
    await recordEvent({
      projectId: project._id,
      type: "project_submitted_for_moderation",
      user: req.user,
      fromState: previousState,
      toState: project.state,
    });

    return res.json({ success: true, project: presentProject(project, { includePrivate: true }) });
  } catch (error) {
    console.error("❌ submitOriginalProjectForModeration error:", error);
    return res.status(500).json({ success: false, message: "Failed to submit Originals project" });
  }
};

export const listOriginalProjects = async (_req, res) => {
  try {
    const projects = await originalProjectModel
      .find({
        state: {
          $in: [
            "live", "foundation_open", "role_round_open", "owner_review",
            "arrangement_locked", "mix_open", "mix_review", "master_open",
            "master_review", "credits_confirmation", "approved_master",
          ],
        },
      })
      .sort({ publishedAt: -1, createdAt: -1 })
      .lean();
    return res.json({ success: true, projects: projects.map((project) => presentProject(project)) });
  } catch (error) {
    console.error("❌ listOriginalProjects error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch Originals projects" });
  }
};

export const listMyOriginalProjects = async (req, res) => {
  try {
    const ownerId = requireObjectId(getOriginalsUserId(req.user));
    if (!ownerId) return res.status(400).json({ success: false, message: "A valid musician login is required" });
    const projects = await originalProjectModel.find({ ownerId }).sort({ updatedAt: -1 }).lean();
    return res.json({ success: true, projects });
  } catch (error) {
    console.error("❌ listMyOriginalProjects error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch your Originals projects" });
  }
};

export const listOriginalsModeration = async (req, res) => {
  try {
    if (!canModerateOriginals(req.user)) {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }
    const projects = await originalProjectModel
      .find({ "moderation.status": { $in: ["pending", "changes_requested"] } })
      .sort({ "moderation.submittedAt": 1, createdAt: 1 })
      .lean();
    return res.json({ success: true, projects });
  } catch (error) {
    console.error("❌ listOriginalsModeration error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch Originals moderation" });
  }
};

export const decideOriginalProjectModeration = async (req, res) => {
  try {
    if (!canModerateOriginals(req.user)) {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }
    const decision = clean(req.body?.decision).toLowerCase();
    if (!["approve", "request_changes", "reject"].includes(decision)) {
      return res.status(400).json({ success: false, message: "Invalid moderation decision" });
    }
    const project = await originalProjectModel.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: "Originals project not found" });
    if (project.moderation?.status !== "pending") {
      return res.status(409).json({ success: false, message: "Project is not awaiting moderation" });
    }

    const previousState = project.state;
    const reason = clean(req.body?.reason);
    project.moderation.decidedAt = new Date();
    project.moderation.decidedBy = requireObjectId(getOriginalsUserId(req.user)) || null;
    project.moderation.reason = reason;

    let round = null;
    if (decision === "approve") {
      const validationErrors = validateOriginalProjectForModeration(project);
      if (validationErrors.length) {
        return res.status(400).json({ success: false, message: "Project is incomplete", errors: validationErrors });
      }
      project.moderation.status = "approved";
      project.state = project.hasInitialStem ? "role_round_open" : "foundation_open";
      project.publishedAt = new Date();
      round = await originalRoundModel.create({
        projectId: project._id,
        type: project.hasInitialStem ? "instrument" : "foundation",
        sequence: 0,
        roleName: project.hasInitialStem ? project.requestedRoles[0]?.name || "" : "",
        eligibleRoles: project.hasInitialStem
          ? []
          : project.requestedRoles.filter((role) => role.foundationEligible).map((role) => role.name),
        state: "open",
        slotLimit: 3,
        openedAt: new Date(),
        closesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      project.currentRoundId = round._id;
    } else if (decision === "request_changes") {
      if (!reason) return res.status(400).json({ success: false, message: "A reason is required" });
      project.moderation.status = "changes_requested";
      project.state = "changes_requested";
    } else {
      if (!reason) return res.status(400).json({ success: false, message: "A reason is required" });
      project.moderation.status = "rejected";
      project.state = "cancelled";
    }

    await project.save();
    await recordEvent({
      projectId: project._id,
      type: `moderation_${decision}`,
      user: req.user,
      fromState: previousState,
      toState: project.state,
      reason,
      metadata: round ? { roundId: String(round._id) } : {},
    });

    return res.json({ success: true, project, round });
  } catch (error) {
    console.error("❌ decideOriginalProjectModeration error:", error);
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "This project has already been opened" });
    }
    return res.status(500).json({ success: false, message: "Failed to moderate Originals project" });
  }
};

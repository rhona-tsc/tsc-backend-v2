import mongoose from "mongoose";
import originalCreditVersionModel from "../models/originalCreditVersionModel.js";
import originalEventModel from "../models/originalEventModel.js";
import originalNotificationModel from "../models/originalNotificationModel.js";
import originalProjectModel from "../models/originalProjectModel.js";
import originalReservationModel from "../models/originalReservationModel.js";
import originalSubmissionModel from "../models/originalSubmissionModel.js";
import { getOriginalsUserId } from "../services/originalsPolicyService.js";
import { calculateOriginalsSplits, totalPercent } from "../services/originalsRoyaltyService.js";

const clean = (value) => String(value || "").trim();
const objectId = (value) => mongoose.Types.ObjectId.isValid(String(value || "")) ? String(value) : "";

export const createOriginalCreditVersion = async (req, res) => {
  try {
    const project = await originalProjectModel.findById(req.params.id).lean();
    if (!project) return res.status(404).json({ success: false, message: "Originals project not found" });
    const submissions = await originalSubmissionModel.find({ projectId: project._id, state: "accepted" }).lean();
    let splits;
    try { splits = calculateOriginalsSplits({ project, acceptedSubmissions: submissions }); }
    catch (error) { return res.status(409).json({ success: false, message: error.message }); }
    if (Math.abs(totalPercent(splits.master) - 100) > 0.00001 || Math.abs(totalPercent(splits.composition) - 100) > 0.00001) {
      return res.status(500).json({ success: false, message: "Credit calculation did not total 100%" });
    }
    const last = await originalCreditVersionModel.findOne({ projectId: project._id }).sort({ version: -1 }).lean();
    const requiredMusicianIds = [...new Set([
      String(project.ownerId),
      ...splits.master.filter((share) => share.recipientId).map((share) => String(share.recipientId)),
      ...splits.composition.filter((share) => share.recipientId).map((share) => String(share.recipientId)),
    ])].filter(objectId);
    const creditVersion = await originalCreditVersionModel.create({
      projectId: project._id,
      version: Number(last?.version || 0) + 1,
      masterShares: splits.master,
      compositionShares: splits.composition,
      sourceSubmissionIds: submissions.map((item) => item._id),
      requiredMusicianIds,
      state: "awaiting_confirmation",
    });
    await originalProjectModel.updateOne({ _id: project._id }, { $set: { currentCreditVersionId: creditVersion._id, state: "credits_confirmation" } });
    await originalEventModel.create({ projectId: project._id, type: "credit_version_created", actorId: objectId(getOriginalsUserId(req.user)) || null, metadata: { creditVersionId: String(creditVersion._id), version: creditVersion.version } });
    return res.status(201).json({ success: true, creditVersion });
  } catch (error) {
    console.error("❌ createOriginalCreditVersion error:", error);
    return res.status(500).json({ success: false, message: "Failed to calculate credits" });
  }
};

export const confirmOriginalCreditVersion = async (req, res) => {
  try {
    const musicianId = objectId(getOriginalsUserId(req.user));
    const version = await originalCreditVersionModel.findById(req.params.versionId);
    if (!version || version.state !== "awaiting_confirmation") return res.status(404).json({ success: false, message: "Open credit version not found" });
    if (!version.requiredMusicianIds.some((id) => String(id) === musicianId)) return res.status(403).json({ success: false, message: "You are not a credited participant in this version" });
    if (!version.confirmations.some((item) => String(item.musicianId) === musicianId)) version.confirmations.push({ musicianId, confirmedAt: new Date() });
    if (version.confirmations.length === version.requiredMusicianIds.length) {
      version.state = "final";
      version.finalisedAt = new Date();
      version.finalisedBy = musicianId;
    }
    await version.save();
    return res.json({ success: true, creditVersion: version });
  } catch (error) {
    console.error("❌ confirmOriginalCreditVersion error:", error);
    return res.status(500).json({ success: false, message: "Failed to confirm credits" });
  }
};

export const finaliseOriginalCreditsAsAdmin = async (req, res) => {
  try {
    const reason = clean(req.body?.reason);
    if (!reason) return res.status(400).json({ success: false, message: "Record why TSC is finalising on participants' behalf" });
    const version = await originalCreditVersionModel.findById(req.params.versionId);
    if (!version || version.state !== "awaiting_confirmation") return res.status(404).json({ success: false, message: "Open credit version not found" });
    version.state = "final";
    version.finalisedAt = new Date();
    version.finalisedBy = objectId(getOriginalsUserId(req.user)) || null;
    version.overrideReason = reason;
    await version.save();
    await originalEventModel.create({ projectId: version.projectId, type: "credits_finalised_by_tsc", actorId: version.finalisedBy, reason, metadata: { creditVersionId: String(version._id) } });
    return res.json({ success: true, creditVersion: version });
  } catch (error) {
    console.error("❌ finaliseOriginalCreditsAsAdmin error:", error);
    return res.status(500).json({ success: false, message: "Failed to finalise credits" });
  }
};

export const completeOriginalProject = async (req, res) => {
  try {
    const project = await originalProjectModel.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: "Originals project not found" });
    const creditVersion = project.currentCreditVersionId ? await originalCreditVersionModel.findById(project.currentCreditVersionId) : null;
    if (!creditVersion || creditVersion.state !== "final") return res.status(409).json({ success: false, message: "Finalise the current credit version first" });
    const acceptedMaster = await originalSubmissionModel.exists({ projectId: project._id, category: "master", state: "accepted" });
    if (!acceptedMaster) return res.status(409).json({ success: false, message: "Accept the final master first" });
    project.state = "approved_master";
    project.completedAt = new Date();
    await project.save();
    await originalEventModel.create({ projectId: project._id, type: "project_completed", actorId: objectId(getOriginalsUserId(req.user)) || null, metadata: { creditVersionId: String(creditVersion._id) } });
    return res.json({ success: true, project, creditVersion });
  } catch (error) {
    console.error("❌ completeOriginalProject error:", error);
    return res.status(500).json({ success: false, message: "Failed to complete project" });
  }
};

export const getOriginalsReadiness = async (_req, res) => {
  try {
    const [states, activeReservations, pendingNotifications, awaitingCredits, completed] = await Promise.all([
      originalProjectModel.aggregate([{ $group: { _id: "$state", count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      originalReservationModel.countDocuments({ state: "active", expiresAt: { $gt: new Date() } }),
      originalNotificationModel.countDocuments({ state: "queued" }),
      originalCreditVersionModel.countDocuments({ state: "awaiting_confirmation" }),
      originalProjectModel.countDocuments({ state: "approved_master" }),
    ]);
    return res.json({ success: true, states, activeReservations, pendingNotifications, awaitingCredits, completed, deliveryEnabled: false });
  } catch (error) {
    console.error("❌ getOriginalsReadiness error:", error);
    return res.status(500).json({ success: false, message: "Failed to load readiness dashboard" });
  }
};

export const getOriginalsMusicianStats = async (req, res) => {
  try {
    const musicianId = objectId(req.params.musicianId);
    if (!musicianId) return res.status(400).json({ success: false, message: "Invalid musician ID" });
    const submissions = await originalSubmissionModel.find({ musicianId }).select("projectId category state roleName").lean();
    const accepted = submissions.filter((item) => item.state === "accepted");
    const publicCollaborators = await originalSubmissionModel.distinct("musicianId", { projectId: { $in: accepted.map((item) => item.projectId) }, state: "accepted", musicianId: { $ne: musicianId }, anonymous: false });
    return res.json({
      success: true,
      stats: {
        submissions: submissions.length,
        accepted: accepted.length,
        projectsContributedTo: new Set(accepted.map((item) => String(item.projectId))).size,
        roles: [...new Set(accepted.map((item) => item.roleName))],
        mixesAccepted: accepted.filter((item) => item.category === "mix").length,
        mastersAccepted: accepted.filter((item) => item.category === "master").length,
        publicCollaboratorCount: publicCollaborators.length,
      },
    });
  } catch (error) {
    console.error("❌ getOriginalsMusicianStats error:", error);
    return res.status(500).json({ success: false, message: "Failed to calculate musician statistics" });
  }
};

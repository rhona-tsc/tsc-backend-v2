import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import musicianModel from "../models/musicianModel.js";
import musicianVideoSubmissionModel from "../models/musicianVideoSubmissionModel.js";
import { extractModerationFlags, getAzureVideoIndex, submitVideoToAzure } from "../services/videoModerationService.js";
import { buildAnonymousYoutubeMetadata, publishVideoToYoutube } from "../services/youtubeVideoService.js";

const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const clean = (value = "") => String(value || "").trim();

const requesterId = (req) => clean(req.user?.id || req.user?._id || req.user?.musicianId);
const requesterRole = (req) => clean(req.user?.role || req.user?.userrole).toLowerCase();
const isAgent = (req) => ["agent", "admin", "superadmin"].includes(requesterRole(req));

const canAccessMusician = (req, musicianId) => isAgent(req) || requesterId(req) === String(musicianId);

const uploadPrivateVideo = (file, musicianId) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    {
      folder: `musician-video-submissions/${musicianId}`,
      resource_type: "video",
      type: "authenticated",
      use_filename: false,
      unique_filename: true,
    },
    (error, result) => error ? reject(error) : resolve(result),
  );
  stream.end(file.buffer);
});

const signedMediaUrl = (submission, expiresInSeconds = 3600) => cloudinary.utils.private_download_url(
  submission.cloudinaryPublicId,
  submission.cloudinaryFormat || null,
  {
    resource_type: submission.cloudinaryResourceType || "video",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
  },
);

const serialise = (submission, { includeAccessUrl = false } = {}) => ({
  _id: submission._id,
  musicianId: submission.musicianId,
  category: submission.category,
  suppliedTitle: submission.suppliedTitle,
  originalName: submission.originalName,
  bytes: submission.bytes,
  status: submission.status,
  moderationReason: submission.moderationReason,
  moderationFlags: submission.moderationFlags,
  azureState: submission.azureState,
  youtubeUrl: submission.youtubeUrl,
  youtubeTitle: submission.youtubeTitle,
  createdAt: submission.createdAt,
  updatedAt: submission.updatedAt,
  ...(includeAccessUrl ? { accessUrl: signedMediaUrl(submission, 300), accessUrlExpiresInSeconds: 300 } : {}),
});

export const uploadMusicianVideo = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Choose an MP4, MOV or WebM video" });
    if (!VIDEO_MIMES.has(req.file.mimetype)) return res.status(415).json({ success: false, message: "Use an MP4, MOV or WebM video" });
    const musicianId = clean(req.params.id || requesterId(req));
    if (!mongoose.Types.ObjectId.isValid(musicianId) || !canAccessMusician(req, musicianId)) {
      return res.status(403).json({ success: false, message: "You cannot upload videos for this profile" });
    }
    const musician = await musicianModel.findById(musicianId).select("_id firstName lastName");
    if (!musician) return res.status(404).json({ success: false, message: "Musician not found" });
    const uploaded = await uploadPrivateVideo(req.file, musicianId);
    const submission = await musicianVideoSubmissionModel.create({
      musicianId,
      category: req.body?.category === "original" ? "original" : "function",
      suppliedTitle: clean(req.body?.title).slice(0, 120),
      originalName: clean(req.file.originalname).slice(0, 240),
      mimeType: req.file.mimetype,
      bytes: req.file.size,
      cloudinaryPublicId: uploaded.public_id,
      cloudinaryFormat: uploaded.format || "",
      cloudinaryResourceType: uploaded.resource_type || "video",
      status: "processing",
      moderationReason: "Automated text and identity checks are starting",
    });
    try {
      const azure = await submitVideoToAzure({ mediaUrl: signedMediaUrl(submission), name: submission.suppliedTitle || "Musician showreel" });
      submission.azureVideoId = azure.id || azure.videoId || "";
      submission.azureState = azure.state || "Uploaded";
      submission.moderationReason = "Automated text and identity checks are running";
      await submission.save();
    } catch (error) {
      submission.status = "manual_required";
      submission.moderationReason = `Automatic checking could not start: ${error.message}`;
      submission.error = error.message;
      await submission.save();
    }
    return res.status(201).json({ success: true, submission: serialise(submission) });
  } catch (error) {
    console.error("Musician video upload failed:", error);
    return res.status(500).json({ success: false, message: error.message || "Video upload failed" });
  }
};

export const listMyMusicianVideos = async (req, res) => {
  try {
    const musicianId = clean(req.params.id || requesterId(req));
    if (!mongoose.Types.ObjectId.isValid(musicianId) || !canAccessMusician(req, musicianId)) return res.status(403).json({ success: false, message: "Forbidden" });
    const submissions = await musicianVideoSubmissionModel.find({ musicianId }).sort({ createdAt: -1 });
    return res.json({ success: true, submissions: submissions.map((item) => serialise(item)) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not load video submissions" });
  }
};

export const refreshMusicianVideoSubmission = async (req, res) => {
  try {
    const submission = await musicianVideoSubmissionModel.findById(req.params.submissionId);
    if (!submission) return res.status(404).json({ success: false, message: "Video submission not found" });
    if (!canAccessMusician(req, submission.musicianId)) return res.status(403).json({ success: false, message: "Forbidden" });
    if (!submission.azureVideoId) return res.json({ success: true, submission: serialise(submission) });
    const index = await getAzureVideoIndex(submission.azureVideoId);
    submission.azureState = index.state || "Unknown";
    if (String(index.state).toLowerCase() === "processed") {
      submission.moderationFlags = extractModerationFlags(index);
      submission.azureProcessedAt = new Date();
      submission.status = submission.moderationFlags.length ? "manual_required" : "ready_for_review";
      submission.moderationReason = submission.moderationFlags.length
        ? "Possible identifying text, speech or branding detected"
        : "No identifying text, speech or branding was automatically detected; final human check required";
    }
    await submission.save();
    return res.json({ success: true, submission: serialise(submission) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Could not refresh video checks" });
  }
};

export const getMusicianVideoForReview = async (req, res) => {
  try {
    const submission = await musicianVideoSubmissionModel.findById(req.params.submissionId);
    if (!submission) return res.status(404).json({ success: false, message: "Video submission not found" });
    return res.json({ success: true, submission: serialise(submission, { includeAccessUrl: true }) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not open video submission" });
  }
};

export const listMusicianVideoSubmissionsForReview = async (_req, res) => {
  try {
    const submissions = await musicianVideoSubmissionModel
      .find({ status: { $in: ["processing", "manual_required", "ready_for_review", "publishing", "failed"] } })
      .populate("musicianId", "firstName lastName email musicianSlug")
      .sort({ createdAt: -1 });
    return res.json({
      success: true,
      submissions: submissions.map((item) => ({
        ...serialise(item, { includeAccessUrl: true }),
        musician: item.musicianId,
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not load the video review queue" });
  }
};

export const reviewMusicianVideoSubmission = async (req, res) => {
  try {
    const submission = await musicianVideoSubmissionModel.findById(req.params.submissionId);
    if (!submission) return res.status(404).json({ success: false, message: "Video submission not found" });
    const decision = clean(req.body?.decision).toLowerCase();
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ success: false, message: "Choose approve or reject" });
    if (decision === "reject") {
      submission.status = "rejected";
      submission.moderationReason = clean(req.body?.reason) || "A clean anonymous version is required";
      submission.reviewedAt = new Date();
      submission.reviewedBy = requesterId(req) || null;
      await submission.save();
      return res.json({ success: true, submission: serialise(submission) });
    }
    const musician = await musicianModel.findById(submission.musicianId);
    if (!musician) return res.status(404).json({ success: false, message: "Musician not found" });
    submission.status = "publishing";
    submission.moderationReason = "Approved; publishing to the TSC YouTube channel";
    submission.reviewedAt = new Date();
    submission.reviewedBy = requesterId(req) || null;
    await submission.save();
    try {
      const metadata = buildAnonymousYoutubeMetadata({ musician, submission });
      const youtube = await publishVideoToYoutube({ mediaUrl: signedMediaUrl(submission, 7200), metadata });
      submission.youtubeVideoId = youtube.id;
      submission.youtubeUrl = youtube.url;
      submission.youtubeTitle = metadata.title;
      submission.status = "published";
      submission.publishedAt = new Date();
      submission.moderationReason = "Approved and published to the TSC YouTube channel";
      const field = submission.category === "original" ? "tscApprovedOriginalBandVideoLinks" : "tscApprovedFunctionBandVideoLinks";
      musician[field] = [...(musician[field] || []).filter((video) => video.url !== youtube.url), { title: metadata.title, url: youtube.url, provider: "youtube", accessStatus: "accessible", moderationStatus: "approved", moderationReason: "Approved from direct upload", manuallyReviewedAt: new Date() }];
      await musician.save();
      await submission.save();
      return res.json({ success: true, submission: serialise(submission) });
    } catch (error) {
      submission.status = "ready_for_review";
      submission.error = error.message;
      submission.moderationReason = `Approved, but YouTube publishing is waiting: ${error.message}`;
      await submission.save();
      return res.status(503).json({ success: false, message: submission.moderationReason, submission: serialise(submission) });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Could not review video" });
  }
};

import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import musicianModel from "../models/musicianModel.js";
import musicianVideoSubmissionModel from "../models/musicianVideoSubmissionModel.js";
import { extractModerationFlags, getAzureVideoIndex, submitVideoToAzure } from "../services/videoModerationService.js";
import { buildAnonymousYoutubeMetadata, publishVideoToYoutube, setYoutubeVideoThumbnail } from "../services/youtubeVideoService.js";
import { thumbnailMediaUrl, uploadPrivateThumbnail, isSupportedThumbnail } from "../services/musicianVideoThumbnailService.js";
import {
  getActiveApplicantPriorities,
  withApplicantPriority,
} from "../services/deputyApplicantPriorityService.js";

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
  isPrimary: Boolean(submission.isPrimary),
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
  thumbnailSource: submission.thumbnailPublicId ? "custom" : "automatic",
  thumbnailUpdatedAt: submission.thumbnailUpdatedAt,
  thumbnailOriginalName: submission.thumbnailOriginalName,
  thumbnailReviewStatus: submission.thumbnailReviewStatus,
  thumbnailReviewReason: submission.thumbnailReviewReason,
  ...(includeAccessUrl ? { accessUrl: signedMediaUrl(submission, 300), accessUrlExpiresInSeconds: 300 } : {}),
});

const accessibleVideo = async (req) => {
  const submission = await musicianVideoSubmissionModel.findById(req.params.submissionId);
  if (!submission || (req.params.id && String(submission.musicianId) !== String(req.params.id))) return null;
  if (!canAccessMusician(req, submission.musicianId)) return null;
  return submission;
};

export const getMusicianVideoThumbnail = async (req, res) => {
  try {
    const submission = await accessibleVideo(req);
    if (!submission) return res.status(404).json({ success: false, message: "Video not found" });
    const response = await fetch(await thumbnailMediaUrl(submission), { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("Thumbnail is not ready yet");
    const bytes = Buffer.from(await response.arrayBuffer());
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" });
    return res.send(bytes);
  } catch {
    return res.status(503).json({ success: false, message: "Thumbnail is temporarily unavailable" });
  }
};

export const uploadMusicianVideoThumbnail = async (req, res) => {
  try {
    const submission = await accessibleVideo(req);
    if (!submission) return res.status(404).json({ success: false, message: "Video not found" });
    if (!isSupportedThumbnail(req.file)) return res.status(415).json({ success: false, message: "Choose a JPG, PNG or WebP image" });
    if (req.file.size > 5 * 1024 * 1024) return res.status(413).json({ success: false, message: "Thumbnail must be 5 MB or smaller" });
    if (submission.status === "publishing") return res.status(409).json({ success: false, message: "Please wait until video publishing finishes" });
    const image = await uploadPrivateThumbnail(req.file, submission.musicianId);
    const saved = await musicianVideoSubmissionModel.findOneAndUpdate(
      { _id: submission._id, status: { $ne: "publishing" } },
      { $set: {
        thumbnailPublicId: image.public_id, thumbnailFormat: image.format || "jpg",
        thumbnailOriginalName: clean(req.file.originalname).slice(0, 240), thumbnailUpdatedAt: new Date(),
        thumbnailReviewStatus: "pending", thumbnailReviewReason: "TSC will check that the thumbnail contains no text or branding",
      } }, { new: true },
    );
    if (!saved) return res.status(409).json({ success: false, message: "Video publishing has started; please try again once it finishes" });
    return res.json({ success: true, submission: serialise(saved) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not save the thumbnail. Please try another image." });
  }
};

export const reviewMusicianVideoThumbnail = async (req, res) => {
  try {
    if (!isAgent(req)) return res.status(403).json({ success: false, message: "Staff access required" });
    const submission = await accessibleVideo(req);
    if (!submission?.thumbnailPublicId) return res.status(404).json({ success: false, message: "Custom thumbnail not found" });
    const decision = req.body?.decision;
    if (!["approve", "reject"].includes(decision)) return res.status(400).json({ success: false, message: "Choose approve or reject" });
    if (decision === "approve" && submission.youtubeVideoId) {
      await setYoutubeVideoThumbnail({ videoId: submission.youtubeVideoId, mediaUrl: await thumbnailMediaUrl(submission) });
    }
    const saved = await musicianVideoSubmissionModel.findOneAndUpdate(
      { _id: submission._id, thumbnailPublicId: submission.thumbnailPublicId },
      { $set: { thumbnailReviewStatus: decision === "approve" ? "approved" : "rejected",
        thumbnailReviewReason: decision === "approve" ? "Thumbnail checked by TSC" : "Please upload a thumbnail without text or branding" } },
      { new: true },
    );
    if (!saved) return res.status(409).json({ success: false, message: "The thumbnail changed while you were reviewing it; please check the new image" });
    return res.json({ success: true, submission: serialise(saved) });
  } catch (error) {
    return res.status(503).json({ success: false, message: "Could not apply the thumbnail. It remains saved for review." });
  }
};

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
    const hasExistingSubmission = await musicianVideoSubmissionModel.exists({ musicianId });
    const submission = await musicianVideoSubmissionModel.create({
      musicianId,
      category: req.body?.category === "original" ? "original" : "function",
      suppliedTitle: clean(req.body?.title).slice(0, 120),
      isPrimary: !hasExistingSubmission,
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

export const setPreferredMusicianVideo = async (req, res) => {
  try {
    const musicianId = clean(req.params.id || requesterId(req));
    if (!mongoose.Types.ObjectId.isValid(musicianId)) {
      return res.status(400).json({ success: false, message: "Invalid musician" });
    }
    const submission = await musicianVideoSubmissionModel.findById(req.params.submissionId);
    if (!submission || String(submission.musicianId) !== musicianId) {
      return res.status(404).json({ success: false, message: "Video submission not found" });
    }
    if (!canAccessMusician(req, musicianId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    if (["rejected", "failed"].includes(submission.status)) {
      return res.status(409).json({ success: false, message: "Choose a video that is still being reviewed or has been published" });
    }

    await musicianVideoSubmissionModel.updateMany(
      { musicianId, _id: { $ne: submission._id } },
      { $set: { isPrimary: false } },
    );
    submission.isPrimary = true;
    await submission.save();

    if (submission.status === "published" && submission.youtubeUrl) {
      const musician = await musicianModel.findById(musicianId);
      if (musician) {
        const field = submission.category === "original"
          ? "tscApprovedOriginalBandVideoLinks"
          : "tscApprovedFunctionBandVideoLinks";
        const selected = (musician[field] || []).find(
          (video) => clean(video?.url) === clean(submission.youtubeUrl),
        );
        if (selected) {
          musician[field] = [
            selected,
            ...(musician[field] || []).filter(
              (video) => clean(video?.url) !== clean(submission.youtubeUrl),
            ),
          ];
          musician.primaryVideoUrl = submission.youtubeUrl;
          await musician.save();
        }
      }
    }

    return res.json({ success: true, submission: serialise(submission) });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Could not update the preferred video",
    });
  }
};

export const listMyMusicianVideos = async (req, res) => {
  try {
    const musicianId = clean(req.params.id || requesterId(req));
    if (!mongoose.Types.ObjectId.isValid(musicianId) || !canAccessMusician(req, musicianId)) return res.status(403).json({ success: false, message: "Forbidden" });
    const submissions = await musicianVideoSubmissionModel.find({ musicianId }).sort({ createdAt: -1 });
    return res.json({
      success: true,
      submissions: submissions.map((item) =>
        serialise(item, { includeAccessUrl: isAgent(req) }),
      ),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not load video submissions" });
  }
};

export const refreshMusicianVideoSubmission = async (req, res) => {
  try {
    let submission = await musicianVideoSubmissionModel.findById(req.params.submissionId);
    if (!submission) return res.status(404).json({ success: false, message: "Video submission not found" });
    if (!canAccessMusician(req, submission.musicianId)) return res.status(403).json({ success: false, message: "Forbidden" });
    if (["rejected", "publishing", "published"].includes(submission.status)) {
      return res.json({ success: true, submission: serialise(submission) });
    }
    if (!submission.azureVideoId) {
      // Claim the retry before contacting Azure so simultaneous refreshes cannot
      // start multiple billable indexing jobs for the same saved upload.
      const claimed = await musicianVideoSubmissionModel.findOneAndUpdate(
        {
          _id: submission._id,
          azureVideoId: { $in: ["", null] },
          status: { $in: ["manual_required", "failed"] },
          reviewedAt: null,
          youtubeVideoId: { $in: ["", null] },
        },
        { $set: { status: "processing", azureState: "Starting", moderationReason: "Automated text and identity checks are starting", error: "" } },
        { new: true },
      );
      if (!claimed) {
        submission = await musicianVideoSubmissionModel.findById(submission._id) || submission;
        return res.json({ success: true, submission: serialise(submission) });
      }
      submission = claimed;
      try {
        const azure = await submitVideoToAzure({
          mediaUrl: signedMediaUrl(submission),
          name: submission.suppliedTitle || "Musician showreel",
        });
        if (!azure.id && !azure.videoId) throw new Error("Azure did not return a video id");
        submission.azureVideoId = azure.id || azure.videoId;
        submission.azureState = azure.state || "Uploaded";
        submission.moderationFlags = [];
        submission.azureProcessedAt = null;
        submission.moderationReason = "Automated text and identity checks are running";
        await submission.save();
      } catch (error) {
        submission.status = "manual_required";
        submission.azureState = "";
        submission.error = error.message;
        submission.moderationReason = `Automatic checking could not start: ${error.message}`;
        await submission.save();
        throw error;
      }
      return res.json({ success: true, submission: serialise(submission) });
    }
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
      .find({ $or: [
        { status: { $in: ["processing", "manual_required", "ready_for_review", "publishing", "failed"] } },
        { thumbnailReviewStatus: "pending" },
      ] })
      .populate("musicianId", "firstName lastName email musicianSlug")
      .sort({ createdAt: -1 });
    const priorityMap = await getActiveApplicantPriorities(
      submissions.map((item) => item.musicianId?._id || item.musicianId),
    );
    const prioritised = submissions
      .map((item) =>
        withApplicantPriority(
          {
            ...serialise(item, { includeAccessUrl: true }),
            musician: item.musicianId,
          },
          priorityMap,
          item.musicianId?._id || item.musicianId,
        ),
      )
      .sort(
        (a, b) =>
          Number(b.clientPriority || 0) - Number(a.clientPriority || 0) ||
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      );
    return res.json({
      success: true,
      submissions: prioritised,
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
    if (submission.thumbnailPublicId && submission.thumbnailReviewStatus === "pending") {
      return res.status(409).json({ success: false, message: "Check and approve the custom thumbnail before publishing this video" });
    }
    submission.status = "publishing";
    submission.moderationReason = "Approved; publishing to the TSC YouTube channel";
    submission.reviewedAt = new Date();
    submission.reviewedBy = requesterId(req) || null;
    await submission.save();
    try {
      const metadata = buildAnonymousYoutubeMetadata({ musician, submission });
      const youtube = submission.youtubeVideoId
        ? { id: submission.youtubeVideoId, url: submission.youtubeUrl }
        : await publishVideoToYoutube({ mediaUrl: signedMediaUrl(submission, 7200), metadata });
      submission.youtubeVideoId = youtube.id;
      submission.youtubeUrl = youtube.url;
      submission.youtubeTitle = metadata.title;
      // Keep the uploaded video ID even if setting its thumbnail needs a retry.
      await submission.save();
      if (submission.thumbnailPublicId && submission.thumbnailReviewStatus === "approved") {
        await setYoutubeVideoThumbnail({ videoId: youtube.id, mediaUrl: await thumbnailMediaUrl(submission) });
      }
      submission.status = "published";
      submission.publishedAt = new Date();
      submission.moderationReason = "Approved and published to the TSC YouTube channel";
      const field = submission.category === "original" ? "tscApprovedOriginalBandVideoLinks" : "tscApprovedFunctionBandVideoLinks";
      const publishedVideo = { title: metadata.title, url: youtube.url, provider: "youtube", accessStatus: "accessible", moderationStatus: "approved", moderationReason: "Approved from direct upload", manuallyReviewedAt: new Date() };
      const otherVideos = (musician[field] || []).filter((video) => video.url !== youtube.url);
      musician[field] = submission.isPrimary
        ? [publishedVideo, ...otherVideos]
        : [...otherVideos, publishedVideo];
      if (submission.isPrimary) musician.primaryVideoUrl = youtube.url;
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

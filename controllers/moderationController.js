// backend/controllers/moderationController.js
import PendingSong from "../models/pendingSongModel.js";
import Song from "../models/songModel.js";
import musicianModel from "../models/musicianModel.js";
import {
  classifyVideoUrl,
  extractModerationFlags,
  getAzureVideoIndex,
  submitVideoToAzure,
} from "../services/videoModerationService.js";

/* =========================
 *  SONG MODERATION (unchanged)
 * =======================*/

export const submitPendingSongs = async (req, res) => {
  try {
    const songs = req.body.songs;
    if (!Array.isArray(songs)) return res.status(400).json({ error: "Invalid songs payload" });

    const validSongs = songs
      .filter((song) => song.title && song.artist)
      .map((song) => ({
        title: song.title.trim(),
        artist: song.artist.trim(),
        genre: song.genre || "",
        year: song.year || null,
        submittedBy: song.submittedBy || null,
      }));

    const inserted = await PendingSong.insertMany(validSongs);
    res.status(201).json({ message: "Songs submitted for review", inserted });
  } catch (err) {
    console.error("❌ Error submitting pending songs:", err);
    res.status(500).json({ error: "Failed to submit songs" });
  }
};

export const getPendingSongs = async (_req, res) => {
  try {
    const songs = await PendingSong.find({ approved: false });
    res.status(200).json({ songs });
  } catch (err) {
    console.error("❌ Failed to fetch pending songs:", err);
    res.status(500).json({ error: "Could not retrieve songs" });
  }
};

export const approveSong = async (req, res) => {
  try {
    const song = req.body;

    // Always insert to master
    const newSong = new Song({
      title: song.title,
      artist: song.artist,
      genre: song.genre,
      year: song.year,
      addedBy: song.submittedBy || null,
    });
    await newSong.save();

    // Only touch pending doc if an _id was provided
    if (song._id) {
      await PendingSong.findByIdAndUpdate(song._id, { approved: true });
    }

    res.status(200).json({ message: "Song added to master list" });
  } catch (err) {
    console.error("❌ Approval error:", err);
    res.status(500).json({ error: "Approval failed" });
  }
};

export const rejectSong = async (req, res) => {
  try {
    await PendingSong.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Song rejected and deleted" });
  } catch (err) {
    console.error("❌ Rejection error:", err);
    res.status(500).json({ error: "Rejection failed" });
  }
};



/* =========================
 *  DEPUTY MODERATION
 * =======================*/

const NORMALIZE = (doc) => {
  // prefer top-level fields; fallback to basicInfo
  const first =
    doc.firstName || doc?.basicInfo?.firstName || "";
  const last =
    doc.lastName || doc?.basicInfo?.lastName || "";
  const name = [first, last].filter(Boolean).join(" ").trim() || "undefined undefined";

  return {
    _id: doc._id,
    name,
    firstName: first,
    lastName: last,
    email: doc.email || doc?.basicInfo?.email || "",
    status: doc.status || "",
    profilePicture: doc.profilePicture || "",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

// helpers at top of file (add these)
const escapeRegExp = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// build a robust $or of exact, case-insensitive, trimmed matches
const buildStatusMatch = (statuses = []) => {
  const ors = [];
  for (const raw of statuses) {
    if (!raw) continue;
    const trimmed = String(raw).trim();
    if (!trimmed) continue;
    ors.push({ status: trimmed }); // exact
    ors.push({ status: { $regex: new RegExp(`^${escapeRegExp(trimmed)}$`, "i") } }); // case-insensitive
    ors.push({ status: { $regex: new RegExp(`${escapeRegExp(trimmed)}\\s*$`, "i") } }); // tolerate trailing ws
  }
  return ors.length ? { $or: ors } : {};
};

const normaliseVideoUrl = (value = "") =>
  String(value || "")
    .trim()
    .replace(/\/$/, "")
    .toLowerCase();

const addVideoReviewSummary = (deputy) => {
  const uploaded = [
    ...(Array.isArray(deputy.functionBandVideoLinks)
      ? deputy.functionBandVideoLinks
      : []),
    ...(Array.isArray(deputy.originalBandVideoLinks)
      ? deputy.originalBandVideoLinks
      : []),
  ].filter((video) => normaliseVideoUrl(video?.url));

  const approvedUrls = new Set(
    [
      ...(Array.isArray(deputy.tscApprovedFunctionBandVideoLinks)
        ? deputy.tscApprovedFunctionBandVideoLinks
        : []),
      ...(Array.isArray(deputy.tscApprovedOriginalBandVideoLinks)
        ? deputy.tscApprovedOriginalBandVideoLinks
        : []),
    ]
      .map((video) => normaliseVideoUrl(video?.url))
      .filter(Boolean),
  );

  const uniqueUploadedUrls = [
    ...new Set(uploaded.map((video) => normaliseVideoUrl(video.url))),
  ];
  const unvettedVideoCount = uniqueUploadedUrls.filter(
    (url) => !approvedUrls.has(url),
  ).length;
  const allVideos = [...uploaded];
  const videoModerationCounts = allVideos.reduce((counts, video) => {
    const status = video?.moderationStatus || "not_started";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const moderationFlagCount = allVideos.reduce(
    (count, video) => count + (Array.isArray(video?.moderationFlags) ? video.moderationFlags.length : 0),
    0,
  );

  return {
    ...deputy,
    uploadedVideoCount: uniqueUploadedUrls.length,
    unvettedVideoCount,
    needsVideoReview: unvettedVideoCount > 0,
    videoModerationCounts,
    moderationFlagCount,
  };
};

const VIDEO_FIELDS = ["functionBandVideoLinks", "originalBandVideoLinks"];

const findVideo = (musician, videoId) => {
  for (const field of VIDEO_FIELDS) {
    const video = musician[field]?.id?.(videoId);
    if (video) return { field, video };
  }
  return null;
};

const applyClassification = (video, classification) => {
  video.provider = classification.provider;
  video.lastModerationAttemptAt = new Date();
  if (!classification.automationEligible) {
    video.accessStatus = classification.accessStatus || "unsupported";
    video.moderationStatus = "manual_required";
    video.moderationReason = classification.reason;
  }
};

export const analyseDeputyVideos = async (req, res) => {
  try {
    const musician = await musicianModel.findById(req.params.id);
    if (!musician) return res.status(404).json({ success: false, message: "Deputy not found" });
    const results = [];
    for (const field of VIDEO_FIELDS) {
      for (const video of musician[field] || []) {
        if (!video.url || ["approved", "rejected", "completed"].includes(video.moderationStatus)) continue;
        if (video.moderationStatus === "processing" && video.azureVideoId) {
          try {
            const index = await getAzureVideoIndex(video.azureVideoId);
            video.azureState = index.state || "Unknown";
            video.lastModerationAttemptAt = new Date();
            if (String(index.state).toLowerCase() === "processed") {
              video.moderationFlags = extractModerationFlags(index);
              video.moderationStatus = "completed";
              video.moderationReason = video.moderationFlags.length ? "Potential contact or identity details detected" : "No automatic contact-detail flags detected";
              video.azureProcessedAt = new Date();
            }
            results.push({ videoId: video._id, provider: video.provider, status: video.moderationStatus, flags: video.moderationFlags.length });
          } catch (error) {
            video.moderationReason = error.message;
            results.push({ videoId: video._id, provider: video.provider, status: "processing", reason: error.message });
          }
          continue;
        }
        const classification = classifyVideoUrl(video.url);
        applyClassification(video, classification);
        if (!classification.automationEligible) {
          results.push({ videoId: video._id, provider: classification.provider, status: "manual_required", reason: classification.reason });
          continue;
        }
        try {
          const azure = await submitVideoToAzure({ mediaUrl: classification.resolvedMediaUrl || video.url, name: video.title || `${musician.firstName || "Musician"} video` });
          video.accessStatus = "accessible";
          video.azureVideoId = azure.id || azure.videoId || "";
          video.azureState = azure.state || "Uploaded";
          video.moderationStatus = "processing";
          video.moderationReason = "Azure analysis is running";
          results.push({ videoId: video._id, provider: classification.provider, status: "processing" });
        } catch (error) {
          video.accessStatus = classification.provider === "google_drive" ? "access_required" : "error";
          video.moderationStatus = classification.provider === "google_drive" ? "manual_required" : "failed";
          video.moderationReason = error.message;
          results.push({ videoId: video._id, provider: classification.provider, status: video.moderationStatus, reason: error.message });
        }
      }
    }
    await musician.save();
    return res.json({ success: true, message: "Video moderation started", results });
  } catch (error) {
    console.error("Video moderation start failed:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to analyse videos" });
  }
};

export const refreshDeputyVideoAnalysis = async (req, res) => {
  try {
    const musician = await musicianModel.findById(req.params.id);
    if (!musician) return res.status(404).json({ success: false, message: "Deputy not found" });
    const found = findVideo(musician, req.params.videoId);
    if (!found) return res.status(404).json({ success: false, message: "Video not found" });
    if (!found.video.azureVideoId) return res.status(400).json({ success: false, message: "This video has not been submitted to Azure" });
    const index = await getAzureVideoIndex(found.video.azureVideoId);
    found.video.azureState = index.state || "Unknown";
    found.video.lastModerationAttemptAt = new Date();
    if (String(index.state).toLowerCase() === "processed") {
      found.video.moderationFlags = extractModerationFlags(index);
      found.video.moderationStatus = "completed";
      found.video.moderationReason = found.video.moderationFlags.length ? "Potential contact or identity details detected" : "No automatic contact-detail flags detected";
      found.video.azureProcessedAt = new Date();
    }
    await musician.save();
    return res.json({ success: true, video: found.video });
  } catch (error) {
    console.error("Video moderation refresh failed:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to refresh analysis" });
  }
};

export const reviewDeputyVideo = async (req, res) => {
  try {
    const musician = await musicianModel.findById(req.params.id);
    if (!musician) return res.status(404).json({ success: false, message: "Deputy not found" });
    const found = findVideo(musician, req.params.videoId);
    if (!found) return res.status(404).json({ success: false, message: "Video not found" });
    const decision = String(req.body?.decision || "").toLowerCase();
    if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ success: false, message: "Decision must be approved or rejected" });
    found.video.moderationStatus = decision;
    found.video.moderationReason = String(req.body?.reason || "Manual review completed");
    found.video.manuallyReviewedAt = new Date();
    await musician.save();
    return res.json({ success: true, video: found.video });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to save review" });
  }
};

const fetchByStatuses = async (statuses) => {
  const statusMatch = buildStatusMatch(statuses);
  const query = { role: "musician", ...(statusMatch.$or ? { ...statusMatch } : {}) };

  // DEBUG
  console.log("🔎 fetchByStatuses query:", JSON.stringify(query));

  const docs = await musicianModel
    .find(query)
    .select("firstName lastName basicInfo email status profilePicture createdAt updatedAt")
    .sort({ createdAt: -1 })
    .lean();

  const deputies = docs.map(NORMALIZE);
  const statusCounts = deputies.reduce((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1;
    return acc;
  }, {});
  return { deputies, statusCounts };
};

// keep NORMALIZE as you already have it

// unchanged: listPendingDeputies (just calls fetchByStatuses)
export const listPendingDeputies = async (_req, res) => {
  try {
    const { deputies, statusCounts } = await fetchByStatuses(["pending"]);
    console.log("📦 listPendingDeputies ->", deputies.length);
    return res.json({ success: true, deputies, total: deputies.length, statusCounts });
  } catch (err) {
    console.error("❌ listPendingDeputies error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const listChangesPendingDeputies = async (_req, res) => {
  try {
    const status = "Approved, changes pending";
    const { deputies, statusCounts } = await fetchByStatuses([status]);
    console.log("📦 listChangesPendingDeputies ->", deputies.length);
    return res.json({ success: true, deputies, total: deputies.length, statusCounts });
  } catch (err) {
    console.error("❌ listChangesPending error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const listDeputiesReviewQueue = async (req, res) => {
  try {
    const all = String(req.query.all || "").toLowerCase() === "true";

    if (all) {
      const deputyDocs = await musicianModel
        .find({ role: { $in: ["musician", "deputy"] } })
        .select(
          "_id firstName lastName name email status dateRegistered profileLastEditedAt profileLastReviewedAt profileUpdatedByUser lastLoginAt functionBandVideoLinks originalBandVideoLinks tscApprovedFunctionBandVideoLinks tscApprovedOriginalBandVideoLinks"
        )
        .lean();
      const deputies = deputyDocs.map(addVideoReviewSummary);

      return res.json({
        success: true,
        deputies,
        total: deputies.length,
      });
    }

    const rawStatuses = req.query.statuses;
    const statuses = Array.isArray(rawStatuses)
      ? rawStatuses.flatMap((s) => String(s).split(","))
      : String(rawStatuses || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

    const wanted = statuses.length
      ? statuses
      : ["pending", "Approved, changes pending"];

    const deputyDocs = await musicianModel
      .find({
        role: { $in: ["musician", "deputy"] },
        status: { $in: wanted },
      })
      .select(
        "_id firstName lastName name email status dateRegistered profileLastEditedAt profileLastReviewedAt profileUpdatedByUser lastLoginAt functionBandVideoLinks originalBandVideoLinks tscApprovedFunctionBandVideoLinks tscApprovedOriginalBandVideoLinks"
      )
      .lean();
    const deputies = deputyDocs.map(addVideoReviewSummary);

    return res.json({
      success: true,
      deputies,
      total: deputies.length,
    });
  } catch (err) {
    console.error("❌ listDeputiesReviewQueue error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

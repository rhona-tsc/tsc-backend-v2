import mongoose from "mongoose";
import musicianModel from "../models/musicianModel.js";
import MusicianBioBackfillJob from "../models/musicianBioBackfillJobModel.js";
import { generateAndPublishMusicianBio } from "./musicianBioService.js";

const activeWorkers = new Set();

const isAccountWideAiFailure = (message = "") =>
  /incorrect api key|invalid.*api key|authentication|unauthorized|insufficient_quota|billing|credit balance|account.*deactivated|organization.*disabled/i.test(
    String(message || ""),
  );

const eligibleQuery = (cursor = null) => ({
  $and: [
    {
      $or: [
        { role: "musician" },
        { role: "deputy" },
        { role: { $exists: false } },
        { isDeputy: true },
      ],
    },
    {
      $or: [
        { tscApprovedBio: { $exists: false } },
        { tscApprovedBio: null },
        { tscApprovedBio: "" },
      ],
    },
    {
      $or: [
        { bio: { $type: "string", $regex: /.{40}/s } },
        { "selectedSongs.2": { $exists: true } },
        { "instrumentation.0": { $exists: true } },
      ],
    },
    ...(cursor && mongoose.isValidObjectId(cursor)
      ? [{ _id: { $gt: new mongoose.Types.ObjectId(cursor) } }]
      : []),
  ],
});

export const startMusicianBioBackfill = async ({ createdBy = null } = {}) => {
  const existing = await MusicianBioBackfillJob.findOne({
    status: { $in: ["queued", "running"] },
  }).sort({ createdAt: -1 });
  if (existing) {
    queueMusicianBioBackfill(existing._id);
    return existing;
  }

  const totalEligible = await musicianModel.countDocuments(eligibleQuery());
  const job = await MusicianBioBackfillJob.create({
    status: "queued",
    totalEligible,
    createdBy,
  });
  queueMusicianBioBackfill(job._id);
  return job;
};

export const queueMusicianBioBackfill = (jobId) => {
  const id = String(jobId || "");
  if (!id || activeWorkers.has(id)) return;
  activeWorkers.add(id);
  setImmediate(async () => {
    try {
      await runMusicianBioBackfill(id);
    } finally {
      activeWorkers.delete(id);
    }
  });
};

export const runMusicianBioBackfill = async (jobId) => {
  let job = await MusicianBioBackfillJob.findById(jobId);
  if (!job || ["completed", "failed", "cancelled"].includes(job.status)) return job;

  if (!process.env.OPENAI_API_KEY) {
    job.status = "failed";
    job.error = "OPENAI_API_KEY is not configured on the backend service";
    job.completedAt = new Date();
    await job.save();
    return job;
  }

  job.status = "running";
  job.startedAt ||= new Date();
  job.heartbeatAt = new Date();
  await job.save();

  while (true) {
    job = await MusicianBioBackfillJob.findById(jobId);
    if (!job || job.status === "cancelled") return job;

    const musician = await musicianModel
      .findOne(eligibleQuery(job.cursor))
      .select("_id firstName lastName email")
      .sort({ _id: 1 })
      .lean();

    if (!musician) {
      job.status = "completed";
      job.currentMusicianId = null;
      job.currentMusicianName = "";
      job.completedAt = new Date();
      job.heartbeatAt = new Date();
      await job.save();
      return job;
    }

    const musicianName =
      [musician.firstName, musician.lastName].filter(Boolean).join(" ") ||
      musician.email ||
      "Musician";
    job.currentMusicianId = musician._id;
    job.currentMusicianName = musicianName;
    job.heartbeatAt = new Date();
    await job.save();

    const result = await generateAndPublishMusicianBio(musician._id);
    job = await MusicianBioBackfillJob.findById(jobId);
    if (!job) return null;
    job.cursor = musician._id;
    job.processed += 1;
    job.heartbeatAt = new Date();
    job.lastReason = result?.reason || "";

    if (result?.generated) {
      job.generated += 1;
    } else if (["generation_failed", "ai_not_configured"].includes(result?.reason)) {
      const message = result?.error || result?.reason || "Biography generation failed";
      if (result?.reason === "ai_not_configured" || isAccountWideAiFailure(message)) {
        job.status = "failed";
        job.error = `${musicianName}: ${message}`;
        job.completedAt = new Date();
        await job.save();
        return job;
      }
      job.failedCount += 1;
      job.skipped += 1;
      job.recentErrors = [
        ...(job.recentErrors || []).slice(-9),
        {
          musicianId: musician._id,
          musicianName,
          message: String(message).slice(0, 500),
          occurredAt: new Date(),
        },
      ];
    } else {
      job.skipped += 1;
    }
    await job.save();
  }
};

export const getMusicianBioBackfillJob = async (jobId) => {
  const job = await MusicianBioBackfillJob.findById(jobId);
  if (job && ["queued", "running"].includes(job.status)) {
    queueMusicianBioBackfill(job._id);
  }
  return job;
};

export const getLatestMusicianBioBackfillJob = async () => {
  const job = await MusicianBioBackfillJob.findOne().sort({ createdAt: -1 });
  if (job && ["queued", "running"].includes(job.status)) {
    queueMusicianBioBackfill(job._id);
  }
  return job;
};

export const resumePendingMusicianBioBackfills = async () => {
  const jobs = await MusicianBioBackfillJob.find({
    status: { $in: ["queued", "running"] },
  })
    .select("_id")
    .lean();

  jobs.forEach((job) => queueMusicianBioBackfill(job._id));
  return jobs.length;
};

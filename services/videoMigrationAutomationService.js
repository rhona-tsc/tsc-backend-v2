import musicianModel from "../models/musicianModel.js";
import musicianVideoSubmissionModel from "../models/musicianVideoSubmissionModel.js";
import legacyVideoMigrationModel from "../models/legacyVideoMigrationModel.js";
import { extractModerationFlags, getAzureVideoIndex } from "./videoModerationService.js";
import { inspectYoutubeVideo } from "./youtubeVideoService.js";
import { sendEmail } from "../utils/sendEmail.js";

const clean = (value = "") => String(value || "").trim();
const enabled = (name) => clean(process.env[name]).toLowerCase() === "true";
const publicAdmin = clean(process.env.ADMIN_FRONTEND_URL || "https://admin.thesupremecollective.co.uk").replace(/\/$/, "");
const publicSite = clean(process.env.FRONTEND_URL || "https://thesupremecollective.co.uk").replace(/\/$/, "");
const videoFields = ["functionBandVideoLinks", "originalBandVideoLinks", "tscApprovedFunctionBandVideoLinks", "tscApprovedOriginalBandVideoLinks"];

const normalizeUrl = (value) => clean(value).replace(/\/$/, "").toLowerCase();
const youtubeId = (value) => clean(value).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/))([\w-]{11})/i)?.[1] || "";
const provider = (value) => {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be" || host.endsWith("youtube.com")) return "youtube";
    if (host.endsWith("vimeo.com")) return "vimeo";
    if (host.includes("drive.google.com")) return "google_drive";
    if (host.includes("dropbox")) return "dropbox";
    if (host.includes("instagram")) return "instagram";
    if (host.includes("facebook") || host === "fb.watch") return "facebook";
    if (host.includes("tiktok")) return "tiktok";
    return "other";
  } catch { return "invalid"; }
};

export const inventoryLegacyVideos = async () => {
  const musicians = await musicianModel.find({ role: "musician" }).select(`_id ${videoFields.join(" ")}`).lean();
  let discovered = 0;
  for (const musician of musicians) {
    for (const field of videoFields) {
      for (const video of musician[field] || []) {
        const url = clean(video?.url);
        if (!url) continue;
        await legacyVideoMigrationModel.updateOne(
          { musicianId: musician._id, normalizedUrl: normalizeUrl(url) },
          { $setOnInsert: { musicianId: musician._id, sourceField: field, title: clean(video?.title), url, normalizedUrl: normalizeUrl(url), provider: provider(url), wasApproved: field.startsWith("tscApproved"), status: "discovered" } },
          { upsert: true },
        );
        discovered += 1;
      }
    }
  }
  return { discovered };
};

export const inspectLegacyYoutubeBatch = async ({ limit = 25 } = {}) => {
  const rows = await legacyVideoMigrationModel.find({ provider: "youtube", status: "discovered" }).sort({ wasApproved: -1, createdAt: 1 }).limit(limit);
  let checked = 0;
  for (const row of rows) {
    row.status = "checking";
    await row.save();
    try {
      const id = youtubeId(row.url);
      const details = id ? await inspectYoutubeVideo(id) : null;
      if (!details) {
        row.status = "broken";
        row.reason = "YouTube video is unavailable or the URL is invalid";
      } else {
        row.youtubeVideoId = details.id;
        row.youtubeChannelId = details.channelId;
        row.embeddable = details.embeddable;
        row.privacyStatus = details.privacyStatus;
        const tscChannelId = clean(process.env.YOUTUBE_TSC_CHANNEL_ID);
        row.status = tscChannelId && details.channelId === tscChannelId ? "tsc_owned" : "replacement_required";
        row.reason = !details.embeddable
          ? "Embedding is disabled; a clean direct upload is required"
          : row.status === "tsc_owned"
            ? "TSC-owned video requires a visual anonymity review"
            : "Externally hosted video requires a clean source-file upload";
      }
    } catch (error) {
      row.status = "discovered";
      row.reason = `YouTube check will retry: ${error.message}`;
    }
    await row.save();
    checked += 1;
  }
  return { checked };
};

const notifyFlaggedDirectUploads = async () => {
  if (!enabled("VIDEO_MODERATION_EMAILS_ENABLED")) return { notified: 0 };
  const submissions = await musicianVideoSubmissionModel.find({ status: "manual_required", musicianNotifiedAt: null }).populate("musicianId", "firstName email").limit(50);
  let notified = 0;
  for (const submission of submissions) {
    const musician = submission.musicianId;
    if (!musician?.email) continue;
    const evidence = submission.moderationFlags.map((flag) => flag.evidence).filter(Boolean).slice(0, 5);
    await sendEmail({
      to: musician.email,
      subject: "Your showreel is under review",
      html: `<p>Hi ${musician.firstName || "there"},</p><p>Thanks for uploading your video. Our automatic check found some visible or spoken material that may identify you directly, so the video is safely held for TSC review and has not been published.</p>${evidence.length ? `<p>Examples detected:</p><ul>${evidence.map((item) => `<li>${item.replace(/[<>&]/g, "")}</li>`).join("")}</ul>` : ""}<p>You do not need to do anything while we review it. If you would prefer a quicker approval, you can upload a clean version without surnames, contact details, social handles, websites or third-party branding.</p><p><a href="${publicAdmin}/musicians-dashboard">Open your profile</a></p><p>🤍<br/>The Supreme Collective</p>`,
      text: `Hi ${musician.firstName || "there"},\n\nYour uploaded video is safely held for TSC review because visible or spoken identifying material may be present. It has not been published. You may upload a clean version without surnames, contact details, social handles, websites or third-party branding for quicker approval.\n\n${publicAdmin}/musicians-dashboard`,
    });
    submission.musicianNotifiedAt = new Date();
    submission.musicianNotificationType = "manual_review_required";
    await submission.save();
    notified += 1;
  }
  return { notified };
};

const inviteLegacyReplacements = async () => {
  if (!enabled("VIDEO_MIGRATION_EMAILS_ENABLED")) return { invited: 0 };
  const rows = await legacyVideoMigrationModel.find({ status: { $in: ["replacement_required", "broken"] }, invitationSentAt: null }).sort({ wasApproved: -1, createdAt: 1 }).limit(20).populate("musicianId", "firstName email");
  const byMusician = new Map();
  for (const row of rows) {
    const id = String(row.musicianId?._id || "");
    if (id && !byMusician.has(id)) byMusician.set(id, { musician: row.musicianId, rows: [] });
    if (id) byMusician.get(id).rows.push(row);
  }
  let invited = 0;
  for (const { musician, rows: musicianRows } of byMusician.values()) {
    if (!musician?.email) continue;
    await sendEmail({
      to: musician.email,
      subject: "Please upload clean copies of your profile videos",
      html: `<p>Hi ${musician.firstName || "there"},</p><p>We are upgrading TSC profiles so videos are checked for identifying text and reliably play for clients.</p><p>Please upload the original video files through your profile. Avoid surnames, contact details, social handles, websites and third-party branding. Your existing links will remain recorded while the replacement is reviewed.</p><p><a href="${publicAdmin}/musicians-dashboard">Upload clean videos</a></p><p>🤍<br/>The Supreme Collective</p>`,
      text: `Hi ${musician.firstName || "there"},\n\nPlease upload clean source files for your profile videos. Avoid surnames, contact details, social handles, websites and third-party branding.\n\n${publicAdmin}/musicians-dashboard`,
    });
    for (const row of musicianRows) { row.invitationSentAt = new Date(); await row.save(); }
    invited += 1;
  }
  return { invited };
};

export const refreshProcessingVideoSubmissions = async ({ limit = 25 } = {}) => {
  const submissions = await musicianVideoSubmissionModel.find({ status: "processing", azureVideoId: { $ne: "" } }).limit(limit);
  let refreshed = 0;
  for (const submission of submissions) {
    try {
      const index = await getAzureVideoIndex(submission.azureVideoId);
      submission.azureState = index.state || "Unknown";
      if (String(index.state).toLowerCase() === "processed") {
        submission.moderationFlags = extractModerationFlags(index);
        submission.azureProcessedAt = new Date();
        submission.status = submission.moderationFlags.length ? "manual_required" : "ready_for_review";
        submission.moderationReason = submission.moderationFlags.length ? "Possible identifying text, speech or branding detected" : "No identifying material automatically detected; final human check required";
      }
      await submission.save();
      refreshed += 1;
    } catch (error) {
      submission.error = error.message;
      await submission.save();
    }
  }
  return { refreshed };
};

export const sendVideoReviewDigest = async () => {
  if (!enabled("VIDEO_REVIEW_DIGEST_ENABLED")) return { sent: false, disabled: true };
  const direct = await musicianVideoSubmissionModel.find({ status: { $in: ["manual_required", "ready_for_review", "failed"] } }).populate("musicianId", "firstName lastName").sort({ createdAt: 1 }).limit(50);
  const remaining = Math.max(0, 50 - direct.length);
  const legacy = remaining ? await legacyVideoMigrationModel.find({ status: { $in: ["tsc_owned", "replacement_required", "broken"] } }).populate("musicianId", "firstName lastName").sort({ wasApproved: -1, createdAt: 1 }).limit(remaining) : [];
  const items = [
    ...direct.map((item) => ({ name: [item.musicianId?.firstName, item.musicianId?.lastName].filter(Boolean).join(" "), type: "Uploaded video", status: item.status, reason: item.moderationReason })),
    ...legacy.map((item) => ({ name: [item.musicianId?.firstName, item.musicianId?.lastName].filter(Boolean).join(" "), type: "Legacy link", status: item.status, reason: item.reason })),
  ];
  if (!items.length) return { sent: false, empty: true };
  const recipient = clean(process.env.VIDEO_REVIEW_DIGEST_EMAIL || process.env.ADMIN_EMAIL || process.env.EMAIL_USER || "hello@thesupremecollective.co.uk");
  await sendEmail({
    to: recipient,
    subject: `${items.length} video review item${items.length === 1 ? "" : "s"} waiting`,
    html: `<p>There are ${items.length} video items ready for review.</p><table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse"><tr><th>Musician</th><th>Type</th><th>Status</th><th>Reason</th></tr>${items.map((item) => `<tr><td>${clean(item.name)}</td><td>${item.type}</td><td>${item.status}</td><td>${clean(item.reason)}</td></tr>`).join("")}</table><p><a href="${publicAdmin}/moderate-deputies">Open the video review queue</a></p>`,
    text: `${items.length} video items are waiting for review.\n\n${items.map((item) => `${item.name} — ${item.type} — ${item.status}: ${item.reason}`).join("\n")}\n\n${publicAdmin}/moderate-deputies`,
  });
  return { sent: true, count: items.length };
};

export const runVideoMigrationAutomation = async () => {
  const [refresh, notify] = await Promise.all([refreshProcessingVideoSubmissions(), notifyFlaggedDirectUploads()]);
  const inventory = await inventoryLegacyVideos();
  const inspect = await inspectLegacyYoutubeBatch();
  const invitations = await inviteLegacyReplacements();
  return { refresh, notify, inventory, inspect, invitations, publicSite };
};

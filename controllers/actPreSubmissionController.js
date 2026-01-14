import mongoose from "mongoose";
import ActPreSubmission from "../models/ActPreSubmissionModel.js";
import { sendActApprovalEmail } from "../utils/sendActApprovalEmail.js";
import musicianModel from "../models/musicianModel.js";

import crypto from "crypto";

function generateInviteCode() {
  const raw = crypto.randomBytes(9).toString("base64url").toUpperCase();
  const clean = raw.replace(/[^A-Z0-9]/g, "").slice(0, 16);
  return `TSC-${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}`;
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export async function generateUniqueInviteCode() {
  for (let i = 0; i < 10; i++) {
    const code = generateInviteCode();
    const inviteCodeHash = hashCode(code);

    const exists = await ActPreSubmission.exists({ inviteCodeHash });
    if (!exists) return { code, inviteCodeHash };
  }

  const code = generateInviteCode();
  return { code, inviteCodeHash: hashCode(code) };
}

export const submitActPreSubmission = async (req, res) => {
  try {
    // Support BOTH old and new payload structures
    const body = req.body;

    // 1️⃣ Musician info (old format OR new `submittedBy`)
    const musicianId =
      body.musicianId ||
      body.submittedBy?.userId ||
      null;

    const musicianName =
      body.musicianName ||
      body.submittedBy?.name ||
      "";

    const musicianEmail =
      body.musicianEmail ||
      body.submittedBy?.email ||
      "";

    // 2️⃣ Act name
    const actName = body.actName || "";

    // 3️⃣ Video links (old format OR new `videoLinks` array)
    let videoLink1 = body.videoLink1 || "";
    let videoLink2 = body.videoLink2 || "";
    let videoLink3 = body.videoLink3 || "";

    if (Array.isArray(body.videoLinks)) {
      videoLink1 = body.videoLinks[0] || "";
      videoLink2 = body.videoLinks[1] || "";
      videoLink3 = body.videoLinks[2] || "";
    }

    // 4️⃣ Band leader/manager info
    const isBandLeader =
      typeof body.isBandLeader === "boolean"
        ? body.isBandLeader
        : true;

    const bandLeaderName =
      body.bandLeaderName ||
      body.bandLeaderOrManager?.name ||
      musicianName;

    const bandLeaderEmail =
      body.bandLeaderEmail ||
      body.bandLeaderOrManager?.email ||
      musicianEmail;

    // 5️⃣ Extra info
    const extraInfo = body.extraInfo || "";

    if (!musicianId) {
      return res.status(400).json({
        success: false,
        message: "Missing musicianId"
      });
    }

    // If name/email missing, look them up from DB
let finalMusicianName = musicianName;
let finalMusicianEmail = musicianEmail;

if (!finalMusicianName || !finalMusicianEmail) {
  const u = await musicianModel
    .findById(musicianId)
    .select("firstName lastName email");

  if (u) {
    finalMusicianEmail = finalMusicianEmail || u.email || "";
    finalMusicianName =
      finalMusicianName ||
      [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  }
}

    const submission = await ActPreSubmission.create({
       musicianId,
  musicianName: finalMusicianName || "",
  musicianEmail: finalMusicianEmail || "",
      actName,
      videoLink1,
      videoLink2,
      videoLink3,
      extraInfo,
      isBandLeader,
      bandLeaderName,
      bandLeaderEmail,
      status: "pending",
    });

    return res.json({ success: true, submission });
  } catch (err) {
    console.error("submitActPreSubmission error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

export const getPendingActPreSubmissions = async (req, res) => {
  try {
    const subs = await ActPreSubmission.find({ status: "pending" })
      .sort({ createdAt: -1 });

    return res.json({ success: true, subs });
  } catch (err) {
    console.error("getPendingActPreSubmissions error:", err);
    res.status(500).json({ success: false });
  }
};


export const approveActPreSubmission = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const sub = await ActPreSubmission.findById(id);
    if (!sub) return res.status(404).json({ success: false, message: "Not found" });

    // ✅ If already approved and code exists, don't regenerate (idempotent)
if (sub.status === "approved" && sub.inviteCodeHash) {
  // You *cannot* re-email the code because you don't store plaintext.
  // So either:
  // A) return success and show "code already generated" in UI
  // B) generate a new code and overwrite hash (recommended if you want re-send)
  return res.json({ success: true, sub });
}      // still try send email if missing / not sent etc (optional)
     

    // ✅ Backfill musician email/name if missing
    let musicianEmail = String(sub.musicianEmail || "").trim();
    let musicianName = String(sub.musicianName || "").trim();

    if (!musicianEmail || !musicianName) {
      const m = await musicianModel
        .findById(sub.musicianId)
        .select("basicInfo firstName lastName email")
        .lean();

      const emailFromMusician =
        String(m?.basicInfo?.email || m?.email || "").trim();

      const nameFromMusician =
        String(
          m?.basicInfo?.firstName || m?.firstName || ""
        ).trim();

      // last name optional
      const lastFromMusician =
        String(
          m?.basicInfo?.lastName || m?.lastName || ""
        ).trim();

      if (!musicianEmail && emailFromMusician) musicianEmail = emailFromMusician;
      if (!musicianName) musicianName = [nameFromMusician, lastFromMusician].filter(Boolean).join(" ").trim();
    }

    // ✅ Pick best recipient: bandLeaderEmail > musicianEmail
    const recipientEmail =
      String(sub.bandLeaderEmail || "").trim() || musicianEmail;

    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot approve: no email found on submission and could not resolve from musicianId.",
      });
    }

        const { code, inviteCodeHash } = await generateUniqueInviteCode();

    // ✅ Update submission (store hash only)
    sub.status = "approved";
    sub.inviteCodeHash = inviteCodeHash;
    sub.inviteCodeUsed = false;

    // keep your backfilled info
    sub.musicianEmail = musicianEmail || sub.musicianEmail;
    sub.musicianName = musicianName || sub.musicianName;

    // (optional) for legacy compatibility you can blank inviteCode
    // sub.inviteCode = undefined;

    await sub.save();

    // ✅ Send email (plaintext code ONLY goes to user)
    await sendActApprovalEmail(
      recipientEmail,
      musicianName || "there",
      sub.actName || "your act",
      code
    );

    // ✅ Send email (invite code)
    await sendActApprovalEmail(
      recipientEmail,
      musicianName || "there",
      sub.actName || "your act",
      code
    );

    return res.json({ success: true, sub });
  } catch (err) {
    console.error("approveActPreSubmission:", err);
    return res.status(500).json({ success: false, message: err?.message || "Server error" });
  }
};

export const rejectActPreSubmission = async (req, res) => {
  try {
    const { id } = req.params;

    const sub = await ActPreSubmission.findByIdAndUpdate(
      id,
      { status: "rejected" },
      { new: true }
    );

    if (!sub) return res.status(404).json({ success: false, message: "Not found" });

    return res.json({ success: true, sub });
  } catch (err) {
    console.error("rejectActPreSubmission:", err);
    res.status(500).json({ success: false });
  }
};

export const validateActInviteCode = async (req, res) => {
  try {
    const { code, musicianId } = req.body;
    const trimmed = String(code || "").trim().toUpperCase();
    if (!trimmed || !musicianId) {
      return res.json({ success: false, valid: false });
    }

    const inviteCodeHash = hashCode(trimmed);

    const sub = await ActPreSubmission.findOne({
      inviteCodeHash,
      musicianId,
      status: "approved",
      inviteCodeUsed: false,
    }).lean();

    if (!sub) return res.json({ success: false, valid: false });

    return res.json({ success: true, valid: true, actName: sub.actName });
  } catch (err) {
    console.error("validateActInviteCode:", err);
    return res.status(500).json({ success: false, valid: false });
  }
};

export const markInviteCodeUsed = async (req, res) => {
  try {
    const { code, musicianId } = req.body;
    const trimmed = String(code || "").trim().toUpperCase();
    if (!trimmed || !musicianId) {
      return res.status(400).json({ success: false, message: "Missing code or musicianId" });
    }

    const inviteCodeHash = hashCode(trimmed);

    const sub = await ActPreSubmission.findOneAndUpdate(
      { inviteCodeHash, musicianId, inviteCodeUsed: false },
      { inviteCodeUsed: true },
      { new: true }
    );

    return res.json({ success: true, sub });
  } catch (err) {
    console.error("markInviteCodeUsed:", err);
    return res.status(500).json({ success: false });
  }
};

export const getActPreSubmissionCount = async (req, res) => {
  try {
    const count = await ActPreSubmission.countDocuments({ status: "pending" });
    return res.json({ success: true, count });
  } catch (err) {
    console.error("getActPreSubmissionCount:", err);
    res.status(500).json({ success: false });
  }
};

export const getOnePreSubmission = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const sub = await ActPreSubmission.findById(id).lean();

    if (!sub) {
      return res
        .status(404)
        .json({ success: false, message: "Not found" });
    }

    return res.json({ success: true, submission: sub });
  } catch (err) {
    console.error("getOnePreSubmission error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Server error",
    });
  }
};
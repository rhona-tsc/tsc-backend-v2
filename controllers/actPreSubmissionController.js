import mongoose from "mongoose";
import ActPreSubmission from "../models/ActPreSubmissionModel.js";
import { generateInviteCode } from "../utils/generateInviteCode.js";
import { sendActApprovalEmail } from "../utils/sendActApprovalEmail.js";
import musicianModel from "../models/musicianModel.js";

async function generateUniqueInviteCode() {
  // simple collision guard
  for (let i = 0; i < 10; i++) {
    const code = generateInviteCode();
    const exists = await ActPreSubmission.exists({ inviteCode: code });
    if (!exists) return code;
  }
  // extremely unlikely fallback
  return generateInviteCode();
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
    if (sub.status === "approved" && sub.inviteCode) {
      // still try send email if missing / not sent etc (optional)
      if (sub.musicianEmail) {
        await sendActApprovalEmail(sub.musicianEmail, sub.musicianName, sub.actName, sub.inviteCode);
      }
      return res.json({ success: true, sub });
    }

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

    const code = await generateUniqueInviteCode();

    // ✅ Update submission
    sub.status = "approved";
    sub.inviteCode = code;
    sub.musicianEmail = musicianEmail || sub.musicianEmail;
    sub.musicianName = musicianName || sub.musicianName;
    await sub.save();

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

    const sub = await ActPreSubmission.findOne({
      inviteCode: code,
      musicianId,
      status: "approved",
      inviteCodeUsed: false
    });

    if (!sub) {
      return res.json({ success: false, valid: false });
    }

    return res.json({ success: true, valid: true, actName: sub.actName });
  } catch (err) {
    console.error("validateActInviteCode:", err);
    res.status(500).json({ success: false });
  }
};

export const markInviteCodeUsed = async (req, res) => {
  try {
    const { code, musicianId } = req.body;

    const sub = await ActPreSubmission.findOneAndUpdate(
      { inviteCode: code, musicianId },
      { inviteCodeUsed: true },
      { new: true }
    );

    return res.json({ success: true, sub });
  } catch (err) {
    console.error("markInviteCodeUsed:", err);
    res.status(500).json({ success: false });
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
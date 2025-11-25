import ActPreSubmission from "../models/ActPreSubmissionModel.js";
import { generateInviteCode } from "../utils/generateInviteCode.js";
import { sendActApprovalEmail } from "../utils/sendActApprovalEmail.js";

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

    const submission = await ActPreSubmission.create({
      musicianId,
      musicianName,
      musicianEmail,
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

    const code = generateInviteCode();

    const sub = await ActPreSubmission.findByIdAndUpdate(
      id,
      {
        status: "approved",
        inviteCode: code
      },
      { new: true }
    );

    if (!sub) return res.status(404).json({ success: false, message: "Not found" });

    // send email to musician
    await sendActApprovalEmail(sub.musicianEmail, sub.musicianName, sub.actName, code);

    return res.json({ success: true, sub });
  } catch (err) {
    console.error("approveActPreSubmission:", err);
    res.status(500).json({ success: false });
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
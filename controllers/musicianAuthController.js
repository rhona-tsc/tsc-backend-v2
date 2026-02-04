// controllers/authController.js
import crypto from "crypto";
import bcrypt from "bcryptjs";
import musicianModel from "../models/musicianModel.js";
import { sendResetEmail } from "../utils/mailer.js";


const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5174").replace(/\/$/, "");

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function forgotPassword(req, res) {
  try {
    const rawEmail = String(req.body?.email || "").trim().toLowerCase();
    if (!rawEmail) return res.status(400).json({ success: false, message: "Email is required" });

    const user = await musicianModel.findOne({ email: rawEmail });

    // Always respond success to avoid account enumeration
    if (!user) return res.json({ success: true });

    const token = crypto.randomBytes(32).toString("hex");

    user.resetPasswordToken = sha256(token);
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;

    await sendResetEmail({ to: user.email, resetUrl });


    return res.json({ success: true });
  } catch (e) {
    console.error("forgotPassword error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function resetPassword(req, res) {
  try {
    const token = String(req.body?.token || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const newPassword = String(req.body?.newPassword || "");

    if (!token || !email || !newPassword) {
      return res.status(400).json({ success: false, message: "Missing token/email/newPassword" });
    }
    if (newPassword.length < 8) {
      return res.status(422).json({ success: false, message: "Password must be at least 8 characters" });
    }

    const tokenHash = sha256(token);

    const user = await musicianModel.findOne({
      email,
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "Reset link is invalid or expired." });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    return res.json({ success: true, message: "Password has been reset." });
  } catch (e) {
    console.error("resetPassword error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
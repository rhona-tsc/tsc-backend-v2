// controllers/authController.js
import crypto from "crypto";
import bcrypt from "bcryptjs";
import userModel from "../models/userModel.js";
import { sendResetEmail } from "../utils/mailer.js";

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5174").replace(/\/$/, "");

export async function forgotPassword(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    const user = await userModel.findOne({ email: String(email).toLowerCase() });
    // Always return 200 to avoid email enumeration
    if (!user) return res.json({ success: true, message: "If that email exists, a reset link has been sent." });

    // Create random token (we store hash in DB)
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    user.resetPasswordToken = tokenHash;
    user.resetPasswordExpires = new Date(Date.now() + 1000 * 60 * 30); // 30 minutes
    await user.save();

    // Link points to frontend reset page (you can change the path)
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;

    await sendResetEmail({ to: user.email, resetUrl });

    return res.json({ success: true, message: "If that email exists, a reset link has been sent." });
  } catch (e) {
    console.error("forgotPassword error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function resetPassword(req, res) {
  try {
    const { token, email, newPassword } = req.body || {};
    if (!token || !email || !newPassword) {
      return res.status(400).json({ success: false, message: "Missing token/email/password" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      email: String(email).toLowerCase(),
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "Reset link is invalid or expired." });
    }

    // Update password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // Clear reset fields
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    return res.json({ success: true, message: "Password has been reset." });
  } catch (e) {
    console.error("resetPassword error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
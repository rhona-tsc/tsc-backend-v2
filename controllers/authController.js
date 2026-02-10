// controllers/authController.js
import crypto from "crypto";
import bcrypt from "bcryptjs";
import userModel from "../models/userModel.js";
import { sendResetEmail } from "../utils/mailer.js";
import jwt from "jsonwebtoken";
import OtpToken from "../models/OtpToken.js";

const signJwt = (user) =>
  jwt.sign(
    {
      userId: user._id,
      email: user.email,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      phone: user.phone || "",
      role: user.role || "client",
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  const hashCode = (email, code) =>
  crypto
    .createHash("sha256")
    .update(`${email}:${code}:${process.env.OTP_SECRET}`)
    .digest("hex");

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5174").replace(/\/$/, "");


export const verifyOtp = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();

    if (!email || !code) return res.status(400).json({ success: false, message: "missing_fields" });

    const rec = await OtpToken.findOne({ email });
    if (!rec) return res.status(400).json({ success: false, message: "invalid_code" });
    if (rec.expiresAt.getTime() < Date.now()) return res.status(400).json({ success: false, message: "expired_code" });

    if ((rec.attempts || 0) >= 5) return res.status(429).json({ success: false, message: "too_many_attempts" });

    const incomingHash = hashCode(email, code);
    if (incomingHash !== rec.codeHash) {
      rec.attempts = (rec.attempts || 0) + 1;
      await rec.save();
      return res.status(400).json({ success: false, message: "invalid_code" });
    }

    // ✅ OTP valid: consume token
    await OtpToken.deleteOne({ email });

    // ✅ Find or create user
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ email, role: "client" }); // you can extend later
    }

    const token = signJwt(user);

    return res.json({
      success: true,
      token,
      userId: user._id,
      email: user.email,
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: "verify_failed" });
  }
};

export async function forgotPassword(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    const normEmail = String(email || "").trim().toLowerCase();
    const user = await userModel.findOne({ email: normEmail });
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
    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const normEmail = String(email || "").trim().toLowerCase();

    const user = await userModel.findOne({
      email: normEmail,
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
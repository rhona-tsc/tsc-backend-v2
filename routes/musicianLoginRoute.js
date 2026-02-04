import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";

import musicianModel from "../models/musicianModel.js";
import { loginMusician, registerMusician } from "../controllers/musicianLoginController.js";


const musicianLoginRouter = express.Router();

// Normalise frontend URL (avoid double/missing slashes)
const FRONTEND_URL = String(process.env.ADMIN.FRONTEND_URL || "").replace(/\/$/, "");

// Email "From" identity (prefer env, fallback to hello@)
const FROM_EMAIL = String(
  process.env.EMAIL_FROM || "hello@thesupremecollective.co.uk"
).trim();
const FROM_NAME = String(
  process.env.SMTP_FROM_NAME || "The Supreme Collective"
).trim();
const FROM_HEADER = FROM_NAME ? `${FROM_NAME} <${FROM_EMAIL}>` : FROM_EMAIL;
const REPLY_TO = String(process.env.SMTP_REPLY_TO || FROM_EMAIL).trim();

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function hashPassword(pw) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(pw, salt);
}

// --- Simple admin auth: checks Bearer token + role === 'agent'
function requireAdminAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
    if (!token) return res.status(401).json({ success: false, message: "Missing auth token." });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Expecting your login controller to sign token with role/email/userId
    if (decoded?.role !== "agent") {
      return res.status(403).json({ success: false, message: "Admin access required." });
    }

    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: "Invalid/expired token." });
  }
}

// --- Minimal nodemailer sendEmail helper
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465, // true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail({ to, subject, html }) {
  await transporter.sendMail({
    from: FROM_HEADER,
    replyTo: REPLY_TO,
    to,
    subject,
    html,
  });
}

// Existing routes
musicianLoginRouter.post("/register", registerMusician);
musicianLoginRouter.post("/login", loginMusician);

// ----------------------------------------------------
// INVITE: admin generates a 1-time set-password link
// POST /api/musician-login/invite { email }
// ----------------------------------------------------
musicianLoginRouter.post("/invite", requireAdminAuth, async (req, res) => {
  try {
    const email = (req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: "Email required." });

    const user = await musicianModel.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.inviteTokenHash = sha256(rawToken);
    user.inviteTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    user.mustChangePassword = true;
    await user.save();

    const link = `${FRONTEND_URL}/set-password?token=${rawToken}&email=${encodeURIComponent(
      user.email
    )}`;

    await sendEmail({
      to: user.email,
      subject: "Set up your Supreme Collective portal access",
      html: `
        <p>Hi ${user.firstName || ""},</p>
        <p>Your portal access is ready. Please set your password here:</p>
        <p><a href="${link}">Set your password</a></p>
        <p>This link expires in 24 hours.</p>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[invite] error:", err);
    res.status(500).json({ success: false, message: "Invite failed." });
  }
});

// ----------------------------------------------------
// SET PASSWORD (invite link)
// POST /api/musician-login/set-password
// { email, token, newPassword }
// ----------------------------------------------------
musicianLoginRouter.post("/set-password", async (req, res) => {
  try {
    const email = (req.body?.email || "").trim().toLowerCase();
    const token = (req.body?.token || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!email || !token || !newPassword) {
      return res.status(400).json({ success: false, message: "Email, token and newPassword are required." });
    }
    if (newPassword.length < 8) {
      return res.status(422).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const user = await musicianModel.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (!user.inviteTokenHash || !user.inviteTokenExpires) {
      return res.status(400).json({ success: false, message: "No active invite token." });
    }

    if (user.inviteTokenExpires.getTime() < Date.now()) {
      return res.status(401).json({ success: false, message: "Invite link expired." });
    }

    const ok = sha256(token) === user.inviteTokenHash;
    if (!ok) return res.status(401).json({ success: false, message: "Invalid token." });

    user.password = await hashPassword(newPassword);
    user.inviteTokenHash = null;
    user.inviteTokenExpires = null;
    user.mustChangePassword = false;
    user.hasSetPassword = true;
    user.passwordLastChangedAt = new Date();
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error("[set-password] error:", err);
    res.status(500).json({ success: false, message: "Set password failed." });
  }
});

// ----------------------------------------------------
// FORGOT PASSWORD: request reset link
// POST /api/musician-login/forgot-password { email }
// (Always responds success true to avoid account enumeration)
// ----------------------------------------------------
musicianLoginRouter.post("/forgot-password", async (req, res) => {
  try {
    const email = (req.body?.email || "").trim().toLowerCase();
    if (!email) return res.json({ success: true }); // silent

    const user = await musicianModel.findOne({ email });
    if (!user) return res.json({ success: true }); // silent

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.resetTokenHash = sha256(rawToken);
    user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await user.save();

    const link = `${FRONTEND_URL}/reset-password?token=${rawToken}&email=${encodeURIComponent(
      user.email
    )}`;

    await sendEmail({
      to: user.email,
      subject: "Reset your Supreme Collective password",
      html: `
        <p>Hi ${user.firstName || ""},</p>
        <p>You requested a password reset. Click below to reset it:</p>
        <p><a href="${link}">Reset password</a></p>
        <p>This link expires in 1 hour. If you didn’t request this, you can ignore this email.</p>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[forgot-password] error:", err);
    // still return success true to avoid info leakage
    res.json({ success: true });
  }
});

// ----------------------------------------------------
// RESET PASSWORD: set new password using reset token
// POST /api/musician-login/reset-password
// { email, token, newPassword }
// ----------------------------------------------------
musicianLoginRouter.post("/reset-password", async (req, res) => {
  try {
    const email = (req.body?.email || "").trim().toLowerCase();
    const token = (req.body?.token || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!email || !token || !newPassword) {
      return res.status(400).json({ success: false, message: "Email, token and newPassword are required." });
    }
    if (newPassword.length < 8) {
      return res.status(422).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const user = await musicianModel.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (!user.resetTokenHash || !user.resetTokenExpires) {
      return res.status(400).json({ success: false, message: "No active reset token." });
    }

    if (user.resetTokenExpires.getTime() < Date.now()) {
      return res.status(401).json({ success: false, message: "Reset link expired." });
    }

    const ok = sha256(token) === user.resetTokenHash;
    if (!ok) return res.status(401).json({ success: false, message: "Invalid token." });

    user.password = await hashPassword(newPassword);
    user.resetTokenHash = null;
    user.resetTokenExpires = null;
    user.mustChangePassword = false;
    user.hasSetPassword = true;
    user.passwordLastChangedAt = new Date();
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error("[reset-password] error:", err);
    res.status(500).json({ success: false, message: "Reset password failed." });
  }
});

export default musicianLoginRouter;
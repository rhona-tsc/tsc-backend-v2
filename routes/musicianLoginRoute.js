import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import mongoose from "mongoose";

import musicianModel from "../models/musicianModel.js";
import { loginMusician, registerMusician } from "../controllers/musicianLoginController.js";

const musicianLoginRouter = express.Router();

// Normalise frontend URL (avoid double/missing slashes)
const FRONTEND_URL = String(process.env.ADMIN_FRONTEND_URL || "").replace(/\/$/, "");

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
    if (!token)
      return res
        .status(401)
        .json({ success: false, message: "Missing auth token." });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Expecting your login controller to sign token with role/email/userId
    if (decoded?.role !== "agent") {
      return res
        .status(403)
        .json({ success: false, message: "Admin access required." });
    }

    req.user = decoded;
    next();
  } catch (e) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid/expired token." });
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

// Wrap /login so we can stamp lastLoginAt when the controller succeeds.
musicianLoginRouter.post("/login", async (req, res, next) => {
  try {
    const originalJson = res.json.bind(res);

    res.json = async (payload) => {
      try {
        if (payload?.success) {
          const email = String(req.body?.email || "").trim().toLowerCase();
          if (email) {
            await musicianModel.updateOne(
              { email },
              { $set: { lastLoginAt: new Date() } }
            );
          }
        }
      } catch (e) {
        console.warn(
          "[musician-login] failed to stamp lastLoginAt:",
          e?.message || e
        );
      }
      return originalJson(payload);
    };

    return loginMusician(req, res, next);
  } catch (err) {
    return next(err);
  }
});

// ----------------------------------------------------
// INVITE: admin generates a 1-time set-password link
// POST /api/musician-login/invite { email }
// ----------------------------------------------------
musicianLoginRouter.post("/invite", requireAdminAuth, async (req, res) => {
  try {
    const email = (req.body?.email || "").trim().toLowerCase();
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email required." });

    const user = await musicianModel.findOne({ email });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.inviteTokenHash = sha256(rawToken);
    user.inviteTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // Onboarding tracking
    if (!user.onboardingInvitedAt) user.onboardingInvitedAt = new Date();

    user.mustChangePassword = true;
    await user.save();

    const link = `${FRONTEND_URL}/set-password?token=${rawToken}&email=${encodeURIComponent(
      user.email
    )}`;

  const LOGO_URL =
  process.env.PORTAL_EMAIL_LOGO_URL ||
  "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1770227002/TSC_email_logo_e6o5m5.png"; // <- replace or set env

const safeName =
  (user.firstName || user.lastName)
    ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
    : "";

await sendEmail({
  to: user.email,
  subject: "Your Supreme Collective Portal Access",
  html: `
  <div style="background:#f6f6f6;padding:32px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:640px;">
      <tr>
<td style="padding:10px 0 20px 0;text-align:center;">
<img
  src="${LOGO_URL}"
  alt="The Supreme Collective"
  width="520"
  style="width:100%;max-width:520px;height:auto;display:block;margin:0 auto;"
/>        </td>
      </tr>

      <tr>
        <td style="background:#ffffff;border-radius:14px;padding:26px 22px;box-shadow:0 8px 24px rgba(0,0,0,0.06);border:1px solid #eee;">
          <h1 style="margin:0 0 10px 0;font-size:20px;line-height:1.25;color:#111;">
            Welcome${safeName ? `, ${safeName}` : ""} 👋
          </h1>

          <p style="margin:0 0 14px 0;color:#333;font-size:14.5px;line-height:1.6;">
            Your <strong>Supreme Collective musician portal</strong> is ready. Please set your password using the button below:
          </p>

          <div style="text-align:center;margin:18px 0 18px 0;">
            <a href="${link}"
style="display:inline-block;background:#ff6667;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:800;font-size:15px;">              Set your password
            </a>
          </div>

        <p style="margin:0 0 14px 0;color:#333;font-size:14.5px;line-height:1.6;">
  <strong>Why this matters:</strong> keeping your profile up to date helps clients get a feel for who they’re booking — and it helps us
  <strong>propose you as a deputy</strong> for other acts that join The Supreme Collective over time.
</p>

<div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:14px 14px;margin:0 0 14px 0;">
  <p style="margin:0 0 8px 0;color:#111;font-size:14.5px;font-weight:700;">
    Please take 5 minutes to:
  </p>
  <ul style="margin:0;padding-left:18px;color:#333;font-size:14.5px;line-height:1.65;">
    <li><strong>Update your repertoire</strong> (aim for at least <strong>30 songs</strong> — enough material to comfortably cover a <strong>2-hour performance</strong>)</li>
    <li><strong>Add your bio</strong> so clients can get to know you better</li>
    <li><strong>Add skills & talents</strong> (e.g. BV’s, MD, DJ, sound engineering, band leading, doubling on instruments) — this improves your match score and showcases you in the best light when clients are choosing a band</li>
  </ul>
</div>

          <p style="margin:0 0 10px 0;color:#333;font-size:13.5px;line-height:1.6;">
            <strong>Heads up:</strong> this link expires in <strong>24 hours</strong>.
          </p>

          <p style="margin:0 0 0 0;color:#666;font-size:12.5px;line-height:1.6;">
            Button not working? Copy and paste this link into your browser:<br/>
            <a href="${link}" style="color:#ff6667;text-decoration:underline;word-break:break-all;">${link}</a>
          </p>
        </td>
      </tr>

      <tr>
        <td style="padding:14px 6px 0 6px;text-align:center;color:#999;font-size:12px;line-height:1.5;">
          The Supreme Collective • Please reply to this email if you need a hand getting set up.
        </td>
      </tr>
    </table>
  </div>
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
      return res.status(400).json({
        success: false,
        message: "Email, token and newPassword are required.",
      });
    }
    if (newPassword.length < 8) {
      return res
        .status(422)
        .json({ success: false, message: "Password must be at least 8 characters." });
    }

    const user = await musicianModel.findOne({ email });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    if (!user.inviteTokenHash || !user.inviteTokenExpires) {
      return res
        .status(400)
        .json({ success: false, message: "No active invite token." });
    }

    if (user.inviteTokenExpires.getTime() < Date.now()) {
      return res
        .status(401)
        .json({ success: false, message: "Invite link expired." });
    }

    const ok = sha256(token) === user.inviteTokenHash;
    if (!ok)
      return res
        .status(401)
        .json({ success: false, message: "Invalid token." });

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
      return res.status(400).json({
        success: false,
        message: "Email, token and newPassword are required.",
      });
    }
    if (newPassword.length < 8) {
      return res
        .status(422)
        .json({ success: false, message: "Password must be at least 8 characters." });
    }

    const user = await musicianModel.findOne({ email });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    if (!user.resetTokenHash || !user.resetTokenExpires) {
      return res
        .status(400)
        .json({ success: false, message: "No active reset token." });
    }

    if (user.resetTokenExpires.getTime() < Date.now()) {
      return res
        .status(401)
        .json({ success: false, message: "Reset link expired." });
    }

    const ok = sha256(token) === user.resetTokenHash;
    if (!ok)
      return res
        .status(401)
        .json({ success: false, message: "Invalid token." });

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

// ----------------------------------------------------
// BULK INVITE: admin sends onboarding emails in bulk
// POST /api/musician-login/bulk-invite
//
// Body options (all optional):
// {
//   limit: 100,
//   dryRun: false,
//   includeCompleted: false,
//   onlyVocalists: true,
//   forceResend: false,
//   emails: ["a@b.com","c@d.com"]   // if provided, ONLY invite these
// }
// ----------------------------------------------------
musicianLoginRouter.post("/bulk-invite", requireAdminAuth, async (req, res) => {
  try {
    const {
      limit = 120,
      dryRun = false,
      includeCompleted = false,
      onlyVocalists = false,
      forceResend = false,
      emails = [],
      onlyNew = true,
      afterId = null,
    } = req.body || {};

    const now = new Date();
    const LIMIT = Math.min(Math.max(parseInt(limit, 10) || 120, 1), 500);

    const vocalistTypes = [
      "Lead Vocalist",
      "Backing Vocalist",
      "Backing Vocalist-Instrumentalist",
      "Lead Vocalist-Instrumentalist",
    ];

    // Base query
    const q = {
      role: "musician",
      status: { $in: ["approved", "Approved, changes pending"] }, // tweak if you want pending too
      email: { $type: "string", $ne: "" },
    };

    // ✅ Batch cursor: only process users after this _id
    if (afterId && mongoose.Types.ObjectId.isValid(afterId)) {
      q._id = { $gt: new mongoose.Types.ObjectId(afterId) };
    }

    // If onlyNew: only email people who still need to set a password
    if (onlyNew) {
      q.$and = q.$and || [];
      q.$and.push({
        $or: [
          { hasSetPassword: { $ne: true } },
          { password: { $exists: false } },
          { password: null },
          { password: "" },
        ],
      });
    }

    // Optional: only certain emails
    if (Array.isArray(emails) && emails.length) {
      q.email = { $in: emails.map((e) => String(e).trim().toLowerCase()) };
    }

    // Optional: only vocalists
    if (onlyVocalists) {
      q["vocals.type"] = { $in: vocalistTypes };
    }

    // Exclude completed unless explicitly included
    if (!includeCompleted) {
      q.onboardingStatus = { $ne: "completed" };
    }

    // If not forceResend: skip people invited in last 7 days
    if (!forceResend) {
      q.$or = [
        { lastInviteSentAt: null },
        { lastInviteSentAt: { $lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      ];
    }

    const users = await musicianModel
      .find(q)
      .select(
        "_id email firstName lastName hasSetPassword password onboardingInvitedAt onboardingStatus lastLoginAt inviteTokenExpires lastInviteSentAt inviteCount"
      )
      .sort({ _id: 1 })
      .limit(LIMIT)
      .lean();

    const report = {
      success: true,
      dryRun: !!dryRun,
      matched: users.length,
      afterId: afterId && mongoose.Types.ObjectId.isValid(afterId) ? String(afterId) : null,
      nextAfterId: null,
      emailed: 0,
      invitedSetPassword: 0,
      nudgedLogin: 0,
      skippedNoEmail: 0,
      skippedCompleted: 0,
      onlyNew: !!onlyNew,
      forceResend: !!forceResend,
      onlyVocalists: !!onlyVocalists,
      skippedInvitedRecently: 0,
      skippedAlreadyHasPassword: 0,
      items: [],
    };

    let lastProcessedId = null;
    for (const u of users) {
      lastProcessedId = String(u?._id || "") || lastProcessedId;
      const email = String(u.email || "").trim().toLowerCase();
      if (!email) {
        report.skippedNoEmail += 1;
        continue;
      }

      if (!includeCompleted && u.onboardingStatus === "completed") {
        report.skippedCompleted += 1;
        continue;
      }

      // Skip if onlyNew and they already have a password / have set password
      if (onlyNew && (u.hasSetPassword === true || (u.password && String(u.password).trim()))) {
        report.skippedAlreadyHasPassword += 1;
        report.items.push({
          email,
          needsSetPassword: false,
          skipped: "already_has_password",
          onboardingStatus: u.onboardingStatus || null,
          lastLoginAt: u.lastLoginAt || null,
          lastInviteSentAt: u.lastInviteSentAt || null,
        });
        continue;
      }

      // Skip if not forceResend and they were invited in the last 24 hours
      if (
        !forceResend &&
        u.lastInviteSentAt &&
        new Date(u.lastInviteSentAt).getTime() > Date.now() - 24 * 60 * 60 * 1000
      ) {
        report.skippedInvitedRecently += 1;
        report.items.push({
          email,
          needsSetPassword: false,
          skipped: "invited_recently",
          onboardingStatus: u.onboardingStatus || null,
          lastLoginAt: u.lastLoginAt || null,
          lastInviteSentAt: u.lastInviteSentAt,
        });
        continue;
      }

      const name =
        u.firstName || u.lastName
          ? `${u.firstName || ""} ${u.lastName || ""}`.trim()
          : "";
      const greeting = name ? `Hi ${name},` : "Hi there,";

      const needsSetPassword =
        u.hasSetPassword !== true && !u.password;

      let subject = "";
      let html = "";
      const lastInviteSentAt = u.lastInviteSentAt || null;

      // If they haven't set password yet, generate invite token + link
      if (needsSetPassword) {
        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = sha256(rawToken);
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const link = `${FRONTEND_URL}/set-password?token=${rawToken}&email=${encodeURIComponent(
          email
        )}`;

        subject = "Set up your profile on The Supreme Collective";
        html = `
          <div style="background:#f6f6f6;padding:28px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
            <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #eee;border-radius:14px;padding:22px;">
              <p style="margin:0 0 12px 0;color:#111;font-size:15px;line-height:1.6;">${greeting}</p>

              <p style="margin:0 0 12px 0;color:#333;font-size:14.5px;line-height:1.7;">
                You’ve been invited to set up your <strong>Supreme Collective musician profile</strong>.
              </p>

              <p style="margin:0 0 12px 0;color:#333;font-size:14.5px;line-height:1.7;">
                First, please create your password using the button below (this link expires in <strong>24 hours</strong>):
              </p>

              <div style="text-align:center;margin:18px 0 18px 0;">
                <a href="${link}" style="display:inline-block;background:#ff6667;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:800;font-size:15px;">
                  Create your password
                </a>
              </div>

              <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:14px 14px;margin:0 0 14px 0;">
                <p style="margin:0 0 8px 0;color:#111;font-size:14.5px;font-weight:700;">Why set up your profile?</p>
                <ul style="margin:0;padding-left:18px;color:#333;font-size:14.5px;line-height:1.7;">
                  <li><strong>Get matched to deputy roles automatically</strong> when acts register — your instruments, vocals, skills and location help bandleaders find you quickly.</li>
                  <li><strong>Use it as an online CV</strong> you can share for other work — videos, photos, bio, repertoire and equipment all in one place.</li>
                  <li><strong>One‑click apply</strong> for deputy opportunities (launching very soon) — no more long forms.</li>
                  <li><strong>Submit or recommend an act</strong> to join The Supreme Collective — a musician profile is required to do this.</li>
                </ul>
              </div>

              <p style="margin:0 0 10px 0;color:#333;font-size:14.5px;line-height:1.7;">
                Once you’ve set a password, log in and add whatever you can — a short bio, a few videos/photos, and as much repertoire/gear detail as you’re happy to share.
              </p>

              <p style="margin:0;color:#666;font-size:12.5px;line-height:1.6;">
                Button not working? Copy and paste this link into your browser:<br/>
                <a href="${link}" style="color:#ff6667;text-decoration:underline;word-break:break-all;">${link}</a>
              </p>
            </div>
          </div>
        `;

        if (!dryRun) {
          await musicianModel.updateOne(
            { _id: u._id },
            {
              $set: {
                inviteTokenHash: tokenHash,
                inviteTokenExpires: expires,
                mustChangePassword: true,
                onboardingInvitedAt: u.onboardingInvitedAt || now,
                lastInviteSentAt: now,
              },
              $inc: { inviteCount: 1 },
            }
          );

          await sendEmail({ to: email, subject, html });
        }

        report.invitedSetPassword += 1;
        report.emailed += dryRun ? 0 : 1;
        report.items.push({
          email,
          needsSetPassword,
          onboardingStatus: u.onboardingStatus || null,
          lastLoginAt: u.lastLoginAt || null,
          lastInviteSentAt,
          subject,
          action: "invited_set_password",
        });
      } else {
        // They have a password already - nudge to login + complete
        const link = `${FRONTEND_URL}/login`;

        subject = "Set up your profile on The Supreme Collective";
        html = `
          <div style="background:#f6f6f6;padding:28px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
            <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #eee;border-radius:14px;padding:22px;">
              <p style="margin:0 0 12px 0;color:#111;font-size:15px;line-height:1.6;">${greeting}</p>

              <p style="margin:0 0 12px 0;color:#333;font-size:14.5px;line-height:1.7;">
                Quick invite to set up your <strong>Supreme Collective musician profile</strong>.
              </p>

              <div style="text-align:center;margin:18px 0 18px 0;">
                <a href="${link}" style="display:inline-block;background:#ff6667;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:800;font-size:15px;">
                  Log in to set up your profile
                </a>
              </div>

              <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:14px 14px;margin:0 0 14px 0;">
                <p style="margin:0 0 8px 0;color:#111;font-size:14.5px;font-weight:700;">Why set up your profile?</p>
                <ul style="margin:0;padding-left:18px;color:#333;font-size:14.5px;line-height:1.7;">
                  <li><strong>Get matched to deputy roles automatically</strong> when acts register — your instruments, vocals, skills and location help bandleaders find you quickly.</li>
                  <li><strong>Use it as an online CV</strong> you can share for other work — videos, photos, bio, repertoire and equipment all in one place.</li>
                  <li><strong>One‑click apply</strong> for deputy opportunities (launching very soon) — no more long forms.</li>
                  <li><strong>Submit or recommend an act</strong> to join The Supreme Collective — a musician profile is required to do this.</li>
                </ul>
              </div>

              <p style="margin:0;color:#666;font-size:12.5px;line-height:1.6;">
                Forgotten password? Use “Forgot password” on the login screen.
              </p>
            </div>
          </div>
        `;

        if (!dryRun) {
          await musicianModel.updateOne(
            { _id: u._id },
            {
              $set: {
                onboardingInvitedAt: u.onboardingInvitedAt || now,
                lastInviteSentAt: now,
              },
              $inc: { inviteCount: 1 },
            }
          );

          await sendEmail({ to: email, subject, html });
        }

        report.nudgedLogin += 1;
        report.emailed += dryRun ? 0 : 1;
        report.items.push({
          email,
          needsSetPassword,
          onboardingStatus: u.onboardingStatus || null,
          lastLoginAt: u.lastLoginAt || null,
          lastInviteSentAt,
          subject,
          action: "nudged_login",
        });
      }
    }

    report.nextAfterId = lastProcessedId || null;
    return res.json(report);
  } catch (err) {
    console.error("[bulk-invite] error:", err);
    return res.status(500).json({ success: false, message: "Bulk invite failed." });
  }
});

export default musicianLoginRouter;
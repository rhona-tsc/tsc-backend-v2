// backend/cron/onboardingChase.js
import crypto from "crypto";
import nodemailer from "nodemailer";
import musicianModel from "../models/musicianModel.js";

// Normalise frontend URL (avoid double/missing slashes)
const FRONTEND_URL = String(process.env.ADMIN_FRONTEND_URL || "").replace(/\/$/, "");

// Email "From" identity (prefer env, fallback to hello@)
const FROM_EMAIL = String(process.env.EMAIL_FROM || "hello@thesupremecollective.co.uk").trim();
const FROM_NAME = String(process.env.SMTP_FROM_NAME || "The Supreme Collective").trim();
const FROM_HEADER = FROM_NAME ? `${FROM_NAME} <${FROM_EMAIL}>` : FROM_EMAIL;
const REPLY_TO = String(process.env.SMTP_REPLY_TO || FROM_EMAIL).trim();

// Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendEmail({ to, subject, html }) {
  await transporter.sendMail({ from: FROM_HEADER, replyTo: REPLY_TO, to, subject, html });
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function isOnboardingComplete(u) {
  const hasPw = u?.hasSetPassword === true;
  const repCount = Array.isArray(u?.repertoire) ? u.repertoire.length : 0;
  const bioLen = String(u?.bio || "").trim().length;
  return hasPw && repCount >= 30 && bioLen > 0;
}

function computeOnboardingPhase(u) {
  const invitedAt = u?.onboardingInvitedAt ? new Date(u.onboardingInvitedAt) : null;
  const lastLoginAt = u?.lastLoginAt ? new Date(u.lastLoginAt) : null;

  if (isOnboardingComplete(u)) return "completed";
  if (invitedAt && !lastLoginAt) return "invited";
  if (lastLoginAt) return "in_progress";
  if (invitedAt) return "invited";
  return "not_started";
}

function needsSetPassword(u) {
  // safest interpretation:
  // - if hasSetPassword is not true OR password missing, treat as needs set password
  return u?.hasSetPassword !== true || !u?.password;
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/**
 * Weekly onboarding chase
 * - max 10 reminders
 * - only if not reminded in last 7 days
 * - regenerate invite token if expired/missing for users needing set-password
 */
export async function runOnboardingChase({
  limit = 120,
  dryRun = false,
  includePending = false,
  onlyVocalists = false,
} = {}) {
  const now = new Date();
  const sevenDaysAgo = daysAgo(7);

  const vocalistTypes = [
    "Lead Vocalist",
    "Backing Vocalist",
    "Backing Vocalist-Instrumentalist",
    "Lead Vocalist-Instrumentalist",
  ];

  const q = {
    role: "musician",
    email: { $type: "string", $ne: "" },
    // reminder rules
    onboardingReminderCount: { $lt: 10 },
    $or: [
      { onboardingLastRemindedAt: null },
      { onboardingLastRemindedAt: { $lte: sevenDaysAgo } },
    ],
  };

  // Status gate
  if (!includePending) {
    q.status = { $in: ["approved", "Approved, changes pending"] };
  }

  // Optional vocalist-only
  if (onlyVocalists) {
    q["vocals.type"] = { $in: vocalistTypes };
  }

  // Pull a lean set (include fields we need for checks)
  const users = await musicianModel
    .find(q)
    .select([
      "_id",
      "email",
      "firstName",
      "lastName",
      "bio",
      "repertoire",
      "password",
      "hasSetPassword",
      "inviteTokenExpires",
      "inviteTokenHash",
      "onboardingInvitedAt",
      "lastLoginAt",
      "onboardingReminderCount",
      "onboardingLastRemindedAt",
    ])
    .limit(Math.min(Math.max(parseInt(limit, 10) || 120, 1), 500))
    .lean();

  const report = {
    success: true,
    dryRun: !!dryRun,
    matched: users.length,
    emailed: 0,
    remindedSetPassword: 0,
    remindedLogin: 0,
    skippedComplete: 0,
    errors: 0,
    items: [],
  };

  for (const u of users) {
    try {
      if (isOnboardingComplete(u)) {
        report.skippedComplete += 1;
        continue;
      }

      const email = String(u.email || "").trim().toLowerCase();
      const name =
        (u.firstName || u.lastName)
          ? `${u.firstName || ""} ${u.lastName || ""}`.trim()
          : "";
      const greeting = name ? `Hi ${name},` : "Hi there,";

      const phase = computeOnboardingPhase(u);
      const setPw = needsSetPassword(u);

      let subject = "";
      let html = "";
      let updates = {
        onboardingInvitedAt: u.onboardingInvitedAt || now,
        onboardingLastRemindedAt: now,
      };

      if (setPw) {
        // regenerate token if missing or expired
        const expiresAt = u.inviteTokenExpires ? new Date(u.inviteTokenExpires) : null;
        const expired = !expiresAt || expiresAt.getTime() < Date.now();

        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = sha256(rawToken);
        const newExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const link = `${FRONTEND_URL}/set-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

        subject = "Action needed: set your Supreme Collective portal password";
        html = `
          <p>${greeting}</p>
          <p>Quick reminder to finish setting up your Supreme Collective portal access.</p>
          <p><strong>Step 1:</strong> set your password here:</p>
          <p><a href="${link}">Set your password</a></p>
          <p>This link expires in 24 hours.</p>
          <hr/>
          <p><strong>Then please complete:</strong></p>
          <ul>
            <li>Add a short bio</li>
            <li>Add at least 30 songs to your repertoire</li>
            <li>Check your contact details</li>
          </ul>
          <p>Thanks so much 🙏</p>
        `;

        // Always rotate the token on reminders (simple + safe)
        updates = {
          ...updates,
          inviteTokenHash: tokenHash,
          inviteTokenExpires: newExpires,
          mustChangePassword: true,
        };

        report.remindedSetPassword += 1;
      } else {
        const link = `${FRONTEND_URL}/login`;

        subject =
          phase === "invited"
            ? "Please log in to your Supreme Collective portal"
            : "Reminder: please complete your Supreme Collective profile";

        html = `
          <p>${greeting}</p>
          <p>Quick reminder to log in and complete your portal onboarding:</p>
          <ul>
            <li>Add/refresh your bio</li>
            <li>Add at least 30 songs to your repertoire</li>
            <li>Check your contact details</li>
          </ul>
          <p><a href="${link}">Log in to your portal</a></p>
          <p>If you’ve forgotten your password, use “Forgot password” on the login screen.</p>
          <p>Thanks so much 🙏</p>
        `;

        report.remindedLogin += 1;
      }

      if (!dryRun) {
        await musicianModel.updateOne(
          { _id: u._id },
          {
            $set: updates,
            $inc: { onboardingReminderCount: 1 },
          }
        );

        await sendEmail({ to: email, subject, html });
        report.emailed += 1;
      }

      report.items.push({
        email,
        phase,
        needsSetPassword: setPw,
        reminderCountBefore: u.onboardingReminderCount || 0,
      });
    } catch (err) {
      report.errors += 1;
      console.error("[onboardingChase] user error:", u?.email, err?.message || err);
    }
  }

  return report;
}
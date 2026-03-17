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

// --- Bulk invite summary email helpers ---
function redactEmail(e = "") {
  const s = String(e || "");
  const [u, d] = s.split("@");
  if (!u || !d) return s;
  const u2 = u.length <= 2 ? `${u.charAt(0)}*` : `${u.slice(0, 2)}***`;
  return `${u2}@${d}`;
}

function escapeHtml(s = "") {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendBulkInviteRunSummaryEmail({
  to,
  runLabel,
  isDryRun,
  cursorBefore,
  report,
  extraNote,
}) {
  if (!to) return { sent: false, skipped: true, error: "no_to" };

  const items = Array.isArray(report?.items) ? report.items : [];
  const sample = items.slice(0, 12);

  const subject = `${isDryRun ? "[DRY RUN] " : ""}TSC Bulk Invite ${runLabel} report — matched ${report?.matched || 0}, emailed ${report?.emailed || 0}`;

  const html = `
    <div style="background:#f6f6f6;padding:24px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #eee;border-radius:14px;padding:18px;">
        <h2 style="margin:0 0 12px 0;font-size:18px;color:#111;">Bulk invite run summary</h2>
        ${extraNote ? `<p style="margin:0 0 10px 0;color:#333;font-size:14px;">${escapeHtml(extraNote)}</p>` : ""}

        <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:12px;margin:0 0 12px 0;">
          <p style="margin:0 0 6px 0;color:#111;font-size:14px;"><strong>Run</strong>: ${escapeHtml(runLabel)} ${isDryRun ? "(dry run)" : ""}</p>
          <p style="margin:0 0 6px 0;color:#111;font-size:14px;"><strong>Matched</strong>: ${report?.matched || 0}</p>
          <p style="margin:0 0 6px 0;color:#111;font-size:14px;"><strong>Emailed</strong>: ${report?.emailed || 0}</p>
          <p style="margin:0 0 6px 0;color:#111;font-size:14px;"><strong>Invited (set password)</strong>: ${report?.invitedSetPassword || 0}</p>
          <p style="margin:0 0 6px 0;color:#111;font-size:14px;"><strong>Nudged (login)</strong>: ${report?.nudgedLogin || 0}</p>
          <p style="margin:0 0 6px 0;color:#111;font-size:14px;"><strong>Skipped already has password</strong>: ${report?.skippedAlreadyHasPassword || 0}</p>
          <p style="margin:0 0 0 0;color:#111;font-size:14px;"><strong>Next cursor</strong>: ${escapeHtml(report?.nextAfterId || "(none)")}</p>
        </div>

        <h3 style="margin:0 0 8px 0;font-size:15px;color:#111;">Sample of processed rows (first ${sample.length})</h3>
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:12.5px;">
          <thead>
            <tr>
              <th align="left" style="border-bottom:1px solid #eee;padding:8px 6px;color:#555;">Email</th>
              <th align="left" style="border-bottom:1px solid #eee;padding:8px 6px;color:#555;">Action</th>
              <th align="left" style="border-bottom:1px solid #eee;padding:8px 6px;color:#555;">Skipped reason</th>
            </tr>
          </thead>
          <tbody>
            ${sample
              .map(
                (x) => `
                  <tr>
                    <td style="border-bottom:1px solid #f2f2f2;padding:7px 6px;color:#111;">${escapeHtml(redactEmail(x.email))}</td>
                    <td style="border-bottom:1px solid #f2f2f2;padding:7px 6px;color:#111;">${escapeHtml(x.action || "-")}</td>
                    <td style="border-bottom:1px solid #f2f2f2;padding:7px 6px;color:#111;">${escapeHtml(x.skipped || "-")}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>

        <details style="margin-top:12px;">
          <summary style="cursor:pointer;color:#ff6667;font-weight:700;">Raw JSON (cursor + report)</summary>
          <pre style="white-space:pre-wrap;background:#0b1020;color:#e6e6e6;padding:12px;border-radius:10px;overflow:auto;">${escapeHtml(
            JSON.stringify({ cursorBefore: cursorBefore || null, report }, null, 2)
          )}</pre>
        </details>

        <p style="margin:12px 0 0 0;color:#777;font-size:12px;">Sent automatically by The Supreme Collective backend.</p>
      </div>
    </div>
  `;

  try {
    await sendEmail({ to, subject, html });
    return { sent: true, skipped: false };
  } catch (e) {
    console.warn("[bulk-invite] failed to send summary email:", e?.message || e);
    return { sent: false, skipped: false, error: String(e?.message || e) };
  }
}

// --- Preview musician invite email helper ---
async function sendBulkInvitePreviewEmail({
  to,
  runLabel,
  isDryRun,
  targetEmail,
  subject,
  html,
}) {
  if (!to) return { sent: false, skipped: true, error: "no_to" };

  const previewSubject = `${isDryRun ? "[DRY RUN] " : ""}[PREVIEW] Musician invite (${runLabel}) → ${targetEmail}`;

  const previewHtml = `
    <div style="background:#f6f6f6;padding:24px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #eee;border-radius:14px;padding:18px;">
        <h2 style="margin:0 0 10px 0;font-size:18px;color:#111;">Musician invite preview</h2>
        <p style="margin:0 0 10px 0;color:#333;font-size:14px;line-height:1.6;">
          This is a <strong>preview</strong> of the email that would be sent to: <strong>${escapeHtml(
            String(targetEmail || "")
          )}</strong>
        </p>
        <p style="margin:0 0 14px 0;color:#666;font-size:12.5px;line-height:1.6;">
          Original subject: <strong>${escapeHtml(String(subject || ""))}</strong>
        </p>

        <div style="border:1px solid #eee;border-radius:12px;overflow:hidden;">
          <div style="background:#fafafa;border-bottom:1px solid #eee;padding:10px 12px;color:#555;font-size:12.5px;">
            Rendered email body
          </div>
          <div style="padding:0;">${html || ""}</div>
        </div>

        <p style="margin:12px 0 0 0;color:#777;font-size:12px;">Sent automatically by The Supreme Collective backend.</p>
      </div>
    </div>
  `;

  try {
    await sendEmail({ to, subject: previewSubject, html: previewHtml });
    return { sent: true, skipped: false };
  } catch (e) {
    console.warn("[bulk-invite] failed to send preview email:", e?.message || e);
    return { sent: false, skipped: false, error: String(e?.message || e) };
  }
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
//   emails: ["a@b.com","c@d.com"],
//   onlyNew: true,
//   afterId: "<ObjectId>"
// }
// ----------------------------------------------------

// --- Cron auth: shared secret header (so you can call from Render/Netlify cron)
function requireCronSecret(req, res, next) {
  const expected = String(process.env.CRON_SECRET || "").trim();
  if (!expected) {
    return res.status(500).json({
      success: false,
      message: "CRON_SECRET is not configured on the server.",
    });
  }
  const got = String(req.headers["x-cron-secret"] || "").trim();
  if (got !== expected) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }
  next();
}

// --- Lightweight cursor store (no model file needed)
const CURSOR_COLLECTION = "invite_cursors";
const CURSOR_KEY = "musician_bulk_invite_v1";

async function getInviteCursor() {
  const col = mongoose.connection.collection(CURSOR_COLLECTION);
  const doc = await col.findOne({ _id: CURSOR_KEY });
  return doc || null;
}

async function setInviteCursor(patch) {
  const col = mongoose.connection.collection(CURSOR_COLLECTION);
  const now = new Date();
  await col.updateOne(
    { _id: CURSOR_KEY },
    { $set: { ...patch, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
}

async function runBulkInvite(opts = {}) {
  const {
    limit = 120,
    dryRun = false,
    includeCompleted = false,
    onlyVocalists = false,
    forceResend = false,
    emails = [],
    onlyNew = true,
    afterId = null,
    // internal label for logging
    runLabel = "manual",
    notifyEmail = "",
    sendPreviewToNotify = false,
  } = opts;
  const MAX_INVITE_COUNT = 6; // cap: stop emailing after 6 sends

  const now = new Date();
  const TARGET_SEND = Math.min(Math.max(parseInt(limit, 10) || 120, 1), 500);
  // Fetch more than we intend to send so we can skip past users who don't qualify.
  // (e.g. already has password, invited recently, etc.)
  const FETCH_MULTIPLIER = 25;
  const FETCH_LIMIT = Math.min(Math.max(TARGET_SEND * FETCH_MULTIPLIER, TARGET_SEND), 500);

  const vocalistTypes = [
    "Lead Vocalist",
    "Backing Vocalist",
    "Backing Vocalist-Instrumentalist",
    "Lead Vocalist-Instrumentalist",
  ];

  // Base query
  const q = {
    role: "musician",
    status: { $in: ["approved", "Approved, changes pending"] },
    email: { $type: "string", $ne: "" },
  };
  // ✅ Cap: stop emailing after MAX_INVITE_COUNT sends
  q.$and = q.$and || [];
  q.$and.push({
    $or: [
      { inviteCount: { $exists: false } },
      { inviteCount: null },
      { inviteCount: { $lt: MAX_INVITE_COUNT } },
    ],
  });

  // ✅ Batch cursor: only process users after this _id
  if (afterId && mongoose.Types.ObjectId.isValid(afterId)) {
    q._id = { $gt: new mongoose.Types.ObjectId(afterId) };
  }

  // If onlyNew: only email people who still need to set a password
  if (onlyNew) {
    q.$and = q.$and || [];
    // Match the same condition used by `needsSetPassword` later:
    // hasSetPassword !== true AND password is missing/empty
    q.$and.push({ hasSetPassword: { $ne: true } });
    q.$and.push({
      $or: [
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
      {
        lastInviteSentAt: {
          $lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    ];
  }

  console.log(
    `📨 [bulk-invite][${runLabel}] query`,
    JSON.stringify(
      {
        targetSend: TARGET_SEND,
        fetchLimit: FETCH_LIMIT,
        dryRun: !!dryRun,
        onlyNew: !!onlyNew,
        includeCompleted: !!includeCompleted,
        onlyVocalists: !!onlyVocalists,
        forceResend: !!forceResend,
        afterId: afterId && mongoose.Types.ObjectId.isValid(afterId) ? String(afterId) : null,
      },
      null,
      2
    )
  );

  const report = {
    success: true,
    dryRun: !!dryRun,
    matched: 0,
    afterId:
      afterId && mongoose.Types.ObjectId.isValid(afterId)
        ? String(afterId)
        : null,
    nextAfterId: null,
    emailed: 0,
    invitedSetPassword: 0,
    nudgedLogin: 0,
    skippedNoEmail: 0,
    skippedCompleted: 0,
    skippedInviteCap: 0,
    onlyNew: !!onlyNew,
    forceResend: !!forceResend,
    onlyVocalists: !!onlyVocalists,
    skippedInvitedRecently: 0,
    skippedAlreadyHasPassword: 0,
    items: [],
  };

  let lastProcessedId = null;
  let previewSent = false;

  // We'll advance through the collection until we actually *send* TARGET_SEND emails.
  // `afterIdCursor` moves forward based on the last processed _id.
  let afterIdCursor =
    afterId && mongoose.Types.ObjectId.isValid(afterId)
      ? String(afterId)
      : null;

  // Helper to apply the cursor to the query for each page.
  const applyCursor = (queryObj, cursorId) => {
    if (cursorId && mongoose.Types.ObjectId.isValid(cursorId)) {
      queryObj._id = { $gt: new mongoose.Types.ObjectId(cursorId) };
    } else {
      delete queryObj._id;
    }
  };

  while (report.emailed < TARGET_SEND) {
    // Clone base query each iteration so we don't keep accumulating _id conditions.
    const pageQuery = { ...q };
    applyCursor(pageQuery, afterIdCursor);

    const users = await musicianModel
      .find(pageQuery)
      .select(
        "_id email firstName lastName hasSetPassword password onboardingInvitedAt onboardingStatus lastLoginAt inviteTokenExpires lastInviteSentAt inviteCount"
      )
      .sort({ _id: 1 })
      .limit(FETCH_LIMIT)
      .lean();

    if (!users.length) break; // no more candidates
    report.matched += users.length;

    for (const u of users) {
      lastProcessedId = String(u?._id || "") || lastProcessedId;
      afterIdCursor = lastProcessedId;

      // Stop if we've sent enough.
      if (report.emailed >= TARGET_SEND) break;

      const email = String(u.email || "").trim().toLowerCase();
      if (!email) {
        report.skippedNoEmail += 1;
        continue;
      }

      if (!includeCompleted && u.onboardingStatus === "completed") {
        report.skippedCompleted += 1;
        continue;
      }

      // ✅ Cap: stop emailing after MAX_INVITE_COUNT sends
      if (Number(u.inviteCount || 0) >= MAX_INVITE_COUNT) {
        report.skippedInviteCap += 1;
        report.items.push({
          email,
          needsSetPassword: false,
          skipped: "invite_cap_reached",
          onboardingStatus: u.onboardingStatus || null,
          lastLoginAt: u.lastLoginAt || null,
          lastInviteSentAt: u.lastInviteSentAt || null,
          inviteCount: Number(u.inviteCount || 0),
        });
        continue;
      }

      // Skip if onlyNew and they already have a password / have set password
      if (
        onlyNew &&
        (u.hasSetPassword === true || (u.password && String(u.password).trim()))
      ) {
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
        new Date(u.lastInviteSentAt).getTime() >
          Date.now() - 24 * 60 * 60 * 1000
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

      const needsSetPassword = u.hasSetPassword !== true && !u.password;

      let subject = "";
      let html = "";
      const prevLastInviteSentAt = u.lastInviteSentAt || null;

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
                  <li><strong>Get presented to deputy roles automatically</strong> when acts register with us — your instruments, vocal abilities, skills and location put you in front of bandleaders who need you.</li>
                  <li><strong>Use it as an online CV</strong> you can share for other work — videos, photos, bio, repertoire and equipment all in one place.</li>
                  <li><strong>One‑click apply</strong> for deputy opportunities (launching very soon) — no more long forms.</li>
                  <li><strong>Submit or recommend an act</strong> to join The Supreme Collective — a musician profile is required to do this.</li>
                </ul>
              </div>

              <p style="margin:0 0 10px 0;color:#333;font-size:14.5px;line-height:1.7;">
                Once you’ve set a password, log in and add whatever you can — a short bio, a few videos/photos, and as much repertoire/gear detail as you’re happy to share.
              </p>

              <p style="margin:0 0 10px 0;color:#333;font-size:14.5px;line-height:1.7;">
                Looking forward to having you on board! If you have any questions or need a hand getting set up, just reply to this email.
              </p>

              <p style="margin:0 0 10px 0;color:#333;font-size:14.5px;line-height:1.7;">
                Best wishes, <br/>
                The Supreme Collective team<br/>
                <a href="https://thesupremecollective.co.uk" style="color:#ff6667;text-decoration:underline;">thesupremecollective.co.uk</a>
              </p>

              <p style="margin:0;color:#666;font-size:12.5px;line-height:1.6;">
                Button not working? Copy and paste this link into your browser:<br/>
                <a href="${link}" style="color:#ff6667;text-decoration:underline;word-break:break-all;">${link}</a>
              </p>
            </div>
          </div>
        `;

        if (notifyEmail && sendPreviewToNotify === true && previewSent === false) {
          await sendBulkInvitePreviewEmail({
            to: notifyEmail,
            runLabel,
            isDryRun: !!dryRun,
            targetEmail: email,
            subject,
            html,
          });
          previewSent = true;
        }

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
          lastInviteSentAt: prevLastInviteSentAt,
          subject,
          action: "invited_set_password",
        });
      } else {
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
                  <li><strong>Get presented to deputy roles automatically</strong> when acts register with us — your instruments, vocal abilities, skills and location put you in front of bandleaders who need you.</li>
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

        if (notifyEmail && sendPreviewToNotify === true && previewSent === false) {
          await sendBulkInvitePreviewEmail({
            to: notifyEmail,
            runLabel,
            isDryRun: !!dryRun,
            targetEmail: email,
            subject,
            html,
          });
          previewSent = true;
        }

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
          lastInviteSentAt: prevLastInviteSentAt,
          subject,
          action: "nudged_login",
        });
      }
    }

    // If we fetched less than the page size, there are no more to scan.
    if (users.length < FETCH_LIMIT) break;
  }

  report.nextAfterId = lastProcessedId || null;
  report.preview = {
    requested: !!(notifyEmail && sendPreviewToNotify),
    sent: previewSent,
  };
  console.log(
    `✅ [bulk-invite][${runLabel}] done`,
    JSON.stringify(
      {
        targetSend: TARGET_SEND,
        matched: report.matched,
        emailed: report.emailed,
        nextAfterId: report.nextAfterId,
        invitedSetPassword: report.invitedSetPassword,
        nudgedLogin: report.nudgedLogin,
        skippedAlreadyHasPassword: report.skippedAlreadyHasPassword,
        skippedInvitedRecently: report.skippedInvitedRecently,
      },
      null,
      2
    )
  );

  return report;
}

// Manual/admin-triggered bulk invite
musicianLoginRouter.post("/bulk-invite", requireAdminAuth, async (req, res) => {
  try {
    const report = await runBulkInvite({
      ...req.body,
      runLabel: "manual",
      notifyEmail: String(req.body?.notifyEmail || "").trim(),
      sendPreviewToNotify: req.body?.sendPreviewToNotify === true,
    });
    // Send summary email if requested (even for dry runs)
    const notifyEmail = String(req.body?.notifyEmail || "").trim();
    let notify = null;
    if (notifyEmail) {
      notify = await sendBulkInviteRunSummaryEmail({
        to: notifyEmail,
        runLabel: "manual",
        isDryRun: !!req.body?.dryRun,
        cursorBefore: null,
        report,
        extraNote: req.body?.dryRun
          ? "Manual dry run: no invites were sent."
          : "Manual run: invites may have been sent.",
      });
    }
    return res.json({ ...report, notifyEmail: notifyEmail || null, notify });
  } catch (err) {
    console.error("[bulk-invite] error:", err);
    return res.status(500).json({ success: false, message: "Bulk invite failed." });
  }
});

// Cron-triggered bulk invite with persisted cursor
// POST /api/musician-login/bulk-invite-cron
// Headers: x-cron-secret: <CRON_SECRET>
musicianLoginRouter.post("/bulk-invite-cron", requireCronSecret, async (req, res) => {
  try {
    const cursor = await getInviteCursor();
    const runs = Number(cursor?.runs || 0);
    const afterId = cursor?.afterId && mongoose.Types.ObjectId.isValid(cursor.afterId)
      ? String(cursor.afterId)
      : null;

    const notifyEmail = String(
      req.body?.notifyEmail || process.env.INVITE_CRON_NOTIFY_EMAIL || ""
    ).trim();

    // Allow dryRun for testing: cron secret still required.
    // IMPORTANT: dryRun does NOT advance the cursor.
    const isDryRun = req.body?.dryRun === true;

    // Phase plan: first N runs send small batches, then ramp up.
    const phase1Runs = Number(process.env.INVITE_CRON_PHASE1_RUNS || 5);
    const phase1Limit = Number(process.env.INVITE_CRON_PHASE1_LIMIT || 5);
    const phase2Limit = Number(process.env.INVITE_CRON_PHASE2_LIMIT || 500);

    const limit = runs < phase1Runs ? phase1Limit : phase2Limit;

    console.log(
      `🕒 [bulk-invite][cron] run #${runs + 1} afterId=${afterId || "(none)"} limit=${limit} dryRun=${isDryRun}`
    );

    const report = await runBulkInvite({
      limit,
      dryRun: isDryRun,
      includeCompleted: false,
      onlyVocalists: false,
      forceResend: false,
      emails: [],
      onlyNew: true,
      afterId,
      runLabel: `cron_${runs + 1}`,
      notifyEmail,
      sendPreviewToNotify: req.body?.sendPreviewToNotify === true,
    });

    if (!isDryRun) {
      await setInviteCursor({
        runs: runs + 1,
        afterId: report.nextAfterId || afterId || null,
        lastReport: {
          matched: report.matched,
          emailed: report.emailed,
          invitedSetPassword: report.invitedSetPassword,
          nudgedLogin: report.nudgedLogin,
          nextAfterId: report.nextAfterId,
          finished: report.matched === 0,
        },
        lastRunAt: new Date(),
      });
    }

    // ✅ Always send a summary email to you when requested (even during dryRun)
    let notify = null;
    if (notifyEmail) {
      notify = await sendBulkInviteRunSummaryEmail({
        to: notifyEmail,
        runLabel: `cron_${runs + 1}`,
        isDryRun,
        cursorBefore: cursor || null,
        report,
        extraNote: isDryRun
          ? "Dry run: no invites were sent and the cursor was NOT advanced."
          : "Live run: invites were sent and the cursor was advanced.",
      });
    }

    return res.json({ success: true, cursorBefore: cursor || null, report, notifyEmail: notifyEmail || null, notify });
  } catch (err) {
    console.error("[bulk-invite-cron] error:", err);
    return res.status(500).json({ success: false, message: "Cron bulk invite failed." });
  }
});

export default musicianLoginRouter;
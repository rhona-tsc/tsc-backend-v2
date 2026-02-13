import crypto from "crypto";
import jwt from "jsonwebtoken";
import musicianModel from "../models/musicianModel.js";
import OtpToken from "../models/OtpToken.js";
import { sendOtpEmail } from "../utils/mailer.js";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 mins
const RESEND_THROTTLE_MS = 30 * 1000; // 30s
const MAX_ATTEMPTS = 6;

const normalizeEmail = (s = "") => String(s || "").trim().toLowerCase();

const hashCode = (email, code) => {
  const secret = process.env.OTP_SECRET || process.env.JWT_SECRET; // fallback if you haven't set OTP_SECRET yet
  return crypto
    .createHash("sha256")
    .update(`${email}:${code}:${secret}`)
    .digest("hex");
};

export const requestOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const kind = String(req.body?.kind || "").trim();

    if (!email) return res.status(400).json({ success: false, message: "missing_email" });

    // throttle resend
    const existing = await OtpToken.findOne({ email });
    if (existing?.lastSentAt) {
      const msSince = Date.now() - new Date(existing.lastSentAt).getTime();
      if (msSince < RESEND_THROTTLE_MS) {
        return res.json({
          success: true,
          throttled: true,
          retryAfterMs: RESEND_THROTTLE_MS - msSince,
        });
      }
    }

    const code = String(crypto.randomInt(100000, 999999));
    const codeHash = hashCode(email, code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Send first (so we don't store lastSentAt if email fails)
    await sendOtpEmail({ to: email, code });

    await OtpToken.findOneAndUpdate(
      { email },
      { email, codeHash, expiresAt, attempts: 0, lastSentAt: new Date() },
      { upsert: true, new: true }
    );

    console.log("✅ [requestOtp] sent", { email, kind, expiresAt: expiresAt.toISOString() });

    return res.json({ success: true });
  } catch (e) {
    console.error("❌ [requestOtp] failed:", e?.message || e);
    return res.status(500).json({ success: false, message: "request_failed" });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || req.body?.otp || "").trim(); // ✅ accepts code or otp
    const phone = String(req.body?.phone || "").trim();
    const kind = String(req.body?.kind || "").trim();

    if (!email) return res.status(400).json({ success: false, message: "missing_email" });
    if (!code) return res.status(400).json({ success: false, message: "missing_code" });

    const row = await OtpToken.findOne({ email });
    if (!row) return res.status(401).json({ success: false, message: "invalid_code" });

    // expiry
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
      await OtpToken.deleteOne({ email });
      return res.status(401).json({ success: false, message: "expired_code" });
    }

    // attempts
    if ((row.attempts || 0) >= MAX_ATTEMPTS) {
      await OtpToken.deleteOne({ email });
      return res.status(429).json({ success: false, message: "too_many_attempts" });
    }

    const incomingHash = hashCode(email, code);
    if (incomingHash !== row.codeHash) {
      await OtpToken.updateOne({ email }, { $inc: { attempts: 1 } });
      return res.status(401).json({ success: false, message: "invalid_code" });
    }

    // Success — delete OTP row
    await OtpToken.deleteOne({ email });

    // Find or create user
    let user = await musicianModel.findOne({ email }).select("_id email role firstName lastName phone").lean();

    if (!user) {
      const created = await musicianModel.create({
        email,
        phone: phone || "",
        role: "customer", // adjust to your roles
        firstName: "",
        lastName: "",
      });

      user = { _id: created._id, email: created.email, role: created.role };
    } else {
      // optional: store phone if provided
      if (phone && (!user.phone || String(user.phone).trim() === "")) {
        await musicianModel.updateOne({ _id: user._id }, { $set: { phone } });
      }
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role || "customer" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    console.log("✅ [verifyOtp] success", { email, userId: String(user._id), kind });

    return res.json({
      success: true,
      token,
      userId: user._id,
      email: user.email,
      role: user.role || "customer",
    });
  } catch (e) {
    console.error("❌ [verifyOtp] failed:", e?.message || e);
    return res.status(500).json({ success: false, message: "verify_failed" });
  }
};
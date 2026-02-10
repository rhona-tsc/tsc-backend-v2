// routes/auth.js
import crypto from "crypto";
import OtpToken from "../models/OtpToken.js";
import User from "../models/userModel.js"; // your existing user model
import { sendOtpEmail } from "../utils/mailer.js"; // implement

const hashCode = (email, code) =>
  crypto.createHash("sha256").update(`${email}:${code}:${process.env.OTP_SECRET}`).digest("hex");

export const requestOtp = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: "missing_email" });

    // basic resend throttle (optional)
    const existing = await OtpToken.findOne({ email });
    if (existing && existing.lastSentAt && Date.now() - new Date(existing.lastSentAt).getTime() < 30_000) {
      return res.json({ success: true, throttled: true }); // don’t reveal anything
    }

    const code = String(crypto.randomInt(100000, 999999));
    const codeHash = hashCode(email, code);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    await OtpToken.findOneAndUpdate(
      { email },
      { email, codeHash, expiresAt, attempts: 0, lastSentAt: new Date() },
      { upsert: true, new: true }
    );

    await sendOtpEmail({ to: email, code });

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: "request_failed" });
  }
};
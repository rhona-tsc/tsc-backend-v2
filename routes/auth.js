import crypto from "crypto";
import OtpToken from "../models/OtpToken.js";
import { sendOtpEmail } from "../utils/mailer.js";

const hashCode = (email, code) =>
  crypto
    .createHash("sha256")
    .update(`${email}:${code}:${process.env.OTP_SECRET}`)
    .digest("hex");

export const requestOtp = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: "missing_email" });

    if (!process.env.OTP_SECRET) {
      console.error("❌ OTP_SECRET missing");
      return res.status(500).json({ success: false, message: "server_misconfigured" });
    }

    const existing = await OtpToken.findOne({ email });
    if (existing?.lastSentAt) {
      const msSince = Date.now() - new Date(existing.lastSentAt).getTime();
      if (msSince < 30_000) {
        return res.json({
          success: true,
          throttled: true,
          retryAfterMs: 30_000 - msSince,
        });
      }
    }

    const code = String(crypto.randomInt(100000, 999999));
    const codeHash = hashCode(email, code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // 1) send email first
    await sendOtpEmail({ to: email, code });

    // 2) only after successful send, store OTP
    await OtpToken.findOneAndUpdate(
      { email },
      { email, codeHash, expiresAt, attempts: 0, lastSentAt: new Date() },
      { upsert: true, new: true }
    );

    return res.json({ success: true });
  } catch (e) {
    console.error("❌ requestOtp failed:", e?.message || e);
    return res.status(500).json({ success: false, message: "request_failed" });
  }
};
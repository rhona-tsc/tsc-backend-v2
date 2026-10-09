import crypto from "crypto";
import musicianModel from "../models/musicianModel.js";
import { sendWhatsAppText } from "../utils/twilioClient.js";

const adminFrontendUrl = String(
  process.env.ADMIN_FRONTEND_URL || "https://admin.thesupremecollective.co.uk",
).replace(/\/$/, "");

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const profileIsComplete = (musician = {}) =>
  musician.hasSetPassword === true &&
  String(musician.bio || "").trim().length > 0 &&
  Array.isArray(musician.repertoire) &&
  musician.repertoire.length >= 30;

/**
 * Send a separate onboarding prompt after a gig has already been accepted.
 * Errors are deliberately contained so profile onboarding can never hold up
 * the booking confirmation.
 */
export async function promptForProfileAfterAcceptance({ musicianId, phone }) {
  try {
    if (!musicianId || !phone) return { sent: false, reason: "missing_identity" };

    const musician = await musicianModel.findById(musicianId);
    if (!musician) return { sent: false, reason: "musician_not_found" };
    if (profileIsComplete(musician)) {
      return { sent: false, reason: "profile_complete" };
    }

    const firstName = String(musician.firstName || "").trim() || "there";
    let actionUrl = `${adminFrontendUrl}/login`;
    let actionText = "log in and complete your musician profile";

    if (musician.hasSetPassword !== true) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const now = new Date();
      musician.inviteTokenHash = hashToken(rawToken);
      musician.inviteTokenExpires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      musician.mustChangePassword = true;
      musician.onboardingInvitedAt = musician.onboardingInvitedAt || now;
      musician.onboardingStatus = "invited";
      musician.lastInviteSentAt = now;
      musician.inviteCount = Number(musician.inviteCount || 0) + 1;
      await musician.save();

      actionUrl = `${adminFrontendUrl}/set-password?token=${rawToken}&email=${encodeURIComponent(
        String(musician.email || "").trim().toLowerCase(),
      )}`;
      actionText = "create your login and complete your musician profile";
    }

    await sendWhatsAppText(
      phone,
      `Hi ${firstName}, your gig is confirmed. Please ${actionText} so we have the details needed for this booking and future work: ${actionUrl}`,
    );

    return { sent: true };
  } catch (error) {
    console.error(
      "Failed to send post-acceptance profile prompt:",
      error?.message || error,
    );
    return { sent: false, reason: "send_failed" };
  }
}

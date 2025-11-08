import Act from "../models/actModel.js";
import { sendEmail } from "../utils/sendEmail.js"; // adjust import if needed

export async function sendClientEmail({ actId, subject, html, to, clientEmail, bcc }) {
  try {
    const act = await Act.findById(actId).lean();

    // ✅ Resolve recipient hierarchy
    const recipient =
      to ||
      clientEmail ||
      act?.contactEmail ||
      process.env.NOTIFY_EMAIL ||
      "hello@thesupremecollective.co.uk";

    // ✅ Defensive validation
    if (!recipient || typeof recipient !== "string" || !recipient.includes("@")) {
      console.warn("⚠️ No valid recipient email found — skipping sendEmail.");
      return { success: false, reason: "invalid_recipient" };
    }

    console.log("📧 [sendClientEmail Debug]", {
      actId,
      providedTo: to,
      resolvedRecipient: recipient,
      actContactEmail: act?.contactEmail,
    });

    // ✅ Correct call signature
    const result = await sendEmail(
      recipient,
      subject,
      html,
      bcc || "hello@thesupremecollective.co.uk"
    );

    if (result.success) {
      console.log(`✅ Client email sent to ${recipient}`);
      return { success: true, to: recipient };
    } else {
      console.warn("⚠️ sendEmail returned failure:", result.error);
      return { success: false, error: result.error };
    }
  } catch (err) {
    console.error("❌ sendClientEmail failed:", err.message);
    return { success: false, error: err.message };
  }
}
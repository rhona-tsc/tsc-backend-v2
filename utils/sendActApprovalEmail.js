import sendEmail from "./sendEmail.js";

// Prefer env, fall back to your admin host. MUST include protocol.
const ADMIN_ORIGIN = (process.env.ADMIN_ORIGIN || "https://admin.thesupremecollective.co.uk")
  .trim()
  .replace(/\/+$/, "");
const WEBSITE_URL = "https://thesupremecollective.co.uk";
const INSTAGRAM_URL = "https://instagram.com/thesupremecollective";
const YOUTUBE_URL = "https://www.youtube.com/channel/UC6HhRZA4XLVajrz5vk5vn2A";
const WHATSAPP_URL = "https://api.whatsapp.com/send/?phone=447594223200&text&type=phone_number&app_absent=0";
const SIGNATURE_GIF_URL = "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777045559/TSC_Signature_2026_svgxr5.gif";
const INSTAGRAM_ICON_URL = "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777056960/instagram-icon_rtespa.png";
const YOUTUBE_ICON_URL = "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777056960/1_lo9yf6.png";
const WEBSITE_ICON_URL = "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777207820/website-icon_nuahjk.png";

const escapeHtml = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const safeHref = (href) => {
  // Ensure we always return an absolute https URL.
  const h = String(href || "").trim();
  if (!h) return "";
  if (/^https?:\/\//i.test(h)) return h;
  return `https://${h.replace(/^\/\/+/, "")}`;
};

const deliverActEmail = async ({ to, subject, text, html }) => {
  const result = await sendEmail({
    to,
    subject,
    text,
    html,
    // Use the same SMTP_* configuration and sender defaults as Originals.
    // ACT_SUBMISSIONS_FROM remains available if a verified submissions alias
    // is added later, without requiring a second set of mail credentials.
    from: String(process.env.ACT_SUBMISSIONS_FROM || "").trim() || undefined,
    replyTo: String(
      process.env.ACT_SUBMISSIONS_REPLY_TO ||
      process.env.SMTP_REPLY_TO ||
      "hello@thesupremecollective.co.uk"
    ).trim(),
  });

  if (!result?.ok) {
    throw new Error(result?.error || result?.reason || "Email delivery failed");
  }

  return result;
};

export const buildActSubmissionLink = (code) => {
  const safeCode = encodeURIComponent(String(code || "").trim());
  return safeHref(`${ADMIN_ORIGIN}/add-act-2?code=${safeCode}`);
};

const buildApprovalHtml = ({ name, actName, link, corrected = false }) => {
  const safeName = escapeHtml(String(name || "there").trim() || "there");
  const safeActName = escapeHtml(String(actName || "your act").trim() || "your act");
  const safeLink = escapeHtml(link);
  return `
    <div style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111111;">
      <div style="max-width:720px;margin:0 auto;padding:28px 16px;">
        <div style="background:#111111;border-radius:28px 28px 0 0;overflow:hidden;text-align:center;">
          <div style="padding:18px 28px 8px;"><p style="margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#ff6667;font-weight:700;">The Supreme Collective</p></div>
          <div style="padding:0 28px 30px;">
            <h1 style="margin:8px 0 10px;font-size:34px;line-height:1.05;color:#ffffff;font-weight:800;">${corrected ? "Your Act Listing Link" : "You’re Approved 🎉"}</h1>
            <p style="margin:0;font-size:16px;line-height:1.7;color:#f3f3f3;">${corrected ? "Here is a fresh secure link to continue." : "We’d love to welcome your act to TSC."}</p>
          </div>
        </div>

        <div style="background:#ffffff;border:1px solid #e8e8e8;border-top:0;border-radius:0 0 28px 28px;padding:30px 28px;box-shadow:0 10px 30px rgba(0,0,0,0.04);">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.7;color:#333333;">Hi ${safeName},</p>
          ${corrected ? `
            <p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#444444;">Here is a new secure link to complete the full listing for <strong>${safeActName}</strong>.</p>
          ` : `
            <p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#444444;">Thanks so much for submitting <strong>${safeActName}</strong> to The Supreme Collective. We’ve reviewed your pre-submission and are delighted to approve it for the next stage.</p>
            <p style="margin:0 0 22px;font-size:15px;line-height:1.8;color:#444444;">Please use the button below to complete the full act listing, including the line-ups, pricing, repertoire, photos and other information clients will need.</p>
          `}

          <div style="margin:0 0 14px;text-align:center;">
            <a href="${safeLink}" style="display:inline-block;background:#ff6667;color:#ffffff;text-decoration:none;padding:15px 26px;border-radius:999px;font-size:16px;font-weight:700;">Complete my act listing</a>
          </div>
          <p style="margin:0 0 24px;color:#666666;font-size:12.5px;line-height:1.6;text-align:center;">This is your unique secure link. Please do not share it.</p>

          <div style="margin:0 0 24px;padding:18px;background:#fafafa;border:1px solid #ececec;border-radius:18px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#333333;">Button not working?</p>
            <a href="${safeLink}" style="color:#ff6667;text-decoration:underline;word-break:break-all;font-size:12.5px;line-height:1.6;">${safeLink}</a>
          </div>

          <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#444444;">If you need any help while completing the listing, just reply to this email or use the WhatsApp button below.</p>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#444444;">Best wishes,<br /><strong>The Supreme Collective</strong></p>

          <div style="margin:0 0 22px;text-align:center;">
            <a href="${WEBSITE_URL}" style="display:block;text-decoration:none;"><img src="${SIGNATURE_GIF_URL}" width="600" alt="The Supreme Collective" style="display:block;width:100%;max-width:600px;height:auto;border:0;margin:0 auto;border-radius:18px;" /></a>
            <a href="${WHATSAPP_URL}" style="display:inline-block;margin-top:16px;padding:12px 24px;border-radius:999px;background:#25D366;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;">Chat on WhatsApp</a>
          </div>

          <div style="padding:22px;background:#fafafa;border:1px solid #ececec;border-radius:22px;">
            <h3 style="margin:0 0 14px;font-size:16px;color:#111111;">Find us online</h3>
            <p style="margin:0 0 18px;">
              <a href="${INSTAGRAM_URL}" style="display:inline-block;margin-right:12px;text-decoration:none;"><img src="${INSTAGRAM_ICON_URL}" width="32" height="32" alt="Instagram" style="border:0;" /></a>
              <a href="${YOUTUBE_URL}" style="display:inline-block;margin-right:12px;text-decoration:none;"><img src="${YOUTUBE_ICON_URL}" width="32" height="32" alt="YouTube" style="border:0;" /></a>
              <a href="${WEBSITE_URL}" style="display:inline-block;text-decoration:none;"><img src="${WEBSITE_ICON_URL}" width="32" height="32" alt="The Supreme Collective website" style="border:0;" /></a>
            </p>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#555555;">Already have a TSC login? <a href="${ADMIN_ORIGIN}" style="color:#ff6667;text-decoration:none;font-weight:700;">Open the TSC dashboard</a></p>
            <div style="padding-top:16px;border-top:1px solid #e3e3e3;">
              <p style="margin:0 0 8px;font-size:12px;line-height:1.7;color:#777777;">Copyright © 2026 The Supreme Collective Ltd. All rights reserved.</p>
              <p style="margin:0;font-size:12px;line-height:1.7;color:#777777;">Registered Office: 71-75 Shelton Street, Covent Garden, London, WC2H 9JQ, United Kingdom | Company Number: 16883956</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
};

// ===============================
//  APPROVAL EMAIL
// ===============================
export const sendActApprovalEmail = async (email, name, actName, code) => {
  const link = buildActSubmissionLink(code);

  await deliverActEmail({
    to: email,
    subject: "You're Approved 🎉",
    text: `Hi ${name || "there"},\n\nWe’re delighted to approve ${actName || "your act"} for the next stage. Complete the full act listing here:\n${link}\n\nBest wishes,\nThe Supreme Collective`,
    html: buildApprovalHtml({ name, actName, link }),
  });
};

// ===============================
//  APPROVAL RESEND EMAIL (fix broken link)
// ===============================
export const sendActApprovalEmailResend = async (email, name, actName, code) => {
  const link = buildActSubmissionLink(code);

  await deliverActEmail({
    to: email,
    subject: "Quick update — your correct Act Submission link ✅",
    text: `Hi ${name || "there"},\n\nHere is a fresh secure link to complete the full listing for ${actName || "your act"}:\n${link}\n\nBest wishes,\nThe Supreme Collective`,
    html: buildApprovalHtml({ name, actName, link, corrected: true }),
  });
};

// ===============================
//  REJECTION EMAIL
// ===============================
export const sendActRejectionEmail = async (email, name) => {
  const safeName = String(name || "there").trim() || "there";

  const html = `
    <div style="background:#f6f6f6;padding:32px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:640px;">
        <tr>
          <td style="background:#ffffff;border-radius:14px;padding:26px 22px;box-shadow:0 8px 24px rgba(0,0,0,0.06);border:1px solid #eee;">
            <h1 style="margin:0 0 10px 0;font-size:20px;line-height:1.25;color:#111;">Your Act Submission</h1>

            <p style="margin:0 0 14px 0;color:#333;font-size:14.5px;line-height:1.6;">Hi ${safeName},</p>

            <p style="margin:0 0 14px 0;color:#333;font-size:14.5px;line-height:1.6;">
              Thank you for submitting your act to The Supreme Collective.
            </p>

            <p style="margin:0 0 14px 0;color:#333;font-size:14.5px;line-height:1.6;">
              After reviewing your pre‑submission, we’ve decided not to move forward at this time.
            </p>

            <p style="margin:0 0 0 0;color:#333;font-size:14.5px;line-height:1.6;">
              We truly appreciate your interest and wish you the very best with all future performances.
            </p>

            <p style="margin:14px 0 0 0;color:#333;font-size:13.5px;line-height:1.6;">Kind regards,<br/>The Supreme Collective</p>
          </td>
        </tr>
      </table>
    </div>
  `;

  await deliverActEmail({
    to: email,
    subject: "Your Act Submission",
    html,
  });
};

import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Prefer env, fall back to your admin host. MUST include protocol.
const ADMIN_ORIGIN = (process.env.ADMIN_ORIGIN || "https://admin.thesupremecollective.co.uk")
  .trim()
  .replace(/\/+$/, "");

const safeHref = (href) => {
  // Ensure we always return an absolute https URL.
  const h = String(href || "").trim();
  if (!h) return "";
  if (/^https?:\/\//i.test(h)) return h;
  return `https://${h.replace(/^\/\/+/, "")}`;
};

export const buildActSubmissionLink = (code) => {
  const safeCode = encodeURIComponent(String(code || "").trim());
  return safeHref(`${ADMIN_ORIGIN}/add-act-2?code=${safeCode}`);
};

// ===============================
//  APPROVAL EMAIL
// ===============================
export const sendActApprovalEmail = async (email, name, code) => {
  const safeName = String(name || "there").trim() || "there";
  const link = buildActSubmissionLink(code);

  const html = `
    <div style="background:#f6f6f6;padding:32px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:640px;">
        <tr>
          <td style="background:#ffffff;border-radius:14px;padding:26px 22px;box-shadow:0 8px 24px rgba(0,0,0,0.06);border:1px solid #eee;">
            <h1 style="margin:0 0 10px 0;font-size:20px;line-height:1.25;color:#111;">You’re Approved 🎉</h1>

            <p style="margin:0 0 14px 0;color:#333;font-size:14.5px;line-height:1.6;">Hi ${safeName},</p>

            <p style="margin:0 0 14px 0;color:#333;font-size:14.5px;line-height:1.6;">
              Thanks so much for submitting your act to The Supreme Collective — we really appreciate your time.
            </p>

            <p style="margin:0 0 14px 0;color:#333;font-size:14.5px;line-height:1.6;">
              We’re delighted to let you know that <strong>we’d love to have you join</strong> us on TSC, having reviewed your pre‑submission.
            </p>

            <p style="margin:0 0 16px 0;color:#333;font-size:14.5px;line-height:1.6;">
              Click the button below to open your act submission form:
            </p>

            <div style="text-align:center;margin:18px 0 18px 0;">
              <a href="${link}" target="_blank" rel="noopener noreferrer"
                 style="display:inline-block;background:#ff6667;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:800;font-size:15px;">
                Open Act Submission Form
              </a>
            </div>

            <p style="margin:0 0 0 0;color:#666;font-size:12.5px;line-height:1.6;">
              Button not working? Copy and paste this link into your browser:<br/>
              <a href="${link}" target="_blank" rel="noopener noreferrer" style="color:#ff6667;text-decoration:underline;word-break:break-all;">${link}</a>
            </p>

            <p style="margin:16px 0 0 0;color:#333;font-size:13.5px;line-height:1.6;">If you need anything, just reply to this email.</p>

            <p style="margin:14px 0 0 0;color:#333;font-size:13.5px;line-height:1.6;">Best wishes,<br/>The Supreme Collective</p>
          </td>
        </tr>
      </table>
    </div>
  `;

  await transporter.sendMail({
    from: '"Submissions" <submissions@thesupremecollective.co.uk>',
    to: email,
    subject: "You're Approved 🎉",
    html,
  });
};

// ===============================
//  APPROVAL RESEND EMAIL (fix broken link)
// ===============================
export const sendActApprovalEmailResend = async (email, name, code) => {
  const safeName = String(name || "there").trim() || "there";
  const link = buildActSubmissionLink(code);

  const html = `
    <div style="background:#f6f6f6;padding:32px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:640px;">
        <tr>
          <td style="background:#ffffff;border-radius:14px;padding:26px 22px;box-shadow:0 8px 24px rgba(0,0,0,0.06);border:1px solid #eee;">
            <h1 style="margin:0 0 10px 0;font-size:20px;line-height:1.25;color:#111;">Quick update — correct link ✅</h1>

            <p style="margin:0 0 14px 0;color:#333;font-size:14.5px;line-height:1.6;">Hi ${safeName},</p>

            <p style="margin:0 0 14px 0;color:#333;font-size:14.5px;line-height:1.6;">
              Oops — the link in our previous email didn’t work properly for everyone.
            </p>

            <p style="margin:0 0 16px 0;color:#333;font-size:14.5px;line-height:1.6;">
              Please use the button below to open your act submission form:
            </p>

            <div style="text-align:center;margin:18px 0 18px 0;">
              <a href="${link}" target="_blank" rel="noopener noreferrer"
                 style="display:inline-block;background:#ff6667;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:800;font-size:15px;">
                Open Act Submission Form
              </a>
            </div>

            <p style="margin:0 0 0 0;color:#666;font-size:12.5px;line-height:1.6;">
              Button not working? Copy and paste this link into your browser:<br/>
              <a href="${link}" target="_blank" rel="noopener noreferrer" style="color:#ff6667;text-decoration:underline;word-break:break-all;">${link}</a>
            </p>

            <p style="margin:16px 0 0 0;color:#333;font-size:13.5px;line-height:1.6;">If you need anything, just reply to this email.</p>

            <p style="margin:14px 0 0 0;color:#333;font-size:13.5px;line-height:1.6;">Best wishes,<br/>The Supreme Collective</p>
          </td>
        </tr>
      </table>
    </div>
  `;

  await transporter.sendMail({
    from: '"Submissions" <submissions@thesupremecollective.co.uk>',
    to: email,
    subject: "Quick update — your correct Act Submission link ✅",
    html,
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

  await transporter.sendMail({
    from: '"Submissions" <submissions@thesupremecollective.co.uk>',
    to: email,
    subject: "Your Act Submission",
    html,
  });
};
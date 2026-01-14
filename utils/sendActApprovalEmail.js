import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ===============================
//  APPROVAL EMAIL
// ===============================
export const sendActApprovalEmail = async (email, name, code) => {
  const html = `
    <p>Hi ${name},</p>

    <p>Thanks so much for submitting your act to The Supreme Collective — 
    we really appreciate your time.</p>

    <p>We’re delighted to let you know that <strong>we'd love to have you join</strong> us on TSC, having reviewed your pre-submission. 🎉</p>

    <p>We can’t wait to get your act listed. To get started, use your invitation code to submit your act in full:</p>

    <h2 style="background:#000;color:#fff;padding:10px;display:inline-block;border-radius:6px;">
      ${code}
    </h2>

    <p>You can click the link below — the code will be auto-filled:</p>

    <a href="${process.env.FRONTEND_URL}/add-act-2?code=${code}" 
       style="color:#ff6667;font-weight:bold;">
      Open Act Submission Form
    </a>

    <p>If you need anything, just reply to this email.</p>

    <p>Best wishes,<br/>The Supreme Collective</p>
  `;

  await transporter.sendMail({
    from: `"Subissions" <submissions@thesupremecollective.co.uk>`,
    to: email,
    subject: "You're Approved 🎉",
    html
  });
};

// ===============================
//  REJECTION EMAIL
// ===============================
export const sendActRejectionEmail = async (email, name) => {
  const html = `
    <p>Hi ${name},</p>

    <p>Thank you for submitting your act to The Supreme Collective.</p>

    <p>After reviewing your pre-submission, we’ve decided not to move forward at this time.</p>

    <p>We truly appreciate your interest and wish you the very best with all future performances.</p>

    <p>Kind regards,<br/>The Supreme Collective</p>
  `;

  await transporter.sendMail({
    from: `"Subissions" <submissions@thesupremecollective.co.uk>`,
    to: email,
    subject: "Your Act Submission",
    html
  });
};
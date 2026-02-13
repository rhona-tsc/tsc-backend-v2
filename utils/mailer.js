import { sendEmail } from "./sendEmail.js";

export async function sendResetEmail({ to, resetUrl }) {
  const html = `
    <p>Hi there,</p>
    <p>We received a request to reset your password. Click the link below to set a new one:</p>
    <p><a href="${resetUrl}" target="_blank" rel="noreferrer">${resetUrl}</a></p>
    <p>If you didn’t request this, you can ignore this email.</p>
    <p>— The Supreme Collective</p>
  `;

  return sendEmail({
    to,
    subject: "Reset your password",
    html,
  });
}

export async function sendOtpEmail({ to, code }) {
  const html = `
    <p>Hi there,</p>
    <p>Your verification code is:</p>
    <p style="font-size: 22px; font-weight: 700; letter-spacing: 2px;">${code}</p>
    <p>This code expires in 10 minutes.</p>
    <p>If you didn’t request this, you can ignore this email.</p>
    <p>— The Supreme Collective</p>
  `;

  return sendEmail({
    to,
    subject: "Your verification code",
    html,
  });
}
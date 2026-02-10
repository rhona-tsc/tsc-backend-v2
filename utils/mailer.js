// utils/mailer.js
import nodemailer from "nodemailer";

export function makeTransport() {
  // Use any SMTP. Example with Mailtrap / generic SMTP:
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false, // true for 465, false for 587/STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendResetEmail({ to, resetUrl }) {
  const transporter = makeTransport();
  const from = process.env.EMAIL_FROM || "TSC <no-reply@thesupremecollective.co.uk>";

  const html = `
    <p>Hi there,</p>
    <p>We received a request to reset your password. Click the link below to set a new one:</p>
    <p><a href="${resetUrl}" target="_blank">${resetUrl}</a></p>
    <p>If you didn’t request this, you can ignore this email.</p>
    <p>— The Supreme Collective</p>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: "Reset your password",
    html,
  });
}

export async function sendOtpEmail({ to, code }) {
  const transporter = makeTransport();
  const from = process.env.EMAIL_FROM || "TSC <no-reply@thesupremecollective.co.uk>";

  const html = `
    <p>Hi there,</p>
    <p>Your verification code is:</p>
    <p style="font-size: 22px; font-weight: 700; letter-spacing: 2px;">${code}</p>
    <p>This code expires in 10 minutes.</p>
    <p>If you didn’t request this, you can ignore this email.</p>
    <p>— The Supreme Collective</p>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: "Your verification code",
    html,
  });
}
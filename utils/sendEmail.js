import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

/**
 * Send an email using the configured transporter
 * @param {string|string[]} to - Recipient email(s)
 * @param {string} subject - Email subject
 * @param {string} html - HTML content of the email
 * @param {Array} attachments - Optional array of attachments
 */
const sendEmail = async (to, subject, html, attachments = []) => {
  try {
    const mailOptions = {
      from: '"The Supreme Collective" <hello@thesupremecollective.co.uk>',
      to,
      subject,
      html,
      attachments,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}`);
    return { success: true };
  } catch (err) {
    console.error("❌ Email send failed:", err);
    return { success: false, error: err };
  }
};

export default sendEmail;
export { sendEmail };
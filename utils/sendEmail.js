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
const sendEmail = async (to, subject, html, bcc, attachments = []) => {
  try {
    const recipients = Array.isArray(to) ? to.filter(e => e && e.includes("@")) : (to && to.includes("@") ? [to] : []);
    const bccList = Array.isArray(bcc) ? bcc.filter(e => e && e.includes("@")) : (bcc && bcc.includes("@") ? [bcc] : []);
    if (recipients.length === 0 && bccList.length === 0) {
      console.warn("⚠️ No valid email recipients found. Skipping sendEmail.");
      return { success: false, error: "No valid recipients" };
    }

    const mailOptions = {
      from: '"The Supreme Collective" <hello@thesupremecollective.co.uk>',
      to: recipients,
      bcc: bccList,
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
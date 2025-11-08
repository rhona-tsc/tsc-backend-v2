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
    // 🧹 Defensive coercion to prevent `.includes` TypeError
    const safeTo = Array.isArray(to)
      ? to
      : typeof to === "string"
      ? [to]
      : [];

    const safeBcc = Array.isArray(bcc)
      ? bcc
      : typeof bcc === "string"
      ? [bcc]
      : [];

    // Filter out invalid addresses
    const recipients = safeTo.filter(e => typeof e === "string" && e.includes("@"));
    const bccList = safeBcc.filter(e => typeof e === "string" && e.includes("@"));

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
    console.log(`✅ Email sent to ${recipients.join(", ")}`);
    return { success: true };
  } catch (err) {
    console.error("❌ Email send failed:", err);
    return { success: false, error: err };
  }
};

export default sendEmail;
export { sendEmail };
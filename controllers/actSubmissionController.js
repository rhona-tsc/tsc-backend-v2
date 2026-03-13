// ------- Public: Act submission (simple email fan-out) -------
export const submitActSubmission = async (req, res) => {
  try {
    const { type, firstName, lastName, email, phone, promoLinks } = req.body || {};

    // Basic validation
    if (type !== "act_submission") {
      return res.status(400).json({ success: false, message: "Invalid type." });
    }
    if (!firstName || !lastName || !email) {
      return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    // Very light sanitization
    const safe = (s) => String(s || "").toString().trim();
    const escapeHtml = (s) =>
      String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const fn = safe(firstName);
    const ln = safe(lastName);
    const em = safe(email).toLowerCase();
    const ph = safe(phone);
    const pl = safe(promoLinks);
    const internalEmail = process.env.INTERNAL_NOTIFICATIONS_EMAIL || "hello@thesupremecollective.co.uk";

    const html = `
      <h3>New Act Submission</h3>
      <p><strong>Name:</strong> ${escapeHtml(fn)} ${escapeHtml(ln)}</p>
      <p><strong>Email:</strong> ${escapeHtml(em)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(ph || "—")}</p>
      <p><strong>Promo links:</strong><br/>${(pl || "—")
        .split(/\n+/)
        .map((line) => {
          const trimmed = safe(line);
          if (!trimmed) return "";
          const escaped = escapeHtml(trimmed);
          return /^https?:\/\//i.test(trimmed)
            ? `<div><a href="${escaped}" target="_blank" rel="noopener noreferrer">${escaped}</a></div>`
            : `<div>${escaped}</div>`;
        })
        .join("")}
      </p>
      <hr/>
      <p>Submitted via website.</p>
    `;

    const mail = {
      from: '"The Supreme Collective" <hello@thesupremecollective.co.uk>',
      to: internalEmail,
      replyTo: em,
      subject: `Act Submission – ${fn} ${ln}`,
      html,
    };

    // send the internal notification
    await transporter.sendMail(mail);

    
    await transporter.sendMail({
      from: '"The Supreme Collective" <hello@thesupremecollective.co.uk>',
      to: em,
      bcc: internalEmail,
      subject: 'Thanks for your submission',
      html: `
        <p>Hi ${fn},</p>
        <p>Thanks for submitting your act to The Supreme Collective. Our team will review your materials and get back to you if it’s a good fit.</p>
        <p>Warmest wishes,<br/>The Supreme Collective</p>
      `,
    });
   

    return res.json({ success: true });
  } catch (err) {
    console.error("submitActSubmission error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
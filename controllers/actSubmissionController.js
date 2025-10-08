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
    const fn = safe(firstName);
    const ln = safe(lastName);
    const em = safe(email);
    const ph = safe(phone);
    const pl = safe(promoLinks);

    const html = `
      <h3>New Act Submission</h3>
      <p><strong>Name:</strong> ${fn} ${ln}</p>
      <p><strong>Email:</strong> ${em}</p>
      <p><strong>Phone:</strong> ${ph || "—"}</p>
      <p><strong>Promo links:</strong><br/>${(pl || "—")
        .split(/\n+/)
        .map((line) =>
          line
            ? `<div><a href="${line.replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">${line}</a></div>`
            : ""
        )
        .join("")}
      </p>
      <hr/>
      <p>Submitted via website.</p>
    `;

    const mail = {
      from: '"The Supreme Collective" <hello@thesupremecollective.co.uk>',
      to: 'hello@thesupremecollective.co.uk',
      bcc: 'hello@thesupremecollective.co.uk',
      subject: `Act Submission – ${fn} ${ln}`,
      html,
    };

    // send the internal notification
    await transporter.sendMail(mail);

    
    await transporter.sendMail({
      from: '"The Supreme Collective" <hello@thesupremecollective.co.uk>',
      to: em,
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
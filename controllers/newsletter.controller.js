// controllers/newsletter.controller.js
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const crypto = require('crypto');

// In-memory demo store. Replace with your DB (users, vouchers, scheduled jobs).
const store = {
  contacts: new Map(),     // email -> { email, voucherCode, expiresAt }
};

// SMTP transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const makeVoucher = () =>
  `TSC-£50-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const addDays = (d, days) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });

async function sendEmail({ to, subject, html, bcc }) {
  await transporter.sendMail({
    from: `${process.env.SITE_NAME || 'The Supreme Collective'} <${process.env.FROM_EMAIL}>`,
    to,
    bcc: bcc || process.env.BCC_EMAIL,
    subject,
    html,
  });
}

function initialEmailTemplate({ code, expiresAt }) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5">
      <h2>Here’s your £50 voucher 🎉</h2>
      <p>Use this code at checkout within the next 7 days:</p>
      <p style="font-size:20px;font-weight:700;letter-spacing:1px;">${code}</p>
      <p>Expires: <strong>${fmt(expiresAt)}</strong></p>
      <p>Book now to lock it in!</p>
      <p style="margin-top:16px;">— The Supreme Collective</p>
    </div>
  `;
}

function reminderTemplate({ when, code, expiresAt }) {
  const title =
    when === 3 ? "Quick reminder — your £50 voucher is waiting" :
    when === 6 ? "Last chance! Your £50 voucher expires tomorrow" :
    "Don’t forget your £50 voucher";
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5">
      <h2>${title}</h2>
      <p>Voucher code:</p>
      <p style="font-size:20px;font-weight:700;letter-spacing:1px;">${code}</p>
      <p>Expiry: <strong>${fmt(expiresAt)}</strong></p>
      <p>Don't miss out on saving £50!</p>
      <p style="margin-top:16px;">— The Supreme Collective</p>
    </div>
  `;
}

/**
 * POST /api/newsletter/subscribe
 * body: { email }
 * side effects:
 *  - upsert contact
 *  - create voucher valid for 7 days
 *  - send initial email (bcc support)
 *  - schedule reminders on day 3 & day 6
 */
exports.subscribeHandler = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email' });
    }

    const now = new Date();
    const expiresAt = addDays(now, 7);
    const code = makeVoucher();

    // upsert
    store.contacts.set(email, { email, voucherCode: code, expiresAt });

    // send initial
    await sendEmail({
      to: email,
      subject: "Your £50 voucher (valid for 7 days)",
      html: initialEmailTemplate({ code, expiresAt }),
    });

    // schedule reminders (runs every minute, checks who’s due)
    // In production, prefer a durable queue (BullMQ/Cloud Tasks/Workflows)
    scheduleReminder(email, 3);
    scheduleReminder(email, 6);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Failed to subscribe' });
  }
};

// Simple cron scheduler that checks every minute whether a reminder is due
// and sends if within the appropriate day window.
let cronStarted = false;
const reminderIndex = new Map(); // email -> Set(daysScheduled)

function scheduleReminder(email, day) {
  const set = reminderIndex.get(email) || new Set();
  if (set.has(day)) return;
  set.add(day);
  reminderIndex.set(email, set);

  if (cronStarted) return;
  cron.schedule('* * * * *', async () => {
    const now = new Date();
    for (const [em, rec] of store.contacts.entries()) {
      const { voucherCode, expiresAt } = rec;

      // Compute target reminder times from creation: day 3, day 6
      const created = new Date(expiresAt);
      created.setDate(created.getDate() - 7); // reverse to creation time
      const day3 = addDays(created, 3);
      const day6 = addDays(created, 6);

      const dueToday = (target) =>
        now >= new Date(target.setHours(0, 0, 0, 0)) &&
        now < new Date(target.setHours(24, 0, 0, 0));

      try {
        const sentDays = reminderIndex.get(em) || new Set();

        if (!sentDays.has('3:sent') && dueToday(new Date(day3))) {
          await sendEmail({
            to: em,
            subject: "Reminder: your £50 voucher is waiting",
            html: reminderTemplate({ when: 3, code: voucherCode, expiresAt }),
          });
          sentDays.add('3:sent');
          reminderIndex.set(em, sentDays);
        }

        if (!sentDays.has('6:sent') && dueToday(new Date(day6))) {
          await sendEmail({
            to: em,
            subject: "Quick! Your £50 voucher expires tomorrow",
            html: reminderTemplate({ when: 6, code: voucherCode, expiresAt }),
          });
          sentDays.add('6:sent');
          reminderIndex.set(em, sentDays);
        }
      } catch (err) {
        console.error('Reminder send failed:', err);
      }
    }
  });
  cronStarted = true;
}
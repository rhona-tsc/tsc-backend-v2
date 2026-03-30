
import nodemailer from "nodemailer";
import deputyJobModel from "../models/deputyJobModel.js";
import musicianModel from "../models/musicianModel.js";

const PAYOUT_READY_STATUSES = ["scheduled", "pending"];

const normaliseString = (value) => String(value || "").trim();
const normaliseEmail = (value) => normaliseString(value).toLowerCase();

const parseDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatMoney = (value = 0, currency = "GBP") => {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: normaliseString(currency || "GBP") || "GBP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `GBP ${amount.toFixed(2)}`;
  }
};

const formatDateTime = (value) => {
  const date = parseDateOrNull(value);
  if (!date) return "TBC";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDate = (value) => {
  if (!value) return "TBC";
  const parsed = parseDateOrNull(value);
  if (parsed) {
    return parsed.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return normaliseString(value) || "TBC";
};

const buildMailer = () => {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });
};

const pushPaymentEvent = (job, event = {}) => {
  job.paymentEvents = [
    ...(Array.isArray(job.paymentEvents) ? job.paymentEvents : []),
    {
      type: event.type || "manual_adjustment",
      status: normaliseString(event.status || ""),
      amount: Number(event.amount || 0),
      currency: normaliseString(event.currency || job.currency || "GBP") || "GBP",
      stripeCustomerId: normaliseString(event.stripeCustomerId || job.stripeCustomerId || ""),
      setupIntentId: normaliseString(event.setupIntentId || job.setupIntentId || ""),
      paymentIntentId: normaliseString(event.paymentIntentId || job.paymentIntentId || ""),
      paymentMethodId: normaliseString(event.paymentMethodId || job.defaultPaymentMethodId || ""),
      note: normaliseString(event.note || ""),
      createdBy: event.createdBy || null,
      createdAt: event.createdAt || new Date(),
      metadata: event.metadata || {},
    },
  ];
};

const getReadyDeputyJobsForPayout = async (asOfDate = new Date()) => {
  return deputyJobModel.find({
    workflowStage: "booking_confirmed",
    paymentStatus: "paid",
    payoutStatus: { $in: PAYOUT_READY_STATUSES },
    releaseOn: { $lte: asOfDate },
    bookedMusicianId: { $ne: null },
    deputyNetAmount: { $gt: 0 },
  });
};

const buildDeputyRemittanceEmail = ({ job, musician }) => {
  const musicianName = [musician?.firstName, musician?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim() || "there";
  const jobTitle = normaliseString(job?.title || job?.instrument || "Deputy booking");
  const subject = `Remittance advice – ${jobTitle} – ${formatDate(job?.eventDate)}`;
  const grossAmount = formatMoney(job?.grossAmount || job?.fee || 0, job?.currency || "GBP");
  const commissionAmount = formatMoney(job?.commissionAmount || 0, job?.currency || "GBP");
  const deputyNetAmount = formatMoney(job?.deputyNetAmount || 0, job?.currency || "GBP");
  const payoutPaidAt = formatDateTime(job?.payoutPaidAt || new Date());
  const location = normaliseString(job?.venue || job?.locationName || job?.location || "TBC");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
      <h2 style="margin-bottom: 12px;">Remittance advice</h2>
      <p>Hi ${musicianName},</p>
      <p>Your deputy payment has been released for <strong>${jobTitle}</strong>.</p>
      <p><strong>Event date:</strong> ${formatDate(job?.eventDate)}</p>
      <p><strong>Location:</strong> ${location}</p>
      <p><strong>Gross booking amount:</strong> ${grossAmount}</p>
      <p><strong>Commission amount:</strong> ${commissionAmount}</p>
      <p><strong>Your net amount:</strong> ${deputyNetAmount}</p>
      <p><strong>Payout released:</strong> ${payoutPaidAt}</p>
      <p>If anything looks incorrect, please reply to this email.</p>
    </div>
  `;

  const text = [
    `Hi ${musicianName},`,
    `Your deputy payment has been released for ${jobTitle}.`,
    `Event date: ${formatDate(job?.eventDate)}`,
    `Location: ${location}`,
    `Gross booking amount: ${grossAmount}`,
    `Commission amount: ${commissionAmount}`,
    `Your net amount: ${deputyNetAmount}`,
    `Payout released: ${payoutPaidAt}`,
    "If anything looks incorrect, please reply to this email.",
  ].join("\n");

  return { subject, html, text };
};

const sendDeputyRemittanceAdvice = async ({ transporter, job, musician }) => {
  const email = normaliseEmail(musician?.email || "");
  if (!email) {
    return {
      success: false,
      skipped: true,
      reason: "missing_musician_email",
    };
  }

  if (!transporter) {
    return {
      success: false,
      skipped: true,
      reason: "missing_mailer_configuration",
    };
  }

  const emailContent = buildDeputyRemittanceEmail({ job, musician });

  await transporter.sendMail({
    from: `"The Supreme Collective" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  return {
    success: true,
    to: email,
    subject: emailContent.subject,
  };
};

const buildFinanceSummaryEmail = ({ runAt, checkedCount, releasedCount, totalReleased, currency = "GBP", releasedJobs = [], failures = [] }) => {
  const subject = `Deputy payout summary – ${formatDate(runAt)}`;
  const totalReleasedFormatted = formatMoney(totalReleased, currency);

  const releasedRowsHtml = releasedJobs.length
    ? releasedJobs
        .map(
          (item) => `
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${item.jobTitle}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${item.musicianName}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${item.eventDate}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${item.amount}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="4" style="padding: 8px;">No payouts released.</td></tr>`;

  const failuresHtml = failures.length
    ? `<ul>${failures.map((item) => `<li>${item.jobTitle}: ${item.reason}</li>`).join("")}</ul>`
    : `<p>No failures.</p>`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
      <h2 style="margin-bottom: 12px;">Deputy payout summary</h2>
      <p><strong>Run at:</strong> ${formatDateTime(runAt)}</p>
      <p><strong>Jobs checked:</strong> ${checkedCount}</p>
      <p><strong>Payouts released:</strong> ${releasedCount}</p>
      <p><strong>Total released:</strong> ${totalReleasedFormatted}</p>

      <h3 style="margin-top: 24px;">Released payouts</h3>
      <table style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb;">Job</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb;">Deputy</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb;">Event date</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${releasedRowsHtml}
        </tbody>
      </table>

      <h3 style="margin-top: 24px;">Failures</h3>
      ${failuresHtml}
    </div>
  `;

  const text = [
    "Deputy payout summary",
    `Run at: ${formatDateTime(runAt)}`,
    `Jobs checked: ${checkedCount}`,
    `Payouts released: ${releasedCount}`,
    `Total released: ${totalReleasedFormatted}`,
    "",
    "Released payouts:",
    ...(releasedJobs.length
      ? releasedJobs.map(
          (item) => `${item.jobTitle} | ${item.musicianName} | ${item.eventDate} | ${item.amount}`
        )
      : ["No payouts released."]),
    "",
    "Failures:",
    ...(failures.length
      ? failures.map((item) => `${item.jobTitle}: ${item.reason}`)
      : ["No failures."]),
  ].join("\n");

  return { subject, html, text };
};

const sendInternalFinanceSummary = async ({ transporter, summary }) => {
  const financeEmail = normaliseEmail(
    process.env.DEPUTY_FINANCE_EMAIL || process.env.GMAIL_USER || ""
  );

  if (!financeEmail) {
    return {
      success: false,
      skipped: true,
      reason: "missing_finance_email",
    };
  }

  if (!transporter) {
    return {
      success: false,
      skipped: true,
      reason: "missing_mailer_configuration",
    };
  }

  const emailContent = buildFinanceSummaryEmail(summary);

  await transporter.sendMail({
    from: `"The Supreme Collective" <${process.env.GMAIL_USER}>`,
    to: financeEmail,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  return {
    success: true,
    to: financeEmail,
    subject: emailContent.subject,
  };
};

const markJobPendingForPayout = async (jobId) => {
  return deputyJobModel.findOneAndUpdate(
    {
      _id: jobId,
      paymentStatus: "paid",
      payoutStatus: { $in: PAYOUT_READY_STATUSES },
      releaseOn: { $lte: new Date() },
    },
    {
      $set: {
        payoutStatus: "pending",
      },
    },
    { new: true }
  );
};

const releaseDeputyPayout = async ({ job, transporter }) => {
  const lockedJob = await markJobPendingForPayout(job._id);
  if (!lockedJob) {
    return {
      success: false,
      skipped: true,
      reason: "job_no_longer_ready",
    };
  }

  const musician = await musicianModel.findById(lockedJob.bookedMusicianId).lean();
  if (!musician) {
    lockedJob.payoutStatus = "held";
    pushPaymentEvent(lockedJob, {
      type: "manual_adjustment",
      status: "held",
      amount: Number(lockedJob.deputyNetAmount || 0),
      currency: lockedJob.currency,
      note: "Payout held because the booked musician record could not be found",
      metadata: { reason: "missing_booked_musician" },
    });
    await lockedJob.save();

    return {
      success: false,
      reason: "missing_booked_musician",
      job: lockedJob,
    };
  }

  lockedJob.payoutStatus = "paid";
  lockedJob.payoutPaidAt = new Date();
  pushPaymentEvent(lockedJob, {
    type: "payout_marked_paid",
    status: "paid",
    amount: Number(lockedJob.deputyNetAmount || 0),
    currency: lockedJob.currency,
    note: "Deputy payout released by daily payout cron",
    metadata: {
      musicianId: String(musician._id),
      musicianEmail: normaliseEmail(musician.email || ""),
    },
  });
  await lockedJob.save();

  const remittanceResult = await sendDeputyRemittanceAdvice({
    transporter,
    job: lockedJob,
    musician,
  });

  return {
    success: true,
    job: lockedJob,
    musician,
    remittanceResult,
  };
};

export const runDeputyPayoutRelease = async ({ asOfDate = new Date() } = {}) => {
  const transporter = buildMailer();
  const readyJobs = await getReadyDeputyJobsForPayout(asOfDate);

  const results = [];
  let totalReleased = 0;

  for (const job of readyJobs) {
    try {
      const result = await releaseDeputyPayout({ job, transporter });
      results.push(result);

      if (result?.success) {
        totalReleased += Number(result?.job?.deputyNetAmount || 0);
      }
    } catch (error) {
      results.push({
        success: false,
        job,
        reason: error?.message || "Unknown payout error",
      });
    }
  }

  const releasedJobs = results
    .filter((item) => item?.success && item?.job)
    .map((item) => ({
      jobTitle: normaliseString(item.job.title || item.job.instrument || "Deputy booking"),
      musicianName:
        [item?.musician?.firstName, item?.musician?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() || "Unknown musician",
      eventDate: formatDate(item?.job?.eventDate),
      amount: formatMoney(item?.job?.deputyNetAmount || 0, item?.job?.currency || "GBP"),
    }));

  const failures = results
    .filter((item) => !item?.success && !item?.skipped)
    .map((item) => ({
      jobTitle: normaliseString(item?.job?.title || item?.job?.instrument || "Deputy booking"),
      reason: normaliseString(item?.reason || "Unknown failure"),
    }));

  const summary = {
    runAt: asOfDate,
    checkedCount: readyJobs.length,
    releasedCount: releasedJobs.length,
    totalReleased,
    currency: "GBP",
    releasedJobs,
    failures,
  };

  const financeEmailResult = await sendInternalFinanceSummary({
    transporter,
    summary,
  });

  return {
    success: true,
    checkedCount: readyJobs.length,
    releasedCount: releasedJobs.length,
    totalReleased,
    results,
    financeEmailResult,
  };
};

export default runDeputyPayoutRelease;
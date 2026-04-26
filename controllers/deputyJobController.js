// controllers/deputyJobController.js
import Stripe from "stripe";
import deputyJobModel from "../models/deputyJobModel.js";
import musicianModel from "../models/musicianModel.js";
import { findMatchingMusiciansForDeputyJob } from "../services/deputyJobMatcher.js";
import { notifyMusiciansAboutDeputyJob } from "../services/deputyJobNotifier.js";
import { runDeputyPayoutRelease } from "../services/deputyPayoutService.js";
import {
  sendDeputyAllocationWhatsApp,
  sendDeputyAllocationDeclinedWhatsApp,
  toE164,
} from "../utils/twilioClient.js";
import { sendWhatsAppText } from "../utils/twilioClient.js";
import { sendEmail } from "../utils/sendEmail.js";

const DEPUTY_JOB_BCC_EMAIL =
  process.env.DEPUTY_JOB_BCC_EMAIL || "hello@thesupremecollective.co.uk";

const normaliseArray = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const normaliseString = (value) => String(value || "").trim();

const normaliseCurrency = (value) => {
  const raw = normaliseString(value || "GBP").toUpperCase();
  if (!raw || raw === "£") return "GBP";
  return raw;
};

const formatMoney = (value, currency = "GBP") => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "TBC";

  const safeCurrency = normaliseCurrency(currency || "GBP");

  if (safeCurrency === "GBP") {
    return `£${amount.toFixed(2).replace(/\.00$/, "")}`;
  }

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .format(amount)
      .replace(/\.00$/, "");
  } catch {
    return `£${amount.toFixed(2).replace(/\.00$/, "")}`;
  }
};

const getDeputyNetFeeAmount = (job = {}) => {
  const deputyNetAmount = Number(job?.deputyNetAmount || 0);
  if (Number.isFinite(deputyNetAmount) && deputyNetAmount > 0)
    return deputyNetAmount;

  const fee = Number(job?.fee || 0);
  return Number.isFinite(fee) && fee > 0 ? fee : 0;
};

const getDeputyNetFeeText = (job = {}) => {
  const netAmount = getDeputyNetFeeAmount(job);
  return netAmount > 0 ? formatMoney(netAmount, job?.currency || "GBP") : "TBC";
};

const asObjectIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value?._id) return String(value._id);
  return String(value);
};

const stripeSecretKey =
  process.env.STRIPE_SECRET_KEY_V2 || process.env.STRIPE_SECRET_KEY || "";

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" })
  : null;

const normaliseEmail = (value) => normaliseString(value).toLowerCase();

const DEFAULT_DEPUTY_STRIPE_FEE_PERCENT = Number(
  process.env.DEPUTY_STRIPE_FEE_PERCENT ||
    process.env.STRIPE_CARD_FEE_PERCENT ||
    0,
);

const DEFAULT_DEPUTY_STRIPE_FEE_FIXED = Number(
  process.env.DEPUTY_STRIPE_FEE_FIXED || process.env.STRIPE_CARD_FEE_FIXED || 0,
);

const roundMoney = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
};

const estimateDeputyStripeFee = ({
  grossAmount = 0,
  percent = DEFAULT_DEPUTY_STRIPE_FEE_PERCENT,
  fixed = DEFAULT_DEPUTY_STRIPE_FEE_FIXED,
}) => {
  const safeGross = Number(grossAmount || 0);
  const safePercent = Number(percent || 0);
  const safeFixed = Number(fixed || 0);

  if (!Number.isFinite(safeGross) || safeGross <= 0) return 0;

  const percentageFee = safePercent > 0 ? safeGross * (safePercent / 100) : 0;
  const fixedFee = safeFixed > 0 ? safeFixed : 0;

  return roundMoney(percentageFee + fixedFee);
};

const normaliseBoolean = (value) => {
  if (value === true || value === "true" || value === 1 || value === "1")
    return true;
  if (value === false || value === "false" || value === 0 || value === "0")
    return false;
  return Boolean(value);
};

const normaliseStringArray = (value) =>
  normaliseArray(value)
    .map((item) => normaliseString(item))
    .filter(Boolean);

const normalisePhoneValue = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  return raw
    .replace(/^whatsapp:/i, "")
    .replace(/[^\d+]/g, "")
    .replace(/^00/, "+");
};

const escapeHtml = (value = "") =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const normaliseList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const renderDetailRow = (label, value) => {
  const safeValue = String(value || "").trim();
  if (!safeValue) return "";
  return `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(safeValue)}</li>`;
};

const renderDetailListRow = (label, values = []) => {
  const safeValues = normaliseList(values);
  if (!safeValues.length) return "";
  return `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(safeValues.join(", "))}</li>`;
};

const getMusicianPayoutSettingsUrl = (musician = {}) => {
  const siteBase = "https://admin.thesupremecollective.co.uk".replace(
    /\/$/,
    "",
  );

  return `${siteBase}/account/payout-settings`;
};

const getMusicianPayoutSummary = (musician = {}) => {
  const stripeConnect = musician?.stripeConnect || {};

  const hasStripeAccount = Boolean(
    String(stripeConnect.accountId || "").trim(),
  );
  const detailsSubmitted = Boolean(stripeConnect.detailsSubmitted);
  const chargesEnabled = Boolean(stripeConnect.chargesEnabled);
  const payoutsEnabled = Boolean(stripeConnect.payoutsEnabled);

  const isStripeReady = hasStripeAccount && detailsSubmitted && payoutsEnabled;

  const sortCode = String(musician?.bank_account?.sort_code || "").replace(
    /\D/g,
    "",
  );
  const accountNumber = String(
    musician?.bank_account?.account_number || "",
  ).replace(/\D/g, "");
  const accountName = String(musician?.bank_account?.account_name || "").trim();
  const accountType = String(musician?.bank_account?.account_type || "").trim();

  const hasManualBankDetails =
    sortCode.length === 6 &&
    accountNumber.length >= 6 &&
    Boolean(accountName) &&
    Boolean(accountType);

  return {
    hasPayoutDetails: isStripeReady,
    isStripeReady,
    hasStripeAccount,
    detailsSubmitted,
    chargesEnabled,
    payoutsEnabled,

    hasManualBankDetails,
    hasSortCode: sortCode.length === 6,
    hasAccountNumber: accountNumber.length >= 6,
    hasAccountName: Boolean(accountName),
    hasAccountType: Boolean(accountType),

    sortCode,
    accountNumber,
    accountName,
    accountType,
    ending: accountNumber ? accountNumber.slice(-3) : "",
  };
};

const buildPhoneVariants = (value = "") => {
  const normalised = normalisePhoneValue(value);
  if (!normalised) return [];

  const digitsOnly = normalised.replace(/^\+/, "");
  const variants = new Set([
    normalised,
    digitsOnly,
    `+${digitsOnly}`,
    `whatsapp:${normalised}`,
    `whatsapp:+${digitsOnly}`,
  ]);

  if (digitsOnly.startsWith("44")) {
    const local = `0${digitsOnly.slice(2)}`;
    variants.add(local);
    variants.add(`whatsapp:${local}`);
  }

  return Array.from(variants).filter(Boolean);
};

const phonesMatch = (left, right) => {
  const leftVariants = buildPhoneVariants(left);
  const rightSet = new Set(buildPhoneVariants(right));
  return leftVariants.some((value) => rightSet.has(value));
};

const interpretDeputyReply = (raw = "") => {
  const low = String(raw || "")
    .toLowerCase()
    .trim();
  if (!low) return null;

  if (
    low === "yes" ||
    low === "accept" ||
    low.includes("accept") ||
    low.includes("book me in") ||
    low.startsWith("djyes_") ||
    low.startsWith("deputyyes_")
  ) {
    return "accepted";
  }

  if (
    low === "no" ||
    low === "decline" ||
    low.includes("decline") ||
    low.includes("no thanks") ||
    low.includes("cant do") ||
    low.includes("can't do") ||
    low.startsWith("djno_") ||
    low.startsWith("deputyno_")
  ) {
    return "declined";
  }

  return null;
};

const extractDeputyJobIdFromReply = (raw = "") => {
  const match = String(raw || "").match(
    /(?:djyes|djno|deputyyes|deputyno)_([a-f\d]{24})/i,
  );
  return match ? match[1] : "";
};

const withDeputyJobAliases = (job) => {
  if (!job) return job;

  const source =
    typeof job.toObject === "function" ? job.toObject() : { ...job };

  return {
    ...source,
    date: source.date || source.eventDate || "",
    callTime: source.callTime || source.startTime || "",
    finishTime: source.finishTime || source.endTime || "",
    venue: source.venue || source.locationName || source.location || "",
    locationName: source.locationName || source.venue || source.location || "",
    location: source.location || source.locationName || source.venue || "",
    setLengths: Array.isArray(source.setLengths) ? source.setLengths : [],
    whatsIncluded: Array.isArray(source.whatsIncluded)
      ? source.whatsIncluded
      : [],
    whatsIncludedOther: source.whatsIncludedOther || "",
    claimableExpenses: Array.isArray(source.claimableExpenses)
      ? source.claimableExpenses
      : [],
    claimableExpensesOther: source.claimableExpensesOther || "",
  };
};

const toPence = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
};

const parseDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getOrdinalSuffix = (day) => {
  const numericDay = Number(day);
  if (!Number.isInteger(numericDay)) return "";
  if (numericDay >= 11 && numericDay <= 13) return "th";

  const lastDigit = numericDay % 10;
  if (lastDigit === 1) return "st";
  if (lastDigit === 2) return "nd";
  if (lastDigit === 3) return "rd";
  return "th";
};

const formatDeputyOpportunityDate = (value) => {
  const parsed = parseDateOrNull(value);
  if (!parsed) return normaliseString(value);

  const dayName = parsed.toLocaleDateString("en-GB", { weekday: "long" });
  const monthName = parsed.toLocaleDateString("en-GB", { month: "long" });
  const dayOfMonth = parsed.getDate();
  const year = parsed.getFullYear();

  return `${dayName} ${dayOfMonth}${getOrdinalSuffix(dayOfMonth)} of ${monthName} ${year}`;
};

const buildDefaultReleaseOn = (eventDate) => {
  const parsed = parseDateOrNull(eventDate);
  if (!parsed) return null;
  const releaseOn = new Date(parsed);
  releaseOn.setDate(releaseOn.getDate() + 5);
  return releaseOn;
};

const buildLedgerAmounts = ({
  fee = 0,
  grossAmount = 0,
  commissionAmount = 0,
  deputyNetAmount = 0,
  stripeFeeAmount = null,
  deductStripeFeesFromDeputy = true,
}) => {
  const safeFee = Number(fee || 0);
  const safeGrossAmount = Number(grossAmount || 0);
  const safeCommissionAmount = Number(commissionAmount || 0);
  const safeDeputyNetAmount = Number(deputyNetAmount || 0);

  const finalGrossAmount =
    safeGrossAmount > 0 ? safeGrossAmount : safeFee > 0 ? safeFee : 0;

  const estimatedStripeFee =
    stripeFeeAmount === null ||
    stripeFeeAmount === undefined ||
    stripeFeeAmount === ""
      ? estimateDeputyStripeFee({ grossAmount: finalGrossAmount })
      : roundMoney(Number(stripeFeeAmount || 0));

  const finalStripeFeeAmount =
    deductStripeFeesFromDeputy && finalGrossAmount > 0 ? estimatedStripeFee : 0;

  let finalDeputyNetAmount =
    safeDeputyNetAmount > 0
      ? safeDeputyNetAmount
      : finalGrossAmount - safeCommissionAmount - finalStripeFeeAmount;

  finalDeputyNetAmount = roundMoney(Math.max(finalDeputyNetAmount, 0));

  let finalCommissionAmount =
    safeCommissionAmount > 0
      ? safeCommissionAmount
      : roundMoney(
          Math.max(
            finalGrossAmount - finalDeputyNetAmount - finalStripeFeeAmount,
            0,
          ),
        );

  finalCommissionAmount = roundMoney(Math.max(finalCommissionAmount, 0));

  return {
    grossAmount: roundMoney(finalGrossAmount),
    commissionAmount: finalCommissionAmount,
    deputyNetAmount: finalDeputyNetAmount,
    stripeFeeAmount: roundMoney(finalStripeFeeAmount),
  };
};

const pushPaymentEvent = (job, event = {}) => {
  job.paymentEvents = [
    ...(Array.isArray(job.paymentEvents) ? job.paymentEvents : []),
    {
      type: event.type || "manual_adjustment",
      status: normaliseString(event.status || ""),
      amount: Number(event.amount || 0),
      currency: normaliseCurrency(event.currency || job.currency || "£"),
      stripeCustomerId: normaliseString(
        event.stripeCustomerId || job.stripeCustomerId || "",
      ),
      setupIntentId: normaliseString(
        event.setupIntentId || job.setupIntentId || "",
      ),
      paymentIntentId: normaliseString(
        event.paymentIntentId || job.paymentIntentId || "",
      ),
      paymentMethodId: normaliseString(
        event.paymentMethodId || job.defaultPaymentMethodId || "",
      ),
      note: normaliseString(event.note || ""),
      createdBy: event.createdBy || null,
      createdAt: event.createdAt || new Date(),
      metadata: event.metadata || {},
    },
  ];
};

const ensureStripeReady = (res) => {
  if (stripe) return true;
  res.status(500).json({
    success: false,
    message: "Stripe is not configured on the server",
  });
  return false;
};

const ensureCronSecret = (req, res) => {
  const expectedSecret = normaliseString(
    process.env.CRON_SECRET || process.env.DEPUTY_PAYOUT_CRON_SECRET || "",
  );

  if (!expectedSecret) {
    res.status(500).json({
      success: false,
      message: "Cron secret is not configured on the server",
    });
    return false;
  }

  const providedSecret = normaliseString(
    req.headers["x-cron-secret"] ||
      req.headers["x-payout-cron-secret"] ||
      req.body?.cronSecret ||
      "",
  );

  if (providedSecret !== expectedSecret) {
    res.status(401).json({
      success: false,
      message: "Invalid cron secret",
    });
    return false;
  }

  return true;
};

const createOrRefreshDeputyJobSetupIntentInternal = async ({
  job,
  clientName = "",
  clientEmail = "",
  clientPhone = "",
  createdBy = null,
}) => {
  if (!stripe) {
    return {
      success: false,
      message: "Stripe is not configured on the server",
      clientSecret: "",
      setupIntentId: "",
      stripeCustomerId: "",
    };
  }

  const safeClientName = normaliseString(clientName || job?.clientName || "");
  const safeClientEmail = normaliseEmail(clientEmail || job?.clientEmail || "");
  const safeClientPhone = normaliseString(
    clientPhone || job?.clientPhone || "",
  );

  if (!safeClientEmail) {
    return {
      success: false,
      message: "clientEmail is required before saving a card",
      clientSecret: "",
      setupIntentId: "",
      stripeCustomerId: normaliseString(job?.stripeCustomerId || ""),
    };
  }

  let stripeCustomerId = normaliseString(job?.stripeCustomerId || "");

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      name: safeClientName || undefined,
      email: safeClientEmail,
      phone: safeClientPhone || undefined,
      metadata: {
        deputyJobId: String(job._id),
      },
    });
    stripeCustomerId = customer.id;
  } else {
    await stripe.customers.update(stripeCustomerId, {
      name: safeClientName || undefined,
      email: safeClientEmail,
      phone: safeClientPhone || undefined,
      metadata: {
        deputyJobId: String(job._id),
      },
    });
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    usage: "off_session",
    metadata: {
      deputyJobId: String(job._id),
    },
  });

  job.clientName = safeClientName;
  job.clientEmail = safeClientEmail;
  job.clientPhone = safeClientPhone;
  job.stripeCustomerId = stripeCustomerId;
  job.setupIntentId = setupIntent.id || "";
  job.setupIntentStatus = setupIntent.status || "";
  job.paymentStatus = "setup_pending";

  pushPaymentEvent(job, {
    type: "setup_intent_created",
    status: setupIntent.status || "",
    amount: Number(job.grossAmount || job.fee || 0),
    currency: job.currency,
    stripeCustomerId,
    setupIntentId: setupIntent.id,
    createdBy,
    note: "SetupIntent created during deputy job creation",
  });

  return {
    success: true,
    clientSecret: setupIntent.client_secret || "",
    setupIntentId: setupIntent.id || "",
    stripeCustomerId,
    paymentStatus: job.paymentStatus,
  };
};

const attemptDeputyJobCharge = async ({ job, createdBy = null }) => {
  if (!stripe) {
    return {
      success: false,
      message: "Stripe is not configured on the server",
    };
  }

  if (!job?.stripeCustomerId || !job?.defaultPaymentMethodId) {
    job.paymentStatus = "setup_required";
    pushPaymentEvent(job, {
      type: "charge_requested",
      status: "missing_payment_method",
      amount: Number(job?.grossAmount || job?.fee || 0),
      currency: job?.currency,
      createdBy,
      note: "Charge requested before a default payment method was saved",
    });

    return {
      success: false,
      message: "No saved payment method found for this deputy job",
    };
  }

  const amountPence = toPence(job.grossAmount || job.fee || 0);
  if (!amountPence) {
    return {
      success: false,
      message: "No chargeable amount found for this deputy job",
    };
  }

  job.paymentStatus = "charge_pending";
  job.paymentFailureReason = "";
  pushPaymentEvent(job, {
    type: "charge_requested",
    status: "pending",
    amount: Number(job.grossAmount || job.fee || 0),
    currency: job.currency,
    createdBy,
    note: "Automatic deputy allocation charge requested",
  });

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountPence,
      currency: String(job.currency || "GBP").toLowerCase(),
      customer: job.stripeCustomerId,
      payment_method: job.defaultPaymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        deputyJobId: String(job._id),
        eventDate: String(job.eventDate || ""),
        allocatedMusicianId: String(job.allocatedMusicianId || ""),
        bookedMusicianId: String(job.bookedMusicianId || ""),
      },
    });

    job.paymentIntentId = paymentIntent.id || "";
    job.paymentIntentStatus = paymentIntent.status || "";
    job.paymentStatus =
      paymentIntent.status === "succeeded" ? "paid" : "charge_pending";
    job.chargedAt =
      paymentIntent.status === "succeeded" ? new Date() : job.chargedAt || null;
    job.paymentFailureReason = "";

    if (paymentIntent.status === "succeeded") {
      job.payoutStatus = job.releaseOn
        ? "scheduled"
        : job.payoutStatus || "not_ready";
      job.payoutScheduledAt = job.releaseOn
        ? new Date()
        : job.payoutScheduledAt || null;
    }

    pushPaymentEvent(job, {
      type:
        paymentIntent.status === "succeeded"
          ? "payment_succeeded"
          : "payment_intent_created",
      status: paymentIntent.status || "",
      amount: Number(job.grossAmount || job.fee || 0),
      currency: job.currency,
      paymentIntentId: paymentIntent.id,
      paymentMethodId: job.defaultPaymentMethodId,
      stripeCustomerId: job.stripeCustomerId,
      createdBy,
      note:
        paymentIntent.status === "succeeded"
          ? "Deputy job charge succeeded"
          : "Deputy job payment intent created",
      metadata: {
        stripeAmount: paymentIntent.amount || 0,
      },
    });

    return {
      success: paymentIntent.status === "succeeded",
      paymentIntent,
    };
  } catch (error) {
    job.paymentStatus = "failed";
    job.paymentIntentStatus = "failed";
    job.paymentFailureReason = error?.message || "Stripe charge failed";

    pushPaymentEvent(job, {
      type: "payment_failed",
      status: error?.code || "failed",
      amount: Number(job.grossAmount || job.fee || 0),
      currency: job.currency,
      stripeCustomerId: job.stripeCustomerId,
      paymentMethodId: job.defaultPaymentMethodId,
      createdBy,
      note: error?.message || "Stripe charge failed",
      metadata: {
        errorType: error?.type || "",
        declineCode: error?.decline_code || "",
      },
    });

    return {
      success: false,
      message: error?.message || "Stripe charge failed",
      error,
    };
  }
};

const maskEmailForManageView = (value = "") => {
  const email = normaliseString(value).toLowerCase();
  if (!email || !email.includes("@")) return "";

  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return email;

  const safeLocal =
    localPart.length <= 2
      ? `${localPart.charAt(0) || ""}*`
      : `${localPart.slice(0, 2)}${"*".repeat(
          Math.max(localPart.length - 2, 1),
        )}`;

  return `${safeLocal}@${domain}`;
};

const buildRecipientPreview = (musicians = []) =>
  musicians.map((m) => ({
    musicianId: m?._id || m?.id || null,
    firstName: m?.firstName || "",
    lastName: m?.lastName || "",
    email: m?.email || "",
    phone: m?.phone || m?.phoneNumber || "",
  }));

const buildMatchSnapshot = (musician = {}) => ({
  musicianId: musician?._id || musician?.id || null,
  firstName: musician?.firstName || "",
  lastName: musician?.lastName || "",
  email: musician?.email || "",
  phone: musician?.phone || musician?.phoneNumber || "",
  profilePicture:
    musician?.profilePicture ||
    musician?.profilePhoto ||
    musician?.profileImage ||
    musician?.profilePic ||
    musician?.profile_picture ||
    "",
  musicianSlug: musician?.musicianSlug || "",
  deputyMatchScore: Number(musician?.deputyMatchScore || 0),
  matchPct: Number(musician?.matchPct || 0),
  matchSummary: {
    instrument: musician?._debug?.instrument || musician?.instrument || "",
    roleFit: Number(musician?._debug?.roleFit || 0),
    genreFit: Number(musician?._debug?.genreFit || 0),
    locationFit: Number(
      musician?._debug?.locScore || musician?._debug?.locationFit || 0,
    ),
    songFit: Number(
      musician?._debug?.songOverlapPct || musician?._debug?.songFit || 0,
    ),
  },
  notified: false,
  notifiedAt: null,
});

const formatDate = (value) => {
  const raw = normaliseString(value);
  if (!raw) return "TBC";

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  return parsed.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const buildTime = (job = {}) => {
  const callTime = normaliseString(job?.callTime || job?.startTime || "");
  const finishTime = normaliseString(job?.finishTime || job?.endTime || "");

  if (callTime && finishTime) return `${callTime} – ${finishTime}`;
  if (callTime) return callTime;
  if (finishTime) return finishTime;
  return "TBC";
};

const buildLocation = (job = {}) => {
  return (
    normaliseString(job?.location) ||
    normaliseString(job?.venue) ||
    normaliseString(job?.locationName) ||
    "Location TBC"
  );
};

const getDeputyFeeForEmail = (job = {}) => {
  return getDeputyNetFeeAmount(job);
};

const formatFee = (value, currency = "GBP") => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "TBC";
  return formatMoney(amount, currency);
};

const buildHtmlEmail = ({ musician, job, applyUrl }) => {
  const firstName = musician?.firstName
    ? escapeHtml(musician.firstName)
    : "there";
  const safeTitle = escapeHtml(
    job?.title || job?.instrument || "Deputy opportunity",
  );
  const instrument = escapeHtml(job?.instrument || job?.title || "TBC");
  const date = escapeHtml(formatDate(job?.eventDate || job?.date));
  const time = escapeHtml(buildTime(job));
  const location = escapeHtml(buildLocation(job));
  const fee = escapeHtml(
    formatFee(getDeputyFeeForEmail(job), job?.currency || "GBP"),
  );
  const notes = job?.notes
    ? `<li style="margin:0 0 8px;"><strong>Notes:</strong> ${escapeHtml(job.notes)}</li>`
    : "";
  const safeApplyUrl = escapeHtml(applyUrl);

  const WEBSITE_URL = "https://thesupremecollective.co.uk";
  const ADMIN_URL = "https://admin.thesupremecollective.co.uk";
  const INSTAGRAM_URL = "https://instagram.com/thesupremecollective";
  const YOUTUBE_URL =
    "https://www.youtube.com/channel/UC6HhRZA4XLVajrz5vk5vn2A";
  const GOOGLE_REVIEWS_URL =
    "https://www.google.com/search?q=the+supreme+collective&oq=the+supreme+collective&aqs=chrome.0.0i355i512j46i175i199i512j0i22i30l3j69i60j69i61l2.4878j0j7&sourceid=chrome&ie=UTF-8#lrd=0x751df2ff4f2e30d:0xb1f44d25caa515eb,1,,,";
  const INSTAGRAM_ICON_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777056960/instagram-icon_rtespa.png";
  const YOUTUBE_ICON_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777056960/1_lo9yf6.png";
  const GOOGLE_REVIEWS_ICON_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777059616/google-icon2_wc33od.png";
  const WEBSITE_ICON_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777207820/website-icon_nuahjk.png";
  const UNSUBSCRIBE_SUBJECT = encodeURIComponent(
    "Please unsubscribe me from The Supreme Collective",
  );
  const UNSUBSCRIBE_BODY = encodeURIComponent(
    "Please hit send to unsubscribe from The Supreme Collective",
  );
  const UNSUBSCRIBE_URL = `mailto:hello@thesupremecollective.co.uk?subject=${UNSUBSCRIBE_SUBJECT}&body=${UNSUBSCRIBE_BODY}`;

  const POST_JOB_IMAGE_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777045523/post-your-own-dep-jobs_l0jy6s.png";
  const LIST_ACT_IMAGE_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777045541/wanna-list-your-act_mrnyse.png";
  const SIGN_OFF_GIF_URL =
    "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777045559/TSC_Signature_2026_svgxr5.gif";

  const shareText = encodeURIComponent(
    `I thought this deputy opportunity might be a great fit for you: ${applyUrl}`,
  );
  const whatsappShareUrl = `https://wa.me/?text=${shareText}`;
  const mailtoShareUrl = `mailto:?subject=${encodeURIComponent(
    `Deputy opportunity: ${job?.title || job?.instrument || "Deputy opportunity"}`,
  )}&body=${shareText}`;
  // const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(applyUrl)}`;

  return `
    <div style="margin:0; padding:0; background:#f3f4f6; font-family:Arial, Helvetica, sans-serif; color:#111111;">
      <div style="max-width:720px; margin:0 auto; padding:28px 16px;">

        <div style="background:#111111; border-radius:28px 28px 0 0; overflow:hidden; text-align:center;">
          <div style="padding:18px 28px 8px;">
            <p style="margin:0; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#ff6667; font-weight:700; text-align:center;">
              The Supreme Collective
            </p>
          </div>

          <div style="padding:0 28px 30px; text-align:center;">
            <h1 style="margin:8px 0 10px; font-size:34px; line-height:1.05; color:#ffffff; font-weight:800;">
              Deputy Opportunity
            </h1>
            <p style="margin:0; font-size:16px; line-height:1.7; color:#f3f3f3;">
              A new opportunity has come in that may be a great fit for you.
            </p>
          </div>
        </div>

        <div style="background:#ffffff; border:1px solid #e8e8e8; border-top:0; border-radius:0 0 28px 28px; padding:30px 28px; box-shadow:0 10px 30px rgba(0,0,0,0.04);">
          <p style="margin:0 0 18px; font-size:16px; line-height:1.7; color:#333333;">
            Hi ${firstName},
          </p>

          <p style="margin:0 0 22px; font-size:15px; line-height:1.8; color:#444444;">
            A new deputy opportunity has just come in that may be a fit for you. Please review the details below and use the button to apply.
          </p>

          <div style="margin:0 0 22px; padding:22px; background:#fff6f6; border:1px solid #ffd6d7; border-radius:22px;">
            <p style="margin:0 0 8px; font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:#ff6667; font-weight:700;">
              Role
            </p>
            <h2 style="margin:0; font-size:30px; line-height:1.15; color:#111111; font-weight:800;">
              ${instrument}
            </h2>
          </div>

          <div style="margin:0 0 26px; text-align:center;">
            <a
              href="${safeApplyUrl}"
              style="display:inline-block; background:#ff6667; color:#ffffff; text-decoration:none; padding:14px 24px; border-radius:999px; font-size:16px; font-weight:700;"
            >
              View & apply
            </a>
          </div>

          <div style="margin-bottom:28px; padding:24px; background:#fafafa; border:1px solid #ececec; border-radius:22px;">
            <h3 style="margin:0 0 14px; font-size:16px; color:#111111;">Job details</h3>
            <ul style="margin:0; padding-left:20px; font-size:14px; line-height:1.8; color:#333333;">
              <li style="margin:0 0 8px;"><strong>Role:</strong> ${instrument}</li>
              <li style="margin:0 0 8px;"><strong>Date:</strong> ${date}</li>
              <li style="margin:0 0 8px;"><strong>Time:</strong> ${time}</li>
              <li style="margin:0 0 8px;"><strong>Location:</strong> ${location}</li>
              <li style="margin:0 0 8px;"><strong>Deputy fee:</strong> ${fee}</li>
              ${notes}
            </ul>
          </div>

          <div style="margin:0 0 28px; padding:22px; background:#111111; border-radius:22px;">
            <h3 style="margin:0 0 10px; font-size:18px; color:#ffffff;">Share this opportunity</h3>
            <p style="margin:0 0 18px; font-size:14px; line-height:1.7; color:#f3f3f3;">
              Know someone who could be a brilliant fit? Feel free to share this opportunity with them.
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="33.33%" style="padding:0 8px 10px 0; text-align:center;">
                  <a
                    href="${whatsappShareUrl}"
                    style="display:block; width:100%; box-sizing:border-box; background:#25D366; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:999px; font-size:15px; font-weight:700; text-align:center;"
                  >
                    Share on WhatsApp
                  </a>
                </td>
                <td width="33.33%" style="padding:0 8px 10px 8px; text-align:center;">
                  <a
                    href="${mailtoShareUrl}"
                    style="display:block; width:100%; box-sizing:border-box; background:#ffffff; color:#111111; text-decoration:none; padding:12px 18px; border-radius:999px; font-size:15px; font-weight:700; text-align:center;"
                  >
                    Share by email
                  </a>
                </td>
                <td width="33.33%" style="padding:0 0 10px 8px; text-align:center;">
                  <a
                    href="${safeApplyUrl}"
                    style="display:block; width:100%; box-sizing:border-box; background:transparent; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:999px; font-size:15px; font-weight:700; text-align:center; border:1px solid rgba(255,255,255,0.35);"
                  >
                    Copy job link
                  </a>
                </td>
              </tr>
            </table>
          </div>


          <div style="margin:28px 0 22px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="top" width="50%" style="padding-right:10px;">
                  <a href="${WEBSITE_URL}" style="text-decoration:none; display:block;">
                    <img
                      src="${POST_JOB_IMAGE_URL}"
                      alt="Post your own deputy jobs"
                      style="display:block; width:100%; max-width:328px; border:0; border-radius:20px;"
                    />
                  </a>
                </td>
                <td valign="top" width="50%" style="padding-left:10px;">
                  <a href="${WEBSITE_URL}" style="text-decoration:none; display:block;">
                    <img
                      src="${LIST_ACT_IMAGE_URL}"
                      alt="Wanna list your act?"
                      style="display:block; width:100%; max-width:328px; border:0; border-radius:20px;"
                    />
                  </a>
                </td>
              </tr>
              <tr>
                <td valign="top" width="50%" style="padding:16px 10px 0 0;">
                  <div style="padding:18px 18px; background:#fafafa; border:1px solid #ececec; border-radius:18px; height:100%; box-sizing:border-box;">
                    <p style="margin:0; font-size:14px; line-height:1.7; color:#444444;">
                      Did you know you can also post your own deputy jobs through <strong>The Supreme Collective</strong>? You can reach a wide network of musicians and send your opportunity straight to matched players' inboxes in just a few clicks.
                    </p>
                  </div>
                </td>
                <td valign="top" width="50%" style="padding:16px 0 0 10px;">
                  <div style="padding:18px 18px; background:#fafafa; border:1px solid #ececec; border-radius:18px; height:100%; box-sizing:border-box;">
                    <p style="margin:0; font-size:14px; line-height:1.7; color:#444444;">
                      Think your act could be a great fit for <strong>The Supreme Collective</strong>? You’re very welcome to pre-submit your act for review and, if it feels like the right match, we’ll be in touch.
                    </p>
                  </div>
                </td>
              </tr>
            </table>
          </div>

          <p style="margin:0; font-size:15px; line-height:1.7; color:#444444;">
            Best wishes,<br />
            <strong>The Supreme Collective</strong>
          </p>

        

          <div style="margin:0 0 8px; padding:22px; background:#fafafa; border:1px solid #ececec; border-radius:22px;">
            <h3 style="margin:0 0 14px; font-size:16px; color:#111111;">Find us online</h3>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
              <tr>
                <td style="padding:0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="padding:0 14px 10px 0; vertical-align:middle;">
                        <a href="${INSTAGRAM_URL}" style="text-decoration:none; display:inline-block;">
                          <img
                            src="${INSTAGRAM_ICON_URL}"
                            alt="Instagram"
                            style="display:block; width:32px; height:32px; border:0;"
                          />
                        </a>
                      </td>
                      <td style="padding:0 14px 10px 0; vertical-align:middle;">
                        <a href="${YOUTUBE_URL}" style="text-decoration:none; display:inline-block;">
                          <img
                            src="${YOUTUBE_ICON_URL}"
                            alt="YouTube"
                            style="display:block; width:32px; height:32px; border:0;"
                          />
                        </a>
                      </td>
                      <td style="padding:0 14px 10px 0; vertical-align:middle;">
                        <a href="${WEBSITE_URL}" style="text-decoration:none; display:inline-block;">
                          <img
                            src="${WEBSITE_ICON_URL}"
                            alt="Website"
                            style="display:block; width:32px; height:32px; border:0;"
                          />
                        </a>
                      </td>
                      <td style="padding:0 0 10px 0; text-align:right; vertical-align:middle; width:100%;">
                        <a href="${GOOGLE_REVIEWS_URL}" style="text-decoration:none; display:inline-block;">
                          <img
                            src="${GOOGLE_REVIEWS_ICON_URL}"
                            alt="Google reviews"
                            style="display:block; width:192px; height:48px; border:0; object-fit:contain;"
                          />
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 16px; font-size:14px; line-height:1.7; color:#555555;">
              Keep your profile up to date by signing in here:
              <a href="${ADMIN_URL}" style="color:#ff6667; text-decoration:none; font-weight:700;"> admin.thesupremecollective.co.uk</a>
            </p>

            <div style="padding-top:16px; border-top:1px solid #e3e3e3;">
              <p style="margin:0 0 8px; font-size:12px; line-height:1.7; color:#777777;">
                Copyright © 2026 The Supreme Collective Ltd. All rights reserved.
              </p>
              <p style="margin:0 0 8px; font-size:12px; line-height:1.7; color:#777777;">
                Registered Office: 71-75, Shelton Street, Covent Garden, London, WC2H 9JQ, United Kingdom | Company Number: 16883956
              </p>
              <p style="margin:0; font-size:12px; line-height:1.7; color:#777777;">
                <a href="${UNSUBSCRIBE_URL}" style="color:#ff6667; text-decoration:none; font-weight:700;">Unsubscribe</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
};

const buildTextEmail = ({ musician, job, applyUrl }) => {
  const firstName = musician?.firstName || "there";
  const safeTitle = job?.title || job?.instrument || "Deputy opportunity";
  const instrument = job?.instrument || job?.title || "TBC";
  const date = formatDate(job?.eventDate || job?.date);
  const time = buildTime(job);
  const location = buildLocation(job);
  const fee = formatFee(getDeputyFeeForEmail(job), job?.currency || "GBP");
  const notes = job?.notes ? `Notes: ${job.notes}` : "";

  const WEBSITE_URL = "https://thesupremecollective.co.uk";
  const ADMIN_URL = "https://admin.thesupremecollective.co.uk";
  const INSTAGRAM_URL = "https://instagram.com/thesupremecollective";
  const YOUTUBE_URL = "https://www.youtube.com/channel/UC6HhRZA4XLVajrz5vk5vn2A";
  const GOOGLE_REVIEWS_URL =
    "https://www.google.com/search?q=the+supreme+collective&oq=the+supreme+collective&aqs=chrome.0.0i355i512j46i175i199i512j0i22i30l3j69i60j69i61l2.4878j0j7&sourceid=chrome&ie=UTF-8#lrd=0x751df2ff4f2e30d:0xb1f44d25caa515eb,1,,,";
  const UNSUBSCRIBE_URL =
    "mailto:hello@thesupremecollective.co.uk?subject=Please%20unsubscribe%20me%20from%20The%20Supreme%20Collective&body=Please%20hit%20send%20to%20unsubscribe%20from%20The%20Supreme%20Collective";

  const shareText = encodeURIComponent(
    `I thought this deputy opportunity might be a great fit for you: ${applyUrl}`,
  );
  const whatsappShareUrl = `https://wa.me/?text=${shareText}`;
  const mailtoShareUrl = `mailto:?subject=${encodeURIComponent(
    `Deputy opportunity: ${job?.title || job?.instrument || "Deputy opportunity"}`,
  )}&body=${shareText}`;
  // const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(applyUrl)}`;

  return [
    "THE SUPREME COLLECTIVE",
    "DEPUTY OPPORTUNITY",
    "",
    `Hi ${firstName},`,
    "",
    "A new deputy opportunity has just come in that may be a fit for you. Please review the details below and use the link to apply.",
    "",
    safeTitle,
    `Role: ${instrument}`,
    `Date: ${date}`,
    `Time: ${time}`,
    `Location: ${location}`,
    `Deputy fee: ${fee}`,
    notes,
    "",
    `View & apply: ${applyUrl}`,
    "",
    "Share this opportunity with someone you think would be a great fit:",
    `WhatsApp: ${whatsappShareUrl}`,
    `Email: ${mailtoShareUrl}`,
    `Copy job link: ${applyUrl}`,
    "",
    "Did you know you can also post your own deputy jobs through The Supreme Collective? You can reach a wide network of musicians and send your opportunity straight to matched players' inboxes in just a few clicks.",
    "",
    "Think your act could be a great fit for The Supreme Collective? You’re very welcome to pre-submit your act for review and, if it feels like the right match, we’ll be in touch.",
    "",
    `Update your profile: ${ADMIN_URL}`,
    `Website: ${WEBSITE_URL}`,
    `Instagram: ${INSTAGRAM_URL}`,
    `YouTube: ${YOUTUBE_URL}`,
    `Google reviews: ${GOOGLE_REVIEWS_URL}`,
    "",
    "Sent via The Supreme Collective deputy system.",
    "",
    "Best wishes,",
    "The Supreme Collective",
    "",
    "Copyright © 2026 The Supreme Collective Ltd. All rights reserved.",
    "Registered Office: 71-75, Shelton Street, Covent Garden, London, WC2H 9JQ, United Kingdom | Company Number: 16883956",
    `Unsubscribe: ${UNSUBSCRIBE_URL}`,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildJobNotificationPreview = ({
  job,
  musicians = [],
  previewRecipientEmail = "",
}) => {
  const safeTitle = normaliseString(
    job?.title || job?.instrument || "Deputy opportunity",
  );

  const safeDate = normaliseString(job?.eventDate || job?.date || "");
  const formattedSubjectDate = formatDeputyOpportunityDate(safeDate);
  const subject = formattedSubjectDate
    ? `${safeTitle} | Deputy Opportunity for ${formattedSubjectDate}`
    : `${safeTitle} | Deputy Opportunity`;

  const siteBase = "https://admin.thesupremecollective.co.uk".replace(
    /\/$/,
    "",
  );

  const applyUrl = `${siteBase}/deputy-jobs/${job?._id}`;
  const safePreviewRecipientEmail = normaliseEmail(previewRecipientEmail || "");

  const previewMusician =
    Array.isArray(musicians) && musicians.length
      ? musicians[0]
      : { firstName: "there" };

  const html = buildHtmlEmail({
    musician: previewMusician,
    job,
    applyUrl,
  });

  const text = buildTextEmail({
    musician: previewMusician,
    job,
    applyUrl,
  });

  return {
    subject: safePreviewRecipientEmail
      ? `[Preview] ${subject}`
      : subject,
    html,
    text,
    recipientCount: musicians.length,
    recipients: buildRecipientPreview(musicians),
    previewRecipientEmail: safePreviewRecipientEmail,
    applyUrl,
  };
};

const buildAllocationEmailPreview = ({ job, musician }) => {
  const name =
    [musician?.firstName, musician?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || "Deputy";
  const title = normaliseString(
    job?.title || job?.instrument || "Deputy opportunity",
  );
  const safeCurrency = normaliseCurrency(job?.currency);
  const subject = `Allocated: ${title}`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
      <h2 style="margin-bottom: 12px;">Allocation preview</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>You have been selected for <strong>${escapeHtml(title)}</strong>.</p>
      ${job?.eventDate ? `<p><strong>Date:</strong> ${escapeHtml(job.eventDate)}</p>` : ""}
      ${job?.venue || job?.locationName || job?.location ? `<p><strong>Location:</strong> ${escapeHtml(job.venue || job.locationName || job.location)}</p>` : ""}
      ${job?.fee ? `<p><strong>Fee:</strong> ${escapeHtml(`${safeCurrency} ${job.fee}`)}</p>` : ""}
      <p>This is a preview of the allocation email.</p>
    </div>
  `;
  const text = [
    `Hi ${name},`,
    `You have been selected for ${title}.`,
    job?.eventDate ? `Date: ${job.eventDate}` : "",
    job?.venue || job?.locationName || job?.location
      ? `Location: ${job.venue || job.locationName || job.location}`
      : "",
    job?.fee ? `Fee: ${safeCurrency} ${job.fee}` : "",
    "This is a preview of the allocation email.",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
};

const buildApplicantPresentedEmailPreview = ({ job, musician }) => {
  const firstName = normaliseString(musician?.firstName || "there");
  const fullName =
    [musician?.firstName, musician?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || "Deputy";

  const jobTitle = normaliseString(
    job?.title || job?.instrument || "Deputy opportunity",
  );
  const dateText = normaliseString(job?.eventDate || job?.date || "TBC");
  const location = normaliseString(
    job?.location || job?.venue || job?.locationName || "Location TBC",
  );
  const feeText = getDeputyNetFeeText(job);

  const profileUrl = musician?.musicianSlug
    ? `https://thesupremecollective.co.uk/musician/${musician.musicianSlug}`
    : musician?._id
      ? `https://thesupremecollective.co.uk/musician/${musician._id}`
      : "";

  const adminLoginUrl = "https://admin.thesupremecollective.co.uk/login";
  const dashboardUrl = "https://admin.thesupremecollective.co.uk";

  const html = `
    <div style="margin:0; padding:0; background:#f7f7f7; font-family:Arial, sans-serif; color:#111;">
      <div style="max-width:700px; margin:0 auto; padding:32px 20px;">
        <div style="background:#111; border-radius:20px 20px 0 0; padding:28px 32px; text-align:left;">
          <p style="margin:0; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#ff6667; font-weight:700;">
            The Supreme Collective
          </p>
          <h1 style="margin:12px 0 0; font-size:28px; line-height:1.2; color:#fff;">
            You’ve Been Presented for an Enquiry
          </h1>
          <p style="margin:12px 0 0; font-size:15px; line-height:1.6; color:#f3f3f3;">
            A client is considering you as a possible fit for an upcoming opportunity.
          </p>
        </div>

        <div style="background:#ffffff; border:1px solid #e8e8e8; border-top:0; border-radius:0 0 20px 20px; padding:32px;">
          <p style="margin:0 0 18px; font-size:16px; line-height:1.7; color:#333;">
            Hi ${escapeHtml(firstName)},
          </p>

          <p style="margin:0 0 18px; font-size:15px; line-height:1.7; color:#444;">
            You’ve been presented to a client as a possible fit for
            <strong>${escapeHtml(jobTitle)}</strong>.
          </p>

          <p style="margin:0 0 24px; font-size:15px; line-height:1.7; color:#444;">
            At this stage, this is an enquiry rather than a confirmed booking. Please make sure your profile is fully up to date, as the client may review it when considering their options.
          </p>

          <div style="margin-bottom:24px; padding:24px; background:#fafafa; border:1px solid #ececec; border-radius:18px;">
            <h3 style="margin:0 0 14px; font-size:16px; color:#111;">Enquiry details</h3>
            <ul style="margin:0; padding-left:20px; font-size:14px; line-height:1.8; color:#333;">
              ${renderDetailRow("Date", dateText)}
              ${renderDetailRow("Location", location)}
              ${renderDetailRow("Fee", feeText)}
            </ul>
          </div>

          <div style="margin:0 0 24px; display:flex; flex-wrap:wrap; gap:12px;">
            <a
              href="${escapeHtml(adminLoginUrl)}"
              style="display:inline-block; background:#ff6667; color:#fff; text-decoration:none; padding:14px 22px; border-radius:999px; font-size:14px; font-weight:700;"
            >
              Sign in to update profile
            </a>
</div>
          
          <div style="margin:0 0 24px; display:flex; flex-wrap:wrap; gap:12px;">

            ${
              profileUrl
                ? `<a
                    href="${escapeHtml(profileUrl)}"
                    style="display:inline-block; background:#fff; color:#111; text-decoration:none; padding:14px 22px; border-radius:999px; font-size:14px; font-weight:700; border:1px solid #dcdcdc;"
                  >
                    View public profile
                  </a>`
                : ""
            }
          </div>

          <div style="padding:18px 20px; background:#fff7f7; border:1px solid #f1d0d1; border-radius:16px; margin-bottom:20px;">
            <p style="margin:0 0 8px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#ff6667;">
              Top tip
            </p>
            <p style="margin:0; font-size:14px; line-height:1.7; color:#444;">
              Sign in to your dashboard and check that your photos, bio, genres, instruments, videos, rates, travel details, and recent performance material are all fully up to date.
            </p>
          </div>

          <p style="margin:0 0 14px; font-size:14px; line-height:1.7; color:#555;">
            We’ll be in touch if the client would like to proceed.
          </p>

          <p style="margin:0; font-size:14px; line-height:1.7; color:#555;">
            Best,<br/>The Supreme Collective
          </p>
        </div>
      </div>
    </div>
  `;

  const text = [
    `Hi ${firstName},`,
    "",
    `You’ve been presented to a client as a possible fit for ${jobTitle}.`,
    "This is currently an enquiry rather than a confirmed booking.",
    "Please make sure your profile is fully up to date, as the client may review it when considering their options.",
    "",
    `Date: ${dateText}`,
    `Location: ${location}`,
    `Fee: ${feeText}`,
    "",
    `Sign in to update your profile: ${adminLoginUrl}`,
    `Dashboard: ${dashboardUrl}`,
    profileUrl ? `Public profile: ${profileUrl}` : "",
    "",
    "We’ll be in touch if the client would like to proceed.",
    "",
    "Best,",
    "The Supreme Collective",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject: `Enquiry presentation: ${jobTitle}`,
    html,
    text,
    musicianName: fullName,
    profileUrl,
  };
};

const buildBookingConfirmationPreview = ({ job, musician }) => {
  const firstName = normaliseString(musician?.firstName || "there");
  const fullName =
    [musician?.firstName, musician?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || "Deputy";
  const jobTitle = normaliseString(
    job?.title || job?.instrument || "Deputy opportunity",
  );

  const dateText = normaliseString(job?.eventDate || job?.date || "TBC");
  const callTime = normaliseString(job?.callTime || job?.startTime || "");
  const finishTime = normaliseString(job?.finishTime || job?.endTime || "");
  const location = normaliseString(
    job?.location || job?.venue || job?.locationName || "Location TBC",
  );
  const feeText = getDeputyNetFeeText(job);

  const requiredInstruments = normaliseList(job?.requiredInstruments);
  const essentialSkills = normaliseList(job?.essentialRoles);
  const preferredExtraSkills = normaliseList(job?.desiredRoles);
  const requiredSkills = normaliseList(job?.requiredSkills);
  const secondaryInstruments = normaliseList(job?.secondaryInstruments);
  const genres = normaliseList(job?.genres);
  const tags = normaliseList(job?.tags);
  const setLengths = normaliseList(job?.setLengths);
  const whatsIncluded = normaliseList(job?.whatsIncluded);
  const claimableExpenses = normaliseList(job?.claimableExpenses);
  const notes = normaliseString(job?.notes || "");
  // Removed unused paymentDate constant

  const bandContactName = normaliseString(
    job?.createdByName || "The Supreme Collective",
  );
  const bandContactEmail = normaliseString(
    job?.createdByEmail || "hello@thesupremecollective.co.uk",
  );
  const bandContactPhone = normaliseString(job?.createdByPhone || "");

  const payout = getMusicianPayoutSummary(musician);
  const payoutSettingsUrl = getMusicianPayoutSettingsUrl(musician);

  const payoutHtml = payout.hasPayoutDetails
    ? `
    <p>
      <strong>Payment</strong><br/>
      Your net fee for this gig is <strong>${escapeHtml(feeText)}</strong>.
     Provided your Stripe payout setup remains active, payment can typically be expected
<strong>5–7 days after the gig</strong> to your connected Stripe account.
    </p>
  `
    : `
    <p>
      <strong>Payment</strong><br/>
      Your net fee for this gig is <strong>${escapeHtml(feeText)}</strong>.
      We do not currently have an active Stripe payout setup on file for you, so please complete your payout setup now to ensure payment can be processed.
      Once your Stripe payout setup is complete, payment can typically be expected <strong>5–7 days after the gig</strong>.
    </p>
    <p style="margin: 16px 0 20px;">
      <a
        href="${escapeHtml(payoutSettingsUrl)}"
        style="
          display:inline-block;
          background:#111;
          color:#fff;
          text-decoration:none;
          padding:12px 18px;
          border-radius:8px;
          font-weight:600;
        "
      >
        Update payment details
      </a>
    </p>
  `;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111; max-width: 700px;">
      <h2 style="margin-bottom: 12px;">Booking confirmed</h2>

      <p>Hi ${escapeHtml(firstName)},</p>

      <p>
        Thank you for confirming your availability for <strong>${escapeHtml(jobTitle)}</strong> —
        please consider yourself booked.
      </p>

      <p>
        We’ve let the band know that you’ve accepted the booking. Their contact details are below,
        so you can get in touch directly regarding final timings, setlist details, logistics,
        arrival information, and anything else needed to ensure a smooth and successful performance.
      </p>

      <h3 style="margin: 24px 0 10px;">Gig details</h3>
      <ul style="padding-left: 20px; margin: 0 0 18px;">
        ${renderDetailRow("Date", dateText)}
        ${renderDetailRow("Call time", callTime)}
        ${renderDetailRow("Finish time", finishTime)}
        ${renderDetailRow("Location", location)}
${renderDetailRow("Net fee", feeText)}        ${renderDetailListRow("Required instruments", requiredInstruments)}
        ${renderDetailListRow("Essential skills", essentialSkills)}
        ${renderDetailListRow("Required skills", requiredSkills)}
        ${renderDetailListRow("Preferred extra skills", preferredExtraSkills)}
        ${renderDetailListRow("Secondary instruments", secondaryInstruments)}
        ${renderDetailListRow("Genres", genres)}
        ${renderDetailListRow("Tags", tags)}
        ${renderDetailListRow("Set lengths", setLengths)}
        ${renderDetailListRow("What's included", whatsIncluded)}
        ${renderDetailListRow("Claimable expenses", claimableExpenses)}
        ${renderDetailRow("Notes", notes)}
      </ul>

      ${payoutHtml}

      <h3 style="margin: 24px 0 10px;">Band contact details</h3>
      <ul style="padding-left: 20px; margin: 0 0 18px;">
        ${renderDetailRow("Name", bandContactName)}
        ${renderDetailRow("Email", bandContactEmail)}
        ${renderDetailRow("Phone", bandContactPhone)}
      </ul>

      <p>
        If you have any problems getting hold of the band, or anything changes, just reply to this
        email and we’ll be happy to help.
      </p>

      <p>
        Best,<br/>
        The Supreme Collective
      </p>
    </div>
  `;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Thank you for confirming your availability for ${jobTitle} — please consider yourself booked.`,
    ``,
    `Gig details:`,
    `Date: ${dateText || "TBC"}`,
    callTime ? `Call time: ${callTime}` : "",
    finishTime ? `Finish time: ${finishTime}` : "",
    `Location: ${location || "TBC"}`,
    `Net fee: ${feeText}`,
    requiredInstruments.length
      ? `Required instruments: ${requiredInstruments.join(", ")}`
      : "",
    essentialSkills.length
      ? `Essential skills: ${essentialSkills.join(", ")}`
      : "",
    requiredSkills.length
      ? `Required skills: ${requiredSkills.join(", ")}`
      : "",
    preferredExtraSkills.length
      ? `Preferred extra skills: ${preferredExtraSkills.join(", ")}`
      : "",
    secondaryInstruments.length
      ? `Secondary instruments: ${secondaryInstruments.join(", ")}`
      : "",
    genres.length ? `Genres: ${genres.join(", ")}` : "",
    tags.length ? `Tags: ${tags.join(", ")}` : "",
    setLengths.length ? `Set lengths: ${setLengths.join(", ")}` : "",
    whatsIncluded.length ? `What's included: ${whatsIncluded.join(", ")}` : "",
    claimableExpenses.length
      ? `Claimable expenses: ${claimableExpenses.join(", ")}`
      : "",
    notes ? `Notes: ${notes}` : "",
    ``,
    payout.hasPayoutDetails
      ? `Your net fee for this gig is ${feeText}. Provided your Stripe payout setup remains active, payment can typically be expected 5–7 days after the gig to your connected Stripe account.`
      : `Your net fee for this gig is ${feeText}. We do not currently have an active Stripe payout setup on file for you, so please complete your payout setup now to ensure payment can be processed. Once your Stripe payout setup is complete, payment can typically be expected 5–7 days after the gig: ${payoutSettingsUrl}`,
    `Band contact details:`,
    `Name: ${bandContactName}`,
    `Email: ${bandContactEmail}`,
    bandContactPhone ? `Phone: ${bandContactPhone}` : "",
    ``,
    `Best,`,
    `The Supreme Collective`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject: `Booking confirmed: ${jobTitle}`,
    html,
    text,
    musicianName: fullName,
  };
};

const buildJobPayloadFromRequest = (req) => {
  const {
    title = "",
    date = "",
    eventDate = "",
    callTime = "",
    startTime = "",
    finishTime = "",
    endTime = "",
    venue = "",
    locationName = "",
    location = "",
    county = "",
    postcode = "",
    instrument = "",
    requiredInstruments = [],
    isVocalSlot = false,
    genres = [],
    tags = [],
    essentialRoles = [],
    requiredSkills = [],
    desiredRoles = [],
    secondaryInstruments = [],
    setLengths = [],
    whatsIncluded = [],
    whatsIncludedOther = "",
    claimableExpenses = [],
    claimableExpensesOther = "",
    fee = 0,
    currency = "GBP",
    notes = "",
    clientName = "",
    clientEmail = "",
    clientPhone = "",
    grossAmount = 0,
    commissionAmount = 0,
    deputyNetAmount = 0,
    stripeFeeAmount = null,
    deductStripeFeesFromDeputy = true,
    releaseOn = null,
    saveClientCard = true,
    mode = "send",
    jobType = "booked",
  } = req.body || {};

  const requestedJobType =
    normaliseString(jobType).toLowerCase() === "enquiry" ? "enquiry" : "booked";

  const resolvedInstruments = normaliseArray(requiredInstruments);
  const resolvedEssentialRoles = normaliseArray(essentialRoles);
  const resolvedRequiredSkills = normaliseArray(requiredSkills);
  const resolvedDesiredRoles = normaliseArray(desiredRoles);
  const resolvedSecondaryInstruments = normaliseArray(secondaryInstruments);
  const resolvedGenres = normaliseArray(genres);
  const resolvedTags = normaliseArray(tags);
  const resolvedSetLengths = normaliseStringArray(setLengths);
  const resolvedWhatsIncluded = normaliseStringArray(whatsIncluded);
  const resolvedClaimableExpenses = normaliseStringArray(claimableExpenses);

  const primaryInstrument =
    normaliseString(instrument) || resolvedInstruments[0] || "";

  const effectiveIsVocalSlot =
    isVocalSlot === true ||
    isVocalSlot === "true" ||
    /vocal|singer|rapper|rap|mc/i.test(primaryInstrument);

  const matcherDesiredRoles = Array.from(
    new Set([...resolvedRequiredSkills, ...resolvedDesiredRoles]),
  );

  const resolvedEventDate = normaliseString(eventDate || date);
  const resolvedStartTime = normaliseString(startTime || callTime);
  const resolvedEndTime = normaliseString(endTime || finishTime);
  const resolvedLocationName = normaliseString(locationName || venue);
  const resolvedLocation = normaliseString(location || locationName || venue);

  const inferredCounty =
    normaliseString(county) ||
    (() => {
      const parts = resolvedLocation
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      return parts.length >= 2 ? parts[parts.length - 1] : "";
    })();

  const inferredPostcode =
    normaliseString(postcode) ||
    (() => {
      const match = resolvedLocation.match(
        /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i,
      );
      return match ? match[1].toUpperCase() : "";
    })();

  return {
    title: normaliseString(title),
    primaryInstrument,
    effectiveIsVocalSlot,
    resolvedInstruments,
    resolvedEssentialRoles,
    resolvedRequiredSkills,
    matcherDesiredRoles,
    resolvedSecondaryInstruments,
    resolvedGenres,
    resolvedTags,
    resolvedSetLengths,
    resolvedWhatsIncluded,
    resolvedClaimableExpenses,
    whatsIncludedOther: normaliseString(whatsIncludedOther),
    claimableExpensesOther: normaliseString(claimableExpensesOther),
    resolvedEventDate,
    resolvedStartTime,
    resolvedEndTime,
    resolvedLocationName,
    resolvedLocation,
    inferredCounty,
    inferredPostcode,
    fee: Number(fee) || 0,
    currency: normaliseCurrency(currency),
    notes: normaliseString(notes),
    clientName: normaliseString(clientName),
    clientEmail: normaliseEmail(clientEmail),
    clientPhone: normaliseString(clientPhone),
    saveClientCard: normaliseBoolean(saveClientCard),
    ...buildLedgerAmounts({
      fee,
      grossAmount,
      commissionAmount,
      deputyNetAmount,
      stripeFeeAmount,
      deductStripeFeesFromDeputy: normaliseBoolean(deductStripeFeesFromDeputy),
    }),
    releaseOn: parseDateOrNull(releaseOn),
    mode:
      normaliseString(mode || "send").toLowerCase() === "preview"
        ? "preview"
        : "send",
    jobType: requestedJobType,
  };
};
const MATCH_LIMIT_SEND = undefined;
const MATCH_LIMIT_PREVIEW = undefined;

const runMatcherForJob = async ({
  job,
  previewRecipientEmail,
  createdBy,
  primaryInstrument,
  effectiveIsVocalSlot,
  resolvedEssentialRoles,
  matcherDesiredRoles,
  resolvedSecondaryInstruments,
  resolvedGenres,
  resolvedTags,
  inferredCounty,
  inferredPostcode,
  mode = "send",
}) => {
  const effectiveLimit =
    mode === "preview" ? MATCH_LIMIT_PREVIEW : MATCH_LIMIT_SEND;

  const matches = await findMatchingMusiciansForDeputyJob({
    instrument: primaryInstrument,
    isVocalSlot: effectiveIsVocalSlot,
    essentialRoles: resolvedEssentialRoles,
    desiredRoles: matcherDesiredRoles,
    secondaryInstruments: resolvedSecondaryInstruments,
    genres: resolvedGenres.length ? resolvedGenres : resolvedTags,
    county: inferredCounty,
    postcode: inferredPostcode,
    excludeIds: createdBy ? [String(createdBy)] : [],
  });

  const limitedMatches =
    typeof effectiveLimit === "number" && effectiveLimit > 0
      ? matches.slice(0, effectiveLimit)
      : matches;

  const matchedMusicianIds = limitedMatches
    .map((m) => m?._id || m?.id)
    .filter(Boolean);

  const matchedMusicians = limitedMatches.map(buildMatchSnapshot);

  const previewNotification = buildJobNotificationPreview({
    job,
    musicians: limitedMatches,
    previewRecipientEmail,
  });

  return {
    matches: limitedMatches,
    matchedMusicianIds,
    matchedMusicians,
    previewNotification,
  };
};

const getMatchedMusiciansForJob = async (job) => {
  const ids = Array.isArray(job?.matchedMusicianIds)
    ? job.matchedMusicianIds
    : [];

  if (ids.length) {
    return musicianModel
      .find(
        { _id: { $in: ids } },
        "firstName lastName email phone phoneNumber musicianSlug profilePhoto profilePicture profileImage profilePic profile_picture additionalImages",
      )
      .lean();
  }

  const matches = await findMatchingMusiciansForDeputyJob({
    instrument: job?.instrument || job?.requiredInstruments?.[0] || "",
    isVocalSlot: Boolean(job?.isVocalSlot),
    essentialRoles: Array.isArray(job?.essentialRoles)
      ? job.essentialRoles
      : [],
    desiredRoles: Array.isArray(job?.desiredRoles) ? job.desiredRoles : [],
    secondaryInstruments: Array.isArray(job?.secondaryInstruments)
      ? job.secondaryInstruments
      : [],
    genres:
      Array.isArray(job?.genres) && job.genres.length
        ? job.genres
        : job?.tags || [],
    county: job?.county || "",
    postcode: job?.postcode || "",
    excludeIds: job?.createdBy ? [String(job.createdBy)] : [],
  });

  job.matchedMusicianIds = matches.map((m) => m?._id || m?.id).filter(Boolean);

  job.matchedMusicians = matches.map(buildMatchSnapshot);
  job.matchedCount = matches.length;

  return matches;
};

const findApplicationFromJob = (job, musicianId) => {
  const targetId = asObjectIdString(musicianId);
  if (!targetId) return null;

  return (
    (Array.isArray(job?.applications) ? job.applications : []).find(
      (application) => asObjectIdString(application?.musicianId) === targetId,
    ) || null
  );
};

const hydrateMusicianFromApplication = async (application = {}) => {
  const applicationMusicianId = asObjectIdString(application?.musicianId);

  if (applicationMusicianId) {
    const musicianDoc = await musicianModel
      .findById(applicationMusicianId)
      .lean();
    if (musicianDoc) return musicianDoc;
  }

  return {
    _id: application?.musicianId || null,
    firstName: application?.firstName || "",
    lastName: application?.lastName || "",
    email: application?.email || "",
    phone: application?.phone || "",
    phoneNumber: application?.phone || "",
    musicianSlug: application?.musicianSlug || "",
    profilePhoto: application?.profileImage || "",
    profilePicture: application?.profileImage || "",
    profileImage: application?.profileImage || "",
    profilePic: application?.profileImage || "",
    profile_picture: application?.profileImage || "",
  };
};

const findMatchedMusicianFromJob = async (job, musicianId) => {
  const targetId = asObjectIdString(musicianId);
  if (!targetId) return null;

  const application = findApplicationFromJob(job, targetId);
  if (application) {
    return hydrateMusicianFromApplication(application);
  }

  const matchedMusicians = await getMatchedMusiciansForJob(job);
  const matchedMusician = matchedMusicians.find(
    (m) => asObjectIdString(m?._id) === targetId,
  );

  if (matchedMusician) return matchedMusician;

  return musicianModel.findById(targetId).lean();
};

const canManuallyAllocateDeputyJob = (req) => {
  const email = normaliseEmail(req?.user?.email || req?.user?.useremail || "");
  const role = normaliseString(
    req?.user?.role || req?.user?.userrole || "",
  ).toLowerCase();

  return (
    email === "hello@thesupremecollective.co.uk" ||
    role === "admin" ||
    role === "agent"
  );
};

const upsertManualApplicationForAllocation = ({ job, musician, now }) => {
  const targetId = asObjectIdString(musician?._id);
  if (!targetId) return;

  const existingApplications = Array.isArray(job.applications)
    ? job.applications
    : [];
  const existingIndex = existingApplications.findIndex(
    (application) => asObjectIdString(application?.musicianId) === targetId,
  );

  const baseApplication = {
    musicianId: musician._id,
    firstName:
      musician?.firstName ||
      musician?.firstname ||
      musician?.basicInfo?.firstName ||
      "",
    lastName:
      musician?.lastName ||
      musician?.lastname ||
      musician?.basicInfo?.lastName ||
      "",
    email: musician?.email || musician?.basicInfo?.email || "",
    phone:
      musician?.phone ||
      musician?.phoneNumber ||
      musician?.basicInfo?.phone ||
      "",
    musicianSlug: musician?.musicianSlug || "",
    profileImage:
      musician?.profilePhoto ||
      musician?.profilePicture ||
      musician?.profileImage ||
      musician?.profilePic ||
      musician?.profile_picture ||
      "",
    postcode: musician?.address?.postcode || musician?.postcode || "",
    status: "allocated",
    notes: "",
    deputyMatchScore: 0,
    matchSummary: {
      instrument: job?.instrument || "",
      roleFit: 0,
      genreFit: 0,
      locationFit: 0,
      songFit: 0,
    },
    appliedAt: now,
    shortlistedAt: null,
    allocatedAt: now,
    bookedAt: null,
    declinedAt: null,
    withdrawnAt: null,
    phoneNormalized: toE164(
      musician?.phone ||
        musician?.phoneNumber ||
        musician?.basicInfo?.phone ||
        "",
    ),
  };

  if (existingIndex === -1) {
    job.applications = [...existingApplications, baseApplication];
  } else {
    job.applications = existingApplications.map((application, index) => {
      if (index !== existingIndex) return application;

      return {
        ...application,
        ...baseApplication,
        appliedAt: application?.appliedAt || now,
      };
    });
  }

  job.applicationCount = Array.isArray(job.applications)
    ? job.applications.length
    : 0;
};

const upsertPresentedApplicationForEnquiry = ({ job, musician, now }) => {
  const targetId = asObjectIdString(musician?._id);
  if (!targetId) return;

  const existingApplications = Array.isArray(job.applications)
    ? job.applications
    : [];

  const existingIndex = existingApplications.findIndex(
    (application) => asObjectIdString(application?.musicianId) === targetId,
  );

  const baseApplication = {
    musicianId: musician._id,
    firstName:
      musician?.firstName ||
      musician?.firstname ||
      musician?.basicInfo?.firstName ||
      "",
    lastName:
      musician?.lastName ||
      musician?.lastname ||
      musician?.basicInfo?.lastName ||
      "",
    email: musician?.email || musician?.basicInfo?.email || "",
    phone:
      musician?.phone ||
      musician?.phoneNumber ||
      musician?.basicInfo?.phone ||
      "",
    musicianSlug: musician?.musicianSlug || "",
    profileImage:
      musician?.profilePhoto ||
      musician?.profilePicture ||
      musician?.profileImage ||
      musician?.profilePic ||
      musician?.profile_picture ||
      "",
    postcode: musician?.address?.postcode || musician?.postcode || "",
    status: "presented",
    notes: "",
    deputyMatchScore: 0,
    matchSummary: {
      instrument: job?.instrument || "",
      roleFit: 0,
      genreFit: 0,
      locationFit: 0,
      songFit: 0,
    },
    appliedAt: now,
    shortlistedAt: null,
    presentedAt: now,
    allocatedAt: null,
    bookedAt: null,
    declinedAt: null,
    withdrawnAt: null,
    phoneNormalized: toE164(
      musician?.phone ||
        musician?.phoneNumber ||
        musician?.basicInfo?.phone ||
        "",
    ),
  };

  if (existingIndex === -1) {
    job.applications = [...existingApplications, baseApplication];
  } else {
    job.applications = existingApplications.map((application, index) => {
      if (index !== existingIndex) return application;

      return {
        ...application,
        ...baseApplication,
        appliedAt: application?.appliedAt || now,
      };
    });
  }

  job.applicationCount = Array.isArray(job.applications)
    ? job.applications.length
    : 0;
};

const buildDeputyReplyCode = (jobId, musicianId, action) => {
  const safeJobId = normaliseString(jobId);
  const safeMusicianId = normaliseString(musicianId);
  const safeAction = normaliseString(action).toUpperCase();
  return `${safeAction}_DEPUTY_${safeJobId}_${safeMusicianId}`;
};

const parseDeputyReplyCode = (raw = "") => {
  const value = normaliseString(raw);
  const match = value.match(/^(ACCEPT|DECLINE)_DEPUTY_([^_]+)_(.+)$/i);

  if (!match) {
    return {
      action: "",
      jobId: "",
      musicianId: "",
    };
  }

  return {
    action: normaliseString(match[1]).toLowerCase(),
    jobId: normaliseString(match[2]),
    musicianId: normaliseString(match[3]),
  };
};

const findApplicationByAnyIdentity = (
  job,
  { musicianId = "", phone = "", email = "" } = {},
) => {
  const safeMusicianId = asObjectIdString(musicianId);
  const safePhone = toE164(phone);
  const safeEmail = normaliseEmail(email);

  return (
    (Array.isArray(job?.applications) ? job.applications : []).find(
      (application) => {
        const applicationMusicianId = asObjectIdString(application?.musicianId);
        const applicationPhone = toE164(
          application?.phone || application?.phoneNormalized || "",
        );
        const applicationEmail = normaliseEmail(application?.email || "");

        if (safeMusicianId && applicationMusicianId === safeMusicianId)
          return true;
        if (safePhone && applicationPhone === safePhone) return true;
        if (safeEmail && applicationEmail && applicationEmail === safeEmail)
          return true;
        return false;
      },
    ) || null
  );
};

const applyBookedStateToJob = (job, musician) => {
  const now = new Date();
  const safeMusicianId = asObjectIdString(
    musician?._id || musician?.musicianId,
  );
  const fullName = [musician?.firstName, musician?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  job.status = "filled";
  job.workflowStage = "booking_confirmed";
  job.bookedMusicianId = musician?._id || musician?.musicianId || null;
  job.bookedMusicianName = fullName;
  job.bookingConfirmedAt = now;

  job.applications = (job.applications || []).map((application) => {
    const sameMusician =
      asObjectIdString(application?.musicianId) === safeMusicianId;

    return {
      ...application,
      status: sameMusician ? "booked" : application.status,
      bookedAt: sameMusician ? now : application.bookedAt || null,
    };
  });

  return now;
};

const findDeputyApplicationByPhone = (job, phone = "") => {
  const applications = Array.isArray(job?.applications) ? job.applications : [];
  return (
    applications.find((application) =>
      phonesMatch(application?.phone, phone),
    ) || null
  );
};

const findDeputyJobFromInboundReply = async ({
  jobId = "",
  repliedSid = "",
  fromRaw = "",
}) => {
  if (jobId) {
    const byId = await deputyJobModel.findById(jobId);
    if (byId) return byId;
  }

  if (repliedSid) {
    const bySid = await deputyJobModel.findOne({
      "notifications.providerMessageId": repliedSid,
    });
    if (bySid) return bySid;
  }

  if (fromRaw) {
    const recentAllocatedJobs = await deputyJobModel
      .find({
        status: { $in: ["allocated", "open"] },
        allocatedAt: { $ne: null },
      })
      .sort({ allocatedAt: -1, updatedAt: -1 })
      .limit(50);

    const matchedJob = recentAllocatedJobs.find((candidateJob) => {
      const allocatedApplication = findDeputyApplicationByPhone(
        candidateJob,
        fromRaw,
      );
      if (allocatedApplication) return true;

      return (
        Array.isArray(candidateJob.notifications)
          ? candidateJob.notifications
          : []
      ).some(
        (notification) =>
          notification?.channel === "whatsapp" &&
          phonesMatch(notification?.phone, fromRaw),
      );
    });

    if (matchedJob) return matchedJob;
  }

  return null;
};

export const previewDeputyJob = async (req, res) => {
  try {
    req.body = { ...(req.body || {}), mode: "preview" };
    return createDeputyJob(req, res);
  } catch (error) {
    console.error("❌ previewDeputyJob error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to preview deputy job",
      error: error.message,
    });
  }
};

export const createDeputyJob = async (req, res) => {
  try {
    const built = buildJobPayloadFromRequest(req);

    const userEmail = normaliseEmail(
      req.user?.email || req.user?.useremail || "",
    );
    const userRole = normaliseString(
      req.user?.role || req.user?.userrole || "",
    ).toLowerCase();

    const canCreateEnquiryPost =
      userEmail === "hello@thesupremecollective.co.uk" ||
      userRole === "admin" ||
      userRole === "agent";

    if (built.jobType === "enquiry" && !canCreateEnquiryPost) {
      return res.status(403).json({
        success: false,
        message: "Only admins and agents can create enquiry deputy posts",
      });
    }

    if (!built.primaryInstrument) {
      return res.status(400).json({
        success: false,
        message: "At least one required instrument or role is required",
      });
    }

    const createdBy = req.user?._id || null;
    const createdByName =
      `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim();
    const createdByEmail = req.user?.email || "";
    const createdByPhone = req.user?.phone || req.user?.phoneNumber || "";

    const job = await deputyJobModel.create({
      title: built.title,
      instrument: built.primaryInstrument,
      requiredInstruments: built.resolvedInstruments,
      isVocalSlot: built.effectiveIsVocalSlot,
      date: built.resolvedEventDate,
      eventDate: built.resolvedEventDate,
      callTime: built.resolvedStartTime,
      startTime: built.resolvedStartTime,
      finishTime: built.resolvedEndTime,
      endTime: built.resolvedEndTime,
      venue: built.resolvedLocationName,
      locationName: built.resolvedLocationName,
      location: built.resolvedLocation,
      county: built.inferredCounty,
      postcode: built.inferredPostcode,
      genres: built.resolvedGenres.length
        ? built.resolvedGenres
        : built.resolvedTags,
      tags: built.resolvedTags,
      essentialRoles: built.resolvedEssentialRoles,
      requiredSkills: built.resolvedRequiredSkills,
      desiredRoles: built.matcherDesiredRoles,
      secondaryInstruments: built.resolvedSecondaryInstruments,
      setLengths: built.resolvedSetLengths,
      whatsIncluded: built.resolvedWhatsIncluded,
      whatsIncludedOther: built.whatsIncludedOther,
      claimableExpenses: built.resolvedClaimableExpenses,
      claimableExpensesOther: built.claimableExpensesOther,
      fee: built.fee,
      currency: built.currency,
      notes: built.notes,
      clientName: built.clientName,
      clientEmail: built.clientEmail,
      clientPhone: built.clientPhone,
      grossAmount: built.grossAmount,
      commissionAmount: built.commissionAmount,
      deputyNetAmount: built.deputyNetAmount,
      stripeFeeAmount: built.stripeFeeAmount,
      releaseOn:
        built.releaseOn || buildDefaultReleaseOn(built.resolvedEventDate),
      paymentStatus:
        built.jobType === "enquiry"
          ? "not_required"
          : built.saveClientCard && built.clientEmail
            ? "setup_required"
            : "not_started",
      payoutStatus: "not_ready",
      createdBy,
      createdByName,
      createdByEmail,
      createdByPhone,
      status: built.mode === "send" ? "open" : "preview",
      previewMode: built.mode !== "send",
      workflowStage: built.mode === "send" ? "created" : "preview_ready",
      jobType: built.jobType,
      isEnquiryOnly: built.jobType === "enquiry",
    });

    let setupIntentResult = null;

    if (
      built.jobType !== "enquiry" &&
      built.saveClientCard &&
      built.clientEmail &&
      stripe
    ) {
      try {
        setupIntentResult = await createOrRefreshDeputyJobSetupIntentInternal({
          job,
          clientName: built.clientName,
          clientEmail: built.clientEmail,
          clientPhone: built.clientPhone,
          createdBy,
        });
      } catch (setupIntentError) {
        console.error(
          "❌ createDeputyJob setup intent error:",
          setupIntentError,
        );
        job.paymentStatus = "setup_required";
      }
    }

    const matcherResult = await runMatcherForJob({
      job,
      previewRecipientEmail: built.clientEmail || createdByEmail,
      createdBy,
      primaryInstrument: built.primaryInstrument,
      effectiveIsVocalSlot: built.effectiveIsVocalSlot,
      resolvedEssentialRoles: built.resolvedEssentialRoles,
      matcherDesiredRoles: built.matcherDesiredRoles,
      resolvedSecondaryInstruments: built.resolvedSecondaryInstruments,
      resolvedGenres: built.resolvedGenres,
      resolvedTags: built.resolvedTags,
      inferredCounty: built.inferredCounty,
      inferredPostcode: built.inferredPostcode,
      mode: built.mode,
    });

    console.log("🎯 createDeputyJob matcher result", {
      mode: built.mode,
      primaryInstrument: built.primaryInstrument,
      isVocalSlot: built.effectiveIsVocalSlot,
      county: built.inferredCounty,
      postcode: built.inferredPostcode,
      genres: built.resolvedGenres,
      essentialRoles: built.resolvedEssentialRoles,
      desiredRoles: built.matcherDesiredRoles,
      secondaryInstruments: built.resolvedSecondaryInstruments,
      matchedCount: matcherResult.matches.length,
      firstMatches: matcherResult.matches.slice(0, 5).map((m) => ({
        id: m._id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        deputyMatchScore: m.deputyMatchScore,
        matchPct: m.matchPct,
      })),
    });

    job.matchedMusicianIds = matcherResult.matchedMusicianIds;
    job.matchedMusicians = matcherResult.matchedMusicians;
    job.matchedCount = matcherResult.matches.length;
    job.notifications = [];

    const isEnquiryJob = built.jobType === "enquiry";

    const hasSavedCardDetails =
      isEnquiryJob ||
      (Boolean(normaliseString(job?.stripeCustomerId)) &&
        Boolean(normaliseString(job?.defaultPaymentMethodId)) &&
        job?.paymentStatus === "ready_to_charge");

    if (built.mode === "send" && hasSavedCardDetails) {
      const notificationResults = await notifyMusiciansAboutDeputyJob({
        job,
        musicians: matcherResult.matches,
      });

      console.log("notificationResults:", notificationResults);

      console.log(
        "matched musician emails:",
        matcherResult.matches.map((m) => ({
          id: m._id,
          email: m.email,
          firstName: m.firstName,
          lastName: m.lastName,
        })),
      );

      const sentIds = notificationResults
        .filter((r) => r.status === "sent" && r.musicianId)
        .map((r) => r.musicianId);

      job.notifiedMusicianIds = sentIds;
      job.notifications = notificationResults;
      job.notifiedCount = notificationResults.filter(
        (r) => r.status === "sent",
      ).length;
      job.status = "open";
      job.previewMode = false;
      job.workflowStage = "sent_to_matches";
      job.matchedMusicians = job.matchedMusicians.map((m) => ({
        ...m,
        notified: sentIds.some(
          (id) => asObjectIdString(id) === asObjectIdString(m.musicianId),
        ),
        notifiedAt: sentIds.some(
          (id) => asObjectIdString(id) === asObjectIdString(m.musicianId),
        )
          ? new Date()
          : null,
      }));
    } else if (built.mode === "send") {
      job.notifiedMusicianIds = [];
      job.notifiedCount = 0;
      job.status = "open";
      job.previewMode = false;
      job.workflowStage = "created";
      job.notifications = [];
    } else {
      job.notifiedMusicianIds = [];
      job.notifiedCount = 0;
      job.status = "preview";
      job.previewMode = true;
      job.workflowStage = "preview_ready";

      job.notifications = matcherResult.previewNotification.recipients.map(
        (recipient) => ({
          musicianId: recipient.musicianId,
          email: recipient.email,
          phone: recipient.phone || "",
          channel: "email",
          type: "job_created_preview",
          subject: matcherResult.previewNotification.subject,
          previewHtml: matcherResult.previewNotification.html,
          previewText: matcherResult.previewNotification.text,
          status: "preview",
          sentAt: new Date(),
        }),
      );

      const previewRecipientEmail = normaliseEmail(
        built.clientEmail || createdByEmail || "",
      );

      if (previewRecipientEmail) {
        job.notifications.unshift({
          musicianId: null,
          email: previewRecipientEmail,
          phone: "",
          channel: "email",
          type: "job_created_preview",
          subject: `[Preview] ${matcherResult.previewNotification.subject}`,
          previewHtml: matcherResult.previewNotification.html,
          previewText: matcherResult.previewNotification.text,
          status: "sent",
          sentAt: new Date(),
          error: "",
        });

        try {
          await sendEmail({
            to: previewRecipientEmail,
            bcc: DEPUTY_JOB_BCC_EMAIL,
            subject: `[Preview] ${matcherResult.previewNotification.subject}`,
            html: matcherResult.previewNotification.html,
            text: matcherResult.previewNotification.text,
          });
        } catch (previewEmailError) {
          console.error(
            "❌ Failed to send deputy job preview email:",
            previewEmailError,
          );
        }
      }
    }

    await job.save();

    const formattedJob = withDeputyJobAliases(job);

    return res.status(201).json({
      success: true,
      message:
        built.mode === "send"
          ? hasSavedCardDetails
            ? "Deputy job created and notifications sent"
            : "Deputy job created. Add your card details to notify matches"
          : "Deputy job created in preview mode",
      mode: built.mode,
      job: formattedJob,
      matchedCount: job.matchedCount,
      notifiedCount: job.notifiedCount,
      previewNotification: matcherResult.previewNotification,
      matchedMusicians: matcherResult.matches,
      payment: setupIntentResult
        ? {
            clientSecret: setupIntentResult.clientSecret,
            setupIntentId: setupIntentResult.setupIntentId,
            stripeCustomerId: setupIntentResult.stripeCustomerId,
            paymentStatus: setupIntentResult.paymentStatus,
          }
        : null,
    });
  } catch (error) {
    console.error("❌ createDeputyJob error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create deputy job",
      error: error.message,
    });
  }
};

export const listDeputyJobs = async (req, res) => {
  try {
    const jobs = await deputyJobModel
      .find({})
      .sort({ createdAt: -1 })
      .select([
        "title",
        "date",
        "eventDate",
        "callTime",
        "startTime",
        "finishTime",
        "endTime",
        "venue",
        "locationName",
        "location",
        "county",
        "postcode",
        "requiredInstruments",
        "requiredSkills",
        "tags",
        "fee",
        "currency",
        "grossAmount",
        "commissionAmount",
        "deputyNetAmount",
        "paymentStatus",
        "payoutStatus",
        "releaseOn",
        "chargedAt",
        "defaultPaymentMethodId",
        "stripeCustomerId",
        "status",
        "jobType",
        "createdBy",
        "createdByEmail",
        "createdByName",
        "allocatedMusicianId",
        "allocatedMusicianName",
        "bookedMusicianId",
        "bookedMusicianName",
        "applicationCount",
        "matchedCount",
        "updatedAt",
        "createdAt",
        // optionally: "applications" ONLY if you truly need it in the list panel
      ].join(" "))
      .populate("allocatedMusicianId", "firstName lastName email musicianSlug profilePhoto profilePicture")
      .populate("bookedMusicianId", "firstName lastName email musicianSlug profilePhoto profilePicture")
      .lean();

    res.json({ success: true, jobs: jobs.map(withDeputyJobAliases) });
  } catch (error) {
    console.error("❌ listDeputyJobs error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch deputy jobs" });
  }
};

export const getDeputyJobById = async (req, res) => {
  try {
    const job = await deputyJobModel
      .findById(req.params.id)
      .select([
        "title",
        "instrument",
        "requiredInstruments",
        "isVocalSlot",
        "date",
        "eventDate",
        "callTime",
        "startTime",
        "finishTime",
        "endTime",
        "venue",
        "locationName",
        "location",
        "county",
        "postcode",
        "genres",
        "tags",
        "essentialRoles",
        "requiredSkills",
        "desiredRoles",
        "secondaryInstruments",
        "setLengths",
        "whatsIncluded",
        "whatsIncludedOther",
        "claimableExpenses",
        "claimableExpensesOther",
        "fee",
        "currency",
        "grossAmount",
        "commissionAmount",
        "deputyNetAmount",
        "stripeFeeAmount",
        "notes",
        "clientName",
        "clientEmail",
        "clientPhone",
        "paymentStatus",
        "payoutStatus",
        "releaseOn",
        "chargedAt",
        "payoutScheduledAt",
        "payoutPaidAt",
        "paymentFailureReason",
        "status",
        "workflowStage",
        "jobType",
        "isEnquiryOnly",
        "previewMode",
        "createdBy",
        "createdByName",
        "createdByEmail",
        "createdByPhone",
        "matchedCount",
        "notifiedCount",
        "applicationCount",
        "allocatedMusicianId",
        "allocatedMusicianName",
        "allocatedAt",
        "bookedMusicianId",
        "bookedMusicianName",
        "bookingConfirmedAt",
        "createdAt",
        "updatedAt",
      ].join(" "))
      .populate(
        "allocatedMusicianId",
        "firstName lastName email musicianSlug profilePhoto profilePicture",
      )
      .populate(
        "bookedMusicianId",
        "firstName lastName email musicianSlug profilePhoto profilePicture",
      )
      .lean();

    if (!job) {
      return res
        .status(404)
        .json({ success: false, message: "Deputy job not found" });
    }

    return res.json({ success: true, job: withDeputyJobAliases(job) });
  } catch (error) {
    console.error("❌ getDeputyJobById error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch deputy job" });
  }
};

export const getDeputyJobApplications = async (req, res) => {
  try {
    const job = await deputyJobModel
      .findById(req.params.id)
      .select([
        "title",
        "instrument",
        "status",
        "workflowStage",
        "jobType",
        "eventDate",
        "date",
        "callTime",
        "startTime",
        "finishTime",
        "endTime",
        "venue",
        "locationName",
        "location",
        "county",
        "postcode",
        "createdBy",
        "createdByName",
        "createdByEmail",
        "managerEmail",
        "applicationCount",
        "applications",
        "allocatedMusicianId",
        "allocatedMusicianName",
        "allocatedAt",
        "bookedMusicianId",
        "bookedMusicianName",
        "bookingConfirmedAt",
        "updatedAt",
        "createdAt",
      ].join(" "))
      .lean();

    if (!job) {
      return res
        .status(404)
        .json({ success: false, message: "Deputy job not found" });
    }

    const requesterEmail = normaliseEmail(
      req?.user?.email || req?.user?.useremail || "",
    );
    const requesterRole = normaliseString(
      req?.user?.role || req?.user?.userrole || "",
    ).toLowerCase();

    const isPrivilegedViewer =
      requesterEmail === "hello@thesupremecollective.co.uk" ||
      requesterRole === "admin" ||
      requesterRole === "agent";

    const isJobManager = Boolean(
      requesterEmail &&
        [
          normaliseEmail(job?.createdByEmail || ""),
          normaliseEmail(job?.managerEmail || ""),
        ].includes(requesterEmail),
    );

    if (!isPrivilegedViewer && !isJobManager) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view these applications",
      });
    }

    const applications = Array.isArray(job?.applications) ? job.applications : [];

    const sanitizedApplications = applications.map((application) => {
      const firstName = normaliseString(application?.firstName || "");
      const lastName = normaliseString(application?.lastName || "");
      const lastInitial = lastName ? `${lastName.charAt(0).toUpperCase()}.` : "";

      return {
        musicianId: application?.musicianId || null,
        firstName,
        lastName: isPrivilegedViewer ? lastName : lastInitial,
        fullName: isPrivilegedViewer
          ? [firstName, lastName].filter(Boolean).join(" ")
          : [firstName, lastInitial].filter(Boolean).join(" "),
        email: isPrivilegedViewer
          ? normaliseString(application?.email || "")
          : maskEmailForManageView(application?.email || ""),
        phone: isPrivilegedViewer ? normaliseString(application?.phone || "") : "",
        musicianSlug: normaliseString(application?.musicianSlug || ""),
        profileImage: normaliseString(application?.profileImage || ""),
        postcode: normaliseString(application?.postcode || ""),
        status: normaliseString(application?.status || "applied"),
        appliedAt: application?.appliedAt || null,
        shortlistedAt: application?.shortlistedAt || null,
        presentedAt: application?.presentedAt || null,
        allocatedAt: application?.allocatedAt || null,
        bookedAt: application?.bookedAt || null,
        declinedAt: application?.declinedAt || null,
        withdrawnAt: application?.withdrawnAt || null,
        notes: normaliseString(application?.notes || ""),
        deputyMatchScore: Number(application?.deputyMatchScore || 0),
        matchSummary: {
          instrument: normaliseString(application?.matchSummary?.instrument || ""),
          roleFit: Number(application?.matchSummary?.roleFit || 0),
          genreFit: Number(application?.matchSummary?.genreFit || 0),
          locationFit: Number(application?.matchSummary?.locationFit || 0),
          songFit: Number(application?.matchSummary?.songFit || 0),
        },
      };
    });

    return res.json({
      success: true,
      job: {
        _id: job._id,
        title: normaliseString(job?.title || job?.instrument || "Deputy job"),
        instrument: normaliseString(job?.instrument || ""),
        status: normaliseString(job?.status || ""),
        workflowStage: normaliseString(job?.workflowStage || ""),
        jobType: normaliseString(job?.jobType || ""),
        eventDate: job?.eventDate || job?.date || null,
        callTime: normaliseString(job?.callTime || job?.startTime || ""),
        finishTime: normaliseString(job?.finishTime || job?.endTime || ""),
        location:
          normaliseString(job?.location || "") ||
          [job?.venue, job?.locationName, job?.county, job?.postcode]
            .map((item) => normaliseString(item))
            .filter(Boolean)
            .join(", "),
        applicationCount: Number(job?.applicationCount || sanitizedApplications.length || 0),
        allocatedMusicianId: job?.allocatedMusicianId || null,
        allocatedMusicianName: normaliseString(job?.allocatedMusicianName || ""),
        allocatedAt: job?.allocatedAt || null,
        bookedMusicianId: job?.bookedMusicianId || null,
        bookedMusicianName: normaliseString(job?.bookedMusicianName || ""),
        bookingConfirmedAt: job?.bookingConfirmedAt || null,
        createdByName: normaliseString(job?.createdByName || ""),
        createdByEmail: isPrivilegedViewer
          ? normaliseString(job?.createdByEmail || "")
          : maskEmailForManageView(job?.createdByEmail || ""),
      },
      applications: sanitizedApplications,
      canViewFullContactDetails: isPrivilegedViewer,
    });
  } catch (error) {
    console.error("❌ getDeputyJobApplications error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch deputy job applications",
    });
  }
};

export const listDeputyJobMatches = async (req, res) => {
  try {
    const job = await deputyJobModel.findById(req.params.id).lean();
    if (!job) {
      return res
        .status(404)
        .json({ success: false, message: "Deputy job not found" });
    }

    return res.json({
      success: true,
      matches: Array.isArray(job.matchedMusicians) ? job.matchedMusicians : [],
      matchedCount: Number(job.matchedCount || 0),
      notifiedCount: Number(job.notifiedCount || 0),
    });
  } catch (error) {
    console.error("❌ listDeputyJobMatches error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch deputy job matches" });
  }
};

export const applyToDeputyJob = async (req, res) => {
  try {
    const job = await deputyJobModel.findById(req.params.id);
    if (!job) {
      return res
        .status(404)
        .json({ success: false, message: "Deputy job not found" });
    }

    const authenticatedMusicianId =
      req.user?._id ||
      req.user?.id ||
      req.user?.userId ||
      req.user?.musicianId ||
      null;

    if (!authenticatedMusicianId) {
      return res.status(401).json({
        success: false,
        message:
          "You must be logged in as a musician to apply for this opportunity",
      });
    }

    const alreadyApplied = job.applications.some(
      (a) =>
        asObjectIdString(a.musicianId) ===
        asObjectIdString(authenticatedMusicianId),
    );

    if (alreadyApplied) {
      return res.status(400).json({
        success: false,
        message: "You have already applied for this opportunity",
      });
    }

    const musician = await musicianModel
      .findById(authenticatedMusicianId)
      .lean();

    const matchedSnapshot = Array.isArray(job.matchedMusicians)
      ? job.matchedMusicians.find(
          (m) =>
            asObjectIdString(m.musicianId) ===
            asObjectIdString(authenticatedMusicianId),
        )
      : null;

    job.applications.push({
      musicianId: authenticatedMusicianId,
      firstName:
        musician?.firstName ||
        musician?.firstname ||
        musician?.basicInfo?.firstName ||
        req.user?.firstName ||
        "",
      lastName:
        musician?.lastName ||
        musician?.lastname ||
        musician?.basicInfo?.lastName ||
        req.user?.lastName ||
        "",
      email:
        musician?.email || musician?.basicInfo?.email || req.user?.email || "",
      phone:
        musician?.phone || musician?.basicInfo?.phone || req.user?.phone || "",
      musicianSlug: musician?.musicianSlug || "",
      profileImage:
        musician?.profilePhoto ||
        musician?.profilePicture ||
        musician?.profileImage ||
        musician?.profilePic ||
        musician?.profile_picture ||
        "",
      postcode: musician?.address?.postcode || musician?.postcode || "",
      status: "applied",
      appliedAt: new Date(),
      deputyMatchScore: Number(matchedSnapshot?.deputyMatchScore || 0),
      matchSummary: matchedSnapshot?.matchSummary || {
        instrument: "",
        roleFit: 0,
        genreFit: 0,
        locationFit: 0,
        songFit: 0,
      },
    });

    job.applicationCount = Array.isArray(job.applications)
      ? job.applications.length
      : 0;
    if (job.workflowStage === "sent_to_matches") {
      job.workflowStage = "applications_open";
    }

    await job.save();

    return res.json({
      success: true,
      message: "Application submitted",
      job: withDeputyJobAliases(job),
    });
  } catch (error) {
    console.error("❌ applyToDeputyJob error:", error);
    return res.status(500).json({ success: false, message: "Failed to apply" });
  }
};

export const sendDeputyJobNotifications = async (req, res) => {
  try {
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    const isEnquiryJob = String(job?.jobType || "").toLowerCase() === "enquiry";

    const hasSavedCardDetails =
      Boolean(normaliseString(job?.stripeCustomerId)) &&
      Boolean(normaliseString(job?.defaultPaymentMethodId)) &&
      ["ready_to_charge", "paid"].includes(normaliseString(job?.paymentStatus));

    if (!isEnquiryJob && !hasSavedCardDetails) {
      return res.status(400).json({
        success: false,
        message:
          "Card details must be completed and saved before deputy notifications can be sent.",
        job: withDeputyJobAliases(job),
      });
    }

    const matches = await getMatchedMusiciansForJob(job);

    if (!Array.isArray(matches) || !matches.length) {
      return res.status(400).json({
        success: false,
        message: "No matched musicians found for this deputy job.",
        canSendNotifications: false,
        requiresCardSetup: false,
        job: withDeputyJobAliases(job),
      });
    }

    const notificationResults = await notifyMusiciansAboutDeputyJob({
      job,
      musicians: matches,
    });

    const sentIds = notificationResults
      .filter((r) => r.status === "sent" && r.musicianId)
      .map((r) => r.musicianId);

    job.notifiedMusicianIds = sentIds;
    job.notifications = notificationResults;
    job.notifiedCount = notificationResults.filter(
      (r) => r.status === "sent",
    ).length;
    job.status = "open";
    job.previewMode = false;
    job.workflowStage = "sent_to_matches";

    job.matchedMusicians = (job.matchedMusicians || []).map((m) => ({
      ...m,
      notified: sentIds.some(
        (id) => asObjectIdString(id) === asObjectIdString(m.musicianId),
      ),
      notifiedAt: sentIds.some(
        (id) => asObjectIdString(id) === asObjectIdString(m.musicianId),
      )
        ? new Date()
        : null,
    }));

    await job.save();

    return res.json({
      success: true,
      message: "Notifications sent",
      canSendNotifications: true,
      requiresCardSetup: false,
      job: withDeputyJobAliases(job),
      notifiedCount: job.notifiedCount,
    });
  } catch (error) {
    console.error("❌ sendDeputyJobNotifications error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send deputy job notifications",
      error: error.message,
    });
  }
};

export const saveDeputyJobPaymentMethod = async (req, res) => {
  try {
    if (!ensureStripeReady(res)) return;

    const {
      setupIntentId = "",
      paymentMethodId = "",
      clientName = "",
      clientEmail = "",
      clientPhone = "",
    } = req.body || {};

    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    const effectiveSetupIntentId = normaliseString(
      setupIntentId || job.setupIntentId || "",
    );

    if (!effectiveSetupIntentId) {
      return res.status(400).json({
        success: false,
        message: "setupIntentId is required",
      });
    }

    const setupIntent = await stripe.setupIntents.retrieve(
      effectiveSetupIntentId,
    );

    const resolvedPaymentMethodId =
      normaliseString(paymentMethodId) ||
      normaliseString(
        typeof setupIntent.payment_method === "string"
          ? setupIntent.payment_method
          : setupIntent.payment_method?.id || "",
      );

    if (!resolvedPaymentMethodId) {
      return res.status(400).json({
        success: false,
        message: "No payment method found on SetupIntent",
      });
    }

    if (job.stripeCustomerId) {
      await stripe.customers.update(job.stripeCustomerId, {
        invoice_settings: {
          default_payment_method: resolvedPaymentMethodId,
        },
        ...(normaliseString(clientName || job.clientName)
          ? { name: normaliseString(clientName || job.clientName) }
          : {}),
        ...(normaliseEmail(clientEmail || job.clientEmail)
          ? { email: normaliseEmail(clientEmail || job.clientEmail) }
          : {}),
        ...(normaliseString(clientPhone || job.clientPhone)
          ? { phone: normaliseString(clientPhone || job.clientPhone) }
          : {}),
      });
    }

    job.clientName = normaliseString(clientName || job.clientName || "");
    job.clientEmail = normaliseEmail(clientEmail || job.clientEmail || "");
    job.clientPhone = normaliseString(clientPhone || job.clientPhone || "");
    job.setupIntentId = effectiveSetupIntentId;
    job.setupIntentStatus = setupIntent.status || "";
    job.defaultPaymentMethodId = resolvedPaymentMethodId;
    job.paymentStatus = "ready_to_charge";

    pushPaymentEvent(job, {
      type: "payment_method_saved",
      status: setupIntent.status || "",
      amount: Number(job.grossAmount || job.fee || 0),
      currency: job.currency,
      stripeCustomerId: job.stripeCustomerId,
      setupIntentId: effectiveSetupIntentId,
      paymentMethodId: resolvedPaymentMethodId,
      createdBy: req.user?._id || null,
      note: "Default payment method saved for deputy job",
    });

    if (setupIntent.status === "succeeded") {
      pushPaymentEvent(job, {
        type: "setup_intent_succeeded",
        status: setupIntent.status || "",
        amount: Number(job.grossAmount || job.fee || 0),
        currency: job.currency,
        stripeCustomerId: job.stripeCustomerId,
        setupIntentId: effectiveSetupIntentId,
        paymentMethodId: resolvedPaymentMethodId,
        createdBy: req.user?._id || null,
        note: "SetupIntent completed successfully",
      });
    }

    const shouldAutoSendNotifications =
      job.previewMode === false &&
      normaliseString(job.status).toLowerCase() === "open" &&
      ["created", "open", "payment_setup_required"].includes(
        normaliseString(job.workflowStage).toLowerCase(),
      );

    let notificationResults = [];
    let autoSent = false;

    if (shouldAutoSendNotifications) {
      const matcherResult = await runMatcherForJob({
        job,
        previewRecipientEmail: job.clientEmail || job.createdByEmail || "",
        createdBy: job.createdBy || null,
        primaryInstrument: job.instrument,
        effectiveIsVocalSlot: Boolean(job.isVocalSlot),
        resolvedEssentialRoles: Array.isArray(job.essentialRoles)
          ? job.essentialRoles
          : [],
        matcherDesiredRoles: Array.isArray(job.desiredRoles)
          ? job.desiredRoles
          : [],
        resolvedSecondaryInstruments: Array.isArray(job.secondaryInstruments)
          ? job.secondaryInstruments
          : [],
        resolvedGenres: Array.isArray(job.genres) ? job.genres : [],
        resolvedTags: Array.isArray(job.tags) ? job.tags : [],
        inferredCounty: job.county || "",
        inferredPostcode: job.postcode || "",
        mode: "send",
      });

      const matches = Array.isArray(matcherResult?.matches)
        ? matcherResult.matches
        : [];

      job.matchedMusicianIds = matcherResult?.matchedMusicianIds || [];
      job.matchedMusicians = matcherResult?.matchedMusicians || [];
      job.matchedCount = matches.length;

      console.log("🎸 saveDeputyJobPaymentMethod rematch input", {
        jobId: String(job._id),
        instrument: job.instrument,
        isVocalSlot: job.isVocalSlot,
        essentialRoles: job.essentialRoles,
        desiredRoles: job.desiredRoles,
        secondaryInstruments: job.secondaryInstruments,
        genres: job.genres,
        county: job.county,
        postcode: job.postcode,
      });

      console.log("🎯 saveDeputyJobPaymentMethod rematch result", {
        matchedCount: matches.length,
        firstMatches: matches.slice(0, 10).map((m) => ({
          id: m._id,
          firstName: m.firstName,
          lastName: m.lastName,
          email: m.email,
          instrumentation: m.instrumentation,
        })),
      });

      if (matches.length) {
        notificationResults = await notifyMusiciansAboutDeputyJob({
          job,
          musicians: matches,
        });

        const sentIds = notificationResults
          .filter((r) => r.status === "sent" && r.musicianId)
          .map((r) => r.musicianId);

        job.notifiedMusicianIds = sentIds;
        job.notifications = [
          ...(Array.isArray(job.notifications) ? job.notifications : []),
          ...notificationResults,
        ];
        job.notifiedCount = notificationResults.filter(
          (r) => r.status === "sent",
        ).length;
        job.status = "open";
        job.previewMode = false;
        job.workflowStage = "sent_to_matches";
        job.matchedMusicians = (job.matchedMusicians || []).map((m) => ({
          ...m,
          notified: sentIds.some(
            (id) => asObjectIdString(id) === asObjectIdString(m.musicianId),
          ),
          notifiedAt: sentIds.some(
            (id) => asObjectIdString(id) === asObjectIdString(m.musicianId),
          )
            ? new Date()
            : m.notifiedAt || null,
        }));

        autoSent = true;
      } else {
        job.notifiedMusicianIds = [];
        job.notifiedCount = 0;
        job.status = "open";
        job.previewMode = false;
        job.workflowStage = "created";
      }
    }

    await job.save();

    const formattedJob = withDeputyJobAliases(job);

    return res.json({
      success: true,
      message: autoSent
        ? `Payment method saved and ${job.notifiedCount || 0} notifications sent`
        : "Payment method saved",
      job: formattedJob,
      defaultPaymentMethodId: resolvedPaymentMethodId,
      paymentStatus: job.paymentStatus,
      notifiedCount: job.notifiedCount || 0,
      autoSentNotifications: autoSent,
      notificationResults,
    });
  } catch (error) {
    console.error("❌ saveDeputyJobPaymentMethod error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save payment method",
      error: error.message,
    });
  }
};

export const chargeDeputyJob = async (req, res) => {
  try {
    if (!ensureStripeReady(res)) return;

    const job = await deputyJobModel.findById(req.params.id);
    if (!job) {
      return res
        .status(404)
        .json({ success: false, message: "Deputy job not found" });
    }

    const chargeResult = await attemptDeputyJobCharge({
      job,
      createdBy: req.user?._id || null,
    });

    await job.save();

    if (!chargeResult.success) {
      return res.status(400).json({
        success: false,
        message: chargeResult.message || "Failed to charge deputy job",
        job: withDeputyJobAliases(job),
      });
    }

    const formattedJob = withDeputyJobAliases(job);

    return res.json({
      success: true,
      message: "Deputy job charged successfully",
      job: formattedJob,
      paymentIntent: chargeResult.paymentIntent,
    });
  } catch (error) {
    console.error("❌ chargeDeputyJob error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to charge deputy job",
      error: error.message,
    });
  }
};

export const runDeputyPayoutCron = async (req, res) => {
  try {
    if (!ensureCronSecret(req, res)) return;

    const asOfDate = parseDateOrNull(req.body?.asOfDate) || new Date();
    const result = await runDeputyPayoutRelease({ asOfDate });

    return res.json({
      success: true,
      message: `Deputy payout cron completed. ${result.releasedCount || 0} payouts released.`,
      ...result,
    });
  } catch (error) {
    console.error("❌ runDeputyPayoutCron error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to run deputy payout cron",
      error: error.message,
    });
  }
};

export const previewDeputyAllocation = async (req, res) => {
  try {
    const { musicianId } = req.body || {};
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res
        .status(404)
        .json({ success: false, message: "Deputy job not found" });
    }

    if (!musicianId) {
      return res
        .status(400)
        .json({ success: false, message: "musicianId is required" });
    }

    const musician = await findMatchedMusicianFromJob(job, musicianId);
    if (!musician) {
      return res
        .status(404)
        .json({ success: false, message: "Matched musician not found" });
    }

    const preview = buildAllocationEmailPreview({ job, musician });

    return res.json({
      success: true,
      musician,
      preview,
    });
  } catch (error) {
    console.error("❌ previewDeputyAllocation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to preview allocation",
      error: error.message,
    });
  }
};

export const confirmDeputyAllocation = async (req, res) => {
  try {
    const { musicianId } = req.body || {};
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res
        .status(404)
        .json({ success: false, message: "Deputy job not found" });
    }

    if (!musicianId) {
      return res
        .status(400)
        .json({ success: false, message: "musicianId is required" });
    }

    const application = findApplicationFromJob(job, musicianId);
    const musician = await findMatchedMusicianFromJob(job, musicianId);

    if (!musician) {
      return res
        .status(404)
        .json({ success: false, message: "Matched musician not found" });
    }

    const now = new Date();

    job.allocatedMusicianId = musician._id;
    job.allocatedMusicianName = [musician.firstName, musician.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    job.allocatedAt = now;
    job.status = "allocated";
    job.workflowStage = "allocated";
    job.releaseOn = job.releaseOn || buildDefaultReleaseOn(job.eventDate);

    if (!job.grossAmount && !job.commissionAmount && !job.deputyNetAmount) {
      const ledger = buildLedgerAmounts({
        fee: job.fee,
        grossAmount: job.grossAmount,
        commissionAmount: job.commissionAmount,
        deputyNetAmount: job.deputyNetAmount,
        stripeFeeAmount: job.stripeFeeAmount,
        deductStripeFeesFromDeputy: true,
      });
      job.grossAmount = ledger.grossAmount;
      job.commissionAmount = ledger.commissionAmount;
      job.deputyNetAmount = ledger.deputyNetAmount;
      job.stripeFeeAmount = ledger.stripeFeeAmount;
    }

    job.applications = (job.applications || []).map((existingApplication) => {
      const sameMusician =
        asObjectIdString(existingApplication.musicianId) ===
        asObjectIdString(musician._id);

      return {
        ...existingApplication,
        status: sameMusician ? "allocated" : existingApplication.status,
        allocatedAt: sameMusician
          ? now
          : existingApplication.allocatedAt || null,
        musicianSlug:
          sameMusician && !existingApplication.musicianSlug
            ? musician?.musicianSlug || ""
            : existingApplication.musicianSlug || "",
        profileImage:
          sameMusician && !existingApplication.profileImage
            ? musician?.profilePhoto ||
              musician?.profilePicture ||
              musician?.profileImage ||
              musician?.profilePic ||
              musician?.profile_picture ||
              ""
            : existingApplication.profileImage || "",
        phoneNormalized:
          sameMusician && !existingApplication.phoneNormalized
            ? toE164(
                musician?.phone ||
                  musician?.phoneNumber ||
                  existingApplication.phone ||
                  "",
              )
            : existingApplication.phoneNormalized ||
              toE164(existingApplication.phone || ""),
      };
    });

    const isEnquiryJob = String(job?.jobType || "").toLowerCase() === "enquiry";

    let chargeResult = null;

    if (!isEnquiryJob) {
      if (job.stripeCustomerId && job.defaultPaymentMethodId) {
        chargeResult = await attemptDeputyJobCharge({
          job,
          createdBy: req.user?._id || null,
        });
      } else if (job.clientEmail) {
        job.paymentStatus = "setup_required";
      }
    } else {
      job.paymentStatus = "not_required";
    }

    let whatsappResult = null;

    const rawTargetPhone =
      musician?.phone ||
      musician?.phoneNumber ||
      application?.phoneNormalized ||
      application?.phone ||
      "";

    const targetPhone = toE164(rawTargetPhone);

    console.log("📲 Allocation WhatsApp target", {
      jobId: String(job._id),
      musicianId: String(musician._id),
      targetPhone,
      rawPhone: rawTargetPhone,
    });

    let whatsappErrorMessage = "";

    if (targetPhone) {
      try {
        whatsappResult = await sendDeputyAllocationWhatsApp({
          to: targetPhone,
          job,
          musician,
        });
      } catch (whatsappError) {
        whatsappErrorMessage =
          whatsappError?.message || "WhatsApp allocation send failed";

        console.error("❌ sendDeputyAllocationWhatsApp error:", {
          jobId: String(job._id),
          musicianId: String(musician._id),
          targetPhone,
          message: whatsappErrorMessage,
          stack: whatsappError?.stack,
        });
      }
    }

    job.notifications = [
      ...(job.notifications || []),
      {
        musicianId: musician._id,
        email: musician.email || application?.email || "",
        phone: targetPhone || "",
        channel: targetPhone ? "whatsapp" : "email",
        type: "allocation_request",
        subject: `Deputy allocation request: ${normaliseString(
          job.title || job.instrument || "Deputy opportunity",
        )}`,
        previewHtml: "",
        previewText: `Allocation request sent via ${
          targetPhone ? "WhatsApp" : "fallback"
        } to ${[musician.firstName, musician.lastName].filter(Boolean).join(" ").trim()}`,
        providerMessageId: whatsappResult?.sid || "",
        status: whatsappResult?.sid ? "sent" : "failed",
        sentAt: new Date(),
        error: whatsappResult?.sid
          ? ""
          : targetPhone
            ? whatsappErrorMessage || "WhatsApp allocation send failed"
            : "No phone number available for allocation message",
      },
    ];

    await job.save();

    const formattedJob = withDeputyJobAliases(job);

    return res.json({
      success: true,
      message: chargeResult?.success
        ? "Deputy allocated, WhatsApp sent and client charged"
        : whatsappResult?.sid
          ? "Deputy allocated and WhatsApp sent"
          : "Deputy allocated",
      job: formattedJob,
      allocatedMusician: musician,
      chargeResult,
      whatsappResult: whatsappResult
        ? {
            sid: whatsappResult.sid || "",
            status: whatsappResult.status || "",
          }
        : null,
    });
  } catch (error) {
    console.error("❌ confirmDeputyAllocation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to allocate deputy",
      error: error.message,
    });
  }
};

export const previewDeputyBookingEmail = async (req, res) => {
  try {
    const { musicianId = "" } = req.body || {};
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    const targetMusicianId = musicianId || job.allocatedMusicianId;
    if (!targetMusicianId) {
      return res.status(400).json({
        success: false,
        message: "No allocated musician to preview",
      });
    }

    const musician = await findMatchedMusicianFromJob(job, targetMusicianId);
    if (!musician) {
      return res.status(404).json({
        success: false,
        message: "Allocated musician not found",
      });
    }

    const payout = getMusicianPayoutSummary(musician);
    const preview = buildBookingConfirmationPreview({ job, musician });

    return res.json({
      success: true,
      musician,
      payout: {
        hasPayoutDetails: payout.hasPayoutDetails,
        isStripeReady: payout.isStripeReady,
        hasStripeAccount: payout.hasStripeAccount,
        detailsSubmitted: payout.detailsSubmitted,
        chargesEnabled: payout.chargesEnabled,
        payoutsEnabled: payout.payoutsEnabled,
      },
      preview,
    });
  } catch (error) {
    console.error("❌ previewDeputyBookingEmail error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to preview booking email",
      error: error.message,
    });
  }
};

export const rematchAndSendDeputyJobNotifications = async (req, res) => {
  try {
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    const isEnquiryJob = String(job?.jobType || "").toLowerCase() === "enquiry";

    const hasSavedCardDetails =
      Boolean(normaliseString(job?.stripeCustomerId)) &&
      Boolean(normaliseString(job?.defaultPaymentMethodId)) &&
      ["ready_to_charge", "paid"].includes(
        normaliseString(job?.paymentStatus),
      );

    if (!isEnquiryJob && !hasSavedCardDetails) {
      return res.status(400).json({
        success: false,
        message:
          "Card details must be completed and saved before deputy notifications can be sent.",
        job: withDeputyJobAliases(job),
      });
    }

    const matcherResult = await runMatcherForJob({
      job,
      previewRecipientEmail: job.clientEmail || job.createdByEmail || "",
      createdBy: job.createdBy || null,
      primaryInstrument: job.instrument,
      effectiveIsVocalSlot: Boolean(job.isVocalSlot),
      resolvedEssentialRoles: Array.isArray(job.essentialRoles)
        ? job.essentialRoles
        : [],
      matcherDesiredRoles: Array.isArray(job.desiredRoles)
        ? job.desiredRoles
        : [],
      resolvedSecondaryInstruments: Array.isArray(job.secondaryInstruments)
        ? job.secondaryInstruments
        : [],
      resolvedGenres: Array.isArray(job.genres) ? job.genres : [],
      resolvedTags: Array.isArray(job.tags) ? job.tags : [],
      inferredCounty: job.county || "",
      inferredPostcode: job.postcode || "",
      mode: "send",
    });

    const matches = Array.isArray(matcherResult.matches)
      ? matcherResult.matches
      : [];

    if (!matches.length) {
      await deputyJobModel.updateOne(
        { _id: job._id },
        {
          $set: {
            matchedMusicianIds: [],
            matchedMusicians: [],
            matchedCount: 0,
            notifiedMusicianIds: [],
            notifiedCount: 0,
          },
        },
      );

      const refreshedJob = await deputyJobModel.findById(job._id).lean();

      return res.status(400).json({
        success: false,
        message: "No matching musicians found for this deputy job.",
        job: withDeputyJobAliases(refreshedJob || job),
      });
    }

    // ONLY successful sends count as "already notified"
    const existingSuccessfulNotifications = Array.isArray(job.notifications)
      ? job.notifications.filter((n) => n?.status === "sent")
      : [];

    const existingSentIds = existingSuccessfulNotifications
      .map((n) => asObjectIdString(n?.musicianId))
      .filter(Boolean);

    const existingSentEmails = existingSuccessfulNotifications
      .map((n) => normaliseEmail(n?.email || ""))
      .filter(Boolean);

    const alreadyNotifiedIds = new Set(existingSentIds);
    const alreadyNotifiedEmails = new Set(existingSentEmails);

    const remainingMatches = matches.filter((musician) => {
      const id = asObjectIdString(
        musician?._id || musician?.id || musician?.musicianId,
      );
      const email = normaliseEmail(musician?.email || "");

      if (id && alreadyNotifiedIds.has(id)) return false;
      if (email && alreadyNotifiedEmails.has(email)) return false;

      return true;
    });

    if (!remainingMatches.length) {
      const refreshedMatchedMusicians = (matcherResult.matchedMusicians || []).map(
        (m) => {
          const id = asObjectIdString(m?.musicianId);
          const email = normaliseEmail(m?.email || "");

          const existingSuccessful = existingSuccessfulNotifications.find(
            (n) =>
              (id && asObjectIdString(n?.musicianId) === id) ||
              (email && normaliseEmail(n?.email || "") === email),
          );

          return {
            ...m,
            notified: Boolean(existingSuccessful),
            notifiedAt: existingSuccessful?.sentAt || null,
          };
        },
      );

      await deputyJobModel.updateOne(
        { _id: job._id },
        {
          $set: {
            matchedMusicianIds: matcherResult.matchedMusicianIds,
            matchedMusicians: refreshedMatchedMusicians,
            matchedCount: matches.length,
            notifiedMusicianIds: existingSentIds,
            notifiedCount: existingSuccessfulNotifications.length,
          },
        },
      );

      const refreshedJob = await deputyJobModel.findById(job._id).lean();

      return res.json({
        success: true,
        message:
          "Matched musicians refreshed, but no remaining musicians to notify.",
        job: withDeputyJobAliases(refreshedJob || job),
        matchedCount: matches.length,
        newlyNotifiedCount: 0,
        notifiedCount: Number(
          refreshedJob?.notifiedCount ||
            existingSuccessfulNotifications.length ||
            0,
        ),
        notificationResults: [],
      });
    }

    const notificationResults = await notifyMusiciansAboutDeputyJob({
      job,
      musicians: remainingMatches,
    });

    const newSuccessfulNotifications = notificationResults.filter(
      (r) => r?.status === "sent",
    );

    const newSentIds = newSuccessfulNotifications
      .map((r) => asObjectIdString(r?.musicianId))
      .filter(Boolean);

    const newSentEmails = newSuccessfulNotifications
      .map((r) => normaliseEmail(r?.email || ""))
      .filter(Boolean);

    const allSentIds = Array.from(
      new Set([...existingSentIds, ...newSentIds].filter(Boolean)),
    );

    const allSentEmails = new Set(
      [...existingSentEmails, ...newSentEmails].filter(Boolean),
    );

    const refreshedJobDoc = await deputyJobModel.findById(job._id);

    if (!refreshedJobDoc) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found after sending notifications.",
      });
    }

    const existingNotifications = Array.isArray(refreshedJobDoc.notifications)
      ? refreshedJobDoc.notifications
      : [];

    refreshedJobDoc.matchedMusicianIds = matcherResult.matchedMusicianIds;
    refreshedJobDoc.matchedCount = matches.length;
    refreshedJobDoc.notifiedMusicianIds = allSentIds;
    refreshedJobDoc.notifications = [
      ...existingNotifications,
      ...notificationResults,
    ];

    // ONLY successful sends count here
    refreshedJobDoc.notifiedCount = refreshedJobDoc.notifications.filter(
      (n) => n?.status === "sent",
    ).length;

    refreshedJobDoc.status = "open";
    refreshedJobDoc.previewMode = false;
    refreshedJobDoc.workflowStage = "sent_to_matches";

    refreshedJobDoc.matchedMusicians = (matcherResult.matchedMusicians || []).map(
      (m) => {
        const id = asObjectIdString(m?.musicianId);
        const email = normaliseEmail(m?.email || "");

        const sentNotification = refreshedJobDoc.notifications.find(
          (n) =>
            n?.status === "sent" &&
            ((id && asObjectIdString(n?.musicianId) === id) ||
              (email && normaliseEmail(n?.email || "") === email)),
        );

        return {
          ...m,
          notified: Boolean(sentNotification),
          notifiedAt: sentNotification?.sentAt || null,
        };
      },
    );

    await refreshedJobDoc.save();

    return res.json({
      success: true,
      message: `${newSuccessfulNotifications.length} matched musicians notified`,
      job: withDeputyJobAliases(refreshedJobDoc),
      matchedCount: matches.length,
      newlyNotifiedCount: newSuccessfulNotifications.length,
      notifiedCount: refreshedJobDoc.notifiedCount,
      notificationResults,
    });
  } catch (error) {
    console.error("❌ rematchAndSendDeputyJobNotifications error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to rematch and send deputy job notifications",
      error: error.message,
    });
  }
};

export const sendDeputyBookingEmail = async (req, res) => {
  try {
    const { musicianId = "" } = req.body || {};
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res
        .status(404)
        .json({ success: false, message: "Deputy job not found" });
    }

    const targetMusicianId = musicianId || job.allocatedMusicianId;
    if (!targetMusicianId) {
      return res
        .status(400)
        .json({ success: false, message: "No allocated musician to confirm" });
    }

    const musician = await findMatchedMusicianFromJob(job, targetMusicianId);
    if (!musician) {
      return res
        .status(404)
        .json({ success: false, message: "Allocated musician not found" });
    }

    job.status = "filled";
    job.workflowStage = "booking_confirmed";
    job.bookedMusicianId = musician._id;
    job.bookedMusicianName = [musician.firstName, musician.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    job.bookingConfirmedAt = new Date();

    job.applications = (job.applications || []).map((application) => {
      const sameMusician =
        asObjectIdString(application.musicianId) ===
        asObjectIdString(musician._id);

      return {
        ...application,
        status: sameMusician ? "booked" : application.status,
        bookedAt: sameMusician ? new Date() : application.bookedAt || null,
      };
    });

    const preview = buildBookingConfirmationPreview({ job, musician });

    try {
      await sendEmail({
        to: musician.email || "",
        subject: preview.subject,
        bcc: DEPUTY_JOB_BCC_EMAIL,
        html: preview.html,
        text: preview.text,
      });
    } catch (sendBookingEmailError) {
      console.error(
        "❌ Failed to send deputy booking confirmation email:",
        sendBookingEmailError,
      );
    }

    job.notifications = [
      ...(job.notifications || []),
      {
        musicianId: musician._id,
        email: musician.email || "",
        phone: musician.phone || musician.phoneNumber || "",
        channel: "email",
        type: "booking_confirmation",
        subject: preview.subject,
        previewHtml: preview.html,
        previewText: preview.text,
        status: "sent",
        sentAt: new Date(),
      },
    ];

    await job.save();

    const formattedJob = withDeputyJobAliases(job);

    return res.json({
      success: true,
      message: "Booking confirmation sent",
      job: formattedJob,
      confirmedMusician: musician,
      preview,
    });
  } catch (error) {
    console.error("❌ sendDeputyBookingEmail error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send booking confirmation",
      error: error.message,
    });
  }
};

export const twilioInboundDeputyAllocation = async (req, res) => {
  try {
    const bodyText = normaliseString(req.body?.Body || "");
    const buttonText = normaliseString(req.body?.ButtonText || "");
    const buttonPayload = normaliseString(req.body?.ButtonPayload || "");
    const repliedSid = normaliseString(req.body?.OriginalRepliedMessageSid || "");
    const inboundMessageSid = normaliseString(req.body?.MessageSid || "");
    const fromRaw = normaliseString(req.body?.From || req.body?.WaId || "");
    const fromPhone = toE164(fromRaw);

    const rawReply = (buttonPayload || buttonText || bodyText).trim().toLowerCase();
    const normalisedReply = rawReply.replace(/\s+/g, " ").trim().toLowerCase();
    const compactReply = normalisedReply.replace(/\s+/g, "");

    let action = null;

    // Accept
    if (
      normalisedReply === "yes" ||
      normalisedReply === "yes, book me in!" ||
      normalisedReply === "i am available" ||
      normalisedReply === "i'm available" ||
      normalisedReply === "available" ||
      normalisedReply.includes("book me in")
    ) {
      action = "accept";
    }

    // Decline
    if (
      compactReply === "notavailable" ||
      normalisedReply.includes("not available") ||
      normalisedReply.includes("unavailable") ||
      normalisedReply.includes("changed my mind")
    ) {
      action = "decline";
    }

    // IMPORTANT: bail out early if we can't interpret the reply
    if (!action) {
      console.warn("⚠️ twilioInboundDeputyAllocation: unrecognised reply", {
        bodyText,
        buttonText,
        buttonPayload,
        fromPhone,
        repliedSid,
      });
      return res.status(200).send("<Response/>");
    }

    const job = await deputyJobModel.findOne({
      notifications: {
        $elemMatch: {
          providerMessageId: repliedSid,
          channel: "whatsapp",
          type: { $in: ["allocation_request", "allocation"] },
        },
      },
    });

    if (!job) {
      console.warn("⚠️ twilioInboundDeputyAllocation: no deputy job found for replied SID", {
        repliedSid,
        fromPhone,
      });
      return res.status(200).send("<Response/>");
    }

    const allocationNotification = (job.notifications || []).find(
      (item) =>
        String(item?.providerMessageId || "") === repliedSid &&
        String(item?.channel || "") === "whatsapp" &&
        ["allocation_request", "allocation"].includes(String(item?.type || "")),
    );

    const matchedApplication = findApplicationByAnyIdentity(job, {
      musicianId: allocationNotification?.musicianId || job.allocatedMusicianId,
      phone: fromPhone,
      email: allocationNotification?.email || "",
    });

    const targetMusicianId =
      allocationNotification?.musicianId ||
      matchedApplication?.musicianId ||
      job.allocatedMusicianId;

    const musician = targetMusicianId
      ? await musicianModel.findById(targetMusicianId).lean()
      : null;

    if (!musician) {
      console.warn("⚠️ twilioInboundDeputyAllocation: musician not found", {
        jobId: String(job._id),
        repliedSid,
        fromPhone,
        targetMusicianId: String(targetMusicianId || ""),
      });
      return res.status(200).send("<Response/>");
    }

    const getOrdinalSuffix = (day) => {
      const n = Number(day);
      if (n >= 11 && n <= 13) return "th";
      const last = n % 10;
      if (last === 1) return "st";
      if (last === 2) return "nd";
      if (last === 3) return "rd";
      return "th";
    };

    const formatFullDate = (value) => {
      if (!value) return "TBC";

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return normaliseString(value) || "TBC";

      const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
      const month = date.toLocaleDateString("en-GB", { month: "long" });
      const day = date.getDate();
      const year = date.getFullYear();

      return `${weekday}, ${day}${getOrdinalSuffix(day)} ${month} ${year}`;
    };

    const musicianName = [musician.firstName, musician.lastName].filter(Boolean).join(" ").trim();
    const musicianDisplayName = [
      normaliseString(musician?.firstName || ""),
      normaliseString(musician?.lastName || "").charAt(0)
        ? `${normaliseString(musician?.lastName || "").charAt(0)}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    const jobTitle = normaliseString(job.title || job.instrument || "Deputy opportunity");
    const location = normaliseString(job.location || job.locationName || job.venue || "Location TBC");
    const dateText = formatFullDate(job.eventDate);
    const feeText = getDeputyNetFeeText(job);

    const musicianEmail = normaliseString(musician.email || matchedApplication?.email || "").toLowerCase();
    const musicianPhone =
      fromPhone ||
      toE164(musician.phone || musician.phoneNumber || matchedApplication?.phone || "") ||
      "";

    const posterEmail = normaliseString(job.createdByEmail || job.clientEmail || "").toLowerCase();

    if (action === "accept") {
      // Mark booked/filled etc (your helper should set the correct job fields)
      applyBookedStateToJob(job, musician);

      job.notifications = [
        ...(job.notifications || []),
        {
          musicianId: musician._id,
          email: musicianEmail,
          phone: musicianPhone,
          channel: "whatsapp",
          type: "allocation_accepted",
          subject: `Deputy accepted: ${jobTitle}`,
          previewHtml: "",
          previewText: `Accepted via WhatsApp by ${musicianName}`,
          providerMessageId: inboundMessageSid,
          status: "sent",
          sentAt: new Date(),
        },
      ];

      await job.save();

      // WhatsApp confirmation back to musician
      if (musicianPhone) {
        try {
          await sendWhatsAppText(
            musicianPhone,
            "Wonderful! Please consider yourself booked. We’ll let the band know, and you should hear from them shortly.",
          );
        } catch (whatsAppError) {
          console.error("❌ Failed to send deputy acceptance WhatsApp confirmation:", whatsAppError);
        }
      }

      // Email the musician full details
      if (musicianEmail) {
        try {
          const callTime = normaliseString(job?.callTime || job?.startTime || "");
          const finishTime = normaliseString(job?.finishTime || job?.endTime || "");
          const notes = normaliseString(job?.notes || "");
          const requiredInstruments = normaliseList(job?.requiredInstruments);
          const essentialSkills = normaliseList(job?.essentialRoles);
          const requiredSkills = normaliseList(job?.requiredSkills);
          const preferredExtraSkills = normaliseList(job?.desiredRoles);
          const secondaryInstruments = normaliseList(job?.secondaryInstruments);
          const genres = normaliseList(job?.genres);
          const tags = normaliseList(job?.tags);
          const setLengths = normaliseList(job?.setLengths);
          const whatsIncluded = normaliseList(job?.whatsIncluded);
          const claimableExpenses = normaliseList(job?.claimableExpenses);

          const bandContactName = normaliseString(job?.createdByName || "The Supreme Collective");
          const bandContactEmail = normaliseString(job?.createdByEmail || "hello@thesupremecollective.co.uk");
          const bandContactPhone = normaliseString(job?.createdByPhone || "");

          const payout = getMusicianPayoutSummary(musician);
          const payoutSettingsUrl = getMusicianPayoutSettingsUrl(musician);

          await sendEmail({
            to: musicianEmail,
            bcc: DEPUTY_JOB_BCC_EMAIL,
            subject: `Confirmed: ${jobTitle}`,
            html: `
              <div style="font-family: Arial, sans-serif; line-height: 1.65; color: #111; max-width: 720px;">
                <p>Hi ${escapeHtml(normaliseString(musician.firstName || "there"))},</p>

                <p>
                  Thank you for confirming your availability for <strong>${escapeHtml(jobTitle)}</strong> —
                  please consider yourself booked.
                </p>

                <p>
                  The band knows you have confirmed the booking, and they have your contact details.
                  Please find the full job details and band contact information below so you can get in touch directly about timings,
                  setlist details, logistics, arrival information, parking, dress code, and anything else needed to ensure a smooth performance.
                </p>

                <h3 style="margin: 24px 0 10px;">Gig details</h3>
                <ul style="padding-left: 20px; margin: 0 0 18px;">
                  ${renderDetailRow("Job", jobTitle)}
                  ${renderDetailRow("Date", dateText)}
                  ${renderDetailRow("Call time", callTime)}
                  ${renderDetailRow("Finish time", finishTime)}
                  ${renderDetailRow("Location", location)}
                  ${renderDetailRow("Net fee", feeText)}
                  ${renderDetailListRow("Required instruments", requiredInstruments)}
                  ${renderDetailListRow("Essential skills", essentialSkills)}
                  ${renderDetailListRow("Required skills", requiredSkills)}
                  ${renderDetailListRow("Preferred extra skills", preferredExtraSkills)}
                  ${renderDetailListRow("Secondary instruments", secondaryInstruments)}
                  ${renderDetailListRow("Genres", genres)}
                  ${renderDetailListRow("Tags", tags)}
                  ${renderDetailListRow("Set lengths", setLengths)}
                  ${renderDetailListRow("What's included", whatsIncluded)}
                  ${renderDetailListRow("Claimable expenses", claimableExpenses)}
                  ${renderDetailRow("Notes", notes)}
                </ul>

                ${
                  payout.hasPayoutDetails
                    ? `
                      <p>
                        <strong>Payment processing:</strong><br/>
                        Your net fee for this gig is <strong>${escapeHtml(feeText)}</strong>.
                        Provided your Stripe payout setup remains active, payment can typically be expected <strong>5–7 days after the gig</strong>
                        to your connected Stripe account.
                      </p>
                    `
                    : `
                      <p>
                        <strong>Payment processing:</strong><br/>
                        Your net fee for this gig is <strong>${escapeHtml(feeText)}</strong>.
                        We do not currently have an active Stripe payout setup on file for you, so please complete your payout setup now to ensure payment can be processed.
                        Once your Stripe payout setup is complete, payment can typically be expected <strong>5–7 days after the gig</strong>.
                      </p>
                      <p style="margin: 16px 0 20px;">
                        <a
                          href="${escapeHtml(payoutSettingsUrl)}"
                          style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;"
                        >
                          Complete Stripe payout setup
                        </a>
                      </p>
                    `
                }

                <h3 style="margin: 24px 0 10px;">Band contact details</h3>
                <ul style="padding-left: 20px; margin: 0 0 18px;">
                  ${renderDetailRow("Name", bandContactName)}
                  ${renderDetailRow("Email", bandContactEmail)}
                  ${renderDetailRow("Phone", bandContactPhone)}
                </ul>

                <p>
                  If anything changes or you have any trouble getting hold of the band, just reply to this email and we’ll be happy to help.
                </p>

                <p>
                  Best wishes,<br/>
                  <strong>The Supreme Collective</strong>
                </p>
              </div>
            `,
          });
        } catch (musicianEmailError) {
          console.error("❌ Failed to send musician deputy acceptance email:", musicianEmailError);
        }
      }

      // Email the poster/band
      if (posterEmail) {
        try {
          const requiredInstruments = normaliseList(job?.requiredInstruments);
          const essentialSkills = normaliseList(job?.essentialRoles);
          const requiredSkills = normaliseList(job?.requiredSkills);
          const preferredExtraSkills = normaliseList(job?.desiredRoles);
          const secondaryInstruments = normaliseList(job?.secondaryInstruments);
          const genres = normaliseList(job?.genres);
          const tags = normaliseList(job?.tags);
          const setLengths = normaliseList(job?.setLengths);
          const whatsIncluded = normaliseList(job?.whatsIncluded);
          const claimableExpenses = normaliseList(job?.claimableExpenses);

          const callTime = normaliseString(job?.callTime || job?.startTime || "");
          const finishTime = normaliseString(job?.finishTime || job?.endTime || "");
          const notes = normaliseString(job?.notes || "");

          const paymentDate = job?.releaseOn
            ? new Date(job.releaseOn).toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })
            : "TBC";

          await sendEmail({
            to: posterEmail,
            bcc: DEPUTY_JOB_BCC_EMAIL,
            subject: `Deputy accepted: ${jobTitle}`,
            html: `
              <div style="margin:0; padding:0; background:#f7f7f7; font-family:Arial, sans-serif; color:#111;">
                <div style="max-width:700px; margin:0 auto; padding:32px 20px;">
                  <div style="background:#111; border-radius:20px 20px 0 0; padding:28px 32px; text-align:left;">
                    <p style="margin:0; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#ff6667; font-weight:700;">
                      The Supreme Collective
                    </p>
                    <h1 style="margin:12px 0 0; font-size:28px; line-height:1.2; color:#fff;">
                      Deputy Accepted
                    </h1>
                    <p style="margin:12px 0 0; font-size:15px; line-height:1.6; color:#f3f3f3;">
                      Your selected deputy has confirmed their availability and is now booked for this job.
                    </p>
                  </div>

                  <div style="background:#ffffff; border:1px solid #e8e8e8; border-top:0; border-radius:0 0 20px 20px; padding:32px;">
                    <p style="margin:0 0 18px; font-size:16px; line-height:1.7; color:#333;">
                      Hi ${escapeHtml(normaliseString(job?.createdByName || "there"))},
                    </p>

                    <p style="margin:0 0 16px; font-size:15px; line-height:1.7; color:#444;">
                      Great news — <strong>${escapeHtml(musicianName || "your selected deputy")}</strong> has accepted the deputy booking for
                      <strong>${escapeHtml(jobTitle)}</strong>.
                    </p>

                    <p style="margin:0 0 24px; font-size:15px; line-height:1.7; color:#444;">
                      Please now get in touch with them directly to share the setlist, timings, dress code, logistics, arrival details, parking instructions, and anything else needed.
                    </p>

                    <div style="margin-bottom:24px; padding:24px; background:#fafafa; border:1px solid #ececec; border-radius:18px;">
                      <h3 style="margin:0 0 14px; font-size:16px; color:#111;">Deputy contact details</h3>
                      <ul style="padding-left:20px; margin:0; font-size:14px; line-height:1.8; color:#333;">
                        <li><strong>Name:</strong> ${escapeHtml(musicianName || "Not provided")}</li>
                        <li><strong>Email:</strong> ${escapeHtml(musicianEmail || "Not provided")}</li>
                        <li><strong>Phone:</strong> ${escapeHtml(musicianPhone || "Not provided")}</li>
                      </ul>
                    </div>

                    <div style="margin-bottom:24px; padding:24px; background:#fafafa; border:1px solid #ececec; border-radius:18px;">
                      <h3 style="margin:0 0 14px; font-size:16px; color:#111;">Confirmed job details</h3>
                      <ul style="padding-left:20px; margin:0; font-size:14px; line-height:1.8; color:#333;">
                        ${renderDetailRow("Job", jobTitle)}
                        ${renderDetailRow("Date", dateText)}
                        ${renderDetailRow("Call time", callTime)}
                        ${renderDetailRow("Finish time", finishTime)}
                        ${renderDetailRow("Location", location)}
                        ${renderDetailRow("Fee", feeText)}
                        ${renderDetailListRow("Required instruments", requiredInstruments)}
                        ${renderDetailListRow("Essential skills", essentialSkills)}
                        ${renderDetailListRow("Required skills", requiredSkills)}
                        ${renderDetailListRow("Preferred extra skills", preferredExtraSkills)}
                        ${renderDetailListRow("Secondary instruments", secondaryInstruments)}
                        ${renderDetailListRow("Genres", genres)}
                        ${renderDetailListRow("Tags", tags)}
                        ${renderDetailListRow("Set lengths", setLengths)}
                        ${renderDetailListRow("What's included", whatsIncluded)}
                        ${renderDetailListRow("Claimable expenses", claimableExpenses)}
                        ${renderDetailRow("Notes", notes)}
                      </ul>
                    </div>

                    <div style="margin-bottom:24px; padding:20px; border:1px solid #f1d0d1; background:#fff7f7; border-radius:16px;">
                      <p style="margin:0 0 8px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#ff6667;">
                        Payment processing
                      </p>
                      <p style="margin:0; font-size:14px; line-height:1.7; color:#444;">
                        Unless otherwise agreed, payment is due to be processed on <strong>${escapeHtml(paymentDate)}</strong>.
                      </p>
                    </div>

                    <p style="margin:24px 0 0; font-size:15px; line-height:1.7; color:#444;">
                      Best wishes,<br/>
                      <strong>The Supreme Collective</strong>
                    </p>
                  </div>
                </div>
              </div>
            `,
          });
        } catch (posterEmailError) {
          console.error("❌ Failed to send poster deputy acceptance email:", posterEmailError);
        }
      }

      return res.status(200).send("<Response/>");
    }

    // action === "decline"
    {
      const now = new Date();
      const safeMusicianId = asObjectIdString(musician._id || musician.musicianId);

      job.status = "open";
      job.workflowStage = "sent_to_matches";
      job.allocatedMusicianId = null;
      job.allocatedMusicianName = "";
      job.allocatedAt = null;
      job.bookedMusicianId = null;
      job.bookedMusicianName = "";
      job.bookingConfirmedAt = null;

      job.applications = (job.applications || []).map((application) => {
        const sameMusician = asObjectIdString(application?.musicianId) === safeMusicianId;
        return {
          ...application,
          status: sameMusician ? "declined" : application.status,
          declinedAt: sameMusician ? now : application.declinedAt || null,
        };
      });

      job.notifications = [
        ...(job.notifications || []),
        {
          musicianId: musician._id,
          email: musicianEmail,
          phone: musicianPhone,
          channel: "whatsapp",
          type: "allocation_declined",
          subject: `Deputy declined: ${jobTitle}`,
          previewHtml: "",
          previewText: `Declined via WhatsApp by ${musicianName}`,
          providerMessageId: inboundMessageSid,
          status: "sent",
          sentAt: now,
        },
      ];

      await job.save();

      if (musicianPhone) {
        try {
          await sendWhatsAppText(
            musicianPhone,
            "Thanks for letting us know. We’ve updated the job and will look for another deputy.",
          );
        } catch (whatsAppError) {
          console.error("❌ Failed to send deputy decline WhatsApp confirmation:", whatsAppError);
        }
      }

      if (posterEmail) {
        try {
          const requiredInstruments = normaliseList(job?.requiredInstruments);
          const essentialSkills = normaliseList(job?.essentialRoles);
          const requiredSkills = normaliseList(job?.requiredSkills);
          const preferredExtraSkills = normaliseList(job?.desiredRoles);
          const secondaryInstruments = normaliseList(job?.secondaryInstruments);
          const genres = normaliseList(job?.genres);
          const tags = normaliseList(job?.tags);
          const setLengths = normaliseList(job?.setLengths);
          const whatsIncluded = normaliseList(job?.whatsIncluded);
          const claimableExpenses = normaliseList(job?.claimableExpenses);

          const callTime = normaliseString(job?.callTime || job?.startTime || "");
          const finishTime = normaliseString(job?.finishTime || job?.endTime || "");
          const notes = normaliseString(job?.notes || "");

          await sendEmail({
            to: posterEmail,
            bcc: DEPUTY_JOB_BCC_EMAIL,
            subject: `Deputy declined: ${jobTitle}`,
            html: `
              <div style="margin:0; padding:0; background:#f7f7f7; font-family:Arial, sans-serif; color:#111;">
                <div style="max-width:700px; margin:0 auto; padding:32px 20px;">
                  <div style="background:#111; border-radius:20px 20px 0 0; padding:28px 32px; text-align:left;">
                    <p style="margin:0; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#ff6667; font-weight:700;">
                      The Supreme Collective
                    </p>
                    <h1 style="margin:12px 0 0; font-size:28px; line-height:1.2; color:#fff;">
                      Deputy Declined
                    </h1>
                    <p style="margin:12px 0 0; font-size:15px; line-height:1.6; color:#f3f3f3;">
                      Your selected deputy is no longer available, and the job has been reopened so you can choose another suitable option.
                    </p>
                  </div>

                  <div style="background:#ffffff; border:1px solid #e8e8e8; border-top:0; border-radius:0 0 20px 20px; padding:32px;">
                    <p style="margin:0 0 18px; font-size:16px; line-height:1.7; color:#333;">
                      Hi ${escapeHtml(normaliseString(job?.createdByName || "there"))},
                    </p>

                    <p style="margin:0 0 16px; font-size:15px; line-height:1.7; color:#444;">
                      We wanted to let you know that <strong>${escapeHtml(musicianDisplayName || "the allocated deputy")}</strong> is no longer available for
                      <strong>${escapeHtml(jobTitle)}</strong>.
                    </p>

                    <p style="margin:0 0 24px; font-size:15px; line-height:1.7; color:#444;">
                      The deputy job has now been <strong>reopened</strong>, so you can return to the job board and allocate another deputy when ready.
                    </p>

                    <div style="margin-bottom:24px; padding:24px; background:#fafafa; border:1px solid #ececec; border-radius:18px;">
                      <h3 style="margin:0 0 14px; font-size:16px; color:#111;">Declined deputy</h3>
                      <ul style="padding-left:20px; margin:0; font-size:14px; line-height:1.8; color:#333;">
                        <strong>Name:</strong> ${escapeHtml(musicianDisplayName || "Not provided")}

                      </ul>
                    </div>

                    <div style="margin-bottom:24px; padding:24px; background:#fafafa; border:1px solid #ececec; border-radius:18px;">
                      <h3 style="margin:0 0 14px; font-size:16px; color:#111;">Job details</h3>
                      <ul style="padding-left:20px; margin:0; font-size:14px; line-height:1.8; color:#333;">
                        ${renderDetailRow("Job", jobTitle)}
                        ${renderDetailRow("Date", dateText)}
                        ${renderDetailRow("Call time", callTime)}
                        ${renderDetailRow("Finish time", finishTime)}
                        ${renderDetailRow("Location", location)}
                        ${renderDetailRow("Fee", feeText)}
                        ${renderDetailListRow("Required instruments", requiredInstruments)}
                        ${renderDetailListRow("Essential skills", essentialSkills)}
                        ${renderDetailListRow("Required skills", requiredSkills)}
                        ${renderDetailListRow("Preferred extra skills", preferredExtraSkills)}
                        ${renderDetailListRow("Secondary instruments", secondaryInstruments)}
                        ${renderDetailListRow("Genres", genres)}
                        ${renderDetailListRow("Tags", tags)}
                        ${renderDetailListRow("Set lengths", setLengths)}
                        ${renderDetailListRow("What's included", whatsIncluded)}
                        ${renderDetailListRow("Claimable expenses", claimableExpenses)}
                        ${renderDetailRow("Notes", notes)}
                      </ul>
                    </div>

                    <p style="margin:24px 0 0; font-size:15px; line-height:1.7; color:#444;">
                      Best wishes,<br/>
                      <strong>The Supreme Collective</strong>
                    </p>
                  </div>
                </div>
              </div>
            `,
          });
        } catch (posterEmailError) {
          console.error("❌ Failed to send poster deputy decline email:", posterEmailError);
        }
      }

      return res.status(200).send("<Response/>");
    }
  } catch (error) {
    console.error("❌ twilioInboundDeputyAllocation error:", error);
    return res.status(200).send("<Response/>");
  }
};

export const twilioInboundDeputyJob = async (req, res) => {
  try {
    const bodyText = String(req.body?.Body || "");
    const buttonText = String(req.body?.ButtonText || "");
    const buttonPayload = String(req.body?.ButtonPayload || "");
    const fromRaw = String(req.body?.From || req.body?.WaId || "");
    const repliedSid = String(req.body?.OriginalRepliedMessageSid || "");

    const rawReply = buttonPayload || buttonText || bodyText || "";
    const replyType = interpretDeputyReply(rawReply);

    console.log("🟣 twilioInboundDeputyJob", {
      fromRaw,
      bodyText,
      buttonText,
      buttonPayload,
      repliedSid,
      replyType,
    });

    if (!replyType) {
      console.warn("⚠️ Could not interpret deputy WhatsApp reply");
      return res.status(200).send("<Response/>");
    }

    const jobId = extractDeputyJobIdFromReply(rawReply);

    const job = await findDeputyJobFromInboundReply({
      jobId,
      repliedSid,
      fromRaw,
    });

    if (!job) {
      console.warn("⚠️ No deputy job matched inbound WhatsApp reply", {
        fromRaw,
        repliedSid,
        rawReply,
      });
      return res.status(200).send("<Response/>");
    }

    const application =
      findDeputyApplicationByPhone(job, fromRaw) ||
      findApplicationFromJob(job, job.allocatedMusicianId);

    const musicianId =
      asObjectIdString(application?.musicianId) ||
      asObjectIdString(job.allocatedMusicianId);

    const musician = musicianId
      ? await findMatchedMusicianFromJob(job, musicianId)
      : null;

    if (!musician) {
      console.warn("⚠️ No musician matched inbound deputy reply", {
        jobId: String(job._id),
        fromRaw,
      });
      return res.status(200).send("<Response/>");
    }

    const now = new Date();

    if (replyType === "accepted") {
      job.status = "filled";
      job.workflowStage = "booking_confirmed";
      job.bookedMusicianId = musician._id;
      job.bookedMusicianName = [musician.firstName, musician.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      job.bookingConfirmedAt = now;

      job.applications = (job.applications || []).map((existingApplication) => {
        const sameMusician =
          asObjectIdString(existingApplication.musicianId) ===
          asObjectIdString(musician._id);

        return {
          ...existingApplication,
          status: sameMusician ? "booked" : existingApplication.status,
          bookedAt: sameMusician ? now : existingApplication.bookedAt || null,
        };
      });

      job.notifications = [
        ...(job.notifications || []),
        {
          musicianId: musician._id,
          email: musician.email || application?.email || "",
          phone:
            musician.phone || musician.phoneNumber || application?.phone || "",
          channel: "whatsapp",
          type: "booking_confirmation",
          subject: `Accepted via WhatsApp: ${job.title || job.instrument || "Deputy job"}`,
          previewText: `Accepted by ${
            [musician.firstName, musician.lastName]
              .filter(Boolean)
              .join(" ")
              .trim() || "allocated deputy"
          }`,
          providerMessageId: repliedSid,
          status: "sent",
          sentAt: now,
        },
      ];

      await job.save();

      console.log("✅ Deputy job accepted via WhatsApp", {
        jobId: String(job._id),
        musicianId: String(musician._id),
      });

      return res.status(200).send("<Response/>");
    }

    job.status = "open";
    job.workflowStage =
      job.notifiedCount > 0 ? "sent_to_matches" : "applications_open";
    job.bookedMusicianId = null;
    job.bookedMusicianName = "";
    job.bookingConfirmedAt = null;
    job.allocatedMusicianId = null;
    job.allocatedMusicianName = "";
    job.allocatedAt = null;

    job.applications = (job.applications || []).map((existingApplication) => {
      const sameMusician =
        asObjectIdString(existingApplication.musicianId) ===
        asObjectIdString(musician._id);

      return {
        ...existingApplication,
        status: sameMusician ? "declined" : existingApplication.status,
        declinedAt: sameMusician ? now : existingApplication.declinedAt || null,
      };
    });

    job.notifications = [
      ...(job.notifications || []),
      {
        musicianId: musician._id,
        email: musician.email || application?.email || "",
        phone:
          musician.phone || musician.phoneNumber || application?.phone || "",
        channel: "whatsapp",
        type: "manual",
        subject: `Declined via WhatsApp: ${job.title || job.instrument || "Deputy job"}`,
        previewText: `Declined by ${
          [musician.firstName, musician.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() || "allocated deputy"
        }`,
        providerMessageId: repliedSid,
        status: "sent",
        sentAt: now,
      },
    ];

    await job.save();

    console.log("↩️ Deputy job declined via WhatsApp and reopened", {
      jobId: String(job._id),
      musicianId: String(musician._id),
    });

    return res.status(200).send("<Response/>");
  } catch (error) {
    console.error("❌ twilioInboundDeputyJob error:", error);
    return res.status(200).send("<Response/>");
  }
};

export const updateDeputyJobApplicationStatus = async (req, res) => {
  try {
    const { status, notes = "" } = req.body || {};
    const { id, musicianId } = req.params;

    const allowedStatuses = [
      "applied",
      "shortlisted",
      "allocated",
      "booked",
      "declined",
      "withdrawn",
      "presented",
    ];

    if (!allowedStatuses.includes(normaliseString(status))) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid application status" });
    }

    const job = await deputyJobModel.findById(id);
    if (!job) {
      return res
        .status(404)
        .json({ success: false, message: "Deputy job not found" });
    }

    const applicationIndex = (job.applications || []).findIndex(
      (application) =>
        asObjectIdString(application.musicianId) ===
        asObjectIdString(musicianId),
    );

    if (applicationIndex === -1) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const nextStatus = normaliseString(status);
    job.applications[applicationIndex].status = nextStatus;
    job.applications[applicationIndex].notes = normaliseString(notes);

    const now = new Date();
    if (nextStatus === "presented")
      job.applications[applicationIndex].presentedAt = now;
    if (nextStatus === "shortlisted")
      job.applications[applicationIndex].shortlistedAt = now;
    if (nextStatus === "allocated")
      job.applications[applicationIndex].allocatedAt = now;
    if (nextStatus === "booked")
      job.applications[applicationIndex].bookedAt = now;
    if (nextStatus === "declined")
      job.applications[applicationIndex].declinedAt = now;
    if (nextStatus === "withdrawn")
      job.applications[applicationIndex].withdrawnAt = now;

    await job.save();

    const formattedJob = withDeputyJobAliases(job);

    return res.json({
      success: true,
      message: "Application status updated",
      job: formattedJob,
      application: job.applications[applicationIndex],
    });
  } catch (error) {
    console.error("❌ updateDeputyJobApplicationStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update application status",
      error: error.message,
    });
  }
};

export const getStripeConnectPayoutStatus = async (req, res) => {
  try {
    const musicianId = req.user?._id || req.user?.id;
    if (!musicianId) {
      return res.status(401).json({
        success: false,
        message: "You must be logged in",
      });
    }

    const musician = await musicianModel.findById(musicianId).lean();
    if (!musician) {
      return res.status(404).json({
        success: false,
        message: "Musician not found",
      });
    }

    const stripeConnect = musician?.stripeConnect || {};

    const accountId = normaliseString(stripeConnect.accountId || "");
    const detailsSubmitted = Boolean(stripeConnect.detailsSubmitted);
    const chargesEnabled = Boolean(stripeConnect.chargesEnabled);
    const payoutsEnabled = Boolean(stripeConnect.payoutsEnabled);

    let status = "not_connected";
    if (accountId) status = "incomplete";
    if (accountId && detailsSubmitted && payoutsEnabled) status = "ready";

    return res.json({
      success: true,
      payoutStatus: {
        status,
        accountId,
        detailsSubmitted,
        chargesEnabled,
        payoutsEnabled,
      },
    });
  } catch (error) {
    console.error("❌ getStripeConnectPayoutStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payout status",
      error: error.message,
    });
  }
};

export const previewDeputyJobNotification = async (req, res) => {
  try {
    console.log("🟣 previewDeputyJobNotification hit", {
      jobId: req.params?.id,
      method: req.method,
      body: req.body,
      userId: req.user?._id || req.user?.id || null,
      userEmail: req.user?.email || null,
    });

    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      console.warn("⚠️ previewDeputyJobNotification: job not found", {
        jobId: req.params?.id,
      });

      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    console.log("🟣 previewDeputyJobNotification: job found", {
      jobId: String(job._id),
      title: job.title || "",
      instrument: job.instrument || "",
      createdByEmail: job.createdByEmail || "",
      status: job.status || "",
      workflowStage: job.workflowStage || "",
    });

    const matches = (await getMatchedMusiciansForJob(job)) || [];

    console.log("🟣 previewDeputyJobNotification: matches loaded", {
      jobId: String(job._id),
      matchedCount: matches.length,
      firstMatches: matches.slice(0, 10).map((m) => ({
        id: m?._id || m?.musicianId || null,
        firstName: m?.firstName || "",
        lastName: m?.lastName || "",
        email: m?.email || "",
        phone: m?.phone || m?.phoneNumber || "",
        deputyMatchScore: m?.deputyMatchScore || null,
        matchPct: m?.matchPct || null,
      })),
    });

    const previewRecipientEmail =
      normaliseEmail(req.body?.previewEmail || "") ||
      normaliseEmail(req.user?.email || "") ||
      normaliseEmail(job.createdByEmail || "");

    console.log("🟣 previewDeputyJobNotification: recipient resolution", {
      bodyPreviewEmail: req.body?.previewEmail || "",
      userEmail: req.user?.email || "",
      jobCreatedByEmail: job.createdByEmail || "",
      resolvedPreviewRecipientEmail: previewRecipientEmail || "",
    });

    const previewNotification = buildJobNotificationPreview({
      job,
      musicians: matches,
      previewRecipientEmail,
    });

    console.log("🟣 previewDeputyJobNotification: preview built", {
      subject: previewNotification?.subject || "",
      recipientsCount: Array.isArray(previewNotification?.recipients)
        ? previewNotification.recipients.length
        : 0,
      hasHtml: Boolean(previewNotification?.html),
      hasText: Boolean(previewNotification?.text),
      htmlLength: previewNotification?.html?.length || 0,
      textLength: previewNotification?.text?.length || 0,
    });

    let emailSent = false;
    let emailError = "";

    if (previewRecipientEmail) {
      try {
        await sendEmail({
          to: previewRecipientEmail,
          bcc: DEPUTY_JOB_BCC_EMAIL,
          subject: `[Preview] ${previewNotification.subject}`,
          html: previewNotification.html,
          text: previewNotification.text,
        });

        emailSent = true;

        console.log("✅ previewDeputyJobNotification: preview email sent", {
          to: previewRecipientEmail,
          subject: `[Preview] ${previewNotification.subject}`,
        });
      } catch (sendError) {
        emailError = sendError?.message || "Failed to send preview email";

        console.error(
          "❌ previewDeputyJobNotification: failed to send preview email",
          {
            to: previewRecipientEmail,
            message: sendError?.message,
            stack: sendError?.stack,
          }
        );
      }
    }

    return res.json({
      success: true,
      message: emailSent
        ? `Preview email sent to ${previewRecipientEmail}`
        : previewRecipientEmail
        ? "Preview generated, but email failed to send"
        : "Preview generated successfully",
      emailSent,
      emailError,
      previewRecipientEmail,
      job: withDeputyJobAliases(job),
      matchedCount: matches.length,
      previewNotification,
      recipients: previewNotification?.recipients || [],
    });
  } catch (error) {
    console.error("❌ previewDeputyJobNotification error:", {
      message: error?.message,
      stack: error?.stack,
    });

    return res.status(500).json({
      success: false,
      message: "Failed to preview deputy job notification",
      error: error.message,
    });
  }
};

export const sendDeputyJobTestNotification = async (req, res) => {
  try {
    console.log("🟣 sendDeputyJobTestNotification hit", {
      jobId: req.params?.id,
      method: req.method,
      body: req.body,
      userId: req.user?._id || req.user?.id || null,
      userEmail: req.user?.email || null,
    });

    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      console.warn("⚠️ sendDeputyJobTestNotification: job not found", {
        jobId: req.params?.id,
      });

      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    console.log("🟣 sendDeputyJobTestNotification: job found", {
      jobId: String(job._id),
      title: job.title || "",
      instrument: job.instrument || "",
      createdByEmail: job.createdByEmail || "",
    });

    const testEmail = normaliseEmail(
      req.body?.email || req.user?.email || job.createdByEmail || "",
    );

    console.log("🟣 sendDeputyJobTestNotification: resolved test email", {
      bodyEmail: req.body?.email || "",
      userEmail: req.user?.email || "",
      jobCreatedByEmail: job.createdByEmail || "",
      testEmail,
    });

    if (!testEmail) {
      console.warn("⚠️ sendDeputyJobTestNotification: no test email resolved");

      return res.status(400).json({
        success: false,
        message: "A test email address is required",
      });
    }

    const matches = (await getMatchedMusiciansForJob(job)) || [];

    console.log("🟣 sendDeputyJobTestNotification: matches loaded", {
      matchedCount: matches.length,
      firstMatches: matches.slice(0, 10).map((m) => ({
        id: m?._id || m?.musicianId || null,
        firstName: m?.firstName || "",
        lastName: m?.lastName || "",
        email: m?.email || "",
        deputyMatchScore: m?.deputyMatchScore || null,
        matchPct: m?.matchPct || null,
      })),
    });

    const previewNotification = buildJobNotificationPreview({
      job,
      musicians: matches,
      previewRecipientEmail: testEmail,
    });

    const correctionIntroHtml = `
      <div style="margin:0 0 24px; padding:18px 20px; border:1px solid #f1d0d1; background:#fff7f7; border-radius:16px; font-family:Arial, sans-serif; color:#333; line-height:1.7;">
        <p style="margin:0 0 12px;"><strong>Quick update:</strong> there was an error with the links in the last email that went out about this deputy job. The links in this email should now work correctly.</p>
        <p style="margin:0 0 12px;">If you have not yet registered with The Supreme Collective, updated your profile, logged in, or completed onboarding, you may be prompted to log in first.</p>
        <p style="margin:0 0 12px;">If you cannot log in, please use the <strong>Forgot password</strong> option to create a new password. Once that is done, you should be able to continue through to the job page.</p>
        <p style="margin:0;">You can also find the deputy job board link from your dashboard once you are logged in.</p>
      </div>
    `;

    const correctionIntroText = [
      "Quick update: there was an error with the links in the last email that went out about this deputy job. The links in this email should now work correctly.",
      "",
      "If you have not yet registered with The Supreme Collective, updated your profile, logged in, or completed onboarding, you may be prompted to log in first.",
      "",
      "If you cannot log in, please use the Forgot password option to create a new password. Once that is done, you should be able to continue through to the job page.",
      "",
      "You can also find the deputy job board link from your dashboard once you are logged in.",
    ].join("\n");

    const emailHtml = `${correctionIntroHtml}${previewNotification?.html || ""}`;
    const emailText = [correctionIntroText, previewNotification?.text || ""]
      .filter(Boolean)
      .join("\n\n");

    console.log("🟣 sendDeputyJobTestNotification: preview built", {
      subject: previewNotification?.subject || "",
      recipients: previewNotification?.recipients || [],
      hasHtml: Boolean(emailHtml),
      hasText: Boolean(emailText),
      htmlLength: emailHtml?.length || 0,
      textLength: emailText?.length || 0,
    });

    const emailResult = await sendEmail({
      to: testEmail,
      bcc: DEPUTY_JOB_BCC_EMAIL,
      subject: `[Test] ${previewNotification.subject}`,
      html: emailHtml,
      text: emailText,
    });

    console.log(
      "🟣 sendDeputyJobTestNotification: sendEmail result",
      emailResult,
    );

    job.notifications = [
      ...(job.notifications || []),
      {
        musicianId: null,
        email: testEmail,
        phone: "",
        channel: "email",
        type: "job_created_preview",
        subject: `[Test] ${previewNotification.subject}`,
        previewHtml: emailHtml,
        previewText: emailText,
        status: emailResult?.ok ? "sent" : "failed",
        sentAt: new Date(),
        error: emailResult?.ok ? "" : emailResult?.error || "Email send failed",
      },
    ];

    await job.save();

    return res.json({
      success: Boolean(emailResult?.ok),
      message: emailResult?.ok
        ? `Test notification sent to ${testEmail}`
        : `Test notification failed for ${testEmail}`,
      testEmail,
      previewNotification: {
        ...previewNotification,
        html: emailHtml,
        text: emailText,
      },
      emailResult,
    });
  } catch (error) {
    console.error("❌ sendDeputyJobTestNotification error:", {
      message: error?.message,
      stack: error?.stack,
    });

    return res.status(500).json({
      success: false,
      message: "Failed to send test notification",
      error: error.message,
    });
  }
};

export const resendDeputyJobNotifications = async (req, res) => {
  try {
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    const hasSavedCardDetails =
      Boolean(normaliseString(job?.stripeCustomerId)) &&
      Boolean(normaliseString(job?.defaultPaymentMethodId)) &&
      job?.paymentStatus === "ready_to_charge";

    if (!hasSavedCardDetails) {
      return res.status(400).json({
        success: false,
        message:
          "Card details must be completed and saved before deputy notifications can be sent.",
        job: withDeputyJobAliases(job),
      });
    }

    const matches = await getMatchedMusiciansForJob(job);

    if (!Array.isArray(matches) || !matches.length) {
      return res.status(400).json({
        success: false,
        message: "No matched musicians found for this deputy job.",
        job: withDeputyJobAliases(job),
      });
    }

    const alreadyNotifiedIds = new Set(
      [
        ...(Array.isArray(job.notifiedMusicianIds)
          ? job.notifiedMusicianIds
          : []),
        ...(Array.isArray(job.notifications)
          ? job.notifications
              .filter((n) => n?.status === "sent" && n?.musicianId)
              .map((n) => n.musicianId)
          : []),
      ]
        .map((id) => asObjectIdString(id))
        .filter(Boolean),
    );

    const remainingMatches = matches.filter((musician) => {
      const musicianId = asObjectIdString(
        musician?._id || musician?.id || musician?.musicianId,
      );
      return musicianId && !alreadyNotifiedIds.has(musicianId);
    });

    if (!remainingMatches.length) {
      return res.json({
        success: true,
        message: "No remaining matched musicians to notify",
        job: withDeputyJobAliases(job),
        newlyNotifiedCount: 0,
        notificationResults: [],
      });
    }

    const correctionIntroHtml = `
      <div style="margin:0 0 24px; padding:18px 20px; border:1px solid #f1d0d1; background:#fff7f7; border-radius:16px; font-family:Arial, sans-serif; color:#333; line-height:1.7;">
        <p style="margin:0 0 12px;"><strong>Quick update:</strong> there was an error with the links in the last email that went out about this deputy job. The links in this email should now work correctly.</p>
        <p style="margin:0 0 12px;">If you have not yet registered with The Supreme Collective, updated your profile, logged in, or completed onboarding, you may be prompted to log in first.</p>
        <p style="margin:0 0 12px;">If you cannot log in, please use the <strong>Forgot password</strong> option to create a new password. Once that is done, you should be able to continue through to the job page.</p>
        <p style="margin:0;">You can also find the deputy job board link from your dashboard once you are logged in.</p>
      </div>
    `;

    const correctionIntroText = [
      "Quick update: there was an error with the links in the last email that went out about this deputy job. The links in this email should now work correctly.",
      "",
      "If you have not yet registered with The Supreme Collective, updated your profile, logged in, or completed onboarding, you may be prompted to log in first.",
      "",
      "If you cannot log in, please use the Forgot password option to create a new password. Once that is done, you should be able to continue through to the job page.",
      "",
      "You can also find the deputy job board link from your dashboard once you are logged in.",
    ].join("\n");

    const notificationResults = [];

    for (const musician of remainingMatches) {
      const preview = buildJobNotificationPreview({
        job,
        musicians: [musician],
        previewRecipientEmail: normaliseEmail(musician?.email || ""),
      });

      const emailHtml = `${correctionIntroHtml}${preview?.html || ""}`;
      const emailText = [correctionIntroText, preview?.text || ""]
        .filter(Boolean)
        .join("\n\n");

      const emailResult = await sendEmail({
        to: musician?.email || "",
        bcc: DEPUTY_JOB_BCC_EMAIL,
        subject: `Corrected Links: ${preview.subject}`,
        html: emailHtml,
        text: emailText,
      });

      notificationResults.push({
        musicianId: musician?._id || musician?.musicianId || null,
        email: musician?.email || "",
        phone: musician?.phone || musician?.phoneNumber || "",
        channel: "email",
        type: "job_created_corrected",
        subject: `Corrected Links: ${preview.subject}`,
        previewHtml: emailHtml,
        previewText: emailText,
        status: emailResult?.ok ? "sent" : "failed",
        sentAt: new Date(),
        error: emailResult?.ok ? "" : emailResult?.error || "Email send failed",
      });
    }

    const sentIds = notificationResults
      .filter((r) => r.status === "sent" && r.musicianId)
      .map((r) => r.musicianId);

    const allSentIds = Array.from(
      new Set(
        [
          ...(Array.isArray(job.notifiedMusicianIds)
            ? job.notifiedMusicianIds
            : []),
          ...sentIds,
        ]
          .map((id) => asObjectIdString(id))
          .filter(Boolean),
      ),
    );

    job.notifiedMusicianIds = allSentIds;
    job.notifiedCount = allSentIds.length;

    job.notifications = [...(job.notifications || []), ...notificationResults];

    job.status = "open";
    job.previewMode = false;
    job.workflowStage = "sent_to_matches";
    job.matchedMusicians = (job.matchedMusicians || []).map((m) => ({
      ...m,
      notified: allSentIds.some(
        (id) => asObjectIdString(id) === asObjectIdString(m.musicianId),
      ),
      notifiedAt: sentIds.some(
        (id) => asObjectIdString(id) === asObjectIdString(m.musicianId),
      )
        ? new Date()
        : m.notifiedAt || null,
    }));

    await job.save();

    return res.json({
      success: true,
      message: "Corrected notifications resent",
      job: withDeputyJobAliases(job),
      newlyNotifiedCount: sentIds.length,
      notifiedCount: job.notifiedCount,
      notificationResults,
    });
  } catch (error) {
    console.error("❌ resendDeputyJobNotifications error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to resend deputy job notifications",
      error: error.message,
    });
  }
};

export const sendRemainingDeputyJobNotifications = async (req, res) => {
  try {
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    const isEnquiryJob = String(job?.jobType || "").toLowerCase() === "enquiry";

    const hasSavedCardDetails =
      Boolean(normaliseString(job?.stripeCustomerId)) &&
      Boolean(normaliseString(job?.defaultPaymentMethodId)) &&
      ["ready_to_charge", "paid"].includes(normaliseString(job?.paymentStatus));

    if (!isEnquiryJob && !hasSavedCardDetails) {
      return res.status(400).json({
        success: false,
        message:
          "Card details must be completed and saved before deputy notifications can be sent.",
        job: withDeputyJobAliases(job),
      });
    }

    const matches = await getMatchedMusiciansForJob(job);

    const alreadyNotifiedIds = new Set(
      [
        ...(Array.isArray(job.notifiedMusicianIds)
          ? job.notifiedMusicianIds
          : []),
        ...(Array.isArray(job.notifications)
          ? job.notifications
              .filter((n) => n?.status === "sent")
              .map((n) => n?.musicianId)
          : []),
      ]
        .map((id) => asObjectIdString(id))
        .filter(Boolean),
    );

    const remainingMatches = matches.filter((musician) => {
      const musicianId = asObjectIdString(musician?._id || musician?.id);
      return musicianId && !alreadyNotifiedIds.has(musicianId);
    });

    if (!remainingMatches.length) {
      return res.json({
        success: true,
        message: "No remaining matched musicians to notify",
        job: withDeputyJobAliases(job),
        newlyNotifiedCount: 0,
        notificationResults: [],
      });
    }

    const notificationResults = await notifyMusiciansAboutDeputyJob({
      job,
      musicians: remainingMatches,
    });

    const newSentIds = notificationResults
      .filter((r) => r.status === "sent" && r.musicianId)
      .map((r) => r.musicianId);

    const allSentIds = Array.from(
      new Set(
        [
          ...(Array.isArray(job.notifiedMusicianIds)
            ? job.notifiedMusicianIds
            : []),
          ...newSentIds,
        ]
          .map((id) => asObjectIdString(id))
          .filter(Boolean),
      ),
    );

    job.notifiedMusicianIds = allSentIds;
    job.notifications = [
      ...(Array.isArray(job.notifications) ? job.notifications : []),
      ...notificationResults,
    ];
    job.notifiedCount = allSentIds.length;
    job.status = "open";
    job.previewMode = false;
    job.workflowStage = "sent_to_matches";

    job.matchedMusicians = (job.matchedMusicians || []).map((m) => {
      const id = asObjectIdString(m?.musicianId);
      const wasNewlySent = newSentIds.some(
        (sentId) => asObjectIdString(sentId) === id,
      );

      return {
        ...m,
        notified: allSentIds.includes(id),
        notifiedAt: wasNewlySent ? new Date() : m.notifiedAt || null,
      };
    });

    await job.save();

    return res.json({
      success: true,
      message: `${newSentIds.length} remaining matched musicians notified`,
      job: withDeputyJobAliases(job),
      matchedCount: matches.length,
      newlyNotifiedCount: newSentIds.length,
      notifiedCount: job.notifiedCount,
      notificationResults,
    });
  } catch (error) {
    console.error("❌ sendRemainingDeputyJobNotifications error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send remaining deputy job notifications",
      error: error.message,
    });
  }
};

export const sendDeputyJobNotificationsToUnnotified =
  sendRemainingDeputyJobNotifications;

export const createDeputyJobSetupIntent = async (req, res) => {
  try {
    if (!ensureStripeReady(res)) return;

    const job = await deputyJobModel.findById(req.params.id);
    if (!job) {
      return res
        .status(404)
        .json({ success: false, message: "Deputy job not found" });
    }

    const result = await createOrRefreshDeputyJobSetupIntentInternal({
      job,
      clientName: req.body?.clientName || job.clientName || "",
      clientEmail: req.body?.clientEmail || job.clientEmail || "",
      clientPhone: req.body?.clientPhone || job.clientPhone || "",
      createdBy: req.user?._id || null,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message || "Failed to create SetupIntent",
      });
    }

    await job.save();

    const formattedJob = withDeputyJobAliases(job);

    return res.json({
      success: true,
      message: "SetupIntent created",
      clientSecret: result.clientSecret,
      setupIntentId: result.setupIntentId,
      stripeCustomerId: result.stripeCustomerId,
      paymentStatus: result.paymentStatus,
      job: formattedJob,
    });
  } catch (error) {
    console.error("❌ createDeputyJobSetupIntent error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create SetupIntent",
      error: error.message,
    });
  }
};

export const closeDeputyJob = async (req, res) => {
  try {
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    job.status = "closed";
    job.workflowStage = "closed";

    await job.save();

    return res.json({
      success: true,
      message: "Deputy job closed successfully",
      job: withDeputyJobAliases(job),
    });
  } catch (error) {
    console.error("❌ closeDeputyJob error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to close deputy job",
      error: error.message,
    });
  }
};

export const presentDeputyApplicant = async (req, res) => {
  try {
    if (!canManuallyAllocateDeputyJob(req)) {
      return res.status(403).json({
        success: false,
        message: "Only admin or agent users can present deputy applicants",
      });
    }

    const { musicianId } = req.body || {};
    const safeMusicianId = asObjectIdString(musicianId);

    if (!safeMusicianId) {
      return res.status(400).json({
        success: false,
        message: "musicianId is required",
      });
    }

    const job = await deputyJobModel.findById(req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    if (String(job?.jobType || "").toLowerCase() !== "enquiry") {
      return res.status(400).json({
        success: false,
        message: "Applicants can only be presented on enquiry deputy jobs",
      });
    }

    const musician = await findMatchedMusicianFromJob(job, safeMusicianId);
    if (!musician) {
      return res.status(404).json({
        success: false,
        message: "Musician not found",
      });
    }

    const now = new Date();
    upsertPresentedApplicationForEnquiry({ job, musician, now });

    const email = normaliseEmail(
      musician?.email || musician?.basicInfo?.email || "",
    );
    const phone = toE164(
      musician?.phone ||
        musician?.phoneNumber ||
        musician?.basicInfo?.phone ||
        "",
    );

    const notificationPreview = buildApplicantPresentedEmailPreview({
      job,
      musician,
    });

    let whatsappSid = "";
    let whatsappErrorMessage = "";
    let emailSent = false;

    if (phone) {
      try {
        const whatsappResult = await sendDeputyAllocationWhatsApp({
          to: phone,
          job,
          musician,
        });
        whatsappSid = whatsappResult?.sid || "";
      } catch (whatsappError) {
        whatsappErrorMessage =
          whatsappError?.message || "WhatsApp presentation send failed";
        console.error("❌ presentDeputyApplicant WhatsApp error:", {
          jobId: String(job._id),
          musicianId: String(musician._id),
          phone,
          message: whatsappErrorMessage,
        });
      }
    }

    if (email) {
      try {
        await sendEmail({
          to: email,
          bcc: DEPUTY_JOB_BCC_EMAIL,
          subject: notificationPreview.subject,
          html: notificationPreview.html,
          text: notificationPreview.text,
        });
        emailSent = true;
      } catch (emailError) {
        console.error("❌ presentDeputyApplicant email error:", {
          jobId: String(job._id),
          musicianId: String(musician._id),
          email,
          message: emailError?.message || "Email send failed",
        });
      }
    }

    job.notifications = [
      ...(Array.isArray(job.notifications) ? job.notifications : []),
      {
        musicianId: musician._id,
        email,
        phone,
        channel: whatsappSid ? "whatsapp" : "email",
        type: "applicant_presented",
        subject: notificationPreview.subject,
        previewHtml: notificationPreview.html,
        previewText: notificationPreview.text,
        providerMessageId: whatsappSid,
        status: whatsappSid || emailSent ? "sent" : "failed",
        sentAt: new Date(),
        error:
          whatsappSid || emailSent
            ? ""
            : whatsappErrorMessage || "No contact details available",
      },
    ];

    await job.save();

    return res.json({
      success: true,
      message: "Applicant presented to client",
      job: withDeputyJobAliases(job),
      musician: {
        _id: musician._id,
        firstName: musician.firstName || musician.basicInfo?.firstName || "",
        lastName: musician.lastName || musician.basicInfo?.lastName || "",
        email,
        phone,
        musicianSlug: musician.musicianSlug || "",
      },
      notification: {
        whatsappSid,
        email,
      },
    });
  } catch (error) {
    console.error("❌ presentDeputyApplicant error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to present applicant",
      error: error.message,
    });
  }
};

export const manualAllocateDeputyJob = async (req, res) => {
  try {
    if (!canManuallyAllocateDeputyJob(req)) {
      return res.status(403).json({
        success: false,
        message: "Only admin or agent users can manually allocate deputy jobs",
      });
    }

    const {
      musicianId,
      skipCharge = false,
      retryAllocationOnly = false,
    } = req.body || {};
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    const isEnquiryJob =
      String(job?.jobType || "").toLowerCase() === "enquiry";

    if (!musicianId) {
      return res.status(400).json({
        success: false,
        message: "musicianId is required",
      });
    }

    const hasSuccessfulCharge =
      Boolean(job?.chargedAt) ||
      String(job?.paymentStatus || "").toLowerCase() === "paid" ||
      (Array.isArray(job?.paymentEvents) &&
        job.paymentEvents.some((event) => {
          const type = String(event?.type || "").toLowerCase();
          const status = String(event?.status || "").toLowerCase();
          return (
            (type === "payment_succeeded" ||
              type === "charge_succeeded" ||
              type === "payment_intent_succeeded") &&
            status === "succeeded"
          );
        }));

    const shouldSkipCharge =
      Boolean(skipCharge) ||
      Boolean(retryAllocationOnly) ||
      hasSuccessfulCharge;

    const musician = await musicianModel.findById(musicianId).lean();

    if (!musician) {
      return res.status(404).json({
        success: false,
        message: "Musician not found",
      });
    }

    const now = new Date();

    upsertManualApplicationForAllocation({ job, musician, now });

    job.allocatedMusicianId = musician._id;
    job.allocatedMusicianName = [musician.firstName, musician.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    job.allocatedAt = now;
    job.status = "allocated";
    job.workflowStage = "allocated";
    job.releaseOn = job.releaseOn || buildDefaultReleaseOn(job.eventDate);

    if (!job.grossAmount && !job.commissionAmount && !job.deputyNetAmount) {
      const ledger = buildLedgerAmounts({
        fee: job.fee,
        grossAmount: job.grossAmount,
        commissionAmount: job.commissionAmount,
        deputyNetAmount: job.deputyNetAmount,
        stripeFeeAmount: job.stripeFeeAmount,
        deductStripeFeesFromDeputy: true,
      });
      job.grossAmount = ledger.grossAmount;
      job.commissionAmount = ledger.commissionAmount;
      job.deputyNetAmount = ledger.deputyNetAmount;
      job.stripeFeeAmount = ledger.stripeFeeAmount;
    }

    let chargeResult = null;

    if (!isEnquiryJob) {
      if (shouldSkipCharge) {
        chargeResult = {
          success: true,
          skipped: true,
          alreadyCharged: true,
          message: "Charge skipped because payment already succeeded",
        };
      } else if (job.stripeCustomerId && job.defaultPaymentMethodId) {
        chargeResult = await attemptDeputyJobCharge({
          job,
          createdBy: req.user?._id || null,
        });
      } else if (job.clientEmail) {
        job.paymentStatus = "setup_required";
      }
    } else {
      job.paymentStatus = "not_required";
    }

    const application = findApplicationFromJob(job, musician._id);
    const targetPhone = toE164(
      musician?.phone ||
        musician?.phoneNumber ||
        application?.phoneNormalized ||
        application?.phone ||
        "",
    );

    let whatsappResult = null;
    let whatsappErrorMessage = "";

    if (targetPhone) {
      try {
        whatsappResult = await sendDeputyAllocationWhatsApp({
          to: targetPhone,
          job,
          musician,
        });
      } catch (whatsappError) {
        whatsappErrorMessage =
          whatsappError?.message || "WhatsApp allocation send failed";

        console.error(
          "❌ manualAllocateDeputyJob sendDeputyAllocationWhatsApp error:",
          {
            jobId: String(job._id),
            musicianId: String(musician._id),
            targetPhone,
            message: whatsappErrorMessage,
            stack: whatsappError?.stack,
          },
        );
      }
    }

    job.notifications = [
      ...(job.notifications || []),
      {
        musicianId: musician._id,
        email: musician.email || application?.email || "",
        phone: targetPhone || "",
        channel: targetPhone ? "whatsapp" : "email",
        type: "allocation_request",
        subject: `Deputy allocation request: ${normaliseString(
          job.title || job.instrument || "Deputy opportunity",
        )}`,
        previewHtml: "",
        previewText: `Manual allocation request sent via ${
          targetPhone ? "WhatsApp" : "fallback"
        } to ${[musician.firstName, musician.lastName].filter(Boolean).join(" ").trim()}`,
        providerMessageId: whatsappResult?.sid || "",
        status: whatsappResult?.sid ? "sent" : "failed",
        sentAt: new Date(),
        error: whatsappResult?.sid
          ? ""
          : targetPhone
            ? whatsappErrorMessage || "WhatsApp allocation send failed"
            : "No phone number available for allocation message",
      },
    ];

    await job.save();

    const responseMessage = chargeResult?.skipped
      ? whatsappResult?.sid
        ? "Deputy manually allocated and WhatsApp resent. Existing successful payment was reused"
        : "Deputy manually allocated. Existing successful payment was reused"
      : chargeResult?.success
        ? "Deputy manually allocated, WhatsApp sent and client charged"
        : whatsappResult?.sid
          ? "Deputy manually allocated and WhatsApp sent"
          : "Deputy manually allocated";

    return res.json({
      success: true,
      message: responseMessage,
      job: withDeputyJobAliases(job),
      allocatedMusician: musician,
      chargeResult,
      whatsappResult: whatsappResult
        ? {
            sid: whatsappResult.sid || "",
            status: whatsappResult.status || "",
          }
        : null,
    });
  } catch (error) {
    console.error("❌ manualAllocateDeputyJob error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to manually allocate deputy",
      error: error.message,
    });
  }
};


export const retryFailedDeputyJobNotifications = async (req, res) => {
  try {
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    const failedNotifications = Array.isArray(job.notifications)
      ? job.notifications.filter((n) => n?.status === "failed")
      : [];

    if (!failedNotifications.length) {
      return res.json({
        success: true,
        message: "No failed notifications found for this job.",
        job: withDeputyJobAliases(job),
        retryCount: 0,
        notificationResults: [],
      });
    }

    const failedMusicianIds = Array.from(
      new Set(
        failedNotifications
          .map((n) => asObjectIdString(n?.musicianId))
          .filter(Boolean),
      ),
    );

    const failedEmails = Array.from(
      new Set(
        failedNotifications
          .map((n) => normaliseEmail(n?.email || ""))
          .filter(Boolean),
      ),
    );

    let musicians = [];

    if (failedMusicianIds.length) {
      const musiciansById = await musicianModel
        .find({
          _id: { $in: failedMusicianIds },
        })
        .lean();

      musicians.push(...musiciansById);
    }

    if (failedEmails.length) {
      const existingIds = new Set(
        musicians.map((m) => asObjectIdString(m?._id)).filter(Boolean),
      );

      const musiciansByEmail = await musicianModel
        .find({
          email: { $in: failedEmails },
        })
        .lean();

      for (const musician of musiciansByEmail) {
        const id = asObjectIdString(musician?._id);
        if (!id || existingIds.has(id)) continue;
        musicians.push(musician);
      }
    }

    // fallback for failed notifications that have email but no matching musician doc
    const fallbackEmailOnlyRecipients = failedNotifications
      .filter((n) => {
        const email = normaliseEmail(n?.email || "");
        if (!email) return false;

        const alreadyLoaded = musicians.some(
          (m) => normaliseEmail(m?.email || "") === email,
        );

        return !alreadyLoaded;
      })
      .map((n) => ({
        _id: n?.musicianId || null,
        id: n?.musicianId || null,
        firstName: "",
        lastName: "",
        email: normaliseEmail(n?.email || ""),
        phone: n?.phone || "",
      }));

    musicians.push(...fallbackEmailOnlyRecipients);

    if (!musicians.length) {
      return res.status(400).json({
        success: false,
        message: "No resendable failed recipients could be resolved.",
        job: withDeputyJobAliases(job),
      });
    }

    const notificationResults = await notifyMusiciansAboutDeputyJob({
      job,
      musicians,
    });

    const successfulNotifications = notificationResults.filter(
      (r) => r?.status === "sent",
    );

    const successfulIds = successfulNotifications
      .map((r) => asObjectIdString(r?.musicianId))
      .filter(Boolean);

    const allSuccessfulIds = Array.from(
      new Set(
        [
          ...(Array.isArray(job.notifications)
            ? job.notifications
                .filter((n) => n?.status === "sent")
                .map((n) => asObjectIdString(n?.musicianId))
            : []),
          ...successfulIds,
        ].filter(Boolean),
      ),
    );

    job.notifications = [
      ...(Array.isArray(job.notifications) ? job.notifications : []),
      ...notificationResults,
    ];

    job.notifiedMusicianIds = allSuccessfulIds;
    job.notifiedCount = job.notifications.filter(
      (n) => n?.status === "sent",
    ).length;

    if (Array.isArray(job.matchedMusicians)) {
      job.matchedMusicians = job.matchedMusicians.map((m) => {
        const id = asObjectIdString(m?.musicianId);

        const sentNotification = job.notifications.find(
          (n) =>
            n?.status === "sent" &&
            id &&
            asObjectIdString(n?.musicianId) === id,
        );

        return {
          ...m,
          notified: Boolean(sentNotification),
          notifiedAt: sentNotification?.sentAt || m?.notifiedAt || null,
        };
      });
    }

    await job.save();

    return res.json({
      success: true,
      message: `${successfulNotifications.length} failed notifications retried successfully.`,
      job: withDeputyJobAliases(job),
      retryCount: musicians.length,
      successCount: successfulNotifications.length,
      notificationResults,
    });
  } catch (error) {
    console.error("❌ retryFailedDeputyJobNotifications error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retry failed deputy job notifications",
      error: error.message,
    });
  }
};

export const manualApplyDeputyJob = async (req, res) => {
  try {
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    const musicianId = String(req.body?.musicianId || "").trim();

    if (!musicianId) {
      return res.status(400).json({
        success: false,
        message: "musicianId is required",
      });
    }

    const musician = await musicianModel.findById(musicianId).lean();

    if (!musician) {
      return res.status(404).json({
        success: false,
        message: "Musician not found",
      });
    }

    const existingApplicationIndex = Array.isArray(job.applications)
      ? job.applications.findIndex(
          (application) =>
            String(application?.musicianId || "") === String(musician._id)
        )
      : -1;

    if (existingApplicationIndex !== -1) {
      return res.status(400).json({
        success: false,
        message: "This musician is already on the applications list",
        job: withDeputyJobAliases(job),
      });
    }

    const firstName = String(
      musician?.firstName || musician?.basicInfo?.firstName || ""
    ).trim();

    const lastName = String(
      musician?.lastName || musician?.basicInfo?.lastName || ""
    ).trim();

    const email = String(
      musician?.email || musician?.basicInfo?.email || ""
    )
      .trim()
      .toLowerCase();

    const phone = String(
      musician?.phone || musician?.phoneNumber || musician?.basicInfo?.phone || ""
    ).trim();

    const deputyMatchScore = Number(musician?.deputyMatchScore || 0);

    job.applications = Array.isArray(job.applications) ? job.applications : [];

    job.applications.push({
      musicianId: musician._id,
      firstName,
      lastName,
      email,
      phone,
      appliedAt: new Date(),
      status: "applied",
      notes: "Added manually by admin/agent",
      deputyMatchScore,
      matchSummary: {
        instrument: String(job?.instrument || ""),
        roleFit: 0,
        genreFit: 0,
        locationFit: 0,
        songFit: 0,
      },
    });

    job.applicationCount = job.applications.length;

    if (!Array.isArray(job.matchedMusicianIds)) {
      job.matchedMusicianIds = [];
    }

    const alreadyInMatchedIds = job.matchedMusicianIds.some(
      (id) => String(id) === String(musician._id)
    );

    if (!alreadyInMatchedIds) {
      job.matchedMusicianIds.push(musician._id);
    }

    job.matchedCount = Array.isArray(job.matchedMusicians)
      ? Math.max(job.matchedMusicians.length, job.applications.length)
      : job.applications.length;

    if (!Array.isArray(job.matchedMusicians)) {
      job.matchedMusicians = [];
    }

    const existingMatchedSnapshotIndex = job.matchedMusicians.findIndex(
      (entry) => String(entry?.musicianId || "") === String(musician._id)
    );

    if (existingMatchedSnapshotIndex === -1) {
      job.matchedMusicians.push({
        musicianId: musician._id,
        firstName,
        lastName,
        email,
        phone,
        profilePicture: String(
          musician?.profilePicture ||
            musician?.profilePhoto ||
            musician?.profileImage ||
            ""
        ).trim(),
        musicianSlug: String(musician?.musicianSlug || "").trim(),
        deputyMatchScore,
        matchPct: Math.round(deputyMatchScore || 0),
        matchSummary: {
          instrument: String(job?.instrument || ""),
          roleFit: 0,
          genreFit: 0,
          locationFit: 0,
          songFit: 0,
        },
        notified: false,
        notifiedAt: null,
      });
    }

    await job.save();

    return res.json({
      success: true,
      message: "Applicant added successfully",
      job: withDeputyJobAliases(job),
      application: job.applications[job.applications.length - 1],
    });
  } catch (error) {
    console.error("❌ manualApplyDeputyJob error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to manually add applicant",
      error: error.message,
    });
  }
};

export const manualApplyAndPresentDeputyJob = async (req, res) => {
  try {
    const job = await deputyJobModel.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Deputy job not found",
      });
    }

    const musicianId = String(req.body?.musicianId || "").trim();

    if (!musicianId) {
      return res.status(400).json({
        success: false,
        message: "musicianId is required",
      });
    }

    const musician = await musicianModel.findById(musicianId).lean();

    if (!musician) {
      return res.status(404).json({
        success: false,
        message: "Musician not found",
      });
    }

    const isEnquiryJob =
      String(job?.jobType || "").trim().toLowerCase() === "enquiry";

    if (!isEnquiryJob) {
      return res.status(400).json({
        success: false,
        message: "Manual apply and present is only available for enquiry jobs",
      });
    }

    const firstName = String(
      musician?.firstName || musician?.basicInfo?.firstName || ""
    ).trim();

    const lastName = String(
      musician?.lastName || musician?.basicInfo?.lastName || ""
    ).trim();

    const email = String(
      musician?.email || musician?.basicInfo?.email || ""
    )
      .trim()
      .toLowerCase();

    const phone = String(
      musician?.phone || musician?.phoneNumber || musician?.basicInfo?.phone || ""
    ).trim();

    const deputyMatchScore = Number(musician?.deputyMatchScore || 0);

    job.applications = Array.isArray(job.applications) ? job.applications : [];

    let application = job.applications.find(
      (item) => String(item?.musicianId || "") === String(musician._id)
    );

    if (!application) {
      application = {
        musicianId: musician._id,
        firstName,
        lastName,
        email,
        phone,
        appliedAt: new Date(),
        status: "presented",
        notes: "Added manually by admin/agent",
        deputyMatchScore,
        matchSummary: {
          instrument: String(job?.instrument || ""),
          roleFit: 0,
          genreFit: 0,
          locationFit: 0,
          songFit: 0,
        },
      };

      job.applications.push(application);
    }

    application.firstName = firstName;
    application.lastName = lastName;
    application.email = email;
    application.phone = phone;
    application.status = "presented";
    application.presentedAt = new Date();
    application.notes = application.notes
      ? `${application.notes} | Presented manually by admin/agent`
      : "Presented manually by admin/agent";

    job.applicationCount = job.applications.length;

    if (!Array.isArray(job.matchedMusicianIds)) {
      job.matchedMusicianIds = [];
    }

    const alreadyInMatchedIds = job.matchedMusicianIds.some(
      (id) => String(id) === String(musician._id)
    );

    if (!alreadyInMatchedIds) {
      job.matchedMusicianIds.push(musician._id);
    }

    if (!Array.isArray(job.matchedMusicians)) {
      job.matchedMusicians = [];
    }

    const existingMatchedSnapshotIndex = job.matchedMusicians.findIndex(
      (entry) => String(entry?.musicianId || "") === String(musician._id)
    );

    if (existingMatchedSnapshotIndex === -1) {
      job.matchedMusicians.push({
        musicianId: musician._id,
        firstName,
        lastName,
        email,
        phone,
        profilePicture: String(
          musician?.profilePicture ||
            musician?.profilePhoto ||
            musician?.profileImage ||
            ""
        ).trim(),
        musicianSlug: String(musician?.musicianSlug || "").trim(),
        deputyMatchScore,
        matchPct: Math.round(deputyMatchScore || 0),
        matchSummary: {
          instrument: String(job?.instrument || ""),
          roleFit: 0,
          genreFit: 0,
          locationFit: 0,
          songFit: 0,
        },
        notified: false,
        notifiedAt: null,
      });
    }

    job.matchedCount = job.matchedMusicians.length;

    const preview = buildApplicantPresentedEmailPreview({
      job,
      musician,
    });

    if (email) {
      await sendEmail({
        to: email,
        subject: preview.subject,
        html: preview.html,
        text: preview.text,
      });
    }

    if (!Array.isArray(job.notifications)) {
      job.notifications = [];
    }

    job.notifications.push({
      musicianId: musician._id,
      email,
      phone,
      channel: "email",
      type: "applicant_presented",
      subject: preview.subject,
      previewHtml: preview.html,
      previewText: preview.text,
      status: email ? "sent" : "skipped",
      sentAt: new Date(),
      error: email ? "" : "Missing recipient email",
    });

    await job.save();

    return res.json({
      success: true,
      message: email
        ? "Applicant added and presented successfully"
        : "Applicant added and marked as presented, but no email address was available",
      job: withDeputyJobAliases(job),
      application,
    });
  } catch (error) {
    console.error("❌ manualApplyAndPresentDeputyJob error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to manually add and present applicant",
      error: error.message,
    });
  }
};
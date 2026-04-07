// controllers/deputyJobController.js
import Stripe from "stripe";
import deputyJobModel from "../models/deputyJobModel.js";
import musicianModel from "../models/musicianModel.js";
import { findMatchingMusiciansForDeputyJob } from "../services/deputyJobMatcher.js";
import { notifyMusiciansAboutDeputyJob } from "../services/deputyJobNotifier.js";
import { runDeputyPayoutRelease } from "../services/deputyPayoutService.js";
import { sendDeputyAllocationWhatsApp, toE164 } from "../utils/twilioClient.js";
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
  process.env.DEPUTY_STRIPE_FEE_FIXED ||
    process.env.STRIPE_CARD_FEE_FIXED ||
    0,
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
  const siteBase = (
    
    "https://admin.thesupremecollective.co.uk"
  ).replace(/\/$/, "");

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

const buildJobNotificationPreview = ({
  job,
  musicians = [],
  previewRecipientEmail = "",
}) => {
  const safeTitle = normaliseString(
    job?.title || job?.instrument || "Deputy opportunity",
  );
  const safeDate = normaliseString(job?.eventDate || job?.date || "");
  const safeVenue = normaliseString(
    job?.venue || job?.locationName || job?.location || "",
  );
  const safeFee = Number(job?.fee || 0);
  const safeCurrency = normaliseCurrency(job?.currency);
  const safeNotes = normaliseString(job?.notes || "");
  const safePreviewRecipientEmail = normaliseEmail(previewRecipientEmail || "");

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

  const siteBase = (
    "https://admin.thesupremecollective.co.uk"
  ).replace(/\/$/, "");

  const jobBoardUrl = `${siteBase}/deputy-jobs`;
const jobUrl = jobBoardUrl;
  const formattedSubjectDate = formatDeputyOpportunityDate(safeDate);
  const subject = formattedSubjectDate
    ? `${safeTitle} | Deputy Opportunity for ${formattedSubjectDate}`
    : `${safeTitle} | Deputy Opportunity`;

  const detailRowsHtml = [
    renderDetailRow("Date", safeDate),
    renderDetailRow("Call time", callTime),
    renderDetailRow("Finish time", finishTime),
    renderDetailRow("Location", safeVenue),
    safeFee ? renderDetailRow("Fee", `${safeCurrency} ${safeFee}`) : "",
    renderDetailListRow("Required instruments", requiredInstruments),
    renderDetailListRow("Essential skills", essentialSkills),
    renderDetailListRow("Required skills", requiredSkills),
    renderDetailListRow("Preferred extra skills", preferredExtraSkills),
    renderDetailListRow("Secondary instruments", secondaryInstruments),
    renderDetailListRow("Genres", genres),
    renderDetailListRow("Tags", tags),
    renderDetailListRow("Set lengths", setLengths),
    renderDetailListRow("What's included", whatsIncluded),
    renderDetailListRow("Claimable expenses", claimableExpenses),
    renderDetailRow("Notes", safeNotes),
  ]
    .filter(Boolean)
    .join("");

  const html = `
    <div style="margin:0; padding:0; background:#f7f7f7; font-family:Arial, sans-serif; color:#111;">
      <div style="max-width:700px; margin:0 auto; padding:32px 20px;">
        <div style="background:#111; border-radius:20px 20px 0 0; padding:28px 32px; text-align:left;">
          <p style="margin:0; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#ff6667; font-weight:700;">
            The Supreme Collective
          </p>
          <h1 style="margin:12px 0 0; font-size:28px; line-height:1.2; color:#fff;">
            Deputy Opportunity
          </h1>
          <p style="margin:12px 0 0; font-size:15px; line-height:1.6; color:#f3f3f3;">
            A new opportunity has been created and this email shows exactly how the notification will appear to musicians.
          </p>
        </div>

        <div style="background:#ffffff; border:1px solid #e8e8e8; border-top:0; border-radius:0 0 20px 20px; padding:32px;">
          <div style="margin-bottom:24px; padding:20px; border:1px solid #f1d0d1; background:#fff7f7; border-radius:16px;">
            <p style="margin:0 0 8px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#ff6667;">
              Preview mode
            </p>
            <p style="margin:0; font-size:14px; line-height:1.7; color:#333;">
              This is a preview of the deputy job notification email before it is sent out.
              ${safePreviewRecipientEmail ? `It has been sent to <strong>${escapeHtml(safePreviewRecipientEmail)}</strong> for review.` : ""}
            </p>
          </div>

          <h2 style="margin:0 0 8px; font-size:24px; line-height:1.3; color:#111;">
            ${escapeHtml(safeTitle)}
          </h2>

          <p style="margin:0 0 24px; font-size:15px; line-height:1.7; color:#444;">
            Please review the details below and use the button to open the deputy job directly in the job board.
          </p>

          <div style="margin:0 0 24px;">
            <a
              href="${escapeHtml(jobUrl)}"
              style="display:inline-block; background:#ff6667; color:#fff; text-decoration:none; padding:14px 22px; border-radius:999px; font-size:14px; font-weight:700;"
            >
              View deputy job
            </a>
            <a
              href="${escapeHtml(jobBoardUrl)}"
              style="display:inline-block; margin-left:10px; background:#111; color:#fff; text-decoration:none; padding:14px 22px; border-radius:999px; font-size:14px; font-weight:700;"
            >
              Open job board
            </a>
          </div>

          <div style="margin-bottom:24px; padding:24px; background:#fafafa; border:1px solid #ececec; border-radius:18px;">
            <h3 style="margin:0 0 14px; font-size:16px; color:#111;">Job details</h3>
            <ul style="margin:0; padding-left:20px; font-size:14px; line-height:1.8; color:#333;">
              ${detailRowsHtml}
            </ul>
          </div>

          <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px; margin-bottom:24px;">
            <div style="padding:18px; border:1px solid #ececec; border-radius:16px; background:#fff;">
              <p style="margin:0 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#777; font-weight:700;">Matched musicians</p>
              <p style="margin:0; font-size:24px; font-weight:700; color:#111;">${musicians.length}</p>
            </div>
            <div style="padding:18px; border:1px solid #ececec; border-radius:16px; background:#fff;">
              <p style="margin:0 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#777; font-weight:700;">Notification type</p>
              <p style="margin:0; font-size:24px; font-weight:700; color:#111;">Preview</p>
            </div>
          </div>

          <p style="margin:0 0 14px; font-size:14px; line-height:1.7; color:#555;">
            Sent via <strong>The Supreme Collective</strong> deputy system.
            You can make any changes in the job board before sending the live notification to matched musicians.
          </p>

          <div style="margin-top:18px; display:grid; gap:12px;">
  <div style="padding:18px 20px; background:#fff7f7; border:1px solid #f1d0d1; border-radius:16px;">
    <p style="margin:0 0 8px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#ff6667;">
      P.S.
    </p>
    <p style="margin:0; font-size:14px; line-height:1.7; color:#444;">
      Did you know you can also post your own deputy jobs through <strong>The Supreme Collective</strong>? You can reach a wide network of musicians and send your opportunity straight to matched players' inboxes in just a few clicks.
    </p>
  </div>

  <div style="padding:18px 20px; background:#fff7f7; border:1px solid #f1d0d1; border-radius:16px;">
    <p style="margin:0 0 8px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#ff6667;">
      Also...
    </p>
    <p style="margin:0; font-size:14px; line-height:1.7; color:#444;">
      Think your act could be a great fit for <strong>The Supreme Collective</strong>? You’re very welcome to pre-submit your act for review and, if it feels like the right match, we’ll be in touch.
    </p>
  </div>
</div>
        </div>
      </div>
    </div>
  `;

  const text = [
    "The Supreme Collective",
    "Deputy Opportunity Preview",
    "",
    "This is a preview of the deputy job notification email before it is sent out.",
    safePreviewRecipientEmail
      ? `Preview recipient: ${safePreviewRecipientEmail}`
      : "",
    "",
    safeTitle,
    safeDate ? `Date: ${safeDate}` : "",
    callTime ? `Call time: ${callTime}` : "",
    finishTime ? `Finish time: ${finishTime}` : "",
    safeVenue ? `Location: ${safeVenue}` : "",
    safeFee ? `Fee: ${safeCurrency} ${safeFee}` : "",
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
    safeNotes ? `Notes: ${safeNotes}` : "",
    "",
    `Matched musicians: ${musicians.length}`,
    `View deputy job: ${jobUrl}`,
    `Open job board: ${jobBoardUrl}`,
    "",
    "P.S. Did you know you can also post your own deputy jobs through The Supreme Collective? You can reach a wide network of musicians and send your opportunity straight to matched players' inboxes in just a few clicks.",
    "P.S. Think your act could be a great fit for The Supreme Collective? You’re very welcome to pre-submit your act for review and, if it feels like the right match, we’ll be in touch.",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject,
    html,
    text,
    recipientCount: musicians.length,
    recipients: buildRecipientPreview(musicians),
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
    mode = "preview",
  } = req.body || {};

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
      normaliseString(mode || "preview").toLowerCase() === "send"
        ? "send"
        : "preview",
  };
};

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
}) => {
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
    limit: 100,
  });

  const matchedMusicianIds = matches
    .map((m) => m?._id || m?.id)
    .filter(Boolean);

  const matchedMusicians = matches.map(buildMatchSnapshot);

  const previewNotification = buildJobNotificationPreview({
    job,
    musicians: matches,
    previewRecipientEmail,
  });

  return {
    matches,
    matchedMusicianIds,
    matchedMusicians,
    previewNotification,
  };
};

const getMatchedMusiciansForJob = async (job) => {
  const ids = Array.isArray(job?.matchedMusicianIds)
    ? job.matchedMusicianIds
    : [];
  if (!ids.length) return [];

  return musicianModel
    .find(
      { _id: { $in: ids } },
      "firstName lastName email phone phoneNumber musicianSlug profilePhoto profilePicture profileImage profilePic profile_picture additionalImages",
    )
    .lean();
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
        built.saveClientCard && built.clientEmail
          ? "setup_required"
          : "not_started",
      payoutStatus: "not_ready",
      createdBy,
      createdByName,
      createdByEmail,
      createdByPhone,
      status: built.mode === "send" ? "open" : "preview",
      previewMode: built.mode !== "send",
      workflowStage:
        built.mode === "send" ? "sent_to_matches" : "preview_ready",
    });

    let setupIntentResult = null;

    if (built.saveClientCard && built.clientEmail && stripe) {
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

    if (built.mode === "send") {
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
  }))
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
          ? "Deputy job created and notifications sent"
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
      .populate(
        "matchedMusicianIds",
        "firstName lastName email musicianSlug profilePhoto profilePicture",
      )
      .populate(
        "allocatedMusicianId",
        "firstName lastName email musicianSlug profilePhoto profilePicture",
      )
      .populate(
        "bookedMusicianId",
        "firstName lastName email musicianSlug profilePhoto profilePicture",
      )
      .lean();

    const formattedJobs = jobs.map((job) => withDeputyJobAliases(job));

    res.json({ success: true, jobs: formattedJobs });
  } catch (error) {
    console.error("❌ listDeputyJobs error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch deputy jobs" });
  }
};

export const getDeputyJobById = async (req, res) => {
  try {
    const job = await deputyJobModel
      .findById(req.params.id)
      .populate(
        "matchedMusicianIds",
        "firstName lastName email musicianSlug profilePhoto profilePicture",
      )
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
      return res
        .status(404)
        .json({ success: false, message: "Deputy job not found" });
    }

    const matches = await getMatchedMusiciansForJob(job);

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

    const formattedJob = withDeputyJobAliases(job);

    return res.json({
      success: true,
      message: "Notifications sent",
      job: formattedJob,
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
      return res
        .status(404)
        .json({ success: false, message: "Deputy job not found" });
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

    await job.save();

    const formattedJob = withDeputyJobAliases(job);

    return res.json({
      success: true,
      message: "Payment method saved",
      job: formattedJob,
      defaultPaymentMethodId: resolvedPaymentMethodId,
      paymentStatus: job.paymentStatus,
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

    let chargeResult = null;
    if (job.stripeCustomerId && job.defaultPaymentMethodId) {
      chargeResult = await attemptDeputyJobCharge({
        job,
        createdBy: req.user?._id || null,
      });
    } else if (job.clientEmail) {
      job.paymentStatus = "setup_required";
    }

    let whatsappResult = null;
    const targetPhone = toE164(
      musician?.phone ||
        musician?.phoneNumber ||
        application?.phoneNormalized ||
        application?.phone ||
        "",
    );

    if (targetPhone) {
      try {
        whatsappResult = await sendDeputyAllocationWhatsApp({
          to: targetPhone,
          job,
          musician,
        });
      } catch (whatsappError) {
        console.error("❌ sendDeputyAllocationWhatsApp error:", whatsappError);
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
            ? "WhatsApp allocation send failed"
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
    const repliedSid = normaliseString(
      req.body?.OriginalRepliedMessageSid || "",
    );
    const inboundMessageSid = normaliseString(req.body?.MessageSid || "");
    const fromRaw = normaliseString(req.body?.From || req.body?.WaId || "");
    const fromPhone = toE164(fromRaw);

    const rawReply = (buttonPayload || buttonText || bodyText)
      .trim()
      .toLowerCase();

    let action = null;
    if (["yes", "yes, book me in!"].includes(rawReply)) action = "accept";
    if (
      [
        "notavailable",
        "not available now",
        "changedmind",
        "changed my mind",
      ].includes(rawReply)
    ) {
      action = "decline";
    }

    if (!action || !repliedSid) {
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
      console.warn(
        "⚠️ twilioInboundDeputyAllocation: no deputy job found for replied SID",
        {
          repliedSid,
          fromPhone,
        },
      );
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

    const musician = await findMatchedMusicianFromJob(
      job,
      allocationNotification?.musicianId ||
        matchedApplication?.musicianId ||
        job.allocatedMusicianId,
    );

    if (!musician) {
      console.warn("⚠️ twilioInboundDeputyAllocation: musician not found", {
        jobId: String(job._id),
        repliedSid,
        fromPhone,
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

    const musicianName = [musician.firstName, musician.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const musicianDisplayName = [
      normaliseString(musician?.firstName || ""),
      normaliseString(musician?.lastName || "").charAt(0)
        ? `${normaliseString(musician?.lastName || "").charAt(0)}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    const jobTitle = normaliseString(
      job.title || job.instrument || "Deputy opportunity",
    );
const location = normaliseString(
  job.location || job.locationName || job.venue || "Location TBC",
);
const dateText = formatFullDate(job.eventDate);
    const feeText = getDeputyNetFeeText(job);
    const musicianEmail = normaliseString(
      musician.email || matchedApplication?.email || "",
    ).toLowerCase();
    const musicianPhone =
      fromPhone ||
      toE164(
        musician.phone ||
          musician.phoneNumber ||
          matchedApplication?.phone ||
          "",
      ) ||
      "";

    const posterEmail = normaliseString(
      job.createdByEmail || job.clientEmail || "",
    ).toLowerCase();

    if (action === "accept") {
      applyBookedStateToJob(job, musician);

      job.notifications = [
        ...(job.notifications || []),
        {
          musicianId: musician._id,
          email: musicianEmail,
          phone: musicianPhone,
          channel: "whatsapp",
          type: "booking_confirmation",
          subject: `Deputy accepted: ${jobTitle}`,
          previewHtml: "",
          previewText: `Accepted via WhatsApp by ${musicianName}`,
          providerMessageId: inboundMessageSid,
          status: "sent",
          sentAt: new Date(),
        },
      ];

      await job.save();

      if (musicianPhone) {
        try {
          await sendWhatsAppText(
            musicianPhone,
            "Wonderful! Please consider yourself booked. We’ll let the band know, and you should hear from them shortly.",
          );
        } catch (whatsAppError) {
          console.error(
            "❌ Failed to send deputy acceptance WhatsApp confirmation:",
            whatsAppError,
          );
        }
      }

      if (musicianEmail) {
        try {
          const callTime = normaliseString(
            job?.callTime || job?.startTime || "",
          );
          const finishTime = normaliseString(
            job?.finishTime || job?.endTime || "",
          );
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
          const paymentDate = job?.releaseOn
            ? new Date(job.releaseOn).toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })
            : "TBC";
          const bandContactName = normaliseString(
            job?.createdByName || "The Supreme Collective",
          );
          const bandContactEmail = normaliseString(
            job?.createdByEmail || "hello@thesupremecollective.co.uk",
          );
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
          console.error(
            "❌ Failed to send musician deputy acceptance email:",
            musicianEmailError,
          );
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
          const callTime = normaliseString(
            job?.callTime || job?.startTime || "",
          );
          const finishTime = normaliseString(
            job?.finishTime || job?.endTime || "",
          );
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
                  Great news — <strong>${escapeHtml(
                    musicianName || "your selected deputy",
                  )}</strong> has accepted the deputy booking for <strong>${escapeHtml(jobTitle)}</strong>.
                </p>

                <p style="margin:0 0 24px; font-size:15px; line-height:1.7; color:#444;">
                  Thank you for using <strong>The Supreme Collective</strong> to find your deputy.
                  Please now get in touch with them directly to share the setlist, timings,
                  dress code, logistics, arrival details, parking instructions, and any other
                  information needed to help ensure a smooth and successful performance.
                </p>

                <div style="margin-bottom:24px; padding:24px; background:#fafafa; border:1px solid #ececec; border-radius:18px;">
                  <h3 style="margin:0 0 14px; font-size:16px; color:#111;">Deputy contact details</h3>
                  <ul style="padding-left:20px; margin:0; font-size:14px; line-height:1.8; color:#333;">
                    <li><strong>Name:</strong> ${escapeHtml(
                      musicianName || "Not provided",
                    )}</li>
                    <li><strong>Email:</strong> ${escapeHtml(
                      musicianEmail || "Not provided",
                    )}</li>
                    <li><strong>Phone:</strong> ${escapeHtml(
                      musicianPhone || "Not provided",
                    )}</li>
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
                    Unless otherwise agreed, payment is due to be processed on
                    <strong>${escapeHtml(paymentDate)}</strong>.
                  </p>
                </div>

                <p style="margin:0 0 16px; font-size:15px; line-height:1.7; color:#444;">
                  If anything changes or you need any support before the event,
                  just reply to this email and we’ll be happy to help.
                </p>

                <div style="margin-top:18px; display:grid; gap:12px;">
                  <div style="padding:18px 20px; background:#fff7f7; border:1px solid #f1d0d1; border-radius:16px;">
                    <p style="margin:0 0 8px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#ff6667;">
                      P.S.
                    </p>
                    <p style="margin:0; font-size:14px; line-height:1.7; color:#444;">
                      Did you know you can also post your own deputy jobs through <strong>The Supreme Collective</strong>? You can reach a wide network of musicians and send your opportunity straight to matched players' inboxes in just a few clicks.
                    </p>
                  </div>

                  <div style="padding:18px 20px; background:#fff7f7; border:1px solid #f1d0d1; border-radius:16px;">
                    <p style="margin:0 0 8px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#ff6667;">
                      Also...
                    </p>
                    <p style="margin:0; font-size:14px; line-height:1.7; color:#444;">
                      Think your act could be a great fit for <strong>The Supreme Collective</strong>? You’re very welcome to pre-submit your act for review and, if it feels like the right match, we’ll be in touch.
                    </p>
                  </div>
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
          console.error(
            "❌ Failed to send poster deputy acceptance email:",
            posterEmailError,
          );
        }
      }

      return res.status(200).send("<Response/>");
    }

    if (action === "decline") {
      const now = new Date();
      const safeMusicianId = asObjectIdString(
        musician._id || musician.musicianId,
      );

      job.status = "open";
      job.workflowStage = "sent_to_matches";
      job.allocatedMusicianId = null;
      job.allocatedMusicianName = "";
      job.allocatedAt = null;
      job.bookedMusicianId = null;
      job.bookedMusicianName = "";
      job.bookingConfirmedAt = null;

      job.applications = (job.applications || []).map((application) => {
        const sameMusician =
          asObjectIdString(application?.musicianId) === safeMusicianId;

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
          type: "manual",
          subject: `Deputy declined: ${jobTitle}`,
          previewHtml: "",
          previewText: `Declined via WhatsApp by ${musicianName}`,
          providerMessageId: inboundMessageSid,
          status: "sent",
          sentAt: new Date(),
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
          console.error(
            "❌ Failed to send deputy decline WhatsApp confirmation:",
            whatsAppError,
          );
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
          const callTime = normaliseString(
            job?.callTime || job?.startTime || "",
          );
          const finishTime = normaliseString(
            job?.finishTime || job?.endTime || "",
          );
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
                    We wanted to let you know that <strong>${escapeHtml(
                      musicianDisplayName || "the allocated deputy",
                    )}</strong> is no longer available for <strong>${escapeHtml(jobTitle)}</strong>.
                  </p>

                  <p style="margin:0 0 24px; font-size:15px; line-height:1.7; color:#444;">
                    The deputy job has now been <strong>reopened</strong>, so you can return to the job board and allocate another deputy when ready.
                    To help make reallocation as quick and straightforward as possible, we’ve included the full job details below for reference.
                  </p>

                  <div style="margin-bottom:24px; padding:24px; background:#fafafa; border:1px solid #ececec; border-radius:18px;">
                    <h3 style="margin:0 0 14px; font-size:16px; color:#111;">Declined deputy</h3>
                    <ul style="padding-left:20px; margin:0; font-size:14px; line-height:1.8; color:#333;">
                      <li><strong>Name:</strong> ${escapeHtml(musicianDisplayName || "Not provided")}</li>
                      <li><strong>Email:</strong> ${escapeHtml(musicianEmail || "Not provided")}</li>
                      <li><strong>Phone:</strong> ${escapeHtml(musicianPhone || "Not provided")}</li>
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

                  <p style="margin:0 0 16px; font-size:15px; line-height:1.7; color:#444;">
                    Thank you for using <strong>The Supreme Collective</strong> to source your deputy. If you’d like, you can now allocate another suitable applicant or return to the job board to review your options.
                  </p>

                  <p style="margin:0 0 16px; font-size:15px; line-height:1.7; color:#444;">
                    If you need any help choosing a replacement or if anything about the job has changed, just reply to this email and we’ll be happy to help.
                  </p>

                  <div style="margin-top:18px; display:grid; gap:12px;">
                    <div style="padding:18px 20px; background:#fff7f7; border:1px solid #f1d0d1; border-radius:16px;">
                      <p style="margin:0 0 8px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#ff6667;">
                        P.S.
                      </p>
                      <p style="margin:0; font-size:14px; line-height:1.7; color:#444;">
                        Did you know you can also post your own deputy jobs through <strong>The Supreme Collective</strong>? You can reach a wide network of musicians and send your opportunity straight to matched players' inboxes in just a few clicks.
                      </p>
                    </div>

                    <div style="padding:18px 20px; background:#fff7f7; border:1px solid #f1d0d1; border-radius:16px;">
                      <p style="margin:0 0 8px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#ff6667;">
                        Also...
                      </p>
                      <p style="margin:0; font-size:14px; line-height:1.7; color:#444;">
                        Think your act could be a great fit for <strong>The Supreme Collective</strong>? You’re very welcome to pre-submit your act for review and, if it feels like the right match, we’ll be in touch.
                      </p>
                    </div>
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
          console.error(
            "❌ Failed to send poster deputy decline email:",
            posterEmailError,
          );
        }
      }

      return res.status(200).send("<Response/>");
    }

    return res.status(200).send("<Response/>");
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

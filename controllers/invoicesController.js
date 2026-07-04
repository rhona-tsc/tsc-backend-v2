// controllers/invoicesController.js
import { startOfDay, subDays, subHours, isValid, parseISO } from "date-fns";
import Booking from "../models/bookingModel.js";
import { enqueueReminder } from "../services/remindersQueue.js"; // BullMQ / Agenda / node-cron wrapper
import Stripe from "stripe";
import BookingBoardItem from "../models/bookingBoardItem.js";
import PDFDocument from "pdfkit";
import cloudinary from "../config/cloudinary.js";
import path from "path";
import fs from "fs";

const STRIPE_API_VERSION = "2024-06-20";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_V2, {
  apiVersion: STRIPE_API_VERSION,
});

const bmmStripe = process.env.BMM_STRIPE_SECRET_KEY
  ? new Stripe(process.env.BMM_STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION,
    })
  : stripe;

const getStripeClientForCompany = (invoiceCompany) => {
  const brand = String(invoiceCompany?.brand || invoiceCompany || "TSC")
    .trim()
    .toUpperCase();

  if (brand === "BMM") return bmmStripe;
  return stripe;
};

const looksLikeObjectId = (v) =>
  typeof v === "string" && /^[0-9a-f]{24}$/i.test(v);

// Keep the same origin helper you used elsewhere
const getOrigin = (req) => {
  const env = process.env.FRONTEND_URL && String(process.env.FRONTEND_URL);
  const hdr = req.headers.origin && String(req.headers.origin);
  const fallback = "http://localhost:5174";
  const chosen = env || hdr || fallback;
  try {
    const u = new URL(chosen);
    return `${u.protocol}//${u.host}`;
  } catch {
    return fallback;
  }
};

export const scheduleBalance = async (req, res) => {
  try {
    const {
      bookingId,
      actId,
      customerId, // optional Stripe customer id
      eventDateISO,
      currency = "GBP",
      amountPence,
      metadata = {},
      dueAtISO, // optional; if omitted we compute event - 14 days
    } = req.body;

    if (!bookingId || !eventDateISO || !amountPence) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields." });
    }

    const eventDate = parseISO(eventDateISO);
    if (!isValid(eventDate)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid eventDateISO." });
    }

    const computedDue = startOfDay(subDays(eventDate, 14));
    const dueAt = dueAtISO ? parseISO(dueAtISO) : computedDue;
    if (!isValid(dueAt)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid dueAtISO." });
    }

    const booking = await Booking.findOne({
      $or: [{ bookingId }, { _id: bookingId }],
    });
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found." });
    }
    booking.balanceDueAt = dueAt;
    booking.balanceAmountPence = amountPence;
    booking.balanceStatus = "scheduled";
    await booking.save();

    // ── (Optional) Create Stripe draft invoice ────────────────────────────────
    // Only if you want to manage the balance via Stripe Invoices:
    let stripeInvoiceId = null;
    try {
      if (customerId) {
        const inv = await stripe.invoices.create({
          customer: customerId,
          collection_method: "send_invoice",
          currency: currency.toLowerCase(),
          auto_advance: false,
          metadata: { bookingId, ...metadata },
        });

        await stripe.invoiceItems.create({
          customer: customerId,
          amount: amountPence,
          currency: currency.toLowerCase(),
          description: "Balance payment",
          invoice: inv.id,
        });

        stripeInvoiceId = inv.id;
        booking.stripeInvoiceId = inv.id;
        await booking.save();
      }
    } catch (e) {
      console.warn("⚠️ Stripe draft invoice creation failed:", e?.message || e);
    }

    // ── Queue reminders ───────────────────────────────────────────────────────
    // Times: 7d before due, 3d before due, on due (9am), + optional 1d after if unpaid
    const at7d = subDays(dueAt, 7);
    const at3d = subDays(dueAt, 3);
    const onDueMorning = subHours(startOfDay(dueAt), -9); // 09:00 local

    await Promise.all([
      enqueueReminder("BALANCE_REMINDER", {
        bookingId,
        whenISO: at7d.toISOString(),
        kind: "7d",
      }),
      enqueueReminder("BALANCE_REMINDER", {
        bookingId,
        whenISO: at3d.toISOString(),
        kind: "3d",
      }),
      enqueueReminder("BALANCE_REMINDER", {
        bookingId,
        whenISO: onDueMorning.toISOString(),
        kind: "due",
      }),
      enqueueReminder("BALANCE_REMINDER", {
        bookingId,
        whenISO: subHours(onDueMorning, -24).toISOString(),
        kind: "overdue+1d",
      }),
    ]);

    return res.json({
      success: true,
      stripeInvoiceId,
      dueAtISO: dueAt.toISOString(),
    });
  } catch (err) {
    console.error("scheduleBalance error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to schedule balance." });
  }
};

export const getOrCreateBalanceLink = async (req, res) => {
  try {
    const { idOrRef } = req.params;
    const refreshRequested = String(req.query?.refresh || "") === "1";
    const expectedAmountPence = Number(req.query?.expectedAmountPence || 0);

    const booking = await Booking.findOne(
      looksLikeObjectId(idOrRef) ? { _id: idOrRef } : { bookingId: idOrRef },
    );

    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found." });
    }

    const full = Number(booking?.totals?.fullAmount || booking?.fee || 0);
    const charged = Number(booking?.totals?.chargedAmount || 0);
    const explicit = Number(booking?.balanceAmountPence ?? NaN);

    const totalsBasedRemainingPence = Math.max(
      0,
      Math.round((full - charged) * 100),
    );

    const calculatedRemainingPence =
      totalsBasedRemainingPence > 0
        ? totalsBasedRemainingPence
        : Number.isFinite(explicit) && explicit > 0
          ? explicit
          : 0;

    const remainingPence =
      expectedAmountPence > 0 ? expectedAmountPence : calculatedRemainingPence;

    if (!remainingPence) {
      return res
        .status(400)
        .json({ success: false, message: "No outstanding balance." });
    }

    const existingAmountMatches =
      Number(booking?.balanceAmountPence || 0) === remainingPence;

    if (
      remainingPence > 0 &&
      (booking.balancePaid === true || booking.balanceStatus === "paid")
    ) {
      booking.balancePaid = false;
      booking.balanceStatus = "sent";
    }

    if (
      booking.balanceInvoiceUrl &&
      existingAmountMatches &&
      !refreshRequested
    ) {
      return res.json({ success: true, url: booking.balanceInvoiceUrl });
    }

    if (!existingAmountMatches || refreshRequested) {
      booking.balanceInvoiceUrl = "";
      booking.balanceInvoiceId = "";
    }

    const origin = getOrigin(req);
    const ref = booking.bookingId || String(booking._id);

    const balanceMetadata = {
      category: "balance",
      payment_stage: "balance",
      paymentStage: "balance",
      booking_mode: "balance",
      bookingId: ref,
      booking_ref: ref,
      bookingMongoId: String(booking._id),
      remainingPence: String(remainingPence),
      amount_pence: String(remainingPence),
      fullAmount: String(full),
      chargedAmount: String(charged),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: (booking?.totals?.currency || "GBP").toLowerCase(),
            product_data: {
              name: `Outstanding balance for ${ref}`,
            },
            unit_amount: remainingPence,
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/event-sheet/${ref}?balancePaid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/event-sheet/${ref}?balanceCanceled=1`,
      allow_promotion_codes: true,

      // Session metadata
      metadata: balanceMetadata,

      // PaymentIntent metadata — this is important because your webhook prefers PI metadata
      payment_intent_data: {
        metadata: balanceMetadata,
      },
    });

    booking.balanceAmountPence = remainingPence;
    booking.balanceInvoiceUrl = session.url;
    booking.balanceInvoiceId = session.id;
    booking.balanceStatus = "sent";
    booking.balancePaid = false;

    await booking.save();

    return res.json({ success: true, url: session.url });
  } catch (err) {
    console.error("getOrCreateBalanceLink error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create or fetch balance link.",
    });
  }
};

export const getOrCreateAddonLink = async (req, res) => {
  try {
    const { idOrRef } = req.params;
    const refreshRequested = String(req.query?.refresh || "") === "1";

    const amountPence = Number(
      req.query?.amountPence || req.query?.expectedAmountPence || 0,
    );

    if (!amountPence || amountPence <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Missing amountPence." });
    }

    const rawStage = String(req.query?.stage || "full").toLowerCase();
    const stage = rawStage === "deposit" ? "deposit" : "full";
    const paymentStage = stage === "deposit" ? "addon_deposit" : "addon_full";

    const booking = await Booking.findOne(
      looksLikeObjectId(idOrRef) ? { _id: idOrRef } : { bookingId: idOrRef },
    );

    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found." });
    }

    const existingAmountMatches =
      Number(booking?.addonAmountPence || 0) === Number(amountPence || 0);

    if (booking.addonInvoiceUrl && existingAmountMatches && !refreshRequested) {
      return res.json({ success: true, url: booking.addonInvoiceUrl });
    }

    if (!existingAmountMatches || refreshRequested) {
      booking.addonInvoiceUrl = "";
      booking.addonInvoiceId = "";
    }

    const origin = getOrigin(req);
    const ref = booking.bookingId || String(booking._id);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: (booking?.totals?.currency || "GBP").toLowerCase(),
            product_data: { name: `Add-on payment for ${ref}` },
            unit_amount: amountPence,
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/event-sheet/${ref}?addonPaid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/event-sheet/${ref}?addonCanceled=1`,
      allow_promotion_codes: true,
      metadata: {
        category: "addon",
        bookingId: ref,
        bookingMongoId: String(booking._id),
        addonAmountPence: String(amountPence),
        paymentStage,
      },
    });

    // NOTE: If your Booking schema is strict and doesn’t include these fields,
    // this save won’t persist them. In that case, add them to the schema.
    booking.addonAmountPence = amountPence;
    booking.addonInvoiceUrl = session.url;
    booking.addonInvoiceId = session.id;
    booking.addonStatus = "sent";
    await booking.save();

    return res.json({ success: true, url: session.url });
  } catch (err) {
    console.error("getOrCreateAddonLink error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create or fetch add-on link.",
    });
  }
};

const getOrCreateStripeCustomer = async ({ email, name }) => {
  if (!email) throw new Error("customerEmail is required for invoice flow");

  // try find existing

  const existing = await stripe.customers.list({ email, limit: 1 });

  if (existing?.data?.[0]) return existing.data[0];

  // create new

  return await stripe.customers.create({ email, name: name || undefined });
};

export const createInvoicePayLink = async (req, res) => {
  try {
    const roundInt = (n) => Math.round(Number(n || 0));
    const toLower = (s) => String(s || "").toLowerCase();
    const clampPence = (n) => Math.max(0, roundInt(n));

    const DEPOSIT_RATE = Number(process.env.TSC_DEPOSIT_RATE ?? 0.33);
    const VAT_RATE = Number(process.env.TSC_VAT_RATE ?? 0.2);

    const {
      bookingIdOrRef,
      stage, // deposit | full | balance | addon_deposit | addon_full
      amountPence,
      currency = "GBP",
      description,
      customerEmail,
      customerName,
      daysUntilDue = 7,
      metadata = {},
      replaceExistingInvoice = true, // default true
    } = req.body || {};

    const stageNorm = String(stage || "")
      .trim()
      .toLowerCase();

    if (
      !bookingIdOrRef ||
      !stageNorm ||
      !amountPence ||
      Number(amountPence) <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields.",
      });
    }

    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        message: "customerEmail is required.",
      });
    }

    const booking = await Booking.findOne(
      looksLikeObjectId(bookingIdOrRef)
        ? { _id: bookingIdOrRef }
        : { bookingId: bookingIdOrRef },
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    // Void old invoice first, if requested
    let voidedInvoice = null;
    if (replaceExistingInvoice) {
      voidedInvoice = await voidExistingStripeInvoiceIfAny(booking);
    }

    const totalPence = clampPence(amountPence);
    let commissionPence = 0;
    let passThroughPence = 0;

    if (stageNorm === "deposit" || stageNorm === "addon_deposit") {
      commissionPence = totalPence;
      passThroughPence = 0;
    } else if (stageNorm === "balance") {
      commissionPence = 0;
      passThroughPence = totalPence;
    } else if (stageNorm === "full" || stageNorm === "addon_full") {
      commissionPence = clampPence(totalPence * DEPOSIT_RATE);
      if (commissionPence > totalPence) commissionPence = totalPence;
      passThroughPence = totalPence - commissionPence;
    } else {
      return res.status(400).json({
        success: false,
        message:
          "Invalid stage. Use deposit | full | balance | addon_deposit | addon_full.",
      });
    }

    const commissionGross = commissionPence / 100;
    const commissionVat = commissionGross * (VAT_RATE / (1 + VAT_RATE));
    const commissionNet = commissionGross - commissionVat;
    const passThroughGross = passThroughPence / 100;

    const customer = await getOrCreateStripeCustomer({
      email: customerEmail,
      name: customerName,
    });

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: Number(daysUntilDue) || 7,
      auto_advance: false,
      currency: toLower(currency),
      footer: [
        "Bank transfer details:",

        "Account name: The Supreme Collective Limited",

        "Sort code: 608371",

        "Account number: 00973473",

        `Reference: ${booking.bookingId}`,
      ].join("\n"),

      custom_fields: [
        { name: "Payment reference", value: booking.bookingId },

        { name: "Payment method", value: "Bank transfer accepted" },
      ],
      metadata: {
        bookingId: booking.bookingId,
        bookingMongoId: String(booking._id),
        stage: stageNorm,
        total_pence: String(totalPence),
        commission_pence: String(commissionPence),
        pass_through_pence: String(passThroughPence),
        replaced_invoice_id: voidedInvoice?.id || "",
        ...metadata,
      },
    });

    const suffix = booking?.bookingId ? ` (${booking.bookingId})` : "";

    // 1) Agency fee line
    if (commissionPence > 0) {
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoice.id,
        amount: commissionPence,
        currency: toLower(currency),
        description:
          description ||
          `${stageNorm.startsWith("addon") ? "Add-on" : ""} The Supreme Collective agency fee${suffix}`,
        metadata: {
          bookingId: booking.bookingId,
          bookingMongoId: String(booking._id),
          stage: stageNorm,
          bucket: "commission",
          commission_gross: String(commissionGross.toFixed(2)),
          commission_vat: String(commissionVat.toFixed(2)),
          commission_net: String(commissionNet.toFixed(2)),
          ...metadata,
        },
      });
    }

    // 2) Artist fee line
    if (passThroughPence > 0) {
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoice.id,
        amount: passThroughPence,
        currency: toLower(currency),
        description:
          description ||
          `${stageNorm.startsWith("addon") ? "Add-on" : ""} artist fee${suffix}`,
        metadata: {
          bookingId: booking.bookingId,
          bookingMongoId: String(booking._id),
          stage: stageNorm,
          bucket: "pass_through",
          pass_through_gross: String(passThroughGross.toFixed(2)),
          ...metadata,
        },
      });
    }

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id, {
      auto_advance: true,
    });

    const currencyUpper = String(currency || "GBP").toUpperCase();

    const accountingPatch = {
      paymentStage: stageNorm,
      vatRate: VAT_RATE,
      commissionGross: Number(commissionGross.toFixed(2)),
      commissionVat: Number(commissionVat.toFixed(2)),
      commissionNet: Number(commissionNet.toFixed(2)),
      passThroughGross: Number(passThroughGross.toFixed(2)),
      currency: currencyUpper,
    };

    if (stageNorm === "balance") {
      booking.paymentLink = finalized.hosted_invoice_url || "";
      booking.invoicePdfUrl = finalized.invoice_pdf || "";
      booking.stripeInvoiceId = finalized.id;
      booking.balanceInvoiceId = finalized.id;
      booking.balanceInvoiceUrl = finalized.hosted_invoice_url || "";
      booking.balanceInvoicePdfUrl = finalized.invoice_pdf || "";
      booking.balanceStatus = "sent";
      booking.balancePaid = false;
      booking.accounting = accountingPatch;
    } else if (stageNorm === "addon_deposit" || stageNorm === "addon_full") {
      booking.addonPayments = Array.isArray(booking.addonPayments)
        ? booking.addonPayments
        : [];

      booking.addonPayments.push({
        stage: stageNorm,
        amountPence: totalPence,
        currency: currencyUpper,
        label: description || "",
        checkoutSessionId: "",
        checkoutUrl: finalized.hosted_invoice_url || "",
        paymentIntentId: finalized.payment_intent || "",
        chargeId: "",
        status: "sent",
        metadata: {
          stripeInvoiceId: finalized.id,
          totalPence,
          commissionPence,
          passThroughPence,
          commissionGross: Number(commissionGross.toFixed(2)),
          commissionVat: Number(commissionVat.toFixed(2)),
          commissionNet: Number(commissionNet.toFixed(2)),
          passThroughGross: Number(passThroughGross.toFixed(2)),
        },
      });

      booking.paymentLink = finalized.hosted_invoice_url || "";
      booking.invoicePdfUrl = finalized.invoice_pdf || "";
      booking.stripeInvoiceId = finalized.id;
      booking.accounting = accountingPatch;
    } else {
      booking.stripeInvoiceId = finalized.id;
      booking.invoiceRequested = true;
      booking.paymentLink = finalized.hosted_invoice_url || "";
      booking.invoicePdfUrl = finalized.invoice_pdf || "";
      booking.accounting = accountingPatch;

      if (stageNorm === "full") {
        booking.totals = booking.totals || {};
        booking.totals.fullAmount = Number((totalPence / 100).toFixed(2));
        booking.totals.depositAmount = 0;
      }

      if (stageNorm === "deposit") {
        booking.totals = booking.totals || {};
        booking.totals.depositAmount = Number((totalPence / 100).toFixed(2));
      }
    }

    await booking.save();

    return res.json({
      success: true,
      bookingId: booking.bookingId,
      stage: stageNorm,
      totalPence,
      commissionPence,
      passThroughPence,
      stripeInvoiceId: finalized.id,
      hosted_invoice_url: finalized.hosted_invoice_url,
      invoice_pdf: finalized.invoice_pdf,
      status: finalized.status,
      voidedPreviousInvoiceId: voidedInvoice?.id || null,
    });
  } catch (err) {
    console.error("createInvoicePayLink error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to create invoice.",
    });
  }
};

const voidExistingStripeInvoiceIfAny = async (booking) => {
  if (!stripe || !booking) return null;

  const candidateIds = [
    booking.stripeInvoiceId,
    booking.balanceInvoiceId,
    ...(Array.isArray(booking.addonPayments)
      ? booking.addonPayments
          .map((p) => p?.metadata?.stripeInvoiceId || p?.stripeInvoiceId || "")
          .filter(Boolean)
      : []),
  ].filter(Boolean);

  const uniqueIds = [...new Set(candidateIds)];

  for (const invoiceId of uniqueIds) {
    try {
      const existing = await stripe.invoices.retrieve(invoiceId);

      // Only void invoices that are still open/draft/uncollectible.
      // Do not attempt to void paid or already void invoices.
      if (
        existing &&
        ["draft", "open", "uncollectible"].includes(
          String(existing.status || ""),
        )
      ) {
        const voided = await stripe.invoices.voidInvoice(invoiceId);
        console.log("🧾 Voided existing Stripe invoice:", {
          bookingId: booking.bookingId,
          invoiceId,
          statusBefore: existing.status,
          statusAfter: voided?.status,
        });
        return voided;
      }
    } catch (err) {
      console.warn("⚠️ Failed to inspect/void old invoice:", {
        bookingId: booking.bookingId,
        invoiceId,
        error: err?.message || err,
      });
    }
  }

  return null;
};

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const vatFromGross = (gross, vatRate = 0.2) => {
  const vat = round2(gross * (vatRate / (1 + vatRate)));
  return { vat, net: round2(gross - vat) };
};

const getPrimaryEmail = (row) =>
  row?.clientEmails?.find?.((e) => e?.email)?.email ||
  row?.clientEmail ||
  row?.userEmail ||
  row?.userAddress?.email ||
  "";

const getInvoiceCompany = (row) => {
  const invoiceCompany = String(
    row?.invoiceCompany || row?.accounting?.invoiceCompany || "TSC",
  )
    .trim()
    .toUpperCase();

  if (invoiceCompany === "BMM") {
    return {
      name: "Bamboo Music Management Ltd",
      address: "Cramond, Reeves Lane, Roydon, CM19 5LE",
      email: "bamboomusicmgmt@gmail.com",
      companyNumber: "09318270",
      vatNumber: "517 6408 85",
      brand: "BMM",
      accent: "#43d8e8",
      vatRate: 0.2,
      bank: {
        accountName: "Bamboo Music Management Ltd",
        bankName: "Mettle (Prepay Technologies)",
        sortCode: "040333",
        accountNumber: "43875024",
      },
    };
  }

  return {
    name: "The Supreme Collective Ltd",
    address: "Cramond, Reeves Lane, Roydon, CM19 5LE",
    email: "hello@thesupremecollective.co.uk",
    companyNumber: "",
    vatNumber: "",
    brand: "TSC",
    accent: "#ff6667",
    vatRate: 0,
    bank: {
      accountName: "The Supreme Collective Limited",
      bankName: "",
      sortCode: "608371",
      accountNumber: "00973473",
    },
  };
};

const formatMoney = (value) => `£${Number(value || 0).toFixed(2)}`;

const formatInvoiceDate = (value) => {
  if (!value) return "TBC";

  const date =
    value instanceof Date
      ? value
      : /^\d{4}-\d{2}-\d{2}$/.test(String(value))
        ? new Date(`${value}T12:00:00`)
        : new Date(value);

  if (Number.isNaN(date.getTime())) return "TBC";

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const getDueDateThursdayWeekBefore = (eventDateValue) => {
  const eventDate = new Date(eventDateValue);
  if (Number.isNaN(eventDate.getTime())) return "";

  const due = new Date(eventDate);
  due.setDate(due.getDate() - 7);

  // Move back to Thursday of that week
  const day = due.getDay(); // Sun 0, Mon 1, Thu 4
  const diffToThursday = day - 4;
  due.setDate(due.getDate() - diffToThursday);

  return formatInvoiceDate(due);
};

const firstNonEmpty = (...values) =>
  values.find((value) => String(value || "").trim()) || "";

const getInvoiceLogoPath = (invoiceCompany) => {
  const envLogoPath =
    invoiceCompany?.brand === "BMM"
      ? process.env.BMM_INVOICE_LOGO_PATH || ""
      : process.env.TSC_INVOICE_LOGO_PATH || "";

  const fallbackLogoPath =
    invoiceCompany?.brand === "BMM"
      ? path.resolve(process.cwd(), "BambooMusicManagementInvoiceLogo.png")
      : "";

  return envLogoPath || fallbackLogoPath;
};

// Helper: get invoice extras and manual adjustment
const getInvoiceExtrasAndAdjustment = (row) => {
  const invoiceType = String(row?.invoiceType || "main").toLowerCase();

  const sourceExtras = Array.isArray(row?.extras)
    ? row.extras
    : Array.isArray(row?.bookingDetails?.extras)
      ? row.bookingDetails.extras
      : [];

  const invoiceExtras =
    invoiceType === "extras"
      ? sourceExtras.filter((extra) => extra?.includeOnExtrasInvoice !== false)
      : sourceExtras.filter((extra) => extra?.includeOnMainInvoice !== false);

  const extrasTotal = round2(
    invoiceExtras.reduce(
      (sum, extra) =>
        sum + Number(extra?.price || 0) * (Number(extra?.quantity || 1) || 1),
      0,
    ),
  );

  const manualAdjustment =
    row?.manualAdjustment || row?.bookingDetails?.manualAdjustment || null;

  const manualAdjustmentAmount =
    invoiceType === "extras"
      ? 0
      : round2(
          Number(row?.manualAdjustmentAmount ?? manualAdjustment?.amount ?? 0) ||
            0,
        );

  const manualAdjustmentLabel = String(
    row?.manualAdjustmentLabel ||
      manualAdjustment?.label ||
      "Manual adjustment",
  ).trim();

  return {
    invoiceExtras,
    extrasTotal,
    manualAdjustment,
    manualAdjustmentAmount,
    manualAdjustmentLabel,
  };
};

// Helper: build board invoice split
const buildBoardInvoiceSplit = (rowForInvoice, invoiceCompany) => {
  const invoiceType = String(rowForInvoice?.invoiceType || "main").toLowerCase();
  const { extrasTotal, manualAdjustmentAmount } =
    getInvoiceExtrasAndAdjustment(rowForInvoice);

  const storedGross = round2(
    rowForInvoice.grossValue ||
      rowForInvoice.totals?.fullAmount ||
      rowForInvoice.amount ||
      rowForInvoice.fee ||
      0,
  );

  const accounting = rowForInvoice.accounting || {};
  const vatRate = Number(accounting.vatRate ?? invoiceCompany.vatRate ?? 0);

  if (invoiceType === "extras") {
    const extrasVatSplit = vatFromGross(extrasTotal, vatRate);

    return {
      gross: extrasTotal,
      storedGross,
      extrasTotal,
      manualAdjustmentAmount: 0,
      invoiceCompany: invoiceCompany.brand,
      invoiceType: "extras",
      vatRate,
      commissionGross: extrasTotal,
      commissionNet: extrasVatSplit.net,
      commissionVat: extrasVatSplit.vat,
      passThroughGross: 0,
    };
  }

  const commissionGross = round2(
    accounting.commissionGross ||
      rowForInvoice.netCommission ||
      rowForInvoice.commissionGross ||
      rowForInvoice.commission ||
      rowForInvoice.estimatedCommission ||
      0,
  );

  const passThroughGross = round2(
    accounting.passThroughGross ||
      rowForInvoice.passThroughGross ||
      Math.max(
        storedGross - commissionGross - extrasTotal - manualAdjustmentAmount,
        0,
      ),
  );

  const commissionSplit = vatFromGross(commissionGross, vatRate);
  const calculatedGross = round2(
    passThroughGross + commissionGross + extrasTotal + manualAdjustmentAmount,
  );

  return {
    gross: calculatedGross || storedGross,
    storedGross,
    extrasTotal,
    manualAdjustmentAmount,
    invoiceCompany: invoiceCompany.brand,
    invoiceType: "main",
    vatRate,
    commissionGross,
    commissionNet: commissionSplit.net,
    commissionVat: commissionSplit.vat,
    passThroughGross,
  };
};

const makeInvoicePdfBuffer = (row, split, invoiceCompany) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      bufferPages: true,
    });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const navy = "#071827";
    const card = "#ffffff";
    const text = "#1f2937";
    const muted = "#6b7280";
    const line = "#d1d5db";
    const accent = invoiceCompany?.accent || "#43d8e8";

    const documentType = String(row?.documentType || "invoice").toLowerCase();
    const invoiceType = String(row?.invoiceType || "main").toLowerCase();
    const isExtrasInvoice = invoiceType === "extras";
    const isReceipt = documentType === "receipt";
    const baseInvoiceRef = row.bookingRef || row.bookingId || String(row._id);
    const invoiceRef = isExtrasInvoice
      ? `${baseInvoiceRef}-EXTRAS`
      : baseInvoiceRef;
    const clientName = firstNonEmpty(
      row.bookerName,
      row.clientName,
      row.booker,
      row.clientFirstNames,
      "Client",
    );
    const eventDate = firstNonEmpty(row.eventDateISO, row.eventDate, row.date);
    const eventDateFormatted = formatInvoiceDate(eventDate);
    const dueDate = firstNonEmpty(
      row.invoiceDueDateISO,
      row.invoiceDueDate,
      row.dueDateISO,
      row.dueDate,
      getDueDateThursdayWeekBefore(eventDate),
    );
    const paymentReference = row.bookingRef || row.bookingId || String(row._id);
    const actDisplayName = firstNonEmpty(
      row.actName,
      row.actTscName,
      row.tscName,
    );
    const clientAddress = firstNonEmpty(
      row.clientAddress,
      row.billingAddress,
      row.userAddress?.billingAddress,
      row.userAddress?.address1 &&
        [
          row.userAddress?.address1,
          row.userAddress?.address2,
          row.userAddress?.city,
          row.userAddress?.county,
          row.userAddress?.postcode,
        ]
          .filter(Boolean)
          .join(", "),
    );

    // Dark navy full-page background.
    doc.rect(0, 0, pageWidth, pageHeight).fill(navy);

    // Top banner.
    doc.rect(0, 0, pageWidth, 132).fill(navy);
    const logoPath = getInvoiceLogoPath(invoiceCompany);
    if (logoPath && fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 28, { fit: [240, 72] });
    } else {
      doc
        .fillColor(accent)
        .font("Helvetica-Bold")
        .fontSize(32)
        .text(
          invoiceCompany?.brand === "BMM" ? "BAMBOO" : "THE SUPREME",
          50,
          36,
        );
      doc
        .font("Helvetica")
        .fontSize(11)
        .text(
          invoiceCompany?.brand === "BMM" ? "MUSIC MANAGEMENT" : "COLLECTIVE",
          52,
          76,
          {
            characterSpacing: 4,
          },
        );
    }

    doc
      .strokeColor(accent)
      .lineWidth(1.5)
      .moveTo(50, 108)
      .lineTo(pageWidth - 50, 108)
      .stroke();

    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(26)
      .text(isReceipt ? "RECEIPT" : "INVOICE", pageWidth - 220, 42, {
        width: 170,
        align: "right",
      });

    // Main white invoice card.
    const cardX = 42;
    const cardY = 150;
    const cardW = pageWidth - 84;
    const cardH = pageHeight - 205;
    doc.roundedRect(cardX, cardY, cardW, cardH, 12).fill(card);

    // Company and invoice details.
    doc.fillColor(text).font("Helvetica-Bold").fontSize(12);
    doc.text("From", cardX + 26, cardY + 26);
    doc.font("Helvetica").fontSize(10).fillColor(text);
    doc.text(invoiceCompany.name, cardX + 26, cardY + 46);
    doc.text(invoiceCompany.address, cardX + 26, cardY + 61);
    doc.text(
      [invoiceCompany.phone, invoiceCompany.email].filter(Boolean).join(" | "),
      cardX + 26,
      cardY + 76,
    );
    if (invoiceCompany.companyNumber) {
      doc.text(
        `Company number: ${invoiceCompany.companyNumber}`,
        cardX + 26,
        cardY + 91,
      );
    }
    if (invoiceCompany.vatNumber) {
      doc.text(
        `VAT registration number: ${invoiceCompany.vatNumber}`,
        cardX + 26,
        cardY + 106,
      );
    }

    doc.fillColor(text).font("Helvetica-Bold").fontSize(12);
    doc.text(
      isReceipt ? "Receipt details" : "Invoice details",
      cardX + cardW - 210,
      cardY + 26,
      {
        width: 170,
        align: "right",
      },
    );
    doc.font("Helvetica").fontSize(10).fillColor(text);
    doc.text(
      `${isReceipt ? "Receipt" : "Invoice"} ref: ${invoiceRef}`,
      cardX + cardW - 230,
      cardY + 46,
      {
        width: 190,
        align: "right",
      },
    );
    doc.text(
      `Issue date: ${formatInvoiceDate(new Date())}`,
      cardX + cardW - 230,
      cardY + 61,
      {
        width: 190,
        align: "right",
      },
    );
    doc.text(
      isReceipt
        ? `Payment date: ${formatInvoiceDate(
            row?.payments?.paidAt ||
              row?.paidAt ||
              row?.payments?.invoicePaidAt ||
              row?.payments?.balancePaymentReceivedAt ||
              new Date(),
          )}`
        : `Due date: ${formatInvoiceDate(dueDate) || "TBC"}`,
      cardX + cardW - 230,
      cardY + 76,
      {
        width: 190,
        align: "right",
      },
    );

    // Client/event block.
    const detailY = cardY + 145;
    doc
      .strokeColor(line)
      .lineWidth(1)
      .moveTo(cardX + 26, detailY - 18)
      .lineTo(cardX + cardW - 26, detailY - 18)
      .stroke();

    doc
      .fillColor(text)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Bill to", cardX + 26, detailY);
    doc.font("Helvetica").fontSize(10).fillColor(text);
    doc.text(clientName, cardX + 26, detailY + 20);
    doc.text(getPrimaryEmail(row), cardX + 26, detailY + 35);
    if (clientAddress) {
      doc.text(clientAddress, cardX + 26, detailY + 50, { width: 230 });
    }

    doc
      .fillColor(text)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Event", cardX + 300, detailY);
    doc.font("Helvetica").fontSize(10).fillColor(text);
    doc.text(`Date: ${eventDateFormatted}`, cardX + 300, detailY + 20);
    const eventColumnX = cardX + 300;
    const eventColumnWidth = 190; // was 220

    doc.text(`Act: ${actDisplayName || "TBC"}`, eventColumnX, detailY + 35, {
      width: eventColumnWidth,
    });

    if (row.lineupSelected) {
      doc.text(`Lineup: ${row.lineupSelected}`, eventColumnX, detailY + 50, {
        width: eventColumnWidth,
        lineGap: 1,
      });
    }

    // Invoice table.
    const tableX = cardX + 26;
    const tableY = detailY + 105;
    const tableW = cardW - 52;
    const descW = 300;
    const qtyW = 55;
    const amountW = tableW - descW - qtyW;

    doc.roundedRect(tableX, tableY, tableW, 30, 4).fill(navy);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10);
    doc.text("Description", tableX + 12, tableY + 10, { width: descW - 20 });
    doc.text("Qty", tableX + descW + 8, tableY + 10, {
      width: qtyW - 12,
      align: "right",
    });
    doc.text("Amount", tableX + descW + qtyW + 8, tableY + 10, {
      width: amountW - 20,
      align: "right",
    });

    const { invoiceExtras, manualAdjustmentAmount, manualAdjustmentLabel } =
      getInvoiceExtrasAndAdjustment(row);

    const visibleExtras = invoiceExtras
      .map((extra) => ({
        description: String(extra?.name || extra?.key || "Extra").trim(),
        qty: String(Number(extra?.quantity || 1) || 1),
        amount: round2(
          Number(extra?.price || 0) * (Number(extra?.quantity || 1) || 1),
        ),
      }))
      .filter((extra) => extra.description && Number(extra.amount || 0) !== 0);

    const rows = isExtrasInvoice
      ? [
          ...visibleExtras,
          ...(split.commissionVat > 0
            ? [
                {
                  description: "VAT included within extras total",
                  qty: "",
                  amount: split.commissionVat,
                  muted: true,
                },
              ]
            : []),
        ]
      : [
          {
            description: "Band fee / artist performance fee",
            qty: "1",
            amount: split.passThroughGross,
          },
          ...visibleExtras,
          ...(manualAdjustmentAmount !== 0
            ? [
                {
                  description: manualAdjustmentLabel || "Manual adjustment",
                  qty: "1",
                  amount: manualAdjustmentAmount,
                },
              ]
            : []),
          {
            description: "Music management (VAT inclusive)",
            qty: "1",
            amount: split.commissionGross,
          },
          {
            description: "VAT included within management fee",
            qty: "",
            amount: split.commissionVat,
            muted: true,
          },
        ];

    let y = tableY + 30;
    rows.forEach((item, index) => {
      const rowH = 34;
      doc
        .rect(tableX, y, tableW, rowH)
        .fill(index % 2 === 0 ? "#f9fafb" : "#ffffff");
      doc
        .fillColor(item.muted ? muted : text)
        .font(item.muted ? "Helvetica" : "Helvetica-Bold")
        .fontSize(10);
      doc.text(item.description, tableX + 12, y + 11, { width: descW - 20 });
      doc.text(item.qty, tableX + descW + 8, y + 11, {
        width: qtyW - 12,
        align: "right",
      });
      doc.text(formatMoney(item.amount), tableX + descW + qtyW + 8, y + 11, {
        width: amountW - 20,
        align: "right",
      });
      doc
        .strokeColor(line)
        .moveTo(tableX, y + rowH)
        .lineTo(tableX + tableW, y + rowH)
        .stroke();
      y += rowH;
    });

    // Totals.
    const totalsX = cardX + cardW - 245;
    const totalsY = y + 24;
    doc.fillColor(text).font("Helvetica").fontSize(10);

    let totalsLineY = totalsY;
    let totalLabelY = totalsY + 12;

    if (isExtrasInvoice) {
      doc.text("Extras", totalsX, totalsY, { width: 125 });
      doc.text(formatMoney(split.extrasTotal), totalsX + 125, totalsY, {
        width: 90,
        align: "right",
      });
      if (Number(split.commissionVat || 0) !== 0) {
        doc.text("VAT included", totalsX, totalsY + 18, { width: 125 });
        doc.text(formatMoney(split.commissionVat), totalsX + 125, totalsY + 18, {
          width: 90,
          align: "right",
        });
        totalsLineY = totalsY + 44;
        totalLabelY = totalsY + 56;
      } else {
        totalsLineY = totalsY + 26;
        totalLabelY = totalsY + 38;
      }
    } else {
      doc.text("Band fee / pass-through", totalsX, totalsY, { width: 125 });
      doc.text(formatMoney(split.passThroughGross), totalsX + 125, totalsY, {
        width: 90,
        align: "right",
      });
      doc.text("Management fee VAT-inc", totalsX, totalsY + 18, { width: 125 });
      doc.text(formatMoney(split.commissionGross), totalsX + 125, totalsY + 18, {
        width: 90,
        align: "right",
      });
      doc.text("VAT on management fee", totalsX, totalsY + 36, { width: 125 });
      doc.text(formatMoney(split.commissionVat), totalsX + 125, totalsY + 36, {
        width: 90,
        align: "right",
      });

      totalsLineY = totalsY + 62;
      totalLabelY = totalsY + 74;

      if (Number(split.extrasTotal || 0) !== 0) {
        doc.text("Extras", totalsX, totalsY + 54, { width: 125 });
        doc.text(formatMoney(split.extrasTotal), totalsX + 125, totalsY + 54, {
          width: 90,
          align: "right",
        });
        totalsLineY += 18;
        totalLabelY += 18;
      }

      if (Number(split.manualAdjustmentAmount || 0) !== 0) {
        doc.text("Manual adjustment", totalsX, totalsLineY - 8, { width: 125 });
        doc.text(
          formatMoney(split.manualAdjustmentAmount),
          totalsX + 125,
          totalsLineY - 8,
          {
            width: 90,
            align: "right",
          },
        );
        totalsLineY += 18;
        totalLabelY += 18;
      }
    }

    doc
      .strokeColor(accent)
      .lineWidth(1.5)
      .moveTo(totalsX, totalsLineY)
      .lineTo(totalsX + 215, totalsLineY)
      .stroke();
    doc.fillColor(text).font("Helvetica-Bold").fontSize(13);
    doc.text(isReceipt ? "Total paid" : "Total due", totalsX, totalLabelY, {
      width: 125,
    });
    doc.text(formatMoney(split.gross), totalsX + 125, totalLabelY, {
      width: 90,
      align: "right",
    });

    // Payment details and VAT note.
    const paymentY = cardY + cardH - 112;
    const vatNoteY = Math.max(paymentY, totalLabelY + 32);

    doc
      .fillColor(text)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(
        isReceipt ? "Payment received" : "Bank transfer details",
        cardX + 26,
        paymentY,
      );

    doc.fillColor(text).font("Helvetica").fontSize(9);
    if (isReceipt) {
      doc.text(`Received from: ${clientName}`, cardX + 26, paymentY + 16);
      doc.text(
        `Payment reference: ${paymentReference}`,
        cardX + 26,
        paymentY + 30,
      );
      doc.text(
        `Payment received: ${formatInvoiceDate(
          row?.payments?.paidAt ||
            row?.paidAt ||
            row?.payments?.invoicePaidAt ||
            row?.payments?.balancePaymentReceivedAt ||
            new Date(),
        )}`,
        cardX + 26,
        paymentY + 44,
      );
      doc.text(
        `Amount received: ${formatMoney(split.gross)}`,
        cardX + 26,
        paymentY + 58,
      );
    } else {
      doc.text(
        `Account name: ${invoiceCompany.bank?.accountName || invoiceCompany.name}`,
        cardX + 26,
        paymentY + 16,
      );
      if (invoiceCompany.bank?.bankName) {
        doc.text(
          `Bank: ${invoiceCompany.bank.bankName}`,
          cardX + 26,
          paymentY + 30,
        );
      }
      doc.text(
        `Sort code: ${invoiceCompany.bank?.sortCode || ""}`,
        cardX + 26,
        paymentY + 44,
      );
      doc.text(
        `Account number: ${invoiceCompany.bank?.accountNumber || ""}`,
        cardX + 26,
        paymentY + 58,
      );
      doc.text(
        `Payment reference: ${paymentReference}`,
        cardX + 26,
        paymentY + 72,
      );
    }

    doc
      .fillColor(muted)
      .font("Helvetica")
      .fontSize(8)
      .text(
        isReceipt
          ? isExtrasInvoice
            ? "Thank you, payment has been received. This receipt relates to additional services and/or equipment hire for the event."
            : "Thank you, payment has been received. VAT is charged only on the music management element. The band fee is shown separately as a pass-through artist fee."
          : isExtrasInvoice
            ? "Please use the payment reference above so we can match your payment quickly. This invoice relates only to additional services and/or equipment hire for the event."
            : "Please use the payment reference above so we can match your payment quickly. VAT is charged only on the music management element. The band fee is shown separately as a pass-through artist fee.",
        cardX + 270,
        vatNoteY,
        { width: cardW - 296 },
      );

    doc
      .fillColor("#ffffff")
      .font("Helvetica")
      .fontSize(8)
      .text(
        `${invoiceCompany.name} • ${invoiceCompany.email}`,
        50,
        pageHeight - 34,
        {
          width: pageWidth - 100,
          align: "center",
        },
      );

    doc.end();
  });

export const createBoardInvoice = async (req, res) => {
  try {
    const {
      bookingId,
      invoiceCompany: invoiceCompanyFromRequest,
      documentType = "invoice",
      invoiceType = "main",
      includePaymentLink = false,
    } = req.body;

    const documentStamp = `${Date.now()}`;
    const documentTypeNorm = String(documentType || "invoice").toLowerCase();
    const invoiceTypeNorm = String(invoiceType || "main").toLowerCase();
    const isExtrasInvoice = invoiceTypeNorm === "extras";
    const isReceipt = documentTypeNorm === "receipt";
    const now = new Date();
    const invoiceDateISO = now.toISOString().slice(0, 10);

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "bookingId is required",
      });
    }

    const row = await BookingBoardItem.findById(bookingId).lean();

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Booking board row not found",
      });
    }

    if (isReceipt) {
      const isPaid = Boolean(
        row?.payments?.balancePaymentReceived ||
        row?.payments?.invoicePaid ||
        row?.balancePaid ||
        row?.balanceStatus === "paid",
      );

      if (!isPaid) {
        return res.status(400).json({
          success: false,
          message:
            "Invoice must be marked as paid before generating a receipt.",
        });
      }
    }

    const eventDate = firstNonEmpty(row.eventDateISO, row.eventDate, row.date);
    const finalDueDate = firstNonEmpty(
      row.invoiceDueDateISO,
      row.invoiceDueDate,
      row.dueDateISO,
      row.dueDate,
      getDueDateThursdayWeekBefore(eventDate),
    );

    const rowForInvoice = {
      ...row,
      documentType: documentTypeNorm,
      invoiceType: invoiceTypeNorm,
      invoiceDateISO,
      invoiceDueDateISO: finalDueDate,
      invoiceCompany:
        invoiceCompanyFromRequest ||
        row.invoiceCompany ||
        row?.accounting?.invoiceCompany ||
        "TSC",
    };

    const invoiceCompany = getInvoiceCompany(rowForInvoice);

    const split = buildBoardInvoiceSplit(rowForInvoice, invoiceCompany);

    const actDisplayName = firstNonEmpty(
  rowForInvoice.actName,
  rowForInvoice.actTscName,
  rowForInvoice.tscName,
);

    console.log("🧾 Invoice debug:", {
      documentType: documentTypeNorm,
      invoiceType: invoiceTypeNorm,
      isExtrasInvoice,
      bookingRef: rowForInvoice.bookingRef,
      invoiceDateISO,
      finalDueDate,
      actDisplayName: firstNonEmpty(
        rowForInvoice.actName,
        rowForInvoice.actTscName,
        rowForInvoice.tscName,
      ),
      actTscName: rowForInvoice.actTscName,
      actName: rowForInvoice.actName,
      tscName: rowForInvoice.tscName,
      extrasTotal: split.extrasTotal,
      manualAdjustmentAmount: split.manualAdjustmentAmount,
      storedGross: split.storedGross,
      calculatedGross: split.gross,
    });

    const pdfBuffer = await makeInvoicePdfBuffer(
      rowForInvoice,
      split,
      invoiceCompany,
    );

    if (
      !pdfBuffer?.length ||
      !pdfBuffer.slice(0, 4).toString().includes("%PDF")
    ) {
      throw new Error("Generated invoice buffer is not a valid PDF.");
    }

    console.log("🧾 PDF buffer debug:", {
      documentType: documentTypeNorm,
      length: pdfBuffer?.length,
      firstBytes: pdfBuffer?.slice(0, 20).toString(),
      isPdf: pdfBuffer?.slice(0, 4).toString() === "%PDF",
    });

    const publicIdPrefix = isReceipt
      ? isExtrasInvoice
        ? "extras-receipt"
        : "receipt"
      : isExtrasInvoice
        ? "extras-invoice"
        : "invoice";

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "booking-board-invoices",
          resource_type: "raw",
          public_id: `${publicIdPrefix}-${rowForInvoice.bookingRef || rowForInvoice._id}-${documentStamp}.pdf`,
          overwrite: false,
          invalidate: true,
          type: "upload",
        },
        (error, result) => {
          console.log("☁️ Cloudinary invoice/receipt upload result:", result);
          if (error) {
            console.error("❌ Cloudinary invoice/receipt upload error:", error);
            reject(error);
          } else {
            resolve(result);
          }
        },
      );

      stream.end(pdfBuffer);
    });

    const documentUrl = uploadResult.secure_url;
    const browserDocumentUrl = documentUrl;

    let cardPaymentUrl = "";
    let cardPaymentSessionId = "";

    if (includePaymentLink && !isReceipt) {
      const paymentStripe = getStripeClientForCompany(invoiceCompany);
      const origin = getOrigin(req);
      const amountPence = Math.max(
        0,
        Math.round(Number(split.gross || 0) * 100),
      );
      const ref = rowForInvoice.bookingRef || String(rowForInvoice._id);
      const customerEmail = getPrimaryEmail(rowForInvoice)
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean)[0];

      if (!amountPence) {
        throw new Error(
          "Cannot create card payment link because invoice total is zero.",
        );
      }

      const checkoutMetadata = {
        category: "board_invoice",
        payment_stage: "board_invoice",
        paymentStage: "board_invoice",
        invoiceType: invoiceTypeNorm,
        bookingId: ref,
        booking_ref: ref,
        boardRowId: String(rowForInvoice._id),
        bookingMongoId: String(
          rowForInvoice.sourceBookingId || rowForInvoice.bookingId || "",
        ),
        invoiceCompany: invoiceCompany.brand,
        amount_pence: String(amountPence),
        commission_gross: String(Number(split.commissionGross || 0).toFixed(2)),
        commission_vat: String(Number(split.commissionVat || 0).toFixed(2)),
        commission_net: String(Number(split.commissionNet || 0).toFixed(2)),
        pass_through_gross: String(
          Number(split.passThroughGross || 0).toFixed(2),
        ),
      };

      const session = await paymentStripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: customerEmail || undefined,
        line_items: [
          {
            price_data: {
              currency: String(
                split.currency || rowForInvoice?.accounting?.currency || "GBP",
              ).toLowerCase(),
              product_data: {
                name: `Invoice ${ref}`,
                description: `${actDisplayName || rowForInvoice.actName || "Booking"} - ${invoiceCompany.name}`,
              },
              unit_amount: amountPence,
            },
            quantity: 1,
          },
        ],
        success_url: `${origin}/admin/booking-board?invoicePaid=1&bookingRef=${encodeURIComponent(ref)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/admin/booking-board?invoiceCanceled=1&bookingRef=${encodeURIComponent(ref)}`,
        metadata: checkoutMetadata,
        payment_intent_data: {
          metadata: checkoutMetadata,
        },
      });

      cardPaymentUrl = session.url || "";
      cardPaymentSessionId = session.id || "";
    }

    console.log("🧾 Invoice/receipt delivery URLs:", {
      secure_url: uploadResult.secure_url,
      forced_download_url: documentUrl,
      browser_document_url: browserDocumentUrl,
      includePaymentLink,
      cardPaymentSessionId,
      hasCardPaymentUrl: Boolean(cardPaymentUrl),
      documentType: documentTypeNorm,
      invoiceType: invoiceTypeNorm,
      documentStamp,
      invoiceDateISO,
      finalDueDate,
      invoiceCompany: invoiceCompany.brand,
      vatRate: split.vatRate,
    });

    const boardSetPatch = isReceipt
      ? isExtrasInvoice
        ? {
            invoiceCompany: invoiceCompany.brand,
            extrasReceiptUrl: browserDocumentUrl,
            extrasReceiptPdfUrl: browserDocumentUrl,
            extrasReceiptCreatedAt: now,
            extrasPaid: true,
            extrasStatus: "paid",
            extrasPaidAt: now,
            "payments.extrasPaymentReceived": true,
            "payments.extrasInvoicePaid": true,
            "payments.extrasReceiptPdfUrl": browserDocumentUrl,
            "payments.extrasReceiptCreatedAt": now,
            "payments.extrasPaidAt": now,
            extrasAccounting: split,
          }
        : {
            invoiceCompany: invoiceCompany.brand,
            receiptUrl: browserDocumentUrl,
            receiptPdfUrl: browserDocumentUrl,
            receiptCreatedAt: now,
            balancePaid: true,
            balanceStatus: "paid",
            paidAt: now,
            "payments.balancePaymentReceived": true,
            "payments.invoicePaid": true,
            "payments.boardReceiptPdfUrl": browserDocumentUrl,
            "payments.receiptPdfUrl": browserDocumentUrl,
            "payments.receiptCreatedAt": now,
            "payments.paidAt": now,
            accounting: split,
          }
      : isExtrasInvoice
        ? {
            invoiceCompany: invoiceCompany.brand,
            extrasInvoiceDateISO: invoiceDateISO,
            extrasInvoiceDueDateISO: finalDueDate,
            extrasInvoiceUrl: browserDocumentUrl,
            extrasInvoicePdfUrl: browserDocumentUrl,
            extrasStatus: "sent",
            extrasPaid: false,
            "payments.extrasInvoicePdfUrl": browserDocumentUrl,
            "payments.extrasInvoiceCreatedAt": now,
            ...(cardPaymentUrl
              ? {
                  "payments.extrasInvoiceUrl": cardPaymentUrl,
                  "payments.extrasInvoiceId": cardPaymentSessionId,
                }
              : {}),
            extrasAccounting: split,
          }
        : {
            invoiceCompany: invoiceCompany.brand,
            invoiceDateISO,
            invoiceDueDateISO: finalDueDate,
            invoiceUrl: browserDocumentUrl,
            invoicePdfUrl: browserDocumentUrl,
            "payments.boardInvoicePdfUrl": browserDocumentUrl,
            "payments.boardInvoiceCreatedAt": now,
            ...(cardPaymentUrl
              ? {
                  "payments.balanceInvoiceUrl": cardPaymentUrl,
                  "payments.balanceInvoiceId": cardPaymentSessionId,
                }
              : {}),
            accounting: split,
          };

    const updated = await BookingBoardItem.findByIdAndUpdate(
      row._id,
      { $set: boardSetPatch },
      { new: true },
    );

    // Booking.payments can be an array in the main Booking model, so do not use
    // dotted payments.* updates here. Keep receipt/invoice document URLs at the
    // top level on Booking, and store nested payments.* fields only on BookingBoardItem.
    const bookingSetPatch = isReceipt
      ? isExtrasInvoice
        ? {
            invoiceCompany: invoiceCompany.brand,
            extrasReceiptUrl: browserDocumentUrl,
            extrasReceiptPdfUrl: browserDocumentUrl,
            extrasReceiptCreatedAt: now,
            extrasPaid: true,
            extrasStatus: "paid",
            extrasPaidAt: now,
            extrasAccounting: split,
          }
        : {
            invoiceCompany: invoiceCompany.brand,
            receiptUrl: browserDocumentUrl,
            receiptPdfUrl: browserDocumentUrl,
            receiptCreatedAt: now,
            balancePaid: true,
            balanceStatus: "paid",
            paidAt: now,
            accounting: split,
          }
      : isExtrasInvoice
        ? {
            invoiceCompany: invoiceCompany.brand,
            extrasInvoiceDateISO: invoiceDateISO,
            extrasInvoiceDueDateISO: finalDueDate,
            extrasInvoiceUrl: browserDocumentUrl,
            extrasInvoicePdfUrl: browserDocumentUrl,
            extrasStatus: "sent",
            extrasPaid: false,
            ...(cardPaymentUrl
              ? {
                  extrasPaymentLink: cardPaymentUrl,
                  extrasStripeSessionId: cardPaymentSessionId,
                }
              : {}),
            extrasAccounting: split,
          }
        : {
            invoiceCompany: invoiceCompany.brand,
            invoiceDateISO,
            invoiceDueDateISO: finalDueDate,
            invoiceUrl: browserDocumentUrl,
            invoicePdfUrl: browserDocumentUrl,
            ...(cardPaymentUrl
              ? {
                  paymentLink: cardPaymentUrl,
                  balanceInvoiceUrl: cardPaymentUrl,
                  balanceInvoiceId: cardPaymentSessionId,
                  balanceStatus: "sent",
                  balancePaid: false,
                }
              : {}),
            accounting: split,
          };

    await Booking.findOneAndUpdate(
      {
        $or: [
          { _id: row.sourceBookingId },
          { _id: row.bookingId },
          { bookingId: row.bookingRef },
          { bookingRef: row.bookingRef },
        ].filter((x) => Object.values(x)[0]),
      },
      { $set: bookingSetPatch },
    );

    return res.json({
      success: true,
      documentType: documentTypeNorm,
      invoiceType: invoiceTypeNorm,
      invoiceUrl: isReceipt
        ? updated?.invoiceUrl
        : isExtrasInvoice
          ? updated?.invoiceUrl
          : browserDocumentUrl,
      invoicePdfUrl: isReceipt
        ? updated?.invoicePdfUrl
        : isExtrasInvoice
          ? updated?.invoicePdfUrl
          : browserDocumentUrl,
      receiptUrl: isReceipt
        ? isExtrasInvoice
          ? updated?.receiptUrl
          : browserDocumentUrl
        : updated?.receiptUrl,
      receiptPdfUrl: isReceipt
        ? isExtrasInvoice
          ? updated?.receiptPdfUrl
          : browserDocumentUrl
        : updated?.receiptPdfUrl,
      extrasInvoiceUrl: isReceipt
        ? updated?.extrasInvoiceUrl
        : isExtrasInvoice
          ? browserDocumentUrl
          : updated?.extrasInvoiceUrl,
      extrasInvoicePdfUrl: isReceipt
        ? updated?.extrasInvoicePdfUrl
        : isExtrasInvoice
          ? browserDocumentUrl
          : updated?.extrasInvoicePdfUrl,
      extrasReceiptUrl: isReceipt
        ? isExtrasInvoice
          ? browserDocumentUrl
          : updated?.extrasReceiptUrl
        : updated?.extrasReceiptUrl,
      extrasReceiptPdfUrl: isReceipt
        ? isExtrasInvoice
          ? browserDocumentUrl
          : updated?.extrasReceiptPdfUrl
        : updated?.extrasReceiptPdfUrl,
      previewUrl: isReceipt
        ? `/api/invoices/board-receipt/${row._id}${isExtrasInvoice ? "?invoiceType=extras" : ""}`
        : `/api/invoices/board-invoice/${row._id}${isExtrasInvoice ? "?invoiceType=extras" : ""}`,
      invoiceCompany: invoiceCompany.brand,
      invoiceDateISO,
      invoiceDueDateISO: finalDueDate,
      paymentUrl: cardPaymentUrl,
      cardPaymentUrl,
      cardPaymentSessionId,
      row: updated,
    });
  } catch (error) {
    console.error("createBoardInvoice error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Could not create invoice",
    });
  }
};

export const serveBoardReceiptPdf = async (req, res) => {
  try {
    const row = await BookingBoardItem.findById(req.params.id).lean();

    if (!row) return res.status(404).send("Receipt not found");

    const invoiceTypeNorm = String(req.query?.invoiceType || "main").toLowerCase();

    const rowForInvoice = {
      ...row,
      documentType: "receipt",
      invoiceType: invoiceTypeNorm,
      invoiceCompany:
        row.invoiceCompany || row?.accounting?.invoiceCompany || "TSC",
    };

    const invoiceCompany = getInvoiceCompany(rowForInvoice);
    const split = buildBoardInvoiceSplit(rowForInvoice, invoiceCompany);

    const pdfBuffer = await makeInvoicePdfBuffer(
      rowForInvoice,
      split,
      invoiceCompany,
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="receipt-${row.bookingRef || row._id}.pdf"`,
    );

    return res.send(pdfBuffer);
  } catch (error) {
    console.error("serveBoardReceiptPdf error:", error);
    return res.status(500).send("Could not load receipt");
  }
};

export const serveBoardInvoicePdf = async (req, res) => {
  try {
    const row = await BookingBoardItem.findById(req.params.id).lean();

    if (!row) return res.status(404).send("Invoice not found");

    const invoiceTypeNorm = String(req.query?.invoiceType || "main").toLowerCase();

    const eventDate = firstNonEmpty(row.eventDateISO, row.eventDate, row.date);
    const finalDueDate = firstNonEmpty(
      row.invoiceDueDateISO,
      row.invoiceDueDate,
      row.dueDateISO,
      row.dueDate,
      getDueDateThursdayWeekBefore(eventDate),
    );

    const rowForInvoice = {
      ...row,
      documentType: "invoice",
      invoiceType: invoiceTypeNorm,
      invoiceDueDateISO: finalDueDate,
      invoiceCompany:
        row.invoiceCompany || row?.accounting?.invoiceCompany || "TSC",
    };

    const invoiceCompany = getInvoiceCompany(rowForInvoice);

    const split = buildBoardInvoiceSplit(rowForInvoice, invoiceCompany);

    const pdfBuffer = await makeInvoicePdfBuffer(
      rowForInvoice,
      split,
      invoiceCompany,
    );

    if (!pdfBuffer?.length || pdfBuffer.slice(0, 4).toString() !== "%PDF") {
      throw new Error("Generated invoice buffer is not a valid PDF.");
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="invoice-${row.bookingRef || row._id}.pdf"`,
    );
    res.setHeader("Cache-Control", "no-store");

    return res.send(pdfBuffer);
  } catch (error) {
    console.error("serveBoardInvoicePdf error:", error);
    return res.status(500).send("Could not load invoice");
  }
};

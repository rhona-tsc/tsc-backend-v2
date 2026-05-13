// controllers/invoicesController.js
import { startOfDay, subDays, subHours, isValid, parseISO } from "date-fns";
import Booking from "../models/bookingModel.js";
import { enqueueReminder } from "../services/remindersQueue.js"; // BullMQ / Agenda / node-cron wrapper
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_V2, {
  apiVersion: "2024-06-20",
});

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

    const full = Number(booking?.totals?.fullAmount || 0);
    const charged = Number(booking?.totals?.chargedAmount || 0);
    const explicit = Number(booking?.balanceAmountPence ?? NaN);

    // Always prefer the latest totals on the booking.
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

    // If the frontend knows the current expected amount, trust that when it is
    // present so the checkout always matches the UI.
    const remainingPence =
      expectedAmountPence > 0 ? expectedAmountPence : calculatedRemainingPence;

    if (!remainingPence) {
      return res
        .status(400)
        .json({ success: false, message: "No outstanding balance." });
    }

    const existingAmountMatches =
      Number(booking?.balanceAmountPence || 0) === remainingPence;

    // If the booking still has money outstanding, stale paid flags should not
    // block a new invoice from being created.
    if (
      remainingPence > 0 &&
      (booking.balancePaid === true || booking.balanceStatus === "paid")
    ) {
      booking.balancePaid = false;
      booking.balanceStatus = "sent";
    }

    // Reuse the existing hosted checkout only when:
    // 1) the caller did not explicitly request a refresh, and
    // 2) the amount still matches.
    if (
      booking.balanceInvoiceUrl &&
      existingAmountMatches &&
      !refreshRequested
    ) {
      return res.json({ success: true, url: booking.balanceInvoiceUrl });
    }

    // Clear stale checkout references whenever the amount changed or the client
    // explicitly asked for a refresh.
    if (!existingAmountMatches || refreshRequested) {
      booking.balanceInvoiceUrl = "";
      booking.balanceInvoiceId = "";
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
      metadata: {
        category: "balance",
        bookingId: ref,
        bookingMongoId: String(booking._id),
        remainingPence: String(remainingPence),
        fullAmount: String(full),
        chargedAmount: String(charged),
      },
    });

    booking.balanceAmountPence = remainingPence;
    booking.balanceInvoiceUrl = session.url;
    booking.balanceInvoiceId = session.id;
    booking.balanceStatus = "sent";
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
          `${stageNorm.startsWith("addon") ? "Add-on" : "Booking"} artist fee${suffix}`,
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

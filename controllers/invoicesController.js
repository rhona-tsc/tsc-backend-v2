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
    return res
      .status(500)
      .json({
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
    return res
      .status(500)
      .json({
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
    } = req.body || {};

    if (!bookingIdOrRef || !stage || !amountPence || amountPence <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields." });
    }

    const booking = await Booking.findOne(
      looksLikeObjectId(bookingIdOrRef)
        ? { _id: bookingIdOrRef }
        : { bookingId: bookingIdOrRef },
    );

    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found." });
    }

    const customer = await getOrCreateStripeCustomer({
      email: customerEmail,
      name: customerName,
    });

    // 1) create invoice item

    await stripe.invoiceItems.create({
      customer: customer.id,

      amount: Number(amountPence),

      currency: String(currency).toLowerCase(),

      description:
        description || `Payment for booking ${booking.bookingId} (${stage})`,

      metadata: {
        bookingId: booking.bookingId,

        stage,

        ...metadata,
      },
    });

    // 2) create invoice (send_invoice = hosted link with pay button)

    const invoice = await stripe.invoices.create({
      customer: customer.id,

      collection_method: "send_invoice",

      days_until_due: Number(daysUntilDue) || 7,

      auto_advance: true, // finalize automatically

      metadata: {
        bookingId: booking.bookingId,

        stage,

        ...metadata,
      },
    });

    // 3) finalize (so hosted url + pdf exists)

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);

    // 4) store on booking (stage-specific)

    if (stage === "balance") {
      booking.stripeInvoiceId = finalized.id;

      booking.balanceInvoiceId = finalized.id;

      booking.balanceInvoiceUrl = finalized.hosted_invoice_url || "";

      booking.balanceStatus = "sent";

      booking.balancePaid = false;
    } else if (stage === "addon_deposit" || stage === "addon_full") {
      booking.addonPayments = Array.isArray(booking.addonPayments)
        ? booking.addonPayments
        : [];

      booking.addonPayments.push({
        stage,

        amountPence: Number(amountPence),

        currency,

        label: description || "",

        checkoutSessionId: "", // invoice-based, not checkout

        checkoutUrl: finalized.hosted_invoice_url || "",

        paymentIntentId: finalized.payment_intent || "",

        chargeId: "",

        status: "sent",

        metadata: { stripeInvoiceId: finalized.id },
      });
    } else {
      // deposit/full (invoice path)

      booking.stripeInvoiceId = finalized.id;

      booking.invoiceRequested = true;
    }

    await booking.save();

    return res.json({
      success: true,

      bookingId: booking.bookingId,

      stripeInvoiceId: finalized.id,

      hosted_invoice_url: finalized.hosted_invoice_url,

      invoice_pdf: finalized.invoice_pdf,

      status: finalized.status,
    });
  } catch (err) {
    console.error("createInvoicePayLink error:", err);

    return res
      .status(500)
      .json({
        success: false,
        message: err?.message || "Failed to create invoice.",
      });
  }
};

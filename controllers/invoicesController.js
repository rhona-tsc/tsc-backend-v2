// controllers/invoicesController.js
import { startOfDay, subDays, subHours, isValid, parseISO } from "date-fns";
import Booking from "../models/bookingModel.js";
import { enqueueReminder } from "../services/remindersQueue.js"; // BullMQ / Agenda / node-cron wrapper
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });


const looksLikeObjectId = (v) => typeof v === "string" && /^[0-9a-f]{24}$/i.test(v);

// Keep the same origin helper you used elsewhere
const getOrigin = (req) => {
  const env = process.env.FRONTEND_URL && String(process.env.FRONTEND_URL);
  const hdr = req.headers.origin && String(req.headers.origin);
  const fallback = "http://localhost:5174";
  const chosen = env || hdr || fallback;
  try { const u = new URL(chosen); return `${u.protocol}//${u.host}`; } catch { return fallback; }
};


export const scheduleBalance = async (req, res) => {
  try {
    const {
      bookingId,
      actId,
      customerId,        // optional Stripe customer id
      eventDateISO,
      currency = "GBP",
      amountPence,
      metadata = {},
      dueAtISO,          // optional; if omitted we compute event - 14 days
    } = req.body;

    if (!bookingId || !eventDateISO || !amountPence) {
      return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    const eventDate = parseISO(eventDateISO);
    if (!isValid(eventDate)) {
      return res.status(400).json({ success: false, message: "Invalid eventDateISO." });
    }

    const computedDue = startOfDay(subDays(eventDate, 14));
    const dueAt = dueAtISO ? parseISO(dueAtISO) : computedDue;
    if (!isValid(dueAt)) {
      return res.status(400).json({ success: false, message: "Invalid dueAtISO." });
    }

    
    const booking = await Booking.findOne({ $or: [{ bookingId }, { _id: bookingId }] });
       if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
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
      enqueueReminder("BALANCE_REMINDER", { bookingId, whenISO: at7d.toISOString(), kind: "7d" }),
      enqueueReminder("BALANCE_REMINDER", { bookingId, whenISO: at3d.toISOString(), kind: "3d" }),
      enqueueReminder("BALANCE_REMINDER", { bookingId, whenISO: onDueMorning.toISOString(), kind: "due" }),
      enqueueReminder("BALANCE_REMINDER", { bookingId, whenISO: subHours(onDueMorning, -24).toISOString(), kind: "overdue+1d" }),
    ]);

    return res.json({
      success: true,
      stripeInvoiceId,
      dueAtISO: dueAt.toISOString(),
    });
  } catch (err) {
    console.error("scheduleBalance error:", err);
    return res.status(500).json({ success: false, message: "Failed to schedule balance." });
  }
};



export const getOrCreateBalanceLink = async (req, res) => {
  try {
    const { idOrRef } = req.params;                          // <-- matches route
    const booking = await Booking.findOne(
      looksLikeObjectId(idOrRef) ? { _id: idOrRef } : { bookingId: idOrRef }
    );
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });

    const full     = Number(booking?.totals?.fullAmount || 0);
    const charged  = Number(booking?.totals?.chargedAmount || 0);
    const explicit = Number(booking?.balanceAmountPence ?? NaN);
    const remainingPence = Number.isFinite(explicit) && explicit > 0 ? explicit : Math.max(0, Math.round((full - charged) * 100));

    if (!remainingPence) return res.status(400).json({ success: false, message: "No outstanding balance." });
    if (booking.balancePaid === true || booking.balanceStatus === "paid") {
      return res.status(400).json({ success: false, message: "Balance already paid." });
    }

    // Reuse existing hosted url if present
    if (booking.balanceInvoiceUrl) {
      return res.json({ success: true, url: booking.balanceInvoiceUrl });
    }

    const origin = getOrigin(req);
    const ref = booking.bookingId || String(booking._id);

    // Create a Stripe Checkout session (simple and works with your success/cancel redirect)
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: (booking?.totals?.currency || "GBP").toLowerCase(),
          product_data: { name: `Outstanding balance for ${ref}` },
          unit_amount: remainingPence,
        },
        quantity: 1,
      }],
      success_url: `${origin}/event-sheet/${ref}?balancePaid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/event-sheet/${ref}?balanceCanceled=1`,
      metadata: { category: "balance", bookingId: ref },
    });

    booking.balanceInvoiceUrl = session.url;
    booking.balanceInvoiceId  = session.id;
    booking.balanceStatus     = "sent";
    await booking.save();

    return res.json({ success: true, url: session.url });
  } catch (err) {
    console.error("getOrCreateBalanceLink error:", err);
    return res.status(500).json({ success: false, message: "Failed to create or fetch balance link." });
  }
};
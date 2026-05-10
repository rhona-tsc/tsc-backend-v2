// routes/payments.js
import express from "express";
import Stripe from "stripe";

import Booking from "../models/bookingModel.js";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Runtime guard: warn if STRIPE_SECRET_KEY is missing or invalid
if (
  !process.env.STRIPE_SECRET_KEY ||
  !/^sk_(test|live)_/.test(String(process.env.STRIPE_SECRET_KEY))
) {
  console.warn(
    "⚠️ STRIPE_SECRET_KEY is missing or invalid. It must start with sk_test_ or sk_live_. Checkout will fail with 401.",
  );
}

// Get a trustworthy origin (env → header → dev)
const getOrigin = (req) => {
  const env = process.env.FRONTEND_URL && String(process.env.FRONTEND_URL);
  const hdr = req.headers.origin && String(req.headers.origin);
  const fallback = "http://localhost:5174"; // Vite default (updated port)
  const chosen = env || hdr || fallback;
  try {
    const u = new URL(chosen);
    return `${u.protocol}//${u.host}`;
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------------------
// Stripe webhook (verify signature + update Booking with Stripe IDs)
// NOTE: This route MUST use express.raw() to validate the Stripe signature.
// ---------------------------------------------------------------------------
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
      console.warn(
        "⚠️ STRIPE_WEBHOOK_SECRET is not set. Stripe webhook signature verification will fail.",
      );
      return res.status(500).send("Webhook secret not configured");
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.error("❌ Stripe webhook signature verification failed:", {
        message: err?.message,
      });
      return res
        .status(400)
        .send(`Webhook Error: ${err?.message || "Invalid signature"}`);
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const sessionId = session?.id || null;
        const paymentIntentId = session?.payment_intent || null;
        const bookingRef =
          session?.metadata?.booking_ref || session?.metadata?.bookingId || null;

        // Resolve a booking filter (sessionId is most reliable)
        const filter = sessionId
          ? { sessionId }
          : bookingRef
            ? { bookingId: bookingRef }
            : null;

        if (!filter) {
          console.warn("⚠️ Stripe webhook could not resolve booking", {
            sessionId,
            bookingRef,
          });
          return res.json({ received: true });
        }

        // Fetch PI to grab latest_charge (chargeId)
        let chargeId = null;
        if (paymentIntentId) {
          try {
            const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
            chargeId = pi?.latest_charge || null;
          } catch (e) {
            console.warn("⚠️ Could not retrieve PaymentIntent for chargeId:", {
              paymentIntentId,
              message: e?.message,
            });
          }
        }

        // Single atomic update:
        // - Always set Stripe IDs + payment flags
        // - Only move status pending -> confirmed (won’t stomp other statuses)
        const updatePipeline = [
          {
            $set: {
              paymentIntentId: paymentIntentId || "$paymentIntentId",
              chargeId: chargeId || "$chargeId",
              payment: true,
              paymentStatus: "paid",
              status: {
                $cond: [
                  { $eq: ["$status", "pending"] },
                  "confirmed",
                  "$status",
                ],
              },
            },
          },
        ];

        // NOTE: updateOne supports pipeline updates in modern MongoDB versions.
        // If your cluster is old, tell me and I’ll give you a non-pipeline fallback.
        await Booking.updateOne(filter, updatePipeline);

        console.log("✅ Stripe webhook updated booking payment state", {
          bookingRef,
          sessionId,
          paymentIntentId,
          chargeId,
          paymentStatus: "paid",
          confirmedIfPending: true,
        });

        return res.json({ received: true });
      }

      // Ignore other event types for now (ack so Stripe stops retrying)
      return res.json({ received: true });
    } catch (err) {
      console.error("🔥 Stripe webhook handler error:", {
        type: event?.type,
        message: err?.message,
      });
      return res.status(500).send("Webhook handler failed");
    }
  },
);

router.post("/parking-checkout", async (req, res) => {
  try {
    const origin = getOrigin(req);
    const { amount, currency = "gbp", bookingId, description, metadata = {} } =
      req.body;

    // Validate amount (expected integer pence)
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res
        .status(400)
        .json({ message: "Invalid amount (expected integer pence)" });
    }
    const unitAmount = Math.round(amountNum); // amount is already pence from frontend

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: "Parking cost",
              description:
                description ||
                (bookingId ? `Parking for ${bookingId}` : "Parking"),
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/event-sheet/${bookingId}?parkingPaid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/event-sheet/${bookingId}?parkingCanceled=1`,
      allow_promotion_codes: true,
      metadata: { ...metadata, bookingId: String(bookingId || "") },
    });

    return res.json({ sessionId: session.id, url: session.url });
  } catch (e) {
    console.error("❌ parking-checkout error:", {
      type: e?.type,
      code: e?.code,
      message: e?.message,
    });
    return res.status(500).json({ message: e?.message || "Stripe error" });
  }
});

export default router;
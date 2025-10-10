// routes/payments.js
import express from "express";
import Stripe from "stripe";
import bodyParser from "body-parser";


const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Runtime guard: warn if STRIPE_SECRET_KEY is missing or invalid
if (
  !process.env.STRIPE_SECRET_KEY ||
  !/^sk_(test|live)_/.test(String(process.env.STRIPE_SECRET_KEY))
) {
  console.warn(
    "⚠️ STRIPE_SECRET_KEY is missing or invalid. It must start with sk_test_ or sk_live_. Checkout will fail with 401."
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

router.post("/parking-checkout", async (req, res) => {
  try {
    const origin = getOrigin(req);
    const { amount, currency = "gbp", bookingId, description, metadata = {} } = req.body;

    // Validate amount (expected integer pence)
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ message: "Invalid amount (expected integer pence)" });
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
              description: description || (bookingId ? `Parking for ${bookingId}` : "Parking"),
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
  success_url: `${origin}/event-sheet/${bookingId}?parkingPaid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/event-sheet/${bookingId}?parkingCanceled=1`,
      metadata: { ...metadata, bookingId: String(bookingId || "") },
    });

    return res.json({ sessionId: session.id, url: session.url,  });
  } catch (e) {
    console.error("❌ parking-checkout error:", {
      type: e?.type,
      code: e?.code,
      message: e?.message,
    });
    return res.status(500).json({ message: e?.message || "Stripe error" });
  }
});

router.post(
  "/stripe-webhook",
  bodyParser.raw({ type: "application/json" }), // raw body for signature check
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // from Stripe dashboard
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("⚠️ Webhook signature verification failed", err.message);
      return res.sendStatus(400);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const { bookingId, category, amount_pence } = session.metadata || {};
      try {
        if (category === "parking" && bookingId) {
          await Booking.updateOne(
            { bookingId },
            {
              $push: {
                payments: {
                  // you can create a dedicated "parkingPayments" if you prefer
                  performanceFee: 0,
                  travelFee: 0,
                  isPaid: true,
                  paidAt: new Date(),
                },
              },
              $set: {
                "eventSheet.answers.parking": {
                  ...(session?.amount_total ? { amountPence: session.amount_total } : {}),
                  ...(amount_pence ? { amountPence: Number(amount_pence) } : {}),
                  status: "paid",
                  sessionId: session.id,
                },
                updatedAt: new Date(),
              },
            }
          );
        }
      } catch (e) {
        console.error("❌ Failed to update booking from webhook:", e.message);
      }
    }
    res.sendStatus(200);
  }
);

export default router;
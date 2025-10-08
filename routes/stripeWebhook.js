// backend/routes/stripeWebhook.js
import express from "express";
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const router = express.Router();

// Make sure to use raw body for Stripe webhook verification
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const bookingId = session.metadata?.bookingId;
    try {
      // TODO: update your Booking/eventSheet in DB:
      // e.g., set eventSheet.answers.parking_checkout_status = "paid"
      // and optionally store session.id and payment_intent
      // await Booking.updateOne({ bookingId }, { $set: { "eventSheet.answers.parking_checkout_status": "paid" } });

      console.log("✅ Parking payment complete for booking", bookingId);
    } catch (e) {
      console.error("DB update error after payment", e);
    }
  }

  res.json({ received: true });
});

export default router;
export const getOrCreateBalanceLink = async (req, res) => {
  try {
    const { idOrRef } = req.params;

    const booking = await Booking.findOne(
      looksLikeObjectId(idOrRef) ? { _id: idOrRef } : { bookingId: idOrRef }
    );

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const full = Number(booking?.totals?.fullAmount || 0);
    const charged = Number(booking?.totals?.chargedAmount || 0);
    const explicit = Number(booking?.balanceAmountPence ?? NaN);

    // Always calculate from the latest booking totals first so booking-board
    // updates (extras, manual adjustments, etc.) are reflected immediately.
    const totalsBasedRemainingPence = Math.max(
      0,
      Math.round((full - charged) * 100)
    );

    const remainingPence =
      totalsBasedRemainingPence > 0
        ? totalsBasedRemainingPence
        : Number.isFinite(explicit) && explicit > 0
          ? explicit
          : 0;

    if (!remainingPence) {
      return res.status(400).json({ success: false, message: "No outstanding balance." });
    }

    if (booking.balancePaid === true || booking.balanceStatus === "paid") {
      return res.status(400).json({ success: false, message: "Balance already paid." });
    }

    const existingAmountMatches =
      Number(booking?.balanceAmountPence || 0) === remainingPence;

    // If the amount still matches, we can safely reuse the existing link.
    if (booking.balanceInvoiceUrl && existingAmountMatches) {
      return res.json({ success: true, url: booking.balanceInvoiceUrl });
    }

    // If the amount has changed, clear the stale hosted checkout reference so
    // the user is always sent to a checkout for the latest balance amount.
    if (!existingAmountMatches) {
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
    return res.status(500).json({ success: false, message: "Failed to create or fetch balance link." });
  }
};
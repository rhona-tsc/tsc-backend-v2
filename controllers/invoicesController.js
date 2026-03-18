export const getOrCreateBalanceLink = async (req, res) => {
  try {
    const { idOrRef } = req.params;
    const refreshRequested = String(req.query?.refresh || "") === "1";
    const expectedAmountPence = Number(req.query?.expectedAmountPence || 0);

    const booking = await Booking.findOne(
      looksLikeObjectId(idOrRef) ? { _id: idOrRef } : { bookingId: idOrRef }
    );

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const full = Number(booking?.totals?.fullAmount || 0);
    const charged = Number(booking?.totals?.chargedAmount || 0);
    const explicit = Number(booking?.balanceAmountPence ?? NaN);

    // Always prefer the latest totals on the booking.
    const totalsBasedRemainingPence = Math.max(
      0,
      Math.round((full - charged) * 100)
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
      return res.status(400).json({ success: false, message: "No outstanding balance." });
    }

    const existingAmountMatches =
      Number(booking?.balanceAmountPence || 0) === remainingPence;

    // If the booking still has money outstanding, stale paid flags should not
    // block a new invoice from being created.
    if (remainingPence > 0 && (booking.balancePaid === true || booking.balanceStatus === "paid")) {
      booking.balancePaid = false;
      booking.balanceStatus = "sent";
    }

    // Reuse the existing hosted checkout only when:
    // 1) the caller did not explicitly request a refresh, and
    // 2) the amount still matches.
    if (booking.balanceInvoiceUrl && existingAmountMatches && !refreshRequested) {
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
    return res.status(500).json({ success: false, message: "Failed to create or fetch balance link." });
  }
};
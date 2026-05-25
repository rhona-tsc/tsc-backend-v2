import express from "express";
import BookingBoardItem from "../models/bookingBoardItem.js";
import FinanceForecastBooking from "../models/financeForecastBookingModel.js";
import musicianAuth from "../middleware/musicianAuth.js";

const router = express.Router();

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const isoDateOnly = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
};

const getThursdayWeekBefore = (eventDateISO) => {
  const d = new Date(`${eventDateISO}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "";

  d.setUTCDate(d.getUTCDate() - 7);

  while (d.getUTCDay() !== 4) {
    d.setUTCDate(d.getUTCDate() - 1);
  }

  return d.toISOString().slice(0, 10);
};

const getPrimaryEmail = (row) =>
  row?.clientEmails?.find?.((e) => e?.email)?.email ||
  row?.clientEmail ||
  row?.userEmail ||
  row?.userAddress?.email ||
  "";

const getClientName = (row) =>
  row?.clientFirstNames ||
  row?.clientName ||
  row?.bookerName ||
  [row?.userAddress?.firstName, row?.userAddress?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim() ||
  "";

const getGross = (row) =>
  round2(
    row?.grossValue ||
      row?.totals?.fullAmount ||
      row?.amount ||
      row?.fee ||
      0,
  );

const getDepositPaid = (row) =>
  round2(
    row?.payments?.depositChargedAmount ||
      row?.payments?.depositAmount ||
      row?.totals?.depositAmount ||
      row?.depositAmount ||
      0,
  );

const getAccountingSplit = (row, gross, depositPaid) => {
  const acc = row?.accounting || {};

  const commissionGross = round2(acc.commissionGross || depositPaid || 0);
  const commissionVat = round2(
    acc.commissionVat || commissionGross * (0.2 / 1.2),
  );
  const commissionNet = round2(acc.commissionNet || commissionGross - commissionVat);
  const passThroughGross = round2(
    acc.passThroughGross || Math.max(gross - commissionGross, 0),
  );

  return {
    commissionGross,
    commissionVat,
    commissionNet,
    passThroughGross,
  };
};

router.post("/bookings/sync-from-board/:boardRowId", musicianAuth, async (req, res) => {
  try {
    const row = await BookingBoardItem.findById(req.params.boardRowId).lean();

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Booking board row not found.",
      });
    }

    const eventDateISO = String(row.eventDateISO || "").slice(0, 10);
    const eventMonth = eventDateISO ? eventDateISO.slice(0, 7) : "";

    const grossValue = getGross(row);
    const depositPaid = getDepositPaid(row);
    const balanceDue = round2(Math.max(grossValue - depositPaid, 0));

    const split = getAccountingSplit(row, grossValue, depositPaid);

    const expectedBalanceDueDateISO = getThursdayWeekBefore(eventDateISO);

    const status =
      row?.payments?.balancePaymentReceived || row?.balancePaid
        ? "paid"
        : depositPaid > 0
          ? "balance_due"
          : "forecast";

    const payload = {
      boardRowId: row._id,
      sourceBookingId: row.bookingId || row.sourceBookingId || null,

      bookingRef: row.bookingRef || String(row._id),
      clientName: getClientName(row),
      clientEmail: getPrimaryEmail(row),

      eventDateISO,
      eventMonth,

      agent: row.agent || "",
      actName: row.actName || "",
      actTscName: row.actTscName || "",

      grossValue,

      ...split,

      depositPaid,
      balanceDue,

      expectedCashDateISO: expectedBalanceDueDateISO || eventDateISO,
      expectedBalanceDueDateISO,

      status,
      rawSnapshot: row,
    };

    const forecast = await FinanceForecastBooking.findOneAndUpdate(
      {
        $or: [
          { boardRowId: row._id },
          { bookingRef: payload.bookingRef },
        ],
      },
      { $set: payload },
      { new: true, upsert: true },
    );

    return res.json({
      success: true,
      forecast,
    });
  } catch (error) {
    console.error("❌ sync-from-board failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Could not sync booking to finance forecast.",
    });
  }
});

router.get("/bookings", musicianAuth, async (req, res) => {
  try {
    const {
      from,
      to,
      status,
      q = "",
      limit = 500,
    } = req.query;

    const query = {};

    if (from || to) {
      query.eventDateISO = {};
      if (from) query.eventDateISO.$gte = String(from).slice(0, 10);
      if (to) query.eventDateISO.$lte = String(to).slice(0, 10);
    }

    if (status) {
      query.status = status;
    }

    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { bookingRef: rx },
        { clientName: rx },
        { clientEmail: rx },
        { actName: rx },
        { actTscName: rx },
        { agent: rx },
      ];
    }

    const bookings = await FinanceForecastBooking.find(query)
      .sort({ eventDateISO: 1, createdAt: -1 })
      .limit(Number(limit) || 500)
      .lean();

    const totals = bookings.reduce(
      (acc, b) => {
        acc.grossValue += Number(b.grossValue || 0);
        acc.commissionGross += Number(b.commissionGross || 0);
        acc.commissionVat += Number(b.commissionVat || 0);
        acc.commissionNet += Number(b.commissionNet || 0);
        acc.passThroughGross += Number(b.passThroughGross || 0);
        acc.depositPaid += Number(b.depositPaid || 0);
        acc.balanceDue += Number(b.balanceDue || 0);
        return acc;
      },
      {
        grossValue: 0,
        commissionGross: 0,
        commissionVat: 0,
        commissionNet: 0,
        passThroughGross: 0,
        depositPaid: 0,
        balanceDue: 0,
      },
    );

    return res.json({
      success: true,
      bookings,
      totals,
    });
  } catch (error) {
    console.error("❌ GET finance forecast bookings failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Could not load finance forecast bookings.",
    });
  }
});

router.post("/bookings/sync-all-from-board", musicianAuth, async (req, res) => {
  try {
    const rows = await BookingBoardItem.find({}).lean();

    let synced = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const eventDateISO = String(row.eventDateISO || "").slice(0, 10);
        const eventMonth = eventDateISO ? eventDateISO.slice(0, 7) : "";

        const grossValue = getGross(row);
        const depositPaid = getDepositPaid(row);
        const balanceDue = round2(Math.max(grossValue - depositPaid, 0));
        const split = getAccountingSplit(row, grossValue, depositPaid);
        const expectedBalanceDueDateISO = getThursdayWeekBefore(eventDateISO);

        const status =
          row?.payments?.balancePaymentReceived || row?.balancePaid
            ? "paid"
            : depositPaid > 0
              ? "balance_due"
              : "forecast";

        const payload = {
          boardRowId: row._id,
          sourceBookingId: row.bookingId || row.sourceBookingId || null,
          bookingRef: row.bookingRef || String(row._id),
          clientName: getClientName(row),
          clientEmail: getPrimaryEmail(row),
          eventDateISO,
          eventMonth,
          agent: row.agent || "",
          actName: row.actName || "",
          actTscName: row.actTscName || "",
          grossValue,
          ...split,
          depositPaid,
          balanceDue,
          expectedCashDateISO: expectedBalanceDueDateISO || eventDateISO,
          expectedBalanceDueDateISO,
          status,
          rawSnapshot: row,
        };

        await FinanceForecastBooking.findOneAndUpdate(
          {
            $or: [
              { boardRowId: row._id },
              { bookingRef: payload.bookingRef },
            ],
          },
          { $set: payload },
          { new: true, upsert: true },
        );

        synced += 1;
      } catch (err) {
        errors.push({
          rowId: String(row._id),
          bookingRef: row.bookingRef,
          error: err.message,
        });
      }
    }

    return res.json({
      success: true,
      totalBoardRows: rows.length,
      synced,
      errors,
    });
  } catch (error) {
    console.error("❌ sync-all-from-board failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Could not sync board bookings.",
    });
  }
});

export default router;
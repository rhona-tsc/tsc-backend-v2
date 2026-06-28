import express from "express";
import BookingBoardItem from "../models/bookingBoardItem.js";
import FinanceForecastBooking from "../models/financeForecastBookingModel.js";
import musicianAuth from "../middleware/musicianAuth.js";
import Booking from "../models/bookingModel.js";

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

  const hasUsefulAccounting =
    Number(acc.commissionGross || 0) > 0 ||
    Number(acc.passThroughGross || 0) > 0;

  const commissionGross = round2(
    hasUsefulAccounting
      ? Number(acc.commissionGross || 0)
      : Number(depositPaid || 0),
  );

  const invoiceCompany = String(acc.invoiceCompany || "TSC").toUpperCase();
  const vatTaxPointISO = String(
    row?.invoiceDateISO || row?.invoiceDueDateISO || row?.eventDateISO || "",
  ).slice(0, 10);
  const isBmmVatBooking =
    invoiceCompany === "BMM" && vatTaxPointISO >= "2026-02-07";

  const vatRate = Number(acc.vatRate || 0.2);

  const commissionVat = round2(
    isBmmVatBooking
      ? hasUsefulAccounting && Number(acc.commissionVat || 0) > 0
        ? Number(acc.commissionVat || 0)
        : commissionGross * (vatRate / (1 + vatRate))
      : 0,
  );

  const commissionNet = round2(
    hasUsefulAccounting && Number(acc.commissionNet || 0) > 0
      ? Number(acc.commissionNet || 0)
      : commissionGross - commissionVat,
  );

  const passThroughGross = round2(
    hasUsefulAccounting && Number(acc.passThroughGross || 0) > 0
      ? Number(acc.passThroughGross || 0)
      : Math.max(gross - commissionGross, 0),
  );

  return {
    invoiceCompany,
    vatTaxPointISO,
    vatRate,
    isBmmVatBooking,
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
  includeTests = "false",
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

    if (includeTests !== "true") {
  query.$and = [
    ...(query.$and || []),
    { actName: { $not: /test/i } },
    { clientName: { $not: /downie/i } },
    { bookingRef: { $not: /downie/i } },
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

    for (const originalRow of rows) {
  let row = originalRow;

  if (
    row?.bookingId &&
    (!row.eventDateISO || !row.grossValue || !row.clientFirstNames)
  ) {
    const booking = await Booking.findById(row.bookingId).lean();

    if (booking) {
      const bookingEmail =
        booking.clientEmail ||
        booking.userEmail ||
        booking?.userAddress?.email ||
        "";

      row = {
        ...row,

        sourceBookingId: booking._id,

        eventDateISO:
          row.eventDateISO ||
          isoDateOnly(booking.eventDate || booking.date || booking.bookingDate),

        grossValue:
          row.grossValue ||
          booking?.totals?.fullAmount ||
          booking?.amount ||
          booking?.fee ||
          0,

        clientFirstNames:
          row.clientFirstNames ||
          booking.clientName ||
          [booking?.userAddress?.firstName, booking?.userAddress?.lastName]
            .filter(Boolean)
            .join(" ")
            .trim(),

        clientEmail: row.clientEmail || bookingEmail,
        userEmail: row.userEmail || bookingEmail,

        clientEmails:
          Array.isArray(row.clientEmails) && row.clientEmails.length
            ? row.clientEmails
            : bookingEmail
              ? [{ email: bookingEmail }]
              : [],

        actName:
          row.actName ||
          booking?.actsSummary?.[0]?.actName ||
          booking?.actsSummary?.[0]?.name ||
          booking?.actName ||
          "",

        actTscName:
          row.actTscName ||
          booking?.actsSummary?.[0]?.tscName ||
          booking?.actsSummary?.[0]?.name ||
          booking?.actTscName ||
          "",

        agent: row.agent || booking.agent || "Direct",

        payments: {
          ...(row.payments || {}),
          depositAmount:
            row?.payments?.depositAmount ||
            booking?.payments?.depositAmount ||
            booking?.totals?.depositAmount ||
            booking?.depositAmount ||
            0,
          depositChargedAmount:
            row?.payments?.depositChargedAmount ||
            booking?.payments?.depositChargedAmount ||
            booking?.totals?.chargedAmount ||
            booking?.totals?.depositAmount ||
            booking?.depositAmount ||
            0,
          balancePaymentReceived:
            row?.payments?.balancePaymentReceived || booking?.balancePaid || false,
          bandPaymentsSent:
            row?.payments?.bandPaymentsSent || booking?.bandPaymentsSent || false,
        },

        accounting: row.accounting || booking.accounting || null,
      };
    }
  }
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
          rowId: String(originalRow._id),
bookingRef: originalRow.bookingRef,
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



const parseMoney = (v) =>
  Number(String(v || "").replace(/[£,]/g, "").trim()) || 0;

const parseCsvDate = (v) => {
  if (!v) return null;

  const raw = String(v).trim();

  // handles 30/05/2026
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return new Date(`${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}T00:00:00.000Z`);
  }

  // handles 30-May-2026
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

router.post("/forecast-events/bulk-supplier-payouts-csv", async (req, res) => {
  try {
    const { csv, entity = "BMM", replaceExisting = false } = req.body || {};

    if (!csv || typeof csv !== "string") {
      return res.status(400).json({
        success: false,
        message: "CSV string is required in req.body.csv",
      });
    }

    const records = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });

    const docs = [];
    const errors = [];

    for (const [index, row] of records.entries()) {
      try {
        const bookingRef = String(row.bookingRef || "").trim();
        const supplierName = String(
          row.supplierName ||
            row.musicianName ||
            row["DJing in Buckinghamshire £252"] ||
            ""
        ).trim();

        const amount = parseMoney(row.Fee || row.fee || row.amount);
        const expectedDate = parseCsvDate(
          row["Date of transaction"] || row.expectedDate
        );
        const eventDate = parseCsvDate(row.eventDateISO || row.eventDate);

        if (!supplierName) throw new Error("Missing supplier name");
        if (!amount) throw new Error("Missing/invalid Fee");
        if (!expectedDate) throw new Error("Missing/invalid Date of transaction");

        docs.push({
          entity,
          type: "supplier_payment_out",
          title: `Supplier payout - ${supplierName}`,
          description: bookingRef
            ? `Supplier payout for booking ${bookingRef}`
            : "Supplier payout",
          expectedDate,
          amount: Math.abs(amount),
          direction: "out",
          status: "forecast",
          source: "supplier_payout_csv",
          clientNames: String(row.clientFirstNames || "").trim(),
          actName: "",
          eventDate,
          isAutoGenerated: false,
          notes: [
            bookingRef ? `Booking ref: ${bookingRef}` : "",
            eventDate ? `Event date: ${eventDate.toISOString().slice(0, 10)}` : "",
            `Supplier: ${supplierName}`,
          ]
            .filter(Boolean)
            .join("\n"),
        });
      } catch (err) {
        errors.push({
          row: index + 2,
          error: err.message,
          raw: row,
        });
      }
    }

    if (replaceExisting) {
      await ForecastEvent.deleteMany({
        source: "supplier_payout_csv",
        entity,
        isAutoGenerated: false,
      });
    }

    const inserted = docs.length ? await ForecastEvent.insertMany(docs) : [];

    return res.json({
      success: errors.length === 0,
      totalRows: records.length,
      imported: inserted.length,
      failed: errors.length,
      errors,
      preview: inserted.slice(0, 5),
    });
  } catch (err) {
    console.error("bulk supplier payouts csv error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Bulk import failed",
    });
  }
});

export default router;
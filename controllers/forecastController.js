import ForecastEvent from "../models/forecastEventModel.js";
import FinanceAccount from "../models/financeAccountModel.js";
import BookingBoardItem from "../models/bookingBoardItemModel.js";
import BookingForecast from "../models/bookingForecastModel.js";
import generateForecastEventsFromBooking from "../utils/generateForecastEventsFromBooking.js";
import getExpectedBalanceDateForSource from "../utils/paymentRules.js";


export const getForecastTimeline = async (req, res) => {
  try {
    const { entity, startDate, endDate, startingBalance } = req.query;

   const query = {
  status: { $in: ["forecast", "confirmed"] },
};

    if (entity) query.entity = entity;

const today = new Date();
today.setHours(0, 0, 0, 0);

if (startDate || endDate) {
  query.expectedDate = {};
  if (startDate) query.expectedDate.$gte = new Date(startDate);
  if (endDate) query.expectedDate.$lte = new Date(endDate);
} else {
  query.expectedDate = { $gte: today };
}

    let calculatedStartingBalance = 0;

    if (startingBalance !== undefined && startingBalance !== "") {
      calculatedStartingBalance = Number(startingBalance || 0);
    } else if (entity) {
      const balanceResult = await FinanceAccount.aggregate([
        {
          $match: {
            entity,
            isActive: true,
          },
        },
        {
          $group: {
            _id: "$entity",
            totalCurrentBalance: { $sum: "$currentBalance" },
          },
        },
      ]);

      calculatedStartingBalance =
        balanceResult?.[0]?.totalCurrentBalance || 0;
    }

    const events = await ForecastEvent.find(query)
      .sort({ expectedDate: 1 })
      .lean();

    let runningBalance = calculatedStartingBalance;

    let totalIn = 0;
    let totalOut = 0;
    let lowestBalance = runningBalance;
    let firstNegativeDate = null;

    const timeline = events.map((event) => {
      const rawAmount = Number(event.amount || 0);
      const signedAmount = event.direction === "in" ? rawAmount : -rawAmount;

      if (signedAmount >= 0) totalIn += signedAmount;
      else totalOut += Math.abs(signedAmount);

      runningBalance += signedAmount;

      if (runningBalance < lowestBalance) lowestBalance = runningBalance;

      if (runningBalance < 0 && !firstNegativeDate) {
        firstNegativeDate = event.expectedDate;
      }

      return {
        ...event,
        signedAmount,
        runningBalance,
      };
    });

    res.json({
      success: true,
      filters: {
        entity: entity || "ALL",
        startDate: startDate || null,
        endDate: endDate || null,
        startingBalance: calculatedStartingBalance,
      },
      summary: {
        totalIn,
        totalOut,
        netMovement: totalIn - totalOut,
        finalBalance: runningBalance,
        lowestBalance,
        firstNegativeDate,
        eventCount: timeline.length,
      },
      timeline,
    });
  } catch (error) {
    console.error("getForecastTimeline error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getForecastMonthlySummary = async (req, res) => {
  try {
    const { entity, startDate, endDate, startingBalance } = req.query;

    const query = {
      status: { $in: ["forecast", "confirmed"] },
    };

    if (entity) query.entity = entity;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (startDate || endDate) {
      query.expectedDate = {};
      if (startDate) query.expectedDate.$gte = new Date(startDate);
      if (endDate) query.expectedDate.$lte = new Date(endDate);
    } else {
      query.expectedDate = { $gte: today };
    }

    let calculatedStartingBalance = 0;

    if (startingBalance !== undefined && startingBalance !== "") {
      calculatedStartingBalance = Number(startingBalance || 0);
    } else if (entity) {
      const balanceResult = await FinanceAccount.aggregate([
        { $match: { entity, isActive: true } },
        {
          $group: {
            _id: "$entity",
            totalCurrentBalance: { $sum: "$currentBalance" },
          },
        },
      ]);

      calculatedStartingBalance = balanceResult?.[0]?.totalCurrentBalance || 0;
    }

    const events = await ForecastEvent.find(query)
      .sort({ expectedDate: 1 })
      .lean();

    let runningBalance = calculatedStartingBalance;
    const monthMap = new Map();

    events.forEach((event) => {
      const date = new Date(event.expectedDate);
      const monthKey = `${date.getFullYear()}-${String(
        date.getMonth() + 1,
      ).padStart(2, "0")}`;

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, {
          month: monthKey,
          totalIn: 0,
          totalOut: 0,
          netMovement: 0,
          openingBalance: runningBalance,
          closingBalance: runningBalance,
          lowestBalance: runningBalance,
          eventCount: 0,
        });
      }

      const row = monthMap.get(monthKey);

      const rawAmount = Number(event.amount || 0);
      const signedAmount = event.direction === "in" ? rawAmount : -rawAmount;

      if (signedAmount >= 0) row.totalIn += signedAmount;
      else row.totalOut += Math.abs(signedAmount);

      runningBalance += signedAmount;

      row.netMovement = row.totalIn - row.totalOut;
      row.closingBalance = runningBalance;
      row.lowestBalance = Math.min(row.lowestBalance, runningBalance);
      row.eventCount += 1;
    });

    const months = Array.from(monthMap.values());

    res.json({
      success: true,
      filters: {
        entity: entity || "ALL",
        startDate: startDate || null,
        endDate: endDate || null,
        startingBalance: calculatedStartingBalance,
      },
      summary: {
        startingBalance: calculatedStartingBalance,
        finalBalance: runningBalance,
        monthCount: months.length,
      },
      months,
    });
  } catch (error) {
    console.error("getForecastMonthlySummary error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};



const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const toDate = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const getClientName = (row = {}) =>
  row.clientFirstNames ||
  row.clientName ||
  row.bookerName ||
  row.userAddress?.firstName ||
  "Client";

const getEventDate = (row = {}) =>
  toDate(row.eventDateISO || row.date || row.eventDate || row.bookingDate);

const getBookingDate = (row = {}) =>
  toDate(row.bookingDateISO || row.enquiryDateISO || row.createdAt);

const getActName = (row = {}) =>
  row.actTscName ||
  row.tscName ||
  row.actName ||
  row.actsSummary?.[0]?.tscName ||
  row.actsSummary?.[0]?.actName ||
  row.actsSummary?.[0]?.name ||
  "Booking";

const getGross = (row = {}) =>
  Number(
    row.grossValue ||
      row.totals?.fullAmount ||
      row.quote?.total ||
      row.pricing?.total ||
      row.amount ||
      row.fee ||
      0,
  ) || 0;

const getDeposit = (row = {}) =>
  Number(
    row.payments?.depositChargedAmount ||
      row.payments?.depositAmount ||
      row.totals?.depositAmount ||
      row.quote?.deposit ||
      row.pricing?.deposit ||
      row.depositAmount ||
      0,
  ) || 0;

const getAgent = (row = {}) => row.agent || row.source || "Direct";

const getAccounting = (row = {}) => {
  const acc = row.accounting || row.totals?.accounting || row.payments?.accounting || {};

  const commissionGross = round2(acc.commissionGross || 0);
  const passThroughGross = round2(acc.passThroughGross || 0);
  const vatRate = Number(acc.vatRate ?? 0.2);

  return {
    commissionGross,
    passThroughGross,
    vatRate,
  };
};

const buildSupplierPaymentsFromBoardRow = (row = {}, passThroughGross = 0) => {
  const payments = [];

  const eventDate = getEventDate(row);

  if (passThroughGross > 0) {
    payments.push({
      name: "Band",
      role: "Pass-through supplier payment",
      amount: passThroughGross,
      expectedPaymentDate: eventDate,
      paid: Boolean(row.payments?.bandPaymentsSent || row.bandPaymentsSent),
      notes: "Generated from Booking Board pass-through amount",
    });
  }

  return payments;
};

export const syncBookingFromBoard = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const boardBooking = await BookingBoardItem.findById(bookingId).lean();

    if (!boardBooking) {
      return res.status(404).json({
        success: false,
        message: "Booking Board item not found",
      });
    }

    const eventDate = getEventDate(boardBooking);
    const bookingMadeDate = getBookingDate(boardBooking);
    const source = getAgent(boardBooking);
    const gross = round2(getGross(boardBooking));
    const deposit = round2(getDeposit(boardBooking));

    const { commissionGross, passThroughGross, vatRate } =
      getAccounting(boardBooking);

    const balanceAmount = round2(Math.max(gross - deposit, 0));
    const clientNames = getClientName(boardBooking);
    const actName = getActName(boardBooking);

    if (!eventDate || !clientNames || !actName || gross <= 0) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required finance sync data: event date, client name, act name or gross value.",
      });
    }

    const bookingRef =
      boardBooking.bookingRef ||
      boardBooking.bookingId ||
      boardBooking.reference ||
      String(boardBooking._id);

    const expectedBalanceDate =
      getExpectedBalanceDateForSource({
        source,
        eventDate,
        bookingMadeDate,
      }) || eventDate;

    const forecastPayload = {
      bookingRef,
      mondayItemName: `Booking Board - ${clientNames} / ${actName}`,
      clientNames,
      clientEmail:
        boardBooking.clientEmail ||
        boardBooking.clientEmails?.find?.((item) => item?.email)?.email ||
        boardBooking.userEmail ||
        boardBooking.userAddress?.email ||
        "",
      bookingMadeDate,
      eventDate,
      eventType: boardBooking.eventType || "",
      county: boardBooking.county || boardBooking.userAddress?.county || "",
      fullAddress:
        boardBooking.venueAddress ||
        boardBooking.venue ||
        boardBooking.address ||
        "",
      source,
      agent: source,

      tscBandName: actName,
      actName,
      lineup:
        boardBooking.lineupSelected ||
        boardBooking.actsSummary?.[0]?.lineupLabel ||
        "",

      totalBookingValue: gross,
      grossBookingValue: gross,
      dealValue: gross,

      depositAmount: deposit,
      balanceAmount,

      expectedDepositDate: bookingMadeDate,
      expectedBalanceDate,

      depositPaid: Boolean(
        boardBooking.payments?.depositPaymentReceived ||
          boardBooking.payments?.depositChargedAmount,
      ),
      balancePaid: Boolean(
        boardBooking.payments?.balancePaymentReceived ||
          boardBooking.balancePaid,
      ),

      commissionAmount: commissionGross,
      bmmFee: commissionGross,
      rhonaFee: 0,

      supplierPayments: buildSupplierPaymentsFromBoardRow(
        boardBooking,
        passThroughGross,
      ),

      notes: `Synced from Booking Board item ${boardBooking._id}`,
      status: "confirmed",
    };

    const savedForecast = await BookingForecast.findOneAndUpdate(
      {
        $or: [
          { bookingRef },
          {
            clientNames,
            actName,
            eventDate,
          },
        ],
      },
      forecastPayload,
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    await ForecastEvent.deleteMany({
      bookingForecastId: savedForecast._id,
      isAutoGenerated: true,
      status: { $in: ["forecast", "confirmed"] },
    });

    const generatedEvents = generateForecastEventsFromBooking(savedForecast).map(
      (event) => {
        if (
          event.direction === "in" &&
          ["client_deposit_in", "client_balance_in"].includes(event.type)
        ) {
          return {
            ...event,
            vatTreatment: "standard",
            vatRate,
            vatBasis: "commission",
            vatableAmount: commissionGross,
            taxTreatment: "income",
          };
        }

        return {
          ...event,
          vatTreatment: "outside_scope",
          vatRate: 0,
          vatBasis: "outside_scope",
          vatableAmount: 0,
          taxTreatment: event.direction === "out" ? "expense" : "income",
        };
      },
    );

    if (generatedEvents.length) {
      await ForecastEvent.insertMany(generatedEvents);
    }

    res.json({
      success: true,
      bookingForecastId: savedForecast._id,
      forecastEventsCreated: generatedEvents.length,
    });
  } catch (error) {
    console.error("syncBookingFromBoard error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
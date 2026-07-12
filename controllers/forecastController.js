import ForecastEvent from "../models/forecastEventModel.js";
import FinanceAccount from "../models/financeAccountModel.js";
import BookingBoardItem from "../models/bookingBoardItem.js";
import BookingForecast from "../models/bookingForecastModel.js";
import generateForecastEventsFromBooking from "../utils/generateForecastEventsFromBooking.js";
import getExpectedBalanceDateForSource from "../utils/paymentRules.js";
import { generateTaxForecastEvents } from "./financeTaxController.js";

const BOARD_SYNC_SOURCE = "booking_board_sync";

const getTodayStart = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const toDate = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const moveOverdueExpectedDateToToday = (event = {}) => {
  const expectedDate = toDate(event.expectedDate);
  const today = getTodayStart();

  if (!expectedDate || expectedDate >= today) {
    return event;
  }

  return {
    ...event,
    expectedDate: today,
    notes: [
      event.notes,
      `Original expected date: ${expectedDate
        .toISOString()
        .slice(0, 10)}. Moved to today because the amount remains unpaid.`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
};

const createMockResponse = () => {
  let payload = null;
  let statusCode = 200;

  const response = {
    status(code) {
      statusCode = code;
      return response;
    },
    json(value) {
      payload = value;
      return value;
    },
  };

  return {
    response,
    getPayload: () => payload,
    getStatusCode: () => statusCode,
  };
};

const isPaidStatus = (value) =>
  ["paid", "complete", "completed", "succeeded"].includes(
    String(value || "").trim().toLowerCase(),
  );

const isClientBalancePaid = (row = {}) =>
  Boolean(
    row.balancePaid ||
      row.payments?.balancePaymentReceived ||
      row.payments?.invoicePaid ||
      row.payments?.paidAt ||
      row.paidAt ||
      isPaidStatus(row.balanceStatus),
  );

const getInvoiceEntity = (row = {}) => {
  const explicit = String(row.accounting?.invoiceCompany || "")
    .trim()
    .toUpperCase();

  if (["TSC", "BMM"].includes(explicit)) return explicit;

  const agent = String(row.agent || row.source || "")
    .trim()
    .toLowerCase();

  return [
    "direct",
    "bmm",
    "tsc",
    "the supreme collective",
    "weddingjam",
    "wedding jam",
    "staar productions",
    "encore",
  ].includes(agent)
    ? "TSC"
    : "BMM";
};

const getAssignedMusicians = (row = {}) => {
  const candidates = [
    ...(Array.isArray(row.assignedMusicians) ? row.assignedMusicians : []),
    ...(Array.isArray(row.bookingMusicians) ? row.bookingMusicians : []),
    ...(Array.isArray(row.bandLineup) ? row.bandLineup : []),
    ...(Array.isArray(row.bookingDetails?.assignedMusicians)
      ? row.bookingDetails.assignedMusicians
      : []),
  ];

  const seen = new Set();

  return candidates.filter((musician) => {
    const key = String(
      musician?.musicianId ||
        musician?.email ||
        `${musician?.name || musician?.firstName || ""}-${musician?.role || musician?.instrument || ""}`,
    )
      .trim()
      .toLowerCase();

    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getPaidBandPaymentKeys = (row = {}) => {
  const payments = Array.isArray(row.payments?.bandPayments)
    ? row.payments.bandPayments
    : [];

  return new Set(
    payments
      .flatMap((payment) => [payment?.musicianId, payment?.email, payment?.name])
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase()),
  );
};

export const getForecastTimeline = async (req, res) => {
  try {
    const { entity, startDate, endDate, startingBalance } = req.query;

   const query = {
  status: { $in: ["forecast", "confirmed"] },
  $or: [
    { type: { $ne: "supplier_payment_out" } },
    { source: BOARD_SYNC_SOURCE },
  ],
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
      $or: [
        { type: { $ne: "supplier_payment_out" } },
        { source: BOARD_SYNC_SOURCE },
      ],
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
  const eventDate = getEventDate(row);
  const musicians = getAssignedMusicians(row);
  const allBandPaymentsSent = Boolean(
    row.payments?.bandPaymentsSent || row.bandPaymentsSent,
  );
  const paidKeys = getPaidBandPaymentKeys(row);

  const itemisedPayments = musicians
    .map((musician) => {
      const amount = round2(
        Number(musician.totalFee || 0) ||
          Number(musician.fee || 0) + Number(musician.travelFee || 0),
      );

      if (amount <= 0) return null;

      const name =
        musician.name ||
        [musician.firstName, musician.lastName].filter(Boolean).join(" ") ||
        musician.email ||
        musician.role ||
        musician.instrument ||
        "Supplier";

      const musicianKeys = [
        musician.musicianId,
        musician.email,
        musician.name,
        name,
      ]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase());

      const paid =
        allBandPaymentsSent ||
        musician.paymentStatus === "paid" ||
        musicianKeys.some((key) => paidKeys.has(key));

      if (paid) return null;

      return {
        name,
        role: musician.role || musician.instrument || "Musician",
        amount,
        expectedPaymentDate: eventDate,
        paid: false,
        notes: "Generated from Booking Board musician allocation",
      };
    })
    .filter(Boolean);

  const itemisedTotal = round2(
    itemisedPayments.reduce((sum, payment) => sum + payment.amount, 0),
  );

  const remainingPassThrough = allBandPaymentsSent
    ? 0
    : round2(Math.max(Number(passThroughGross || 0) - itemisedTotal, 0));

  if (remainingPassThrough > 0) {
    itemisedPayments.push({
      name: itemisedPayments.length ? "Unallocated band balance" : "Band",
      role: "Pass-through supplier payment",
      amount: remainingPassThrough,
      expectedPaymentDate: eventDate,
      paid: false,
      notes: itemisedPayments.length
        ? "Booking Board pass-through amount not yet allocated to a named musician"
        : "Generated from Booking Board pass-through amount",
    });
  }

  return itemisedPayments;
};


const syncOneBoardBooking = async (boardBooking) => {
  const eventDate = getEventDate(boardBooking);
  const bookingMadeDate = getBookingDate(boardBooking);
  const source = getAgent(boardBooking);
  const entity = getInvoiceEntity(boardBooking);
  const gross = round2(getGross(boardBooking));
  const deposit = round2(getDeposit(boardBooking));

  const { commissionGross, passThroughGross, vatRate } =
    getAccounting(boardBooking);

  const balanceAmount = round2(Math.max(gross - deposit, 0));
  const clientNames = getClientName(boardBooking);
  const actName = getActName(boardBooking);

  if (!eventDate || !clientNames || !actName || gross <= 0) {
    throw new Error(
      `Booking Board item ${boardBooking?._id || "unknown"} is missing event date, client name, act name or gross value.`,
    );
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
    entity,
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
    balancePaid: isClientBalancePaid(boardBooking),
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

  const generatedEvents = generateForecastEventsFromBooking(savedForecast)
  .filter((event) => {
    if (event.type === "client_balance_in") {
      return !isClientBalancePaid(boardBooking);
    }

    if (event.type === "supplier_payment_out") {
      return event.paid !== true;
    }

    return true;
  })
  .map((event) => {
    const baseEvent = {
      ...event,
      entity,
      source: BOARD_SYNC_SOURCE,
    };

      if (
        baseEvent.direction === "in" &&
        ["client_deposit_in", "client_balance_in"].includes(baseEvent.type)
      ) {
        return {
          ...baseEvent,
          vatTreatment: entity === "BMM" ? "standard" : "outside_scope",
          vatRate: entity === "BMM" ? vatRate : 0,
          vatBasis: entity === "BMM" ? "commission" : "outside_scope",
          vatableAmount: entity === "BMM" ? commissionGross : 0,
          taxTreatment: "income",
        };
      }

      return {
        ...baseEvent,
        vatTreatment: "outside_scope",
        vatRate: 0,
        vatBasis: "outside_scope",
        vatableAmount: 0,
        taxTreatment: baseEvent.direction === "out" ? "expense" : "income",
      };
    });

  if (generatedEvents.length) {
    await ForecastEvent.insertMany(generatedEvents);
  }

  return {
    bookingForecastId: savedForecast._id,
    forecastEventsCreated: generatedEvents.length,
    entity,
  };
};

const regenerateBmmTaxForecasts = async () => {
  const mock = createMockResponse();

  await generateTaxForecastEvents(
    {
      body: {
        entity: "BMM",
        includeForecast: true,
        taxRate: 0.25,
      },
    },
    mock.response,
  );

  const payload = mock.getPayload();

  if (mock.getStatusCode() >= 400 || !payload?.success) {
    throw new Error(payload?.message || "BMM tax forecast regeneration failed.");
  }

  return payload;
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

    const result = await syncOneBoardBooking(boardBooking);

    return res.json({
      success: true,
      bookingForecastId: result.bookingForecastId,
      forecastEventsCreated: result.forecastEventsCreated,
      entity: result.entity,
    });
  } catch (error) {
    console.error("syncBookingFromBoard error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const syncAllFinanceForecasts = async (req, res) => {
  try {
    const requestedEntity = String(req.body?.entity || "BMM")
      .trim()
      .toUpperCase();

    if (!["TSC", "BMM"].includes(requestedEntity)) {
      return res.status(400).json({
        success: false,
        message: "entity must be TSC or BMM",
      });
    }

    const allBoardRows = await BookingBoardItem.find({}).lean();
    const boardRows = allBoardRows.filter(
      (row) => getInvoiceEntity(row) === requestedEntity,
    );

    let bookingsSynced = 0;
    let forecastEventsCreated = 0;
    const skipped = [];

    for (const boardRow of boardRows) {
      try {
        const result = await syncOneBoardBooking(boardRow);
        bookingsSynced += 1;
        forecastEventsCreated += result.forecastEventsCreated || 0;
      } catch (error) {
        skipped.push({
          bookingId: String(boardRow?._id || ""),
          bookingRef: String(boardRow?.bookingRef || ""),
          reason: error.message,
        });
      }
    }

    let taxForecast = null;
    if (requestedEntity === "BMM") {
      taxForecast = await regenerateBmmTaxForecasts();
    }

    return res.json({
      success: true,
      entity: requestedEntity,
      bookingsFound: boardRows.length,
      bookingsSynced,
      forecastEventsCreated,
      skippedCount: skipped.length,
      skipped,
      taxForecastEventsCreated:
        Number(taxForecast?.created || taxForecast?.createdCount || 0) || 0,
    });
  } catch (error) {
    console.error("syncAllFinanceForecasts error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Finance update failed.",
    });
  }
};
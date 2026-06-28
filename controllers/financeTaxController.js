import FinanceTransaction from "../models/financeTransactionModel.js";
import ForecastEvent from "../models/forecastEventModel.js";
import BookingBoardItem from "../models/bookingBoardItem.js";

const toNumber = (value) => Number(value || 0);

const VAT_REGISTERED_FROM_BY_ENTITY = {
BMM: new Date(Date.UTC(2026, 1, 7)), // 7 Feb 2026
// Add other entities and their VAT registration dates here as needed
  };

const VAT_REGISTERED_ENTITIES = new Set(Object.keys(VAT_REGISTERED_FROM_BY_ENTITY));

const isVatRegisteredEntity = (entity) => VAT_REGISTERED_ENTITIES.has(String(entity || ""));

const getVatRegistrationStartDate = (entity) =>
  VAT_REGISTERED_FROM_BY_ENTITY[String(entity || "")] || null;

const isOnOrAfterDate = (date, compareDate) => {
  if (!compareDate) return true;
  const d = new Date(date);
  return !Number.isNaN(d.getTime()) && d >= compareDate;
};

const getVatQuarter = (date, entity = "BMM") => {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const vatStart = getVatRegistrationStartDate(entity);

// BMM VAT registration begins 7 Feb 2026.
// First VAT return runs 7 Feb 2026 to 30 Jun 2026,
// with payment due 7 Aug 2026.
if (
  entity === "BMM" &&
  vatStart &&
  d >= vatStart &&
  d <= new Date(Date.UTC(2026, 5, 30, 23, 59, 59, 999))
) {
  return "2026-Q2";
}

  if ([1, 2, 3].includes(month)) return `${year}-Q1`;
  if ([4, 5, 6].includes(month)) return `${year}-Q2`;
  if ([7, 8, 9].includes(month)) return `${year}-Q3`;
  return `${year}-Q4`;
};

const getVatPaymentDueDate = (quarterKey) => {
  const [yearRaw, quarter] = quarterKey.split("-Q");
  const year = Number(yearRaw);

  const dueMap = {
    1: new Date(Date.UTC(year, 4, 7)), // 7 May
    2: new Date(Date.UTC(year, 7, 7)), // 7 Aug
    3: new Date(Date.UTC(year, 10, 7)), // 7 Nov
    4: new Date(Date.UTC(year + 1, 1, 7)), // 7 Feb
  };

  return dueMap[Number(quarter)];
};

const getVatFromGross = (gross, vatRate = 0.2) => {
  const amount = toNumber(gross);
  return amount - amount / (1 + vatRate);
};

const getVatBaseAmount = (item) => {
  const vatableAmount = toNumber(item.vatableAmount);

  if (vatableAmount > 0) return vatableAmount;

  return toNumber(item.amount);
};

const getVatAmount = (item) => {
  const vatRate = toNumber(item.vatRate) || 0.2;
  const vatBaseAmount = getVatBaseAmount(item);

  if (item.vatBasis === "commission" || item.vatableAmount > 0) {
    return vatBaseAmount * vatRate;
  }

  return getVatFromGross(vatBaseAmount, vatRate);
};

const shouldApplySalesVat = (item) => {
  return (
    item.direction === "in" &&
    ["standard", "vatable", "standard_rate"].includes(
      String(item.vatTreatment || "").toLowerCase(),
    )
  );
};

const shouldApplyPurchaseVat = (item) => {
  return (
    item.direction === "out" &&
    ["standard", "vatable", "standard_rate"].includes(
      String(item.vatTreatment || "").toLowerCase(),
    )
  );
};

export const getVatForecast = async (req, res) => {
  try {
    const {
      entity = "BMM",
      startDate,
      endDate,
      includeForecast = true,
    } = req.query;

    const includeForecastRows = String(includeForecast) !== "false";

    if (!isVatRegisteredEntity(entity)) {
      return res.json({
        success: true,
        filters: {
          entity,
          startDate: startDate || null,
          endDate: endDate || null,
          includeForecast: includeForecastRows,
          vatRegistered: false,
        },
        quarters: [],
        summary: {
          totalVatOnSales: 0,
          totalVatReclaimable: 0,
          totalNetVatDue: 0,
        },
      });
    }

    const vatRegistrationStartDate = getVatRegistrationStartDate(entity);

    const dateQuery = {};
    if (startDate) dateQuery.$gte = new Date(startDate);
    if (endDate) dateQuery.$lte = new Date(endDate);

    if (vatRegistrationStartDate) {
      dateQuery.$gte = dateQuery.$gte
        ? new Date(
            Math.max(
              dateQuery.$gte.getTime(),
              vatRegistrationStartDate.getTime(),
            ),
          )
        : vatRegistrationStartDate;
    }

    const isWithinVatDateRange = (date) => {
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) return false;
      if (dateQuery.$gte && d < dateQuery.$gte) return false;
      if (dateQuery.$lte && d > dateQuery.$lte) return false;
      return true;
    };

    const getBoardVatTaxPointDate = (booking) => {
      return String(
        booking?.invoiceDateISO ||
          booking?.invoiceDueDateISO ||
          booking?.eventDateISO ||
          "",
      ).slice(0, 10);
    };

    const quarters = new Map();

    const ensureQuarter = (date) => {
      const key = getVatQuarter(date, entity);

      if (!quarters.has(key)) {
        quarters.set(key, {
          quarter: key,
          vatOnSales: 0,
          vatReclaimable: 0,
          netVatDue: 0,
          salesGross: 0,
          purchasesGross: 0,
          transactionCount: 0,
          forecastEventCount: 0,
          boardBookingCount: 0,
          paymentDueDate: getVatPaymentDueDate(key),
          vatableSales: 0,
        });
      }

      return quarters.get(key);
    };

    // Actual bank transactions: mainly useful for VAT reclaimable purchases
    // and any manually-tagged VATable income/expenses.
    const transactionQuery = { entity };
    if (Object.keys(dateQuery).length) transactionQuery.date = dateQuery;

    const transactions = await FinanceTransaction.find(transactionQuery).lean();

    transactions.forEach((tx) => {
      if (!isOnOrAfterDate(tx.date, vatRegistrationStartDate)) return;
      if (String(tx.source || "") === TAX_EVENT_SOURCE) return;

      const row = ensureQuarter(tx.date);
      const amount = toNumber(tx.amount);

      row.transactionCount += 1;

      if (shouldApplySalesVat(tx)) {
        const vatBaseAmount = getVatBaseAmount(tx);

        row.salesGross += amount;
        row.vatOnSales += getVatAmount(tx);
        row.vatableSales += vatBaseAmount;
      }

      if (shouldApplyPurchaseVat(tx)) {
        row.purchasesGross += amount;
        row.vatReclaimable += getVatFromGross(amount);
      }
    });

    // Booking board rows are the source of truth for BMM disclosed-agent VAT.
    // VAT is only on BMM commission/management fee, not full client booking value.
    if (includeForecastRows) {
      const boardBookings = await BookingBoardItem.find({
        "accounting.invoiceCompany": entity,
      }).lean();

      boardBookings.forEach((booking) => {
        const taxPointDate = getBoardVatTaxPointDate(booking);
        if (!taxPointDate) return;
        if (!isWithinVatDateRange(taxPointDate)) return;
        if (!isOnOrAfterDate(taxPointDate, vatRegistrationStartDate)) return;

        const commissionGross = toNumber(booking?.accounting?.commissionGross);
        const storedCommissionVat = toNumber(booking?.accounting?.commissionVat);
        const vatRate = toNumber(booking?.accounting?.vatRate) || 0.2;

        if (commissionGross <= 0 && storedCommissionVat <= 0) return;

        const commissionVat =
          storedCommissionVat > 0
            ? storedCommissionVat
            : getVatFromGross(commissionGross, vatRate);

        const row = ensureQuarter(taxPointDate);

        row.boardBookingCount += 1;
        row.forecastEventCount += 1;
        row.salesGross += toNumber(booking.grossValue);
        row.vatableSales += commissionGross;
        row.vatOnSales += commissionVat;
      });
    }

    // Optional forecast events are still included for manually-created VATable
    // items, but booking-generated client income is ignored to avoid double-counting
    // the BookingBoardItem source-of-truth figures above.
    if (includeForecastRows) {
      const forecastQuery = {
        entity,
        status: { $in: ["forecast", "confirmed"] },
      };

      if (Object.keys(dateQuery).length) forecastQuery.expectedDate = dateQuery;

      const forecastEvents = await ForecastEvent.find(forecastQuery).lean();

      forecastEvents.forEach((event) => {
        if (!isOnOrAfterDate(event.expectedDate, vatRegistrationStartDate)) return;
        if (String(event.source || "") === TAX_EVENT_SOURCE) return;

        const isClientIncomeEvent =
          event.direction === "in" &&
          ["client_deposit_in", "client_balance_in"].includes(
            String(event.type || ""),
          );

        if (isClientIncomeEvent) return;

        const row = ensureQuarter(event.expectedDate);
        const amount = toNumber(event.amount);

        row.forecastEventCount += 1;

        if (shouldApplySalesVat(event)) {
          const vatBaseAmount = getVatBaseAmount(event);

          row.salesGross += amount;
          row.vatOnSales += getVatAmount(event);
          row.vatableSales += vatBaseAmount;
        }

        if (shouldApplyPurchaseVat(event)) {
          row.purchasesGross += amount;
          row.vatReclaimable += getVatFromGross(amount);
        }
      });
    }

    const quartersArray = Array.from(quarters.values())
      .map((row) => ({
        ...row,
        vatOnSales: Number(row.vatOnSales.toFixed(2)),
        vatReclaimable: Number(row.vatReclaimable.toFixed(2)),
        netVatDue: Number((row.vatOnSales - row.vatReclaimable).toFixed(2)),
        salesGross: Number(row.salesGross.toFixed(2)),
        purchasesGross: Number(row.purchasesGross.toFixed(2)),
        vatableSales: Number(row.vatableSales.toFixed(2)),
      }))
      .sort((a, b) => a.quarter.localeCompare(b.quarter));

    return res.json({
      success: true,
      filters: {
        entity,
        startDate: startDate || null,
        endDate: endDate || null,
        includeForecast: includeForecastRows,
        vatRegistered: true,
        vatRegistrationStartDate:
          vatRegistrationStartDate?.toISOString?.() || null,
        vatStagger: "March, June, September, December",
        boardBookingsIncluded: includeForecastRows,
      },
      quarters: quartersArray,
      summary: {
        totalVatOnSales: Number(
          quartersArray.reduce((sum, row) => sum + row.vatOnSales, 0).toFixed(2),
        ),
        totalVatReclaimable: Number(
          quartersArray
            .reduce((sum, row) => sum + row.vatReclaimable, 0)
            .toFixed(2),
        ),
        totalNetVatDue: Number(
          quartersArray.reduce((sum, row) => sum + row.netVatDue, 0).toFixed(2),
        ),
      },
    });
  } catch (error) {
    console.error("getVatForecast error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getCompanyFinancialYear = (date) => {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;

  // Company year end is 30 November.
  // Dates up to 30 Nov belong to that year end. December belongs to the next year end.
  return month <= 11 ? String(year) : String(year + 1);
};

const getCorporationTaxPaymentDueDate = (companyYearEnd) => {
  const year = Number(companyYearEnd);

  // Company year end: 30 November.
  // Corporation tax due: 9 months + 1 day later = 1 September following year.
  return new Date(Date.UTC(year + 1, 8, 1));
};

const getProfitAmount = (item) => {
  const amount = toNumber(item.amount);

  if (item.direction === "in") {
    return toNumber(item.vatableAmount) || amount;
  }

  return -amount;
};

export const getCorporationTaxForecast = async (req, res) => {
  try {
    const {
      entity = "BMM",
      startDate,
      endDate,
      includeForecast = true,
      taxRate = 0.25,
    } = req.query;

    const dateQuery = {};
    if (startDate) dateQuery.$gte = new Date(startDate);
    if (endDate) dateQuery.$lte = new Date(endDate);

    const transactionQuery = {
      entity,
      taxTreatment: { $in: ["income", "expense"] },
    };

    if (Object.keys(dateQuery).length) transactionQuery.date = dateQuery;

    const transactions = await FinanceTransaction.find(transactionQuery).lean();

    let forecastEvents = [];

    if (String(includeForecast) !== "false") {
      const forecastQuery = {
        entity,
        status: { $in: ["forecast", "confirmed"] },
        taxTreatment: { $in: ["income", "expense"] },
      };

      if (Object.keys(dateQuery).length) forecastQuery.expectedDate = dateQuery;

      forecastEvents = await ForecastEvent.find(forecastQuery).lean();
    }

    const years = new Map();

    const ensureYear = (date) => {
      const key = getCompanyFinancialYear(date);

      if (!years.has(key)) {
        years.set(key, {
          companyYearEnd: key,
          income: 0,
          expenses: 0,
          estimatedProfit: 0,
          estimatedCorporationTax: 0,
          taxRate: Number(taxRate),
          paymentDueDate: getCorporationTaxPaymentDueDate(key),
          transactionCount: 0,
          forecastEventCount: 0,
        });
      }

      return years.get(key);
    };

    transactions.forEach((tx) => {
      if (String(tx.source || "") === TAX_EVENT_SOURCE) return;

      const row = ensureYear(tx.date);
      const amount = getProfitAmount(tx);

      row.transactionCount += 1;

      if (amount >= 0) row.income += amount;
      else row.expenses += Math.abs(amount);
    });

    forecastEvents.forEach((event) => {
      if (String(event.source || "") === TAX_EVENT_SOURCE) return;

      const row = ensureYear(event.expectedDate);
      const amount = getProfitAmount(event);

      row.forecastEventCount += 1;

      if (amount >= 0) row.income += amount;
      else row.expenses += Math.abs(amount);
    });

    const yearsArray = Array.from(years.values())
      .map((row) => {
        const estimatedProfit = row.income - row.expenses;
        const estimatedCorporationTax =
          estimatedProfit > 0 ? estimatedProfit * Number(taxRate) : 0;

        return {
          ...row,
          income: Number(row.income.toFixed(2)),
          expenses: Number(row.expenses.toFixed(2)),
          estimatedProfit: Number(estimatedProfit.toFixed(2)),
          estimatedCorporationTax: Number(
            estimatedCorporationTax.toFixed(2),
          ),
        };
      })
      .sort((a, b) => a.companyYearEnd.localeCompare(b.companyYearEnd));

    res.json({
      success: true,
      filters: {
        entity,
        startDate: startDate || null,
        endDate: endDate || null,
        includeForecast: String(includeForecast) !== "false",
        taxRate: Number(taxRate),
      },
      years: yearsArray,
      summary: {
        totalIncome: Number(
          yearsArray.reduce((sum, row) => sum + row.income, 0).toFixed(2),
        ),
        totalExpenses: Number(
          yearsArray.reduce((sum, row) => sum + row.expenses, 0).toFixed(2),
        ),
        totalEstimatedProfit: Number(
          yearsArray
            .reduce((sum, row) => sum + row.estimatedProfit, 0)
            .toFixed(2),
        ),
        totalEstimatedCorporationTax: Number(
          yearsArray
            .reduce((sum, row) => sum + row.estimatedCorporationTax, 0)
            .toFixed(2),
        ),
        companyYearEndMonth: "November",
        corporationTaxDueRule: "1 September following the 30 November year end",
      },
    });
  } catch (error) {
    console.error("getCorporationTaxForecast error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const TAX_EVENT_SOURCE = "tax_forecast";

export const generateTaxForecastEvents = async (req, res) => {
  try {
    const { entity = "BMM", includeForecast = true, taxRate = 0.25 } = req.body;

    const vatReq = {
      query: { entity, includeForecast },
    };

    const corporationTaxReq = {
      query: { entity, includeForecast, taxRate },
    };

    let vatPayload = null;
    let corporationTaxPayload = null;

    const mockVatRes = {
      json: (payload) => {
        vatPayload = payload;
      },
      status: () => mockVatRes,
    };

    const mockCtRes = {
      json: (payload) => {
        corporationTaxPayload = payload;
      },
      status: () => mockCtRes,
    };

    await getVatForecast(vatReq, mockVatRes);
    await getCorporationTaxForecast(corporationTaxReq, mockCtRes);

    await ForecastEvent.deleteMany({
      entity,
      source: TAX_EVENT_SOURCE,
      isAutoGenerated: true,
      status: { $in: ["forecast", "confirmed"] },
    });

    const eventsToCreate = [];

    (vatPayload?.quarters || []).forEach((quarter) => {
      const amount = Number(quarter.netVatDue || 0);
      if (amount <= 0) return;

      eventsToCreate.push({
        entity,
        type: "vat_out",
        title: `VAT payment due - ${quarter.quarter}`,
        description: `Forecast VAT payment for ${quarter.quarter}. Due 1 month + 7 days after the VAT period ends.`,
        expectedDate: quarter.paymentDueDate,
        amount,
        direction: "out",
        status: "forecast",
        source: TAX_EVENT_SOURCE,
        isAutoGenerated: true,
        notes: "Generated from VAT forecast",
        vatTreatment: "outside_scope",
        vatRate: 0,
        vatBasis: "outside_scope",
        vatableAmount: 0,
        taxTreatment: "tax_payment",
      });
    });

    (corporationTaxPayload?.years || []).forEach((year) => {
      const amount = Number(year.estimatedCorporationTax || 0);
      if (amount <= 0) return;

      eventsToCreate.push({
        entity,
        type: "corporation_tax_out",
        title: `Corporation tax due - year ended 30 Nov ${year.companyYearEnd}`,
        description: `Forecast corporation tax payment for company year ended 30 November ${year.companyYearEnd}`,
        expectedDate: year.paymentDueDate,
        amount,
        direction: "out",
        status: "forecast",
        source: TAX_EVENT_SOURCE,
        isAutoGenerated: true,
        notes: "Generated from corporation tax forecast",
        vatTreatment: "outside_scope",
        vatRate: 0,
        vatBasis: "outside_scope",
        vatableAmount: 0,
        taxTreatment: "tax_payment",
      });
    });

    const createdEvents = eventsToCreate.length
      ? await ForecastEvent.insertMany(eventsToCreate)
      : [];

    res.json({
      success: true,
      entity,
      deletedExistingTaxEvents: true,
      created: createdEvents.length,
      forecastEvents: createdEvents,
    });
  } catch (error) {
    console.error("generateTaxForecastEvents error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const syncVatForecastEvents = async (req, res) => {
  try {
    const {
      entity = "BMM",
      includeForecast = true,
      replaceExisting = true,
    } = req.body || {};

    const vatReq = {
      query: { entity, includeForecast },
    };

    let vatPayload = null;

    const mockVatRes = {
      json: (payload) => {
        vatPayload = payload;
      },
      status: () => mockVatRes,
    };

    await getVatForecast(vatReq, mockVatRes);

    if (!vatPayload?.success) {
      return res.status(400).json({
        success: false,
        message: vatPayload?.message || "Could not calculate VAT forecast.",
      });
    }

    if (replaceExisting) {
      await ForecastEvent.deleteMany({
        entity,
        source: TAX_EVENT_SOURCE,
        type: "vat_out",
        isAutoGenerated: true,
        status: { $in: ["forecast", "confirmed"] },
      });
    }

    const eventsToCreate = [];

    (vatPayload?.quarters || []).forEach((quarter) => {
      const amount = Number(quarter.netVatDue || 0);
      if (amount <= 0) return;

      eventsToCreate.push({
        entity,
        type: "vat_out",
        title: `VAT payment due - ${quarter.quarter}`,
        description: `Forecast VAT payment for ${quarter.quarter}.`,
        expectedDate: quarter.paymentDueDate,
        amount,
        direction: "out",
        status: "forecast",
        source: TAX_EVENT_SOURCE,
        isAutoGenerated: true,
        notes: "Generated from VAT forecast",
        vatTreatment: "outside_scope",
        vatRate: 0,
        vatBasis: "outside_scope",
        vatableAmount: 0,
        vatAmount: 0,
        taxTreatment: "tax_payment",
      });
    });

    const createdEvents = eventsToCreate.length
      ? await ForecastEvent.insertMany(eventsToCreate)
      : [];

    return res.json({
      success: true,
      entity,
      deletedExistingVatEvents: Boolean(replaceExisting),
      createdCount: createdEvents.length,
      forecastEvents: createdEvents,
      quarters: vatPayload?.quarters || [],
      summary: vatPayload?.summary || {},
    });
  } catch (error) {
    console.error("syncVatForecastEvents error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
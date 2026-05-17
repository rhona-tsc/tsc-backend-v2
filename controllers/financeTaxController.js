import FinanceTransaction from "../models/financeTransactionModel.js";
import ForecastEvent from "../models/forecastEventModel.js";

const toNumber = (value) => Number(value || 0);

const getVatQuarter = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;

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
    const { entity = "TSC", startDate, endDate, includeForecast = true } = req.query;

    const dateQuery = {};
    if (startDate) dateQuery.$gte = new Date(startDate);
    if (endDate) dateQuery.$lte = new Date(endDate);

    const transactionQuery = { entity };
    if (Object.keys(dateQuery).length) transactionQuery.date = dateQuery;

    const transactions = await FinanceTransaction.find(transactionQuery).lean();

    let forecastEvents = [];

    if (String(includeForecast) !== "false") {
      const forecastQuery = {
        entity,
        status: { $in: ["forecast", "confirmed"] },
      };

      if (Object.keys(dateQuery).length) forecastQuery.expectedDate = dateQuery;

      forecastEvents = await ForecastEvent.find(forecastQuery).lean();
    }

    const quarters = new Map();

    const ensureQuarter = (date) => {
      const key = getVatQuarter(date);

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
          paymentDueDate: getVatPaymentDueDate(key),
        });
      }

      return quarters.get(key);
    };

    transactions.forEach((tx) => {
      const row = ensureQuarter(tx.date);
      const amount = toNumber(tx.amount);

      row.transactionCount += 1;

      if (shouldApplySalesVat(tx)) {
        row.salesGross += amount;
        row.vatOnSales += getVatFromGross(amount);
      }

      if (shouldApplyPurchaseVat(tx)) {
        row.purchasesGross += amount;
        row.vatReclaimable += getVatFromGross(amount);
      }
    });

    forecastEvents.forEach((event) => {
      const row = ensureQuarter(event.expectedDate);
      const amount = toNumber(event.amount);

      row.forecastEventCount += 1;

      if (shouldApplySalesVat(event)) {
        row.salesGross += amount;
        row.vatOnSales += getVatFromGross(amount);
      }

      if (shouldApplyPurchaseVat(event)) {
        row.purchasesGross += amount;
        row.vatReclaimable += getVatFromGross(amount);
      }
    });

    const quartersArray = Array.from(quarters.values())
      .map((row) => ({
        ...row,
        vatOnSales: Number(row.vatOnSales.toFixed(2)),
        vatReclaimable: Number(row.vatReclaimable.toFixed(2)),
        netVatDue: Number((row.vatOnSales - row.vatReclaimable).toFixed(2)),
        salesGross: Number(row.salesGross.toFixed(2)),
        purchasesGross: Number(row.purchasesGross.toFixed(2)),
      }))
      .sort((a, b) => a.quarter.localeCompare(b.quarter));

    res.json({
      success: true,
      filters: {
        entity,
        startDate: startDate || null,
        endDate: endDate || null,
        includeForecast: String(includeForecast) !== "false",
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
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
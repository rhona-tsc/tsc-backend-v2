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
          vatableSales: 0,
        });
      }

      return quarters.get(key);
    };

    transactions.forEach((tx) => {
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

    forecastEvents.forEach((event) => {
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

const getTaxYear = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;

  // UK company accounting year can differ, but this gives a useful first forecast.
  return month >= 4 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
};

const getCorporationTaxPaymentDueDate = (taxYear) => {
  const [, endYearRaw] = taxYear.split("/");
  const endYear = Number(endYearRaw);

  // Company year end: 30 November
  // Corporation tax due: 9 months + 1 day later = 1 September following year
  return new Date(Date.UTC(endYear, 8, 1));
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
      const key = getTaxYear(date);

      if (!years.has(key)) {
        years.set(key, {
          taxYear: key,
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
      const row = ensureYear(tx.date);
      const amount = getProfitAmount(tx);

      row.transactionCount += 1;

      if (amount >= 0) row.income += amount;
      else row.expenses += Math.abs(amount);
    });

    forecastEvents.forEach((event) => {
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
      .sort((a, b) => a.taxYear.localeCompare(b.taxYear));

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
        description: `Forecast VAT payment for ${quarter.quarter}`,
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
        taxTreatment: "expense",
      });
    });

    (corporationTaxPayload?.years || []).forEach((year) => {
      const amount = Number(year.estimatedCorporationTax || 0);
      if (amount <= 0) return;

      eventsToCreate.push({
        entity,
        type: "corporation_tax_out",
        title: `Corporation tax due - ${year.taxYear}`,
        description: `Forecast corporation tax payment for ${year.taxYear}`,
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
        taxTreatment: "expense",
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
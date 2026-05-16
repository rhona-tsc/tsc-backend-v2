import ForecastEvent from "../models/forecastEventModel.js";
import FinanceAccount from "../models/financeAccountModel.js";

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
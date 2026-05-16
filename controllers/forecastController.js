import ForecastEvent from "../models/forecastEventModel.js";
import FinanceAccount from "../models/financeAccountModel.js";

export const getForecastTimeline = async (req, res) => {
  try {
    const { entity, startDate, endDate, startingBalance } = req.query;

    const query = {
      status: { $ne: "cancelled" },
    };

    if (entity) query.entity = entity;

    if (startDate || endDate) {
      query.expectedDate = {};
      if (startDate) query.expectedDate.$gte = new Date(startDate);
      if (endDate) query.expectedDate.$lte = new Date(endDate);
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
import ForecastEvent from "../models/forecastEventModel.js";

export const getForecastTimeline = async (req, res) => {
  try {
    const {
      entity,
      startDate,
      endDate,
      startingBalance = 0,
    } = req.query;

    const query = {
      status: { $ne: "cancelled" },
    };

    if (entity) query.entity = entity;

    if (startDate || endDate) {
      query.expectedDate = {};
      if (startDate) query.expectedDate.$gte = new Date(startDate);
      if (endDate) query.expectedDate.$lte = new Date(endDate);
    }

    const events = await ForecastEvent.find(query)
      .sort({ expectedDate: 1 })
      .lean();

    let runningBalance = Number(startingBalance || 0);

    let totalIn = 0;
    let totalOut = 0;
    let lowestBalance = runningBalance;
    let firstNegativeDate = null;

    const timeline = events.map((event) => {
      const rawAmount = Number(event.amount || 0);

      const signedAmount =
        event.direction === "in" ? rawAmount : -rawAmount;

      if (signedAmount >= 0) totalIn += signedAmount;
      else totalOut += Math.abs(signedAmount);

      runningBalance += signedAmount;

      if (runningBalance < lowestBalance) {
        lowestBalance = runningBalance;
      }

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
        startingBalance: Number(startingBalance || 0),
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
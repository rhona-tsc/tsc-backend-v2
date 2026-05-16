import ForecastEvent from "../models/forecastEventModel.js";

export const getForecastTimeline = async (req, res) => {
  try {
    const events = await ForecastEvent.find({
      status: { $ne: "cancelled" },
    })
      .sort({ expectedDate: 1 })
      .lean();

    let runningBalance = 0;

    const timeline = events.map((event) => {
      const amount =
        event.direction === "in"
          ? Number(event.amount || 0)
          : -Number(event.amount || 0);

      runningBalance += amount;

      return {
        ...event,
        signedAmount: amount,
        runningBalance,
      };
    });

    res.json({
      success: true,
      timeline,
      finalBalance: runningBalance,
    });
  } catch (error) {
    console.error("getForecastTimeline error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
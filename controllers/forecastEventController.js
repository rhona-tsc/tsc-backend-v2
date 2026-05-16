import ForecastEvent from "../models/forecastEventModel.js";
import FinanceTransaction from "../models/financeTransactionModel.js";

export const reconcileForecastEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: "transactionId is required",
      });
    }

    const transaction = await FinanceTransaction.findById(transactionId);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Finance transaction not found",
      });
    }

    const forecastEvent = await ForecastEvent.findById(id);

    if (!forecastEvent) {
      return res.status(404).json({
        success: false,
        message: "Forecast event not found",
      });
    }

    forecastEvent.actualTransactionId = transaction._id;
    forecastEvent.actualDate = transaction.date;
    forecastEvent.status = "paid";
    forecastEvent.amount = Math.abs(Number(transaction.amount || forecastEvent.amount || 0));
    forecastEvent.direction = transaction.direction || forecastEvent.direction;

    await forecastEvent.save();

    transaction.reconciled = true;
    await transaction.save();

    res.json({
      success: true,
      forecastEvent,
      transaction,
    });
  } catch (error) {
    console.error("reconcileForecastEvent error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const unreconcileForecastEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const forecastEvent = await ForecastEvent.findById(id);

    if (!forecastEvent) {
      return res.status(404).json({
        success: false,
        message: "Forecast event not found",
      });
    }

    const transactionId = forecastEvent.actualTransactionId;

    forecastEvent.actualTransactionId = undefined;
    forecastEvent.actualDate = undefined;
    forecastEvent.status = "forecast";

    await forecastEvent.save();

    if (transactionId) {
      await FinanceTransaction.findByIdAndUpdate(transactionId, {
        reconciled: false,
      });
    }

    res.json({
      success: true,
      forecastEvent,
    });
  } catch (error) {
    console.error("unreconcileForecastEvent error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getForecastEvents = async (req, res) => {
  try {
    const { entity, status, type, startDate, endDate } = req.query;

    const query = {};

    if (entity) query.entity = entity;
    if (status) query.status = status;
    if (type) query.type = type;

    if (startDate || endDate) {
      query.expectedDate = {};
      if (startDate) query.expectedDate.$gte = new Date(startDate);
      if (endDate) query.expectedDate.$lte = new Date(endDate);
    }

    const forecastEvents = await ForecastEvent.find(query)
      .populate("bookingForecastId", "bookingRef clientNames actName eventDate")
      .populate("actualTransactionId", "date description amount direction")
      .sort({ expectedDate: 1 })
      .lean();

    res.json({
      success: true,
      forecastEvents,
    });
  } catch (error) {
    console.error("getForecastEvents error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
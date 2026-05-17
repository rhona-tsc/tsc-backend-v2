import ForecastEvent from "../models/forecastEventModel.js";
import FinanceTransaction from "../models/financeTransactionModel.js";

const toNumber = (value) => Number(value || 0);

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const daysBetween = (a, b) => {
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.abs(startOfDay(a) - startOfDay(b)) / oneDay;
};

const signedAmountForForecast = (event) => {
  const amount = toNumber(event.amount);
  return event.direction === "out" ? -amount : amount;
};

const signedAmountForTransaction = (transaction) => {
  const amount = toNumber(transaction.amount);
  return transaction.direction === "out" ? -amount : amount;
};

export const autoMatchFinanceTransactions = async (req, res) => {
  try {
    const {
      entity,
      accountId,
      dateWindowDays = 14,
      dryRun = false,
    } = req.body;

    const forecastQuery = {
      status: { $in: ["forecast", "confirmed"] },
    };

    const transactionQuery = {
      reconciled: { $ne: true },
    };

    if (entity) {
      forecastQuery.entity = entity;
      transactionQuery.entity = entity;
    }

    if (accountId) {
      transactionQuery.accountId = accountId;
    }

    const forecastEvents = await ForecastEvent.find(forecastQuery)
      .sort({ expectedDate: 1 })
      .lean();

    const transactions = await FinanceTransaction.find(transactionQuery)
      .sort({ date: 1 })
      .lean();

    const matches = [];
    const usedTransactionIds = new Set();

    for (const event of forecastEvents) {
      const eventAmount = signedAmountForForecast(event);

      const candidates = transactions
        .filter((transaction) => {
          if (usedTransactionIds.has(String(transaction._id))) return false;

          const transactionAmount = signedAmountForTransaction(transaction);

          const sameAmount =
            Number(eventAmount).toFixed(2) ===
            Number(transactionAmount).toFixed(2);

          if (!sameAmount) return false;

          if (event.direction !== transaction.direction) return false;

          if (!event.expectedDate || !transaction.date) return false;

          return (
            daysBetween(event.expectedDate, transaction.date) <=
            Number(dateWindowDays)
          );
        })
        .map((transaction) => ({
          transaction,
          dateDistance: daysBetween(event.expectedDate, transaction.date),
        }))
        .sort((a, b) => a.dateDistance - b.dateDistance);

      if (!candidates.length) continue;

      const bestMatch = candidates[0].transaction;
      usedTransactionIds.add(String(bestMatch._id));

      matches.push({
        forecastEventId: event._id,
        forecastTitle: event.title,
        forecastExpectedDate: event.expectedDate,
        forecastAmount: eventAmount,
        transactionId: bestMatch._id,
        transactionDate: bestMatch.date,
        transactionDescription: bestMatch.description,
        transactionAmount: signedAmountForTransaction(bestMatch),
        dateDistance: daysBetween(event.expectedDate, bestMatch.date),
      });
    }

    if (!dryRun) {
      for (const match of matches) {
        await ForecastEvent.findByIdAndUpdate(match.forecastEventId, {
          status: "paid",
          actualDate: match.transactionDate,
          actualTransactionId: match.transactionId,
        });

        await FinanceTransaction.findByIdAndUpdate(match.transactionId, {
          reconciled: true,
          forecastEventId: match.forecastEventId,
        });
      }
    }

    res.json({
      success: true,
      dryRun,
      filters: {
        entity: entity || "ALL",
        accountId: accountId || null,
        dateWindowDays: Number(dateWindowDays),
      },
      checked: {
        forecastEvents: forecastEvents.length,
        transactions: transactions.length,
      },
      matchedCount: matches.length,
      matches,
    });
  } catch (error) {
    console.error("autoMatchFinanceTransactions error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const manualMatchFinanceTransaction = async (req, res) => {
  try {
    const { forecastEventId, transactionId } = req.body;

    if (!forecastEventId || !transactionId) {
      return res.status(400).json({
        success: false,
        message: "forecastEventId and transactionId are required",
      });
    }

    const forecastEvent = await ForecastEvent.findById(forecastEventId);

    if (!forecastEvent) {
      return res.status(404).json({
        success: false,
        message: "Forecast event not found",
      });
    }

    const transaction = await FinanceTransaction.findById(transactionId);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    forecastEvent.status = "paid";
    forecastEvent.actualDate = transaction.date;
    forecastEvent.actualTransactionId = transaction._id;

    transaction.reconciled = true;
    transaction.forecastEventId = forecastEvent._id;

    await forecastEvent.save();
    await transaction.save();

    res.json({
      success: true,
      forecastEvent,
      transaction,
    });
  } catch (error) {
    console.error("manualMatchFinanceTransaction error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
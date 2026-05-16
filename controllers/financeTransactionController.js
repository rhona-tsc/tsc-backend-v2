import FinanceAccount from "../models/financeAccountModel.js";
import FinanceTransaction from "../models/financeTransactionModel.js";

export const createFinanceTransaction = async (req, res) => {
  try {
    const transaction = await FinanceTransaction.create(req.body);
const signedAmount =
  transaction.direction === "in"
    ? Math.abs(Number(transaction.amount || 0))
    : -Math.abs(Number(transaction.amount || 0));

await FinanceAccount.findByIdAndUpdate(transaction.accountId, {
  $inc: { currentBalance: signedAmount },
  balanceAsOf: transaction.date,
});
    res.status(201).json({
      success: true,
      transaction,
    });
  } catch (error) {
    console.error("createFinanceTransaction error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getFinanceTransactions = async (req, res) => {
  try {
    const {
      accountId,
      entity,
      category,
      source,
      reconciled,
      startDate,
      endDate,
    } = req.query;

    const query = {};

    if (accountId) query.accountId = accountId;
    if (entity) query.entity = entity;
    if (category) query.category = category;
    if (source) query.source = source;

    if (reconciled !== undefined) {
      query.reconciled = reconciled === "true";
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const transactions = await FinanceTransaction.find(query)
      .populate("accountId", "name provider entity accountType")
      .populate("bookingForecastId", "bookingRef clientNames actName eventDate")
      .sort({ date: -1 })
      .lean();

    res.json({
      success: true,
      transactions,
    });
  } catch (error) {
    console.error("getFinanceTransactions error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getFinanceTransactionById = async (req, res) => {
  try {
    const transaction = await FinanceTransaction.findById(req.params.id)
      .populate("accountId", "name provider entity accountType")
      .populate("bookingForecastId", "bookingRef clientNames actName eventDate")
      .lean();

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Finance transaction not found",
      });
    }

    res.json({
      success: true,
      transaction,
    });
  } catch (error) {
    console.error("getFinanceTransactionById error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateFinanceTransaction = async (req, res) => {
  try {
    const transaction = await FinanceTransaction.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true },
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Finance transaction not found",
      });
    }

    res.json({
      success: true,
      transaction,
    });
  } catch (error) {
    console.error("updateFinanceTransaction error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteFinanceTransaction = async (req, res) => {
  try {
    const transaction = await FinanceTransaction.findByIdAndDelete(
      req.params.id,
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Finance transaction not found",
      });
    }

    res.json({
      success: true,
      message: "Finance transaction deleted",
    });
  } catch (error) {
    console.error("deleteFinanceTransaction error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
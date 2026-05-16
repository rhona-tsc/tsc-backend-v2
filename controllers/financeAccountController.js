import FinanceAccount from "../models/financeAccountModel.js";

export const createFinanceAccount = async (req, res) => {
  try {
    const account = await FinanceAccount.create(req.body);

    res.status(201).json({
      success: true,
      account,
    });
  } catch (error) {
    console.error("createFinanceAccount error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getFinanceAccounts = async (req, res) => {
  try {
    const { entity, isActive } = req.query;

    const query = {};

    if (entity) query.entity = entity;

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    const accounts = await FinanceAccount.find(query)
      .sort({ entity: 1, name: 1 })
      .lean();

    res.json({
      success: true,
      accounts,
    });
  } catch (error) {
    console.error("getFinanceAccounts error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getFinanceAccountById = async (req, res) => {
  try {
    const account = await FinanceAccount.findById(req.params.id).lean();

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Finance account not found",
      });
    }

    res.json({
      success: true,
      account,
    });
  } catch (error) {
    console.error("getFinanceAccountById error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateFinanceAccount = async (req, res) => {
  try {
    const account = await FinanceAccount.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true },
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Finance account not found",
      });
    }

    res.json({
      success: true,
      account,
    });
  } catch (error) {
    console.error("updateFinanceAccount error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteFinanceAccount = async (req, res) => {
  try {
    const account = await FinanceAccount.findByIdAndDelete(req.params.id);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Finance account not found",
      });
    }

    res.json({
      success: true,
      message: "Finance account deleted",
    });
  } catch (error) {
    console.error("deleteFinanceAccount error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
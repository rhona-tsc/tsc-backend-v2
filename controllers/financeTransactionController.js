import FinanceAccount from "../models/financeAccountModel.js";
import FinanceTransaction from "../models/financeTransactionModel.js";
import { parse } from "csv-parse/sync";
import crypto from "crypto";

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

const clean = (value) => String(value || "").trim();

const toNumber = (value) => {
  if (value === undefined || value === null || value === "") return 0;

  const cleaned = String(value)
    .replace(/[£,]/g, "")
    .replace(/\((.*)\)/, "-$1")
    .trim();

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
};

const toDate = (value) => {
  if (!value) return undefined;

  const raw = clean(value);

  // DD/MM/YYYY
  const ukMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (ukMatch) {
    const [, dd, mm, yyyy] = ukMatch;
    const year = yyyy.length === 2 ? `20${yyyy}` : yyyy;
    return new Date(Date.UTC(Number(year), Number(mm) - 1, Number(dd)));
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const normaliseHeader = (header) =>
  clean(header).toLowerCase().replace(/\s+/g, " ");

const findValue = (row, possibleHeaders) => {
  for (const header of possibleHeaders) {
    const foundKey = Object.keys(row).find(
      (key) => normaliseHeader(key) === normaliseHeader(header),
    );

    if (foundKey && row[foundKey] !== undefined && row[foundKey] !== "") {
      return row[foundKey];
    }
  }

  return undefined;
};

const buildTransactionHash = ({
  accountId,
  date,
  description,
  amount,
  direction,
}) => {
  const input = [
    accountId,
    date ? new Date(date).toISOString().slice(0, 10) : "",
    clean(description).toLowerCase(),
    Number(amount || 0).toFixed(2),
    direction,
  ].join("|");

  return crypto.createHash("sha256").update(input).digest("hex");
};

const parseBankCsvRow = ({ row, accountId, entity }) => {
  const dateValue = findValue(row, [
    "Date",
    "Transaction Date",
    "Booking Date",
    "Completed Date",
    "Created",
  ]);

  const description =
    findValue(row, [
      "Description",
      "Transaction Description",
      "Narrative",
      "Details",
      "Reference",
      "Merchant",
      "Payee",
    ]) || "Imported transaction";

  const merchant =
    findValue(row, ["Merchant", "Payee", "Counterparty", "Name"]) || "";

  const moneyIn = toNumber(
    findValue(row, ["Money In", "Paid In", "Credit", "In", "Amount In"]),
  );

  const moneyOut = toNumber(
    findValue(row, ["Money Out", "Paid Out", "Debit", "Out", "Amount Out"]),
  );

let amount = toNumber(
  findValue(row, [
    "Amount",
    "Amount in GBP",
    "Value",
    "Transaction Amount",
  ]),
);
  let direction = "in";

  if (moneyIn > 0) {
    amount = moneyIn;
    direction = "in";
  } else if (moneyOut > 0) {
    amount = moneyOut;
    direction = "out";
  } else if (amount < 0) {
    amount = Math.abs(amount);
    direction = "out";
  } else {
    direction = "in";
  }

  const date = toDate(dateValue);

  if (!date || amount <= 0) return null;

  const transactionHash = buildTransactionHash({
    accountId,
    date,
    description,
    amount,
    direction,
  });

  return {
    accountId,
    entity,
    date,
    description: clean(description),
    merchant: clean(merchant),
    amount,
    direction,
    category: "other",
    vatTreatment: "unknown",
    taxTreatment: "unknown",
    source: "csv",
    externalId: transactionHash,
    transactionHash,
    reconciled: false,
  };
};

export const importFinanceTransactionsCsv = async (req, res) => {
  try {
    const { accountId, entity } = req.body;

    if (!req.file?.buffer) {
      return res.status(400).json({
        success: false,
        message: "No CSV file uploaded",
      });
    }

    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: "accountId is required",
      });
    }

    const account = await FinanceAccount.findById(accountId).lean();

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Finance account not found",
      });
    }

    const resolvedEntity = entity || account.entity;

    const csvText = req.file.buffer.toString("utf8");

    const rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      relax_column_count: true,
    });

    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const transaction = parseBankCsvRow({
          row,
          accountId,
          entity: resolvedEntity,
        });

        if (!transaction) {
          skipped += 1;
          continue;
        }

        const existing = await FinanceTransaction.findOne({
          accountId,
          transactionHash: transaction.transactionHash,
        }).lean();

        if (existing) {
          duplicates += 1;
          continue;
        }

        await FinanceTransaction.create(transaction);
        imported += 1;
      } catch (rowError) {
        errors.push({
          row,
          message: rowError.message,
        });
      }
    }

    res.json({
      success: true,
      accountId,
      entity: resolvedEntity,
      rowsRead: rows.length,
      imported,
      duplicates,
      skipped,
      errors,
    });
  } catch (error) {
    console.error("importFinanceTransactionsCsv error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
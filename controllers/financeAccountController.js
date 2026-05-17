import FinanceAccount from "../models/financeAccountModel.js";
import { parse } from "csv-parse/sync";
import crypto from "crypto";
import FinanceTransaction from "../models/financeTransactionModel.js";

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

  let amount = toNumber(findValue(row, ["Amount", "Value", "Transaction Amount"]));

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
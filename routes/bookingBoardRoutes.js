// routes/bookingBoardRoutes.js

import express from "express";
import mongoose from "mongoose";
import BookingBoardItem from "../models/bookingBoardItem.js";
import Booking from "../models/bookingModel.js";
import actModel from "../models/actModel.js";
import musicianModel from "../models/musicianModel.js";
import musicianAuth from "../middleware/musicianAuth.js";
import { parse } from "csv-parse/sync";
import financeForecastBookingModel from "../models/financeForecastBookingModel.js";
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, callback) => {
    const isPdf =
      file.mimetype === "application/pdf" ||
      String(file.originalname || "").toLowerCase().endsWith(".pdf");
    callback(isPdf ? null : new Error("Only PDF files can be imported."), isPdf);
  },
});

const router = express.Router();

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  return Number(String(value).replace(/[£,]/g, "").trim()) || 0;
};

const cleanString = (value) => String(value || "").trim();

const captureLine = (text, label) => {
  const match = String(text || "").match(
    new RegExp(`^${label}[ \\t]*:[ \\t]*([^\\r\\n]*)$`, "im"),
  );
  return cleanString(match?.[1]);
};

const parseContractDate = (value) => {
  const cleaned = cleanString(value).replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  if (!cleaned) return "";
  const parsed = new Date(`${cleaned} 12:00:00 UTC`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};

const parseTime = (value) => {
  const text = cleanString(value)
    .toLowerCase()
    .replace(/(\d)\.(\d{2})/g, "$1:$2");
  if (!text || text === "tbc") return "";
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (match[3] === "pm" && hour < 12) hour += 12;
  if (match[3] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const parseMoneyLine = (text, label) => {
  const raw = captureLine(text, label);
  const match = raw.match(/(?:\b(GBP|EUR|USD)\b|([£€$]))\s*([\d,.]+)/i);
  const symbolCurrency = {
    "£": "GBP",
    "€": "EUR",
    "$": "USD",
  }[match?.[2]];
  return {
    currency: cleanString(match?.[1] || symbolCurrency).toUpperCase(),
    amount: Number(String(match?.[3] || "").replace(/,/g, "")) || 0,
  };
};

const addCalendarDays = (isoDate, days) => {
  if (!isoDate || !Number.isFinite(Number(days))) return "";
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
};

const parseEncoreBooking = (bookingText, acceptedEmailText = "") => {
  const primary = String(bookingText || "");
  const supporting = String(acceptedEmailText || "");
  const combined = `${primary}\n${supporting}`;
  const money = (pattern) =>
    Number(combined.match(pattern)?.[1]?.replace(/,/g, "")) || 0;
  const reference = cleanString(
    combined.match(/Job reference\s*:\s*([a-z0-9-]+?)(?=What's|\s|$)/i)?.[1] ||
      combined.match(/\[([a-z0-9-]+)\]/i)?.[1],
  );
  const actName = cleanString(
    primary.match(/Booked as\s*:\s*\n?([^\r\n]+)/i)?.[1] ||
      supporting.match(/Hi\s+([^,\r\n]+),/i)?.[1],
  ).replace(/Cancel booking.*$/i, "").trim();
  const clientName = cleanString(
    primary.match(/Contact details\s*:\s*\n([^\r\n]+)/i)?.[1] ||
      combined.match(/location with\s+([^\s]+)\s+if/i)?.[1],
  );
  const email = cleanString(
    primary.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{1,4}(?:\s*\n\s*[A-Z])?)/i)?.[1],
  ).replace(/\s+/g, "");
  const phone = cleanString(
    primary.match(/Contact details\s*:[\s\S]{0,180}?(0\d(?:[\s-]?\d){9,10})/i)?.[1] ||
      primary.match(/call\s+[^\r\n]+\s+on\s+(0\d(?:[\s-]?\d){9,10})/i)?.[1],
  ).replace(/\s+/g, "");
  const eventDateText = cleanString(
    primary.match(/Date\s*:\s*\n([^\r\n]+)/i)?.[1] ||
      supporting.match(/Saturday\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i)?.[1],
  );
  const bookingDateText = cleanString(
    supporting.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+at\s+\d{1,2}:\d{2}/i)?.[1] ||
      primary.match(/(\d{1,2}(?:st|nd|rd|th)\s+[A-Za-z]+\s+\d{4})\s*You accepted this booking/i)?.[1],
  );
  const enquiryDateText = cleanString(
    primary.match(/(\d{1,2}(?:st|nd|rd|th)\s+[A-Za-z]+\s+\d{4})\s*[^\r\n]{1,80}?requested a quote/i)?.[1],
  );
  const venueBlock = cleanString(
    primary.match(/Location\s*:\s*\n([\s\S]{0,160}?)\nDate\s*:/i)?.[1] ||
      supporting.match(/Booking details[\s\S]*?\n([^\n]+\n[^\n]+)\nSaturday/i)?.[1],
  );
  const address = venueBlock
    .split(/\r?\n/)
    .map(cleanString)
    .filter(Boolean)
    .join(", ");
  const lineup = cleanString(primary.match(/Line-up\s*:\s*\n([^\r\n]+)/i)?.[1]);
  const performanceFee = money(/Performance fee\s*£\s*([\d,.]+)/i) ||
    money(/You quoted\s*:\s*£\s*([\d,.]+)/i);
  const serviceFee = money(/Service fee\s*-?\s*£\s*([\d,.]+)/i);
  const earnings = money(/Your earnings\s*:?\s*£\s*([\d,.]+)/i);
  const depositPaid = /Deposit paid\s*-\s*Encore Pay/i.test(primary);
  const depositAmount = depositPaid && earnings ? round2(earnings * 0.1) : 0;
  const arrivalTime = parseTime(
    primary.match(/Arrive\s*\n([^\r\n]+)/i)?.[1] ||
      supporting.match(/\n(\d{1,2}:\d{2}\s*(?:am|pm))\s+for\s+\d+/i)?.[1],
  );

  return {
    bookerName: clientName,
    clientFirstNames: clientName.split(/\s+/)[0] || "",
    clientEmail: email,
    clientPhone: phone,
    clientAddress: "",
    bookingRef: reference,
    eventDateISO: parseContractDate(eventDateText),
    enquiryDateISO: parseContractDate(enquiryDateText),
    bookingDateISO: parseContractDate(bookingDateText),
    eventType: /wedding/i.test(combined) ? "Wedding" : "",
    agent: "Encore",
    actName,
    actTscName: actName,
    address,
    grossValue: performanceFee,
    commissionGross: serviceFee,
    passThroughGross: earnings,
    vatRate: 0,
    invoiceCompany: "TSC",
    currency: "GBP",
    lineupSelected: lineup,
    lineupComposition: [],
    bandSize: Number(lineup.match(/(\d+)\s*musicians?/i)?.[1] || 0),
    arrivalTime,
    finishTime: "",
    performancePlan: cleanString(
      primary.match(/This quote is for\s*:\s*\n([^\r\n]+)/i)?.[1] ||
        supporting.match(/\((\d+\s*x\s*\d+min sets)\)/i)?.[1],
    ),
    accounting: {
      invoiceCompany: "TSC",
      paymentStage: depositPaid ? "deposit" : "",
      vatRate: 0,
      commissionGross: serviceFee,
      commissionVat: 0,
      commissionNet: serviceFee,
      passThroughGross: earnings,
      currency: "GBP",
    },
    payments: {
      depositAmount,
      depositChargedAmount: depositAmount,
      balancePaymentReceived: false,
      bandPaymentsSent: false,
    },
    importMetadata: {
      source: "encore_pdf",
      contractFilename: "",
      invoiceFilename: "",
      importedAt: new Date().toISOString(),
      incompleteFields: [
        !address && "venueAddress",
        !email && "clientEmail",
        !arrivalTime && "arrivalTime",
        "finishTime",
      ].filter(Boolean),
    },
  };
};

export const parseBookingContract = (contractText, invoiceText = "") => {
  if (/Job reference\s*:|Encore Pay|encoremusicians\.com/i.test(`${contractText}\n${invoiceText}`)) {
    return parseEncoreBooking(contractText, invoiceText);
  }

  const total = parseMoneyLine(contractText, "Total");
  const deposit = parseMoneyLine(contractText, "Deposit");
  const balance = parseMoneyLine(contractText, "Balance to pay");
  const issueDateISO = parseContractDate(captureLine(contractText, "Date of Issue"));
  const invoiceDateISO = parseContractDate(
    invoiceText.match(/\b(\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/)?.[1],
  );
  const invoiceDueDateISO = parseContractDate(
    invoiceText.match(/Payment due by\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i)?.[1],
  );
  const contractRef = captureLine(contractText, "Contract Ref");
  const invoiceRef = cleanString(invoiceText.match(/INVOICE\s+([^\n]+)/i)?.[1]);
  const lineup = captureLine(contractText, "Artist Line-up");
  const lineupComposition = lineup
    .replace(/^\d+[- ]piece\s*/i, "")
    .replace(/^\(|\)$/g, "")
    .split(/,/) 
    .map(cleanString)
    .filter(Boolean);
  const currency = total.currency || deposit.currency || "GBP";
  const depositDueDays = Number(
    contractText.match(
      /deposit[\s\S]{0,180}?payable[\s\S]{0,120}?within\s+(\d+)\s+days/i,
    )?.[1] || 0,
  );
  const depositDueDateISO =
    invoiceDueDateISO ||
    (depositDueDays > 0 ? addCalendarDays(issueDateISO, depositDueDays) : "");

  return {
    bookerName: captureLine(contractText, "Contact Name"),
    clientFirstNames: captureLine(contractText, "Contact Name").split(/\s+/)[0] || "",
    clientEmail: captureLine(contractText, "Contact Email"),
    clientPhone: captureLine(contractText, "Contact Telephone"),
    clientAddress: captureLine(contractText, "Contact Address"),
    bookingRef: contractRef,
    eventDateISO: parseContractDate(captureLine(contractText, "Event Date")),
    bookingDateISO: issueDateISO,
    invoiceDateISO: invoiceDateISO || issueDateISO,
    invoiceDueDateISO,
    eventType: captureLine(contractText, "Event Type"),
    agent: "Direct",
    actName: captureLine(contractText, "Artist Name") ||
      contractText.match(/'Artist'\s*\(([^)]+)\)/i)?.[1] || "",
    actTscName: captureLine(contractText, "Artist Name") ||
      contractText.match(/'Artist'\s*\(([^)]+)\)/i)?.[1] || "",
    address: captureLine(contractText, "Venue Address"),
    grossValue: total.amount,
    commissionGross: deposit.amount,
    passThroughGross: balance.amount,
    vatRate: invoiceText ? 0.2 : 0,
    invoiceCompany: "BMM",
    currency,
    lineupSelected: lineup,
    lineupComposition,
    bandSize: Number(lineup.match(/(\d+)\s*[- ]piece/i)?.[1] || 0),
    arrivalTime: parseTime(captureLine(contractText, "Artist Arrival Time")),
    finishTime: parseTime(captureLine(contractText, "Artist Finish Time")),
    setupTime: captureLine(contractText, "Artist Setup Time"),
    changeTime: captureLine(contractText, "Artist Change Time"),
    performancePlan: captureLine(contractText, "Performance Plan"),
    accounting: {
      invoiceCompany: "BMM",
      paymentStage: "deposit",
      vatRate: invoiceText ? 0.2 : 0,
      commissionGross: deposit.amount,
      commissionVat: invoiceText ? round2(deposit.amount / 6) : 0,
      commissionNet: invoiceText ? round2(deposit.amount * 5 / 6) : deposit.amount,
      passThroughGross: balance.amount,
      currency,
    },
    depositInvoice: {
      invoiceCompany: "BMM",
      invoiceNumber: invoiceRef,
      issueDateISO: invoiceDateISO || issueDateISO,
      dueDateISO: depositDueDateISO,
      currency,
      gross: deposit.amount,
      net: Number(invoiceText.match(/Net Total\s*([\d,.]+)/i)?.[1]?.replace(/,/g, "")) || 0,
      vat: Number(invoiceText.match(/VAT\s*([\d,.]+)\s+EUR Total/i)?.[1]?.replace(/,/g, "")) || 0,
      status: "issued",
    },
    paymentInstructions: invoiceText ? {
      bankName: "Barclays",
      accountName: invoiceText.match(/Account Holder:\s*([^\n]+)/i)?.[1]?.trim() || "",
      accountNumber: invoiceText.match(/account number\s+(\d+)/i)?.[1] || "",
      sortCode: invoiceText.match(/sort code\s+([\d-]+)/i)?.[1] || "",
      iban: invoiceText.match(/IBAN:\s*([^\s]+)/i)?.[1] || "",
      swiftBic: invoiceText.match(/SWIFTBIC:\s*([^\s]+)/i)?.[1] || "",
      paymentReference: invoiceText.match(/Payment Reference:\s*([^\n]+)/i)?.[1]?.trim() || contractRef,
      note: "Use these client-specific payment details instead of the standard invoice account.",
    } : {},
    importMetadata: {
      source: "contract_pdf",
      contractFilename: "",
      invoiceFilename: "",
      importedAt: new Date().toISOString(),
      incompleteFields: [
        !captureLine(contractText, "Contact Address") && "clientAddress",
        !captureLine(contractText, "Venue Address") && "venueAddress",
        captureLine(contractText, "Artist Start Time").toLowerCase() === "tbc" && "startTime",
        captureLine(contractText, "Artist Finish Time").toLowerCase() === "tbc" && "finishTime",
      ].filter(Boolean),
    },
  };
};

const looksLikeRealBookingRow = (row = {}) => {
  const client = cleanString(row.clientFirstNames || row["Client Name"] || row.Name);
  const agent = cleanString(row.agent || row.Source);
  const eventType = cleanString(row.eventType || row["Type of Event"]);
  const eventDate = cleanString(row.eventDateISO || row["Event Date"]);
  const gross = toNumber(row.grossValue || row["Subtotal (after deposit taken) / Balance"]);
  const commission = toNumber(row.commissionGross || row["Musican Fee on gig"]);

  const clientLower = client.toLowerCase();
  const agentLower = agent.toLowerCase();
  const eventTypeLower = eventType.toLowerCase();

  if (!client && !eventDate && !gross && !commission) return false;

  if (
    clientLower === "name" ||
    agentLower === "source" ||
    eventTypeLower === "type of event" ||
    gross === 0 && commission === 0 && !eventDate
  ) {
    return false;
  }

  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|marketing)$/i.test(client)) {
    return false;
  }

return Boolean(client && eventDate && (gross || commission));
};

const normaliseDate = (value) => {
  const raw = cleanString(value);
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";

  return d.toISOString().slice(0, 10);
};

const calcVatFromVatInclusiveGross = (gross, vatRate = 0.2) => {
  const g = round2(gross);
  const r = Number(vatRate ?? 0.2);
  const vat = round2(g * (r / (1 + r)));
  const net = round2(g - vat);
  return { vat, net };
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isValidObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(String(value || ""));

const normaliseAssignedMusician = (value = {}) => {
  if (!value) return null;

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;

    const objectIdMatch = text.match(/[0-9a-fA-F]{24}/);
    const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const cleanedName = text
      .replace(/[<(].*?[>)]/g, "")
      .replace(/[0-9a-fA-F]{24}/g, "")
      .trim();

    return {
      ...(isValidObjectId(objectIdMatch?.[0])
        ? { musicianId: new mongoose.Types.ObjectId(objectIdMatch[0]) }
        : {}),
      name: cleanedName || text,
      email: emailMatch?.[0]?.toLowerCase() || "",
      source: "manual",
    };
  }

  const rawId = String(
    value?.musicianId || value?.userId || value?._id || value?.id || "",
  ).trim();
  const firstName = String(value?.firstName || value?.firstname || "").trim();
  const lastName = String(value?.lastName || value?.lastname || "").trim();
  const name = String(
    value?.name || value?.fullName || [firstName, lastName].filter(Boolean).join(" ") || "",
  ).trim();
  const email = String(value?.email || value?.userEmail || value?.emailAddress || "")
    .trim()
    .toLowerCase();

  if (!rawId && !name && !email) return null;

  return {
    ...(isValidObjectId(rawId)
      ? { musicianId: new mongoose.Types.ObjectId(rawId) }
      : {}),
    name,
    firstName,
    lastName,
    email,
    phone: String(value?.phone || value?.phoneNumber || "").trim(),
    role: String(value?.role || value?.position || value?.instrument || "").trim(),
    instrument: String(value?.instrument || value?.role || "").trim(),
    status: value?.status || "confirmed",
    fee: Number(value?.fee || value?.baseFee || 0),
    currency: String(value?.currency || value?.feeCurrency || "GBP").trim().toUpperCase(),
    travelFee: Number(value?.travelFee || 0),
    totalFee: Number(value?.totalFee || value?.fee || value?.baseFee || 0),
    paymentStatus: value?.paymentStatus || "not_due",
    notes: String(value?.notes || ""),
    source: value?.source || "manual",
  };
};

const normaliseAssignedMusicians = (value = []) => {
  const arr = Array.isArray(value) ? value : String(value || "").split(/\n|,/);
  const seen = new Set();

  return arr
    .map(normaliseAssignedMusician)
    .filter(Boolean)
    .filter((member) => {
      const key = String(member.musicianId || member.email || member.name || "")
        .trim()
        .toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const getRowAssignedMusicians = (row = {}) =>
  normaliseAssignedMusicians(
    row.assignedMusicians ||
      row.bookingMusicians ||
      row.bandLineup ||
      row.bookingDetails?.assignedMusicians ||
      row.actsSummary?.[0]?.assignedMusicians ||
      [],
  );

const toObjectIdString = (value) => {
  try {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (value?.toString) return value.toString();
    return "";
  } catch {
    return "";
  }
};

const isoDateOnly = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
};

const getThursdayWeekBefore = (eventDateISO) => {
  const d = new Date(`${eventDateISO}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "";

  d.setUTCDate(d.getUTCDate() - 7);

  while (d.getUTCDay() !== 4) {
    d.setUTCDate(d.getUTCDate() - 1);
  }

  return d.toISOString().slice(0, 10);
};


const normaliseImportRow = (item = {}) => {
  const grossValue = toNumber(
    item.grossValue ?? item.gross ?? item.total ?? item.bookingTotal,
  );

  const commissionGross = toNumber(
    item.commissionGross ?? item.commission ?? item.deposit ?? item.depositPaid,
  );

  const passThroughGross = toNumber(
    item.passThroughGross ?? item.bandFee ?? item.hold ?? item.balanceDue,
  );

  const vatRate = Number(item.vatRate ?? 0.2);

  const { vat: commissionVat, net: commissionNet } =
    calcVatFromVatInclusiveGross(commissionGross, vatRate);

  const bookingRef = cleanString(
    item.bookingRef || item.ref || item.reference || item.bookingId,
  );

  const assignedMusicians = normaliseAssignedMusicians(
    item.assignedMusicians || item.bookingMusicians || item.bandLineup || item.musicians,
  );

  return {
    bookingRef,
    invoiceCompany: cleanString(item.invoiceCompany || item.invoice_company || "TSC").toUpperCase() === "BMM" ? "BMM" : "TSC",
    bookerName: cleanString(item.bookerName || item.clientName),
    clientFirstNames: cleanString(
      item.clientFirstNames || item.clientName || item.bookerName,
    ),
    eventDateISO: cleanString(
      item.eventDateISO || item.eventDate || item.date,
    ).slice(0, 10),
    enquiryDateISO: cleanString(item.enquiryDateISO || item.enquiryDate).slice(
      0,
      10,
    ),
    bookingDateISO: cleanString(item.bookingDateISO || item.bookingDate).slice(
      0,
      10,
    ),
    agent: cleanString(item.agent || "Direct"),
    clientEmails: item.clientEmail
      ? [{ email: cleanString(item.clientEmail) }]
      : Array.isArray(item.clientEmails)
        ? item.clientEmails
        : [],
    clientAddress: cleanString(item.clientAddress),
    eventType: cleanString(item.eventType),
    actName: cleanString(item.actName),
    actTscName: cleanString(item.actTscName || item.actName),
    address: cleanString(item.address || item.venueAddress || item.venue),
    county: cleanString(item.county),
    grossValue,
    netCommission: 0,
    bandSize: toNumber(item.bandSize),
    lineupSelected: cleanString(item.lineupSelected || item.lineup),
    lineupComposition: Array.isArray(item.lineupComposition)
      ? item.lineupComposition
      : [],
    assignedMusicians,
    bookingMusicians: assignedMusicians,
    bandLineup: assignedMusicians,
    arrivalTime: cleanString(item.arrivalTime),
    finishTime: cleanString(item.finishTime),
    payments: {
      depositAmount: toNumber(item.depositAmount ?? item.depositPaid),
      depositChargedAmount: toNumber(
        item.depositChargedAmount ?? item.depositPaid,
      ),
      balancePaymentReceived: Boolean(item.balancePaymentReceived),
      bandPaymentsSent: Boolean(item.bandPaymentsSent),
    },
    accounting: {
      invoiceCompany: cleanString(item.invoiceCompany || item.invoice_company || "TSC").toUpperCase() === "BMM" ? "BMM" : "TSC",
      paymentStage: "",
      vatRate,
      commissionGross,
      commissionVat,
      commissionNet,
      passThroughGross:
        passThroughGross || Math.max(grossValue - commissionGross, 0),
      currency: "GBP",
    },
    bookingDetails: {
      eventType: cleanString(item.eventType),
      evening: { sets: [] },
      djServicesBooked: Boolean(item.djServicesBooked),
      assignedMusicians,
    },
    allocation: { status: "in_progress" },
    review: { requestedCount: 0, received: false },
    source: "bulk_import",
    updatedAt: new Date(),
  };
};

const calcDepositFromGross = (grossValue) => {
  const gross = Number(grossValue || 0);
  if (!gross) return 0;
  const n = Math.ceil((gross - 50) * 0.2) + 50;
  return n > 0 ? n : 0;
};

const isPlainObject = (value) => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const mergeDeep = (target, source) => {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return source;
  }

  const out = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      out[key] = value;
    } else if (isPlainObject(value) && isPlainObject(target[key])) {
      out[key] = mergeDeep(target[key], value);
    } else {
      out[key] = value;
    }
  }

  return out;
};

const sanitizeBookingPatch = (body = {}) => {
  const patch = { ...body };

  delete patch._id;
  delete patch.createdAt;
  delete patch.updatedAt;
  delete patch.__v;
  delete patch.sourceBookingId;
  delete patch.boardRowId;
  delete patch.bookingRef;
  delete patch.sessionId;

  if (patch.totals && isPlainObject(patch.totals)) {
    patch.totals = {
      ...patch.totals,
      fullAmount: Number(patch.totals.fullAmount || 0) || 0,
      depositAmount: Number(patch.totals.depositAmount || 0) || 0,
      chargedAmount:
        Number(
          patch.totals.chargedAmount ??
            patch.amount ??
            patch.totals.depositAmount ??
            0,
        ) || 0,
    };
  }

  if (patch.amount != null) {
    patch.amount = Number(patch.amount || 0) || 0;
  }

  if (patch.fee != null) {
    patch.fee = Number(patch.fee || 0) || 0;
  }

  if (patch.balanceAmountPence != null) {
    patch.balanceAmountPence = Number(patch.balanceAmountPence || 0) || 0;
  }

  if (patch.performanceTimes && isPlainObject(patch.performanceTimes)) {
    patch.performanceTimes = { ...patch.performanceTimes };
  }

  if (patch.bookingDetails && isPlainObject(patch.bookingDetails)) {
    patch.bookingDetails = { ...patch.bookingDetails };
  }

  if (Array.isArray(patch.actsSummary)) {
    patch.actsSummary = patch.actsSummary.map((act) => ({ ...act }));
  }

  if (Array.isArray(patch.assignedMusicians)) {
    patch.assignedMusicians = normaliseAssignedMusicians(patch.assignedMusicians);
  }

  if (Array.isArray(patch.bookingMusicians)) {
    patch.bookingMusicians = normaliseAssignedMusicians(patch.bookingMusicians);
  }

  if (Array.isArray(patch.bandLineup)) {
    patch.bandLineup = normaliseAssignedMusicians(patch.bandLineup);
  }

  if (patch.accounting && isPlainObject(patch.accounting)) {
    const requestedVatRate = Number(patch.accounting.vatRate ?? 0.2);
    patch.accounting = {
      ...patch.accounting,
      invoiceCompany:
        String(patch.accounting.invoiceCompany || patch.invoiceCompany || "TSC")
          .trim()
          .toUpperCase() === "BMM"
          ? "BMM"
          : "TSC",
      vatRate: Number.isFinite(requestedVatRate) ? requestedVatRate : 0.2,

      commissionGross: Number(patch.accounting.commissionGross || 0) || 0,

      commissionVat: Number(patch.accounting.commissionVat || 0) || 0,

      commissionNet: Number(patch.accounting.commissionNet || 0) || 0,

      passThroughGross: Number(patch.accounting.passThroughGross || 0) || 0,

      currency: String(patch.accounting.currency || "GBP"),

      paymentStage: String(patch.accounting.paymentStage || ""),
    };
  }

  return patch;
};

const applyBookingPatch = async (bookingDoc, rawPatch = {}) => {
  const patch = sanitizeBookingPatch(rawPatch);

  const requestedEventDate = patch.eventDateISO || patch.eventDate || patch.date;
  if (requestedEventDate !== undefined) {
    const dateOnly = String(requestedEventDate || "").slice(0, 10);
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)
      ? new Date(`${dateOnly}T00:00:00.000Z`)
      : null;
    bookingDoc.eventDate = parsedDate;
    bookingDoc.date = parsedDate;
  }

  if (patch.bookingDateISO !== undefined) {
    const dateOnly = String(patch.bookingDateISO || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      bookingDoc.bookingDate = new Date(`${dateOnly}T00:00:00.000Z`);
    }
  }

  const scalarFields = [
    "agent",
    "clientAddress",
    "county",
    "lineupSelected",
    "arrivalTime",
    "finishTime",
    "actName",
    "actTscName",
  ];
  scalarFields.forEach((field) => {
    if (
      patch[field] !== undefined &&
      bookingDoc.constructor?.schema?.path(field)
    ) {
      bookingDoc[field] = patch[field];
    }
  });

  if (patch.clientEmail !== undefined || patch.userEmail !== undefined) {
    const email = String(patch.clientEmail || patch.userEmail || "").trim();
    bookingDoc.clientEmail = email;
    bookingDoc.userEmail = email;
  }

  if (patch.clientFirstNames !== undefined || patch.clientName !== undefined || patch.bookerName !== undefined) {
    bookingDoc.clientName = String(patch.clientFirstNames || patch.clientName || patch.bookerName || "").trim();
  }

  if (patch.totals && isPlainObject(patch.totals)) {
    bookingDoc.totals = mergeDeep(
      bookingDoc.totals?.toObject
        ? bookingDoc.totals.toObject()
        : bookingDoc.totals || {},
      patch.totals,
    );
  }

  if (patch.performanceTimes && isPlainObject(patch.performanceTimes)) {
    bookingDoc.performanceTimes = mergeDeep(
      bookingDoc.performanceTimes?.toObject
        ? bookingDoc.performanceTimes.toObject()
        : bookingDoc.performanceTimes || {},
      patch.performanceTimes,
    );
  }

  if (patch.bookingDetails && isPlainObject(patch.bookingDetails)) {
    bookingDoc.bookingDetails = mergeDeep(
      bookingDoc.bookingDetails || {},
      patch.bookingDetails,
    );
  }

  if (Array.isArray(patch.actsSummary)) {
    bookingDoc.actsSummary = patch.actsSummary;
  }

  if (Array.isArray(patch.assignedMusicians)) {
    bookingDoc.assignedMusicians = patch.assignedMusicians;
  }

  if (Array.isArray(patch.bookingMusicians)) {
    bookingDoc.bookingMusicians = patch.bookingMusicians;
  }

  if (Array.isArray(patch.bandLineup)) {
    bookingDoc.bandLineup = patch.bandLineup;
  }

  if (patch.notes !== undefined) {
    bookingDoc.notes = patch.notes;
  }

  if (patch.eventType !== undefined) {
    bookingDoc.eventType = String(patch.eventType || "").trim();
    bookingDoc.bookingDetails = mergeDeep(bookingDoc.bookingDetails || {}, {
      eventType: bookingDoc.eventType,
    });
  }

  if (patch.amount !== undefined) {
    bookingDoc.amount = patch.amount;
  }

  if (patch.fee !== undefined) {
    bookingDoc.fee = patch.fee;
  }

  if (patch.balanceAmountPence !== undefined) {
    bookingDoc.balanceAmountPence = patch.balanceAmountPence;
  }

  const gross =
    Number(
      bookingDoc?.totals?.fullAmount ??
        bookingDoc?.amount ??
        bookingDoc?.fee ??
        0,
    ) || 0;

  const deposit = Number(bookingDoc?.totals?.depositAmount || 0) || 0;

  const charged =
    Number(
      bookingDoc?.totals?.chargedAmount ?? bookingDoc?.amount ?? deposit ?? 0,
    ) || 0;

  const computedBalance = Math.max(0, gross - charged);

  bookingDoc.totals = {
    ...(bookingDoc.totals?.toObject
      ? bookingDoc.totals.toObject()
      : bookingDoc.totals || {}),
    fullAmount: gross,
    depositAmount: deposit,
    chargedAmount: charged,
  };

  if (patch.accounting && isPlainObject(patch.accounting)) {
    bookingDoc.accounting = mergeDeep(
      bookingDoc.accounting || {},
      patch.accounting,
    );
  }

  if (patch.invoiceCompany || patch.accounting?.invoiceCompany) {
    bookingDoc.invoiceCompany =
      String(patch.invoiceCompany || patch.accounting?.invoiceCompany || "TSC")
        .trim()
        .toUpperCase() === "BMM"
        ? "BMM"
        : "TSC";
  }
  bookingDoc.balanceAmountPence = Math.round(computedBalance * 100);

  if (computedBalance > 0) {
    bookingDoc.balancePaid = false;
  } else {
    bookingDoc.balancePaid = true;
  }

  await bookingDoc.save();
  return bookingDoc;
};

const hasContractLink = (row) => {
  const url =
    row?.contractUrl ||
    row?.pdfUrl ||
    row?.contract?.url ||
    row?.contract?.href ||
    "";
  return Boolean(String(url || "").trim());
};

const hasEventSheetContent = (row) => {
  return Boolean(
    row?.eventSheet?.submitted ||
    (row?.eventSheet?.answers && Object.keys(row.eventSheet.answers).length) ||
    (row?.eventSheet?.complete && Object.keys(row.eventSheet.complete).length),
  );
};

const getRowClientEmail = (row) => {
  if (Array.isArray(row?.clientEmails) && row.clientEmails.length) {
    return String(row.clientEmails.find((e) => e?.email)?.email || "")
      .trim()
      .toLowerCase();
  }
  return String(
    row?.clientEmail || row?.userAddress?.email || row?.userEmail || "",
  )
    .trim()
    .toLowerCase();
};

const getRowClientName = (row) => {
  return String(
    row?.clientFirstNames ||
      row?.clientName ||
      row?.bookerName ||
      [row?.userAddress?.firstName, row?.userAddress?.lastName]
        .filter(Boolean)
        .join(" ") ||
      "",
  )
    .trim()
    .toLowerCase();
};

const getRowActKey = (row) => {
  return String(
    row?.actTscName ||
      row?.actName ||
      row?.actsSummary?.[0]?.tscName ||
      row?.actsSummary?.[0]?.actName ||
      row?.actsSummary?.[0]?.name ||
      row?.actId ||
      row?.act ||
      "",
  )
    .trim()
    .toLowerCase();
};

const getRowEventDateKey = (row) => {
  return String(
    row?.eventDateISO ||
      isoDateOnly(row?.date || row?.eventDate || row?.bookingDate) ||
      "",
  ).slice(0, 10);
};

const getCanonicalBookingKey = (row) => {
  const sessionId = String(row?.sessionId || "")
    .trim()
    .toLowerCase();
  if (sessionId) return `session:${sessionId}`;

  const bookingId = String(row?.bookingId || row?.bookingRef || "")
    .trim()
    .toLowerCase();
  if (bookingId) return `booking:${bookingId}`;

  const email = getRowClientEmail(row);
  const dateKey = getRowEventDateKey(row);
  const actKey = getRowActKey(row);
  const nameKey = getRowClientName(row);
  return `fallback:${email}|${dateKey}|${actKey}|${nameKey}`;
};

const scoreRowCompleteness = (row) => {
  const gross =
    Number(
      row?.grossValue ||
        row?.totals?.fullAmount ||
        row?.amount ||
        row?.fee ||
        0,
    ) || 0;
  const deposit =
    Number(
      row?.payments?.depositChargedAmount ??
        row?.payments?.depositAmount ??
        row?.totals?.depositAmount ??
        row?.depositAmount ??
        0,
    ) || 0;

  return [
    hasContractLink(row),
    hasEventSheetContent(row),
    Boolean(gross),
    Boolean(deposit),
    Boolean(getRowClientEmail(row)),
    Boolean(getRowClientName(row)),
    Boolean(getRowActKey(row)),
    Boolean(getRowEventDateKey(row)),
    Boolean(row?.eventType),
    Boolean(row?.address || row?.venueAddress || row?.venue),
    Boolean(row?.lineupSelected || row?.actsSummary?.[0]?.lineupLabel),
    Boolean(
      row?.performanceTimes?.startTime ||
      row?.performanceTimes?.arrivalTime ||
      row?.arrivalTime,
    ),
  ].filter(Boolean).length;
};

const mergeRowData = (preferred, secondary) => {
  if (!preferred) return secondary;
  if (!secondary) return preferred;

  return {
    ...secondary,
    ...preferred,
    _id: preferred?._id || secondary?._id,
    sourceBookingId: preferred?.sourceBookingId || secondary?.sourceBookingId,
    bookingRef: preferred?.bookingRef || secondary?.bookingRef,
    bookingId: preferred?.bookingId || secondary?.bookingId,
    invoiceCompany:
      preferred?.invoiceCompany ||
      preferred?.accounting?.invoiceCompany ||
      secondary?.invoiceCompany ||
      secondary?.accounting?.invoiceCompany ||
      "TSC",
    sessionId: preferred?.sessionId || secondary?.sessionId,
    clientFirstNames:
      preferred?.clientFirstNames || secondary?.clientFirstNames,
    clientName: preferred?.clientName || secondary?.clientName,
    clientEmails:
      Array.isArray(preferred?.clientEmails) && preferred.clientEmails.length
        ? preferred.clientEmails
        : secondary?.clientEmails,
    clientEmail: preferred?.clientEmail || secondary?.clientEmail,
    clientAddress: preferred?.clientAddress || secondary?.clientAddress,
    userEmail: preferred?.userEmail || secondary?.userEmail,
    eventDateISO: preferred?.eventDateISO || secondary?.eventDateISO,
    enquiryDateISO: preferred?.enquiryDateISO || secondary?.enquiryDateISO,
    bookingDateISO: preferred?.bookingDateISO || secondary?.bookingDateISO,
    grossValue:
      Number(preferred?.grossValue || 0) ||
      Number(secondary?.grossValue || 0) ||
      0,
    netCommission:
      Number(preferred?.netCommission || 0) ||
      Number(secondary?.netCommission || 0) ||
      0,
    eventType: preferred?.eventType || secondary?.eventType,
    actName: preferred?.actName || secondary?.actName,
    actTscName: preferred?.actTscName || secondary?.actTscName,
    address: preferred?.address || secondary?.address,
    county: preferred?.county || secondary?.county,
    venue: preferred?.venue || secondary?.venue,
    venueAddress: preferred?.venueAddress || secondary?.venueAddress,
    lineupSelected: preferred?.lineupSelected || secondary?.lineupSelected,
    lineupComposition:
      Array.isArray(preferred?.lineupComposition) &&
      preferred.lineupComposition.length
        ? preferred.lineupComposition
        : secondary?.lineupComposition,
    assignedMusicians:
      Array.isArray(preferred?.assignedMusicians) && preferred.assignedMusicians.length
        ? preferred.assignedMusicians
        : secondary?.assignedMusicians,
    bookingMusicians:
      Array.isArray(preferred?.bookingMusicians) && preferred.bookingMusicians.length
        ? preferred.bookingMusicians
        : secondary?.bookingMusicians,
    bandLineup:
      Array.isArray(preferred?.bandLineup) && preferred.bandLineup.length
        ? preferred.bandLineup
        : secondary?.bandLineup,
    arrivalTime: preferred?.arrivalTime || secondary?.arrivalTime,
    finishTime: preferred?.finishTime || secondary?.finishTime,
    bookingDetails: preferred?.bookingDetails || secondary?.bookingDetails,
    payments:
      Array.isArray(preferred?.payments) && preferred.payments.length
        ? preferred.payments
        : secondary?.payments,
    depositInvoice:
      preferred?.depositInvoice?.gross
        ? preferred.depositInvoice
        : secondary?.depositInvoice,
    paymentInstructions:
      preferred?.paymentInstructions?.iban ||
      preferred?.paymentInstructions?.accountNumber
        ? preferred.paymentInstructions
        : secondary?.paymentInstructions,
    balancePaid: Boolean(preferred?.balancePaid ?? secondary?.balancePaid),
    bandPaymentsSent: Boolean(
      preferred?.bandPaymentsSent ?? secondary?.bandPaymentsSent,
    ),

    paymentLink:
      preferred?.paymentLink ||
      secondary?.paymentLink ||
      preferred?.balanceInvoiceUrl ||
      secondary?.balanceInvoiceUrl ||
      "",
    invoicePdfUrl:
      preferred?.invoicePdfUrl ||
      secondary?.invoicePdfUrl ||
      preferred?.balanceInvoicePdfUrl ||
      secondary?.balanceInvoicePdfUrl ||
      "",
    balanceInvoiceUrl:
      preferred?.balanceInvoiceUrl || secondary?.balanceInvoiceUrl || "",
    balanceInvoicePdfUrl:
      preferred?.balanceInvoicePdfUrl || secondary?.balanceInvoicePdfUrl || "",

    allocation: preferred?.allocation || secondary?.allocation,
    review: preferred?.review || secondary?.review,
    eventSheet: preferred?.eventSheet || secondary?.eventSheet,
    userAddress: preferred?.userAddress || secondary?.userAddress,
    actOwnerMusicianId:
      preferred?.actOwnerMusicianId || secondary?.actOwnerMusicianId,
    actId: preferred?.actId || secondary?.actId,
    actsSummary:
      Array.isArray(preferred?.actsSummary) && preferred.actsSummary.length
        ? preferred.actsSummary
        : secondary?.actsSummary,
    performanceTimes:
      preferred?.performanceTimes || secondary?.performanceTimes,
    contractUrl: preferred?.contractUrl || secondary?.contractUrl,
    pdfUrl: preferred?.pdfUrl || secondary?.pdfUrl,
    contract: preferred?.contract || secondary?.contract,
    createdAt: preferred?.createdAt || secondary?.createdAt,
    updatedAt: preferred?.updatedAt || secondary?.updatedAt,
  };
};

const choosePreferredRow = (current, incoming) => {
  if (!current) return incoming;
  if (!incoming) return current;

  const currentHasContract = hasContractLink(current);
  const incomingHasContract = hasContractLink(incoming);

  if (incomingHasContract && !currentHasContract)
    return mergeRowData(incoming, current);
  if (currentHasContract && !incomingHasContract)
    return mergeRowData(current, incoming);

  const currentScore = scoreRowCompleteness(current);
  const incomingScore = scoreRowCompleteness(incoming);

  if (incomingScore > currentScore) return mergeRowData(incoming, current);
  if (currentScore > incomingScore) return mergeRowData(current, incoming);

  const currentUpdated =
    new Date(current?.updatedAt || current?.createdAt || 0).getTime() || 0;
  const incomingUpdated =
    new Date(incoming?.updatedAt || incoming?.createdAt || 0).getTime() || 0;

  if (incomingUpdated >= currentUpdated) return mergeRowData(incoming, current);
  return mergeRowData(current, incoming);
};

const normalizeBookingToBoardRow = (booking, actLookup = new Map()) => {
  const doc = booking?.toObject ? booking.toObject() : booking;
  if (!doc) return null;

  const eventDateISO = isoDateOnly(
    doc.eventDate || doc.date || doc.bookingDate,
  );
  const grossValue =
    Number(
      doc?.grossValue ??
        doc?.totals?.fullAmount ??
        doc?.quote?.total ??
        doc?.pricing?.total ??
        doc?.amount ??
        doc?.fee ??
        0,
    ) || 0;

  const depositValue =
    Number(
      doc?.payments?.depositChargedAmount ??
        doc?.payments?.depositAmount ??
        doc?.totals?.depositAmount ??
        doc?.quote?.deposit ??
        doc?.pricing?.deposit ??
        doc?.depositAmount ??
        0,
    ) || 0;

  const safeDeposit =
    depositValue > 0 ? depositValue : calcDepositFromGross(grossValue);
  const actSummary =
    Array.isArray(doc?.actsSummary) && doc.actsSummary.length
      ? doc.actsSummary[0]
      : null;
  const actId = actSummary?.actId || doc?.act || "";
  const actLookupKey = String(actId || "");
  const linkedAct = actLookup.get(actLookupKey) || null;
  const clientFirstNames =
    [doc?.userAddress?.firstName, doc?.userAddress?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    doc?.clientName ||
    doc?.bookerName ||
    "";

  const clientEmail =
    doc?.clientEmail || doc?.userAddress?.email || doc?.userEmail || "";

  const clientEmails = clientEmail ? [{ email: clientEmail }] : [];

  const address =
    doc?.address ||
    doc?.venueAddress ||
    doc?.venue ||
    [
      doc?.userAddress?.address1,
      doc?.userAddress?.address2,
      doc?.userAddress?.street,
      doc?.userAddress?.city,
      doc?.userAddress?.county,
      doc?.userAddress?.postcode,
    ]
      .filter(Boolean)
      .join(", ") ||
    "";

  const county =
    doc?.county ||
    doc?.userAddress?.county ||
    doc?.eventSheet?.answers?.venue_county ||
    "";
  const actName =
    actSummary?.actName ||
    actSummary?.name ||
    doc?.actName ||
    doc?.selectedAct?.name ||
    "";
  const actTscName =
    actSummary?.tscName ||
    actSummary?.name ||
    doc?.actTscName ||
    doc?.tscName ||
    doc?.selectedAct?.tscName ||
    actName ||
    "";
  const lineupSelected =
    actSummary?.lineupLabel ||
    actSummary?.lineup?.actSize ||
    doc?.lineupSelected ||
    "";
  const lineupComposition = Array.isArray(doc?.lineupComposition)
    ? doc.lineupComposition
    : Array.isArray(actSummary?.lineup?.bandMembers)
      ? actSummary.lineup.bandMembers.map((m) => m?.instrument).filter(Boolean)
      : Array.isArray(actSummary?.bandMembers)
        ? actSummary.bandMembers.map((m) => m?.instrument).filter(Boolean)
        : [];

  const rawPayments = Array.isArray(doc?.payments) ? doc.payments : [];
  const paymentsMeta = {
    depositAmount: safeDeposit,
    depositChargedAmount: safeDeposit,
    balancePaymentReceived: Boolean(doc?.balancePaid),
    bandPaymentsSent: Boolean(doc?.bandPaymentsSent),
  };

  const assignedMusicians = getRowAssignedMusicians(doc);

  const row = {
    _id: doc?._id,
    sourceBookingId: doc?._id,
    bookingRef: doc?.bookingRef || doc?.bookingId || "",
    bookingId: doc?.bookingId || doc?.bookingRef || "",
    invoiceCompany: doc?.invoiceCompany || doc?.accounting?.invoiceCompany || "TSC",
    sessionId: doc?.sessionId || "",
    clientFirstNames,
    clientEmails,
    eventDateISO,
    enquiryDateISO: isoDateOnly(doc?.createdAt || doc?.updatedAt),
    bookingDateISO: isoDateOnly(doc?.createdAt || doc?.updatedAt),
    grossValue,
    netCommission: Number(doc?.netCommission || 0) || 0,
    agent: doc?.agent || "Direct",
    eventType:
      doc?.eventType ||
      doc?.eventSheet?.answers?.event_type ||
      doc?.eventSheet?.complete?.event_type ||
      "",
    actName,
    actTscName,
    address,
    county,
    lineupSelected,
    lineupComposition,
    assignedMusicians,
    bookingMusicians: assignedMusicians,
    bandLineup: assignedMusicians,
    arrivalTime:
      doc?.arrivalTime ||
      doc?.performanceTimes?.arrivalTime ||
      actSummary?.performance?.arrivalTime ||
      "",
    finishTime:
      doc?.finishTime ||
      doc?.performanceTimes?.finishTime ||
      actSummary?.performance?.finishTime ||
      "",
    bookingDetails: {
      ...(doc?.bookingDetails || { djServicesBooked: false }),
      assignedMusicians:
        doc?.bookingDetails?.assignedMusicians?.length
          ? doc.bookingDetails.assignedMusicians
          : assignedMusicians,
    },
    payments: rawPayments.length ? rawPayments : paymentsMeta,
    accounting: doc?.accounting || null,
    depositInvoice: doc?.depositInvoice || null,
    paymentInstructions: doc?.paymentInstructions || null,
    balancePaid: Boolean(doc?.balancePaid),
    bandPaymentsSent: Boolean(doc?.bandPaymentsSent),

    paymentLink: doc?.paymentLink || doc?.balanceInvoiceUrl || "",
    invoicePdfUrl: doc?.invoicePdfUrl || doc?.balanceInvoicePdfUrl || "",
    balanceInvoiceUrl: doc?.balanceInvoiceUrl || "",
    balanceInvoicePdfUrl: doc?.balanceInvoicePdfUrl || "",

    allocation: doc?.allocation || { status: "in_progress" },
    review: doc?.review || { requestedCount: 0, received: false },
    eventSheet: doc?.eventSheet || {},
    userEmail: doc?.userEmail || "",
    userAddress: doc?.userAddress || {},
    venue: doc?.venue || "",
    venueAddress: doc?.venueAddress || "",
    actOwnerMusicianId: doc?.actOwnerMusicianId || "",
    actId,
    actsSummary: Array.isArray(doc?.actsSummary) ? doc.actsSummary : [],
    performanceTimes: doc?.performanceTimes || actSummary?.performance || {},
    contractUrl: doc?.contractUrl || "",
    pdfUrl: doc?.pdfUrl || "",
    contract: doc?.contract || null,
    actData: linkedAct
      ? {
          _id: linkedAct?._id,
          name: linkedAct?.name || "",
          tscName: linkedAct?.tscName || "",
          extras: linkedAct?.extras || {},
          paSystem: linkedAct?.paSystem || null,
          lightingSystem: linkedAct?.lightingSystem || null,
        }
      : null,
    createdAt: doc?.createdAt,
    updatedAt: doc?.updatedAt,
  };

  return row;
};

const isTSCAdmin = (user) => {
  const role = String(user?.role || "").toLowerCase();
  const email = String(user?.email || "").toLowerCase();
  return (
    ["admin", "superadmin", "tsc_admin"].includes(role) ||
    email === "hello@thesupremecollective.co.uk"
  );
};

// field-level projection by role
const adminProjection = {}; // full doc
const actOwnerProjection = {
  grossValue: 0,
  netCommission: 0,
  "visibility.grossAndCommissionVisibleToAdminOnly": 0,
};

const buildSearchClause = (q) => {
  const term = String(q || "").trim();
  if (!term) return null;

  const rx = new RegExp(escapeRegex(term), "i");

  // Only apply regex to string fields. Do not regex ObjectId fields like
  // BookingBoardItem.bookingId, because that can throw CastError and cause 500s.
  return {
    $or: [
      { clientFirstNames: rx },
      { clientName: rx },
      { bookerName: rx },
      { bookingRef: rx },
      { actName: rx },
      { actTscName: rx },
      { agent: rx },
      { county: rx },
      { address: rx },
      { clientAddress: rx },
      { eventType: rx },
      { venue: rx },
      { venueAddress: rx },
      { userEmail: rx },
      { clientEmail: rx },
      { lineupSelected: rx },
      { eventDateISO: rx },
      { enquiryDateISO: rx },
      { bookingDateISO: rx },
      { "clientEmails.email": rx },
      { "userAddress.firstName": rx },
      { "userAddress.lastName": rx },
      { "userAddress.email": rx },
      { "eventSheet.answers.venue_name": rx },
      { "eventSheet.answers.client_names": rx },
      { "eventSheet.complete.client_names": rx },
      { "actsSummary.actName": rx },
      { "actsSummary.name": rx },
      { "actsSummary.tscName": rx },
      { "actsSummary.lineupLabel": rx },
      { "actsSummary.selectedExtras.name": rx },
      { "bookingDetails.extras.name": rx },
    ],
  };
};

const buildBookingSearchClause = (q) => {
  const term = String(q || "").trim();
  if (!term) return null;

  const rx = new RegExp(escapeRegex(term), "i");

  return {
    $or: [
      { bookingId: rx },
      { bookingRef: rx },
      { clientName: rx },
      { bookerName: rx },
      { clientEmail: rx },
      { userEmail: rx },
      { actName: rx },
      { actTscName: rx },
      { eventType: rx },
      { address: rx },
      { venue: rx },
      { venueAddress: rx },
      { county: rx },
      { "userAddress.firstName": rx },
      { "userAddress.lastName": rx },
      { "userAddress.email": rx },
      { "userAddress.county": rx },
      { "eventSheet.answers.venue_name": rx },
      { "eventSheet.answers.client_names": rx },
      { "eventSheet.complete.client_names": rx },
      { "actsSummary.actName": rx },
      { "actsSummary.name": rx },
      { "actsSummary.tscName": rx },
      { "actsSummary.lineupLabel": rx },
    ],
  };
};

router.get("/mine", musicianAuth, async (req, res) => {
  try {
    const user = req.user || {};
    const userId = toObjectIdString(user?.musicianId || user?._id || user?.id);
    const email = String(user?.email || "").trim().toLowerCase();
    const fullName = String(
      user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "",
    ).trim();

    const or = [];

    if (isValidObjectId(userId)) {
      const objectId = new mongoose.Types.ObjectId(userId);
      or.push(
        { "assignedMusicians.musicianId": objectId },
        { "bookingMusicians.musicianId": objectId },
        { "bandLineup.musicianId": objectId },
        { "bookingDetails.assignedMusicians.musicianId": objectId },
      );
    }

    if (email) {
      or.push(
        { "assignedMusicians.email": email },
        { "bookingMusicians.email": email },
        { "bandLineup.email": email },
        { "bookingDetails.assignedMusicians.email": email },
      );
    }

    if (fullName) {
      const exactNameRegex = new RegExp(`^${escapeRegex(fullName)}$`, "i");
      or.push(
        { "assignedMusicians.name": exactNameRegex },
        { "bookingMusicians.name": exactNameRegex },
        { "bandLineup.name": exactNameRegex },
        { "bookingDetails.assignedMusicians.name": exactNameRegex },
      );
    }

    if (!or.length) {
      return res.status(400).json({
        success: false,
        message: "Could not identify musician from token.",
      });
    }

    const rows = await BookingBoardItem.find({ $or: or })
      .sort({ eventDateISO: 1, createdAt: -1 })
      .limit(200)
      .lean();

    return res.json({ success: true, rows, bookings: rows });
  } catch (error) {
    console.error("❌ GET /board/bookings/mine failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Could not load your gigs.",
    });
  }
});

// LIST bookings for booking board
router.get("/", musicianAuth, async (req, res) => {
  try {
    const {
  q = "",
  sortBy = "eventDateISO",
  sortDir = "asc",
} = req.query;

const limit = Math.min(Number(req.query.limit || 10000), 10000);
const page = Math.max(Number(req.query.page || 1), 1);
const skip = (page - 1) * limit;

    const user = req.user || {};
    const email = String(user?.email || "").toLowerCase();
    const isAdmin = isTSCAdmin(user);

    // Basic search on board items
    const boardQuery = {};
    const searchClause = buildSearchClause(String(q || "").trim());
    if (searchClause) Object.assign(boardQuery, searchClause);

    // Non-admins only see rows tied to them (best-effort)
    if (!isAdmin && email) {
      const boardVisibilityClause = {
        $or: [
          { userEmail: email },
          { clientEmail: email },
          { "clientEmails.email": email },
          { "assignedMusicians.email": email },
          { "bookingMusicians.email": email },
          { "bandLineup.email": email },
          { "bookingDetails.assignedMusicians.email": email },
        ],
      };

      if (boardQuery.$or) {
        boardQuery.$and = [{ $or: boardQuery.$or }, boardVisibilityClause];
        delete boardQuery.$or;
      } else {
        Object.assign(boardQuery, boardVisibilityClause);
      }
    }

   const boardRowsRaw = await BookingBoardItem.find(
  boardQuery,
  isAdmin ? adminProjection : actOwnerProjection,
)
  .sort({ eventDateISO: sortDir === "desc" ? -1 : 1 })
  .skip(skip)
  .limit(limit)
  .lean();

    // Also pull Bookings collection so manual + stripe bookings show up.
    const bookingQuery = {};
    const bookingSearchClause = buildBookingSearchClause(String(q || "").trim());
    if (bookingSearchClause) Object.assign(bookingQuery, bookingSearchClause);

    if (!isAdmin && email) {
      const bookingVisibilityClause = {
        $or: [
          { userEmail: email },
          { clientEmail: email },
          { "userAddress.email": email },
        ],
      };

      if (bookingQuery.$or) {
        bookingQuery.$and = [{ $or: bookingQuery.$or }, bookingVisibilityClause];
        delete bookingQuery.$or;
      } else {
        Object.assign(bookingQuery, bookingVisibilityClause);
      }
    }

   const bookingDocs = await Booking.find(bookingQuery)
  .sort({ eventDate: sortDir === "desc" ? -1 : 1 })
  .skip(skip)
  .limit(limit)
  .lean();

    // Dedupe/merge rows across both sources
    const dedupeMap = new Map();

    for (const row of boardRowsRaw) {
      const key = getCanonicalBookingKey(row);
      const existing = dedupeMap.get(key);
      dedupeMap.set(key, choosePreferredRow(existing, row));
    }

    for (const booking of bookingDocs) {
      const normalized = normalizeBookingToBoardRow(booking);
      if (!normalized) continue;
      const key = getCanonicalBookingKey(normalized);
      const existing = dedupeMap.get(key);
      dedupeMap.set(key, choosePreferredRow(existing, normalized));
    }

    const rows = [...dedupeMap.values()];

    // Sort
    const dir = String(sortDir).toLowerCase() === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      if (sortBy === "createdAt") {
        const aTime =
          new Date(a?.createdAt || a?.bookingDateISO || 0).getTime() || 0;
        const bTime =
          new Date(b?.createdAt || b?.bookingDateISO || 0).getTime() || 0;
        return (aTime - bTime) * dir;
      }
      // default: eventDateISO
      const aDate = new Date(a?.eventDateISO || 0).getTime() || 0;
      const bDate = new Date(b?.eventDateISO || 0).getTime() || 0;
      return (aDate - bDate) * dir;
    });

    return res.json({
  success: true,
rows,
  page,
  limit,
  hasMore: false,
});

  } catch (e) {
    console.error("❌ GET /board/bookings failed:", e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post(
  "/import-contract/preview",
  musicianAuth,
  upload.fields([
    { name: "contract", maxCount: 1 },
    { name: "invoice", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      if (!isTSCAdmin(req.user)) {
        return res.status(403).json({ success: false, message: "Admin only." });
      }
      const contractFile = req.files?.contract?.[0];
      const invoiceFile = req.files?.invoice?.[0];
      if (!contractFile) {
        return res.status(400).json({ success: false, message: "Please upload a booking or contract PDF." });
      }

      const [contractResult, invoiceResult] = await Promise.all([
        pdfParse(contractFile.buffer),
        invoiceFile ? pdfParse(invoiceFile.buffer) : Promise.resolve({ text: "" }),
      ]);
      const draft = parseBookingContract(contractResult.text, invoiceResult.text);
      draft.importMetadata.contractFilename = contractFile.originalname;
      draft.importMetadata.invoiceFilename = invoiceFile?.originalname || "";

      if (!draft.bookingRef || !draft.eventDateISO || !draft.actName) {
        return res.status(422).json({
          success: false,
          message: "I could not reliably find the booking reference, event date and artist. Please add this booking manually.",
        });
      }

      return res.json({ success: true, draft });
    } catch (error) {
      console.error("❌ contract import preview failed:", error);
      return res.status(400).json({
        success: false,
        message: error?.message || "Could not read the uploaded contract.",
      });
    }
  },
);

router.post("/", musicianAuth, async (req, res) => {
  try {
    if (!isTSCAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Admin only." });
    }

    const payload = req.body || {};
    const bookingRef = String(
      payload.bookingRef || payload.bookingId || "",
    ).trim();

    if (!bookingRef) {
      return res
        .status(400)
        .json({ success: false, message: "bookingRef is required" });
    }

    const eventDateISO = String(payload.eventDateISO || "").slice(0, 10);
    const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(eventDateISO)
      ? new Date(`${eventDateISO}T00:00:00.000Z`)
      : null;

    const clientEmail = String(
      payload.clientEmail ||
        (Array.isArray(payload.clientEmails)
          ? payload.clientEmails[0]?.email
          : "") ||
        "",
    )
      .trim()
      .toLowerCase();

    const assignedMusicians = normaliseAssignedMusicians(
      payload.assignedMusicians ||
        payload.bookingMusicians ||
        payload.bandLineup ||
        payload.bookingDetails?.assignedMusicians,
    );

    // --------- 1) Upsert Booking (source of truth) ----------
    const bookingPatch = {
      bookingId: bookingRef,
      invoiceCompany:
        String(payload.invoiceCompany || payload.accounting?.invoiceCompany || "TSC")
          .trim()
          .toUpperCase() === "BMM"
          ? "BMM"
          : "TSC",
      createdManually: true,

      // keep both; lots of older code still queries booking.date
      eventDate: eventDate || undefined,
      date: eventDate || undefined,

      clientName: String(
        payload.bookerName ||
          payload.clientFirstNames ||
          payload.clientName ||
          "",
      ).trim(),
      clientEmail: clientEmail || undefined,
      userEmail: clientEmail || undefined,
      eventType: String(payload.eventType || "").trim(),

      // money
      amount: Number(payload.grossValue || 0) || 0,
      fee: Number(payload.grossValue || 0) || 0,

      accounting: payload.accounting || undefined,

      // invoice/link mirrors
      paymentLink: String(payload.paymentLink || "").trim(),
      invoicePdfUrl: String(
        payload.invoiceUrl || payload.invoicePdfUrl || "",
      ).trim(),

      // balance fields (optional)
      balanceInvoiceUrl: String(payload.balanceInvoiceUrl || "").trim(),
      balanceInvoicePdfUrl: String(payload.balanceInvoicePdfUrl || "").trim(),

      assignedMusicians,
      bookingMusicians: assignedMusicians,
      bandLineup: assignedMusicians,
      bookingDetails: {
        ...(payload.bookingDetails || {}),
        eventType: String(payload.eventType || "").trim(),
        assignedMusicians,
      },
    };

    // remove undefined so we don’t stomp fields
    Object.keys(bookingPatch).forEach(
      (k) => bookingPatch[k] === undefined && delete bookingPatch[k],
    );

    const booking = await Booking.findOneAndUpdate(
      { bookingId: bookingRef },
      { $set: bookingPatch },
      { new: true, upsert: true },
    );

    // --------- 2) Upsert BookingBoardItem (UI row) ----------
    const boardPatch = {
      bookingId: booking._id, // ObjectId ref to Booking
      invoiceCompany:
        String(payload.invoiceCompany || payload.accounting?.invoiceCompany || "TSC")
          .trim()
          .toUpperCase() === "BMM"
          ? "BMM"
          : "TSC",

      bookerName: String(payload.bookerName || "").trim(),
      clientFirstNames: String(
        payload.clientFirstNames || payload.bookerName || "",
      ).trim(),
      bookingRef,

      eventDateISO: eventDateISO || "",
      enquiryDateISO: String(payload.enquiryDateISO || "").slice(0, 10),
      bookingDateISO: String(payload.bookingDateISO || "").slice(0, 10),

      grossValue: Number(payload.grossValue || 0) || 0,
      netCommission: Number(payload.netCommission || 0) || 0,

      agent: String(payload.agent || "Direct").trim(),

      clientEmails: clientEmail ? [{ email: clientEmail }] : [],
      clientEmail,
      clientPhone: String(payload.clientPhone || "").trim(),
      clientAddress: String(payload.clientAddress || "").trim(),
      accounting: payload.accounting || undefined,
      eventType: String(payload.eventType || "").trim(),
      actName: String(payload.actName || "").trim(),
      actTscName: String(payload.actTscName || payload.actName || "").trim(),
      address: String(payload.address || "").trim(),
      county: String(payload.county || "").trim(),

      bandSize: Number(payload.bandSize || 0) || 0,
      lineupSelected: String(payload.lineupSelected || "").trim(),
      lineupComposition: Array.isArray(payload.lineupComposition)
        ? payload.lineupComposition
        : [],
      assignedMusicians,
      bookingMusicians: assignedMusicians,
      bandLineup: assignedMusicians,

      arrivalTime: String(payload.arrivalTime || "").trim(),
      finishTime: String(payload.finishTime || "").trim(),
      performancePlan: String(payload.performancePlan || "").trim(),
      setupTime: String(payload.setupTime || "").trim(),
      changeTime: String(payload.changeTime || "").trim(),
      paymentInstructions: payload.paymentInstructions || {},
      depositInvoice: payload.depositInvoice || {},
      importMetadata: payload.importMetadata || {},

      bookingDetails: {
        ...(payload.bookingDetails || { djServicesBooked: false }),
        assignedMusicians,
      },
      allocation: payload.allocation || { status: "in_progress" },
      review: payload.review || { requestedCount: 0, received: false },

      updatedAt: new Date(),
    };

    const existingBoardRow = await BookingBoardItem.findOne({ bookingRef })
      .select("_id")
      .lean();

    const boardRow = await BookingBoardItem.findOneAndUpdate(
      { bookingRef },
      { $set: boardPatch, $setOnInsert: { createdAt: new Date() } },
      { new: true, upsert: true },
    );

    return res.json({
      success: true,
      operation: existingBoardRow ? "updated" : "created",
      row: {
        ...(boardRow?.toObject ? boardRow.toObject() : boardRow),
        sourceBookingId: booking._id, // handy for the frontend
      },
    });
  } catch (e) {
    console.error("❌ POST /board/bookings failed:", e);
    return res.status(400).json({ success: false, message: e.message });
  }
});

router.patch("/:id/mark-paid", musicianAuth, async (req, res) => {
  try {
    if (!isTSCAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Admin only." });
    }

    const row = await BookingBoardItem.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          "payments.balancePaymentReceived": true,
          updatedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Booking board row not found.",
      });
    }

    const forecast = await syncBoardRowToFinance(
      row.toObject ? row.toObject() : row,
    );

    return res.json({
      success: true,
      row,
      forecast,
    });
  } catch (error) {
    console.error("❌ mark-paid failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Could not mark booking paid.",
    });
  }
});

router.put("/:id/review", musicianAuth, async (req, res) => {
  try {
    if (!isTSCAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Admin access required." });
    }

    const comment = cleanString(req.body?.comment);
    if (!comment) {
      return res.status(400).json({ success: false, message: "Review text is required." });
    }

    const validId = mongoose.isValidObjectId(req.params.id);
    const booking = validId ? await Booking.findById(req.params.id).lean() : null;
    let boardRow = validId ? await BookingBoardItem.findById(req.params.id) : null;
    if (!boardRow && booking) {
      boardRow = await BookingBoardItem.findOne({
        $or: [
          { sourceBookingId: booking._id },
          { bookingId: booking._id },
          ...(booking.bookingId ? [{ bookingRef: booking.bookingId }] : []),
        ],
      });
    }
    if (!boardRow && !booking) {
      return res.status(404).json({ success: false, message: "Booking row not found." });
    }

    const reviewId =
      cleanString(req.body?.reviewId || boardRow?.review?.reviewId) ||
      new mongoose.Types.ObjectId().toString();
    const bookingData = booking || {};
    const actIdCandidate = cleanString(
      req.body?.actId ||
        boardRow?.actId ||
        boardRow?.actsSummary?.[0]?.actId ||
        bookingData?.actsSummary?.[0]?.actId ||
        bookingData?.act,
    );
    const actId = mongoose.isValidObjectId(actIdCandidate)
      ? new mongoose.Types.ObjectId(actIdCandidate)
      : null;

    const allocationSources = [
      boardRow?.assignedMusicians,
      boardRow?.bookingMusicians,
      boardRow?.bandLineup,
      boardRow?.bookingDetails?.assignedMusicians,
      bookingData?.assignedMusicians,
      bookingData?.bookingMusicians,
      bookingData?.bandLineup,
      bookingData?.bookingDetails?.assignedMusicians,
    ];
    const musicianIds = [
      ...new Set(
        allocationSources
          .flatMap((items) => (Array.isArray(items) ? items : []))
          .filter((item) => !item?.status || item.status === "confirmed")
          .map((item) => cleanString(item?.musicianId || item?._id))
          .filter((id) => mongoose.isValidObjectId(id)),
      ),
    ].map((id) => new mongoose.Types.ObjectId(id));

    const rating = Number(req.body?.rating);
    const sharedReview = {
      reviewId,
      clientFirstName: cleanString(req.body?.clientFirstName),
      clientLastName: cleanString(req.body?.clientLastName),
      clientEmail: cleanString(req.body?.clientEmail).toLowerCase(),
      rating: rating >= 1 && rating <= 5 ? rating : undefined,
      comment,
      eventType: cleanString(req.body?.eventType || boardRow?.eventType),
      eventLocation: cleanString(req.body?.eventLocation || boardRow?.county || boardRow?.address),
      eventDate: req.body?.eventDate || boardRow?.eventDateISO || bookingData?.eventDate || bookingData?.date || undefined,
      eventMedia: Array.isArray(req.body?.eventMedia) ? req.body.eventMedia.filter(Boolean) : [],
      verified: true,
      source: "booking",
      bookingBoardItemId: boardRow?._id,
      bookingId: booking?._id || boardRow?.bookingId,
      actId: actId || undefined,
      createdAt: boardRow?.review?.receivedAt || new Date(),
    };
    const profileReview = { ...sharedReview };
    delete profileReview.clientEmail;

    if (boardRow) {
      boardRow.review = {
        ...(boardRow.review?.toObject ? boardRow.review.toObject() : boardRow.review || {}),
        ...sharedReview,
        source: "internal",
        received: true,
        receivedAt: new Date(),
        linkedActId: actId || undefined,
        linkedMusicianIds: musicianIds,
      };
      await boardRow.save();
    }

    await actModel.updateMany(
      { "reviews.reviewId": reviewId },
      { $pull: { reviews: { reviewId } } },
    );
    await musicianModel.updateMany(
      { "reviews.reviewId": reviewId },
      { $pull: { reviews: { reviewId } } },
    );

    if (actId) {
      await actModel.updateOne(
        { _id: actId },
        { $push: { reviews: profileReview } },
      );
    }
    if (musicianIds.length) {
      await musicianModel.updateMany(
        { _id: { $in: musicianIds } },
        { $push: { reviews: profileReview } },
      );
    }

    return res.json({
      success: true,
      row: boardRow,
      linkedAct: Boolean(actId),
      linkedMusicianCount: musicianIds.length,
    });
  } catch (error) {
    console.error("❌ booking review save failed", error);
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.patch("/:id", musicianAuth, async (req, res) => {
  console.log("🟡 PATCH /board/bookings/:id", {
    id: req.params.id,
    body: req.body,
  });
  try {
    const rawBody = { ...req.body };
    const body = { ...rawBody, updatedAt: new Date() };
    if (body.invoiceCompany || body.accounting?.invoiceCompany) {
      const invoiceCompany =
        String(body.invoiceCompany || body.accounting?.invoiceCompany || "TSC")
          .trim()
          .toUpperCase() === "BMM"
          ? "BMM"
          : "TSC";

      body.invoiceCompany = invoiceCompany;
      body.accounting = {
        ...(body.accounting || {}),
        invoiceCompany,
      };
    }

    // --- EXTRAS & MANUAL ADJUSTMENT PATCH LOGIC ---
    if (Array.isArray(body.extras)) {
      body.extras = body.extras.map((extra) => ({
        ...extra,
        quantity: Number(extra?.quantity || 1) || 1,
        price: Number(extra?.price || 0) || 0,
        appliedMinutes: Number(extra?.appliedMinutes || 0) || 0,
        billableMemberCount: Number(extra?.billableMemberCount || 0) || 0,
      }));
    }

    if (body.manualAdjustmentAmount !== undefined || body.manualAdjustmentLabel !== undefined) {
      body.manualAdjustment = {
        label: String(body.manualAdjustmentLabel || body.manualAdjustment?.label || ""),
        amount: Number(body.manualAdjustmentAmount ?? body.manualAdjustment?.amount ?? 0) || 0,
      };
    }

    if (Array.isArray(body.extras) || body.manualAdjustment) {
      body.bookingDetails = {
        ...(body.bookingDetails || {}),
        ...(Array.isArray(body.extras) ? { extras: body.extras } : {}),
        ...(body.manualAdjustment ? { manualAdjustment: body.manualAdjustment } : {}),
      };
    }

    if (Array.isArray(body.assignedMusicians)) {
      body.assignedMusicians = normaliseAssignedMusicians(body.assignedMusicians);
      body.bookingMusicians = body.assignedMusicians;
      body.bandLineup = body.assignedMusicians;
      body.bookingDetails = {
        ...(body.bookingDetails || {}),
        assignedMusicians: body.assignedMusicians,
      };
    }

    const isAdmin = isTSCAdmin(req.user);

    // Non-admins can only do lightweight row edits
    if (!isAdmin) {
      delete body.grossValue;
      delete body.netCommission;
      delete body.totals;
      delete body.balanceAmountPence;
      delete body.amount;
      delete body.fee;
      delete body.actsSummary;
      delete body.performanceTimes;
      delete body.bookingDetails;
      delete body.accounting;
      delete body.invoiceCompany;
      delete body.extras;
      delete body.manualAdjustment;
      delete body.manualAdjustmentLabel;
      delete body.manualAdjustmentAmount;
      delete body.assignedMusicians;
      delete body.bookingMusicians;
      delete body.bandLineup;
    }

    // First try: treat :id as a real Booking _id
    const bookingDoc = await Booking.findById(req.params.id);
    console.log("🟡 PATCH target:", {
      foundBooking: Boolean(bookingDoc),
      id: req.params.id,
    });
    if (bookingDoc) {
      if (!isAdmin) {
        const reqMusicianId = toObjectIdString(
          req.user?.musicianId || req.user?._id || req.user?.id,
        );
        const reqEmail = String(req.user?.email || "").toLowerCase();

        const bookingEmails = [
          String(bookingDoc?.userEmail || "").toLowerCase(),
          String(bookingDoc?.clientEmail || "").toLowerCase(),
          String(bookingDoc?.userAddress?.email || "").toLowerCase(),
        ].filter(Boolean);

        const rowOwnerIds = [
          toObjectIdString(bookingDoc?.actOwnerMusicianId),
          toObjectIdString(bookingDoc?.userId),
        ].filter(Boolean);

        const canEditOwnBooking =
          (reqMusicianId && rowOwnerIds.includes(reqMusicianId)) ||
          (reqEmail && bookingEmails.includes(reqEmail));

        if (!canEditOwnBooking) {
          return res.status(403).json({
            success: false,
            message: "You can only edit bookings visible to your own account.",
          });
        }
      }

      const savedBooking = await applyBookingPatch(bookingDoc, body);
      const savedBookingDoc = savedBooking?.toObject
        ? savedBooking.toObject()
        : savedBooking;
      const firstAct =
        Array.isArray(savedBookingDoc?.actsSummary) &&
        savedBookingDoc.actsSummary.length
          ? savedBookingDoc.actsSummary[0]
          : null;
      const savedActId = String(
        firstAct?.actId || savedBookingDoc?.act || "",
      ).trim();
      const savedAct = savedActId
        ? await actModel
            .findById(savedActId)
            .select("_id name tscName extras paSystem lightingSystem")
            .lean()
        : null;
      const normalized = normalizeBookingToBoardRow(
        savedBooking,
        new Map(savedAct ? [[String(savedAct._id), savedAct]] : []),
      );

      const mirrorPatch = {
        updatedAt: new Date(),
        ...(body.eventDateISO !== undefined || body.eventDate !== undefined || body.date !== undefined
          ? { eventDateISO: isoDateOnly(savedBooking?.eventDate || savedBooking?.date) }
          : {}),
        ...(body.bookingDateISO !== undefined
          ? { bookingDateISO: String(body.bookingDateISO || "").slice(0, 10) }
          : {}),
        ...(body.enquiryDateISO !== undefined
          ? { enquiryDateISO: String(body.enquiryDateISO || "").slice(0, 10) }
          : {}),
        ...(body.agent !== undefined ? { agent: body.agent } : {}),
        ...(body.actName !== undefined ? { actName: body.actName } : {}),
        ...(body.actTscName !== undefined ? { actTscName: body.actTscName } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.county !== undefined ? { county: body.county } : {}),
        ...(body.lineupSelected !== undefined ? { lineupSelected: body.lineupSelected } : {}),
        ...(body.bandSize !== undefined ? { bandSize: Number(body.bandSize || 0) || 0 } : {}),
        ...(body.arrivalTime !== undefined ? { arrivalTime: body.arrivalTime } : {}),
        ...(body.finishTime !== undefined ? { finishTime: body.finishTime } : {}),
        ...(body.clientFirstNames !== undefined
          ? { clientFirstNames: String(body.clientFirstNames || "").trim() }
          : {}),
        eventType:
          body.eventType !== undefined
            ? String(body.eventType || "").trim()
            : normalized?.eventType || savedBooking?.eventType || "",
        grossValue:
          Number(
            savedBooking?.totals?.fullAmount ||
              savedBooking?.amount ||
              savedBooking?.fee ||
              0,
          ) || 0,

        clientAddress: body.clientAddress || savedBooking?.clientAddress || "",
        clientEmail: body.clientEmail || savedBooking?.clientEmail || "",
        clientEmails: body.clientEmails || [],
        assignedMusicians:
          body.assignedMusicians || normalized?.assignedMusicians || [],
        bookingMusicians:
          body.bookingMusicians || normalized?.bookingMusicians || [],
        bandLineup: body.bandLineup || normalized?.bandLineup || [],
        accounting: savedBooking?.accounting || body.accounting || {},
        invoiceCompany:
          savedBooking?.invoiceCompany ||
          savedBooking?.accounting?.invoiceCompany ||
          body.invoiceCompany ||
          body.accounting?.invoiceCompany ||
          "TSC",

        bookingDetails: {
          ...(normalized?.bookingDetails || savedBooking?.bookingDetails || {}),
          ...(Array.isArray(body.extras) ? { extras: body.extras } : {}),
          ...(body.manualAdjustment ? { manualAdjustment: body.manualAdjustment } : {}),
          ...(body.assignedMusicians
            ? { assignedMusicians: body.assignedMusicians }
            : {}),
        },
        extras: Array.isArray(body.extras)
          ? body.extras
          : Array.isArray(savedBooking?.extras)
            ? savedBooking.extras
            : Array.isArray(savedBooking?.bookingDetails?.extras)
              ? savedBooking.bookingDetails.extras
              : [],
        manualAdjustment:
          body.manualAdjustment ||
          savedBooking?.manualAdjustment ||
          savedBooking?.bookingDetails?.manualAdjustment ||
          { label: "", amount: 0 },
        manualAdjustmentLabel:
          body.manualAdjustment?.label ||
          savedBooking?.manualAdjustment?.label ||
          savedBooking?.bookingDetails?.manualAdjustment?.label ||
          "",
        manualAdjustmentAmount:
          Number(
            body.manualAdjustment?.amount ||
              savedBooking?.manualAdjustment?.amount ||
              savedBooking?.bookingDetails?.manualAdjustment?.amount ||
              0,
          ) || 0,
        actsSummary: Array.isArray(savedBooking?.actsSummary)
          ? savedBooking.actsSummary
          : [],
        performanceTimes: savedBooking?.performanceTimes || {},
        balancePaid: Boolean(savedBooking?.balancePaid),
        bandPaymentsSent: Boolean(savedBooking?.bandPaymentsSent),
        finishTime: normalized?.finishTime || "",
        arrivalTime: normalized?.arrivalTime || "",
        pdfUrl: savedBooking?.pdfUrl || "",
        contractUrl: savedBooking?.contractUrl || "",
      };

      const mirrorResult = await BookingBoardItem.updateMany(
        {
          $or: [
            { sourceBookingId: savedBooking._id },
            { bookingRef: savedBooking.bookingId },
            ...(savedBooking.sessionId
              ? [{ sessionId: savedBooking.sessionId }]
              : []),
          ],
        },
        { $set: mirrorPatch },
      );

      console.log("🟢 Board mirror update result:", mirrorResult);

      return res.json({
        success: true,
        row: normalized,
        source: "booking",
      });
    }

    // Fallback: plain manual BookingBoardItem row
    if (!isAdmin) {
      const existingRow = await BookingBoardItem.findById(req.params.id)
        .select("actOwnerMusicianId userEmail clientEmails")
        .lean();

      const reqMusicianId = toObjectIdString(
        req.user?.musicianId || req.user?._id || req.user?.id,
      );
      const reqEmail = String(req.user?.email || "").toLowerCase();
      const rowOwnerId = toObjectIdString(existingRow?.actOwnerMusicianId);

      const rowEmails = [
        String(existingRow?.userEmail || "").toLowerCase(),
        ...(Array.isArray(existingRow?.clientEmails)
          ? existingRow.clientEmails
          : []
        ).map((e) => String(e?.email || "").toLowerCase()),
      ].filter(Boolean);

      const canEditOwnRow =
        (reqMusicianId && rowOwnerId && reqMusicianId === rowOwnerId) ||
        (reqEmail && rowEmails.includes(reqEmail));

      if (!canEditOwnRow) {
        return res.status(403).json({
          success: false,
          message:
            "You can only edit booking board rows visible to your own account.",
        });
      }
    }

    const { bookingDetails: bodyBookingDetails, ...bodyWithoutBookingDetails } = body;

    const bookingDetailsPatch = {
      ...(bodyBookingDetails || {}),
      ...(Array.isArray(body.extras) ? { extras: body.extras } : {}),
      ...(body.manualAdjustment
        ? { manualAdjustment: body.manualAdjustment }
        : {}),
    };

    const row = await BookingBoardItem.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          ...bodyWithoutBookingDetails,
          ...(Object.keys(bookingDetailsPatch).length
            ? { bookingDetails: bookingDetailsPatch }
            : {}),
        },
      },
      { new: true },
    );

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Booking board row not found.",
      });
    }

    return res.json({
      success: true,
      row,
      source: "board",
    });
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: e.message,
    });
  }
});

const syncBoardRowToFinance = async (row) => {
  const eventDateISO = String(row.eventDateISO || "").slice(0, 10);
  const eventMonth = eventDateISO ? eventDateISO.slice(0, 7) : "";

  const grossValue = round2(row.grossValue || 0);
  const depositPaid = round2(
    row?.payments?.depositChargedAmount ||
      row?.payments?.depositAmount ||
      row?.depositAmount ||
      0,
  );

  const acc = row.accounting || {};
  const commissionGross = round2(acc.commissionGross || depositPaid || 0);
  const commissionVat = round2(
    acc.commissionVat || commissionGross * (0.2 / 1.2),
  );
  const commissionNet = round2(
    acc.commissionNet || commissionGross - commissionVat,
  );
  const passThroughGross = round2(
    acc.passThroughGross || Math.max(grossValue - commissionGross, 0),
  );

  const balanceDue = round2(Math.max(grossValue - depositPaid, 0));
  const expectedBalanceDueDateISO = getThursdayWeekBefore(eventDateISO);

  const payload = {
    boardRowId: row._id,
    sourceBookingId: row.bookingId || row.sourceBookingId || null,
    bookingRef: row.bookingRef || String(row._id),
    invoiceCompany: row.invoiceCompany || row.accounting?.invoiceCompany || "TSC",
    clientName: row.clientFirstNames || row.clientName || row.bookerName || "",
    clientEmail:
      row?.clientEmails?.find?.((e) => e?.email)?.email ||
      row.clientEmail ||
      row.userEmail ||
      "",
    eventDateISO,
    eventMonth,
    agent: row.agent || "",
    actName: row.actName || "",
    actTscName: row.actTscName || "",
    grossValue,
    commissionGross,
    commissionVat,
    commissionNet,
    passThroughGross,
    depositPaid,
    balanceDue,
    expectedCashDateISO: expectedBalanceDueDateISO || eventDateISO,
    expectedBalanceDueDateISO,
    status:
      row?.payments?.balancePaymentReceived || row?.balancePaid
        ? "paid"
        : depositPaid > 0
          ? "balance_due"
          : "forecast",
    source: "booking_board",
    rawSnapshot: row,
  };

  return financeForecastBookingModel.findOneAndUpdate(
    {
      $or: [{ boardRowId: row._id }, { bookingRef: payload.bookingRef }],
    },
    { $set: payload },
    { new: true, upsert: true },
  );
};

router.post("/bulk-import-csv", musicianAuth, async (req, res) => {
  try {
    if (!isTSCAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Admin only." });
    }

    const { csv } = req.body || {};

    if (!csv || typeof csv !== "string") {
      return res.status(400).json({
        success: false,
        message: "CSV string is required in req.body.csv",
      });
    }

    const records = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });

    if (!records.length) {
      return res.status(400).json({
        success: false,
        message: "CSV had no rows.",
      });
    }

    const results = [];
    const errors = [];
    let syncedToFinance = 0;

    for (const [index, row] of records.entries()) {
      try {
        const bookingRef = String(
          row.bookingRef ||
            row["Booking Ref"] ||
            row["Reference"] ||
            row.ref ||
            "",
        ).trim();

        if (!bookingRef) {
          throw new Error("Missing bookingRef / Booking Ref");
        }

        const grossValue =
          Number(row.grossValue || row["Gross"] || row["Gross Value"] || 0) ||
          0;

        const commissionGross =
          Number(row.commissionGross || row["Commission"] || 0) || 0;

        const passThroughGross =
          Number(
            row.passThroughGross ||
              row["Pass-through"] ||
              row["Band Fee"] ||
              Math.max(grossValue - commissionGross, 0),
          ) || 0;

        const vatRate = Number(row.vatRate || row["VAT Rate"] || 0.2) || 0.2;
        const { vat: commissionVat, net: commissionNet } =
          calcVatFromVatInclusiveGross(commissionGross, vatRate);

        const email = String(
          row.clientEmail || row["Client Email"] || row.email || "",
        ).trim();

        const boardPatch = {
          bookingRef,

          invoiceCompany:
            String(row.invoiceCompany || row["Invoice Company"] || "TSC")
              .trim()
              .toUpperCase() === "BMM"
              ? "BMM"
              : "TSC",

          bookerName: String(row.bookerName || row["Booker Name"] || "").trim(),
          clientFirstNames: String(
            row.clientFirstNames ||
              row["Client Name"] ||
              row["Client First Names"] ||
              "",
          ).trim(),

          clientEmails: email ? [{ email }] : [],
          clientAddress: String(
            row.clientAddress || row["Client Address"] || "",
          ).trim(),

          eventDateISO: normaliseDate(row.eventDateISO || row["Event Date"]),
          enquiryDateISO: String(
            row.enquiryDateISO || row["Enquiry Date"] || "",
          ).slice(0, 10),
          bookingDateISO: String(
            row.bookingDateISO || row["Booking Date"] || "",
          ).slice(0, 10),

          grossValue,
          agent: String(row.agent || row["Agent"] || "Direct").trim(),

          eventType: String(row.eventType || row["Event Type"] || "").trim(),
          actName: String(row.actName || row["Act"] || "").trim(),
          actTscName: String(
            row.actTscName || row["Act TSC Name"] || row["TSC Name"] || "",
          ).trim(),

          address: String(row.address || row["Venue Address"] || "").trim(),
          county: String(row.county || row["County"] || "").trim(),

          lineupSelected: String(
            row.lineupSelected || row["Lineup"] || "",
          ).trim(),
          arrivalTime: String(row.arrivalTime || row["Arrival"] || "").trim(),
          finishTime: String(row.finishTime || row["Finish"] || "").trim(),

          paymentLink: String(
            row.paymentLink || row["Payment Link"] || "",
          ).trim(),
          invoiceUrl: String(row.invoiceUrl || row["Invoice URL"] || "").trim(),
          invoicePdfUrl: String(
            row.invoicePdfUrl || row["Invoice PDF URL"] || "",
          ).trim(),

          accounting: {
            invoiceCompany:
              String(row.invoiceCompany || row["Invoice Company"] || "TSC")
                .trim()
                .toUpperCase() === "BMM"
                ? "BMM"
                : "TSC",
            paymentStage: "",
            vatRate,
            commissionGross: round2(commissionGross),
            commissionVat,
            commissionNet,
            passThroughGross: round2(passThroughGross),
            currency: "GBP",
          },

          payments: {
            depositAmount:
              Number(row.depositPaid || row["Deposit Paid"] || 0) || 0,
            depositChargedAmount:
              Number(row.depositPaid || row["Deposit Paid"] || 0) || 0,
            balancePaymentReceived: false,
            bandPaymentsSent: false,
          },

          assignedMusicians: [],
          bookingMusicians: [],
          bandLineup: [],

          bookingDetails: {
            eventType: String(row.eventType || row["Event Type"] || "").trim(),
            evening: { sets: [] },
            djServicesBooked:
              String(row.djServicesBooked || row["DJ"] || "")
                .trim()
                .toLowerCase() === "yes",
            assignedMusicians: [],
          },

          allocation: { status: "in_progress", gaps: [] },
          review: { requestedCount: 0, received: false, source: "internal" },
          updatedAt: new Date(),
        };

        const saved = await BookingBoardItem.findOneAndUpdate(
          { bookingRef },
          { $set: boardPatch, $setOnInsert: { createdAt: new Date() } },
          { new: true, upsert: true },
        );

        const forecast = await syncBoardRowToFinance(
          saved.toObject ? saved.toObject() : saved,
        );

        results.push(saved);
        syncedToFinance += forecast ? 1 : 0;
      } catch (err) {
        errors.push({
          row: index + 2,
          error: err.message,
          raw: row,
        });
      }
    }

    return res.json({
      success: errors.length === 0,
      imported: results.length,
      syncedToFinance,
      failed: errors.length,
      errors,
      rows: results,
    });
  } catch (error) {
    console.error("❌ bulk-import-csv failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "CSV import failed.",
    });
  }
});

router.post(
  "/bulk-import-csv-file",
  musicianAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!isTSCAdmin(req.user)) {
        return res.status(403).json({ success: false, message: "Admin only." });
      }

      if (!req.file?.buffer) {
        return res.status(400).json({
          success: false,
          message: "Upload a CSV file using form field name: file",
        });
      }

      const csv = req.file.buffer.toString("utf8");

      const records = parse(csv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });

      const usableRecords = records.filter(looksLikeRealBookingRow);
const results = [];
const errors = [];
let syncedToFinance = 0;

for (const [index, row] of usableRecords.entries()) {
  try {
    const bookingRef =
      cleanString(row.bookingRef) ||
      cleanString(row.Reference) ||
      `IMPORT-${normaliseDate(row.eventDateISO)}-${cleanString(row.clientFirstNames)
        .replace(/\s+/g, "-")
        .toUpperCase()}`;

    const grossValue = toNumber(
      row.grossValue || row["Subtotal (after deposit taken) / Balance"]
    );

    const commissionGross = toNumber(
      row.commissionGross || row["Musican Fee on gig"]
    );

    const passThroughGross = toNumber(
      row.passThroughGross || row.Travel || Math.max(grossValue - commissionGross, 0)
    );

    const vatRate = 0.2;
    const { vat: commissionVat, net: commissionNet } =
      calcVatFromVatInclusiveGross(commissionGross, vatRate);

    const boardPatch = {
      bookingRef,
      invoiceCompany:
        String(row.invoiceCompany || row["Invoice Company"] || "TSC")
          .trim()
          .toUpperCase() === "BMM"
          ? "BMM"
          : "TSC",
      clientFirstNames: cleanString(row.clientFirstNames),
      eventDateISO: normaliseDate(row.eventDateISO),
      bookingDateISO: normaliseDate(row.bookingDateISO),
      enquiryDateISO: normaliseDate(row.enquiryDateISO),

      agent: cleanString(row.agent || "Direct"),
      eventType: cleanString(row.eventType),
      actName: cleanString(row.actName),
      county: cleanString(row.county),
      address: cleanString(row.address),

      grossValue,

      accounting: {
        invoiceCompany:
          String(row.invoiceCompany || row["Invoice Company"] || "TSC")
            .trim()
            .toUpperCase() === "BMM"
            ? "BMM"
            : "TSC",
        paymentStage: "",
        vatRate,
        commissionGross: round2(commissionGross),
        commissionVat,
        commissionNet,
        passThroughGross: round2(passThroughGross),
        currency: "GBP",
      },

      payments: {
        depositAmount: 0,
        depositChargedAmount: 0,
        balancePaymentReceived: false,
        bandPaymentsSent: false,
      },

      assignedMusicians: [],
      bookingMusicians: [],
      bandLineup: [],

      bookingDetails: {
        eventType: cleanString(row.eventType),
        evening: { sets: [] },
        djServicesBooked: false,
        assignedMusicians: [],
      },

      allocation: { status: "in_progress", gaps: [] },
      review: { requestedCount: 0, received: false, source: "internal" },
      updatedAt: new Date(),
    };

    const saved = await BookingBoardItem.findOneAndUpdate(
      { bookingRef },
      { $set: boardPatch, $setOnInsert: { createdAt: new Date() } },
      { new: true, upsert: true }
    );

    const forecast = await syncBoardRowToFinance(
      saved.toObject ? saved.toObject() : saved
    );

    results.push(saved);
    syncedToFinance += forecast ? 1 : 0;
  } catch (err) {
    errors.push({
      row: index + 2,
      error: err.message,
      raw: row,
    });
  }
}

return res.json({
  success: errors.length === 0,
  totalRowsInCsv: records.length,
  usableRows: usableRecords.length,
  skippedRows: records.length - usableRecords.length,
  imported: results.length,
  syncedToFinance,
  failed: errors.length,
  errors,
  preview: results.slice(0, 5),
});

    } catch (error) {
      console.error("❌ bulk-import-csv-file failed:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "CSV file import failed.",
      });
    }
  }
);

router.post("/bulk-import", musicianAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.bookings)
      ? req.body.bookings
      : Array.isArray(req.body)
        ? req.body
        : [];

    if (!items.length) {
      return res.status(400).json({
        success: false,
        message: "Send an array of bookings, or { bookings: [...] }.",
      });
    }

    const results = [];
    const errors = [];

    for (const [index, item] of items.entries()) {
      try {
        const row = normaliseImportRow(item);

        if (!row.bookingRef) {
          throw new Error("Missing bookingRef/ref/reference.");
        }

        const saved = await BookingBoardItem.findOneAndUpdate(
          { bookingRef: row.bookingRef },
          {
            $set: row,
            $setOnInsert: { createdAt: new Date() },
          },
          { new: true, upsert: true },
        );

        results.push(saved);
      } catch (error) {
        errors.push({
          index,
          bookingRef: item?.bookingRef || item?.ref || "",
          error: error.message,
        });
      }
    }

    return res.json({
      success: true,
      imported: results.length,
      failed: errors.length,
      errors,
      rows: results,
    });
  } catch (error) {
    console.error("❌ POST /board/bookings/bulk-import failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Bulk import failed.",
    });
  }
});

router.delete("/:id", musicianAuth, async (req, res) => {
  try {
    if (!isTSCAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Admin only." });
    }

    const row = await BookingBoardItem.findByIdAndDelete(req.params.id).lean();

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Booking board row not found.",
      });
    }

    await financeForecastBookingModel.deleteMany({
      $or: [
        { boardRowId: row._id },
        { bookingRef: row.bookingRef },
      ],
    });

    return res.json({
      success: true,
      deletedBoardRowId: row._id,
      bookingRef: row.bookingRef,
    });
  } catch (error) {
    console.error("❌ DELETE /board/bookings/:id failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Could not delete booking.",
    });
  }
});

export default router;

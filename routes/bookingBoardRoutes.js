// routes/bookingBoardRoutes.js

import express from "express";
import BookingBoardItem from "../models/bookingBoardItem.js";
import Booking from "../models/bookingModel.js";
import actModel from "../models/actModel.js";
import musicianAuth from "../middleware/musicianAuth.js";
import { parse } from "csv-parse/sync";
import financeForecastBookingModel from "../models/financeForecastBookingModel.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  return Number(String(value).replace(/[£,]/g, "").trim()) || 0;
};

const cleanString = (value) => String(value || "").trim();

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

  return {
    bookingRef,
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

  if (patch.accounting && isPlainObject(patch.accounting)) {
    patch.accounting = {
      ...patch.accounting,

      vatRate: Number(patch.accounting.vatRate ?? 0.2) || 0.2,

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

  if (patch.notes !== undefined) {
    bookingDoc.notes = patch.notes;
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
    arrivalTime: preferred?.arrivalTime || secondary?.arrivalTime,
    finishTime: preferred?.finishTime || secondary?.finishTime,
    bookingDetails: preferred?.bookingDetails || secondary?.bookingDetails,
    payments:
      Array.isArray(preferred?.payments) && preferred.payments.length
        ? preferred.payments
        : secondary?.payments,
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

  const row = {
    _id: doc?._id,
    sourceBookingId: doc?._id,
    bookingRef: doc?.bookingRef || doc?.bookingId || "",
    bookingId: doc?.bookingId || doc?.bookingRef || "",
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
    bookingDetails: doc?.bookingDetails || { djServicesBooked: false },
    payments: rawPayments.length ? rawPayments : paymentsMeta,
    accounting: doc?.accounting || null,
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
  if (!q) return null;
  const rx = new RegExp(escapeRegex(q), "i");
  return {
    $or: [
      { clientFirstNames: rx },
      { bookingRef: rx },
      { bookingId: rx },
      { actName: rx },
      { actTscName: rx },
      { county: rx },
      { address: rx },
      { eventType: rx },
      { venue: rx },
      { venueAddress: rx },
      { userEmail: rx },
      { clientEmail: rx },
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

// LIST bookings for booking board
router.get("/", musicianAuth, async (req, res) => {
  try {
    const {
      q = "",
      sortBy = "eventDateISO",
      sortDir = "asc",
      limit = 500,
    } = req.query;

    const user = req.user || {};
    const email = String(user?.email || "").toLowerCase();
    const isAdmin = isTSCAdmin(user);

    // Basic search on board items
    const boardQuery = {};
    const searchClause = buildSearchClause(String(q || "").trim());
    if (searchClause) Object.assign(boardQuery, searchClause);

    // Non-admins only see rows tied to them (best-effort)
    if (!isAdmin && email) {
      boardQuery.$or = [
        { userEmail: email },
        { clientEmail: email },
        { "clientEmails.email": email },
      ];
    }

    const boardRowsRaw = await BookingBoardItem.find(
      boardQuery,
      isAdmin ? adminProjection : actOwnerProjection,
    )
      .limit(Number(limit) || 500)
      .lean();

    // Also pull Bookings collection so manual + stripe bookings show up.
    const bookingQuery = {};
    if (!isAdmin && email) {
      bookingQuery.$or = [
        { userEmail: email },
        { clientEmail: email },
        { "userAddress.email": email },
      ];
    }

    const bookingDocs = await Booking.find(bookingQuery)
      .limit(Number(limit) || 500)
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
      rows: rows.slice(0, Number(limit) || 500),
    });
  } catch (e) {
    console.error("❌ GET /board/bookings failed:", e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

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

    // --------- 1) Upsert Booking (source of truth) ----------
    const bookingPatch = {
      bookingId: bookingRef,
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

      arrivalTime: String(payload.arrivalTime || "").trim(),
      finishTime: String(payload.finishTime || "").trim(),

      bookingDetails: payload.bookingDetails || { djServicesBooked: false },
      allocation: payload.allocation || { status: "in_progress" },
      review: payload.review || { requestedCount: 0, received: false },

      updatedAt: new Date(),
    };

    const boardRow = await BookingBoardItem.findOneAndUpdate(
      { bookingRef },
      { $set: boardPatch, $setOnInsert: { createdAt: new Date() } },
      { new: true, upsert: true },
    );

    return res.json({
      success: true,
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

router.patch("/:id", musicianAuth, async (req, res) => {
  console.log("🟡 PATCH /board/bookings/:id", {
    id: req.params.id,
    body: req.body,
  });
  try {
    const rawBody = { ...req.body };
    const body = { ...rawBody, updatedAt: new Date() };
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
        accounting: savedBooking?.accounting || body.accounting || {},

        bookingDetails:
          normalized?.bookingDetails || savedBooking?.bookingDetails || {},
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

    const row = await BookingBoardItem.findByIdAndUpdate(
      req.params.id,
      { $set: body },
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

          bookingDetails: {
            eventType: String(row.eventType || row["Event Type"] || "").trim(),
            evening: { sets: [] },
            djServicesBooked:
              String(row.djServicesBooked || row["DJ"] || "")
                .trim()
                .toLowerCase() === "yes",
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

      bookingDetails: {
        eventType: cleanString(row.eventType),
        evening: { sets: [] },
        djServicesBooked: false,
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

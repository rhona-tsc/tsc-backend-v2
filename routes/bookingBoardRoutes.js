import express from "express";
import BookingBoardItem from "../models/bookingBoardItem.js";
import Booking from "../models/bookingModel.js";
import musicianAuth from "../middleware/musicianAuth.js";

const router = express.Router();

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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


const calcDepositFromGross = (grossValue) => {
  const gross = Number(grossValue || 0);
  if (!gross) return 0;
  const n = Math.ceil((gross - 50) * 0.2) + 50;
  return n > 0 ? n : 0;
};

const hasContractLink = (row) => {
  const url = row?.contractUrl || row?.pdfUrl || row?.contract?.url || row?.contract?.href || "";
  return Boolean(String(url || "").trim());
};

const hasEventSheetContent = (row) => {
  return Boolean(
    row?.eventSheet?.submitted ||
    (row?.eventSheet?.answers && Object.keys(row.eventSheet.answers).length) ||
    (row?.eventSheet?.complete && Object.keys(row.eventSheet.complete).length)
  );
};

const getRowClientEmail = (row) => {
  if (Array.isArray(row?.clientEmails) && row.clientEmails.length) {
    return String(row.clientEmails.find((e) => e?.email)?.email || "").trim().toLowerCase();
  }
  return String(row?.clientEmail || row?.userAddress?.email || row?.userEmail || "").trim().toLowerCase();
};

const getRowClientName = (row) => {
  return String(
    row?.clientFirstNames ||
    row?.clientName ||
    row?.bookerName ||
    [row?.userAddress?.firstName, row?.userAddress?.lastName].filter(Boolean).join(" ") ||
    ""
  ).trim().toLowerCase();
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
    ""
  ).trim().toLowerCase();
};

const getRowEventDateKey = (row) => {
  return String(row?.eventDateISO || isoDateOnly(row?.date || row?.eventDate || row?.bookingDate) || "").slice(0, 10);
};

const getCanonicalBookingKey = (row) => {
  const sessionId = String(row?.sessionId || "").trim().toLowerCase();
  if (sessionId) return `session:${sessionId}`;

  const bookingId = String(row?.bookingId || row?.bookingRef || "").trim().toLowerCase();
  if (bookingId) return `booking:${bookingId}`;

  const email = getRowClientEmail(row);
  const dateKey = getRowEventDateKey(row);
  const actKey = getRowActKey(row);
  const nameKey = getRowClientName(row);
  return `fallback:${email}|${dateKey}|${actKey}|${nameKey}`;
};

const scoreRowCompleteness = (row) => {
  const gross = Number(row?.grossValue || row?.totals?.fullAmount || row?.amount || row?.fee || 0) || 0;
  const deposit = Number(
    row?.payments?.depositChargedAmount ??
    row?.payments?.depositAmount ??
    row?.totals?.depositAmount ??
    row?.depositAmount ??
    0
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
    Boolean(row?.performanceTimes?.startTime || row?.performanceTimes?.arrivalTime || row?.arrivalTime),
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
    clientFirstNames: preferred?.clientFirstNames || secondary?.clientFirstNames,
    clientName: preferred?.clientName || secondary?.clientName,
    clientEmails: Array.isArray(preferred?.clientEmails) && preferred.clientEmails.length
      ? preferred.clientEmails
      : secondary?.clientEmails,
    clientEmail: preferred?.clientEmail || secondary?.clientEmail,
    userEmail: preferred?.userEmail || secondary?.userEmail,
    eventDateISO: preferred?.eventDateISO || secondary?.eventDateISO,
    enquiryDateISO: preferred?.enquiryDateISO || secondary?.enquiryDateISO,
    bookingDateISO: preferred?.bookingDateISO || secondary?.bookingDateISO,
    grossValue: Number(preferred?.grossValue || 0) || Number(secondary?.grossValue || 0) || 0,
    netCommission: Number(preferred?.netCommission || 0) || Number(secondary?.netCommission || 0) || 0,
    eventType: preferred?.eventType || secondary?.eventType,
    actName: preferred?.actName || secondary?.actName,
    actTscName: preferred?.actTscName || secondary?.actTscName,
    address: preferred?.address || secondary?.address,
    county: preferred?.county || secondary?.county,
    venue: preferred?.venue || secondary?.venue,
    venueAddress: preferred?.venueAddress || secondary?.venueAddress,
    lineupSelected: preferred?.lineupSelected || secondary?.lineupSelected,
    lineupComposition: Array.isArray(preferred?.lineupComposition) && preferred.lineupComposition.length
      ? preferred.lineupComposition
      : secondary?.lineupComposition,
    arrivalTime: preferred?.arrivalTime || secondary?.arrivalTime,
    finishTime: preferred?.finishTime || secondary?.finishTime,
    bookingDetails: preferred?.bookingDetails || secondary?.bookingDetails,
    payments: Array.isArray(preferred?.payments) && preferred.payments.length
      ? preferred.payments
      : secondary?.payments,
    balancePaid: Boolean(preferred?.balancePaid ?? secondary?.balancePaid),
    bandPaymentsSent: Boolean(preferred?.bandPaymentsSent ?? secondary?.bandPaymentsSent),
    allocation: preferred?.allocation || secondary?.allocation,
    review: preferred?.review || secondary?.review,
    eventSheet: preferred?.eventSheet || secondary?.eventSheet,
    userAddress: preferred?.userAddress || secondary?.userAddress,
    actOwnerMusicianId: preferred?.actOwnerMusicianId || secondary?.actOwnerMusicianId,
    actId: preferred?.actId || secondary?.actId,
    actsSummary: Array.isArray(preferred?.actsSummary) && preferred.actsSummary.length
      ? preferred.actsSummary
      : secondary?.actsSummary,
    performanceTimes: preferred?.performanceTimes || secondary?.performanceTimes,
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

  if (incomingHasContract && !currentHasContract) return mergeRowData(incoming, current);
  if (currentHasContract && !incomingHasContract) return mergeRowData(current, incoming);

  const currentScore = scoreRowCompleteness(current);
  const incomingScore = scoreRowCompleteness(incoming);

  if (incomingScore > currentScore) return mergeRowData(incoming, current);
  if (currentScore > incomingScore) return mergeRowData(current, incoming);

  const currentUpdated = new Date(current?.updatedAt || current?.createdAt || 0).getTime() || 0;
  const incomingUpdated = new Date(incoming?.updatedAt || incoming?.createdAt || 0).getTime() || 0;

  if (incomingUpdated >= currentUpdated) return mergeRowData(incoming, current);
  return mergeRowData(current, incoming);
};

const normalizeBookingToBoardRow = (booking) => {
  const doc = booking?.toObject ? booking.toObject() : booking;
  if (!doc) return null;

  const eventDateISO = isoDateOnly(doc.eventDate || doc.date || doc.bookingDate);
  const grossValue = Number(
    doc?.grossValue ??
    doc?.totals?.fullAmount ??
    doc?.quote?.total ??
    doc?.pricing?.total ??
    doc?.amount ??
    doc?.fee ??
    0
  ) || 0;

  const depositValue = Number(
    doc?.payments?.depositChargedAmount ??
    doc?.payments?.depositAmount ??
    doc?.totals?.depositAmount ??
    doc?.quote?.deposit ??
    doc?.pricing?.deposit ??
    doc?.depositAmount ??
    0
  ) || 0;

  const safeDeposit = depositValue > 0 ? depositValue : calcDepositFromGross(grossValue);
  const actSummary = Array.isArray(doc?.actsSummary) && doc.actsSummary.length ? doc.actsSummary[0] : null;
  const clientFirstNames = [doc?.userAddress?.firstName, doc?.userAddress?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim() || doc?.clientName || doc?.bookerName || "";

  const clientEmail =
    doc?.clientEmail ||
    doc?.userAddress?.email ||
    doc?.userEmail ||
    "";

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
    ].filter(Boolean).join(", ") || "";

  const county = doc?.county || doc?.userAddress?.county || doc?.eventSheet?.answers?.venue_county || "";
  const actName = actSummary?.actName || actSummary?.name || doc?.actName || doc?.selectedAct?.name || "";
  const actTscName = actSummary?.tscName || actSummary?.name || doc?.actTscName || doc?.tscName || doc?.selectedAct?.tscName || actName || "";
  const lineupSelected = actSummary?.lineupLabel || actSummary?.lineup?.actSize || doc?.lineupSelected || "";
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
    eventType: doc?.eventType || doc?.eventSheet?.answers?.event_type || doc?.eventSheet?.complete?.event_type || "",
    actName,
    actTscName,
    address,
    county,
    lineupSelected,
    lineupComposition,
    arrivalTime: doc?.arrivalTime || doc?.performanceTimes?.arrivalTime || actSummary?.performance?.arrivalTime || "",
    finishTime: doc?.finishTime || doc?.performanceTimes?.finishTime || actSummary?.performance?.finishTime || "",
    bookingDetails: doc?.bookingDetails || { djServicesBooked: false },
    payments: rawPayments.length ? rawPayments : paymentsMeta,
    balancePaid: Boolean(doc?.balancePaid),
    bandPaymentsSent: Boolean(doc?.bandPaymentsSent),
    allocation: doc?.allocation || { status: "in_progress" },
    review: doc?.review || { requestedCount: 0, received: false },
    eventSheet: doc?.eventSheet || {},
    userEmail: doc?.userEmail || "",
    userAddress: doc?.userAddress || {},
    venue: doc?.venue || "",
    venueAddress: doc?.venueAddress || "",
    actOwnerMusicianId: doc?.actOwnerMusicianId || "",
    actId: actSummary?.actId || doc?.act || "",
    actsSummary: Array.isArray(doc?.actsSummary) ? doc.actsSummary : [],
    performanceTimes: doc?.performanceTimes || actSummary?.performance || {},
    contractUrl: doc?.contractUrl || "",
    pdfUrl: doc?.pdfUrl || "",
    contract: doc?.contract || null,
    createdAt: doc?.createdAt,
    updatedAt: doc?.updatedAt,
  };

  return row;
};

const isTSCAdmin = (user) => {
  const role = String(user?.role || "").toLowerCase();
  const email = String(user?.email || "").toLowerCase();
  return ["admin", "superadmin", "tsc_admin"].includes(role) ||
         email === "hello@thesupremecollective.co.uk";
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

// LIST with filters (date range, text search, act, agent)
router.get("/", musicianAuth, async (req, res) => {
  try {
    const {
      q,
      from,
      to,
      agent,
      act,
      sortBy = "eventDateISO",
      sortDir = "asc",
      limit = 500,
    } = req.query;

    const user = req.user || {};
    const email = String(user?.email || "").toLowerCase();
    const role = String(user?.role || "").toLowerCase();
    const isAgent = role === "agent" || email === "hello@thesupremecollective.co.uk";
    const isAdmin = isTSCAdmin(user) || isAgent;
    const proj = isAdmin ? adminProjection : actOwnerProjection;
    const musicianId = toObjectIdString(user?.musicianId || user?._id || user?.id);

    const boardQuery = {};
    const bookingQuery = {};

    if (from || to) {
      boardQuery.eventDateISO = {};
      bookingQuery.date = {};
      if (from) {
        boardQuery.eventDateISO.$gte = from;
        bookingQuery.date.$gte = new Date(`${from}T00:00:00.000Z`);
      }
      if (to) {
        boardQuery.eventDateISO.$lte = to;
        bookingQuery.date.$lte = new Date(`${to}T23:59:59.999Z`);
      }
    }

    if (agent) {
      boardQuery.agent = agent;
      bookingQuery.agent = agent;
    }

    if (act) {
      boardQuery.$or = [
        { actTscName: act },
        { actName: act },
      ];
      bookingQuery.$or = [
        { "actsSummary.tscName": act },
        { "actsSummary.name": act },
        { "actsSummary.actName": act },
      ];
    }

    const searchClause = buildSearchClause(q);
    if (searchClause) {
      if (boardQuery.$or) {
        boardQuery.$and = [{ $or: boardQuery.$or }, searchClause];
        delete boardQuery.$or;
      } else {
        Object.assign(boardQuery, searchClause);
      }

      const bookingSearchClause = {
        $or: [
          { bookingId: new RegExp(escapeRegex(q), "i") },
          { venue: new RegExp(escapeRegex(q), "i") },
          { venueAddress: new RegExp(escapeRegex(q), "i") },
          { eventType: new RegExp(escapeRegex(q), "i") },
          { userEmail: new RegExp(escapeRegex(q), "i") },
          { clientEmail: new RegExp(escapeRegex(q), "i") },
          { clientName: new RegExp(escapeRegex(q), "i") },
          { "userAddress.firstName": new RegExp(escapeRegex(q), "i") },
          { "userAddress.lastName": new RegExp(escapeRegex(q), "i") },
          { "userAddress.email": new RegExp(escapeRegex(q), "i") },
          { "actsSummary.actName": new RegExp(escapeRegex(q), "i") },
          { "actsSummary.name": new RegExp(escapeRegex(q), "i") },
          { "actsSummary.tscName": new RegExp(escapeRegex(q), "i") },
          { "actsSummary.lineupLabel": new RegExp(escapeRegex(q), "i") },
          { "actsSummary.selectedExtras.name": new RegExp(escapeRegex(q), "i") },
          { "eventSheet.answers.venue_name": new RegExp(escapeRegex(q), "i") },
          { "eventSheet.answers.client_names": new RegExp(escapeRegex(q), "i") },
          { "eventSheet.complete.client_names": new RegExp(escapeRegex(q), "i") },
        ],
      };

      if (bookingQuery.$or) {
        bookingQuery.$and = [{ $or: bookingQuery.$or }, bookingSearchClause];
        delete bookingQuery.$or;
      } else {
        Object.assign(bookingQuery, bookingSearchClause);
      }
    }

    if (!isAdmin) {
      if (musicianId) {
        boardQuery.actOwnerMusicianId = musicianId;
        bookingQuery.$or = [
          { actOwnerMusicianId: musicianId },
          { "actsSummary.bandMembers.musicianId": musicianId },
          { "actsSummary.chosenVocalists.musicianId": musicianId },
          { "payments.musician": musicianId },
          { userId: musicianId },
        ];
      } else if (email) {
        boardQuery.$or = [
          ...(boardQuery.$or || []),
          { userEmail: email },
          { "clientEmails.email": email },
        ];
        bookingQuery.$or = [
          ...(bookingQuery.$or || []),
          { userEmail: email },
          { clientEmail: email },
          { "userAddress.email": email },
        ];
      }
    }

    const boardRowsRaw = await BookingBoardItem.find(boardQuery, proj).limit(Number(limit));
    const bookingDocs = await Booking.find(bookingQuery).limit(Number(limit));

    const dedupeMap = new Map();

    for (const row of boardRowsRaw) {
      const plainRow = row?.toObject ? row.toObject() : row;
      const key = getCanonicalBookingKey(plainRow);
      const existing = dedupeMap.get(key);
      dedupeMap.set(key, choosePreferredRow(existing, plainRow));
    }

    for (const booking of bookingDocs) {
      const normalized = normalizeBookingToBoardRow(booking);
      if (!normalized) continue;
      const key = getCanonicalBookingKey(normalized);
      const existing = dedupeMap.get(key);
      dedupeMap.set(key, choosePreferredRow(existing, normalized));
    }

    const rows = [...dedupeMap.values()];

    const dir = String(sortDir).toLowerCase() === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      if (sortBy === "clientFirstNames") {
        return String(a?.clientFirstNames || "").localeCompare(String(b?.clientFirstNames || "")) * dir;
      }
      if (sortBy === "createdAt") {
        const aTime = new Date(a?.createdAt || a?.bookingDateISO || 0).getTime() || 0;
        const bTime = new Date(b?.createdAt || b?.bookingDateISO || 0).getTime() || 0;
        return (aTime - bTime) * dir;
      }
      const aDate = new Date(a?.eventDateISO || 0).getTime() || 0;
      const bDate = new Date(b?.eventDateISO || 0).getTime() || 0;
      return (aDate - bDate) * dir;
    });

    const totalDeduped = rows.length;

    const scopeLabel = isAdmin
      ? `Showing ${totalDeduped} deduplicated booking${totalDeduped === 1 ? "" : "s"} across The Supreme Collective`
      : `Showing ${totalDeduped} deduplicated booking${totalDeduped === 1 ? "" : "s"} visible to your account only`;

    res.json({
      success: true,
      rows: rows.slice(0, Number(limit)),
      scopeLabel,
      debug: {
        isAdmin,
        isAgent,
        filteredByOwner: !isAdmin,
        musicianId: musicianId || null,
        email: email || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// CREATE manual row
router.post("/", musicianAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    if (!isTSCAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can create manual booking board rows." });
    }
    if (Array.isArray(payload?.lineupMembers)) {
      payload.bandSize = payload.lineupMembers.filter(m =>
        String(m.instrument || "").toLowerCase() !== "manager"
      ).length;
      delete payload.lineupMembers;
    }
    const row = await BookingBoardItem.create(payload);
    res.json({ success: true, row });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// PATCH inline edits
router.patch("/:id", musicianAuth, async (req, res) => {
  try {
    const body = { ...req.body, updatedAt: new Date() };
    if (!isTSCAdmin(req.user)) {
      delete body.grossValue;
      delete body.netCommission;
    }
    if (!isTSCAdmin(req.user)) {
      const existingRow = await BookingBoardItem.findById(req.params.id).select("actOwnerMusicianId userEmail clientEmails").lean();
      const reqMusicianId = toObjectIdString(req.user?.musicianId || req.user?._id || req.user?.id);
      const reqEmail = String(req.user?.email || "").toLowerCase();
      const rowOwnerId = toObjectIdString(existingRow?.actOwnerMusicianId);
      const rowEmails = [
        String(existingRow?.userEmail || "").toLowerCase(),
        ...((Array.isArray(existingRow?.clientEmails) ? existingRow.clientEmails : []).map((e) => String(e?.email || "").toLowerCase())),
      ].filter(Boolean);

      const canEditOwnRow =
        (reqMusicianId && rowOwnerId && reqMusicianId === rowOwnerId) ||
        (reqEmail && rowEmails.includes(reqEmail));

      if (!canEditOwnRow) {
        return res.status(403).json({ success: false, message: "You can only edit booking board rows visible to your own account." });
      }
    }
    const row = await BookingBoardItem.findByIdAndUpdate(
      req.params.id,
      { $set: body },
      { new: true }
    );
    res.json({ success: true, row });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});



export default router;
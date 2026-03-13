import express from "express";
import mongoose from "mongoose";
import EnquiryBoardItem from "../models/enquiryBoardItem.js";
import Act from "../models/actModel.js";
import musicianAuth from "../middleware/musicianAuth.js";
import { triggerAvailabilityRequest } from "../controllers/availabilityController.js";

const router = express.Router();

const EXCLUDED_CLIENT_EMAILS = new Set([
  "hello@thesupremecollective.co.uk",
  "rhona@thesupremecollective.co.uk",
  "rhonadownie@gmail.com",
  "rhonagdownie@gmail.com",
]);

const EXCLUDED_CLIENT_NAMES = new Set(["rhona downie"]);

const AVAILABILITY_COLLECTION_CANDIDATES = [
  "availabilities",
  "availabilityrequests",
  "availability_requests",
  "availabilitydocs",
  "availabilitydoc",
];

const isTSCAdmin = (user) => {
  const role = String(user?.role || "").toLowerCase();
  const email = String(user?.email || "").toLowerCase();
  return ["admin", "superadmin", "tsc_admin"].includes(role) ||
    email === "hello@thesupremecollective.co.uk";
};

const isAgent = (user) => {
  const role = String(user?.role || "").toLowerCase();
  const email = String(user?.email || "").toLowerCase();
  return role === "agent" || email === "hello@thesupremecollective.co.uk";
};

const isEmail = (s) => typeof s === "string" && /\S+@\S+\.\S+/.test(s.trim());
const clean = (s) => String(s || "").trim();

const toISODateOnly = (v) => {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
};

const makeRef = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `ENQ-${y}${m}${day}-${rnd}`;
};

const toObjectIdOrNull = (value) => {
  try {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (mongoose.Types.ObjectId.isValid(String(value))) {
      return new mongoose.Types.ObjectId(String(value));
    }
    return null;
  } catch {
    return null;
  }
};

const idToString = (value) => {
  try {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (value instanceof mongoose.Types.ObjectId) return value.toString();
    if (typeof value === "object" && value.$oid) return String(value.$oid);
    if (value?._id) return idToString(value._id);
    if (value?.toString) return value.toString();
    return "";
  } catch {
    return "";
  }
};

const getLineupSizeValue = (lineup) => {
  const raw =
    lineup?.act_size ??
    lineup?.actSize ??
    lineup?.size ??
    lineup?.lineupSize ??
    lineup?.name ??
    "";

  const match = String(raw).match(/(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

const pickSmallestLineup = (act) => {
  const lineups = Array.isArray(act?.lineups) ? [...act.lineups] : [];
  if (!lineups.length) return null;

  lineups.sort((a, b) => getLineupSizeValue(a) - getLineupSizeValue(b));
  return lineups[0] || null;
};

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const shouldHideClient = (row) => {
  const email = clean(row?.clientEmail || row?.email).toLowerCase();
  const clientName = clean(row?.clientName || row?.name).toLowerCase();
  return EXCLUDED_CLIENT_EMAILS.has(email) || EXCLUDED_CLIENT_NAMES.has(clientName);
};

const getComparable = (row, sortBy) => {
  switch (sortBy) {
    case "createdAt":
      return new Date(row?.createdAt || 0).getTime() || 0;
    case "eventDateISO":
      return clean(row?.eventDateISO || row?.dateISO);
    case "grossValue":
    case "netCommission":
    case "maxBudget":
    case "bandSize":
      return Number(row?.[sortBy] || 0);
    default:
      return clean(row?.[sortBy] || "").toLowerCase();
  }
};

const sortRows = (rows, sortBy = "enquiryDateISO", sortDir = "asc") => {
  const dir = sortDir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = getComparable(a, sortBy);
    const bv = getComparable(b, sortBy);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
};

const filterRowsInMemory = (rows, { q, from, to, agent, actId }) => {
  let out = Array.isArray(rows) ? [...rows] : [];

  if (from || to) {
    out = out.filter((row) => {
      const date = clean(row?.eventDateISO || row?.dateISO);
      if (!date) return false;
      if (from && date < String(from)) return false;
      if (to && date > String(to)) return false;
      return true;
    });
  }

  if (agent) {
    const wanted = clean(agent).toLowerCase();
    out = out.filter((row) => clean(row?.agent).toLowerCase() === wanted);
  }

  if (actId) {
    const wanted = String(actId);
    out = out.filter((row) => idToString(row?.actId) === wanted);
  }

  if (q) {
    const rx = new RegExp(escapeRegex(String(q)), "i");
    out = out.filter((row) =>
      [
        row?.enquiryRef,
        row?.requestId,
        row?.actName,
        row?.actTscName,
        row?.county,
        row?.address,
        row?.formattedAddress,
        row?.clientName,
        row?.clientEmail,
      ].some((value) => rx.test(String(value || "")))
    );
  }

  out = out.filter((row) => !shouldHideClient(row));
  return out;
};

const getUserActIds = async (user) => {
  const userId = idToString(user?._id || user?.id || user?.userId || user?.sub);
  const email = clean(user?.email).toLowerCase();
  const or = [];

  const objectId = toObjectIdOrNull(userId);
  if (objectId) {
    or.push(
      { userId: objectId },
      { owner: objectId },
      { ownerId: objectId },
      { createdBy: objectId },
      { createdById: objectId },
      { agentId: objectId },
      { addedBy: objectId },
      { addedById: objectId }
    );
  }

  if (userId) {
    or.push(
      { userId },
      { owner: userId },
      { ownerId: userId },
      { createdBy: userId },
      { createdById: userId },
      { agentId: userId },
      { addedBy: userId },
      { addedById: userId }
    );
  }

  if (email) {
    or.push(
      { email },
      { userEmail: email },
      { ownerEmail: email },
      { createdByEmail: email },
      { agentEmail: email },
      { addedByEmail: email },
      { contactEmail: email }
    );
  }

  if (!or.length) return [];

  const acts = await Act.find({ $or: or }, { _id: 1 }).lean();
  return acts.map((a) => idToString(a?._id)).filter(Boolean);
};

const mapBoardRow = (row) => ({
  ...row,
  _source: "manual",
  enquiryRef: clean(row?.enquiryRef) || makeRef(),
  enquiryDateISO: toISODateOnly(row?.enquiryDateISO || row?.createdAt),
  eventDateISO: toISODateOnly(row?.eventDateISO),
  address: clean(row?.address),
  clientName: clean(row?.clientName),
  clientEmail: clean(row?.clientEmail).toLowerCase(),
  actId: row?.actId || null,
  requestId: row?.requestId || null,
});

const mapAvailabilityRow = (doc) => {
  const actId = doc?.actId || null;
  const dateISO = toISODateOnly(doc?.dateISO || doc?.eventDateISO || doc?.formattedDate);
  const clientEmail = clean(doc?.clientEmail).toLowerCase();
  const clientName = clean(doc?.clientName || doc?.contactName);

  return {
    _id: doc?._id,
    actId,
    lineupId: doc?.lineupId || null,
    enquiryRef: clean(doc?.enquiryRef) || clean(doc?.requestId) || makeRef(),
    requestId: clean(doc?.requestId) || null,
    enquiryDateISO: toISODateOnly(doc?.createdAt || new Date()),
    eventDateISO: dateISO,
    dateISO,
    actName: clean(doc?.actName),
    actTscName: clean(doc?.actTscName || doc?.actName),
    address: clean(doc?.formattedAddress),
    formattedAddress: clean(doc?.formattedAddress),
    county: clean(doc?.county),
    clientName,
    clientEmail,
    notes: clean(doc?.notes || "Availability request"),
    status: clean(doc?.status) || "open",
    grossValue: doc?.grossValue,
    netCommission: doc?.netCommission,
    bandSize: doc?.bandSize,
    maxBudget: doc?.maxBudget,
    createdAt: doc?.createdAt,
    updatedAt: doc?.updatedAt,
    agent: clean(doc?.agent || "Direct"),
    slotIndex: doc?.slotIndex,
    reply: doc?.reply,
    calendarStatus: doc?.calendarStatus,
    _source: "availability",
  };
};

const fetchAvailabilityRows = async (baseFilter = {}) => {
  const db = mongoose.connection?.db;
  if (!db) return [];

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(collections.map((c) => c.name));
  const collectionName = AVAILABILITY_COLLECTION_CANDIDATES.find((name) => names.has(name));
  if (!collectionName) return [];

  const docs = await db.collection(collectionName).find(baseFilter).toArray();
  return docs.map(mapAvailabilityRow);
};

/**
 * GET /api/board/enquiries?q=&sortBy=&sortDir=&page=&limit=&scope=
 */
router.get("/", musicianAuth, async (req, res) => {
  try {
    const {
      q,
      sortBy = "enquiryDateISO",
      sortDir = "asc",
      from,
      to,
      agent,
      actId,
      page = 1,
      limit = 25,
      scope = "all",
      includeSiteEnquiries = "true",
      includeManualEnquiries = "true",
    } = req.query;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));

    const user = req.user || {};
    const admin = isTSCAdmin(user) || isAgent(user);
    const proj = admin ? {} : { grossValue: 0, netCommission: 0 };

    let allowedActIds = [];
    if (!admin || String(scope) === "mine") {
      allowedActIds = await getUserActIds(user);
      if (!allowedActIds.length) {
        return res.json({
          success: true,
          rows: [],
          total: 0,
          pagination: { page: safePage, limit: safeLimit, total: 0, totalPages: 0 },
          debug: { admin, scopedTo: "mine", allowedActIds: 0 },
        });
      }
    }

    const mongoQuery = {};
    if (from || to) {
      mongoQuery.eventDateISO = {};
      if (from) mongoQuery.eventDateISO.$gte = String(from);
      if (to) mongoQuery.eventDateISO.$lte = String(to);
    }
    if (agent) mongoQuery.agent = String(agent);
    if (actId) mongoQuery.actId = toObjectIdOrNull(actId) || actId;
    if (allowedActIds.length) {
      mongoQuery.actId = { $in: allowedActIds.map((id) => toObjectIdOrNull(id) || id) };
    }
    if (q) {
      mongoQuery.$or = [
        { enquiryRef: new RegExp(escapeRegex(String(q)), "i") },
        { actName: new RegExp(escapeRegex(String(q)), "i") },
        { actTscName: new RegExp(escapeRegex(String(q)), "i") },
        { county: new RegExp(escapeRegex(String(q)), "i") },
        { address: new RegExp(escapeRegex(String(q)), "i") },
        { clientName: new RegExp(escapeRegex(String(q)), "i") },
        { clientEmail: new RegExp(escapeRegex(String(q)), "i") },
      ];
    }

    let rows = [];

    if (String(includeManualEnquiries) !== "false") {
      const manualRows = await EnquiryBoardItem.find(mongoQuery, proj).lean();
      rows.push(...manualRows.map(mapBoardRow));
    }

    if (String(includeSiteEnquiries) !== "false") {
      const availabilityFilter = {};
      if (actId) availabilityFilter.actId = toObjectIdOrNull(actId) || actId;
      if (allowedActIds.length) {
        availabilityFilter.actId = {
          $in: allowedActIds.map((id) => toObjectIdOrNull(id) || id),
        };
      }
      const availabilityRows = await fetchAvailabilityRows(availabilityFilter);
      rows.push(...availabilityRows);
    }

    rows = filterRowsInMemory(rows, { q, from, to, agent, actId });
    rows = sortRows(rows, String(sortBy), String(sortDir));

    const total = rows.length;
    const totalPages = Math.ceil(total / safeLimit);
    const start = (safePage - 1) * safeLimit;
    const pagedRows = rows.slice(start, start + safeLimit);

    res.json({
      success: true,
      rows: pagedRows,
      total,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages,
      },
      debug: {
        admin,
        scopedTo: !admin || String(scope) === "mine" ? "mine" : "all",
        allowedActIds: allowedActIds.length,
      },
    });
  } catch (e) {
    console.error("Enquiry board GET error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * POST /api/board/enquiries  (AGENT ONLY)
 */
router.post("/", musicianAuth, async (req, res) => {
  try {
    if (!isAgent(req.user) && !isTSCAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Agent-only" });
    }

    const payload = { ...(req.body || {}) };

    if (Array.isArray(payload?.lineupMembers)) {
      payload.bandSize = payload.lineupMembers.filter((m) =>
        String(m.instrument || "").toLowerCase() !== "manager"
      ).length;
      delete payload.lineupMembers;
    }

    payload.enquiryRef = clean(payload.enquiryRef) || makeRef();
    payload.enquiryDateISO = toISODateOnly(payload.enquiryDateISO) || toISODateOnly(new Date());
    payload.eventDateISO = toISODateOnly(payload.eventDateISO);

    payload.clientName = clean(payload.clientName);
    payload.clientEmail = isEmail(payload.clientEmail)
      ? clean(payload.clientEmail).toLowerCase()
      : "";

    payload.address = clean(payload.address);
    payload.county = clean(payload.county);

    if (!payload.eventDateISO) {
      return res.status(400).json({ success: false, message: "Missing/invalid eventDateISO (YYYY-MM-DD)" });
    }

    const row = await EnquiryBoardItem.create(payload);
    const createdRow = mapBoardRow(row.toObject ? row.toObject() : row);

    let availabilityTriggered = null;

    try {
      const actObjectId = toObjectIdOrNull(payload.actId);
      const act = actObjectId ? await Act.findById(actObjectId).lean() : null;

      if (act?._id) {
        const chosenLineup = payload.lineupId
          ? (Array.isArray(act.lineups)
              ? act.lineups.find(
                  (lineup) => idToString(lineup?._id || lineup?.lineupId) === String(payload.lineupId)
                )
              : null)
          : pickSmallestLineup(act);

        const chosenLineupId = idToString(chosenLineup?._id || chosenLineup?.lineupId) || null;

        const triggerResult = await triggerAvailabilityRequest({
          actId: idToString(act._id),
          lineupId: chosenLineupId,
          dateISO: payload.eventDateISO,
          formattedAddress: payload.address,
          address: payload.address,
          clientName: payload.clientName,
          clientEmail: payload.clientEmail,
          enquiryId: createdRow.enquiryRef,
          requestId: createdRow.enquiryRef,
          source: "manual_enquiry_board",
          skipDuplicateCheck: false,
        });

        availabilityTriggered = {
          success: !!triggerResult?.success,
          sent: Number(triggerResult?.sent || 0),
          skipped: triggerResult?.skipped || null,
          details: Array.isArray(triggerResult?.details) ? triggerResult.details : [],
        };

        console.log("✅ Enquiry board manual add triggered availability", {
          enquiryRef: createdRow.enquiryRef,
          actId: idToString(act._id),
          lineupId: chosenLineupId,
          eventDateISO: payload.eventDateISO,
          sent: availabilityTriggered.sent,
          skipped: availabilityTriggered.skipped,
        });
      } else {
        console.warn("⚠️ Manual enquiry created without valid act for availability trigger", {
          enquiryRef: createdRow.enquiryRef,
          actId: payload.actId || null,
        });
      }
    } catch (availabilityErr) {
      console.error("❌ Availability trigger failed after manual enquiry create:", availabilityErr);
      availabilityTriggered = {
        success: false,
        sent: 0,
        skipped: null,
        error: availabilityErr?.message || "Availability trigger failed",
      };
    }

    res.json({
      success: true,
      row: createdRow,
      availabilityTriggered,
    });
  } catch (e) {
    console.error("Enquiry board POST error:", e);
    res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * PATCH /api/board/enquiries/:id
 */
router.patch("/:id", musicianAuth, async (req, res) => {
  try {
    const body = { ...(req.body || {}) };

    if (!isTSCAdmin(req.user) && !isAgent(req.user)) {
      delete body.grossValue;
      delete body.netCommission;
    }

    if ("enquiryDateISO" in body) body.enquiryDateISO = toISODateOnly(body.enquiryDateISO);
    if ("eventDateISO" in body) body.eventDateISO = toISODateOnly(body.eventDateISO);
    if ("clientEmail" in body) {
      body.clientEmail = isEmail(body.clientEmail) ? clean(body.clientEmail).toLowerCase() : "";
    }

    const row = await EnquiryBoardItem.findByIdAndUpdate(
      req.params.id,
      { $set: body },
      { new: true }
    ).lean();

    res.json({ success: !!row, row: row ? mapBoardRow(row) : null });
  } catch (e) {
    console.error("Enquiry board PATCH error:", e);
    res.status(400).json({ success: false, message: e.message });
  }
});

export default router;
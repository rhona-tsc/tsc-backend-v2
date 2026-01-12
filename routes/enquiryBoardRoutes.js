import express from "express";
import EnquiryBoardItem from "../models/enquiryBoardItem.js";
import musicianAuth from "../middleware/musicianAuth.js";

const router = express.Router();

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
  if (isNaN(d)) return "";
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

/**
 * GET /api/board/enquiries?q=&sortBy=&sortDir=
 */
router.get("/", musicianAuth, async (req, res) => {
  try {
    const { q, sortBy = "enquiryDateISO", sortDir = "asc", from, to, agent, actId, limit = 500 } = req.query;
    const query = {};

    // date range on event
    if (from || to) {
      query.eventDateISO = {};
      if (from) query.eventDateISO.$gte = String(from);
      if (to)   query.eventDateISO.$lte = String(to);
    }

    if (agent) query.agent = String(agent);
    if (actId) query.actId = actId;

    if (q) {
      query.$or = [
        { enquiryRef: new RegExp(q, "i") },
        { actName: new RegExp(q, "i") },
        { actTscName: new RegExp(q, "i") },
        { county: new RegExp(q, "i") },
        { address: new RegExp(q, "i") },
        { clientName: new RegExp(q, "i") },
        { clientEmail: new RegExp(q, "i") },
      ];
    }

    const user = req.user || {};
    const admin = isTSCAdmin(user) || isAgent(user);

    // field-level projection by role (keep your intention)
    const proj = admin ? {} : { grossValue: 0, netCommission: 0 };

    const rows = await EnquiryBoardItem.find(query, proj)
      .sort({ [sortBy]: sortDir === "asc" ? 1 : -1 })
      .limit(Number(limit))
      .lean();

    res.json({ success: true, rows, debug: { admin } });
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

    // keep your existing bandSize-from-lineupMembers logic
    if (Array.isArray(payload?.lineupMembers)) {
      payload.bandSize = payload.lineupMembers.filter((m) =>
        String(m.instrument || "").toLowerCase() !== "manager"
      ).length;
      delete payload.lineupMembers;
    }

    // normalise key fields (helps avoid bad data causing “no email sent” later)
    payload.enquiryRef = clean(payload.enquiryRef) || makeRef();
    payload.enquiryDateISO = toISODateOnly(payload.enquiryDateISO) || toISODateOnly(new Date());
    payload.eventDateISO = toISODateOnly(payload.eventDateISO);

    payload.clientName = clean(payload.clientName);
    payload.clientEmail = isEmail(payload.clientEmail) ? clean(payload.clientEmail).toLowerCase() : "";

    payload.address = clean(payload.address);
    payload.county = clean(payload.county);

    if (!payload.eventDateISO) {
      return res.status(400).json({ success: false, message: "Missing/invalid eventDateISO (YYYY-MM-DD)" });
    }

    const row = await EnquiryBoardItem.create(payload);
    res.json({ success: true, row });
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

    // keep your money-field lock
    if (!isTSCAdmin(req.user) && !isAgent(req.user)) {
      delete body.grossValue;
      delete body.netCommission;
    }

    // normalise date/email if patched
    if ("enquiryDateISO" in body) body.enquiryDateISO = toISODateOnly(body.enquiryDateISO);
    if ("eventDateISO" in body) body.eventDateISO = toISODateOnly(body.eventDateISO);
    if ("clientEmail" in body) body.clientEmail = isEmail(body.clientEmail) ? clean(body.clientEmail).toLowerCase() : "";

    const row = await EnquiryBoardItem.findByIdAndUpdate(
      req.params.id,
      { $set: body },
      { new: true }
    ).lean();

    res.json({ success: !!row, row });
  } catch (e) {
    console.error("Enquiry board PATCH error:", e);
    res.status(400).json({ success: false, message: e.message });
  }
});

export default router;
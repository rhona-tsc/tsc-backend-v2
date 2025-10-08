import express from "express";
import EnquiryBoardItem from "../models/enquiryBoardItem.js";
import musicianAuth from "../middleware/musicianAuth.js";
import { listEnquiryBoardRows } from "../controllers/bookingController.js";


const router = express.Router();

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

// LIST with filters (date range, text search, act, agent)
router.get("/", musicianAuth, async (req, res) => {
  try {
    const { q, from, to, agent, act, limit = 200 } = req.query;
    const query = {};

    if (from || to) {
      query.eventDateISO = {};
      if (from) query.eventDateISO.$gte = from;
      if (to)   query.eventDateISO.$lte = to;
    }
    if (agent) query.agent = agent;
    if (act)   query.actTscName = act;

    if (q) {
      query.$or = [
        { clientFirstNames: new RegExp(q, "i") },
        { bookingRef:       new RegExp(q, "i") },
        { actName:          new RegExp(q, "i") },
        { actTscName:       new RegExp(q, "i") },
        { county:           new RegExp(q, "i") },
        { address:          new RegExp(q, "i") },
      ];
    }

    // privilege checks
    const user = req.user || {};
    const email = String(user.email || "").toLowerCase();
    const role  = String(user.role  || "").toLowerCase();
    const isAgent = role === "agent" || email === "hello@thesupremecollective.co.uk";
    const isAdmin = isTSCAdmin(user) || isAgent;

    const proj = isAdmin ? adminProjection : actOwnerProjection;

    // only restrict by owner if we actually have a musicianId
    if (!isAdmin && user.musicianId) {
      query.actOwnerMusicianId = user.musicianId;
    }

    const rows = await EnquiryBoardItem.find(query, proj)
      .sort({ eventDateISO: 1 })
      .limit(Number(limit));

    res.json({ success: true, rows, debug: { isAdmin, filteredByOwner: !isAdmin && !!user.musicianId } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// CREATE manual row
router.post("/", musicianAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    if (Array.isArray(payload?.lineupMembers)) {
      payload.bandSize = payload.lineupMembers.filter(m =>
        String(m.instrument || "").toLowerCase() !== "manager"
      ).length;
      delete payload.lineupMembers;
    }
    const row = await EnquiryBoardItem.create(payload);
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
    const row = await EnquiryBoardItem.findByIdAndUpdate(
      req.params.id,
      { $set: body },
      { new: true }
    );
    res.json({ success: true, row });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

router.get("/board/enquiries", authRequired, listEnquiryBoardRows);
// (Optional) add PATCH/POST if you want inline edits/manual create:
router.patch("/board/enquiries/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  const patch = req.body || {};
  const row = await EnquiryBoardItem.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
  return res.json({ success: !!row, row });
});

// If you want to allow manual POST later:
router.post("/board/enquiries", authRequired, async (req, res) => {
  const row = await EnquiryBoardItem.create({ ...(req.body||{}), createdAt: new Date() });
  return res.json({ success: true, row });
});



export default router;
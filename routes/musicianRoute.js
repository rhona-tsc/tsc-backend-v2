import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import { emailContract } from "../controllers/musicianController.js";
import upload from "../middleware/multer.js";
import agentAuth from "../middleware/agentAuth.js";
import verifyToken from "../middleware/musicianAuth.js";
import musicianModel from "../models/musicianModel.js";
import actModel from "../models/actModel.js";
import PendingSong from "../models/pendingSongModel.js";
import { appendDeputyRepertoire, suggestDeputies } from "../controllers/musicianController.js";
import {
  addAct, listActs, removeAct, singleAct, updateActStatus,
  registerMusician, loginMusician, saveActDraft, saveAmendmentDraft,
  approveAmendment, registerDeputy, listPendingDeputies, approveDeputy,
  rejectDeputy, updateAct, rejectAct, refreshAccessToken, logoutMusician, getDeputyById
} from "../controllers/musicianController.js";
import bookingModel from "../models/bookingModel.js";
import { autosaveMusicianForm, listAutosaveHistory } from "../controllers/musicianAutosave.controller.js";


const router = express.Router();

// ⚠️ removed the router.use(...) CORS shim – global CORS in server.js handles it

const uploadFields = upload.fields([
  { name: "images", maxCount: 30 },
  { name: "pliFile", maxCount: 1 },
  { name: "patFile", maxCount: 1 },
  { name: "riskAssessment", maxCount: 1 },
  { name: "videos", maxCount: 30 },
  { name: "mp3s", maxCount: 20 },
  { name: "coverMp3s", maxCount: 20 },
  { name: "originalMp3s", maxCount: 20 },
  { name: "profilePicture", maxCount: 1 },
  { name: "coverHeroImage", maxCount: 1 },
  { name: "digitalWardrobeBlackTie", maxCount: 30 },
  { name: "digitalWardrobeFormal", maxCount: 30 },
  { name: "digitalWardrobeSmartCasual", maxCount: 30 },
  { name: "digitalWardrobeSessionAllBlack", maxCount: 30 },
  { name: "additionalImages", maxCount: 50 },
]);

/* ---------------- AUTH (musician) ---------------- */
router.post("/auth/register", registerMusician);
router.post("/auth/login", loginMusician);
router.post("/auth/refresh", refreshAccessToken);
router.post("/auth/logout", logoutMusician);

/* ---------------- Deputy registration ---------------- */
router.post("/moderation/register-deputy", uploadFields, registerDeputy);

// Save updates to an existing deputy during moderation (no signature required)
router.patch("/moderation/deputy/:id/save", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};

    const doc = await musicianModel.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Musician not found" });

    // --- normalize band refs (same logic as registerDeputy) ---
    const normalizeBandRefs = (arr, nameKey, emailKey) =>
      (Array.isArray(arr) ? arr : [])
        .map((x) => ({
          [nameKey]: String(x?.[nameKey] || "").trim(),
          [emailKey]: String(x?.[emailKey] || "").trim().toLowerCase(),
        }))
        .filter((x) => x[nameKey] || x[emailKey]);

    if ("function_bands_performed_with" in updates) {
      updates.function_bands_performed_with = normalizeBandRefs(
        updates.function_bands_performed_with,
        "function_band_name",
        "function_band_leader_email"
      );
    }

    if ("original_bands_performed_with" in updates) {
      updates.original_bands_performed_with = normalizeBandRefs(
        updates.original_bands_performed_with,
        "original_band_name",
        "original_band_leader_email"
      );
    }

    // ✅ Use mongoose setter (casts + marks modified properly)
    doc.set(updates);

    // (extra safety for nested arrays/subdocs)
    if ("function_bands_performed_with" in updates) doc.markModified("function_bands_performed_with");
    if ("original_bands_performed_with" in updates) doc.markModified("original_bands_performed_with");

    // Status tweak
    if ((doc.status || "").toLowerCase() === "approved") {
      doc.status = "Approved, changes pending";
    }

    await doc.save();

    console.log("PATCH keys:", Object.keys(req.body || {}));
console.log("PATCH function_bands_performed_with:", req.body?.function_bands_performed_with);
console.log("PATCH original_bands_performed_with:", req.body?.original_bands_performed_with);

    return res.json({
      success: true,
      message: "Deputy changes saved",
      deputy: { _id: doc._id, email: doc.email, status: doc.status },
    });
  } catch (err) {
    console.error("❌ save deputy (moderation) failed:", err);
    return res.status(500).json({ success: false, message: "Failed to save deputy" });
  }
});

router.get("/moderation/deputy/:id", verifyToken, getDeputyById);
router.get("/pending-deputies", verifyToken, listPendingDeputies);
router.post("/approve-deputy", verifyToken, approveDeputy);
router.post("/reject-deputy", verifyToken, rejectDeputy);
router.post("/email-contract", emailContract);


/* ---------------- Autosave ---------------- */
router.post("/autosave", verifyToken, autosaveMusicianForm);
router.get("/autosave/history/:musicianId", verifyToken, listAutosaveHistory);

/* ---------------- Musician profile & listing (READ-ONLY) ---------------- */
// GET /api/musician?status=approved
router.get("/", async (req, res) => {
  try {
    const { status } = req.query || {};
    const q = { role: "musician" };
    if (status) q.status = status;
    const list = await musicianModel.find(q).lean();
    res.json({ musicians: Array.isArray(list) ? list : [] });
  } catch (err) {
    console.error("❌ Error listing musicians:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/musician/profile/:id
router.get("/profile/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await musicianModel.findById(id).lean();
    if (!doc) return res.status(404).json({ message: "Musician not found" });
    res.json(doc);
  } catch (err) {
    console.error("❌ Error fetching musician profile:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/musician/moderation/acts/:id  (alias for fetching act by id)
router.get("/moderation/acts/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const act = await actModel.findById(id);
    if (!act) return res.status(404).json({ success: false, message: "Act not found" });
    // Optionally enforce only “pending moderation” acts:
    // if (act.status !== 'pending') return res.status(403).json({ success:false, message:'Not pending' });
    return res.status(200).json({ success: true, act });
  } catch (err) {
    console.error("Error in GET /api/musician/moderation/acts/:id", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ---------------- Act CRUD (namespaced) ---------------- */
// Drafts & amendments
router.post("/acts/save-draft", saveActDraft);
router.post("/acts/save-amendment", saveAmendmentDraft);
router.post("/acts/approve-amendment", agentAuth, approveAmendment);
router.post("/acts/reject", agentAuth, rejectAct);

// Create act (protected if needed)
router.post("/acts/add", agentAuth, uploadFields, addAct);

// Update act
router.put("/acts/update/:id", verifyToken, uploadFields, updateAct);

// List & single
router.get("/acts/list", listActs);
router.post("/acts/single", singleAct);

// Remove
router.post("/acts/remove", removeAct);

// Status update
router.post("/acts/status", agentAuth, updateActStatus);

// Legacy: get act by ObjectId  (kept for compatibility; prefer /acts/single)
router.get("/acts/get/:id", async (req, res) => {
  try {
    const act = await actModel.findById(req.params.id);
    if (!act) return res.status(404).json({ success: false, message: "Act not found" });
    res.status(200).json({ success: true, act });
  } catch (err) {
    console.error("Error in GET /api/musician/acts/get/:id", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ---------------- Misc ---------------- */
router.post("/pending-song", async (req, res) => {
  try {
    const { title, artist, genre, year } = req.body;
    const existing = await PendingSong.findOne({ title, artist });
    if (existing) return res.status(200).json({ message: "Already in moderation queue" });
    const newSong = new PendingSong({ title, artist, genre, year });
    await newSong.save();
    res.status(200).json({ message: "Song submitted for moderation" });
  } catch (err) {
    console.error("Moderation submit error:", err);
    res.status(500).json({ error: "Failed to submit song for moderation" });
  }
});

router.post("/suggest", suggestDeputies);

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('❌ MulterError:', err.code, 'field =', err.field);
    return res.status(400).json({
      success: false,
      message: `Unexpected file field: ${err.field}`,
      code: err.code,
      field: err.field,
    });
  }
  next(err);
});





const toObjectIds = (csv = "") =>
  csv
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(id => {
      try { return new mongoose.Types.ObjectId(id); } catch { return null; }
    })
    .filter(Boolean);

const esc = (s="") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/musicians/suggest?instrument=Bass%20Guitar&roles=Sound%20Engineering,Musical%20Director&exclude=ID1,ID2&limit=8
router.get("/musicians/suggest", async (req, res) => {
  try {
    const {
      instrument = "",
      roles = "",          // comma-separated list of essential roles
      exclude = "",        // comma-separated list of Mongo IDs
      limit = "8",
    } = req.query;

    const excludeIds = toObjectIds(exclude);
    const roleList = roles
      ? roles.split(",").map(s => s.trim()).filter(Boolean)
      : [];

    // Base match: only approved musicians, not excluded
    const match = { status: "approved" };
    if (excludeIds.length) match._id = { $nin: excludeIds };

    // Instrument match (case-insensitive, exact or partial)
    if (instrument.trim()) {
      match["instrumentation.instrument"] = { $regex: esc(instrument.trim()), $options: "i" };
    }

    // Roles mapped to other_skills
    if (roleList.length) {
      match.other_skills = { $in: roleList };
    }

    // Fetch a reasonable pool to score (overfetch a bit, then score & slice)
    const pool = await musicianModel
      .find(match, {
        firstName: 1,
        lastName: 1,
        email: 1,
        phone: 1,
        profilePicture: 1,
        additionalImages: 1,
        instrumentation: 1,
        other_skills: 1,
        status: 1,
      })
      .limit(60)
      .lean();

    // Score results
    const insLC = instrument.trim().toLowerCase();
    const maxScore = (insLC ? 2 : 0) + roleList.length; // instrument weight=2, each role weight=1

    const scored = pool.map(m => {
      const instruments = Array.isArray(m.instrumentation)
        ? m.instrumentation
            .map(i => (i?.instrument || "").toString().toLowerCase())
            .filter(Boolean)
        : [];

      const hasInstrument = insLC
        ? instruments.some(inst => inst === insLC || inst.includes(insLC))
        : false;

      const skills = Array.isArray(m.other_skills) ? m.other_skills : [];
      const roleHits = roleList.filter(r => skills.includes(r)).length;

      const score = (hasInstrument ? 2 : 0) + roleHits;
      const matchPct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

      return { ...m, matchScore: score, matchPct };
    });

    // Sort by score desc, then name asc
    scored.sort((a, b) => b.matchScore - a.matchScore || (a.lastName || "").localeCompare(b.lastName || ""));

    const out = scored
      .slice(0, Math.max(1, parseInt(limit, 10) || 8))
      .map(m => ({
        _id: m._id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        phone: m.phone,
        profilePicture: m.profilePicture,
        additionalImages: m.additionalImages,
        matchPct: m.matchPct,
      }));

    res.json({ success: true, musicians: out });
  } catch (err) {
    console.error("suggest error:", err);
    res.status(500).json({ success: false, message: "Failed to suggest musicians" });
  }
});

router.post("/moderation/deputy/:id/repertoire/append", appendDeputyRepertoire);


// GET /api/musician/stats/:id
router.get("/stats/:id", verifyToken, async (req, res) => {
  try {
    const musicianId = req.params.id;

    // 12-month window
    const since = new Date();
    since.setMonth(since.getMonth() - 12);

    // 1) Enquiries (shortlists, enquiries board…)
    const enquiries = await bookingModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" }},
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // 2) Bookings where musician is part of ANY lineup
    const bookings = await bookingModel.aggregate([
      {
        $match: {
          createdAt: { $gte: since },
          "musicians.musicianId": musicianId
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" }},
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // 3) Cash earned by musician (from fee allocations)
    const cash = await bookingModel.aggregate([
      {
        $match: {
          createdAt: { $gte: since },
          "musicians.musicianId": musicianId
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" }},
          amount: { $sum: "$musicians.$.paidAmount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return res.json({
      success: true,
      enquiries,
      bookings,
      cash
    });

  } catch (err) {
    console.error("❌ Error in GET /stats/:id", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /api/musician/depping/:id
router.get("/depping/:id", verifyToken, async (req, res) => {
  try {
    const { email, phoneNormalized } = req.user;

    const acts = await actModel.find({
      "lineups.bandMembers.deputies": {
        $elemMatch: {
          $or: [
            { email },
            { phoneNormalized },
          ]
        }
      }
    })
    .select("_id name tscName coverImage images status")
    .lean();

    return res.json({ success: true, acts });
  } catch (err) {
    console.error("❌ Error in GET /depping/:id", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /api/musician/act-v2/my-drafts
router.get("/act-v2/my-drafts", verifyToken, async (req, res) => {
  try {
    const musicianId = req.user.id;

    const drafts = await actModel
      .find({
        createdBy: musicianId,
        status: "draft"
      })
      .select("_id name tscName images coverImage updatedAt createdAt amendmentDraft")
      .lean();

    return res.json({
      success: true,
      drafts
    });

  } catch (err) {
    console.error("❌ Error getting drafts:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/act-v2/update-status", updateActStatus);


router.get("/dashboard/:id", verifyToken, async (req, res) => {
  try {
    const musicianId = req.params.id;
    const user = req.user;
    const email = user.email;
    const phone = user.phoneNormalized;

    // 1️⃣ Acts created by musician
    const actsOwned = await actModel.find(
      { createdBy: musicianId },
      "_id name tscName coverImage status createdAt"
    ).lean();

    // 2️⃣ Acts the musician is depping for
    const actsDepping = await actModel.find({
      "lineups.bandMembers.deputies": {
        $elemMatch: {
          $or: [
            { email },
            { phoneNormalized: phone }
          ]
        }
      }
    }).select("_id name tscName coverImage status").lean();

    // 3️⃣ Bookings invoicing the musician
    const bookings = await bookingModel.find({
      "payments.musician": musicianId
    }).select("date amount status createdAt").lean();

    // Group bookings into chart data
    const byMonth = {};
    bookings.forEach(b => {
      const d = new Date(b.date);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      if (!byMonth[key]) {
        byMonth[key] = { enquiries: 0, bookings: 0, revenue: 0 };
      }
      byMonth[key].bookings += 1;
      byMonth[key].revenue += b.amount || 0;
    });

    // 4️⃣ Draft acts
    const drafts = await actModel.find(
      { createdBy: musicianId, status: "draft" },
      "_id name createdAt"
    ).lean();

    // 5️⃣ Placeholder reviews categories
    const reviewCategories = [
      { label: "Technical Skill", avg: null },
      { label: "Team Spirit", avg: null },
      { label: "Preparation", avg: null },
      { label: "Timeliness", avg: null },
      { label: "Client Satisfaction", avg: null },
    ];

    return res.json({
      success: true,
      actsOwned,
      actsDepping,
      bookingsByMonth: byMonth,
      drafts,
      reviewCategories
    });

  } catch (err) {
    console.error("❌ Dashboard error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ---------------- Legacy profile aliases (public) ----------------
   Some older frontend builds call these endpoints:
   - GET /api/musicians/:id
   - GET /api/musician/:id
   - GET /api/musician/get/:id
   Canonical endpoint is: GET /api/musician/profile/:id
*/

const readMusicianById = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await musicianModel.findById(id).lean();
    if (!doc) return res.status(404).json({ message: "Musician not found" });
    return res.json(doc);
  } catch (err) {
    console.error("❌ Error fetching musician profile (legacy):", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Legacy aliases
router.get("/get/:id", readMusicianById);
router.get("/:id", readMusicianById);

export default router;
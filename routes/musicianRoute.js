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
router.post("/register-deputy", uploadFields, registerDeputy);
router.get("/moderation/deputy/:id", verifyToken, getDeputyById);
router.get("/pending-deputies", verifyToken, listPendingDeputies);
router.post("/approve-deputy", verifyToken, approveDeputy);
router.post("/reject-deputy", verifyToken, rejectDeputy);
router.post("/email-contract", emailContract);

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

router.post("/suggest", suggestDeputies);





export default router;
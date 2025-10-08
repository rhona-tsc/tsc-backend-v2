import express from "express";
import musicianModel from "../models/musicianModel.js";
import PendingSong from "../models/pendingSongModel.js";
import actModel from "../models/actModel.js";
import Song from "../models/songModel.js";

import {
  submitPendingSongs,
  getPendingSongs,
  approveSong,
  rejectSong,
  // NEW exports:
  listPendingDeputies,
  listChangesPendingDeputies,
  listDeputiesReviewQueue,
} from "../controllers/moderationController.js";

import { getDeputyById } from "../controllers/musicianController.js";

const router = express.Router();

/* ===== SONGS ===== */

router.post("/submit-pending-songs", async (req, res) => {
  try {
    const songs = req.body.songs;
    const submittedBy = req.body.userId;

    const validSongs = (songs || []).filter(
      (song) => song && song.title && song.artist
    );

    await PendingSong.insertMany(
      validSongs.map((s) => ({ ...s, submittedBy, approved: false }))
    );

    res.status(201).json({ message: "Pending songs submitted" });
  } catch (err) {
    console.error("Error submitting pending songs:", err);
    res.status(500).json({ error: "Failed to submit songs" });
  }
});

router.get("/pending-songs", getPendingSongs);
router.post("/approve-song", approveSong);
router.delete("/reject-song/:id", rejectSong);

router.get("/master-songs", async (_req, res) => {
  try {
    const songs = await Song.find();
    res.json({ songs });
  } catch (err) {
    console.error("Failed to fetch master songs:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// ⬇️ ADD THIS route somewhere under your other /api/moderation routes:
router.post("/deputy/:id/repertoire/append", async (req, res) => {
  try {
    const { id } = req.params;
    const { songIds = [] } = req.body;

    if (!Array.isArray(songIds) || songIds.length === 0) {
      return res.status(400).json({ success: false, message: "songIds must be a non-empty array" });
    }

    // ensure all songs exist
    const songs = await Song.find({ _id: { $in: songIds } }, { title: 1, artist: 1, genre: 1, year: 1 });
    const validIds = songs.map(s => s._id);

    if (validIds.length === 0) {
      return res.status(404).json({ success: false, message: "No matching songs found" });
    }

    // also prepare selectedSongs payload (title/artist/genre/year objects)
    const selectedSongObjs = songs.map(s => ({
      title: s.title || "",
      artist: s.artist || "",
      genre: s.genre || "",
      year: s.year || ""
    }));

    // append to repertoire (ObjectIds) and selectedSongs (objects) without duplicates
    const update = {
      $addToSet: {
        repertoire: { $each: validIds },
        selectedSongs: { $each: selectedSongObjs }
      }
    };

    const updated = await musicianModel.findByIdAndUpdate(id, update, { new: true });
    if (!updated) {
      return res.status(404).json({ success: false, message: "Deputy not found" });
    }

    return res.json({
      success: true,
      message: `Appended ${validIds.length} song(s) to repertoire`,
      deputyId: id,
      appendedCount: validIds.length
    });
  } catch (err) {
    console.error("❌ repertoire/append error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// pending song count
router.get("/songs/pending-count", async (_req, res) => {
  try {
    const count = await PendingSong.countDocuments({ approved: false });
    res.status(200).json({ count });
  } catch (err) {
    console.error("Failed to get song count", err);
    res.status(500).json({ error: "Failed to count pending songs" });
  }
});

/* ===== COUNTS ===== */

router.get("/deputies/pending-count", async (_req, res) => {
  try {
    const count = await musicianModel.countDocuments({ status: "pending" });
    res.status(200).json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

router.get("/acts/pending-count", async (_req, res) => {
  try {
    const count = await actModel.countDocuments({ status: "pending" });
    res.status(200).json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ===== DEPUTIES ===== */

// existing pending list
router.get("/deputies/pending", listPendingDeputies);

// NEW: only “Approved, changes pending”
router.get("/deputies/changes-pending", listChangesPendingDeputies);

// NEW: combined queue (supports ?statuses= CSV)
router.get("/deputies/review-queue", listDeputiesReviewQueue);

// fetch by id (used elsewhere)
router.get("/deputy/:id", async (req, res) => {
  const deputy = await musicianModel.findById(req.params.id);
  if (!deputy)
    return res
      .status(404)
      .json({ success: false, message: "Deputy not found" });
  res.json({ success: true, deputy });
});

export default router;
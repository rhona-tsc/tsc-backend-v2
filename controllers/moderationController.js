// backend/controllers/moderationController.js
import PendingSong from "../models/pendingSongModel.js";
import Song from "../models/songModel.js";
import musicianModel from "../models/musicianModel.js";

/* =========================
 *  SONG MODERATION (unchanged)
 * =======================*/

export const submitPendingSongs = async (req, res) => {
  try {
    const songs = req.body.songs;
    if (!Array.isArray(songs)) return res.status(400).json({ error: "Invalid songs payload" });

    const validSongs = songs
      .filter((song) => song.title && song.artist)
      .map((song) => ({
        title: song.title.trim(),
        artist: song.artist.trim(),
        genre: song.genre || "",
        year: song.year || null,
        submittedBy: song.submittedBy || null,
      }));

    const inserted = await PendingSong.insertMany(validSongs);
    res.status(201).json({ message: "Songs submitted for review", inserted });
  } catch (err) {
    console.error("❌ Error submitting pending songs:", err);
    res.status(500).json({ error: "Failed to submit songs" });
  }
};

export const getPendingSongs = async (_req, res) => {
  try {
    const songs = await PendingSong.find({ approved: false });
    res.status(200).json({ songs });
  } catch (err) {
    console.error("❌ Failed to fetch pending songs:", err);
    res.status(500).json({ error: "Could not retrieve songs" });
  }
};

export const approveSong = async (req, res) => {
  try {
    const song = req.body;

    // Always insert to master
    const newSong = new Song({
      title: song.title,
      artist: song.artist,
      genre: song.genre,
      year: song.year,
      addedBy: song.submittedBy || null,
    });
    await newSong.save();

    // Only touch pending doc if an _id was provided
    if (song._id) {
      await PendingSong.findByIdAndUpdate(song._id, { approved: true });
    }

    res.status(200).json({ message: "Song added to master list" });
  } catch (err) {
    console.error("❌ Approval error:", err);
    res.status(500).json({ error: "Approval failed" });
  }
};

export const rejectSong = async (req, res) => {
  try {
    await PendingSong.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Song rejected and deleted" });
  } catch (err) {
    console.error("❌ Rejection error:", err);
    res.status(500).json({ error: "Rejection failed" });
  }
};



/* =========================
 *  DEPUTY MODERATION
 * =======================*/

const NORMALIZE = (doc) => {
  // prefer top-level fields; fallback to basicInfo
  const first =
    doc.firstName || doc?.basicInfo?.firstName || "";
  const last =
    doc.lastName || doc?.basicInfo?.lastName || "";
  const name = [first, last].filter(Boolean).join(" ").trim() || "undefined undefined";

  return {
    _id: doc._id,
    name,
    firstName: first,
    lastName: last,
    email: doc.email || doc?.basicInfo?.email || "",
    status: doc.status || "",
    profilePicture: doc.profilePicture || "",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

// helpers at top of file (add these)
const escapeRegExp = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// build a robust $or of exact, case-insensitive, trimmed matches
const buildStatusMatch = (statuses = []) => {
  const ors = [];
  for (const raw of statuses) {
    if (!raw) continue;
    const trimmed = String(raw).trim();
    if (!trimmed) continue;
    ors.push({ status: trimmed }); // exact
    ors.push({ status: { $regex: new RegExp(`^${escapeRegExp(trimmed)}$`, "i") } }); // case-insensitive
    ors.push({ status: { $regex: new RegExp(`${escapeRegExp(trimmed)}\\s*$`, "i") } }); // tolerate trailing ws
  }
  return ors.length ? { $or: ors } : {};
};

const fetchByStatuses = async (statuses) => {
  const statusMatch = buildStatusMatch(statuses);
  const query = { role: "musician", ...(statusMatch.$or ? { ...statusMatch } : {}) };

  // DEBUG
  console.log("🔎 fetchByStatuses query:", JSON.stringify(query));

  const docs = await musicianModel
    .find(query)
    .select("firstName lastName basicInfo email status profilePicture createdAt updatedAt")
    .sort({ createdAt: -1 })
    .lean();

  const deputies = docs.map(NORMALIZE);
  const statusCounts = deputies.reduce((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1;
    return acc;
  }, {});
  return { deputies, statusCounts };
};

// keep NORMALIZE as you already have it

// unchanged: listPendingDeputies (just calls fetchByStatuses)
export const listPendingDeputies = async (_req, res) => {
  try {
    const { deputies, statusCounts } = await fetchByStatuses(["pending"]);
    console.log("📦 listPendingDeputies ->", deputies.length);
    return res.json({ success: true, deputies, total: deputies.length, statusCounts });
  } catch (err) {
    console.error("❌ listPendingDeputies error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const listChangesPendingDeputies = async (_req, res) => {
  try {
    const status = "Approved, changes pending";
    const { deputies, statusCounts } = await fetchByStatuses([status]);
    console.log("📦 listChangesPendingDeputies ->", deputies.length);
    return res.json({ success: true, deputies, total: deputies.length, statusCounts });
  } catch (err) {
    console.error("❌ listChangesPending error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const listDeputiesReviewQueue = async (req, res) => {
  try {
    const raw = req.query.statuses || "";
    const statuses = raw
      .split(",")
      .map((s) => decodeURIComponent(s).trim())
      .filter(Boolean);

    const wanted = statuses.length
      ? statuses
      : ["pending", "Approved, changes pending"];

    console.log("🧾 review-queue statuses:", wanted);
    const { deputies, statusCounts } = await fetchByStatuses(wanted);
    console.log("📦 review-queue ->", deputies.length);

    return res.json({
      success: true,
      deputies,
      total: deputies.length,
      statusCounts,
      sample: deputies.slice(0, 10).map((d) => ({ id: d._id, name: d.name, status: d.status })),
    });
  } catch (err) {
    console.error("❌ listDeputiesReviewQueue error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


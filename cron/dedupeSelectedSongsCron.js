// cron/dedupeSelectedSongsCron.js
import cron from "node-cron";
import musicianModel from "../models/musicianModel.js";
import { logMemory } from "../utils/memoryMonitor.js";

const normalise = (value) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/\bft\.?\b|\bfeat\.?\b|\bfeaturing\b/g, "ft")
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Keep only one song list in memory. Loading hydrated full profiles here can
// exhaust the 512 MB instance when the weekly cleanup overlaps other jobs.
export function createSelectedSongsDedupeJob({ Model = musicianModel, logger = console, sampleMemory = logMemory } = {}) {
  let running = null;
  async function run() {
    const counts = { scanned: 0, musiciansUpdated: 0, totalRemoved: 0, concurrentEditsSkipped: 0 };
    await sampleMemory("song-dedupe-start", logger).catch(() => {});
    const cursor = Model.find({ selectedSongs: { $type: "array" } })
      .select({ _id: 1, selectedSongs: 1 })
      .lean()
      .cursor({ batchSize: 1 });
    try {
      for await (const musician of cursor) {
        counts.scanned++;
        const original = musician.selectedSongs || [];
        const seen = new Set();
        const dedupedSongs = [];
        for (const song of original) {
          const key = `${normalise(song.title)}|${normalise(song.artist)}`;
          if (!seen.has(key)) { seen.add(key); dedupedSongs.push(song); }
        }
        const removed = original.length - dedupedSongs.length;
        if (!removed) continue;

        // Use the original BSON song list as an optimistic lock. A concurrent
        // profile edit must never be overwritten. Raw collection updates keep
        // legacy song objects unchanged and avoid hydrating unrelated fields.
        const result = await Model.collection.updateOne(
          { _id: musician._id, selectedSongs: { $eq: original } },
          { $set: { selectedSongs: dedupedSongs, profileLastEditedAt: new Date() } },
        );
        if (result.modifiedCount) {
          counts.musiciansUpdated++;
          counts.totalRemoved += removed;
        } else counts.concurrentEditsSkipped++;
      }
      logger.info("[dedupeSelectedSongs] Done", counts);
      return counts;
    } finally {
      try { await cursor.close(); }
      finally { await sampleMemory("song-dedupe-end", logger).catch(() => {}); }
    }
  }
  return async function dedupeSelectedSongs() {
    if (running) return running;
    running = run();
    try { return await running; }
    finally { running = null; }
  };
}

export const dedupeSelectedSongsForAllMusicians = createSelectedSongsDedupeJob();

export const startDedupeSelectedSongsCron = () => {
  // Runs every Sunday at 3:00am server time
  cron.schedule("0 3 * * 0", async () => {
    try {
      console.log("[dedupeSelectedSongs] Weekly cron started");
      await dedupeSelectedSongsForAllMusicians();
    } catch (error) {
      console.error("[dedupeSelectedSongs] Cron failed:", error);
    }
  });
};
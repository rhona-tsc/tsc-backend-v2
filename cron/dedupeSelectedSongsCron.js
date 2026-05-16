// cron/dedupeSelectedSongsCron.js
import cron from "node-cron";
import musicianModel from "../models/musicianModel.js";

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

export const dedupeSelectedSongsForAllMusicians = async () => {
  const musicians = await musicianModel.find({
    selectedSongs: { $type: "array" },
  });

  let musiciansUpdated = 0;
  let totalRemoved = 0;

  for (const musician of musicians) {
    const seen = new Set();
    const dedupedSongs = [];

    for (const song of musician.selectedSongs || []) {
      const key = `${normalise(song.title)}|${normalise(song.artist)}`;

      if (!seen.has(key)) {
        seen.add(key);
        dedupedSongs.push(song);
      }
    }

    const removed = musician.selectedSongs.length - dedupedSongs.length;

    if (removed > 0) {
      musician.selectedSongs = dedupedSongs;
      musician.profileLastEditedAt = new Date();

      await musician.save();

      musiciansUpdated++;
      totalRemoved += removed;

      console.log(
        `[dedupeSelectedSongs] ${musician.firstName || ""} ${musician.lastName || ""}: removed ${removed}`
      );
    }
  }

  console.log(
    `[dedupeSelectedSongs] Done. Updated ${musiciansUpdated} musicians. Removed ${totalRemoved} duplicate songs.`
  );
};

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
import "dotenv/config";
import mongoose from "mongoose";

const normal = (value = "") => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const songKey = (song = {}) => {
  if (typeof song === "string") return normal(song);
  return [normal(song.title || song.name), normal(song.artist)].filter(Boolean).join("|");
};

const uniqueSongs = (songs) => {
  if (!Array.isArray(songs)) return songs;
  const seen = new Set();
  return songs.filter((song) => {
    const key = songKey(song);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const uniqueLines = (value) => {
  if (typeof value !== "string" || !value.trim()) return value;
  const seen = new Set();
  return value.split(/\r?\n/).filter((line) => {
    const key = normal(line);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join("\n");
};

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
try {
  const db = mongoose.connection;
  let actsChanged = 0;
  let musiciansChanged = 0;
  let songsRemoved = 0;

  for await (const act of db.collection("acts").find({}, { projection: { selectedSongs: 1, repertoire: 1, customRepertoire: 1 } })) {
    const selectedSongs = uniqueSongs(act.selectedSongs);
    const repertoire = uniqueSongs(act.repertoire);
    const customRepertoire = uniqueLines(act.customRepertoire);
    const before = (act.selectedSongs?.length || 0) + (act.repertoire?.length || 0);
    const after = (selectedSongs?.length || 0) + (repertoire?.length || 0);
    if (after !== before || customRepertoire !== act.customRepertoire) {
      const changes = {};
      if (Array.isArray(act.selectedSongs)) changes.selectedSongs = selectedSongs;
      if (Array.isArray(act.repertoire)) changes.repertoire = repertoire;
      if (typeof act.customRepertoire === "string") changes.customRepertoire = customRepertoire;
      await db.collection("acts").updateOne({ _id: act._id }, { $set: changes });
      actsChanged += 1;
      songsRemoved += before - after;
    }
  }

  for await (const musician of db.collection("musicians").find({}, { projection: { selectedSongs: 1, repertoire: 1, customRepertoire: 1 } })) {
    const selectedSongs = uniqueSongs(musician.selectedSongs);
    const repertoire = uniqueSongs(musician.repertoire);
    const customRepertoire = uniqueLines(musician.customRepertoire);
    const before = (musician.selectedSongs?.length || 0) + (musician.repertoire?.length || 0);
    const after = (selectedSongs?.length || 0) + (repertoire?.length || 0);
    if (after !== before || customRepertoire !== musician.customRepertoire) {
      const changes = {};
      if (Array.isArray(musician.selectedSongs)) changes.selectedSongs = selectedSongs;
      if (Array.isArray(musician.repertoire)) changes.repertoire = repertoire;
      if (typeof musician.customRepertoire === "string") changes.customRepertoire = customRepertoire;
      await db.collection("musicians").updateOne({ _id: musician._id }, { $set: changes });
      musiciansChanged += 1;
      songsRemoved += before - after;
    }
  }

  console.log(JSON.stringify({ actsChanged, musiciansChanged, songsRemoved }));
} finally {
  await mongoose.disconnect();
}

import mongoose from "mongoose";

const songSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  artist: { type: String, required: true, trim: true },
  genre: { type: String },
  year: { type: Number },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
  addedAt: { type: Date, default: Date.now },
});

export default mongoose.models.Song || mongoose.model("Song", songSchema);
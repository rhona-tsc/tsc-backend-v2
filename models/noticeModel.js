import mongoose from "mongoose";

const NoticeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "Musician" },
    authorName: { type: String },
    pinned: { type: Boolean, default: false },
    archived: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model("Notice", NoticeSchema);
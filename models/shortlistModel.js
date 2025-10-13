// models/shortlistModel.js
import mongoose from "mongoose";

const shortlistSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    acts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Act" }],
  },
  { timestamps: true }
);

const Shortlist = mongoose.model("Shortlist", shortlistSchema);
export default Shortlist;
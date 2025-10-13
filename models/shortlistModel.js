// models/shortlistModel.js
import mongoose from "mongoose";

const ShortlistSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  acts: [
    {
      actId: { type: mongoose.Schema.Types.ObjectId, ref: "Act" },
      dateISO: { type: String },
      formattedAddress: { type: String }, // new field for venue/location
    },
  ],
});

const Shortlist = mongoose.model("Shortlist", shortlistSchema);
export default Shortlist;
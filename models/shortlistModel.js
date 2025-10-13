// models/shortlistModel.js
import mongoose from "mongoose";

const shortlistSchema = new mongoose.Schema(
   {
      actId: { type: mongoose.Schema.Types.ObjectId, ref: "Act" },
      dateISO: { type: String },
      formattedAddress: { type: String }, // new field for venue/location
    },
  { timestamps: true }
);

const Shortlist = mongoose.model("Shortlist", shortlistSchema);
export default Shortlist;
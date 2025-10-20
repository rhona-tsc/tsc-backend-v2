// models/shortlistModel.js
import mongoose from "mongoose";

const shortlistSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    acts: [
      {
        actId: { type: mongoose.Schema.Types.ObjectId, ref: "Act" },
        dateISO: { type: String },
        formattedAddress: { type: String },
      },
    ],
  },
  { timestamps: true }
);

shortlistSchema.index({ userId: 1 });
shortlistSchema.index({ "acts.actId": 1 });

shortlistSchema.pre("save", function (next) {
  if (!this.isModified("acts")) return next();
  const uniqueActs = [];
  const seen = new Set();
  for (const a of this.acts) {
    const key = `${a.actId}-${a.dateISO}-${(a.formattedAddress || "").trim().toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueActs.push(a);
    }
  }
  this.acts = uniqueActs;
  next();
});

const Shortlist = mongoose.model("Shortlist", shortlistSchema);
export default Shortlist;
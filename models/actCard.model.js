import mongoose from "mongoose";

const ActCardSchema = new mongoose.Schema(
  {
    actId: { type: mongoose.Schema.Types.ObjectId, ref: "Act", index: true, unique: true },
    tscName: { type: String, index: true },
    name: { type: String },
    slug: { type: String },
    imageUrl: { type: String, default: "" },         // final URL or Cloudinary public_id
    basePrice: { type: Number, default: null },      // smallest lineup total (with margin)
    loveCount: { type: Number, default: 0 },
    status: { type: String, index: true },           // approved/pending/draft/trashed
    amendmentPending: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Fast sort on fresh/featured
ActCardSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("ActCard", ActCardSchema);
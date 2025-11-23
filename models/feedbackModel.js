import mongoose from "mongoose";

const FeedbackSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "Musician", required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model("Feedback", FeedbackSchema);
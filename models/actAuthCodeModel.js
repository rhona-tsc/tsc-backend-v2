import mongoose from "mongoose";

const actAuthCodeSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "Musician" },
  used: { type: Boolean, default: false },
  actId: { type: mongoose.Schema.Types.ObjectId, ref: "Act", default: null },
}, { timestamps: true });

export default mongoose.model("ActAuthorisationCode", actAuthCodeSchema);
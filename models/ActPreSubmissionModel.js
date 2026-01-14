import mongoose from "mongoose";

const ActPreSubmissionSchema = new mongoose.Schema({
  musicianId: { type: mongoose.Schema.Types.ObjectId, ref: "Musician", required: true },
  musicianName: String,
  musicianEmail: String,

  actName: String,
  videoLink1: String,
  videoLink2: String,
  videoLink3: String,

  extraInfo: String,  // renamed from “why is your act…”
  isBandLeader: Boolean,
  bandLeaderName: String,
  bandLeaderEmail: String,

  status: { type: String, default: "pending" }, // pending / approved / rejected
  inviteCode: { type: String, default: null },
inviteCodeHash: { type: String, index: true, unique: true, sparse: true },
inviteCodeUsed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("ActPreSubmission", ActPreSubmissionSchema);
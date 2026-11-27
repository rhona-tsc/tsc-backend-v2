import mongoose from "mongoose";
const person = new mongoose.Schema(
  { musicianId: String, name: String, aliases: [String] },
  { _id: false },
);
const schema = new mongoose.Schema(
  {
    actId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    exclusions: [{ person, withPeople: [person], reason: String }],
    roleUpgradeTransfers: [{ musicianId: String, fromRole: String, toRolePattern: String }],
    sharedSkillRequirements: [{ skill: String, sourceRolePattern: String }],
    pendingMatches: [
      { name: String, role: String, regions: [String], priority: Number },
    ],
  },
  { timestamps: true },
);
export default mongoose.models.actRosterPolicy ||
  mongoose.model("actRosterPolicy", schema);

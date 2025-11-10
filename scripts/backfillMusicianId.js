// scripts/backfillMusicianId.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import musicianModel from "../models/musicianModel.js";

dotenv.config();

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Update all musicians that don't yet have musicianId
    const result = await musicianModel.updateMany(
      { $or: [{ musicianId: { $exists: false } }, { musicianId: "" }] },
      [
        { $set: { musicianId: "$_id" } }, // Mongo 4.2+ supports $set with aggregation expression
      ]
    );

    console.log(`🎸 Updated ${result.modifiedCount} musicians with musicianId`);
  } catch (err) {
    console.error("❌ Error updating musicianId:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
};

run();
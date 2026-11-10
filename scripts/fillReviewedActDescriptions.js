// Run from the backend with its normal environment. Defaults to a read-only preview.
import "dotenv/config";
import mongoose from "mongoose";
import actModel from "../models/actModel.js";

// Summaries of the already published tscBio copy, reviewed 10 November 2026.
const descriptions = {
  "magnolia-sky": "Magnolia Sky brings festival-style folk and pop to weddings and events, with acoustic guitar, uplifting singalongs and 3- or 4-piece lineups.",
  "gotta-be-garage": "Gotta Be Garage brings live UK garage, R&B, pop and soul to weddings and events, with two female lead vocalists, an MC and a 6-piece lineup.",
};
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) throw new Error("Backend database connection is required");
await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
try {
  for (const [slug, description] of Object.entries(descriptions)) {
    const act = await actModel.findOne({ slug }).select("slug tscName tscDescription tscBio status").lean();
    if (!act) throw new Error(`Published act not found: ${slug}`);
    if (!act.tscBio) throw new Error(`Approved biography missing: ${slug}`);
    if (String(act.tscDescription || "").trim()) {
      console.log(JSON.stringify({ slug, action: "preserved_existing_description" }));
      continue;
    }
    if (!process.argv.includes("--apply")) {
      console.log(JSON.stringify({ slug, action: "preview", description }));
      continue;
    }
    const result = await actModel.updateOne(
      { _id: act._id, tscBio: act.tscBio, $or: [{ tscDescription: "" }, { tscDescription: null }, { tscDescription: { $exists: false } }] },
      { $set: { tscDescription: description } }, { runValidators: true },
    );
    console.log(JSON.stringify({ slug, action: result.modifiedCount === 1 ? "description_saved" : "skipped_concurrent_edit" }));
  }
} finally { await mongoose.disconnect(); }

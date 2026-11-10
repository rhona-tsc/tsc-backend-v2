// Add reviewed targets without replacing existing keywords, recipients or schedule.
import "dotenv/config";
import mongoose from "mongoose";
import SeoKeywordTracker from "../models/seoKeywordTrackerModel.js";

const counties = ["surrey", "berkshire", "hertfordshire", "essex", "buckinghamshire", "kent", "west-sussex", "east-sussex", "oxfordshire"];
const targets = [
  ...counties.map(slug => ({ term: `wedding bands ${slug.replaceAll("-", " ")}`, targetUrl: `https://thesupremecollective.co.uk/wedding-bands-${slug}/` })),
  { term: "essex wedding band", targetUrl: "https://thesupremecollective.co.uk/wedding-bands-essex/" },
  ...["magnolia-sky", "gotta-be-garage", "the-riot-dogs", "funk-royale", "indigo-delight"].map(slug => ({ term: slug.replaceAll("-", " "), targetUrl: `https://thesupremecollective.co.uk/act/${slug}/` })),
];
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) throw new Error("Backend database connection is required");
await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
try {
  const tracker = await SeoKeywordTracker.findOne({ key: "primary" }).select("keywords").lean();
  if (!tracker) throw new Error("Existing keyword tracker not found; no configuration changed");
  const normalise = value => value.trim().toLowerCase().replace(/\s+/g, " ");
  const existing = new Set(tracker.keywords.map(keyword => normalise(keyword.term)));
  const additions = targets.filter(target => !existing.has(normalise(target.term))).map(target => ({ ...target, source: "manual", active: true }));
  console.log(JSON.stringify({ action: process.argv.includes("--apply") ? "apply" : "preview", additions }));
  if (process.argv.includes("--apply") && additions.length) {
    // Compare the original array: do not overwrite a simultaneous staff edit.
    const result = await SeoKeywordTracker.updateOne({ _id: tracker._id, keywords: tracker.keywords }, { $push: { keywords: { $each: additions } } });
    if (result.modifiedCount !== 1) throw new Error("Tracker changed concurrently; no keywords added");
  }
} finally { await mongoose.disconnect(); }

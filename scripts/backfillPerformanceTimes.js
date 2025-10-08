// scripts/backfillPerformanceTimes.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import Booking from "../models/bookingModel.js";

dotenv.config();

const isNonEmpty = (obj) =>
  !!obj && typeof obj === "object" && Object.keys(obj).length > 0;

async function run() {
  await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/tsc");
  console.log("▶ Connected to MongoDB");

  const cursor = Booking.find({}).cursor(); // scan everything

  let updated = 0;
  let mirroredDown = 0; // top-level -> actsSummary[*]
  let mirroredUp = 0;   // actsSummary[0] -> top-level

  for await (const booking of cursor) {
    let changed = false;

    const top = booking.performanceTimes;
    const items = Array.isArray(booking.actsSummary) ? booking.actsSummary : [];

    // 1) If top-level exists, ensure each item has performance
    if (isNonEmpty(top) && items.length) {
      const nextItems = items.map((it) => {
        const perf = it?.performance;
        if (!isNonEmpty(perf)) {
          mirroredDown++;
          changed = true;
          // keep other fields on the item intact
          return { ...(it.toObject?.() || it), performance: top };
        }
        return it;
      });
      // only assign if something changed to avoid Mongoose dirtying lots of docs
      if (changed) booking.actsSummary = nextItems;
    }

    // 2) If top-level missing/empty, but first item has performance, copy up
    if (!isNonEmpty(top) && items[0]?.performance && isNonEmpty(items[0].performance)) {
      booking.performanceTimes = items[0].performance;
      mirroredUp++;
      changed = true;
    }

    if (changed) {
      await booking.save();
      updated++;
      console.log(`✓ Backfilled ${booking.bookingId || booking._id}`);
    }
  }

  console.log(`🎉 Done. Updated ${updated} bookings. Mirrored down: ${mirroredDown}, up: ${mirroredUp}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("✖ Error in backfill:", err);
  process.exit(1);
});
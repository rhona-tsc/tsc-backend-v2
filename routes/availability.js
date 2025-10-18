// routes/availability.js
import express from "express";
import AvailabilityModel from "../models/availabilityModel.js";
import { resolveAvailableMusician, rebuildAndApplyBadge } from "../controllers/availabilityController.js";
import { applyFeaturedBadgeOnYesV3 } from "../controllers/applyFeaturedBadgeOnYesV2.js";
import { findPersonByPhone } from "../utils/findPersonByPhone.js";
import { buildBadgeFromAvailability } from "../controllers/availabilityBadgeController.js";
import Act from "../models/actModel.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/*                            GET /check-latest                               */
/* -------------------------------------------------------------------------- */
router.get("/check-latest", async (req, res) => {
  console.log(`🟢 (routes/availability.js) /check-latest route START at ${new Date().toISOString()}`, {
    actId: req.query?.actId,
    dateISO: req.query?.dateISO,
  });
  try {
    const { actId, dateISO } = req.query;
    if (!actId || !dateISO) return res.status(400).json({ latestReply: null });

    const doc = await AvailabilityModel.findOne({ actId, dateISO })
      .sort({ repliedAt: -1, updatedAt: -1, createdAt: -1 });

    const latestReply =
      doc?.reply ||
      (["declined", "cancelled"].includes(doc?.calendarStatus) ? "unavailable" : null);

    res.json({ latestReply: latestReply || null });
  } catch (e) {
    console.error("⚠️ check-latest error:", e.message);
    res.status(500).json({ latestReply: null });
  }
});

/* -------------------------------------------------------------------------- */
/*                          POST /twilio/inbound                              */
/* -------------------------------------------------------------------------- */



// ✅ Twilio inbound handler (musician reply to availability request)
router.post("/twilio/inbound", async (req, res) => {
  console.log(`🟢 (routes/availability.js) /twilio/inbound route START ...`);
  try {
    const { From, ButtonPayload, Body } = req.body;
    const fromPhone = From?.replace(/^whatsapp:/i, "").trim();
    console.log("📩 Incoming Twilio inbound payload:", { From, ButtonPayload, Body });

    // 🧩 Step 1: Find musician by phone
    const musician = await findPersonByPhone(fromPhone);
    if (!musician) {
      console.warn("❌ No musician found for", fromPhone);
      return res.sendStatus(200);
    }
    console.log("✅ Matched musician:", musician.firstName, musician.lastName);

    // 🧩 Step 2: Extract tscName from payload like "YESfunkroyale"
    const match = ButtonPayload?.match(/YES[_\-]?([a-z0-9]+)/i);
    const tscNameRaw = match?.[1] || "";
    const tscName = tscNameRaw.trim().toLowerCase();
    console.log("🎯 Extracted tscName from payload:", tscName);

    if (!tscName) {
      console.warn("⚠️ No tscName found in ButtonPayload:", ButtonPayload);
      return res.sendStatus(200);
    }

    // 🧩 Step 3: Find the act by tscName (case-insensitive)
    const act = await Act.findOne({ tscName: new RegExp(`^${tscName}$`, "i") }).lean();
    if (!act) {
      console.warn("⚠️ No act found for tscName:", tscName);
      return res.sendStatus(200);
    }

    const actId = act._id;
    const dateISO = new Date().toISOString().slice(0, 10);

    console.log("🎵 Found act:", { tscName: act.tscName, actId, dateISO });

    // 🧩 Step 4: Update or insert availability record
    await AvailabilityModel.updateOne(
      { actId, phone: fromPhone },
      {
        $set: {
          reply: "yes",
          repliedAt: new Date(),
          musicianId: musician._id,
        },
      },
      { upsert: true }
    );
    console.log("🟢 Availability updated for musician:", musician.firstName);

    // 🧩 Step 5: Rebuild availability badge
    try {
      const badge = await buildBadgeFromAvailability(actId, dateISO);
      if (badge) {
        await Act.updateOne({ _id: actId }, { $set: { availabilityBadge: badge } });
        console.log("🐊 Badge updated successfully:", {
          act: act.tscName,
          vocalistName: badge.vocalistName,
          deputies: badge.deputies.map((d) => d.vocalistName),
        });
      } else {
        console.warn("⚠️ No badge built (no YES replies yet)");
      }
    } catch (badgeErr) {
      console.error("❌ Error building badge:", badgeErr.message);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Twilio inbound error:", err);
    res.sendStatus(500);
  }
});

/* -------------------------------------------------------------------------- */
/*                  POST /rebuild-availability-badge                          */
/* -------------------------------------------------------------------------- */
router.post("/rebuild-availability-badge", (req, res, next) => {
  console.log(`🟢 (routes/availability.js) /rebuild-availability-badge route START at ${new Date().toISOString()}`, {
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, applyFeaturedBadgeOnYesV3);

/* -------------------------------------------------------------------------- */
/*                       POST /badges/rebuild                                 */
/* -------------------------------------------------------------------------- */
router.post("/badges/rebuild", (req, res, next) => {
  console.log(`🟢 (routes/availability.js) /badges/rebuild route START at ${new Date().toISOString()}`, {
    bodyKeys: Object.keys(req.body || {}),
  });
  next();
}, rebuildAndApplyBadge);

/* -------------------------------------------------------------------------- */
/*                        GET /resolve-musician                               */
/* -------------------------------------------------------------------------- */
router.get("/resolve-musician", (req, res, next) => {
  console.log(`🟢 (routes/availability.js) /resolve-musician route START at ${new Date().toISOString()}`, {
    query: req.query,
  });
  next();
}, resolveAvailableMusician);

export default router;
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



router.post("/twilio/inbound", async (req, res) => {
  console.log(`🟢 (routes/availability.js) /twilio/inbound route START ...`);
  try {
    const { From, Body, ButtonPayload } = req.body;
    const fromPhone = From?.replace(/^whatsapp:/i, "").trim();

    const musician = await findPersonByPhone(fromPhone);
    if (!musician) {
      console.warn("❌ No musician found for", fromPhone);
      return res.sendStatus(200);
    }

    console.log("✅ Matched musician:", musician.firstName, musician.lastName);

    // 🔍 Parse actId from ButtonPayload (e.g. YES68a5f5f66b1506572e709171)
const match = ButtonPayload?.match(/YES[_\-]?(.+)/i);
const tscNameRaw = match?.[1] || "";
const tscName = tscNameRaw.replace(/_/g, " ").trim();

console.log("🎯 Extracted tscName from payload:", tscName);

// Find act by tscName
const act = await Act.findOne({ tscName: new RegExp(`^${tscName}$`, "i") }).lean();
if (!act) {
  console.warn("⚠️ No act found for tscName:", tscName);
  return res.sendStatus(200);
}
    const actId = match?.[1];
    const dateISO = new Date().toISOString().slice(0, 10); // fallback if not encoded

    if (!actId) {
      console.warn("⚠️ No actId found in ButtonPayload:", ButtonPayload);
      return res.sendStatus(200);
    }

    // ✅ Update AvailabilityModel
    await AvailabilityModel.updateOne(
      { actId, phone: fromPhone },
      { $set: { reply: "yes", repliedAt: new Date() } },
      { upsert: true }
    );

    // ✅ Try to trigger badge rebuild safely
    try {
      const badge = await buildBadgeFromAvailability(actId, dateISO);

      if (badge) {
        await Act.updateOne({ _id: actId }, { $set: { availabilityBadge: badge } });
        console.log("🐊 (controllers/availabilityBadgeController.js) Badge updated:", badge.vocalistName);
      } else {
        console.warn(`⚠️ No badge could be built for actId=${actId} (no YES replies yet)`);
      }

    } catch (badgeErr) {
      console.error(`🐊 (controllers/availabilityBadgeController.js) Badge build failed for ${actId}:`, badgeErr.message);

      // Optional deeper debug:
      if (badgeErr.message.includes("Act not found")) {
        const acts = await Act.find().select("_id tscName name").limit(10).lean();
        console.warn("🧩 (debug) Showing first 10 Acts for comparison:", acts);
      }
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
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



// ✅ routes/availability.js
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

    // 🧩 Step 2: Parse button payload → reply + act key
    const match = ButtonPayload?.match(/^(YES|NOLOC|UNAVAILABLE)[_\-]?([a-z0-9]+)/i);
    const replyType = match?.[1]?.toLowerCase(); // yes, noloc, unavailable
    const tscKey = match?.[2] || "";

    if (!replyType || !tscKey) {
      console.warn("⚠️ Missing replyType or tscKey in payload:", ButtonPayload);
      return res.sendStatus(200);
    }

    const normalize = (str = "") =>
      str.toLowerCase().replace(/\s+/g, "").replace(/[^\w]/g, ""); // remove punctuation + spaces

    const normalizedKey = normalize(tscKey);
    console.log("🎯 Extracted from payload:", { replyType, normalizedKey });

    // 🧩 Step 3: Find act by normalized tscName
    const allActs = await Act.find({}, { _id: 1, tscName: 1 }).lean();
    const act = allActs.find((a) => normalize(a.tscName) === normalizedKey);

    if (!act) {
      console.warn("⚠️ No act found for normalized key:", normalizedKey);
      console.log(
        "🧩 (debug) First 10 acts for reference:",
        allActs.slice(0, 10).map((a) => a.tscName)
      );
      return res.sendStatus(200);
    }

    const actId = act._id;
    const dateISO = new Date().toISOString().slice(0, 10);

    console.log("🎵 Found act:", { tscName: act.tscName, actId, dateISO });

    // 🧩 Step 4: Update or insert availability
    await AvailabilityModel.updateOne(
      { actId, phone: fromPhone },
      {
        $set: {
          reply: replyType,
          repliedAt: new Date(),
          musicianId: musician._id,
        },
      },
      { upsert: true }
    );
    console.log(`🟢 Availability updated: ${replyType} for ${musician.firstName}`);

    // 🧩 Step 5: Build badge only for YES replies
    if (replyType === "yes") {
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
      } catch (err) {
        console.error("❌ Error building badge:", err.message);
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
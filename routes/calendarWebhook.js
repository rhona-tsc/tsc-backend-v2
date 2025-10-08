// routes/calendarWebhook.js
import express from "express";
import AvailabilityModel from "../models/availabilityModel.js";
import Act from "../models/actModel.js";
import { google } from "googleapis";

const router = express.Router();

// Reuse the same oauth2Client you configure in googleController.js
import { oauth2Client } from "../controllers/googleController.js";
const calendar = google.calendar({ version: "v3", auth: oauth2Client });

// POST /api/google/notifications  (your GOOGLE_WEBHOOK_URL)
router.post("/notifications", async (req, res) => {
  try {
    const resourceState = req.headers["x-goog-resource-state"]; // e.g. "exists", "sync"
    const channelId = req.headers["x-goog-channel-id"];
    const resourceId = req.headers["x-goog-resource-id"];

    console.log("📬 Calendar Notification:", { resourceState, channelId, resourceId });

    // Pragmatic approach: fetch events updated in the last few minutes and reconcile.
    const updatedMin = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const list = await calendar.events.list({
      calendarId: "primary",
      updatedMin,
      showDeleted: true,
      singleEvents: false,
      maxResults: 50,
    });

    const events = list.data.items || [];
    console.log(`🗂  Fetched ${events.length} updated events since ${updatedMin}`);

    for (const ev of events) {
      const eventId = ev.id;
      const status = ev.status; // "confirmed" | "cancelled"
      const attendee = (ev.attendees || [])[0];
      const responseStatus = attendee?.responseStatus; // "accepted" | "declined" | "tentative" | "needsAction"

      const calStatus =
        status === "cancelled" ? "cancelled" :
        responseStatus || null;

      const isDecline = calStatus === "declined" || calStatus === "cancelled";

      const doc = await AvailabilityModel.findOneAndUpdate(
        { calendarEventId: eventId },
        {
          $set: {
            calendarStatus: calStatus,
            ...(isDecline ? { calendarDeclinedAt: new Date() } : {}),
          },
        },
        { new: true }
      );

      if (doc) {
        console.log("🔗 Updated Availability from calendar:", {
          availabilityId: doc._id.toString(),
          calendarEventId: eventId,
          calendarStatus: calStatus,
        });

        // Clear badge if declined/cancelled
        if (isDecline && doc.actId) {
          await Act.findByIdAndUpdate(doc.actId, {
            $set: { "availabilityBadge.active": false },
            $unset: {
              "availabilityBadge.vocalistName": "",
              "availabilityBadge.inPromo": "",
              "availabilityBadge.dateISO": "",
              "availabilityBadge.address": "",
              "availabilityBadge.setAt": "",
            },
          });
          console.log("🏷️ Cleared availability badge for act", String(doc.actId));
        }
      }
    }

    res.status(200).send("OK");
  } catch (e) {
    console.error("❌ calendar notifications error:", e?.message || e);
    res.status(200).send("OK"); // keep Google happy
  }
});

export default router;
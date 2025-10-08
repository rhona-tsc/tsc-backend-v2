// /routes/google.js
import express from "express";
import {
  getAuthUrl,
  oauth2Callback,
  getCalendarEvent,
} from "../controllers/googleController.js";
import EnquiryMessage from "../models/EnquiryMessage.js";

const router = express.Router();

router.get("/auth-url", getAuthUrl);
router.get("/oauth2callback", oauth2Callback);

router.post("/webhook", async (req, res) => {
  console.log("📬 Google Calendar webhook headers:", req.headers);
  console.log("📬 Google Calendar webhook body:", req.body);

  const resourceId = req.headers["x-goog-resource-id"];
  const channelId = req.headers["x-goog-channel-id"];
  const state = req.headers["x-goog-resource-state"];

  console.log("🔔 Webhook received:", { channelId, resourceId, state });

  try {
    // If you stored eventId with the enquiry, fetch it
    // e.g., find enquiries with this resourceId (or eventId if you stored it)
    const eventId = req.body.id || req.query.eventId; // adjust if you pass eventId when registering watch
    if (!eventId) {
      console.warn("⚠️ No eventId provided, cannot fetch event.");
      return res.sendStatus(200);
    }

    // Fetch fresh event from Google
    const event = await getCalendarEvent(eventId);

    console.log("📆 Refetched event:", {
      id: event.id,
      attendees: event.attendees?.map((a) => ({
        email: a.email,
        status: a.responseStatus,
      })),
    });

    // Loop through attendees and update enquiry DB
    if (event.attendees && event.attendees.length > 0) {
      for (const attendee of event.attendees) {
        const { email, responseStatus } = attendee;

        // Find enquiry that matches this event + email
        const enquiry = await EnquiryMessage.findOneAndUpdate(
          { calendarEventId: event.id, "attendees.email": email },
          { $set: { "attendees.$.calendarStatus": responseStatus } },
          { new: true }
        );

        if (enquiry) {
          console.log(
            `✅ Updated DB for ${email} → calendarStatus=${responseStatus}`
          );
        } else {
          console.warn(
            `⚠️ No matching enquiry found for eventId=${event.id}, email=${email}`
          );
        }
      }
    }
  } catch (err) {
    console.error("❌ Error handling webhook:", err);
  }

  res.sendStatus(200);
});

export default router;
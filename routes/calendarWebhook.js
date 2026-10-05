// routes/calendarWebhook.js
import express from "express";
import AvailabilityModel from "../models/availabilityModel.js";
import Musician from "../models/musicianModel.js";
import { google } from "googleapis";
import { sendWhatsAppMessage } from "../utils/twilioClient.js";

const router = express.Router();

// Reuse the same oauth2Client you configure in googleController.js
import { oauth2Client } from "../controllers/googleController.js";
const calendar = google.calendar({ version: "v3", auth: oauth2Client });

// POST /api/google/notifications  (your GOOGLE_WEBHOOK_URL)
router.post("/notifications", async (req, res) => {
    console.log('✨ (routes/calendarWebhook.js) /notifications triggered at', new Date().toISOString(), {
    body: req.body,
  });
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
      const availabilityRows = await AvailabilityModel.find({ calendarEventId: eventId });
      for (const existing of availabilityRows) {
        const musician = existing.musicianId
          ? await Musician.findById(existing.musicianId)
              .select("firstName email basicInfo.firstName basicInfo.email")
              .lean()
          : null;
        const inviteEmail = String(
          existing.calendarInviteEmail || musician?.email || musician?.basicInfo?.email || "",
        ).trim().toLowerCase();
        const attendee = (ev.attendees || []).find(
          (entry) => String(entry?.email || "").trim().toLowerCase() === inviteEmail,
        );
        const responseStatus = attendee?.responseStatus;
        const calStatus = status === "cancelled" ? "cancelled" : responseStatus || null;
        const isDecline = calStatus === "declined" || calStatus === "cancelled";
        const wasPending = existing.calendarCancellationConfirmationPending;
        existing.calendarStatus = isDecline ? "decline_confirmation_pending" : calStatus;
        if (isDecline) {
          existing.calendarDeclinedAt = new Date();
          existing.calendarCancellationConfirmationPending = true;
        }
        await existing.save();
        const doc = existing;

      if (doc) {
        console.log("🔗 Updated Availability from calendar:", {
          availabilityId: doc._id.toString(),
          calendarEventId: eventId,
          calendarStatus: calStatus,
        });

        if (
          isDecline &&
          !wasPending &&
          doc.phone &&
          process.env.TWILIO_CALENDAR_CANCELLATION_CONFIRMATION_SID
        ) {
          const firstName = musician?.firstName || musician?.basicInfo?.firstName || "there";
          const details = [doc.formattedDate, doc.formattedAddress, doc.duties].filter(Boolean).join(" · ");
          await sendWhatsAppMessage({
            to: doc.phone,
            contentSid: process.env.TWILIO_CALENDAR_CANCELLATION_CONFIRMATION_SID,
            requestId: `CAL_${doc._id}`,
            variables: { "1": firstName, "2": details || "your booking" },
            smsBody: `Hi ${firstName}, we received a declined calendar response for ${details || "your gig"}. Please confirm: YES, I'M UNAVAILABLE or NO, REINSTATE INVITE.`,
          });
          doc.calendarCancellationConfirmationSentAt = new Date();
          await doc.save();
        } else if (isDecline && !wasPending) {
          console.warn(
            "Calendar decline requires confirmation, but the Twilio confirmation template is not configured.",
            { availabilityId: String(doc._id) },
          );
        }
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
